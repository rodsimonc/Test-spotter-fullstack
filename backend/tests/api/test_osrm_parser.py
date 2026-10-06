"""The OSRM client: URL building, the response parser and the odd answers real servers send."""

from __future__ import annotations

import copy
import math

import pytest
import responses

from apps.common.errors import NoRouteError, UpstreamError
from apps.planner.providers import osrm
from tests.support.osrm import DALLAS, DEFAULT_WAYPOINTS, DENVER, MEMPHIS, OSRM_ROUTE, osrm_payload, register_osrm


def payload(**kwargs):
    return osrm_payload(**kwargs)


# --- URL ----------------------------------------------------------------------------------


def test_route_url_puts_lon_before_lat_with_six_decimals():
    url = osrm.route_url(DEFAULT_WAYPOINTS)
    assert url == ("https://osrm.test/route/v1/driving/-96.797000,32.776700;-90.049000,35.149500;-104.990300,39.739200")


def test_route_url_is_built_from_numbers_only():
    # Tiny values must not turn into scientific notation.
    url = osrm.route_url([(0.0, -0.0), (1e-9, 2.5), (-45.1234567, 170.0)])
    assert url.endswith("/driving/-0.000000,0.000000;2.500000,0.000000;170.000000,-45.123457")


def test_fetch_route_sends_the_documented_query(rsps):
    register_osrm(rsps)
    osrm.fetch_route(DEFAULT_WAYPOINTS)
    request = rsps.calls[0].request
    assert request.params == {"overview": "full", "geometries": "geojson", "steps": "false"}
    assert request.headers["User-Agent"].startswith("ELDTripPlanner/")
    assert request.headers["Accept"] == "application/json"


# --- happy path ---------------------------------------------------------------------------


def test_parse_converts_units_and_swaps_axes():
    data = payload(points_per_leg=10)
    route = osrm.parse_route(data)

    first_leg = data["routes"][0]["legs"][0]
    assert route.legs[0].distance_miles == pytest.approx(first_leg["distance"] / 1609.344)
    assert route.legs[0].osrm_duration_minutes == pytest.approx(first_leg["duration"] / 60)
    assert route.coordinates[0] == pytest.approx(DALLAS)
    assert route.coordinates[-1] == pytest.approx(DENVER)
    assert route.coordinates[10] == pytest.approx(MEMPHIS)


def test_leg_end_indices_land_on_the_pickup_and_the_last_point():
    route = osrm.parse_route(payload(points_per_leg=10))
    assert route.leg_end_indices == (10, 20)
    assert len(route.coordinates) == 21


def test_the_pickup_snaps_to_the_nearest_point_when_osrm_moves_it():
    data = payload(points_per_leg=10)
    lon, lat = data["waypoints"][1]["location"]
    # A few metres from the line, as when a place is snapped to the road.
    data["waypoints"][1]["location"] = [lon + 0.00002, lat - 0.00002]
    assert osrm.parse_route(data).leg_end_indices[0] == 10


def test_a_point_the_route_visits_twice_resolves_to_its_first_visit():
    # Out along one line and back over the same points.
    line = [[-100.0 + i, 40.0] for i in range(6)] + [[-95.0 - i, 40.0] for i in range(1, 6)]
    data = payload()
    data["routes"][0]["geometry"]["coordinates"] = line
    data["waypoints"][1]["location"] = [-98.0, 40.0]
    assert osrm.parse_route(data).leg_end_indices == (2, 10)


def test_a_single_point_route_becomes_a_two_point_zero_length_line():
    data = payload()
    data["routes"][0]["geometry"]["coordinates"] = [[-96.797, 32.7767]]
    data["routes"][0]["legs"] = [
        {"distance": 0.0, "duration": 0.0, "summary": "", "steps": []},
        {"distance": 0.0, "duration": 0.0, "summary": "", "steps": []},
    ]
    data["waypoints"][1]["location"] = [-96.797, 32.7767]
    route = osrm.parse_route(data)
    assert len(route.coordinates) == 2
    assert route.leg_end_indices == (0, 1)


def test_extra_fields_and_third_coordinate_values_are_ignored():
    data = payload(points_per_leg=5)
    data["routes"][0]["geometry"]["coordinates"] = [
        [lon, lat, 12.5] for lon, lat in data["routes"][0]["geometry"]["coordinates"]
    ]
    data["routes"][0]["weight_name"] = "routability"
    data["extra"] = {"anything": True}
    assert len(osrm.parse_route(data).coordinates) == 11


# --- no route -----------------------------------------------------------------------------


@pytest.mark.parametrize("code", ["NoRoute", "NoSegment"])
def test_no_route_codes_raise_no_route(code):
    with pytest.raises(NoRouteError) as caught:
        osrm.parse_route({"code": code, "message": "x"})
    assert caught.value.status_code == 422
    assert caught.value.code == "no_route"


def test_no_segment_message_points_at_the_road_problem():
    with pytest.raises(NoRouteError, match="too far from a road"):
        osrm.parse_route({"code": "NoSegment"})


@pytest.mark.parametrize("code", ["InvalidQuery", "InvalidUrl", "TooBig", "InvalidValue", "", None, 7])
def test_other_codes_are_upstream_errors(code):
    with pytest.raises(UpstreamError):
        osrm.parse_route({"code": code})


# --- malformed answers --------------------------------------------------------------------


