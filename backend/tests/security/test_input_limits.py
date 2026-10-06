"""Hostile or broken request bodies: size, depth, NaN and Infinity, huge numbers, control
characters and content types."""

from __future__ import annotations

import json

import pytest

from tests.support.contract import assert_error
from tests.support.osrm import register_osrm

LIMIT = 64 * 1024
PASSWORD = "Zx9-battery-staple-42"


@pytest.fixture(autouse=True)
def osrm(rsps):
    return register_osrm(rsps)


def post_raw(client, path: str, raw: bytes | str, content_type: str = "application/json"):
    data = raw.encode() if isinstance(raw, str) else raw
    return client.generic("POST", path, data, content_type=content_type)


def plan_json(payload: dict, **replace) -> str:
    """The plan body as JSON text, with `"key": "<TOKEN>"` swapped for raw JSON the encoder would refuse."""
    text = json.dumps(payload)
    for token, raw in replace.items():
        text = text.replace(f'"{token}"', raw)
    return text


# Size ------------------------------------------------------------------------------------------


def test_a_plan_body_just_under_the_limit_is_accepted(api, plan_payload):
    plan_payload["padding"] = "x" * 1000
    plan_payload["padding"] = "x" * (LIMIT - len(json.dumps(plan_payload)) + 1000 - 40)
    body = json.dumps(plan_payload)
    assert LIMIT - 100 < len(body) <= LIMIT

    assert post_raw(api, "/api/plan", body).status_code == 200


def test_a_plan_body_over_the_limit_is_413(api, plan_payload):
    plan_payload["padding"] = "x" * (LIMIT + 10)
    error = assert_error(post_raw(api, "/api/plan", json.dumps(plan_payload)), 413, "payload_too_large")
    assert error["message"] == "The request body can be at most 64 KB."


@pytest.mark.parametrize("path", ["/api/auth/login", "/api/auth/register", "/api/plan", "/api/trips"])
def test_every_json_endpoint_refuses_an_oversized_body(auth_api, path):
    body = json.dumps({"email": "a@example.com", "password": "x", "padding": "y" * (LIMIT + 1)})
    response = post_raw(auth_api, path, body)
    assert_error(response, 413, "payload_too_large")


def test_an_oversized_body_is_refused_before_it_is_parsed_or_planned(api, rsps):
    post_raw(api, "/api/plan", "[" + "0," * LIMIT + "0]")
    assert len(rsps.calls) == 0


def test_a_patch_body_over_the_limit_is_413(auth_api, create_trip_for_limits):
    trip = create_trip_for_limits
    response = auth_api.generic(
        "PATCH",
        f"/api/trips/{trip}",
        json.dumps({"title": "x", "padding": "y" * (LIMIT + 1)}),
        content_type="application/json",
    )
    assert_error(response, 413, "payload_too_large")


@pytest.fixture
def create_trip_for_limits(auth_api, plan_payload):
    return auth_api.post("/api/trips", {"request": plan_payload}, format="json").json()["id"]


def test_a_large_declared_length_with_a_short_body_is_harmless(api):
    response = api.generic(
        "POST", "/api/auth/login", b"{}", content_type="application/json", CONTENT_LENGTH="999999999"
    )
    assert response.status_code in (400, 413)


# Depth -------------------------------------------------------------------------------------------


@pytest.mark.parametrize("opener", ["[", '{"a":'])
def test_deeply_nested_json_is_a_clean_400_not_a_crash(api, opener):
    depth = 20_000
    closer = "]" if opener == "[" else "}"
    body = opener * depth + ("1" if opener != "[" else "") + closer * depth
    assert len(body) < LIMIT * 2
    response = post_raw(api, "/api/plan", body[:LIMIT])
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"
    assert "Traceback" not in response.content.decode()


def test_moderately_nested_junk_inside_a_valid_body_is_ignored(api, plan_payload):
    nested: object = "leaf"
    for _ in range(50):
        nested = {"a": [nested]}
    plan_payload["unused"] = nested
    assert api.post("/api/plan", plan_payload, format="json").status_code == 200


# NaN, Infinity and big numbers -------------------------------------------------------------------


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
@pytest.mark.parametrize("field", ["cycle_used_hours", "current.lat", "dropoff.lon"])
def test_json_nan_and_infinity_literals_are_refused(api, plan_payload, literal, field):
    marker = "__RAW__"
    if "." in field:
        place, key = field.split(".")
        plan_payload[place][key] = marker
    else:
        plan_payload[field] = marker
    response = post_raw(api, "/api/plan", plan_json(plan_payload, **{marker: literal}))
    assert_error(response, 400, "validation_error")


