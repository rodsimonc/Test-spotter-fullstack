"""build_plan from a request and a route to the finished response, checked end to end.

The route is a straight line through three real places with thousands of points, so the
simplifier has work to do. The response is checked three ways: against types.ts, against the
independent hours-of-service checker, and by hand on the pieces a screen shows.
"""

from __future__ import annotations

import copy
import json
import math
from datetime import datetime

import pytest

from apps.planner.assemble import MAX_GEOMETRY_POINTS, build_plan
from apps.planner.hos.models import EngineError
from apps.planner.types import PlaceData, PlanRequestData, RouteData, RouteLeg

from . import ts_contract
from .compliance import Expect, check_plan
from .helpers import DALLAS, DENVER, MEMPHIS, make_request, make_route

CONTRACT = ts_contract.load()

LEG1_MILES, LEG2_MILES = 452.3, 1044.8
LEG1_OSRM, LEG2_OSRM = 470.0, 900.0
HEADER = {"driver_name": "Ana Reyes", "carrier_name": "Reyes Freight", "truck_number": "101", "trailer_number": "202"}


def full_trip(
    departure="2026-10-07T06:00", tz="America/Chicago", cycle=24.0, header=None, leg1=LEG1_MILES, leg2=LEG2_MILES
):
    req = make_request(departure=departure, tz=tz, cycle=cycle, header=header)
    route = make_route(
        leg1, leg2, LEG1_OSRM if leg1 == LEG1_MILES else None, LEG2_OSRM if leg2 == LEG2_MILES else None, steps=2000
    )
    return req, route, build_plan(req, route)


def expectation(req, route, **kwargs) -> Expect:
    return Expect(
        leg_miles=(route.legs[0].distance_miles, route.legs[1].distance_miles),
        osrm_minutes=(route.legs[0].osrm_duration_minutes, route.legs[1].osrm_duration_minutes),
        cycle_used_hours=req.cycle_used_hours,
        departure=req.departure.strftime("%Y-%m-%dT%H:%M"),
        timezone=req.timezone,
        header=dict(req.header),
        **kwargs,
    )


@pytest.fixture(scope="module")
def trip():
    return full_trip(header=HEADER)


# --- shape ---------------------------------------------------------------------------------------


def test_a_full_plan_fits_the_types_in_types_ts(trip):
    assert CONTRACT.check(trip[2], "PlanResponse") == []


def test_the_shape_survives_a_trip_through_json(trip):
    wire = json.loads(json.dumps(trip[2], allow_nan=False))
    assert wire == trip[2]
    assert CONTRACT.check(wire, "PlanResponse") == []


def test_the_request_echo_fits_the_request_type(trip):
    assert CONTRACT.check(trip[2]["request"], "PlanRequest") == []


def test_every_count_is_a_whole_number(trip):
    plan = trip[2]
    whole = [
        *(
            plan["summary"][k]
            for k in (
                "driving_minutes",
                "on_duty_minutes",
                "elapsed_minutes",
                "days",
                "fuel_stops",
                "breaks",
                "rests",
                "restarts",
            )
        ),
        *(leg[k] for leg in plan["summary"]["legs"] for k in ("duration_minutes", "osrm_duration_minutes")),
        *(s[k] for s in plan["stops"] for k in ("duration_minutes", "day")),
        *(s[k] for s in plan["segments"] for k in ("id", "minutes")),
        *(i for i in plan["route"]["leg_end_indices"]),
    ]
    for log in plan["logs"]:
        whole += [log["day"], log["total_miles_driving"], log["total_mileage_today"], *log["totals"].values()]
        whole += [v for k, v in log["recap"].items() if k != "restart_completed"]
        whole += [e[k] for e in log["entries"] for k in ("start_min", "end_min")]
        whole += [r["minute"] for r in log["remarks"]]
    assert all(type(n) is int for n in whole)


def test_a_broken_plan_would_be_caught_by_the_same_check(trip):
    broken = copy.deepcopy(trip[2])
    del broken["logs"][0]["recap"]["a_minutes"]
    broken["summary"]["days"] = "3"
    broken["stops"][0]["kind"] = "layover"
    problems = CONTRACT.check(broken, "PlanResponse")
    assert len(problems) == 3


# --- hours of service ----------------------------------------------------------------------------


