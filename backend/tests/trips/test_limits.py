"""Caps on what can be saved: trip count per user, result size and how long a route may be."""

from __future__ import annotations

import json

import pytest

from apps.trips.models import Trip
from tests.support.contract import assert_error
from tests.support.osrm import osrm_payload, register_osrm

LIST = "/api/trips"
SEATTLE = (47.6062, -122.3321)
MIAMI = (25.7617, -80.1918)
SAN_DIEGO = (32.7157, -117.1611)


def test_the_result_cap_is_two_megabytes():
    from django.conf import settings

    assert settings.MAX_TRIP_RESULT_BYTES == 2 * 1024 * 1024


def test_a_result_over_the_cap_is_refused_and_nothing_is_stored(auth_api, osrm, plan_payload, settings):
    settings.MAX_TRIP_RESULT_BYTES = 1000

    error = assert_error(auth_api.post(LIST, {"request": plan_payload}, format="json"), 422, "trip_too_large")

    assert error["message"] == "This trip is too large to save."
    assert not Trip.objects.exists()


def test_a_result_just_under_the_cap_is_saved(auth_api, osrm, plan_payload, settings):
    size = len(json.dumps(auth_api.post("/api/plan", plan_payload, format="json").json(), separators=(",", ":")))
    settings.MAX_TRIP_RESULT_BYTES = size

    assert auth_api.post(LIST, {"request": plan_payload}, format="json").status_code == 201


def test_a_result_one_byte_over_the_cap_is_refused(auth_api, osrm, plan_payload, settings):
    size = len(json.dumps(auth_api.post("/api/plan", plan_payload, format="json").json(), separators=(",", ":")))
    settings.MAX_TRIP_RESULT_BYTES = size - 1

    assert_error(auth_api.post(LIST, {"request": plan_payload}, format="json"), 422, "trip_too_large")


def test_the_longest_route_the_planner_accepts_still_fits_under_the_cap(auth_api, rsps, plan_payload, real_engine):
    """About 9,900 miles over a very detailed line is the biggest plan a user can ask to save."""
    register_osrm(rsps, osrm_payload(waypoints=(SEATTLE, MIAMI, SAN_DIEGO), road_factor=1.98, points_per_leg=4000))
    plan_payload["current"] = {"label": "Seattle, WA", "lat": SEATTLE[0], "lon": SEATTLE[1]}
    plan_payload["pickup"] = {"label": "Miami, FL", "lat": MIAMI[0], "lon": MIAMI[1]}
    plan_payload["dropoff"] = {"label": "San Diego, CA", "lat": SAN_DIEGO[0], "lon": SAN_DIEGO[1]}

    response = auth_api.post(LIST, {"request": plan_payload}, format="json")

    assert response.status_code == 201, response.content[:300]
    trip = response.json()
    assert trip["distance_miles"] > 9000
    size = len(json.dumps(trip["result"], separators=(",", ":")).encode())
    assert size < 2 * 1024 * 1024 * 0.5, f"a {size:,} byte result leaves less than half the cap spare"


def test_a_route_over_the_distance_cap_is_not_saved(auth_api, rsps, plan_payload, settings):
    register_osrm(rsps)
    settings.MAX_ROUTE_MILES = 100
    assert_error(auth_api.post(LIST, {"request": plan_payload}, format="json"), 422, "route_too_long")
    assert not Trip.objects.exists()


def test_a_user_at_the_limit_does_not_cost_a_route_lookup(auth_api, rsps, plan_payload, settings):
    register_osrm(rsps)
    settings.MAX_TRIPS_PER_USER = 1
    settings.ROUTE_CACHE_TTL_HOURS = 0  # every plan would ask the router, so a skipped call shows up
    auth_api.post(LIST, {"request": plan_payload}, format="json")
    lookups = len(rsps.calls)

    assert_error(auth_api.post(LIST, {"request": plan_payload}, format="json"), 422, "trip_limit_reached")

    assert len(rsps.calls) == lookups


def test_the_limit_message_says_what_to_do(auth_api, osrm, plan_payload, settings):
    settings.MAX_TRIPS_PER_USER = 1
    auth_api.post(LIST, {"request": plan_payload}, format="json")

    error = assert_error(auth_api.post(LIST, {"request": plan_payload}, format="json"), 422, "trip_limit_reached")

    assert error["message"] == "You've saved 1 trips. Delete one to save another."
    assert Trip.objects.count() == 1


def test_deleting_a_trip_makes_room(auth_api, osrm, plan_payload, settings):
    settings.MAX_TRIPS_PER_USER = 1
    first = auth_api.post(LIST, {"request": plan_payload}, format="json").json()
    auth_api.delete(f"{LIST}/{first['id']}")

    assert auth_api.post(LIST, {"request": plan_payload}, format="json").status_code == 201


def test_the_limit_is_per_user(auth_api, other_api, osrm, plan_payload, settings):
    settings.MAX_TRIPS_PER_USER = 1
    assert auth_api.post(LIST, {"request": plan_payload}, format="json").status_code == 201
    assert other_api.post(LIST, {"request": plan_payload}, format="json").status_code == 201
    assert_error(auth_api.post(LIST, {"request": plan_payload}, format="json"), 422, "trip_limit_reached")


def test_the_default_limit_is_one_hundred_trips():
    from django.conf import settings

    assert settings.MAX_TRIPS_PER_USER == 100


@pytest.mark.parametrize("count", [0, 1])
def test_the_limit_does_not_stop_a_user_under_it(auth_api, osrm, plan_payload, settings, count):
    settings.MAX_TRIPS_PER_USER = 2
    for _ in range(count):
        auth_api.post(LIST, {"request": plan_payload}, format="json")
    assert auth_api.post(LIST, {"request": plan_payload}, format="json").status_code == 201
