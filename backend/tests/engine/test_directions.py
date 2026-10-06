"""The condensing rules for road-by-road directions, one at a time, plus properties over random legs."""

from __future__ import annotations

import json
import math
from dataclasses import replace
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from apps.planner import directions
from apps.planner.assemble import build_plan
from apps.planner.directions import (
    COMPASS,
    MAX_ROAD_CHARS,
    MAX_STEPS_PER_LEG,
    compass,
    condense,
    condense_leg,
    from_payload,
    instruction,
    render,
    road_key,
    to_payload,
)
from apps.planner.providers import osrm
from apps.planner.types import RawStep

from . import ts_contract
from .helpers import make_request, make_route

CONTRACT = ts_contract.load()
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "osrm-steps-la-phoenix-new-york.json"


def step(miles, name="", ref="", kind="turn", bearing=90.0, at=(32.0, -97.0)) -> RawStep:
    lat, lon = at if at else (None, None)
    return RawStep(miles, name, ref, kind, lat, lon, bearing)


def arrive(at=(33.0, -96.0)) -> RawStep:
    return RawStep(0.0, "", "", "arrive", at[0], at[1], 0.0)


def leg(*steps: RawStep) -> list[RawStep]:
    return [*steps, arrive()]


def roads(stretches) -> list[str]:
    return [s.road for s in stretches]


def miles(stretches) -> list[float]:
    return [s.distance_miles for s in stretches]


# --- rule 1: the road key ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("ref", "name", "expected"),
    [
        ("I 40", "Interstate 40", "I-40"),
        ("US 287", "", "US-287"),
        ("TX 183", "Airport Freeway", "TX-183"),
        ("I-40", "", "I-40"),
        ("I 40;US 64", "", "I-40"),
        ("I 40; US 64", "", "I-40"),
        (";I 70", "", "I-70"),
        ("  I   70  ", "", "I-70"),
        ("AZ 202 Loop", "", "AZ-202 Loop"),
        ("I 10 EXPR", "", "I-10 EXPR"),
        ("FL A1A", "", "FL A1A"),
        ("", "Main Street", "Main Street"),
        ("", "  Main \t Street  ", "Main Street"),
        (";", "Main Street", "Main Street"),
        ("", "", ""),
        ("", "<img src=x onerror=alert(1)>", "<img src=x onerror=alert(1)>"),
        ("", "Line\nbreak\x00name", "Line break name"),
    ],
)
def test_the_road_is_the_first_reference_else_the_name(ref, name, expected):
    assert road_key(step(1, name=name, ref=ref)) == expected


def test_a_very_long_road_name_is_cut_short():
    assert len(road_key(step(1, name="x" * 500))) == MAX_ROAD_CHARS


# --- rule 2: short steps fold into the one before ---------------------------------------


def test_a_step_under_half_a_mile_folds_into_the_step_before():
    stretches = condense_leg(leg(step(5, "Main St"), step(0.4, "Ramp"), step(20, ref="I 40")), 25.4)
    assert roads(stretches) == ["Main St", "I-40", ""]
    assert miles(stretches) == [5.4, 20.0, 0.0]


def test_a_step_of_exactly_half_a_mile_stays():
    stretches = condense_leg(leg(step(5, "Main St"), step(0.5, "Elm St"), step(20, ref="I 40")), 25.5)
    assert roads(stretches) == ["Main St", "Elm St", "I-40", ""]


def test_the_first_step_is_never_folded_even_when_short():
    stretches = condense_leg(leg(step(0.1, "Main St"), step(30, ref="I 40")), 30.1)
    assert [s.kind for s in stretches] == ["depart", "road", "arrive"]
    assert roads(stretches) == ["Main St", "I-40", ""]
    assert miles(stretches) == [0.1, 30.0, 0.0]


def test_a_short_step_on_a_new_road_does_not_start_a_line():
    stretches = condense_leg(leg(step(20, ref="I 40"), step(0.3, ref="US 64"), step(20, ref="I 40")), 40.3)
    assert roads(stretches) == ["I-40", ""]
    assert miles(stretches) == [40.3, 0.0]


# --- rule 3: the same road merges, a nameless step joins the one before -----------------


