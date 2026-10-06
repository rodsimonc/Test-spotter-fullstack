"""Typeahead (Photon) and map-click naming (Nominatim, then the town list, then coordinates)."""

from __future__ import annotations

import pytest
import responses

from apps.common.errors import UpstreamError
from apps.planner import services
from apps.planner.providers import nominatim, photon
from tests.support.contract import assert_error
from tests.support.osrm import CHICAGO, NOMINATIM_REVERSE, PHOTON_SEARCH, photon_feature, photon_payload

SEARCH = "/api/geocode/search"
REVERSE = "/api/geocode/reverse"


def add_photon(rsps, *features, status=200):
    rsps.add(responses.GET, PHOTON_SEARCH, json=photon_payload(*features), status=status)


# --- search -------------------------------------------------------------------------------


def test_search_maps_photon_features_to_results(api, rsps):
    add_photon(rsps, CHICAGO)
    response = api.get(SEARCH, {"q": "chicago"})
    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {
                "label": "Chicago, Illinois, United States",
                "lat": 41.8755616,
                "lon": -87.6244212,
                "detail": "Illinois, United States",
            }
        ]
    }


def test_search_sends_q_limit_and_language_to_photon(api, rsps):
    add_photon(rsps)
    api.get(SEARCH, {"q": "  kearney ne ", "limit": "3"})
    params = rsps.calls[0].request.params
    assert params == {"q": "kearney ne", "limit": "3", "lang": "en"}
    assert rsps.calls[0].request.url.startswith("https://photon.test/api/?")


def test_search_defaults_to_five_results(api, rsps):
    add_photon(rsps)
    api.get(SEARCH, {"q": "dallas"})
    assert rsps.calls[0].request.params["limit"] == "5"


def test_search_can_bias_results_toward_a_point(api, rsps):
    add_photon(rsps)
    api.get(SEARCH, {"q": "springfield", "lat": "39.78", "lon": "-89.65"})
    params = rsps.calls[0].request.params
    assert params["lat"] == "39.78000" and params["lon"] == "-89.65000"


def test_an_empty_answer_is_a_valid_answer(api, rsps):
    add_photon(rsps)
    response = api.get(SEARCH, {"q": "zzzzzz"})
    assert response.status_code == 200
    assert response.json() == {"results": []}


def test_search_respects_the_limit_even_if_photon_sends_more(api, rsps):
    add_photon(rsps, *[photon_feature(30 + i, -90, name=f"Place {i}", country="United States") for i in range(8)])
    assert len(api.get(SEARCH, {"q": "place", "limit": "2"}).json()["results"]) == 2


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({}, "q"),
        ({"q": ""}, "q"),
        ({"q": "a"}, "q"),
        ({"q": " a "}, "q"),
        ({"q": "x" * 121}, "q"),
        ({"q": "ok", "limit": "0"}, "limit"),
        ({"q": "ok", "limit": "9"}, "limit"),
        ({"q": "ok", "limit": "many"}, "limit"),
        ({"q": "ok", "lat": "10"}, "lon"),
        ({"q": "ok", "lon": "10"}, "lat"),
        ({"q": "ok", "lat": "91", "lon": "0"}, "lat"),
        ({"q": "ok", "lat": "0", "lon": "181"}, "lon"),
        ({"q": "ok", "lat": "nan", "lon": "0"}, "lat"),
        ({"q": "ok", "lat": "0", "lon": "inf"}, "lon"),
        ({"q": "ok", "lat": "1e999", "lon": "0"}, "lat"),
        ({"q": "ok", "lat": "x" * 200, "lon": "0"}, "lat"),
        ({"q": "bad\x00text"}, "q"),
    ],
)
def test_search_validation(api, rsps, params, field):
    response = api.get(SEARCH, params)
    error = assert_error(response, 400, "validation_error", fields=True)
    assert field in error["fields"]
    assert len(rsps.calls) == 0


