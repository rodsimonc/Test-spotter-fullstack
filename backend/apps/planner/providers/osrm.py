"""OSRM driving routes: one request per trip, three waypoints, two legs."""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from django.conf import settings

from apps.common.errors import NoRouteError, UpstreamError
from apps.planner.types import RawStep, RouteData, RouteLeg

from . import http

METERS_PER_MILE = 1609.344
SERVICE = "routing service"

#: (lat, lon)
Waypoint = tuple[float, float]

_NO_ROUTE_MESSAGES = {
    "NoRoute": "No driving route connects those places. Try a different pickup or dropoff.",
    "NoSegment": "One of those places is too far from a road to route from. Pick a spot nearer one.",
}


def route_url(waypoints: Sequence[Waypoint]) -> str:
    """Build the request path from numbers only. Nothing the caller typed reaches it as text."""
    joined = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in waypoints)
    return f"{settings.OSRM_BASE_URL}/route/v1/driving/{joined}"


def fetch_route(waypoints: Sequence[Waypoint]) -> RouteData:
    reply = http.get_json(
        route_url(waypoints),
        service=SERVICE,
        params={"overview": "full", "geometries": "geojson", "steps": "false"},
        max_bytes=http.OSRM_MAX_BYTES,
    )
    # OSRM reports "no route" and similar problems as HTTP 400 with a JSON body.
    if reply.status == 429:
        raise UpstreamError("The routing service is busy. Try again in a moment.")
    if reply.status not in (200, 400):
        raise UpstreamError("The routing service turned the request down.")
    return parse_route(reply.data)


def parse_route(payload: Any) -> RouteData:
    """Turn an OSRM route response into `RouteData`, or raise `NoRouteError` or `UpstreamError`."""
    if not isinstance(payload, dict):
        raise _unreadable()
    code = payload.get("code")
    if code in _NO_ROUTE_MESSAGES:
        raise NoRouteError(_NO_ROUTE_MESSAGES[code])
    if code != "Ok":
        raise UpstreamError("The routing service couldn't plan that route.")

    routes = payload.get("routes")
    if not isinstance(routes, list) or not routes or not isinstance(routes[0], dict):
        raise _unreadable()
    route = routes[0]

    coordinates = _read_geometry(route.get("geometry"))
    legs = _read_legs(route.get("legs"))
    first_end = _leg_end_index(coordinates, _read_waypoint_location(payload, 1), start=0)
    return RouteData(
        coordinates=coordinates,
        leg_end_indices=(first_end, len(coordinates) - 1),
        legs=(legs[0], legs[1]),
    )


def fetch_steps(waypoints: Sequence[Waypoint]) -> tuple[tuple[RawStep, ...], tuple[RawStep, ...]]:
    """Ask for the turn list of the same route, one tuple of steps per leg.

    A second request, so the geometry call stays small. It is best effort: it never retries, it
    gets a shorter read timeout, and the caller treats `UpstreamError` as "no directions".
    """
    reply = http.get_json(
        route_url(waypoints),
        service=SERVICE,
        params={"overview": "false", "steps": "true", "geometries": "polyline", "annotations": "false"},
        max_bytes=http.OSRM_STEPS_MAX_BYTES,
        timeout=(http.CONNECT_TIMEOUT_SECONDS, http.STEPS_READ_TIMEOUT_SECONDS),
        retries=0,
    )
    if reply.status != 200:
        raise UpstreamError("The routing service didn't give a turn list.")
    return parse_steps(reply.data)


def parse_steps(payload: Any) -> tuple[tuple[RawStep, ...], tuple[RawStep, ...]]:
    """Read the steps of both legs. A step that can't be read is skipped, a reply that can't be read raises."""
    if not isinstance(payload, dict) or payload.get("code") != "Ok":
        raise UpstreamError("The routing service sent a turn list we couldn't use.")
    routes = payload.get("routes")
    legs = routes[0].get("legs") if isinstance(routes, list) and routes and isinstance(routes[0], dict) else None
    if not isinstance(legs, list) or len(legs) != 2 or not all(isinstance(leg, dict) for leg in legs):
        raise _unreadable()
    first, second = (_read_steps(leg.get("steps")) for leg in legs)
    return first, second


