"""POST /api/plan against `frontend/src/api/types.ts`, field by field, with the real engine.

`tests/support/ts_contract.py` reads the interfaces from the TypeScript file itself. A field
renamed, dropped or retyped on either side fails here. Hours-of-service numbers are the engine's
business (`tests/engine`). These tests check that the HTTP layer hands them over intact.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from tests.support import ts_contract
from tests.support.osrm import DALLAS, DENVER, MEMPHIS, haversine_m, osrm_payload, register_osrm

URL = "/api/plan"
ISO_WITH_OFFSET = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$")
FIXTURES = Path(__file__).resolve().parents[3] / "frontend" / "src" / "test" / "fixtures"

MIAMI = (25.7617, -80.1918)
CHICAGO = (41.8781, -87.6298)
LOS_ANGELES = (34.0522, -118.2437)
FORT_WORTH = (32.7555, -97.3308)
WACO = (31.5493, -97.1467)

HEADER = {
    "driver_name": "Dana Driver",
    "co_driver_name": "Sam Second",
    "carrier_name": "Prairie Freight LLC",
    "main_office_address": "100 Main St, Omaha, NE",
    "home_terminal_address": "22 Depot Rd, Dallas, TX",
    "truck_number": "101",
    "trailer_number": "202",
    "shipper": "Acme Supply",
    "commodity": "Palletized paper",
    "shipping_doc_no": "BOL-77123",
}


def place(label: str, point: tuple[float, float]) -> dict:
    return {"label": label, "lat": point[0], "lon": point[1]}


SCENARIOS = {
    "example trip": {
        "stops": ("Dallas, TX", DALLAS, "Memphis, TN", MEMPHIS, "Denver, CO", DENVER),
        "cycle": 24,
        "timezone": "America/Chicago",
        "departure": "2026-10-07T06:00",
    },
    "coast to coast needing a restart": {
        "stops": ("Miami, FL", MIAMI, "Chicago, IL", CHICAGO, "Los Angeles, CA", LOS_ANGELES),
        "cycle": 62,
        "timezone": "America/New_York",
        "departure": "2026-03-05T22:30",
        "expect_restart": True,
    },
    "short local run": {
        "stops": ("Dallas, TX", DALLAS, "Fort Worth, TX", FORT_WORTH, "Waco, TX", WACO),
        "cycle": 0,
        "timezone": "America/Chicago",
        "departure": "2026-10-07T10:00",
        "expect_days": 1,
    },
    "spring forward weekend": {
        "stops": ("Dallas, TX", DALLAS, "Memphis, TN", MEMPHIS, "Denver, CO", DENVER),
        "cycle": 10,
        "timezone": "America/Chicago",
        "departure": "2027-03-13T20:00",
    },
}


@pytest.fixture(params=SCENARIOS, ids=list(SCENARIOS))
def scenario(request, rsps, real_engine):
    spec = SCENARIOS[request.param]
    names = spec["stops"][0::2]
    points = spec["stops"][1::2]
    register_osrm(rsps, osrm_payload(waypoints=points))
    body = {
        "current": place(names[0], points[0]),
        "pickup": place(names[1], points[1]),
        "dropoff": place(names[2], points[2]),
        "cycle_used_hours": spec["cycle"],
        "departure": spec["departure"],
        "timezone": spec["timezone"],
        "header": HEADER,
    }
    return spec, body, points


@pytest.fixture
def planned(api, scenario):
    spec, body, points = scenario
    response = api.post(URL, body, format="json")
    assert response.status_code == 200, response.content[:400]
    return spec, body, points, response, strict_json(response.content)


def strict_json(raw: bytes):
    """Parse like a browser does. Python's own parser would let NaN and Infinity through."""

    def refuse(name: str):
        raise AssertionError(f"The response contains {name}, which isn't JSON.")

    return json.loads(raw, parse_constant=refuse)


def test_response_matches_the_typescript_plan_response(planned):
    ts_contract.load().assert_matches(planned[4], "PlanResponse")


def test_response_is_json_and_never_cached(planned):
    response = planned[3]
    assert response["Content-Type"] == "application/json"
    assert response["Cache-Control"] == "no-store"


def test_request_is_echoed_in_normalized_form(planned):
    spec, body, _points, _response, plan = planned
    echo = plan["request"]
    assert echo["current"] == body["current"]
    assert echo["pickup"] == body["pickup"]
    assert echo["dropoff"] == body["dropoff"]
    assert echo["cycle_used_hours"] == body["cycle_used_hours"]
    assert echo["departure"] == spec["departure"]
    assert echo["timezone"] == spec["timezone"]
    assert echo["header"] == HEADER