def test_search_accepts_unicode_and_markup_as_plain_text(api, rsps):
    add_photon(rsps)
    api.get(SEARCH, {"q": "Zürich <script>alert(1)</script> 東京"})
    assert rsps.calls[0].request.params["q"] == "Zürich <script>alert(1)</script> 東京"


@pytest.mark.parametrize("status", [429, 500, 503, 404])
def test_photon_trouble_is_a_502(api, rsps, status):
    rsps.add(responses.GET, PHOTON_SEARCH, status=status, body="no")
    assert_error(api.get(SEARCH, {"q": "chicago"}), 502, "upstream_error")


def test_photon_garbage_is_a_502(api, rsps):
    rsps.add(responses.GET, PHOTON_SEARCH, body="<html>")
    assert_error(api.get(SEARCH, {"q": "chicago"}), 502, "upstream_error")


def test_photon_json_without_features_is_a_502(api, rsps):
    rsps.add(responses.GET, PHOTON_SEARCH, json={"type": "FeatureCollection"})
    assert_error(api.get(SEARCH, {"q": "chicago"}), 502, "upstream_error")


def test_post_to_search_is_405(api):
    assert_error(api.post(SEARCH, {"q": "chicago"}, format="json"), 405, "method_not_allowed")


# --- photon parsing -----------------------------------------------------------------------


def parse(*features, limit=8):
    return photon.parse_results(photon_payload(*features), limit)


def test_a_street_address_uses_number_and_street():
    [result] = parse(
        photon_feature(
            40.7,
            -74.0,
            housenumber="350",
            street="Fifth Avenue",
            city="New York",
            state="New York",
            country="United States",
        )
    )
    assert result["label"] == "350 Fifth Avenue, New York, New York, United States"
    assert result["detail"] == "New York, New York, United States"


def test_a_point_of_interest_keeps_its_name_and_adds_town_and_state():
    [result] = parse(
        photon_feature(
            40.7, -99.1, name="Love's Travel Stop", city="Kearney", state="Nebraska", country="United States"
        )
    )
    assert result["label"] == "Love's Travel Stop, Kearney, Nebraska, United States"


def test_a_state_feature_does_not_repeat_its_own_name():
    [result] = parse(
        photon_feature(40.0, -89.0, name="Illinois", state="Illinois", country="United States", type="state")
    )
    assert result["label"] == "Illinois, United States"
    assert result["detail"] == "United States"


def test_a_city_inside_a_state_of_the_same_name_keeps_both():
    [result] = parse(
        photon_feature(40.7, -74.0, name="New York", state="New York", country="United States", type="city")
    )
    assert result["label"] == "New York, New York, United States"


def test_a_feature_with_only_a_city_is_named_after_it():
    [result] = parse(photon_feature(40.0, -89.0, city="Peoria", state="Illinois"))
    assert result["label"] == "Peoria, Illinois"


@pytest.mark.parametrize(
    "feature",
    [
        None,
        "text",
        {},
        {"geometry": None, "properties": {"name": "x"}},
        {"geometry": {"coordinates": [1]}, "properties": {"name": "x"}},
        {"geometry": {"coordinates": ["a", "b"]}, "properties": {"name": "x"}},
        {"geometry": {"coordinates": [200, 0]}, "properties": {"name": "x"}},
        {"geometry": {"coordinates": [0, -95]}, "properties": {"name": "x"}},
        {"geometry": {"coordinates": [0, 0]}, "properties": {}},
        {"geometry": {"coordinates": [0, 0]}, "properties": "x"},
        {"geometry": {"coordinates": [True, False]}, "properties": {"name": "x"}},
    ],
)
def test_unusable_features_are_skipped(feature):
    good = photon_feature(41.0, -87.0, name="Good", country="United States")
    assert [r["label"] for r in parse(feature, good)] == ["Good, United States"]