def test_a_full_plan_passes_the_independent_checker(trip):
    req, route, plan = trip
    assert check_plan(plan, expectation(req, route)) == []


def test_the_plan_is_the_same_every_time(trip):
    req, route, plan = trip
    assert build_plan(req, route) == plan


def test_the_request_and_route_are_left_alone():
    req, route, _ = full_trip(header=HEADER)
    header_before = dict(req.header)
    coordinates_before = list(route.coordinates)
    build_plan(req, route)
    assert req.header == header_before
    assert route.coordinates == coordinates_before


def test_the_example_trip_matches_what_a_dispatcher_would_work_out(trip):
    summary = trip[2]["summary"]
    # 452.3 mi: OSRM says 470 min, which is slower than 60 mph, so 470 wins.
    # 1,044.8 mi: 60 mph gives 1,045 min (rounded up), slower than OSRM's 900.
    assert [leg["duration_minutes"] for leg in summary["legs"]] == [470, 1045]
    assert summary["driving_minutes"] == 470 + 1045
    # Pickup and dropoff, one fuel stop (the odometer reaches 1,000 miles at mile 999.x).
    assert summary["on_duty_minutes"] == 470 + 1045 + 60 + 60 + 30
    assert (summary["fuel_stops"], summary["rests"], summary["restarts"]) == (1, 2, 0)
    assert summary["cycle_used_end_hours"] == pytest.approx(24 + (470 + 1045 + 150) / 60, abs=0.01)
    assert summary["days"] == 3


# --- route and stops -----------------------------------------------------------------------------


def test_the_geometry_is_cut_down_but_keeps_both_leg_ends(trip):
    req, _, plan = trip
    route = plan["route"]
    geometry = route["geometry"]
    assert len(geometry) <= MAX_GEOMETRY_POINTS
    first, second = route["leg_end_indices"]
    assert 0 < first <= second == len(geometry) - 1
    assert geometry[0] == pytest.approx([req.current.lat, req.current.lon], abs=1e-5)
    assert geometry[first] == pytest.approx([req.pickup.lat, req.pickup.lon], abs=1e-5)
    assert geometry[second] == pytest.approx([req.dropoff.lat, req.dropoff.lon], abs=1e-5)


def test_bounds_hold_every_point_of_the_route(trip):
    route = trip[2]["route"]
    (south, west), (north, east) = route["bounds"]
    assert south < north and west < east
    assert all(south <= lat <= north and west <= lon <= east for lat, lon in route["geometry"])
    assert (south, north) == (min(DALLAS[0], MEMPHIS[0], DENVER[0]), max(DALLAS[0], MEMPHIS[0], DENVER[0]))


def test_a_route_already_under_the_budget_is_sent_as_is():
    req = make_request()
    route = make_route(100, 100, steps=10)
    plan = build_plan(req, route)
    assert len(plan["route"]["geometry"]) == len(route.coordinates)
    assert plan["route"]["leg_end_indices"] == [10, 20]


def test_the_three_named_places_sit_where_the_user_put_them(trip):
    req, _, plan = trip
    by_id = {s["id"]: s for s in plan["stops"]}
    for stop_id, place in (
        ("start", req.current),
        ("pickup", req.pickup),
        ("dropoff", req.dropoff),
        ("end", req.dropoff),
    ):
        assert (by_id[stop_id]["lat"], by_id[stop_id]["lon"]) == (round(place.lat, 5), round(place.lon, 5))
    assert [by_id[i]["place"] for i in ("start", "pickup", "dropoff", "end")] == [
        "Dallas, TX",
        "Memphis, TN",
        "Denver, CO",
        "Denver, CO",
    ]


def test_stops_in_the_middle_of_the_route_sit_between_their_neighbours(trip):
    plan = trip[2]
    (south, west), (north, east) = plan["route"]["bounds"]
    for stop in plan["stops"]:
        assert south - 1e-4 <= stop["lat"] <= north + 1e-4
        assert west - 1e-4 <= stop["lon"] <= east + 1e-4
    miles = [s["mile"] for s in plan["stops"]]
    assert miles == sorted(miles)


def test_stop_ids_are_unique_and_counted_per_kind(trip):
    ids = [s["id"] for s in trip[2]["stops"]]
    assert ids == ["start", "pickup", "rest-1", "fuel-1", "rest-2", "dropoff", "end"]


