"""Nearest-town lookup: wording, directions, the 150-mile cap, edges of the grid and speed."""

from __future__ import annotations

import gzip
import math
import random
import threading
import time
from itertools import product

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from apps.planner import gazetteer
from apps.planner.gazetteer import MAX_RADIUS_MILES, NEAR_MILES, describe_place, nearest_place

from .helpers import destination, find_town, nearest_by_brute_force, towns

KEARNEY = find_town("Kearney", "NE")
WHITEHORSE = find_town("Whitehorse", "YT")  # nothing else within 150 miles, so offsets stay unambiguous


# --- known towns ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("lat", "lon", "expected"),
    [
        # The coordinates the example trip uses.
        (32.7767, -96.7970, "Dallas, TX"),
        (35.1495, -90.0490, "Memphis, TN"),
        (39.7392, -104.9903, "Denver, CO"),
        # Kearney, Nebraska, on the route between them.
        (40.7, -99.08, "Kearney, NE"),
        (40.5, -99.3, "6 mi NE of Holdrege, NE"),
        # Canada.
        (43.7, -79.4, "Toronto, ON"),
        (51.0447, -114.0719, "Calgary, AB"),
        (49.8951, -97.1384, "Winnipeg, MB"),
        (49.2827, -123.1207, "Vancouver, BC"),
        # Mexico. Regions are the ISO 3166-2 codes, so Nuevo Leon reads NLE.
        (25.6866, -100.3161, "Monterrey, NLE"),
        (20.6597, -103.3496, "Guadalajara, JAL"),
        (32.5149, -117.0382, "Tijuana, BCN"),
        (19.4326, -99.1332, "Mexico City, CMX"),
        # Alaska and Hawaii are in the data too.
        (64.8, -147.7, "Fairbanks, AK"),
    ],
)
def test_known_places(lat, lon, expected):
    assert describe_place(lat, lon) == expected


def test_nearest_place_reports_the_town_and_where_the_point_sits():
    lat, lon = destination(KEARNEY.lat, KEARNEY.lon, 8.0, 90.0)
    place = nearest_place(lat, lon)
    assert place is not None
    assert (place.name, place.region, place.country) == ("Kearney", "NE", "US")
    assert (place.lat, place.lon, place.population) == (KEARNEY.lat, KEARNEY.lon, KEARNEY.population)
    assert place.distance_miles == pytest.approx(8.0, abs=0.01)
    assert place.direction == "E"


def test_a_town_is_found_in_each_country():
    countries = {nearest_place(*point).country for point in [(32.78, -96.8), (43.7, -79.4), (25.68, -100.32)]}
    assert countries == {"US", "CA", "MX"}


# --- wording -------------------------------------------------------------------------------------


def test_threshold_is_three_miles():
    assert NEAR_MILES == 3.0


def test_inside_three_miles_the_remark_is_just_the_town():
    assert describe_place(*destination(KEARNEY.lat, KEARNEY.lon, 2.999, 90.0)) == "Kearney, NE"
    assert describe_place(*destination(KEARNEY.lat, KEARNEY.lon, 0.0, 0.0)) == "Kearney, NE"


def test_past_three_miles_the_remark_gives_distance_and_direction():
    assert describe_place(*destination(KEARNEY.lat, KEARNEY.lon, 3.001, 90.0)) == "3 mi E of Kearney, NE"
    assert describe_place(*destination(KEARNEY.lat, KEARNEY.lon, 12.0, 315.0)) == "12 mi NW of Kearney, NE"


def test_distance_is_rounded_to_the_nearest_mile():
    assert describe_place(*destination(KEARNEY.lat, KEARNEY.lon, 12.4, 0.0)) == "12 mi N of Kearney, NE"
    assert describe_place(*destination(KEARNEY.lat, KEARNEY.lon, 12.6, 0.0)) == "13 mi N of Kearney, NE"


@pytest.mark.parametrize(
    ("bearing", "word"),
    [
        (0, "N"),
        (20, "N"),
        (25, "NE"),
        (45, "NE"),
        (65, "NE"),
        (70, "E"),
        (90, "E"),
        (135, "SE"),
        (180, "S"),
        (225, "SW"),
        (270, "W"),
        (315, "NW"),
        (335, "NW"),
        (340, "N"),
        (350, "N"),
    ],
)
def test_direction_is_where_the_point_sits_as_seen_from_the_town(bearing, word):
    point = destination(WHITEHORSE.lat, WHITEHORSE.lon, 8.0, bearing)
    assert describe_place(*point) == f"8 mi {word} of Whitehorse, YT"


