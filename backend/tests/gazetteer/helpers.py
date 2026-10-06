"""A slow, plain reference for the gazetteer tests.

It reads places.csv.gz on its own and finds the nearest town by checking every row, so the
grid search in the app has something honest to be compared with.
"""

from __future__ import annotations

import csv
import gzip
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parents[2] / "apps" / "planner" / "gazetteer" / "places.csv.gz"
EARTH_RADIUS_MILES = 3958.7613
MAX_RADIUS_MILES = 150.0


@dataclass(frozen=True)
class Town:
    name: str
    region: str
    country: str
    lat: float
    lon: float
    population: int


@lru_cache(maxsize=1)
def towns() -> tuple[Town, ...]:
    with gzip.open(DATA_FILE, "rt", encoding="utf-8", newline="") as handle:
        return tuple(
            Town(r["name"], r["region"], r["country"], float(r["lat"]), float(r["lon"]), int(r["population"]))
            for r in csv.DictReader(handle)
        )


def find_town(name: str, region: str) -> Town:
    matches = [t for t in towns() if t.name == name and t.region == region]
    assert len(matches) == 1, f"expected one {name}, {region} in the data, found {len(matches)}"
    return matches[0]


def distance_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle miles, written with atan2 so it shares no code path with the app's version."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def nearest_by_brute_force(lat: float, lon: float, limit: float = MAX_RADIUS_MILES) -> tuple[Town, float] | None:
    """The closest town within `limit` miles, or None."""
    # A degree of latitude is about 69 miles, so towns more than limit / 60 degrees away in
    # latitude cannot be close enough. This skips most rows without changing the answer.
    window = limit / 60.0
    best: tuple[Town, float] | None = None
    for town in towns():
        if abs(town.lat - lat) > window:
            continue
        d = distance_miles(lat, lon, town.lat, town.lon)
        if best is None or d < best[1]:
            best = (town, d)
    if best is None or best[1] > limit:
        return None
    return best


def destination(lat: float, lon: float, miles: float, bearing_degrees: float) -> tuple[float, float]:
    """The point `miles` away from (lat, lon) along an initial compass bearing."""
    angle = miles / EARTH_RADIUS_MILES
    bearing = math.radians(bearing_degrees)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(angle) + math.cos(p1) * math.sin(angle) * math.cos(bearing))
    l2 = l1 + math.atan2(
        math.sin(bearing) * math.sin(angle) * math.cos(p1), math.cos(angle) - math.sin(p1) * math.sin(p2)
    )
    return math.degrees(p2), math.degrees(l2)
