"""Builders for realistic OSRM, Photon and Nominatim responses."""

from __future__ import annotations

import math
import re
from typing import Any

import responses
from responses import matchers

DALLAS = (32.7767, -96.7970)
MEMPHIS = (35.1495, -90.0490)
DENVER = (39.7392, -104.9903)
DEFAULT_WAYPOINTS = (DALLAS, MEMPHIS, DENVER)

OSRM_ROUTE = re.compile(r"https://osrm\.test/route/v1/driving/.*")
PHOTON_SEARCH = re.compile(r"https://photon\.test/api/.*")
NOMINATIM_REVERSE = re.compile(r"https://nominatim\.test/reverse.*")

METERS_PER_MILE = 1609.344


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    (lat1, lon1), (lat2, lon2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _interpolate(a: tuple[float, float], b: tuple[float, float], steps: int) -> list[tuple[float, float]]:
    return [(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps) for i in range(steps + 1)]


def osrm_payload(
    waypoints: tuple[tuple[float, float], ...] = DEFAULT_WAYPOINTS,
    points_per_leg: int = 60,
    road_factor: float = 1.2,
    speed_mph: float = 55.0,
) -> dict[str, Any]:
    """A 3-waypoint OSRM answer. Geometry passes through every waypoint exactly."""
    first = _interpolate(waypoints[0], waypoints[1], points_per_leg)
    second = _interpolate(waypoints[1], waypoints[2], points_per_leg)
    line = first + second[1:]
    legs = []
    for a, b in zip(waypoints, waypoints[1:], strict=False):
        metres = haversine_m(a, b) * road_factor
        legs.append(
            {"distance": metres, "duration": metres / (speed_mph * METERS_PER_MILE / 3600), "summary": "", "steps": []}
        )
    return {
        "code": "Ok",
        "routes": [
            {
                "distance": sum(leg["distance"] for leg in legs),
                "duration": sum(leg["duration"] for leg in legs),
                "geometry": {"type": "LineString", "coordinates": [[lon, lat] for lat, lon in line]},
                "legs": legs,
            }
        ],
        "waypoints": [{"location": [lon, lat], "name": "", "distance": 3.2} for lat, lon in waypoints],
    }


def bearing_deg(a: tuple[float, float], b: tuple[float, float]) -> int:
    (lat1, lon1), (lat2, lon2) = a, b
    p1, p2, d_lon = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(d_lon) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(d_lon)
    return round(math.degrees(math.atan2(y, x))) % 360


def osrm_step(
    metres: float,
    name: str,
    ref: str | None,
    kind: str,
    at: tuple[float, float],
    bearing: int,
    modifier: str = "straight",
) -> dict[str, Any]:
    """One step as the public router sends it, with the parts the planner ignores left in."""
    step: dict[str, Any] = {
        "geometry": "}_ilFjkbvO",
        "maneuver": {
            "bearing_after": bearing,
            "bearing_before": bearing,
            "location": [at[1], at[0]],
            "modifier": modifier,
            "type": kind,
        },
        "mode": "driving",
        "driving_side": "right",
        "name": name,
        "intersections": [{"out": 0, "entry": [True], "bearings": [bearing], "location": [at[1], at[0]]}],
        "weight": metres / 20,
        "duration": metres / 20,
        "distance": metres,
    }
    if ref is not None:
        step["ref"] = ref
    return step


def _leg_steps(a: tuple[float, float], b: tuple[float, float], metres: float, roads: tuple[tuple[str, str], ...]):
    """A leg like a real one: two short streets, an unnamed ramp, a few highways, two streets and the arrival."""
    bearing = bearing_deg(a, b)

    def where(fraction: float) -> tuple[float, float]:
        return (a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction)

    ends = [("Elm Street", None, 320.0), ("", None, 640.0)]
    tail = [("Oak Street", None, 480.0), ("Main Street", None, 160.0)]
    body = metres - sum(m for *_, m in ends + tail)
    shares = (0.6, 0.25, 0.15)
    middle = [(name, ref, body * share) for (name, ref), share in zip(roads, shares, strict=False)]
    pieces = ends + middle + tail
    steps, done = [], 0.0
    for index, (name, ref, length) in enumerate(pieces):
        kind = "depart" if index == 0 else ("on ramp" if name == "" else "turn")
        if index >= 2 and index < 2 + len(roads):
            kind = "new name"
        steps.append(osrm_step(length, name, ref, kind, where(done / metres), bearing))
        done += length
    steps.append(osrm_step(0.0, "Main Street", None, "arrive", where(1.0), 0))
    return steps


ROADS = (("", "I 30"), ("Fort Worth Highway", "US 287;TX 183"), ("", "I 40"))


def osrm_steps_payload(
    waypoints: tuple[tuple[float, float], ...] = DEFAULT_WAYPOINTS, road_factor: float = 1.2
) -> dict[str, Any]:
    """The answer to the steps request for the same route: no geometry, steps on both legs."""
    legs = []
    for a, b in zip(waypoints, waypoints[1:], strict=False):
        metres = haversine_m(a, b) * road_factor
        legs.append(
            {
                "distance": metres,
                "duration": metres / 25,
                "weight": metres / 25,
                "summary": "I 30, I 40",
                "steps": _leg_steps(a, b, metres, ROADS),
            }
        )
    return {
        "code": "Ok",
        "routes": [
            {
                "weight_name": "routability",
                "weight": sum(leg["weight"] for leg in legs),
                "distance": sum(leg["distance"] for leg in legs),
                "duration": sum(leg["duration"] for leg in legs),
                "legs": legs,
            }
        ],
        "waypoints": [{"location": [lon, lat], "name": "", "distance": 3.2} for lat, lon in waypoints],
    }


def photon_payload(*features: dict[str, Any]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": list(features)}


def photon_feature(lat: float, lon: float, **props: Any) -> dict[str, Any]:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


CHICAGO = photon_feature(
    41.8755616,
    -87.6244212,
    name="Chicago",
    state="Illinois",
    country="United States",
    countrycode="US",
    osm_key="place",
    osm_value="city",
)


def _add(rsps: responses.RequestsMock, body: Any, status: int, **kwargs: Any):
    if isinstance(body, str | bytes | Exception):
        return rsps.add(responses.GET, OSRM_ROUTE, body=body, status=status, **kwargs)
    return rsps.add(responses.GET, OSRM_ROUTE, json=body, status=status, **kwargs)


def _asks_for_steps(wanted: str):
    return matchers.query_param_matcher({"steps": wanted}, strict_match=False)


def register_osrm(
    rsps: responses.RequestsMock,
    payload: Any = None,
    status: int = 200,
    *,
    steps: Any = None,
    steps_status: int = 200,
    steps_headers: dict[str, str] | None = None,
    **kwargs: Any,
):
    """Answer the route request and the steps request.

    With no `payload`, the route request gets a normal route and the steps request gets matching
    steps (or `steps`, answered with `steps_status`). With a `payload`, every OSRM request gets it.
    """
    if payload is not None:
        return _add(rsps, payload, status, **kwargs)
    route = _add(rsps, osrm_payload(), status, match=[_asks_for_steps("false")], **kwargs)
    answer = osrm_steps_payload() if steps is None else steps
    _add(rsps, answer, steps_status, match=[_asks_for_steps("true")], headers=steps_headers)
    return route


def route_calls(rsps: responses.RequestsMock) -> list[Any]:
    """The calls that asked for the geometry."""
    return [call for call in rsps.calls if call.request.params.get("steps") == "false"]


def steps_calls(rsps: responses.RequestsMock) -> list[Any]:
    """The calls that asked for the turn list."""
    return [call for call in rsps.calls if call.request.params.get("steps") == "true"]
