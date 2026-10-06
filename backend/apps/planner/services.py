"""What the views call: plan a trip, name a map click. No HTTP request or response objects here."""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Sequence
from dataclasses import replace
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import DatabaseError, transaction
from django.utils import timezone

from apps.common.errors import PlanFailed, RouteTooLongError, UpstreamError

from . import directions, polyline
from .assemble import build_plan
from .gazetteer import describe_place
from .hos.models import EngineError
from .models import RouteCache
from .providers import nominatim, osrm
from .types import PlanRequestData, RouteData, RouteLeg

logger = logging.getLogger(__name__)

#: Bump when the cached payload layout changes. Old rows then simply stop matching.
CACHE_VERSION = "v1"
#: Four decimal places is about 11 m, close enough that the same address reuses its route.
KEY_DECIMALS = 4


def waypoints_of(request: PlanRequestData) -> list[tuple[float, float]]:
    return [(p.lat, p.lon) for p in (request.current, request.pickup, request.dropoff)]


def route_cache_key(waypoints: Sequence[tuple[float, float]]) -> str:
    rounded = ";".join(f"{lat:.{KEY_DECIMALS}f},{lon:.{KEY_DECIMALS}f}" for lat, lon in waypoints)
    return hashlib.sha256(f"{CACHE_VERSION}|driving|{rounded}".encode()).hexdigest()


def route_to_payload(route: RouteData) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "polyline": polyline.encode(route.coordinates),
        "leg_end_indices": list(route.leg_end_indices),
        "legs": [
            {"distance_miles": leg.distance_miles, "osrm_duration_minutes": leg.osrm_duration_minutes}
            for leg in route.legs
        ],
    }
    # Absent means "not asked for yet". An empty list means "asked, and nothing usable came back".
    if route.directions is not None:
        payload["directions"] = directions.to_payload(route.directions)
    return payload


def route_from_payload(payload: dict[str, Any]) -> RouteData:
    coordinates = polyline.decode(payload["polyline"])
    first_end, last_end = (int(i) for i in payload["leg_end_indices"])
    if not (0 <= first_end <= last_end < len(coordinates)):
        raise ValueError("Cached leg indices fall outside the geometry.")
    first, second = (RouteLeg(**leg) for leg in payload["legs"])
    stretches = directions.from_payload(payload["directions"]) if "directions" in payload else None
    return RouteData(
        coordinates=coordinates, leg_end_indices=(first_end, last_end), legs=(first, second), directions=stretches
    )


def _ttl() -> timedelta:
    return timedelta(hours=settings.ROUTE_CACHE_TTL_HOURS)


def _read_cached_route(key: str) -> tuple[dict[str, Any], RouteData] | None:
    row = RouteCache.objects.filter(key=key).first()
    if row is None or row.created_at < timezone.now() - _ttl():
        return None
    try:
        return row.payload, route_from_payload(row.payload)
    except (KeyError, TypeError, ValueError):
        logger.warning("Dropping an unreadable cached route.")
        return None


def _store_route(key: str, payload: dict[str, Any]) -> None:
    now = timezone.now()
    try:
        with transaction.atomic():
            RouteCache.objects.filter(created_at__lt=now - _ttl()).delete()
            RouteCache.objects.update_or_create(key=key, defaults={"payload": payload, "created_at": now})
    except DatabaseError:
        # A cache that can't be written should not fail a plan that already succeeded.
        logger.warning("Couldn't store the route in the cache.")


def _fetch_directions(waypoints: Sequence[tuple[float, float]], route: RouteData) -> list[Any] | None:
    """Ask for the turn list and condense it, in the form the cache keeps.

    Best effort. An empty list means the router answered but nothing was usable. None means it
    didn't answer, so the caller leaves the cache alone and the next plan can try again.
    """
    try:
        raw = osrm.fetch_steps(waypoints)
    except UpstreamError as exc:
        logger.warning("Directions skipped: %s", exc)
        return None
    try:
        stretches = directions.condense(raw, [leg.distance_miles for leg in route.legs])
    except Exception:
        # Directions are a nice-to-have. A bug in them must not take the plan down.
        logger.exception("The router's turn list couldn't be condensed.")
        return []
    if stretches is None:
        logger.warning("Directions skipped: the router's turn list was too thin or too odd to use.")
    return directions.to_payload(stretches)


def _add_directions(
    key: str, payload: dict[str, Any], route: RouteData, waypoints: Sequence[tuple[float, float]]
) -> RouteData:
    """Fetch the directions for a route that has none yet and keep them with it in the cache."""
    found = _fetch_directions(waypoints, route)
    if found is None:
        return route
    payload["directions"] = found
    if settings.ROUTE_CACHE_TTL_HOURS > 0:
        try:
            RouteCache.objects.filter(key=key).update(payload=payload)
        except DatabaseError:
            logger.warning("Couldn't store the directions in the cache.")
    return replace(route, directions=directions.from_payload(found))


def get_route(request: PlanRequestData) -> RouteData:
    """Route current to pickup to dropoff, from the cache when a recent answer exists.

    The route is fetched first and the turn list second, so the big call stays small and a
    failed turn list costs the plan nothing but its directions. Both live in one cache row.
    A row with no turn list yet (an older row, or a failed first try) gets a second chance.
    """
    waypoints = waypoints_of(request)
    caching = settings.ROUTE_CACHE_TTL_HOURS > 0
    key = route_cache_key(waypoints)

    cached = _read_cached_route(key) if caching else None
    if cached is None:
        payload = route_to_payload(osrm.fetch_route(waypoints))
        if caching:
            _store_route(key, payload)
        # Always read back through the same encoding so a cache hit and a miss give the
        # same numbers for the same trip.
        route = route_from_payload(payload)
    else:
        payload, route = cached

    total_miles = sum(leg.distance_miles for leg in route.legs)
    if total_miles > settings.MAX_ROUTE_MILES:
        raise RouteTooLongError(
            f"That route is {total_miles:,.0f} miles. The planner handles up to {settings.MAX_ROUTE_MILES:,} miles."
        )
    if "directions" not in payload:
        route = _add_directions(key, payload, route, waypoints)
    return route


def plan_trip(request: PlanRequestData) -> dict[str, Any]:
    route = get_route(request)
    try:
        return build_plan(request, route)
    except EngineError as exc:
        logger.warning("The engine refused a validated trip: %s", exc)
        raise PlanFailed from exc


def reverse_geocode(lat: float, lon: float) -> dict[str, Any]:
    """Name a point. Nominatim first, then the bundled town list, then bare coordinates."""
    label: str | None = None
    try:
        label = nominatim.reverse(lat, lon)
    except UpstreamError:
        logger.info("Nominatim unavailable, using the bundled town list.")
    return {
        "label": label or _offline_label(lat, lon),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
    }


def _offline_label(lat: float, lon: float) -> str:
    try:
        label = describe_place(lat, lon)
    except Exception:
        logger.exception("The town list failed for %s, %s.", lat, lon)
        label = ""
    return label or f"{lat:.4f}, {lon:.4f}"
