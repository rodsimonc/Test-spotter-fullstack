"""Builders for realistic OSRM, Photon and Nominatim responses."""

from __future__ import annotations

import math
import re
from typing import Any

import responses

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


def register_osrm(rsps: responses.RequestsMock, payload: Any = None, status: int = 200, **kwargs: Any):
    body = osrm_payload() if payload is None else payload
    if isinstance(body, str | bytes):
        return rsps.add(responses.GET, OSRM_ROUTE, body=body, status=status, **kwargs)
    return rsps.add(responses.GET, OSRM_ROUTE, json=body, status=status, **kwargs)
