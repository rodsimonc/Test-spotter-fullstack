"""Route geometry: distances along the polyline, mile to coordinate, simplification."""

from __future__ import annotations

import heapq
import math
from bisect import bisect_right
from dataclasses import dataclass

from .models import EngineError

EARTH_RADIUS_MILES = 3958.7613

LatLon = tuple[float, float]


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(a)))


@dataclass(frozen=True)
class RouteProfile:
    """Polyline knots with route miles, scaled to match the router's leg distances."""

    miles: tuple[float, ...]
    points: tuple[LatLon, ...]

    @property
    def total_miles(self) -> float:
        return self.miles[-1]


def _check_indices(coordinates: list[LatLon], leg_end_indices: tuple[int, int]) -> tuple[int, int]:
    e1, e2 = leg_end_indices
    if len(coordinates) < 2:
        raise EngineError("The route needs at least two points.")
    if not (0 <= e1 <= e2 < len(coordinates)):
        raise EngineError("The route's leg end indices do not fit its geometry.")
    return e1, e2


def _leg_knots(points: list[LatLon], start_mile: float, leg_miles: float) -> list[tuple[float, LatLon]]:
    """Knots for one leg. The last knot lands exactly on start_mile + leg_miles."""
    raw = [0.0]
    for (la1, lo1), (la2, lo2) in zip(points, points[1:], strict=False):
        raw.append(raw[-1] + haversine_miles(la1, lo1, la2, lo2))
    n = len(points)
    if n == 1:
        # Router says the leg has length but the geometry has one point. Hold position.
        return [(start_mile, points[0]), (start_mile + leg_miles, points[0])]
    if raw[-1] > 0:
        scale = leg_miles / raw[-1]
        knots = [(start_mile + d * scale, p) for d, p in zip(raw, points, strict=True)]
    else:
        knots = [(start_mile + leg_miles * i / (n - 1), p) for i, p in enumerate(points)]
    knots[-1] = (start_mile + leg_miles, points[-1])
    return knots


def build_profile(
    coordinates: list[LatLon],
    leg_end_indices: tuple[int, int],
    leg_miles: tuple[float, float],
) -> RouteProfile:
    """Cumulative miles along the polyline, scaled so each leg matches the router's distance.

    The polyline is only an approximation of the road the router measured. Scaling each leg
    keeps stop positions consistent with the miles the schedule uses.
    """
    e1, e2 = _check_indices(coordinates, leg_end_indices)
    first = _leg_knots(coordinates[: e1 + 1], 0.0, leg_miles[0])
    second = _leg_knots(coordinates[e1 : e2 + 1], leg_miles[0], leg_miles[1])
    knots = first + second[1:]
    return RouteProfile(tuple(m for m, _ in knots), tuple(p for _, p in knots))


def point_at_mile(profile: RouteProfile, mile: float) -> LatLon:
    """Coordinate `mile` miles along the route, clamped to the ends."""
    miles = profile.miles
    if mile <= miles[0]:
        return profile.points[0]
    if mile >= miles[-1]:
        return profile.points[-1]
    hi = bisect_right(miles, mile)
    lo = hi - 1
    span = miles[hi] - miles[lo]
    if span <= 0:
        return profile.points[hi]
    f = (mile - miles[lo]) / span
    (la1, lo1), (la2, lo2) = profile.points[lo], profile.points[hi]
    return (la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f)


def bounds(coordinates: list[LatLon]) -> tuple[LatLon, LatLon]:
    """[[south, west], [north, east]]"""
    lats = [p[0] for p in coordinates]
    lons = [p[1] for p in coordinates]
    return (min(lats), min(lons)), (max(lats), max(lons))


def _segment_distance_sq(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0.0:
        return (px - ax) ** 2 + (py - ay) ** 2
    u = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    cx, cy = ax + u * dx, ay + u * dy
    return (px - cx) ** 2 + (py - cy) ** 2


def simplify(
    coordinates: list[LatLon],
    leg_end_indices: tuple[int, int],
    max_points: int = 1500,
) -> tuple[list[LatLon], tuple[int, int]]:
    """Douglas-Peucker down to at most `max_points`, keeping both leg ends.

    Instead of picking a tolerance, this keeps the point that sticks out furthest from the
    current simplification, one at a time, until the budget is spent. That gives the
    best shape for the budget and needs no tuning. Points after the second leg end are
    dropped. Returns the new points and the new leg end indices.
    """
    e1, e2 = _check_indices(coordinates, leg_end_indices)
    points = coordinates[: e2 + 1]
    if max_points < 3:
        raise EngineError("Simplification needs room for at least three points.")
    if len(points) <= max_points:
        return list(points), (e1, e2)

    # Flat projection scaled by latitude. Only the ranking of distances matters here.
    mean_lat = sum(p[0] for p in points) / len(points)
    kx = math.cos(math.radians(mean_lat))
    xs = [p[1] * kx for p in points]
    ys = [p[0] for p in points]

    def furthest(lo: int, hi: int) -> tuple[float, int]:
        ax, ay, bx, by = xs[lo], ys[lo], xs[hi], ys[hi]
        best, best_i = -1.0, lo
        for i in range(lo + 1, hi):
            d = _segment_distance_sq(xs[i], ys[i], ax, ay, bx, by)
            if d > best:
                best, best_i = d, i
        return best, best_i

    keep = {0, e1, e2}
    heap: list[tuple[float, int, int, int]] = []

    def push(lo: int, hi: int) -> None:
        if hi - lo >= 2:
            d, i = furthest(lo, hi)
            heapq.heappush(heap, (-d, lo, hi, i))

    push(0, e1)
    push(e1, e2)
    while heap and len(keep) < max_points:
        _, lo, hi, i = heapq.heappop(heap)
        keep.add(i)
        push(lo, i)
        push(i, hi)

    kept = sorted(keep)
    new_points = [points[i] for i in kept]
    return new_points, (kept.index(e1), kept.index(e2))
