"""POST /api/plan: the happy path, what reaches the engine, and every way the request can be wrong."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import responses

from apps.planner import services
from apps.planner.types import PlanRequestData, RouteData
from tests.support.contract import assert_error, assert_plan_response
from tests.support.osrm import OSRM_ROUTE, osrm_payload, register_osrm, route_calls

URL = "/api/plan"


@pytest.fixture
def osrm(rsps):
    return register_osrm(rsps)


def test_plan_returns_a_full_plan_response(api, plan_payload, osrm):
    response = api.post(URL, plan_payload, format="json")

    assert response.status_code == 200
    plan = response.json()
    assert_plan_response(plan)
    assert plan["request"]["current"]["label"] == "Dallas, Texas, United States"
    assert plan["request"]["departure"] == "2026-10-07T06:00"
    assert plan["request"]["header"]["driver_name"] == "Dana Driver"
    assert plan["request"]["header"]["carrier_name"] == ""


def test_plan_works_without_an_account(api, plan_payload, osrm):
    assert api.post(URL, plan_payload, format="json").status_code == 200


def test_plan_sends_one_osrm_route_request_with_three_waypoints(api, plan_payload, rsps):
    register_osrm(rsps)

    api.post(URL, plan_payload, format="json")

    assert len(route_calls(rsps)) == 1
    url = route_calls(rsps)[0].request.url
    assert "/route/v1/driving/-96.797000,32.776700;-90.049000,35.149500;-104.990300,39.739200" in url
    assert "overview=full" in url and "geometries=geojson" in url and "steps=false" in url


def test_plan_hands_the_engine_validated_data(api, plan_payload, osrm, monkeypatch):
    seen = {}

    def spy(req: PlanRequestData, route: RouteData) -> dict:
        seen["req"], seen["route"] = req, route
        return {"ok": True}

    monkeypatch.setattr(services, "build_plan", spy)
    response = api.post(URL, plan_payload, format="json")

    assert response.json() == {"ok": True}
    req = seen["req"]
    assert req.cycle_used_hours == 24
    assert req.timezone == "America/Chicago"
    assert req.departure.utcoffset() == timedelta(hours=-5)  # CDT on 7 Oct 2026
    assert req.departure.replace(tzinfo=None) == datetime(2026, 10, 7, 6, 0)
    assert req.header["driver_name"] == "Dana Driver"
    assert req.header["commodity"] == ""
    assert set(req.header) == {
        "driver_name",
        "co_driver_name",
        "carrier_name",
        "main_office_address",
        "home_terminal_address",
        "truck_number",
        "trailer_number",
        "shipper",
        "commodity",
        "shipping_doc_no",
    }
    route = seen["route"]
    assert len(route.legs) == 2
    assert route.leg_end_indices[1] == len(route.coordinates) - 1
    assert route.legs[0].distance_miles == pytest.approx(osrm_payload()["routes"][0]["legs"][0]["distance"] / 1609.344)


def test_plan_uses_the_timezone_offset_in_force_on_the_departure_date(api, plan_payload, osrm, monkeypatch):
    captured = {}

    def spy(req, route):
        captured["req"] = req
        return {}

    monkeypatch.setattr(services, "build_plan", spy)

    plan_payload["departure"] = "2026-01-15T06:00"
    api.post(URL, plan_payload, format="json")

    assert captured["req"].departure.utcoffset() == timedelta(hours=-6)  # CST


def test_header_is_optional(api, plan_payload, osrm):
    del plan_payload["header"]
    assert api.post(URL, plan_payload, format="json").status_code == 200


def test_null_header_and_null_header_values_become_empty_strings(api, plan_payload, osrm):
    plan_payload["header"] = {"driver_name": None, "truck_number": "7"}
    plan = api.post(URL, plan_payload, format="json").json()
    assert plan["request"]["header"]["driver_name"] == ""
    assert plan["request"]["header"]["truck_number"] == "7"


def test_unknown_request_keys_are_ignored(api, plan_payload, osrm):
    plan_payload["is_admin"] = True
    plan_payload["header"]["favorite_color"] = "teal"
    assert api.post(URL, plan_payload, format="json").status_code == 200


def test_cycle_hours_boundaries_are_accepted(api, plan_payload, osrm):
    for hours in (0, 0.25, 70):
        plan_payload["cycle_used_hours"] = hours
        assert api.post(URL, plan_payload, format="json").status_code == 200, hours


def test_the_typed_wall_time_is_kept(api, plan_payload, osrm):
    plan_payload["timezone"] = "Pacific/Honolulu"
    plan_payload["departure"] = "2026-07-04T23:59"
    plan = api.post(URL, plan_payload, format="json").json()
    assert plan["request"]["departure"] == "2026-07-04T23:59"


# --- validation ---------------------------------------------------------------------------


def post_invalid(api, payload):
    response = api.post(URL, payload, format="json")
    return assert_error(response, 400, "validation_error", fields=True)["fields"]


def test_empty_body_lists_every_required_field(api):
    fields = post_invalid(api, {})
    assert set(fields) == {"current", "pickup", "dropoff", "cycle_used_hours", "departure", "timezone"}
    assert fields["current"] == ["Choose a current location."]
    assert fields["pickup"] == ["Choose a pickup location."]
    assert fields["dropoff"] == ["Choose a dropoff location."]


def test_a_non_object_body_is_one_general_error(api):
    response = api.post(URL, [1, 2], format="json")
    error = assert_error(response, 400, "validation_error", fields=True)
    assert list(error["fields"]) == ["non_field_errors"]


@pytest.mark.parametrize(
    ("lat", "lon", "message"),
    [
        (91, 0, "Latitude must be between -90 and 90."),
        (-90.0001, 0, "Latitude must be between -90 and 90."),
        (0, 180.5, "Longitude must be between -180 and 180."),
        (0, -181, "Longitude must be between -180 and 180."),
        ("12", 0, "Latitude must be a number."),
        (True, 0, "Latitude must be a number."),
        (None, 0, "Latitude is required."),
        (0, [1], "Longitude must be a number."),
    ],
)
def test_bad_coordinates_are_reported_under_the_place(api, plan_payload, lat, lon, message):
    plan_payload["pickup"] = {"label": "Somewhere", "lat": lat, "lon": lon}
    assert post_invalid(api, plan_payload) == {"pickup": [message]}


def test_missing_coordinates_name_which_part_is_missing(api, plan_payload):
    plan_payload["current"] = {"label": "Somewhere"}
    assert post_invalid(api, plan_payload) == {"current": ["Latitude is required.", "Longitude is required."]}


def test_place_must_be_an_object(api, plan_payload):
    plan_payload["dropoff"] = "Denver"
    assert post_invalid(api, plan_payload) == {"dropoff": ["A place needs a name, a latitude and a longitude."]}


@pytest.mark.parametrize("label", ["", "   ", None])
def test_blank_place_name_is_rejected(api, plan_payload, label):
    plan_payload["current"]["label"] = label
    assert post_invalid(api, plan_payload) == {"current": ["Place name is required."]}


def test_place_name_length_limit_is_200(api, plan_payload, osrm):
    plan_payload["current"]["label"] = "x" * 200
    assert api.post(URL, plan_payload, format="json").status_code == 200
    plan_payload["current"]["label"] = "x" * 201
    assert post_invalid(api, plan_payload) == {"current": ["Place name can be at most 200 characters."]}


@pytest.mark.parametrize("hours", [-0.01, 70.01, 1000, "10", True, None, [], {}])
def test_cycle_hours_out_of_range_or_wrong_type(api, plan_payload, hours):
    plan_payload["cycle_used_hours"] = hours
    fields = post_invalid(api, plan_payload)
    assert list(fields) == ["cycle_used_hours"]


@pytest.mark.parametrize(
    "departure",
    [
        "2026-10-07 06:00",
        "2026-10-07T06:00:00",
        "2026-10-07T6:00",
        "2026-13-07T06:00",
        "2026-02-30T06:00",
        "2026-10-07T25:00",
        "tomorrow",
        "２０２６-10-07T06:00",  # full-width digits
        "1999-12-31T23:59",
        "2101-01-01T00:00",
    ],
)
def test_departure_must_be_a_real_date_in_range(api, plan_payload, departure):
    plan_payload["departure"] = departure
    assert list(post_invalid(api, plan_payload)) == ["departure"]


@pytest.mark.parametrize(
    "zone",
    ["Mars/Olympus", "America", "../../etc/passwd", "America/Chicago\x00", "", " ", "x" * 65, "chicago", 5, None],
)
def test_timezone_must_be_a_known_iana_name(api, plan_payload, zone):
    plan_payload["timezone"] = zone
    assert list(post_invalid(api, plan_payload)) == ["timezone"]


def test_all_three_places_at_one_point_is_rejected(api, plan_payload):
    same = {"label": "Dallas", "lat": 32.7767, "lon": -96.797}
    plan_payload.update(current=same, pickup=dict(same), dropoff=dict(same))
    assert post_invalid(api, plan_payload) == {
        "dropoff": ["Choose at least one place that's different from the others."]
    }


def test_two_places_at_one_point_is_allowed(api, plan_payload, rsps):
    register_osrm(rsps, osrm_payload(((32.7767, -96.797), (32.7767, -96.797), (35.1495, -90.049))))
    plan_payload["pickup"] = dict(plan_payload["current"])
    assert api.post(URL, plan_payload, format="json").status_code == 200


@pytest.mark.parametrize("key", ["driver_name", "shipper", "shipping_doc_no"])
def test_header_values_are_limited_to_120_characters(api, plan_payload, key):
    plan_payload["header"][key] = "y" * 121
    assert post_invalid(api, plan_payload) == {f"header.{key}": ["Use at most 120 characters."]}


def test_several_problems_come_back_together(api, plan_payload):
    plan_payload["cycle_used_hours"] = 99
    plan_payload["departure"] = "soon"
    plan_payload["header"]["carrier_name"] = "z" * 500
    fields = post_invalid(api, plan_payload)
    assert set(fields) == {"cycle_used_hours", "departure", "header.carrier_name"}


def test_malformed_json_is_a_validation_error_with_no_fields(api):
    response = api.post(URL, "{not json", content_type="application/json")
    assert_error(response, 400, "validation_error", fields=False)


def test_non_json_content_type_is_415(api, plan_payload):
    response = api.post(URL, "a=b", content_type="application/x-www-form-urlencoded")
    assert_error(response, 415, "unsupported_media_type")


def test_get_is_405(api):
    assert_error(api.get(URL), 405, "method_not_allowed")


# --- routing failures ---------------------------------------------------------------------


@pytest.mark.parametrize("code", ["NoRoute", "NoSegment"])
def test_no_route_is_422(api, plan_payload, rsps, code):
    register_osrm(rsps, {"code": code, "message": "nope"})
    assert_error(api.post(URL, plan_payload, format="json"), 422, "no_route")


def test_no_route_sent_with_http_400_is_still_422(api, plan_payload, rsps):
    register_osrm(rsps, {"code": "NoRoute", "message": "Impossible route between points"}, status=400)
    assert_error(api.post(URL, plan_payload, format="json"), 422, "no_route")


def test_osrm_500_is_retried_once_then_502(api, plan_payload, rsps):
    register_osrm(rsps, "oops", status=500)
    error = assert_error(api.post(URL, plan_payload, format="json"), 502, "upstream_error")
    assert len(rsps.calls) == 2
    assert "osrm" not in error["message"].lower()


def test_osrm_that_recovers_on_retry_succeeds(api, plan_payload, rsps):
    rsps.add(responses.GET, OSRM_ROUTE, body="down", status=503)
    register_osrm(rsps)
    assert api.post(URL, plan_payload, format="json").status_code == 200
    assert len(route_calls(rsps)) == 2


def test_osrm_garbage_is_502(api, plan_payload, rsps):
    register_osrm(rsps, "<html>not json</html>")
    assert_error(api.post(URL, plan_payload, format="json"), 502, "upstream_error")


def test_a_route_over_the_distance_cap_is_422(api, plan_payload, rsps):
    # Dallas to a point near the other side of the planet, at a believable road factor.
    register_osrm(rsps, osrm_payload(((32.7767, -96.797), (35.1495, -90.049), (-33.9, 151.2)), road_factor=1.3))
    error = assert_error(api.post(URL, plan_payload, format="json"), 422, "route_too_long")
    assert "10,000" in error["message"]


def test_engine_refusing_a_trip_is_422_not_500(api, plan_payload, osrm, monkeypatch):
    from apps.planner.hos.models import EngineError

    def refuse(req, route):
        raise EngineError("The simulation did not finish.")

    monkeypatch.setattr(services, "build_plan", refuse)
    error = assert_error(api.post(URL, plan_payload, format="json"), 422, "plan_failed")
    assert "simulation" not in error["message"]


def test_the_plan_response_is_never_cached(api, plan_payload, osrm):
    assert api.post(URL, plan_payload, format="json")["Cache-Control"] == "no-store"


# --- the real engine ----------------------------------------------------------------------


def test_real_engine_plan_for_the_example_trip(api, plan_payload, osrm, real_engine):
    plan = api.post(URL, plan_payload, format="json").json()

    assert_plan_response(plan)
    assert plan["summary"]["days"] == len(plan["logs"])
    assert plan["stops"][0]["kind"] == "start"
    assert plan["stops"][-1]["kind"] == "end"
    departure = datetime.fromisoformat(plan["summary"]["depart_at"])
    assert departure.utcoffset() == timezone(timedelta(hours=-5)).utcoffset(None)
    for log in plan["logs"]:
        assert sum(log["totals"].values()) == 1440
        assert log["entries"][0]["start_min"] == 0
        assert log["entries"][-1]["end_min"] == 1440


def test_real_engine_adds_a_restart_when_the_cycle_is_spent(api, plan_payload, osrm, real_engine):
    plan_payload["cycle_used_hours"] = 70
    plan = api.post(URL, plan_payload, format="json").json()
    assert plan["summary"]["restarts"] >= 1
    assert plan["warnings"]