def test_consecutive_steps_on_the_same_road_merge():
    stretches = condense_leg(leg(step(10, ref="I 40"), step(15, ref="I 40"), step(5, ref="US 64")), 30)
    assert roads(stretches) == ["I-40", "US-64", ""]
    assert miles(stretches) == [25.0, 5.0, 0.0]


def test_the_same_road_written_two_ways_is_one_road():
    stretches = condense_leg(leg(step(10, ref="I 40"), step(15, ref="I-40;US 64")), 25)
    assert roads(stretches) == ["I-40", ""]


def test_a_step_with_no_road_joins_the_step_before():
    stretches = condense_leg(leg(step(10, ref="I 40"), step(8), step(5, ref="US 64")), 23)
    assert roads(stretches) == ["I-40", "US-64", ""]
    assert miles(stretches) == [18.0, 5.0, 0.0]


def test_the_same_road_twice_with_another_between_stays_three_lines():
    stretches = condense_leg(leg(step(10, ref="I 40"), step(10, ref="US 64"), step(10, ref="I 40")), 30)
    assert roads(stretches) == ["I-40", "US-64", "I-40", ""]


def test_a_departure_with_no_road_does_not_swallow_the_next_road():
    stretches = condense_leg(leg(step(2), step(30, ref="I 40")), 32)
    assert [s.kind for s in stretches] == ["depart", "road", "arrive"]
    assert roads(stretches) == ["", "I-40", ""]


# --- rule 4: heading ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("bearing", "expected"),
    [
        (0, "N"),
        (22.4, "N"),
        (22.5, "NE"),
        (45, "NE"),
        (67.4, "NE"),
        (67.5, "E"),
        (90, "E"),
        (112.5, "SE"),
        (135, "SE"),
        (157.5, "S"),
        (180, "S"),
        (202.5, "SW"),
        (225, "SW"),
        (247.5, "W"),
        (270, "W"),
        (292.5, "NW"),
        (315, "NW"),
        (337.4, "NW"),
        (337.5, "N"),
        (359.9, "N"),
        (360, "N"),
        (-45, "NW"),
        (725, "N"),
    ],
)
def test_bearings_become_the_nearest_of_eight_compass_points(bearing, expected):
    assert compass(bearing) == expected


def test_a_line_takes_its_heading_from_the_first_raw_step_in_it():
    stretches = condense_leg(
        leg(step(5, "Main St", bearing=180), step(10, ref="I 40", bearing=90), step(10, ref="I 40", bearing=0)), 25
    )
    assert [s.heading for s in stretches] == ["S", "E", ""]


def test_a_step_with_no_bearing_takes_the_heading_before_it():
    stretches = condense_leg(leg(step(5, "Main St", bearing=180), step(10, ref="I 40", bearing=None)), 15)
    assert [s.heading for s in stretches] == ["S", "S", ""]


def test_a_departure_with_no_bearing_gives_up_on_the_leg():
    assert condense_leg(leg(step(5, "Main St", bearing=None), step(10, ref="I 40")), 15) == ()


# --- rule 5: wording ---------------------------------------------------------------------


@pytest.mark.parametrize("heading", COMPASS)
def test_the_departure_names_the_direction_in_words(heading):
    words = {
        "N": "north",
        "NE": "northeast",
        "E": "east",
        "SE": "southeast",
        "S": "south",
        "SW": "southwest",
        "W": "west",
        "NW": "northwest",
    }
    assert instruction("depart", "Main St", heading) == f"Head {words[heading]} on Main St"
    assert instruction("depart", "", heading) == f"Head {words[heading]}"


@pytest.mark.parametrize(
    ("road", "expected"),
    [
        ("I-40", "Take I-40 W"),
        ("US-287", "Take US-287 W"),
        ("TX-183", "Take TX-183 W"),
        ("AZ-202 Loop", "Take AZ-202 Loop W"),
        ("Main Street", "Continue on Main Street"),
        ("5th Avenue", "Continue on 5th Avenue"),
        ("Fort-Worth Road", "Continue on Fort-Worth Road"),
        ("I-", "Continue on I-"),
        ("", "Continue W"),
    ],
)
def test_a_road_line_says_take_for_a_numbered_road_and_continue_for_a_street(road, expected):
    assert instruction("road", road, "W") == expected


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("Memphis, Tennessee, United States", "Arrive at Memphis"),
        ("Memphis", "Arrive at Memphis"),
        ("  Memphis , TN", "Arrive at Memphis"),
        (", Tennessee", "Arrive at , Tennessee"),
    ],
)
def test_the_arrival_uses_the_first_part_of_the_place_label(label, expected):
    assert instruction("arrive", "", "", label) == expected