def test_every_timestamp_carries_the_home_terminal_offset(planned):
    plan = planned[4]
    stamps = [plan["summary"]["depart_at"], plan["summary"]["arrive_at"]]
    stamps += [s[key] for s in plan["stops"] for key in ("arrive_at", "depart_at")]
    stamps += [s[key] for s in plan["segments"] for key in ("start_at", "end_at")]
    assert all(ISO_WITH_OFFSET.match(stamp) for stamp in stamps), [s for s in stamps if not ISO_WITH_OFFSET.match(s)]
    offsets = {stamp[-6:] for stamp in stamps}
    assert len(offsets) == 1, f"one fixed offset for the whole trip, got {offsets}"


def test_summary_agrees_with_the_rest_of_the_response(planned):
    plan = planned[4]
    summary, logs = plan["summary"], plan["logs"]
    assert summary["days"] == len(logs)
    assert summary["distance_miles"] == pytest.approx(sum(leg["distance_miles"] for leg in summary["legs"]), abs=0.2)
    assert summary["driving_minutes"] == sum(s["minutes"] for s in plan["segments"] if s["status"] == "driving")
    assert summary["elapsed_minutes"] == sum(s["minutes"] for s in plan["segments"])
    depart = datetime.fromisoformat(summary["depart_at"])
    arrive = datetime.fromisoformat(summary["arrive_at"])
    assert arrive - depart == timedelta(minutes=summary["elapsed_minutes"])
    kinds = [s["kind"] for s in plan["stops"]]
    assert summary["fuel_stops"] == kinds.count("fuel")
    assert summary["breaks"] == kinds.count("break")
    assert summary["rests"] == kinds.count("rest")
    assert summary["restarts"] == kinds.count("restart")
    assert [(leg["from"], leg["to"]) for leg in summary["legs"]] == [("current", "pickup"), ("pickup", "dropoff")]


def test_planner_leg_time_is_the_slower_of_osrm_and_sixty_mph(planned):
    for leg in planned[4]["summary"]["legs"]:
        assert leg["duration_minutes"] >= leg["osrm_duration_minutes"] - 1
        assert leg["duration_minutes"] >= leg["distance_miles"] - 1


def test_whole_minutes_are_integers(planned):
    plan = planned[4]
    whole = [plan["summary"][k] for k in ("driving_minutes", "on_duty_minutes", "elapsed_minutes", "days")]
    whole += [s["duration_minutes"] for s in plan["stops"]] + [s["minutes"] for s in plan["segments"]]
    for log in plan["logs"]:
        whole += list(log["totals"].values())
        whole += [e[k] for e in log["entries"] for k in ("start_min", "end_min")]
        whole += [r["minute"] for r in log["remarks"]]
        whole += [log["recap"][k] for k in ("on_duty_today_minutes", "a_minutes", "b_minutes", "c_minutes")]
    assert all(isinstance(v, int) and not isinstance(v, bool) for v in whole)


def test_route_geometry_runs_from_current_through_pickup_to_dropoff(planned):
    _spec, body, points, _response, plan = planned
    route = plan["route"]
    geometry = route["geometry"]
    first_end, last_end = route["leg_end_indices"]
    assert 0 < first_end < last_end == len(geometry) - 1
    for index, target in ((0, points[0]), (first_end, points[1]), (last_end, points[2])):
        gap_miles = haversine_m(tuple(geometry[index]), target) / 1609.344
        assert gap_miles < 2, f"geometry[{index}] is {gap_miles:.1f} miles from its waypoint"
    (south, west), (north, east) = route["bounds"]
    assert south <= min(p[0] for p in geometry) and north >= max(p[0] for p in geometry)
    assert west <= min(p[1] for p in geometry) and east >= max(p[1] for p in geometry)
    assert south < north and west < east
    assert all(math.isfinite(v) for point in geometry for v in point)


def test_geometry_is_simplified_for_a_very_detailed_route(api, rsps, real_engine, plan_payload):
    register_osrm(rsps, osrm_payload(points_per_leg=6000))
    plan = api.post(URL, plan_payload, format="json").json()
    ts_contract.load().assert_matches(plan, "PlanResponse")
    assert len(plan["route"]["geometry"]) <= 1600
    assert plan["route"]["leg_end_indices"][1] == len(plan["route"]["geometry"]) - 1


def test_stops_run_in_order_and_start_and_end_the_trip(planned):
    plan = planned[4]
    stops = plan["stops"]
    assert [s["id"] for s in stops] == list(dict.fromkeys(s["id"] for s in stops)), "stop ids repeat"
    assert stops[0]["kind"] == "start" and stops[-1]["kind"] == "end"
    assert [s["kind"] for s in stops].count("pickup") == 1
    assert [s["kind"] for s in stops].count("dropoff") == 1
    miles = [s["mile"] for s in stops]
    assert miles == sorted(miles)
    assert miles[-1] == pytest.approx(plan["summary"]["distance_miles"], abs=0.2)
    assert all(1 <= s["day"] <= plan["summary"]["days"] for s in stops)
    starts = [datetime.fromisoformat(s["arrive_at"]) for s in stops]
    assert starts == sorted(starts)
    for stop in stops:
        gap = datetime.fromisoformat(stop["depart_at"]) - datetime.fromisoformat(stop["arrive_at"])
        assert gap == timedelta(minutes=stop["duration_minutes"])