def test_titles_and_notes_are_short_text_a_driver_can_read(trip):
    titles = {s["kind"]: s["title"] for s in trip[2]["stops"]}
    assert titles == {
        "start": "Start",
        "pickup": "Pickup",
        "rest": "10-hour rest",
        "fuel": "Fuel stop",
        "dropoff": "Dropoff",
        "end": "End of trip",
    }
    for stop in trip[2]["stops"]:
        assert 0 < len(stop["note"]) < 120


# --- the request echo ----------------------------------------------------------------------------


def test_the_echo_drops_seconds_and_fills_every_header_field():
    req = PlanRequestData(
        current=PlaceData("A", DALLAS[0], DALLAS[1]),
        pickup=PlaceData("B", MEMPHIS[0], MEMPHIS[1]),
        dropoff=PlaceData("C", DENVER[0], DENVER[1]),
        cycle_used_hours=12.25,
        departure=datetime(2026, 10, 7, 6, 0, 45, 123456),
        timezone="America/Chicago",
        header={"driver_name": "Ana Reyes"},
    )
    plan = build_plan(req, make_route(100, 100))
    echo = plan["request"]
    assert echo["departure"] == "2026-10-07T06:00"
    assert echo["cycle_used_hours"] == 12.25
    assert echo["current"] == {"label": "A", "lat": DALLAS[0], "lon": DALLAS[1]}
    assert set(echo["header"]) == set(CONTRACT.fields("LogHeader"))
    assert echo["header"]["driver_name"] == "Ana Reyes"
    assert echo["header"]["carrier_name"] == ""
    assert plan["summary"]["depart_at"] == "2026-10-07T06:00:00-05:00"


def test_header_text_reaches_every_sheet(trip):
    for log in trip[2]["logs"]:
        assert log["header"]["driver_name"] == "Ana Reyes"
        assert log["vehicle"] == "Truck 101 / Trailer 202"


# --- warnings and assumptions --------------------------------------------------------------------


def warnings_for(**kwargs) -> list[str]:
    return full_trip(**kwargs)[2]["warnings"]


def test_a_plain_trip_has_no_warnings(trip):
    assert trip[2]["warnings"] == []


def test_a_cycle_at_70_hours_warns_and_starts_with_a_restart():
    plan = full_trip(cycle=70)[2]
    assert (
        plan["warnings"][0]
        == "Your cycle is already at 70 hours or more, so the trip starts with a 34-hour restart, logged Off Duty."
    )
    assert plan["segments"][0]["kind"] == "restart"
    assert plan["segments"][0]["minutes"] == 34 * 60


def test_a_cycle_that_runs_out_mid_trip_adds_one_restart_and_says_so():
    plan = full_trip(cycle=60)[2]
    assert plan["summary"]["restarts"] == 1
    assert (
        "The 70-hour cycle runs out on this trip, so the plan adds a 34-hour restart, logged Off Duty."
        in plan["warnings"]
    )


def test_a_long_trip_says_how_many_sheets_it_needs():
    plan = full_trip(cycle=0, leg1=900, leg2=2200)[2]
    assert plan["summary"]["days"] >= 4
    assert (
        f"This trip spans {plan['summary']['days']} days, so it has {plan['summary']['days']} daily log sheets."
        in plan["warnings"]
    )


def test_a_long_deadhead_leg_is_called_out_with_its_distance():
    warnings = warnings_for(cycle=0, leg1=620.4, leg2=200)
    assert "The drive to the pickup is 620 miles. It counts toward your hours like any other driving." in warnings
    assert not any("The drive to the pickup" in w for w in warnings_for(cycle=0, leg1=500, leg2=200))


def test_places_outside_north_america_get_a_us_rules_warning():
    paris, lyon, nice = (48.85, 2.35), (45.76, 4.84), (43.7, 7.26)
    req = make_request(a=paris, b=lyon, c=nice)
    plan = build_plan(req, make_route(300, 200, a=paris, b=lyon, c=nice))
    assert any("outside North America" in w for w in plan["warnings"])
    assert (
        check_plan(plan, expectation(req, make_route(300, 200, a=paris, b=lyon, c=nice), outside_north_america=True))
        == []
    )
    # Remarks fall back to coordinates there, and say so instead of crashing.
    assert plan["stops"][0]["place"] == "48.85, 2.35"