# --- rule 6: the cap ---------------------------------------------------------------------


def long_leg(n_roads: int, length=10.0) -> tuple[list[RawStep], float]:
    body = [step(length, f"Road {i}", ref=f"US {i + 1}") for i in range(n_roads)]
    return [step(length, "Start St"), *body, arrive()], length * (n_roads + 1)


def test_a_leg_at_the_limit_is_left_alone():
    steps, total = long_leg(MAX_STEPS_PER_LEG - 2)  # depart, 118 roads, arrive
    stretches = condense_leg(steps, total)
    assert len(stretches) == MAX_STEPS_PER_LEG


def test_a_leg_one_over_the_limit_loses_a_line():
    steps, total = long_leg(MAX_STEPS_PER_LEG - 1)
    stretches = condense_leg(steps, total)
    assert len(stretches) == MAX_STEPS_PER_LEG


def test_the_shortest_roads_go_first():
    steps, total = long_leg(300)
    stretches = condense_leg(steps, total)
    assert len(stretches) <= MAX_STEPS_PER_LEG
    assert sum(miles(stretches)) == pytest.approx(total, abs=1e-6)
    assert all(s.distance_miles >= 10 for s in stretches[:-1]), "nothing shorter than the originals is left"


def test_the_cap_merges_the_same_road_on_both_sides_of_a_folded_line():
    unique = [step(10, f"Road {i}", ref=f"US {i + 100}") for i in range(116)]
    trio = [step(10, ref="I 40"), step(0.5, ref="US 64"), step(10, ref="I 40")]
    # 0.5 mile is long enough to stay a line by rule 2, so only the cap can fold it.
    stretches = condense_leg([step(10, "Start St"), *unique, *trio, arrive()], 10 + 1160 + 20.5)
    assert len(stretches) < MAX_STEPS_PER_LEG
    assert roads(stretches).count("I-40") == 1
    assert "US-64" not in roads(stretches)
    i40 = next(s for s in stretches if s.road == "I-40")
    assert i40.distance_miles == pytest.approx(20.5, abs=0.15)
    for before, after in zip(stretches, stretches[1:], strict=False):
        assert not (before.road and before.road == after.road)


# --- rule 7: rounding --------------------------------------------------------------------


def test_distances_are_tenths_of_a_mile_and_add_up_to_the_leg():
    stretches = condense_leg(leg(step(10.04, "Main St"), step(20.06, ref="I 40"), step(5.033, ref="US 64")), 35.133)
    assert all(math.isclose(d * 10, round(d * 10), abs_tol=1e-9) for d in miles(stretches))
    assert sum(miles(stretches)) == pytest.approx(35.1, abs=1e-9)
    assert stretches[-1].distance_miles == 0


def test_the_steps_are_scaled_to_the_legs_own_distance():
    # The router's steps said 100 miles, its leg total said 101.
    stretches = condense_leg(leg(step(40, "Main St"), step(60, ref="I 40")), 101)
    assert sum(miles(stretches)) == pytest.approx(101.0, abs=1e-9)
    assert miles(stretches)[0] == pytest.approx(40.4, abs=0.1)


def test_miles_count_from_the_start_of_the_trip_and_never_go_down():
    stretches = condense_leg(
        leg(step(10, "Main St"), step(20.3, ref="I 40"), step(5, ref="US 64")), 35.3, start_mile=412.3
    )
    marks = [s.mile for s in stretches]
    assert marks == sorted(marks)
    assert marks[0] == 412.3
    assert marks[-1] == pytest.approx(412.3 + 35.3, abs=0.05)


