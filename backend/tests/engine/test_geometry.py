"""Distances, mile to coordinate, and polyline simplification."""

from __future__ import annotations

import math
import time

import pytest

from apps.planner.hos.geometry import (
    bounds,
    build_profile,
    haversine_miles,
    point_at_mile,
    simplify,
)
from apps.planner.hos.models import EngineError


def test_haversine_known_distances():
    assert haversine_miles(0, 0, 0, 0) == 0.0
    # Dallas to Memphis is about 420 miles in a straight line.
    assert haversine_miles(32.7767, -96.7970, 35.1495, -90.0490) == pytest.approx(420, abs=6)
    # One degree of latitude.
    assert haversine_miles(10, 20, 11, 20) == pytest.approx(69.09, abs=0.1)
    # Half the planet.
    assert haversine_miles(0, 0, 0, 180) == pytest.approx(math.pi * 3958.7613, rel=1e-6)


def test_haversine_is_symmetric_and_survives_rounding_at_antipodes():
    assert haversine_miles(40, -100, 41, -99) == haversine_miles(41, -99, 40, -100)
    assert math.isfinite(haversine_miles(90, 0, -90, 0))


def wiggly(n: int, lat0=35.0, lon0=-100.0):
    return [(lat0 + 0.01 * i, lon0 + 0.02 * i + 0.003 * math.sin(i)) for i in range(n)]


def test_profile_scales_each_leg_to_the_router_distance():
    coords = wiggly(21)
    profile = build_profile(coords, (10, 20), (123.4, 200.0))
    assert profile.miles[0] == 0.0
    assert profile.total_miles == pytest.approx(323.4)
    assert profile.miles[10] == pytest.approx(123.4)
    assert list(profile.miles) == sorted(profile.miles)
    assert profile.points[10] == coords[10]
    assert profile.points[-1] == coords[20]


def test_profile_handles_legs_with_a_single_point():
    coords = [(35.0, -100.0), (35.5, -100.5), (36.0, -101.0)]
    # Leg 1 has no geometry of its own (current and pickup are the same spot).
    profile = build_profile(coords, (0, 2), (0.0, 80.0))
    assert point_at_mile(profile, 0.0) == coords[0]
    assert point_at_mile(profile, 80.0) == coords[2]
    # Leg 1 says 5 miles but only has one point: the truck waits at that point.
    held = build_profile(coords, (0, 2), (5.0, 80.0))
    assert point_at_mile(held, 3.0) == coords[0]
    assert held.total_miles == pytest.approx(85.0)


def test_profile_spreads_miles_when_the_polyline_has_no_length():
    coords = [(35.0, -100.0)] * 4
    profile = build_profile(coords, (1, 3), (10.0, 20.0))
    assert profile.total_miles == pytest.approx(30.0)
    assert list(profile.miles) == sorted(profile.miles)


@pytest.mark.parametrize("indices", [(-1, 2), (3, 2), (0, 5), (4, 4)])
def test_profile_rejects_bad_indices(indices):
    with pytest.raises(EngineError):
        build_profile([(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)], indices, (1.0, 1.0))


def test_profile_needs_two_points():
    with pytest.raises(EngineError):
        build_profile([(0.0, 0.0)], (0, 0), (0.0, 0.0))


def test_point_at_mile_interpolates_and_clamps():
    coords = [(0.0, 0.0), (0.0, 1.0), (0.0, 3.0)]
    profile = build_profile(coords, (1, 2), (100.0, 200.0))
    assert point_at_mile(profile, -5) == (0.0, 0.0)
    assert point_at_mile(profile, 0) == (0.0, 0.0)
    assert point_at_mile(profile, 50) == pytest.approx((0.0, 0.5))
    assert point_at_mile(profile, 100) == (0.0, 1.0)
    assert point_at_mile(profile, 200) == pytest.approx((0.0, 2.0))
    assert point_at_mile(profile, 300) == (0.0, 3.0)
    assert point_at_mile(profile, 9999) == (0.0, 3.0)


def test_point_at_mile_is_monotone_along_a_straight_route():
    coords = [(30.0 + i * 0.1, -100.0) for i in range(50)]
    profile = build_profile(coords, (20, 49), (300.0, 400.0))
    lats = [point_at_mile(profile, m)[0] for m in range(0, 701, 7)]
    assert lats == sorted(lats)


def test_bounds():
    assert bounds([(1.0, 5.0), (3.0, -2.0), (2.0, 4.0)]) == ((1.0, -2.0), (3.0, 5.0))


# --- simplification ------------------------------------------------------------------------------


def test_short_routes_are_returned_untouched():
    coords = wiggly(100)
    points, indices = simplify(coords, (40, 99), max_points=1500)
    assert points == coords
    assert indices == (40, 99)


def distance_to_polyline(p, line) -> float:
    """Smallest distance from p to any segment of line, in degrees (flat approximation)."""
    best = math.inf
    for (ay, ax), (by, bx) in zip(line, line[1:], strict=False):
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        u = 0.0 if length_sq == 0 else max(0.0, min(1.0, ((p[1] - ax) * dx + (p[0] - ay) * dy) / length_sq))
        best = min(best, math.hypot(p[1] - (ax + u * dx), p[0] - (ay + u * dy)))
    return best


def test_simplify_respects_the_budget_and_keeps_the_leg_ends():
    n = 12_000
    coords = [(35 + 4 * math.sin(i / 900), -100 + i * 0.002) for i in range(n)]
    e1, e2 = 4_321, n - 1
    points, (i1, i2) = simplify(coords, (e1, e2), max_points=1500)
    assert len(points) <= 1500
    assert points[0] == coords[0]
    assert points[i1] == coords[e1]
    assert points[i2] == coords[e2]
    assert i2 == len(points) - 1
    assert 0 < i1 < i2


def test_simplify_keeps_the_shape():
    n = 6_000
    coords = [(35 + 3 * math.sin(i / 400), -100 + i * 0.003) for i in range(n)]
    points, _ = simplify(coords, (3_000, n - 1), max_points=300)
    worst = max(distance_to_polyline(p, points) for p in coords[::25])
    assert worst < 0.02  # degrees, about a mile


def test_simplify_drops_points_after_the_second_leg_end():
    coords = wiggly(3_000)
    points, (i1, i2) = simplify(coords, (1_000, 2_000), max_points=200)
    assert points[-1] == coords[2_000]
    assert i2 == len(points) - 1


def test_simplify_with_both_legs_ending_at_the_same_point():
    coords = wiggly(2_000)
    points, (i1, i2) = simplify(coords, (1_999, 1_999), max_points=100)
    assert i1 == i2 == len(points) - 1
    assert len(points) <= 100


def test_simplify_is_deterministic():
    coords = [(35 + math.sin(i / 50) * math.cos(i / 7), -100 + i * 0.001) for i in range(5_000)]
    assert simplify(coords, (2_000, 4_999), 250) == simplify(coords, (2_000, 4_999), 250)


def test_simplify_rejects_a_budget_too_small_to_hold_the_ends():
    with pytest.raises(EngineError):
        simplify(wiggly(10), (3, 9), max_points=2)


def test_simplify_a_realistic_cross_country_polyline_is_fast():
    n = 80_000
    coords = [(33 + 6 * math.sin(i / 9_000) + 0.0004 * math.sin(i / 3), -118 + i * 0.001) for i in range(n)]
    started = time.perf_counter()
    points, _ = simplify(coords, (n // 2, n - 1), max_points=1500)
    assert len(points) <= 1500
    assert time.perf_counter() - started < 5.0