def test_one_place_outside_is_enough_to_warn():
    bogota = (4.71, -74.07)
    req = make_request(c=bogota)
    plan = build_plan(req, make_route(300, 900, c=bogota))
    assert any("outside North America" in w for w in plan["warnings"])
    assert plan["stops"][-1]["place"] == "4.71, -74.07"


def test_mexico_and_canada_count_as_north_america():
    cancun, calgary = (21.16, -86.85), (51.05, -114.07)
    req = make_request(b=calgary, c=cancun)
    plan = build_plan(req, make_route(300, 900, b=calgary, c=cancun))
    assert not any("outside North America" in w for w in plan["warnings"])
    assert [plan["stops"][i]["place"] for i in (1, -1)] == ["Calgary, AB", "Cancun, ROO"]


def test_the_assumptions_cover_each_rule_the_brief_names(trip):
    text = " ".join(trip[2]["assumptions"])
    for phrase in (
        "70-hour, 8-day",
        "1 hour each",
        "1,000 miles",
        "60 mph",
        "30-minute break",
        "sleeper berth",
        "34-hour restart",
    ):
        assert phrase in text
    assert all(isinstance(a, str) and a for a in trip[2]["assumptions"])


# --- time zones ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tz", "departure", "offset"),
    [
        ("America/Chicago", "2026-10-07T06:00", "-05:00"),
        ("America/Chicago", "2026-01-15T06:00", "-06:00"),
        ("America/Phoenix", "2026-10-07T06:00", "-07:00"),
        ("America/Los_Angeles", "2026-07-01T06:00", "-07:00"),
        ("Pacific/Honolulu", "2026-10-07T06:00", "-10:00"),
        ("America/St_Johns", "2026-10-07T06:00", "-02:30"),
        ("UTC", "2026-10-07T06:00", "+00:00"),
    ],
)
def test_every_timestamp_carries_the_offset_in_force_at_departure(tz, departure, offset):
    plan = full_trip(departure=departure, tz=tz, cycle=0, leg1=300, leg2=300)[2]
    stamps = [plan["summary"]["depart_at"], plan["summary"]["arrive_at"]]
    stamps += [s[k] for s in plan["segments"] for k in ("start_at", "end_at")]
    stamps += [s[k] for s in plan["stops"] for k in ("arrive_at", "depart_at")]
    assert all(t.endswith(offset) for t in stamps), stamps
    label = f"UTC{offset}"
    assert any(tz in a and label in a for a in plan["assumptions"])


def test_spring_forward_keeps_every_sheet_at_24_hours_and_warns():
    # Leaves Saturday 20:00 at UTC-06:00. Clocks in Chicago jump at 02:00 on Sunday March 8.
    req, route, plan = full_trip(departure="2026-03-07T20:00", cycle=0, leg1=300, leg2=900)
    assert check_plan(plan, expectation(req, route)) == []
    assert all(sum(log["totals"].values()) == 1440 for log in plan["logs"])
    warning = next(w for w in plan["warnings"] if w.startswith("Clocks in"))
    assert warning == (
        "Clocks in America/Chicago change on March 8 during this trip. The sheets keep the UTC-06:00 offset "
        "from departure, so every day stays 24 hours, and times after the change differ from local clocks by 1 hour."
    )


def test_fall_back_keeps_every_sheet_at_24_hours_and_warns():
    req, route, plan = full_trip(departure="2026-10-31T18:00", cycle=0, leg1=300, leg2=900)
    assert check_plan(plan, expectation(req, route)) == []
    assert all(sum(log["totals"].values()) == 1440 for log in plan["logs"])
    assert any(w.startswith("Clocks in America/Chicago change on November 1") for w in plan["warnings"])


@pytest.mark.parametrize("tz", ["America/Phoenix", "Pacific/Honolulu"])
def test_zones_without_daylight_time_never_warn_about_clocks(tz):
    req, route, plan = full_trip(departure="2026-03-07T20:00", tz=tz, cycle=0, leg1=300, leg2=900)
    assert not any(w.startswith("Clocks in") for w in plan["warnings"])
    assert check_plan(plan, expectation(req, route)) == []