def test_the_second_leg_starts_where_the_first_ends():
    both = condense(
        [leg(step(10, "A St"), step(20, ref="I 40")), leg(step(7, "B St"), step(30, ref="I 30"))], [30.04, 37]
    )
    first, second = both
    assert first[-1].mile == 30.0
    assert second[0].mile == 30.0
    assert second[-1].mile == pytest.approx(67.0, abs=0.05)


# --- rule 8: weird input -----------------------------------------------------------------


def test_no_steps_gives_nothing():
    assert condense_leg([], 10) == ()


def test_an_arrival_alone_gives_nothing():
    assert condense_leg([arrive()], 10) == ()


def test_a_first_step_with_no_location_gives_nothing():
    assert condense_leg(leg(step(10, "Main St", at=None), step(5, ref="I 40")), 15) == ()


def test_a_later_step_with_no_location_joins_the_line_before():
    stretches = condense_leg(leg(step(5, "Main St"), step(20, ref="I 40", at=None), step(10, ref="US 64")), 35)
    assert roads(stretches) == ["Main St", "US-64", ""]
    assert miles(stretches) == [25.0, 10.0, 0.0]


@pytest.mark.parametrize("at", [(91.0, 0.0), (0.0, 181.0), (math.nan, 0.0), (0.0, math.inf)])
def test_a_location_off_the_globe_counts_as_no_location(at):
    assert condense_leg(leg(step(10, "Main St", at=at), step(5, ref="I 40")), 15) == ()


def test_a_leg_with_no_arrival_step_still_ends_at_the_last_known_place():
    stretches = condense_leg([step(10, "Main St", at=(30.0, -90.0)), step(20, ref="I 40", at=(31.0, -91.0))], 30)
    assert stretches[-1].kind == "arrive"
    assert (stretches[-1].lat, stretches[-1].lon) == (31.0, -91.0)


def test_the_arrival_sits_where_the_arrival_step_says():
    stretches = condense_leg([step(10, "Main St"), arrive(at=(35.15, -90.05))], 10)
    assert (stretches[-1].lat, stretches[-1].lon) == (35.15, -90.05)
    assert stretches[-1].heading == "" and stretches[-1].road == ""


def test_steps_that_describe_another_route_give_nothing():
    assert condense_leg(leg(step(10, "Main St"), step(20, ref="I 40")), 100) == ()
    assert condense_leg(leg(step(10, "Main St"), step(20, ref="I 40")), 10) == ()


def test_a_small_gap_is_tolerated_and_absorbed():
    assert condense_leg(leg(step(10, "Main St"), step(20, ref="I 40")), 30.4) != ()
    assert condense_leg(leg(step(100, "Main St"), step(900, ref="I 40")), 1040) != ()


def test_a_zero_length_leg_is_a_departure_and_an_arrival():
    stretches = condense_leg(leg(step(0, "Main St")), 0.0)
    assert [s.kind for s in stretches] == ["depart", "arrive"]
    assert miles(stretches) == [0.0, 0.0]


def test_a_tiny_leg_puts_its_distance_on_the_departure():
    stretches = condense_leg(leg(step(0, "Main St")), 0.3)
    assert miles(stretches) == [0.3, 0.0]


@pytest.mark.parametrize("bad", [-1.0, math.nan, math.inf])
def test_a_leg_distance_that_makes_no_sense_gives_nothing(bad):
    assert condense_leg(leg(step(10, "Main St")), bad) == ()


@pytest.mark.parametrize("bad", [-1.0, math.nan, math.inf])
def test_a_step_distance_that_makes_no_sense_gives_nothing(bad):
    assert condense_leg(leg(step(bad, "Main St"), step(10, ref="I 40")), 10) == ()


def test_a_bearing_of_nan_counts_as_missing():
    stretches = condense_leg(leg(step(5, "Main St", bearing=90), step(10, ref="I 40", bearing=math.nan)), 15)
    assert [s.heading for s in stretches] == ["E", "E", ""]


def test_both_legs_are_needed_or_there_are_no_directions_at_all():
    good = leg(step(10, "Main St"))
    assert condense([good, good], [10, 10]) is not None
    assert condense([good, []], [10, 10]) is None
    assert condense([[], good], [10, 10]) is None


# --- from the real router ----------------------------------------------------------------


