"""Directions on the plan endpoint: what comes back, what the cache keeps and what happens when the turn list fails."""

from __future__ import annotations

import logging
import re

import pytest
import requests
from django.db import DatabaseError
from django.db.models import QuerySet

from apps.planner import directions as directions_module
from apps.planner import services
from apps.planner.models import RouteCache
from tests.support import ts_contract
from tests.support.contract import assert_error
from tests.support.osrm import (
    DALLAS,
    DENVER,
    MEMPHIS,
    osrm_steps_payload,
    register_osrm,
    route_calls,
    steps_calls,
)

URL = "/api/plan"
KEY = services.route_cache_key([DALLAS, MEMPHIS, DENVER])


def plan(api, payload):
    response = api.post(URL, payload, format="json")
    assert response.status_code == 200, response.content[:300]
    return response.json()


def without_directions(body):
    return {key: value for key, value in body.items() if key != "directions"}


# --- the happy path ----------------------------------------------------------------------


def test_the_plan_carries_two_legs_of_directions(api, plan_payload, rsps):
    register_osrm(rsps)
    body = plan(api, plan_payload)

    legs = body["directions"]
    assert [(leg["from"], leg["to"], leg["title"]) for leg in legs] == [
        ("current", "pickup", "Dallas to Memphis"),
        ("pickup", "dropoff", "Memphis to Denver"),
    ]
    for summary_leg, leg in zip(body["summary"]["legs"], legs, strict=True):
        assert leg["distance_miles"] == summary_leg["distance_miles"]
        assert sum(s["distance_miles"] for s in leg["steps"]) == pytest.approx(summary_leg["distance_miles"], abs=0.05)
        assert leg["steps"][0]["kind"] == "depart"
        assert leg["steps"][-1]["kind"] == "arrive" and leg["steps"][-1]["distance_miles"] == 0
        assert {s["kind"] for s in leg["steps"][1:-1]} == {"road"}


def test_the_lines_read_like_directions(api, plan_payload, rsps):
    register_osrm(rsps)
    first, second = plan(api, plan_payload)["directions"]

    assert re.fullmatch(r"Head \w+ on Elm Street", first["steps"][0]["instruction"])
    assert [s["road"] for s in first["steps"]] == ["Elm Street", "I-30", "US-287", "I-40", ""]
    assert re.fullmatch(r"Take I-30 [NESW]{1,2}", first["steps"][1]["instruction"])
    assert re.fullmatch(r"Take US-287 [NESW]{1,2}", first["steps"][2]["instruction"])
    assert first["steps"][-1]["instruction"] == "Arrive at Memphis"
    assert second["steps"][-1]["instruction"] == "Arrive at Denver"


def test_miles_run_on_from_the_first_leg_into_the_second_and_match_the_stops(api, plan_payload, rsps):
    register_osrm(rsps)
    body = plan(api, plan_payload)
    first, second = body["directions"]
    pickup = next(s for s in body["stops"] if s["kind"] == "pickup")

    assert first["steps"][0]["mile"] == 0
    assert first["steps"][-1]["mile"] == pickup["mile"] == second["steps"][0]["mile"]
    marks = [s["mile"] for leg in body["directions"] for s in leg["steps"]]
    assert marks == sorted(marks)
    assert second["steps"][-1]["mile"] == pytest.approx(body["summary"]["distance_miles"], abs=0.1)


def test_the_directions_follow_the_contract_in_types_ts(api, plan_payload, rsps):
    register_osrm(rsps)
    body = plan(api, plan_payload)
    assert body["directions"]
    ts_contract.load().assert_matches(body, "PlanResponse")


def test_the_places_come_from_the_request(api, plan_payload, rsps):
    register_osrm(rsps)
    plan_payload["pickup"]["label"] = "Elvis Presley Blvd, Memphis"
    plan_payload["dropoff"]["label"] = "<img src=x onerror=alert(1)>, Denver"
    first, second = plan(api, plan_payload)["directions"]

    assert first["title"] == "Dallas to Elvis Presley Blvd"
    assert first["steps"][-1]["instruction"] == "Arrive at Elvis Presley Blvd"
    assert second["steps"][-1]["instruction"] == "Arrive at <img src=x onerror=alert(1)>"


def test_a_hit_on_the_cache_uses_the_labels_of_the_new_request(api, plan_payload, rsps):
    register_osrm(rsps)
    plan(api, plan_payload)
    plan_payload["pickup"]["label"] = "Somewhere Else, TN"
    first, _ = plan(api, plan_payload)["directions"]

    assert first["steps"][-1]["instruction"] == "Arrive at Somewhere Else"
    assert len(steps_calls(rsps)) == 1


