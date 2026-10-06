"""Nearest-town lookup for log remarks and stop labels.

The town list is the GeoNames cities5000 dump for the US, Canada and Mexico, bundled as
places.csv.gz (see GEONAMES_ATTRIBUTION.md). It loads once, on first use, into a grid of
one-degree cells. A lookup checks the cell it falls in, then rings of cells around it,
until no closer town can exist. Nothing here touches the network.
"""

from __future__ import annotations

import csv
import gzip
import math
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

DATA_FILE = Path(__file__).with_name("places.csv.gz")

#: A stop this close to a town is just "Town, ST".
NEAR_MILES = 3.0
#: Past this distance the lookup gives up and the caller falls back to coordinates.
MAX_RADIUS_MILES = 150.0

_CELL_DEGREES = 1.0
_MILES_PER_DEGREE_LAT = 68.7
_EARTH_RADIUS_MILES = 3958.7613
# Bounding box of the data plus the search radius on every side (St. John's, at 52.7 W, is
# the easternmost town and 150 miles east of it is about 49.5 W). Skips the rest of the world.
_LAT_RANGE = (12.0, 75.0)
_LON_RANGE = (-180.0, -45.0)
_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


@dataclass(frozen=True)
class NearestPlace:
    name: str
    region: str
    country: str
    lat: float
    lon: float
    population: int
    distance_miles: float
    #: Compass point of the searched coordinate as seen from the town, for example "SW".
    direction: str


class _Town(NamedTuple):
    name: str
    region: str
    country: str
    lat: float
    lon: float
    population: int


_Grid = dict[tuple[int, int], list[_Town]]
_grid: _Grid | None = None
_grid_lock = threading.Lock()


def _load_grid() -> _Grid:
    global _grid
    if _grid is not None:
        return _grid
    with _grid_lock:
        if _grid is None:
            grid: _Grid = {}
            with gzip.open(DATA_FILE, "rt", encoding="utf-8", newline="") as handle:
                for row in csv.DictReader(handle):
                    town = _Town(
                        row["name"],
                        row["region"],
                        row["country"],
                        float(row["lat"]),
                        float(row["lon"]),
                        int(row["population"]),
                    )
                    grid.setdefault(_cell(town.lat, town.lon), []).append(town)
            _grid = grid
    return _grid


def _cell(lat: float, lon: float) -> tuple[int, int]:
    return math.floor(lat / _CELL_DEGREES), math.floor(lon / _CELL_DEGREES)


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * _EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(a)))


def _compass(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> str:
    p1, p2 = math.radians(from_lat), math.radians(to_lat)
    dlon = math.radians(to_lon - from_lon)
    y = math.sin(dlon) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlon)
    bearing = math.degrees(math.atan2(y, x)) % 360.0
    return _COMPASS[int((bearing + 22.5) // 45) % 8]


def _ring(ci: int, cj: int, r: int):
    """Cells at Chebyshev distance `r` from (ci, cj)."""
    if r == 0:
        yield (ci, cj)
        return
    for j in range(cj - r, cj + r + 1):
        yield (ci - r, j)
        yield (ci + r, j)
    for i in range(ci - r + 1, ci + r):
        yield (i, cj - r)
        yield (i, cj + r)


def nearest_place(lat: float, lon: float) -> NearestPlace | None:
    """Closest listed town within 150 miles, or None."""
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return None
    if not (_LAT_RANGE[0] <= lat <= _LAT_RANGE[1] and _LON_RANGE[0] <= lon <= _LON_RANGE[1]):
        return None
    grid = _load_grid()
    ci, cj = _cell(lat, lon)
    # Narrowest a cell gets, in miles, anywhere inside the search radius. It bounds how far
    # away a ring of cells is, so the search can stop as soon as the best town beats it.
    far_lat = min(abs(lat) + MAX_RADIUS_MILES / _MILES_PER_DEGREE_LAT + _CELL_DEGREES, 89.0)
    cell_miles = _MILES_PER_DEGREE_LAT * _CELL_DEGREES * min(1.0, math.cos(math.radians(far_lat)))

    best: _Town | None = None
    best_miles = math.inf
    r = 0
    while True:
        for cell in _ring(ci, cj, r):
            for town in grid.get(cell, ()):
                d = _haversine_miles(lat, lon, town.lat, town.lon)
                if d < best_miles:
                    best, best_miles = town, d
        # Anything in ring r + 1 or beyond is at least r cells away.
        if best is not None and r * cell_miles >= best_miles:
            break
        if r * cell_miles > MAX_RADIUS_MILES:
            break
        r += 1
    if best is None or best_miles > MAX_RADIUS_MILES:
        return None
    return NearestPlace(
        best.name,
        best.region,
        best.country,
        best.lat,
        best.lon,
        best.population,
        best_miles,
        _compass(best.lat, best.lon, lat, lon),
    )


def describe_place(lat: float, lon: float) -> str:
    """ "Kearney, NE" near a town, "12 mi SW of Kearney, NE" further out, else "40.12, -83.45"."""
    place = nearest_place(lat, lon)
    if place is None:
        return f"{lat:.2f}, {lon:.2f}"
    label = f"{place.name}, {place.region}"
    if place.distance_miles <= NEAR_MILES:
        return label
    return f"{round(place.distance_miles)} mi {place.direction} of {label}"


def place_count() -> int:
    """How many towns are loaded. Useful for sanity checks."""
    return sum(len(towns) for towns in _load_grid().values())