def test_duplicates_are_dropped():
    a = photon_feature(41.0001, -87.0001, name="Dupe", country="United States")
    b = photon_feature(41.0002, -87.0002, name="Dupe", country="United States")
    assert len(parse(a, b)) == 1


def test_control_characters_are_stripped_from_labels():
    [result] = parse(photon_feature(41.0, -87.0, name="Bad\x00Name\x1b[31m", country="United States"))
    assert "\x00" not in result["label"] and "\x1b" not in result["label"]


def test_markup_in_names_is_passed_through_as_text():
    [result] = parse(photon_feature(41.0, -87.0, name='<img src=x onerror="alert(1)">', country="United States"))
    assert result["label"].startswith("<img src=x")


def test_labels_are_capped_at_200_characters():
    [result] = parse(photon_feature(41.0, -87.0, name="n" * 400))
    assert len(result["label"]) == 200


def test_non_string_properties_are_ignored():
    [result] = parse(photon_feature(41.0, -87.0, name="Name", city=5, state=["x"], country={"a": 1}))
    assert result["label"] == "Name"


# --- reverse ------------------------------------------------------------------------------


def nominatim_body(**address):
    return {"display_name": "Somewhere, A County, Nebraska, United States", "address": address}


def add_nominatim(rsps, body, status=200):
    rsps.add(responses.GET, NOMINATIM_REVERSE, json=body, status=status)


def test_reverse_uses_nominatim_first(api, rsps):
    add_nominatim(rsps, nominatim_body(town="Kearney", state="Nebraska", country="United States", country_code="us"))
    response = api.get(REVERSE, {"lat": "40.7", "lon": "-99.08"})
    assert response.status_code == 200
    assert response.json() == {"place": {"label": "Kearney, Nebraska, United States", "lat": 40.7, "lon": -99.08}}


def test_reverse_asks_nominatim_with_a_short_timeout_and_the_documented_params(api, rsps, monkeypatch):
    add_nominatim(rsps, nominatim_body(city="Kearney", state="Nebraska", country="United States"))
    from apps.planner.providers import http

    seen = {}
    real_get = http._session.get

    def spy(url, **kwargs):
        seen.update(kwargs)
        return real_get(url, **kwargs)

    monkeypatch.setattr(http._session, "get", spy)
    api.get(REVERSE, {"lat": "40.7", "lon": "-99.08"})
    assert seen["timeout"] == (2.0, 3.0)
    assert seen["params"] == {
        "format": "jsonv2",
        "lat": "40.700000",
        "lon": "-99.080000",
        "zoom": 14,
        "addressdetails": 1,
    }


def test_reverse_falls_back_to_the_town_list_when_nominatim_is_down(api, rsps, monkeypatch):
    rsps.add(responses.GET, NOMINATIM_REVERSE, status=503)
    monkeypatch.setattr(services, "describe_place", lambda lat, lon: "12 mi SW of Kearney, NE")
    response = api.get(REVERSE, {"lat": "40.5", "lon": "-99.3"})
    assert response.status_code == 200
    assert response.json()["place"]["label"] == "12 mi SW of Kearney, NE"
    assert len(rsps.calls) == 1  # no retry: the fallback is faster


def test_reverse_falls_back_when_nominatim_has_no_answer(api, rsps, monkeypatch):
    add_nominatim(rsps, {"error": "Unable to geocode"})
    monkeypatch.setattr(services, "describe_place", lambda lat, lon: "Kearney, NE")
    assert api.get(REVERSE, {"lat": "40.7", "lon": "-99.08"}).json()["place"]["label"] == "Kearney, NE"


def test_reverse_falls_back_when_nominatim_times_out(api, rsps, monkeypatch):
    import requests

    rsps.add(responses.GET, NOMINATIM_REVERSE, body=requests.ReadTimeout("slow"))
    monkeypatch.setattr(services, "describe_place", lambda lat, lon: "Kearney, NE")
    assert api.get(REVERSE, {"lat": "40.7", "lon": "-99.08"}).json()["place"]["label"] == "Kearney, NE"