def test_a_saved_trip_keeps_its_directions(auth_api, plan_payload, rsps):
    register_osrm(rsps)
    response = auth_api.post("/api/trips", {"request": plan_payload}, format="json")
    assert response.status_code == 201, response.content[:300]
    assert len(response.json()["result"]["directions"]) == 2


# --- the cache ---------------------------------------------------------------------------


def test_the_condensed_lines_are_stored_with_the_route(api, plan_payload, rsps):
    register_osrm(rsps)
    plan(api, plan_payload)

    stored = RouteCache.objects.get(key=KEY).payload["directions"]
    assert len(stored) == 2
    assert all(leg[0]["kind"] == "depart" and leg[-1]["kind"] == "arrive" for leg in stored)
    assert "instruction" not in stored[0][0], "wording is added later, from the labels in each request"


def test_a_cache_hit_asks_the_router_for_nothing_and_answers_the_same(api, plan_payload, rsps):
    register_osrm(rsps)
    first = plan(api, plan_payload)
    second = plan(api, plan_payload)

    assert (len(route_calls(rsps)), len(steps_calls(rsps))) == (1, 1)
    assert second["directions"] == first["directions"]
    assert second == first


def test_an_empty_answer_is_remembered_so_the_router_is_not_asked_again(api, plan_payload, rsps):
    empty = osrm_steps_payload()
    for leg in empty["routes"][0]["legs"]:
        leg["steps"] = []
    register_osrm(rsps, steps=empty)

    assert plan(api, plan_payload)["directions"] == []
    assert RouteCache.objects.get(key=KEY).payload["directions"] == []
    assert plan(api, plan_payload)["directions"] == []
    assert len(steps_calls(rsps)) == 1


def test_a_route_stored_before_directions_existed_gets_them_on_its_next_use(api, plan_payload, rsps):
    register_osrm(rsps)
    plan(api, plan_payload)
    row = RouteCache.objects.get(key=KEY)
    old = {k: v for k, v in row.payload.items() if k != "directions"}
    RouteCache.objects.filter(key=KEY).update(payload=old)

    body = plan(api, plan_payload)

    assert len(route_calls(rsps)) == 1, "the route itself is still cached"
    assert len(steps_calls(rsps)) == 2
    assert len(body["directions"]) == 2
    assert len(RouteCache.objects.get(key=KEY).payload["directions"]) == 2
    plan(api, plan_payload)
    assert len(steps_calls(rsps)) == 2


def test_a_new_row_is_written_once_and_then_updated_in_place(api, plan_payload, rsps):
    register_osrm(rsps)
    plan(api, plan_payload)
    row = RouteCache.objects.get(key=KEY)
    RouteCache.objects.filter(key=KEY).update(payload={k: v for k, v in row.payload.items() if k != "directions"})
    stamp = RouteCache.objects.get(key=KEY).created_at

    plan(api, plan_payload)

    assert RouteCache.objects.count() == 1
    assert RouteCache.objects.get(key=KEY).created_at == stamp, "adding directions does not extend the row's life"


@pytest.mark.parametrize(
    "bad",
    [
        {"nope": 1},
        "text",
        [[{"kind": "depart"}], [{"kind": "arrive"}]],
        [[], []],
        [[{"kind": "turn", "road": "", "heading": "N", "distance_miles": 1, "mile": 0, "lat": 1, "lon": 1}]] * 2,
    ],
)
def test_cached_directions_that_make_no_sense_cost_only_a_second_look_at_the_router(api, plan_payload, rsps, bad):
    register_osrm(rsps)
    plan(api, plan_payload)
    payload = RouteCache.objects.get(key=KEY).payload | {"directions": bad}
    RouteCache.objects.filter(key=KEY).update(payload=payload)

    body = plan(api, plan_payload)

    assert len(body["directions"]) == 2
    assert len(route_calls(rsps)) == 2 and len(steps_calls(rsps)) == 2
    assert len(RouteCache.objects.get(key=KEY).payload["directions"]) == 2


def test_with_the_cache_off_every_plan_asks_for_both(api, plan_payload, rsps, settings):
    settings.ROUTE_CACHE_TTL_HOURS = 0
    register_osrm(rsps)

    assert len(plan(api, plan_payload)["directions"]) == 2
    assert len(plan(api, plan_payload)["directions"]) == 2
    assert (len(route_calls(rsps)), len(steps_calls(rsps))) == (2, 2)
    assert not RouteCache.objects.exists()


def test_a_cache_that_cannot_be_updated_does_not_fail_the_plan(api, plan_payload, rsps, monkeypatch, caplog):
    register_osrm(rsps)

    def broken(self, **kwargs):
        raise DatabaseError("disk full")

    monkeypatch.setattr(QuerySet, "update", broken)
    with caplog.at_level(logging.WARNING, logger="apps.planner.services"):
        body = plan(api, plan_payload)

    assert len(body["directions"]) == 2, "this plan still has them"
    assert "directions in the cache" in caplog.text