def broken(mutate):
    data = payload(points_per_leg=5)
    mutate(data)
    return data


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.pop("routes"),
        lambda d: d.update(routes=[]),
        lambda d: d.update(routes="nope"),
        lambda d: d.update(routes=[None]),
        lambda d: d["routes"][0].pop("geometry"),
        lambda d: d["routes"][0].update(geometry=None),
        lambda d: d["routes"][0]["geometry"].update(type="Point"),
        lambda d: d["routes"][0]["geometry"].update(coordinates=[]),
        lambda d: d["routes"][0]["geometry"].update(coordinates="abc"),
        lambda d: d["routes"][0]["geometry"].update(coordinates=[[1]]),
        lambda d: d["routes"][0]["geometry"].update(coordinates=[["a", "b"], ["c", "d"]]),
        lambda d: d["routes"][0]["geometry"].update(coordinates=[[-96, 32], [-181, 32]]),
        lambda d: d["routes"][0]["geometry"].update(coordinates=[[-96, 32], [-96, 91]]),
        lambda d: d["routes"][0]["geometry"].update(coordinates=[[-96, 32], [math.nan, 32]]),
        lambda d: d["routes"][0]["geometry"].update(coordinates=[[-96, 32], [math.inf, 32]]),
        lambda d: d["routes"][0]["geometry"].update(coordinates=[[-96, 32], [True, 32]]),
        lambda d: d["routes"][0].pop("legs"),
        lambda d: d["routes"][0].update(legs=d["routes"][0]["legs"][:1]),
        lambda d: d["routes"][0].update(legs=d["routes"][0]["legs"] * 2),
        lambda d: d["routes"][0]["legs"][0].update(distance=-1),
        lambda d: d["routes"][0]["legs"][0].update(duration=-1),
        lambda d: d["routes"][0]["legs"][0].update(distance="far"),
        lambda d: d["routes"][0]["legs"][0].update(distance=math.nan),
        lambda d: d["routes"][0]["legs"][0].pop("duration"),
        lambda d: d["routes"][0]["legs"].__setitem__(0, "leg"),
        lambda d: d.pop("waypoints"),
        lambda d: d.update(waypoints=[d["waypoints"][0]]),
        lambda d: d["waypoints"][1].pop("location"),
        lambda d: d["waypoints"][1].update(location=[1]),
        lambda d: d["waypoints"][1].update(location=["x", "y"]),
        lambda d: d["waypoints"].__setitem__(1, None),
    ],
)
def test_malformed_routes_are_upstream_errors(mutate):
    with pytest.raises(UpstreamError):
        osrm.parse_route(broken(mutate))


@pytest.mark.parametrize("data", [None, [], "Ok", 3, [{"code": "Ok"}]])
def test_non_object_answers_are_upstream_errors(data):
    with pytest.raises(UpstreamError):
        osrm.parse_route(data)


def test_the_parser_never_mutates_its_input():
    data = payload(points_per_leg=5)
    before = copy.deepcopy(data)
    osrm.parse_route(data)
    assert data == before


# --- over the wire ------------------------------------------------------------------------


def test_fetch_route_reads_a_real_looking_answer(rsps):
    register_osrm(rsps)
    route = osrm.fetch_route(DEFAULT_WAYPOINTS)
    assert route.coordinates[0] == pytest.approx(DALLAS)
    assert route.leg_end_indices[1] == len(route.coordinates) - 1


def test_http_400_with_no_route_json_is_no_route(rsps):
    register_osrm(rsps, {"code": "NoRoute"}, status=400)
    with pytest.raises(NoRouteError):
        osrm.fetch_route(DEFAULT_WAYPOINTS)


def test_http_400_with_invalid_query_is_upstream_error(rsps):
    register_osrm(rsps, {"code": "InvalidQuery"}, status=400)
    with pytest.raises(UpstreamError):
        osrm.fetch_route(DEFAULT_WAYPOINTS)


def test_http_429_says_the_service_is_busy(rsps):
    register_osrm(rsps, {"message": "Too Many Requests"}, status=429)
    with pytest.raises(UpstreamError, match="busy"):
        osrm.fetch_route(DEFAULT_WAYPOINTS)


@pytest.mark.parametrize("status", [401, 403, 404])
def test_other_client_errors_are_upstream_errors(rsps, status):
    register_osrm(rsps, {"code": "Ok"}, status=status)
    with pytest.raises(UpstreamError):
        osrm.fetch_route(DEFAULT_WAYPOINTS)


def test_redirects_are_not_followed(rsps):
    rsps.add(responses.GET, OSRM_ROUTE, status=302, headers={"Location": "https://evil.example/route"})
    with pytest.raises(UpstreamError):
        osrm.fetch_route(DEFAULT_WAYPOINTS)
    assert len(rsps.calls) == 1


def test_a_continent_sized_answer_fits_under_the_cap(rsps):
    big = osrm_payload(points_per_leg=20000)  # about 2 MB of JSON
    register_osrm(rsps, big)
    assert len(osrm.fetch_route(DEFAULT_WAYPOINTS).coordinates) == 40001


def test_an_answer_over_5_mb_is_rejected_while_streaming(rsps):
    rsps.add(responses.GET, OSRM_ROUTE, body=b"[" + b"1," * (3 * 1024 * 1024) + b"1]")
    with pytest.raises(UpstreamError, match="more data"):
        osrm.fetch_route(DEFAULT_WAYPOINTS)


def test_an_answer_that_admits_to_being_over_5_mb_is_rejected_up_front(rsps):
    rsps.add(responses.GET, OSRM_ROUTE, body=b"{}", headers={"Content-Length": str(6 * 1024 * 1024)})
    with pytest.raises(UpstreamError, match="more data"):
        osrm.fetch_route(DEFAULT_WAYPOINTS)