def test_a_trip_that_ends_before_the_change_does_not_warn():
    plan = full_trip(departure="2026-03-07T08:00", cycle=0, leg1=100, leg2=100)[2]
    assert not any(w.startswith("Clocks in") for w in plan["warnings"])


def test_a_wall_time_that_does_not_exist_keeps_its_clock_reading():
    # 02:30 on March 8 never happens in Chicago. The sheet still starts at 02:30.
    req, route, plan = full_trip(departure="2026-03-08T02:30", cycle=0, leg1=100, leg2=100)
    assert plan["summary"]["depart_at"].startswith("2026-03-08T02:30:00")
    assert plan["logs"][0]["entries"][0]["end_min"] == 150
    assert check_plan(plan, expectation(req, route)) == []


def test_a_wall_time_that_happens_twice_takes_the_first_one():
    plan = full_trip(departure="2026-11-01T01:30", cycle=0, leg1=100, leg2=100)[2]
    assert plan["summary"]["depart_at"] == "2026-11-01T01:30:00-05:00"


# --- small and odd trips -------------------------------------------------------------------------


@pytest.mark.parametrize(("leg1", "leg2"), [(0, 0), (0, 250), (250, 0), (0.4, 0.4)])
def test_trips_with_a_zero_or_tiny_leg_still_plan_cleanly(leg1, leg2):
    req = make_request()
    route = make_route(leg1, leg2)
    plan = build_plan(req, route)
    assert CONTRACT.check(plan, "PlanResponse") == []
    assert check_plan(plan, expectation(req, route)) == []
    assert [s["kind"] for s in plan["segments"] if s["kind"] in ("pickup", "dropoff")] == ["pickup", "dropoff"]


def test_a_route_with_one_point_per_leg_end_still_works():
    route = RouteData(
        coordinates=[DALLAS, MEMPHIS, DENVER],
        leg_end_indices=(1, 2),
        legs=(RouteLeg(420.0, 400.0), RouteLeg(1000.0, 900.0)),
    )
    plan = build_plan(make_request(), route)
    assert plan["route"]["leg_end_indices"] == [1, 2]
    assert len(plan["route"]["geometry"]) == 3
    assert CONTRACT.check(plan, "PlanResponse") == []


def test_the_busiest_allowed_trip_stays_inside_the_response_budget():
    req, route, plan = full_trip(cycle=0, leg1=2500, leg2=2500)
    assert check_plan(plan, expectation(req, route)) == []
    assert len(json.dumps(plan)) < 500_000
    assert plan["summary"]["days"] >= 8


# --- bad input -----------------------------------------------------------------------------------


def test_an_unknown_time_zone_is_an_engine_error():
    req = make_request()
    bad = PlanRequestData(req.current, req.pickup, req.dropoff, 0.0, req.departure, "Mars/Olympus", {})
    with pytest.raises(EngineError, match="Unknown time zone"):
        build_plan(bad, make_route(100, 100))


@pytest.mark.parametrize("cycle", [-1.0, math.nan, math.inf])
def test_a_bad_cycle_is_an_engine_error(cycle):
    req = make_request(cycle=cycle)
    with pytest.raises(EngineError):
        build_plan(req, make_route(100, 100))


@pytest.mark.parametrize(
    "legs",
    [
        (RouteLeg(-1.0, 10.0), RouteLeg(10.0, 10.0)),
        (RouteLeg(10.0, math.nan), RouteLeg(10.0, 10.0)),
        (RouteLeg(math.inf, 1.0), RouteLeg(1.0, 1.0)),
    ],
)
def test_bad_leg_numbers_are_an_engine_error(legs):
    route = RouteData(coordinates=[DALLAS, MEMPHIS, DENVER], leg_end_indices=(1, 2), legs=legs)
    with pytest.raises(EngineError):
        build_plan(make_request(), route)


def test_leg_end_indices_that_do_not_fit_the_geometry_are_an_engine_error():
    route = RouteData(
        coordinates=[DALLAS, MEMPHIS], leg_end_indices=(1, 5), legs=(RouteLeg(10.0, 10.0), RouteLeg(10.0, 10.0))
    )
    with pytest.raises(EngineError):
        build_plan(make_request(), route)