def test_segments_are_contiguous_and_numbered_from_one(planned):
    segments = planned[4]["segments"]
    assert [s["id"] for s in segments] == list(range(1, len(segments) + 1))
    for before, after in zip(segments, segments[1:], strict=False):
        assert before["end_at"] == after["start_at"]
        assert before["end_mile"] == pytest.approx(after["start_mile"], abs=0.05)
    for segment in segments:
        gap = datetime.fromisoformat(segment["end_at"]) - datetime.fromisoformat(segment["start_at"])
        assert gap == timedelta(minutes=segment["minutes"]) and segment["minutes"] > 0


def test_each_log_day_covers_exactly_twenty_four_hours(planned):
    plan = planned[4]
    logs = plan["logs"]
    assert [log["day"] for log in logs] == list(range(1, len(logs) + 1))
    dates = [datetime.strptime(log["date"], "%Y-%m-%d") for log in logs]
    assert all(b - a == timedelta(days=1) for a, b in zip(dates, dates[1:], strict=False))
    for log in logs:
        entries = log["entries"]
        assert entries[0]["start_min"] == 0 and entries[-1]["end_min"] == 1440
        assert all(a["end_min"] == b["start_min"] for a, b in zip(entries, entries[1:], strict=False))
        assert sum(log["totals"].values()) == 1440
        by_status = dict.fromkeys(log["totals"], 0)
        for entry in entries:
            by_status[entry["status"]] += entry["end_min"] - entry["start_min"]
        assert by_status == log["totals"]
        assert all(0 <= r["minute"] < 1440 for r in log["remarks"])
        assert log["recap"]["a_minutes"] + log["recap"]["b_minutes"] >= 0
        assert log["total_mileage_today"] >= log["total_miles_driving"] >= 0


def test_log_header_and_vehicle_come_from_the_request(planned):
    for log in planned[4]["logs"]:
        assert log["header"] == HEADER
        assert log["vehicle"] == "Truck 101 / Trailer 202"
    first = planned[4]["logs"][0]
    assert first["from_place"] and first["to_place"]


def test_scenario_specific_expectations(planned):
    spec, _body, _points, _response, plan = planned
    if spec.get("expect_restart"):
        assert plan["summary"]["restarts"] >= 1
        assert plan["warnings"], "a restart comes with a warning"
        assert any(log["recap"]["restart_completed"] for log in plan["logs"])
    if "expect_days" in spec:
        assert plan["summary"]["days"] == spec["expect_days"]
    assert plan["assumptions"], "every plan lists its assumptions"
    assert spec["timezone"] in " ".join(plan["assumptions"])


def test_a_plan_without_a_header_still_matches_the_contract(api, rsps, real_engine, plan_payload):
    register_osrm(rsps)
    del plan_payload["header"]
    plan = api.post(URL, plan_payload, format="json").json()
    ts_contract.load().assert_matches(plan, "PlanResponse")
    assert set(plan["request"]["header"]) == set(HEADER)
    assert set(plan["request"]["header"].values()) == {""}
    assert plan["logs"][0]["vehicle"] == ""


def test_the_response_never_leaks_an_internal_field(planned):
    text = json.dumps(planned[4])
    for word in ("Traceback", "django", "sqlite", "SECRET", "password"):
        assert word.lower() not in text.lower(), word


def test_no_route_error_matches_the_error_contract(api, rsps, plan_payload):
    register_osrm(rsps, {"code": "NoRoute", "message": "Impossible route between points"}, status=200)
    response = api.post(URL, plan_payload, format="json")
    ts_contract.load().assert_matches(response.json(), "ApiErrorBody")
    assert response.status_code == 422


def test_validation_error_matches_the_error_contract(api, plan_payload):
    plan_payload["cycle_used_hours"] = 71
    response = api.post(URL, plan_payload, format="json")
    body = response.json()
    ts_contract.load().assert_matches(body, "ApiErrorBody")
    assert body["error"]["fields"]["cycle_used_hours"]


@pytest.mark.parametrize("name", ["plan-short.json", "plan-multiday.json"])
def test_the_frontend_fixtures_follow_the_same_contract(name):
    """The frontend renders these files in its tests. They must be shaped like real responses."""
    plan = strict_json((FIXTURES / name).read_bytes())
    ts_contract.load().assert_matches(plan, "PlanResponse")