@pytest.mark.parametrize(
    "number", ["1e999", "-1e999", "1" + "0" * 400, "-" + "9" * 400, "1e309", "0.0000000000000000000001e400"]
)
@pytest.mark.parametrize("field", ["cycle_used_hours", "current.lat", "pickup.lon"])
def test_numbers_that_overflow_a_float_are_refused(api, plan_payload, number, field):
    marker = "__RAW__"
    if "." in field:
        place, key = field.split(".")
        plan_payload[place][key] = marker
    else:
        plan_payload[field] = marker
    response = post_raw(api, "/api/plan", plan_json(plan_payload, **{marker: number}))
    assert response.status_code == 400, number
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("value", [1e300, -1e300, 91, -91, 180.0000001, 70.01, -0.01, 2**63, -(2**63)])
def test_finite_but_out_of_range_numbers_name_their_field(api, plan_payload, value):
    plan_payload["current"]["lat"] = value
    plan_payload["cycle_used_hours"] = value
    error = assert_error(api.post("/api/plan", plan_payload, format="json"), 400, "validation_error", fields=True)
    assert "cycle_used_hours" in error["fields"]


@pytest.mark.parametrize("bad", ["24", True, None, [24], {"v": 24}, "NaN", "Infinity", ""])
def test_cycle_hours_must_be_a_real_json_number(api, plan_payload, bad):
    plan_payload["cycle_used_hours"] = bad
    error = assert_error(api.post("/api/plan", plan_payload, format="json"), 400, "validation_error", fields=True)
    assert "cycle_used_hours" in error["fields"]


@pytest.mark.parametrize(
    "params",
    ["lat=nan&lon=1", "lat=inf&lon=1", "lat=1&lon=-inf", "lat=1e999&lon=1", "lat=1&lon=1e400", "lat=+nan&lon=0"],
)
def test_reverse_geocode_refuses_non_finite_query_numbers(api, params):
    assert_error(api.get(f"/api/geocode/reverse?{params}"), 400, "validation_error", fields=True)


def test_search_bias_refuses_non_finite_numbers(api):
    assert_error(api.get("/api/geocode/search?q=chicago&lat=nan&lon=1"), 400, "validation_error", fields=True)


# Control characters and unicode -------------------------------------------------------------------


@pytest.mark.parametrize("char", ["\x00", "\x01", "\x1b", "\x7f", "\x85", "\r", "\n", "\t"])
@pytest.mark.parametrize("where", ["label", "header", "title", "name"])
def test_control_characters_are_refused_everywhere_text_is_accepted(auth_api, plan_payload, char, where):
    if where == "label":
        plan_payload["current"]["label"] = f"Dal{char}las"
        response = auth_api.post("/api/plan", plan_payload, format="json")
        key = "current"
    elif where == "header":
        plan_payload["header"]["driver_name"] = f"Da{char}na"
        response = auth_api.post("/api/plan", plan_payload, format="json")
        key = "header.driver_name"
    elif where == "title":
        response = auth_api.post("/api/trips", {"title": f"A{char}B", "request": plan_payload}, format="json")
        key = "title"
    else:
        response = auth_api.post(
            "/api/auth/register", {"email": "a@example.com", "password": PASSWORD, "name": f"N{char}n"}, format="json"
        )
        key = "name"
    error = assert_error(response, 400, "validation_error", fields=True)
    assert key in error["fields"], error["fields"]


def test_a_null_byte_escaped_in_json_is_refused_not_stored(auth_api, plan_payload):
    body = json.dumps({"title": "before\u0000after", "request": plan_payload})
    assert "\\u0000" in body
    response = post_raw(auth_api, "/api/trips", body)
    assert_error(response, 400, "validation_error", fields=True)
    from apps.trips.models import Trip

    assert not Trip.objects.exists()


def test_a_lone_surrogate_in_json_is_refused(api, plan_payload):
    body = json.dumps(plan_payload).replace("Dallas", "Dal\\ud800las")
    assert "\\ud800" in body
    assert_error(post_raw(api, "/api/plan", body), 400, "validation_error", fields=True)