def _read_steps(raw: Any) -> tuple[RawStep, ...]:
    if not isinstance(raw, list):
        return ()
    steps = (_read_step(item) for item in raw)
    return tuple(step for step in steps if step is not None)


def _read_step(raw: Any) -> RawStep | None:
    if not isinstance(raw, dict):
        return None
    metres = raw.get("distance")
    if not _is_number(metres) or metres < 0:
        return None
    maneuver = raw.get("maneuver")
    if not isinstance(maneuver, dict):
        maneuver = {}
    lat, lon = _read_location(maneuver.get("location"))
    bearing = maneuver.get("bearing_after")
    return RawStep(
        distance_miles=metres / METERS_PER_MILE,
        name=_text(raw.get("name")),
        ref=_text(raw.get("ref")),
        maneuver=_text(maneuver.get("type")),
        lat=lat,
        lon=lon,
        bearing_after=float(bearing) if _is_number(bearing) else None,
    )


def _read_location(location: Any) -> tuple[float | None, float | None]:
    if not isinstance(location, list | tuple) or len(location) < 2:
        return None, None
    lon, lat = location[0], location[1]
    if not (_is_number(lon) and _is_number(lat)) or abs(lat) > 90 or abs(lon) > 180:
        return None, None
    return float(lat), float(lon)


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _unreadable() -> UpstreamError:
    return UpstreamError("The routing service sent a route we couldn't read.")


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _read_geometry(geometry: Any) -> list[tuple[float, float]]:
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        raise _unreadable()
    raw = geometry.get("coordinates")
    if not isinstance(raw, list) or not raw:
        raise _unreadable()
    points: list[tuple[float, float]] = []
    for pair in raw:
        if not isinstance(pair, list | tuple) or len(pair) < 2:
            raise _unreadable()
        lon, lat = pair[0], pair[1]
        if not (_is_number(lon) and _is_number(lat)) or abs(lat) > 90 or abs(lon) > 180:
            raise _unreadable()
        points.append((float(lat), float(lon)))
    if len(points) == 1:
        # Places a few metres apart can come back as one point. A zero-length route is valid.
        points.append(points[0])
    return points


def _read_legs(raw: Any) -> list[RouteLeg]:
    if not isinstance(raw, list) or len(raw) != 2:
        raise _unreadable()
    legs = []
    for leg in raw:
        if not isinstance(leg, dict):
            raise _unreadable()
        metres, seconds = leg.get("distance"), leg.get("duration")
        if not (_is_number(metres) and _is_number(seconds)) or metres < 0 or seconds < 0:
            raise _unreadable()
        legs.append(RouteLeg(distance_miles=metres / METERS_PER_MILE, osrm_duration_minutes=seconds / 60.0))
    return legs


def _read_waypoint_location(payload: dict, index: int) -> tuple[float, float]:
    """Return the snapped (lat, lon) OSRM chose for waypoint `index`."""
    waypoints = payload.get("waypoints")
    if not isinstance(waypoints, list) or len(waypoints) <= index:
        raise _unreadable()
    location = waypoints[index].get("location") if isinstance(waypoints[index], dict) else None
    if (
        not isinstance(location, list | tuple)
        or len(location) < 2
        or not (_is_number(location[0]) and _is_number(location[1]))
    ):
        raise _unreadable()
    return float(location[1]), float(location[0])


def _leg_end_index(coordinates: Sequence[tuple[float, float]], target: tuple[float, float], start: int) -> int:
    """Index of the geometry point nearest `target`, searching forward from `start`.

    OSRM puts each snapped waypoint on the line, so the nearest point is an exact match. Searching
    forward keeps a route that crosses its own path from matching an earlier visit.
    """
    lat, lon = target
    lon_scale = math.cos(math.radians(lat))
    best_index, best_gap = start, math.inf
    for index in range(start, len(coordinates)):
        d_lat = coordinates[index][0] - lat
        d_lon = (coordinates[index][1] - lon) * lon_scale
        gap = d_lat * d_lat + d_lon * d_lon
        if gap < best_gap:
            best_index, best_gap = index, gap
    return best_index