@pytest.fixture(scope="module")
def la_phoenix_new_york():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    legs = [leg["distance"] / 1609.344 for leg in payload["routes"][0]["legs"]]
    return osrm.parse_steps(payload), legs


def test_the_real_cross_country_answer_condenses_to_a_short_readable_list(la_phoenix_new_york):
    raw, leg_miles = la_phoenix_new_york
    first, second = condense(raw, leg_miles)

    assert [len(raw[0]), len(raw[1])] == [23, 96]
    assert len(first) < len(raw[0]) and len(second) < len(raw[1])
    assert sum(miles(first)) == pytest.approx(round(leg_miles[0], 1), abs=1e-6)
    assert sum(miles(second)) == pytest.approx(round(leg_miles[1], 1), abs=1e-6)
    assert first[0].kind == "depart" and first[-1].kind == "arrive"
    assert first[0].heading == "SE"
    assert "I-10" in roads(first)
    assert "I-40" in roads(second)
    assert second[0].mile == round(leg_miles[0], 1)
    assert all(not s.road.startswith(("I ", "US ")) for s in first + second), "references are hyphenated"


def test_real_data_renders_with_the_labels_from_the_request(la_phoenix_new_york):
    raw, leg_miles = la_phoenix_new_york
    out = render(condense(raw, leg_miles), "Los Angeles, California, United States", "Phoenix, Arizona", "New York")

    assert [leg["title"] for leg in out] == ["Los Angeles to Phoenix", "Phoenix to New York"]
    assert out[0]["steps"][-1]["instruction"] == "Arrive at Phoenix"
    assert out[1]["steps"][-1]["instruction"] == "Arrive at New York"
    assert out[0]["steps"][0]["instruction"] == "Head southeast on West 1st Street"
    assert any(s["instruction"] == "Take I-40 NE" for s in out[1]["steps"])


# --- render ------------------------------------------------------------------------------


def two_legs():
    return condense([leg(step(10, "A St"), step(20, ref="I 40")), leg(step(7, "B St"), step(30, ref="I 30"))], [30, 37])


def test_render_gives_two_legs_in_the_shape_of_the_contract():
    out = render(two_legs(), "Dallas, Texas, United States", "Memphis, Tennessee", "Denver")

    assert [(leg["from"], leg["to"], leg["title"]) for leg in out] == [
        ("current", "pickup", "Dallas to Memphis"),
        ("pickup", "dropoff", "Memphis to Denver"),
    ]
    assert [leg["distance_miles"] for leg in out] == [30.0, 37.0]
    for leg in out:
        assert leg["distance_miles"] == pytest.approx(sum(s["distance_miles"] for s in leg["steps"]), abs=0.05)
        assert [s["kind"] for s in leg["steps"]] == ["depart", "road", "arrive"]
        for s in leg["steps"]:
            assert set(s) == {"kind", "instruction", "road", "heading", "distance_miles", "mile", "lat", "lon"}


def test_render_rounds_coordinates_to_five_places():
    shifted = replace(two_legs()[0][0], lat=32.123456789, lon=-96.987654321)
    out = render(((shifted, *two_legs()[0][1:]), two_legs()[1]), "A", "B", "C")
    assert (out[0]["steps"][0]["lat"], out[0]["steps"][0]["lon"]) == (32.12346, -96.98765)


def test_render_gives_an_empty_list_when_there_is_nothing():
    assert render(None, "A", "B", "C") == []


def test_a_hostile_label_is_passed_through_as_plain_text():
    out = render(two_legs(), "<script>alert(1)</script>, X", "B", "<img src=x onerror=alert(1)>, TN")
    assert out[0]["title"] == "<script>alert(1)</script> to B"
    assert out[1]["steps"][-1]["instruction"] == "Arrive at <img src=x onerror=alert(1)>"
    json.dumps(out)


def test_the_places_come_from_the_request_not_from_the_cached_lines():
    stretches = two_legs()
    first = render(stretches, "A", "B", "C")
    second = render(stretches, "X", "Y", "Z")
    assert first[0]["steps"][-1]["instruction"] == "Arrive at B"
    assert second[0]["steps"][-1]["instruction"] == "Arrive at Y"
    assert first[0]["steps"][:-1] == second[0]["steps"][:-1]


