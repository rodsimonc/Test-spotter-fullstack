from __future__ import annotations

import random

import pytest

from apps.planner import polyline


def test_matches_googles_documented_example():
    points = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    assert polyline.encode(points) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    assert polyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == points


def test_empty_round_trip():
    assert polyline.encode([]) == ""
    assert polyline.decode("") == []


def test_round_trip_error_is_under_a_metre_everywhere_on_earth():
    rng = random.Random(7)
    points = [(rng.uniform(-90, 90), rng.uniform(-180, 180)) for _ in range(2000)]
    for (lat, lon), (lat2, lon2) in zip(points, polyline.decode(polyline.encode(points)), strict=True):
        assert abs(lat - lat2) <= 0.5e-5 + 1e-9
        assert abs(lon - lon2) <= 0.5e-5 + 1e-9


@pytest.mark.parametrize("point", [(0.0, 0.0), (-0.00001, 0.00001), (90.0, 180.0), (-90.0, -180.0)])
def test_edge_points(point):
    assert polyline.decode(polyline.encode([point])) == [point]


def test_is_much_smaller_than_json_for_a_long_route():
    points = [(35.0 + i * 0.0003, -97.0 + i * 0.0004) for i in range(30000)]
    import json

    assert len(polyline.encode(points)) < len(json.dumps(points)) / 3


def test_truncated_input_raises():
    with pytest.raises(ValueError, match="Truncated"):
        polyline.decode("_p~iF~ps|U_ulL")