def test_reverse_falls_back_to_coordinates_when_the_town_list_has_nothing(api, rsps, monkeypatch):
    rsps.add(responses.GET, NOMINATIM_REVERSE, status=503)
    monkeypatch.setattr(services, "describe_place", lambda lat, lon: "")
    assert api.get(REVERSE, {"lat": "-30.5", "lon": "-45.25"}).json()["place"]["label"] == "-30.5000, -45.2500"


def test_reverse_survives_a_crashing_town_list(api, rsps, monkeypatch):
    rsps.add(responses.GET, NOMINATIM_REVERSE, status=503)

    def explode(lat, lon):
        raise RuntimeError("corrupt data file")

    monkeypatch.setattr(services, "describe_place", explode)
    response = api.get(REVERSE, {"lat": "10", "lon": "20"})
    assert response.status_code == 200
    assert response.json()["place"]["label"] == "10.0000, 20.0000"


def test_reverse_never_returns_a_502_just_because_nominatim_is_down(api, rsps):
    rsps.add(responses.GET, NOMINATIM_REVERSE, status=500)
    assert api.get(REVERSE, {"lat": "40.7", "lon": "-99.08"}).status_code == 200


def test_reverse_works_end_to_end_with_the_real_town_list(api, rsps, real_engine):
    rsps.add(responses.GET, NOMINATIM_REVERSE, status=503)
    label = api.get(REVERSE, {"lat": "40.6995", "lon": "-99.0815"}).json()["place"]["label"]
    assert "Kearney" in label


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"lat": "40"},
        {"lon": "-99"},
        {"lat": "abc", "lon": "-99"},
        {"lat": "91", "lon": "0"},
        {"lat": "0", "lon": "-181"},
        {"lat": "NaN", "lon": "0"},
        {"lat": "0", "lon": "Infinity"},
        {"lat": "", "lon": ""},
    ],
)
def test_reverse_validation(api, rsps, params):
    assert_error(api.get(REVERSE, params), 400, "validation_error", fields=True)
    assert len(rsps.calls) == 0


# --- nominatim parsing --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (nominatim_body(city="Denver", state="Colorado", country="United States"), "Denver, Colorado, United States"),
        (nominatim_body(village="Elm", state="Texas", country="United States"), "Elm, Texas, United States"),
        (nominatim_body(hamlet="Tiny", county="Big County", state="Utah"), "Tiny, Utah"),
        (
            nominatim_body(county="Buffalo County", state="Nebraska", country="United States"),
            "Buffalo County, Nebraska, United States",
        ),
        (
            nominatim_body(city="Washington", state="Washington", country="United States"),
            "Washington, Washington, United States",
        ),
    ],
)
def test_nominatim_labels(body, expected):
    assert nominatim.parse_label(body) == expected


def test_nominatim_without_a_town_uses_the_first_parts_of_display_name():
    body = {
        "display_name": "Mile Marker 40, I 80, Buffalo County, Nebraska, United States",
        "address": {"road": "I 80"},
    }
    assert nominatim.parse_label(body) == "Mile Marker 40, I 80, Buffalo County"


@pytest.mark.parametrize(
    "body", [None, [], "x", {"error": "Unable to geocode"}, {}, {"address": {}}, {"display_name": ""}]
)
def test_nominatim_answers_with_nothing_useful_give_none(body):
    assert nominatim.parse_label(body) is None


def test_nominatim_labels_are_capped_and_control_characters_removed():
    label = nominatim.parse_label(nominatim_body(city="C\x00ity" + "x" * 300, state="S"))
    assert len(label) <= 200 and "\x00" not in label


def test_nominatim_http_error_raises_upstream_error(rsps):
    rsps.add(responses.GET, NOMINATIM_REVERSE, json={}, status=403)
    with pytest.raises(UpstreamError):
        nominatim.reverse(1.0, 2.0)