# --- the cache form ----------------------------------------------------------------------


def test_the_cache_form_round_trips_and_is_plain_json():
    stretches = two_legs()
    payload = to_payload(stretches)
    assert json.loads(json.dumps(payload)) == payload
    assert from_payload(payload) == stretches


def test_nothing_to_keep_is_an_empty_list_and_comes_back_as_none():
    assert to_payload(None) == []
    assert from_payload([]) is None


def bad_payloads():
    good = to_payload(two_legs())
    first = good[0][0]
    return {
        "not a list": {"a": 1},
        "none": None,
        "one leg": good[:1],
        "three legs": [*good, good[0]],
        "an empty leg": [good[0], []],
        "a leg that is not a list": [good[0], "x"],
        "an item that is not a dict": [[1], good[1]],
        "a missing field": [[{k: v for k, v in first.items() if k != "mile"}], good[1]],
        "an extra field": [[{**first, "extra": 1}], good[1]],
        "a bad kind": [[{**first, "kind": "turn"}], good[1]],
        "a bad heading": [[{**first, "heading": "NNE"}], good[1]],
        "a road that is not text": [[{**first, "road": 5}], good[1]],
        "text for a number": [[{**first, "mile": "3"}], good[1]],
        "a bool for a number": [[{**first, "lat": True}], good[1]],
        "a nan": [[{**first, "lon": math.nan}], good[1]],
    }


@pytest.mark.parametrize("payload", bad_payloads().values(), ids=bad_payloads().keys())
def test_data_that_is_not_what_was_written_is_refused(payload):
    with pytest.raises(ValueError):
        from_payload(payload)


# --- in the plan -------------------------------------------------------------------------


def plan_with_directions(leg1=452.3, leg2=1044.8):
    route = make_route(leg1, leg2)
    raw = [
        leg_steps(leg1),
        leg_steps(leg2),
    ]
    return build_plan(make_request(), replace(route, directions=condense(raw, [leg1, leg2])))


def leg_steps(total: float) -> list[RawStep]:
    return leg(step(1.2, "Elm St"), step(total * 0.6, ref="I 30"), step(total * 0.4 - 1.2, ref="I 40", bearing=45))


def test_a_route_with_directions_puts_them_in_the_plan():
    plan = plan_with_directions()

    assert len(plan["directions"]) == 2
    for summary_leg, dirs in zip(plan["summary"]["legs"], plan["directions"], strict=True):
        assert (dirs["from"], dirs["to"]) == (summary_leg["from"], summary_leg["to"])
        assert dirs["distance_miles"] == summary_leg["distance_miles"]
        assert sum(s["distance_miles"] for s in dirs["steps"]) == pytest.approx(summary_leg["distance_miles"], abs=0.05)
    assert plan["directions"][0]["title"] == "Start to Pickup"
    assert plan["directions"][1]["steps"][-1]["instruction"] == "Arrive at Dropoff"
    assert CONTRACT.check(json.loads(json.dumps(plan)), "PlanResponse") == []


def test_directions_miles_line_up_with_the_stops():
    plan = plan_with_directions()
    pickup = next(s for s in plan["stops"] if s["kind"] == "pickup")
    assert plan["directions"][0]["steps"][-1]["mile"] == pickup["mile"]
    assert plan["directions"][1]["steps"][0]["mile"] == pickup["mile"]


def test_a_route_without_directions_gives_an_empty_list():
    plan = build_plan(make_request(), make_route(100, 200))
    assert plan["directions"] == []
    assert CONTRACT.check(plan, "PlanResponse") == []


# --- properties --------------------------------------------------------------------------

ROAD_NAMES = st.one_of(
    st.sampled_from(["", "", "Main St", "Elm St", "Ramp", "Airport Freeway", "5th Avenue"]),
    st.integers(0, 400).map(lambda i: f"Road {i}"),
)
REFS = st.sampled_from(["", "", "I 40", "I 30", "US 287", "US 287;TX 183", "TX 183", "I 40 EXPR", ";", "FL A1A"])
BEARINGS = st.one_of(st.none(), st.floats(min_value=-720, max_value=720, allow_nan=False))
LENGTHS = st.one_of(st.just(0.0), st.floats(min_value=0, max_value=0.9), st.floats(min_value=0.5, max_value=80))
LOCATED = st.sampled_from([True] * 9 + [False])