def test_a_route_over_the_distance_cap_does_not_ask_for_a_turn_list(api, plan_payload, rsps, settings):
    register_osrm(rsps)
    settings.MAX_ROUTE_MILES = 100

    assert_error(api.post(URL, plan_payload, format="json"), 422, "route_too_long")
    assert len(steps_calls(rsps)) == 0


def test_the_route_is_asked_for_before_the_turn_list(api, plan_payload, rsps):
    register_osrm(rsps)
    plan(api, plan_payload)
    assert [call.request.params["steps"] for call in rsps.calls] == ["false", "true"]


# --- when only the turn list goes wrong --------------------------------------------------


def lone_leg():
    data = osrm_steps_payload()
    data["routes"][0]["legs"].pop()
    return data


def far_off():
    data = osrm_steps_payload()
    for leg in data["routes"][0]["legs"]:
        for step in leg["steps"]:
            step["distance"] *= 3
    return data


def breakers():
    """Each is a way the steps call can fail while the route call is fine."""
    return {
        "a server error": {"steps": "oops", "steps_status": 503},
        "a refusal": {"steps": {"message": "Too Many Requests"}, "steps_status": 429},
        "no route": {"steps": {"code": "NoRoute"}, "steps_status": 400},
        "an unknown code": {"steps": {"code": "InvalidQuery"}},
        "garbage": {"steps": "<html>busy</html>"},
        "a timeout": {"steps": requests.exceptions.ReadTimeout()},
        "a dead connection": {"steps": requests.exceptions.ConnectionError()},
        "a body that is too big": {"steps": b"{}", "steps_headers": {"Content-Length": str(5 * 1024 * 1024)}},
        "only one leg": {"steps": lone_leg()},
        "steps for some other route": {"steps": far_off()},
    }


@pytest.fixture
def baseline(api, plan_payload, rsps):
    """The plan with a working turn list, with every row and recorded call cleared away."""
    register_osrm(rsps)
    body = plan(api, plan_payload)
    RouteCache.objects.all().delete()
    rsps.reset()
    return body


@pytest.mark.parametrize("failure", breakers().values(), ids=breakers().keys())
def test_when_only_the_turn_list_fails_the_plan_still_succeeds_without_directions(
    api, plan_payload, rsps, baseline, failure, caplog
):
    register_osrm(rsps, **failure)

    with caplog.at_level(logging.INFO):
        body = plan(api, plan_payload)

    assert body["directions"] == []
    assert without_directions(body) == without_directions(baseline), "nothing else about the plan changes"
    assert body["warnings"] == baseline["warnings"], "no warning for the client"
    assert any("directions" in record.getMessage().lower() for record in caplog.records), "it is logged"


def test_a_failed_turn_list_is_not_remembered_so_the_next_plan_tries_again(api, plan_payload, rsps):
    register_osrm(rsps, steps="oops", steps_status=503)
    assert plan(api, plan_payload)["directions"] == []
    assert "directions" not in RouteCache.objects.get(key=KEY).payload

    rsps.reset()
    register_osrm(rsps)
    body = plan(api, plan_payload)

    assert len(body["directions"]) == 2
    assert len(route_calls(rsps)) == 0, "the route came from the cache"
    assert len(steps_calls(rsps)) == 1
    assert len(RouteCache.objects.get(key=KEY).payload["directions"]) == 2


def test_the_turn_list_gets_one_try_per_plan_not_a_retry_loop(api, plan_payload, rsps):
    register_osrm(rsps, steps="oops", steps_status=503)
    plan(api, plan_payload)
    assert len(steps_calls(rsps)) == 1


def test_the_route_failing_is_still_an_error_whatever_the_turn_list_says(api, plan_payload, rsps):
    register_osrm(rsps, {"code": "NoRoute"})
    assert_error(api.post(URL, plan_payload, format="json"), 422, "no_route")


def test_a_bug_while_condensing_costs_the_plan_only_its_directions(api, plan_payload, rsps, monkeypatch, caplog):
    register_osrm(rsps)

    def boom(*args, **kwargs):
        raise RuntimeError("a bug")

    monkeypatch.setattr(directions_module, "condense", boom)
    with caplog.at_level(logging.ERROR, logger="apps.planner.services"):
        body = plan(api, plan_payload)

    assert body["directions"] == []
    assert "condensed" in caplog.text
    assert body["summary"]["days"] >= 1


def test_odd_but_readable_steps_never_break_the_plan(api, plan_payload, rsps):
    data = osrm_steps_payload()
    for leg in data["routes"][0]["legs"]:
        for step in leg["steps"]:
            step["maneuver"].pop("location")
            step["maneuver"].pop("bearing_after")
    register_osrm(rsps, steps=data)

    assert plan(api, plan_payload)["directions"] == []