# --- outside the data ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("lat", "lon", "expected"),
    [
        (48.8566, 2.3522, "48.86, 2.35"),  # Paris
        (-33.8688, 151.2093, "-33.87, 151.21"),  # Sydney
        (30.0, -40.0, "30.00, -40.00"),  # mid-Atlantic
        (70.0, -100.0, "70.00, -100.00"),  # Arctic tundra, inside the box but no town for 150 miles
        (0.0, 0.0, "0.00, 0.00"),
        (90.0, 0.0, "90.00, 0.00"),
    ],
)
def test_outside_coverage_falls_back_to_coordinates(lat, lon, expected):
    assert nearest_place(lat, lon) is None
    assert describe_place(lat, lon) == expected


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_non_finite_input_finds_nothing_and_does_not_raise(bad):
    assert nearest_place(bad, -99.0) is None
    assert nearest_place(40.0, bad) is None
    assert isinstance(describe_place(bad, bad), str)


# --- the 150-mile cap ----------------------------------------------------------------------------


def test_search_radius_is_150_miles():
    assert MAX_RADIUS_MILES == 150.0


def test_a_town_149_miles_away_is_used_and_one_at_151_is_not():
    near = destination(WHITEHORSE.lat, WHITEHORSE.lon, 149.0, 0.0)
    far = destination(WHITEHORSE.lat, WHITEHORSE.lon, 151.0, 0.0)
    # The setup holds only if nothing else is closer, so check it against the plain search.
    assert nearest_by_brute_force(*far, limit=1000)[0].name == "Whitehorse"
    assert describe_place(*near) == "149 mi N of Whitehorse, YT"
    assert nearest_place(*far) is None
    assert describe_place(*far) == f"{far[0]:.2f}, {far[1]:.2f}"


# --- the grid ------------------------------------------------------------------------------------


@settings(max_examples=120, deadline=None)
@given(lat=st.floats(14.0, 72.0), lon=st.floats(-170.0, -52.0))
def test_grid_search_agrees_with_checking_every_town_anywhere(lat, lon):
    assert_same_as_brute_force(lat, lon)


@settings(max_examples=200, deadline=None)
@given(
    town=st.sampled_from(towns()),
    d_lat=st.floats(-3.0, 3.0),
    d_lon=st.floats(-4.0, 4.0),
)
def test_grid_search_agrees_with_checking_every_town_near_towns(town, d_lat, d_lon):
    # Uniform points mostly land in empty country. Points near towns also cross cell borders.
    assert_same_as_brute_force(town.lat + d_lat, town.lon + d_lon)


def test_points_on_and_beside_grid_lines_agree_with_checking_every_town():
    nudges = (-1e-9, 0.0, 1e-9)
    disagreements = []
    for lat, lon in product(
        (25.0, 30.0, 35.0, 40.0, 45.0, 50.0, 55.0, 60.0), (-120.0, -110.0, -100.0, -90.0, -80.0, -70.0)
    ):
        for d_lat, d_lon in product(nudges, nudges):
            try:
                assert_same_as_brute_force(lat + d_lat, lon + d_lon)
            except AssertionError as exc:
                disagreements.append(f"({lat + d_lat}, {lon + d_lon}): {exc}")
    assert disagreements == []


def assert_same_as_brute_force(lat: float, lon: float) -> None:
    want = nearest_by_brute_force(lat, lon, limit=300.0)
    got = nearest_place(lat, lon)
    if want is None or want[1] > MAX_RADIUS_MILES + 1e-6:
        assert got is None, f"found {got} but nothing is within 150 miles"
    elif want[1] < MAX_RADIUS_MILES - 1e-6:
        assert got is not None, f"missed {want[0]} at {want[1]:.3f} miles"
        assert (got.name, got.region) == (want[0].name, want[0].region)
        assert got.distance_miles == pytest.approx(want[1], abs=1e-6)
    # Within a hair of 150 miles either answer is fair, so nothing is asserted.


def test_a_closer_town_in_the_next_cell_beats_the_first_one_found(install_towns):
    install_towns(
        [
            ("Same Cell", "XX", "US", 40.10, -100.90, 6000),  # cell (40, -101), where the query sits
            ("Next Cell", "XX", "US", 41.02, -99.98, 6000),  # cell (41, -100), 3 miles from the query
        ]
    )
    place = nearest_place(40.98, -100.02)
    assert place is not None
    assert place.name == "Next Cell"
    assert place.distance_miles < 5