@st.composite
def raw_steps(draw, always_located=False):
    at = (draw(st.floats(-89, 89)), draw(st.floats(-179, 179))) if always_located or draw(LOCATED) else None
    return step(
        draw(LENGTHS),
        draw(ROAD_NAMES),
        draw(REFS) if draw(st.booleans()) else "",
        draw(st.sampled_from(["turn", "new name", "merge"])),
        draw(BEARINGS) if not always_located else draw(st.floats(0, 360)),
        at,
    )


@st.composite
def legs(draw):
    first = draw(raw_steps(always_located=True))
    steps = [first, *draw(st.lists(raw_steps(), min_size=0, max_size=400))]
    if draw(st.booleans()):
        steps.append(arrive())
    drift = draw(st.sampled_from([1.0, 1.0, 1.0, 1.0, 1.02, 0.97, 1.5, 0.0]))
    total = sum(s.distance_miles for s in steps) * drift
    return steps, total, draw(st.floats(min_value=0, max_value=5000))


PROPERTY_SETTINGS = settings(
    max_examples=300, deadline=None, suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large]
)


def assert_well_formed(stretches, total, start):
    assert stretches[0].kind == "depart" and stretches[-1].kind == "arrive"
    assert {s.kind for s in stretches[1:-1]} <= {"road"}
    assert len(stretches) <= MAX_STEPS_PER_LEG
    assert sum(s.distance_miles for s in stretches) == pytest.approx(round(total, 1), abs=1e-6)
    assert stretches[-1].distance_miles == 0
    marks = [s.mile for s in stretches]
    assert marks == sorted(marks), "miles never decrease"
    assert marks[0] == pytest.approx(start, abs=0.05)
    for s in stretches:
        assert s.distance_miles >= 0
        assert math.isclose(s.distance_miles * 10, round(s.distance_miles * 10), abs_tol=1e-6)
        assert -90 <= s.lat <= 90 and -180 <= s.lon <= 180
        assert s.heading in COMPASS if s.kind != "arrive" else s.heading == ""
    for before, after in zip(stretches[:-1], stretches[1:-1], strict=False):
        assert not (before.road and before.road == after.road), "the same road never repeats back to back"


@PROPERTY_SETTINGS
@given(case=legs())
def test_any_leg_gives_nothing_or_a_well_formed_list(case):
    steps, total, start = case
    stretches = condense_leg(steps, total, start_mile=start)
    if stretches:
        assert_well_formed(stretches, total, start)


@settings(PROPERTY_SETTINGS, max_examples=60)
@given(
    lengths=st.lists(st.floats(min_value=0.5, max_value=60), min_size=100, max_size=400),
    bearings=st.lists(st.floats(min_value=0, max_value=360), min_size=1, max_size=7),
)
def test_a_leg_of_many_roads_is_cut_to_the_limit_and_still_adds_up(lengths, bearings):
    steps = [
        step(length, f"Road {i}", ref=f"US {i}", bearing=bearings[i % len(bearings)])
        for i, length in enumerate(lengths)
    ]
    total = sum(lengths)
    stretches = condense_leg([*steps, arrive()], total, start_mile=12.3)

    assert len(stretches) == min(len(lengths) + 1, MAX_STEPS_PER_LEG)
    assert_well_formed(stretches, total, 12.3)


@PROPERTY_SETTINGS
@given(case=legs(), other=legs())
def test_a_trip_renders_to_json_with_the_documented_shape(case, other):
    result = condense([case[0], other[0]], [case[1], other[1]])
    out = render(result, "A, X", "B, Y", "C, Z")
    json.dumps(out, allow_nan=False)
    assert out == [] if result is None else len(out) == 2
    for rendered in out:
        assert rendered["steps"][0]["kind"] == "depart"
        assert all(s["instruction"] for s in rendered["steps"])
        assert rendered["distance_miles"] == pytest.approx(
            sum(s["distance_miles"] for s in rendered["steps"]), abs=0.05
        )
    assert directions.from_payload(to_payload(result)) == result
