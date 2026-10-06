"""The OSRM turn list: the second, best-effort request and the parser that reads it."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
import requests
import responses
from django.conf import settings

from apps.common.errors import UpstreamError
from apps.planner.providers import http, osrm
from tests.support.osrm import DEFAULT_WAYPOINTS, OSRM_ROUTE, osrm_steps_payload, register_osrm

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "osrm-steps-la-phoenix-new-york.json"
METERS_PER_MILE = 1609.344


def register_steps(rsps, payload=None, status=200, **kwargs):
    body = osrm_steps_payload() if payload is None else payload
    if isinstance(body, str | bytes | Exception):
        return rsps.add(responses.GET, OSRM_ROUTE, body=body, status=status, **kwargs)
    return rsps.add(responses.GET, OSRM_ROUTE, json=body, status=status, **kwargs)


def payload_with(**changes):
    data = osrm_steps_payload()
    data["routes"][0]["legs"][0]["steps"][1].update(changes)
    return data


# --- the request -------------------------------------------------------------------------


def test_fetch_steps_sends_the_documented_query(rsps):
    register_steps(rsps)
    osrm.fetch_steps(DEFAULT_WAYPOINTS)

    request = rsps.calls[0].request
    assert request.params == {
        "overview": "false",
        "steps": "true",
        "geometries": "polyline",
        "annotations": "false",
    }
    assert request.url.startswith(osrm.route_url(DEFAULT_WAYPOINTS) + "?")
    assert request.headers["User-Agent"].startswith("ELDTripPlanner/")
    assert request.headers["Accept"] == "application/json"


def test_the_turn_list_gets_a_shorter_read_timeout_than_the_route(rsps):
    register_steps(rsps)
    osrm.fetch_steps(DEFAULT_WAYPOINTS)
    assert rsps.calls[0].request.req_kwargs["timeout"] == (
        http.CONNECT_TIMEOUT_SECONDS,
        http.STEPS_READ_TIMEOUT_SECONDS,
    )
    assert http.STEPS_READ_TIMEOUT_SECONDS < http.READ_TIMEOUT_SECONDS


def test_the_size_cap_was_set_from_a_measurement_with_room_to_spare():
    # Measured: 479,216 bytes for 2,783 miles. The longest route the planner accepts, at that density.
    bytes_per_mile = 479_216 / 2_783
    assert 2 * bytes_per_mile * settings.MAX_ROUTE_MILES <= http.OSRM_STEPS_MAX_BYTES
    assert http.OSRM_STEPS_MAX_BYTES <= http.OSRM_MAX_BYTES


def test_the_route_request_is_unchanged(rsps):
    register_osrm(rsps)
    osrm.fetch_route(DEFAULT_WAYPOINTS)
    assert rsps.calls[0].request.params == {"overview": "full", "geometries": "geojson", "steps": "false"}


# --- reading a good answer ---------------------------------------------------------------


def test_a_realistic_answer_gives_the_steps_of_both_legs():
    data = osrm_steps_payload()
    first, second = osrm.parse_steps(data)

    assert len(first) == len(second) == len(data["routes"][0]["legs"][0]["steps"])
    for steps, leg in zip((first, second), data["routes"][0]["legs"], strict=True):
        assert steps[0].maneuver == "depart" and steps[-1].maneuver == "arrive"
        assert sum(s.distance_miles for s in steps) == pytest.approx(leg["distance"] / METERS_PER_MILE)
        assert steps[-1].distance_miles == 0


def test_a_step_is_read_into_miles_text_a_place_and_a_bearing():
    data = osrm_steps_payload()
    raw = data["routes"][0]["legs"][0]["steps"][3]
    step = osrm.parse_steps(data)[0][3]

    assert step.distance_miles == pytest.approx(raw["distance"] / METERS_PER_MILE)
    assert (step.name, step.ref) == (raw["name"], raw["ref"])
    assert step.maneuver == raw["maneuver"]["type"]
    assert step.bearing_after == raw["maneuver"]["bearing_after"]
    lon, lat = raw["maneuver"]["location"]
    assert (step.lat, step.lon) == (lat, lon), "the router sends lon first"


def test_a_missing_ref_reads_as_empty_text():
    first, _ = osrm.parse_steps(osrm_steps_payload())
    assert first[0].ref == ""


def test_the_real_cross_country_answer_is_read_whole():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    first, second = osrm.parse_steps(payload)

    assert (len(first), len(second)) == (23, 96)
    assert (first[0].name, first[0].bearing_after, first[0].maneuver) == ("West 1st Street", 129.0, "depart")
    assert first[4].ref == "US 101; US 99 Hist", "the raw reference is kept, the planner picks the first part"
    assert second[-1].maneuver == "arrive" and second[-1].distance_miles == 0
    total = sum(s.distance_miles for s in first)
    assert total == pytest.approx(payload["routes"][0]["legs"][0]["distance"] / METERS_PER_MILE)


def test_fetch_steps_reads_an_answer_over_the_wire(rsps):
    register_steps(rsps)
    first, second = osrm.fetch_steps(DEFAULT_WAYPOINTS)
    assert first and second


# --- reading odd answers -----------------------------------------------------------------


@pytest.mark.parametrize("payload", [None, [], "Ok", 7, {}, {"code": "Ok"}], ids=repr)
def test_an_answer_that_is_not_a_route_is_refused(payload):
    with pytest.raises(UpstreamError):
        osrm.parse_steps(payload)


@pytest.mark.parametrize("code", ["NoRoute", "NoSegment", "InvalidQuery", "TooBig", "", None, 200])
def test_any_code_but_ok_is_refused(code):
    data = osrm_steps_payload()
    data["code"] = code
    with pytest.raises(UpstreamError):
        osrm.parse_steps(data)


@pytest.mark.parametrize(
    "routes",
    [
        None,
        [],
        "x",
        [None],
        [{}],
        [{"legs": None}],
        [{"legs": []}],
        [{"legs": "x"}],
        [{"legs": [{}]}],
        [{"legs": [{}, {}, {}]}],
    ],
    ids=repr,
)
def test_a_reply_without_two_legs_is_refused(routes):
    data = osrm_steps_payload()
    data["routes"] = routes
    with pytest.raises(UpstreamError):
        osrm.parse_steps(data)


def test_a_leg_that_is_not_an_object_is_refused():
    data = osrm_steps_payload()
    data["routes"][0]["legs"][1] = "x"
    with pytest.raises(UpstreamError):
        osrm.parse_steps(data)


@pytest.mark.parametrize("steps", [None, "x", 5, {"a": 1}])
def test_a_leg_whose_steps_are_not_a_list_has_no_steps(steps):
    data = osrm_steps_payload()
    data["routes"][0]["legs"][0]["steps"] = steps
    first, second = osrm.parse_steps(data)
    assert first == () and second


def test_a_leg_with_an_empty_step_list_has_no_steps():
    data = osrm_steps_payload()
    data["routes"][0]["legs"][1]["steps"] = []
    assert osrm.parse_steps(data)[1] == ()


@pytest.mark.parametrize("item", [None, "x", 5, [], {}, {"distance": "far"}, {"distance": -1}, {"distance": True}])
def test_a_step_that_cannot_be_read_is_skipped(item):
    data = osrm_steps_payload()
    steps = data["routes"][0]["legs"][0]["steps"]
    steps.insert(2, item)
    assert len(osrm.parse_steps(data)[0]) == len(steps) - 1


@pytest.mark.parametrize("distance", [float("nan"), float("inf")])
def test_a_step_with_a_distance_that_is_not_finite_is_skipped(distance):
    data = osrm_steps_payload()
    data["routes"][0]["legs"][0]["steps"][2]["distance"] = distance
    steps = data["routes"][0]["legs"][0]["steps"]
    # Python's json would write NaN. Real replies never do, and the HTTP layer refuses them. Parse the dict directly.
    assert len(osrm.parse_steps(data)[0]) == len(steps) - 1


@pytest.mark.parametrize(
    "location",
    [None, "x", [], [1], ["a", "b"], [200, 0], [0, 95], [None, None], {"lon": 1, "lat": 2}, [True, False]],
    ids=repr,
)
def test_a_step_with_a_bad_location_is_kept_without_one(location):
    data = osrm_steps_payload()
    data["routes"][0]["legs"][0]["steps"][2]["maneuver"]["location"] = location
    step = osrm.parse_steps(data)[0][2]
    assert (step.lat, step.lon) == (None, None)
    assert step.distance_miles > 0


@pytest.mark.parametrize("maneuver", [None, "x", [], 5])
def test_a_step_with_no_maneuver_is_kept_with_nothing_known_about_it(maneuver):
    data = osrm_steps_payload()
    data["routes"][0]["legs"][0]["steps"][2]["maneuver"] = maneuver
    step = osrm.parse_steps(data)[0][2]
    assert (step.maneuver, step.lat, step.lon, step.bearing_after) == ("", None, None, None)


@pytest.mark.parametrize("bearing", [None, "north", [], True])
def test_a_bearing_that_is_not_a_number_reads_as_missing(bearing):
    data = osrm_steps_payload()
    data["routes"][0]["legs"][0]["steps"][2]["maneuver"]["bearing_after"] = bearing
    assert osrm.parse_steps(data)[0][2].bearing_after is None


@pytest.mark.parametrize("value", [None, 5, ["I 40"], {"a": 1}])
def test_a_name_or_ref_that_is_not_text_reads_as_empty(value):
    step = osrm.parse_steps(payload_with(name=value, ref=value))[0][1]
    assert (step.name, step.ref) == ("", "")


def test_markup_in_a_road_name_comes_through_as_text():
    step = osrm.parse_steps(payload_with(name="<img src=x onerror=alert(1)>"))[0][1]
    assert step.name == "<img src=x onerror=alert(1)>"


def test_parsing_does_not_change_its_input():
    data = osrm_steps_payload()
    before = copy.deepcopy(data)
    osrm.parse_steps(data)
    assert data == before


# --- over the wire: every way it can go wrong --------------------------------------------


@pytest.mark.parametrize("status", [500, 502, 503])
def test_a_server_error_is_one_upstream_error_and_no_retry(rsps, status):
    register_steps(rsps, "oops", status=status)
    with pytest.raises(UpstreamError):
        osrm.fetch_steps(DEFAULT_WAYPOINTS)
    assert len(rsps.calls) == 1


@pytest.mark.parametrize("status", [400, 401, 404, 429])
def test_a_client_error_is_an_upstream_error(rsps, status):
    register_steps(rsps, {"code": "NoRoute", "message": "no"}, status=status)
    with pytest.raises(UpstreamError):
        osrm.fetch_steps(DEFAULT_WAYPOINTS)


def test_a_redirect_is_not_followed(rsps):
    rsps.add(responses.GET, OSRM_ROUTE, status=302, headers={"Location": "https://evil.example/route"})
    with pytest.raises(UpstreamError):
        osrm.fetch_steps(DEFAULT_WAYPOINTS)
    assert len(rsps.calls) == 1


def test_a_timeout_is_an_upstream_error_and_not_retried(rsps):
    register_steps(rsps, requests.exceptions.ReadTimeout())
    with pytest.raises(UpstreamError, match="too long"):
        osrm.fetch_steps(DEFAULT_WAYPOINTS)
    assert len(rsps.calls) == 1


def test_a_dead_connection_is_an_upstream_error_and_not_retried(rsps):
    register_steps(rsps, requests.exceptions.ConnectionError())
    with pytest.raises(UpstreamError):
        osrm.fetch_steps(DEFAULT_WAYPOINTS)
    assert len(rsps.calls) == 1


@pytest.mark.parametrize("body", ["<html>nope</html>", "", "{", "[1, 2", "NaN"])
def test_a_body_that_is_not_json_is_an_upstream_error(rsps, body):
    register_steps(rsps, body)
    with pytest.raises(UpstreamError):
        osrm.fetch_steps(DEFAULT_WAYPOINTS)


def test_a_non_ok_code_with_status_200_is_an_upstream_error(rsps):
    register_steps(rsps, {"code": "InvalidQuery", "message": "bad"})
    with pytest.raises(UpstreamError):
        osrm.fetch_steps(DEFAULT_WAYPOINTS)


def padded(extra_bytes: int) -> bytes:
    body = json.dumps(osrm_steps_payload() | {"padding": ""})
    return body.replace('"padding": ""', '"padding": "' + "x" * extra_bytes + '"').encode()


def test_an_answer_just_under_the_cap_is_read(rsps):
    body = padded(http.OSRM_STEPS_MAX_BYTES - 64 * 1024)
    assert len(body) < http.OSRM_STEPS_MAX_BYTES
    register_steps(rsps, body)
    assert all(osrm.fetch_steps(DEFAULT_WAYPOINTS))


def test_an_answer_over_the_cap_is_refused_while_streaming(rsps):
    body = padded(http.OSRM_STEPS_MAX_BYTES + 1024)
    register_steps(rsps, body)
    with pytest.raises(UpstreamError, match="more data"):
        osrm.fetch_steps(DEFAULT_WAYPOINTS)


def test_an_answer_that_admits_to_being_over_the_cap_is_refused_up_front(rsps):
    register_steps(rsps, b"{}", headers={"Content-Length": str(http.OSRM_STEPS_MAX_BYTES + 1)})
    with pytest.raises(UpstreamError, match="more data"):
        osrm.fetch_steps(DEFAULT_WAYPOINTS)