def test_the_search_reaches_several_cells_out_but_stops_at_the_cap(install_towns):
    install_towns([("Far North", "XX", "US", 42.4, -100.5, 6000)])  # 1.9 degrees, about 131 miles
    assert describe_place(40.5, -100.5).endswith("of Far North, XX")
    install_towns([("Too Far", "XX", "US", 42.8, -100.5, 6000)])  # 2.3 degrees, about 159 miles
    assert describe_place(40.5, -100.5) == "40.50, -100.50"


def test_the_search_still_ends_at_high_latitudes_where_cells_are_narrow(install_towns):
    install_towns([("Far East", "XX", "CA", 70.0, -100.0, 6000)])
    # One degree of longitude is about 24 miles at 70 degrees north, so 150 miles is six cells.
    inside = destination(70.0, -100.0, 140.0, 90.0)
    outside = destination(70.0, -100.0, 160.0, 90.0)
    assert describe_place(*inside) == "140 mi E of Far East, XX"
    assert describe_place(*outside) == f"{outside[0]:.2f}, {outside[1]:.2f}"


@pytest.mark.parametrize(
    ("lat", "lon"),
    [
        (75.0, -100.0),
        (75.01, -100.0),
        (11.99, -90.0),
        (12.0, -90.0),
        (40.0, -45.0),
        (40.0, -44.99),
        (40.0, 0.0),
        (89.9, -100.0),
    ],
)
def test_the_edges_of_the_coverage_box_are_safe(lat, lon):
    assert describe_place(lat, lon) == f"{lat:.2f}, {lon:.2f}"


def test_the_box_leaves_room_for_the_search_radius_east_of_newfoundland():
    st_johns = find_town("St. John's", "NL")
    assert describe_place(*destination(st_johns.lat, st_johns.lon, 149.0, 90.0)) == "149 mi E of St. John's, NL"


def test_the_antimeridian_is_the_end_of_the_map_and_nothing_wraps(install_towns):
    install_towns([("Edge", "AK", "US", 52.0, -179.95, 6000)])
    # -180 is inside the box and finds the town 2 miles away.
    assert describe_place(52.0, -180.0) == "Edge, AK"
    # +180 is the same meridian but sits outside it. No listed town is west of the line (the
    # Aleutian towns in GeoNames are all east of it), so wrapping would add nothing.
    assert describe_place(52.0, 180.0) == "52.00, 180.00"
    assert describe_place(52.0, 179.9) == "52.00, 179.90"


def test_the_real_data_has_nothing_near_the_antimeridian():
    assert describe_place(52.0, -179.9) == "52.00, -179.90"
    assert describe_place(52.0, 179.9) == "52.00, 179.90"


# --- speed and loading ---------------------------------------------------------------------------


def test_first_lookup_loads_the_data_in_under_a_second(fresh_grid):
    assert gazetteer._grid is None
    started = time.perf_counter()
    assert describe_place(40.7, -99.08) == "Kearney, NE"
    assert time.perf_counter() - started < 1.0
    assert gazetteer._grid is not None


def test_warm_lookups_take_a_few_milliseconds_at_most():
    describe_place(40.7, -99.08)
    rng = random.Random(7)
    points = [(rng.uniform(26.0, 49.0), rng.uniform(-122.0, -70.0)) for _ in range(500)]
    started = time.perf_counter()
    for point in points:
        describe_place(*point)
    average = (time.perf_counter() - started) / len(points)
    assert average < 0.003


def test_the_emptiest_corner_of_the_box_is_still_quick():
    describe_place(40.7, -99.08)
    started = time.perf_counter()
    assert describe_place(74.9, -100.0) == "74.90, -100.00"
    assert time.perf_counter() - started < 0.05


def test_threads_that_arrive_together_read_the_file_once(fresh_grid, monkeypatch):
    opened = []
    real_open = gzip.open

    def counting_open(*args, **kwargs):
        opened.append(args[0])
        return real_open(*args, **kwargs)

    monkeypatch.setattr(gazetteer.gzip, "open", counting_open)
    results: list[str] = []
    gate = threading.Barrier(6)

    def worker():
        gate.wait()
        results.append(describe_place(40.7, -99.08))

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    describe_place(32.78, -96.8)
    assert results == ["Kearney, NE"] * 6
    assert len(opened) == 1


def test_the_count_matches_the_data_file():
    assert gazetteer.place_count() == len(towns())