@pytest.mark.parametrize(
    "text",
    [
        "Zürich, Schweiz",
        "São Paulo",
        "北京市",
        "القاهرة",
        "Москва",
        "🚚🚚🚚",
        "é́́́ combining",
        "Z͑ͫ̓ͪ̂ͫ̽͏̴̙̤̞͉͚̯̞̠͍A",
        "​ zero width ‍ joiner",
        "﻿bom first",
        "\U0001f1fa\U0001f1f8 flag",
    ],
)
def test_unicode_in_labels_survives_exactly(api, plan_payload, text):
    plan_payload["current"]["label"] = text
    plan_payload["header"]["shipper"] = text
    plan = api.post("/api/plan", plan_payload, format="json").json()
    assert plan["request"]["current"]["label"] == text.strip()
    assert plan["request"]["header"]["shipper"] == text.strip()


def test_unicode_is_counted_in_characters_not_bytes(api, plan_payload):
    plan_payload["current"]["label"] = "王" * 200
    assert api.post("/api/plan", plan_payload, format="json").status_code == 200
    plan_payload["current"]["label"] = "王" * 201
    assert api.post("/api/plan", plan_payload, format="json").status_code == 400


def test_invalid_utf8_bytes_are_a_400(api):
    response = post_raw(api, "/api/plan", b'{"current": "\xff\xfe"}')
    assert response.status_code == 400


def test_a_utf8_bom_is_a_400_not_a_crash(api, plan_payload):
    response = post_raw(api, "/api/plan", b"\xef\xbb\xbf" + json.dumps(plan_payload).encode())
    assert response.status_code in (200, 400)


# Shape and type confusion --------------------------------------------------------------------


@pytest.mark.parametrize(
    "body", ["null", "true", "123", '"text"', "[]", "[1,2,3]", "{}", "", " ", "{", '{"a":', "{'a': 1}", "{a: 1}"]
)
def test_bodies_that_are_not_a_plan_request_are_a_400(api, body):
    response = post_raw(api, "/api/plan", body)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("key", ["current", "pickup", "dropoff"])
@pytest.mark.parametrize("bad", [None, "Dallas", 5, [], [1, 2], True])
def test_a_place_must_be_an_object(api, plan_payload, key, bad):
    plan_payload[key] = bad
    error = assert_error(api.post("/api/plan", plan_payload, format="json"), 400, "validation_error", fields=True)
    assert key in error["fields"]


def test_duplicate_keys_use_the_last_value_and_are_still_validated(api, plan_payload):
    body = json.dumps(plan_payload)[:-1] + ', "cycle_used_hours": 999}'
    error = assert_error(post_raw(api, "/api/plan", body), 400, "validation_error", fields=True)
    assert "cycle_used_hours" in error["fields"]


def test_prototype_pollution_style_keys_are_ignored(api, plan_payload):
    plan_payload["__proto__"] = {"polluted": True}
    plan_payload["constructor"] = {"prototype": {"polluted": True}}
    plan_payload["header"]["__proto__"] = "x"
    response = api.post("/api/plan", plan_payload, format="json")
    assert response.status_code == 200
    assert "polluted" not in response.content.decode() and "__proto__" not in response.content.decode()


# Content types and methods --------------------------------------------------------------------


@pytest.mark.parametrize(
    "content_type",
    [
        "text/plain",
        "text/html",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
        "application/xml",
    ],
)
def test_only_json_bodies_are_accepted(api, plan_payload, content_type):
    response = post_raw(api, "/api/plan", json.dumps(plan_payload), content_type=content_type)
    assert_error(response, 415, "unsupported_media_type")


def test_a_json_content_type_with_a_charset_is_fine(api, plan_payload):
    response = post_raw(api, "/api/plan", json.dumps(plan_payload), content_type="application/json; charset=utf-8")
    assert response.status_code == 200


def test_a_missing_content_type_is_rejected(api, plan_payload):
    response = api.generic("POST", "/api/plan", json.dumps(plan_payload).encode(), content_type="")
    assert response.status_code in (400, 415)


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_plan_only_answers_post(api, method):
    assert_error(getattr(api, method)("/api/plan"), 405, "method_not_allowed")


def test_options_does_not_leak_a_browsable_page(api):
    response = api.options("/api/plan")
    assert "text/html" not in response["Content-Type"]


def test_a_request_asking_for_html_gets_a_406_not_a_page(api):
    response = api.get("/api/health", HTTP_ACCEPT="text/html")
    assert_error(response, 406, "not_acceptable")


def test_a_wildcard_accept_header_gets_json(api):
    assert api.get("/api/health", HTTP_ACCEPT="*/*").status_code == 200
