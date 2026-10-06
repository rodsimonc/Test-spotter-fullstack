"""The route cache: hits, misses, expiry, bad rows and a database that misbehaves."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.db import DatabaseError
from django.utils import timezone

from apps.planner import services
from apps.planner.models import RouteCache
from apps.planner.types import RouteData, RouteLeg
from tests.support.contract import assert_error
from tests.support.osrm import DALLAS, DENVER, MEMPHIS, osrm_payload, register_osrm

URL = "/api/plan"
WAYPOINTS = [DALLAS, MEMPHIS, DENVER]


@pytest.fixture
def osrm(rsps):
    return register_osrm(rsps)


def plan(api, payload):
    response = api.post(URL, payload, format="json")
    assert response.status_code == 200, response.content[:300]
    return response.json()


def test_the_first_plan_asks_the_router_and_stores_the_answer(api, plan_payload, osrm, rsps):
    plan(api, plan_payload)

    assert len(rsps.calls) == 1
    row = RouteCache.objects.get()
    assert row.key == services.route_cache_key(WAYPOINTS)
    assert set(row.payload) == {"polyline", "leg_end_indices", "legs"}


def test_the_second_plan_for_the_same_trip_makes_no_router_call(api, plan_payload, osrm, rsps):
    first = plan(api, plan_payload)
    second = plan(api, plan_payload)

    assert len(rsps.calls) == 1
    assert second == first, "a cache hit and a miss must give the same numbers"


def test_a_change_of_cycle_hours_or_departure_still_hits_the_cache(api, plan_payload, osrm, rsps):
    plan(api, plan_payload)
    plan(api, plan_payload | {"cycle_used_hours": 3, "departure": "2026-12-01T05:30"})
    assert len(rsps.calls) == 1


def test_labels_do_not_matter_to_the_cache(api, plan_payload, osrm, rsps):
    plan(api, plan_payload)
    plan_payload["current"] = plan_payload["current"] | {"label": "A different name"}
    plan(api, plan_payload)
    assert len(rsps.calls) == 1


def test_points_within_about_ten_metres_share_a_route(api, plan_payload, osrm, rsps):
    plan(api, plan_payload)
    plan_payload["current"] = plan_payload["current"] | {"lat": DALLAS[0] + 0.00001}
    plan(api, plan_payload)
    assert len(rsps.calls) == 1


def test_points_a_few_hundred_metres_apart_get_their_own_route(api, plan_payload, osrm, rsps):
    plan(api, plan_payload)
    plan_payload["current"] = plan_payload["current"] | {"lat": DALLAS[0] + 0.003}
    plan(api, plan_payload)
    assert len(rsps.calls) == 2
    assert RouteCache.objects.count() == 2


def test_the_pickup_and_dropoff_swapped_is_a_different_route(api, plan_payload, osrm, rsps):
    plan(api, plan_payload)
    plan_payload["pickup"], plan_payload["dropoff"] = plan_payload["dropoff"], plan_payload["pickup"]
    plan(api, plan_payload)
    assert len(rsps.calls) == 2


def test_an_expired_row_is_fetched_again_and_replaced(api, plan_payload, osrm, rsps, settings):
    settings.ROUTE_CACHE_TTL_HOURS = 24
    plan(api, plan_payload)
    old = timezone.now() - timedelta(hours=25)
    RouteCache.objects.update(created_at=old)

    plan(api, plan_payload)

    assert len(rsps.calls) == 2
    assert RouteCache.objects.get().created_at > old + timedelta(hours=24)


def test_a_row_just_inside_the_lifetime_is_still_used(api, plan_payload, osrm, rsps, settings):
    settings.ROUTE_CACHE_TTL_HOURS = 24
    plan(api, plan_payload)
    RouteCache.objects.update(created_at=timezone.now() - timedelta(hours=23, minutes=55))

    plan(api, plan_payload)

    assert len(rsps.calls) == 1


def test_storing_a_route_clears_out_other_expired_rows(api, plan_payload, osrm, settings):
    settings.ROUTE_CACHE_TTL_HOURS = 1
    RouteCache.objects.create(key="old" * 10, payload={}, created_at=timezone.now() - timedelta(days=3))
    RouteCache.objects.create(key="new" * 10, payload={}, created_at=timezone.now())

    plan(api, plan_payload)

    assert set(RouteCache.objects.values_list("key", flat=True)) == {"new" * 10, services.route_cache_key(WAYPOINTS)}


def test_a_lifetime_of_zero_turns_the_cache_off(api, plan_payload, osrm, rsps, settings):
    settings.ROUTE_CACHE_TTL_HOURS = 0

    plan(api, plan_payload)
    plan(api, plan_payload)

    assert len(rsps.calls) == 2
    assert not RouteCache.objects.exists()


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"polyline": "not a polyline", "leg_end_indices": [1, 2], "legs": []},
        {"polyline": "??", "leg_end_indices": [5, 9], "legs": [{"distance_miles": 1, "osrm_duration_minutes": 1}] * 2},
        {"polyline": "_p~iF~ps|U_ulLnnqC", "leg_end_indices": ["a", "b"], "legs": []},
        {
            "polyline": "_p~iF~ps|U_ulLnnqC",
            "leg_end_indices": [1, 0],
            "legs": [{"distance_miles": 1, "osrm_duration_minutes": 1}] * 2,
        },
        {"polyline": "_p~iF~ps|U_ulLnnqC", "leg_end_indices": [0, 1], "legs": [{"nope": 1}, {"nope": 2}]},
        {
            "polyline": "_p~iF~ps|U_ulLnnqC",
            "leg_end_indices": [0, 1],
            "legs": [{"distance_miles": 1, "osrm_duration_minutes": 1}],
        },
    ],
)
def test_an_unreadable_cached_row_is_ignored_and_replaced(api, plan_payload, osrm, rsps, payload):
    key = services.route_cache_key(WAYPOINTS)
    RouteCache.objects.create(key=key, payload=payload)

    plan(api, plan_payload)

    assert len(rsps.calls) == 1
    assert set(RouteCache.objects.get(key=key).payload) == {"polyline", "leg_end_indices", "legs"}
    plan(api, plan_payload)
    assert len(rsps.calls) == 1, "the repaired row should now be used"


def test_a_cache_that_cannot_be_written_does_not_fail_the_plan(api, plan_payload, osrm, monkeypatch):
    def broken(*args, **kwargs):
        raise DatabaseError("disk full")

    monkeypatch.setattr(RouteCache.objects, "update_or_create", broken)

    assert plan(api, plan_payload)["summary"]["days"] >= 1


def test_the_distance_cap_applies_to_cached_routes_too(api, plan_payload, osrm, rsps, settings):
    plan(api, plan_payload)
    settings.MAX_ROUTE_MILES = 100

    assert_error(api.post(URL, plan_payload, format="json"), 422, "route_too_long")
    assert len(rsps.calls) == 1


def test_the_distance_cap_message_gives_both_numbers(api, plan_payload, osrm, settings):
    settings.MAX_ROUTE_MILES = 100
    error = assert_error(api.post(URL, plan_payload, format="json"), 422, "route_too_long")
    assert "miles. The planner handles up to 100 miles." in error["message"]


@pytest.mark.parametrize(
    ("status", "body", "code"), [(200, {"code": "NoRoute"}, "no_route"), (503, {}, "upstream_error")]
)
def test_a_failed_lookup_is_not_cached(api, plan_payload, rsps, status, body, code):
    register_osrm(rsps, body, status=status)
    assert api.post(URL, plan_payload, format="json").json()["error"]["code"] == code
    assert not RouteCache.objects.exists()


# Key and payload helpers ------------------------------------------------------------------


def test_the_cache_key_is_a_stable_sha256_hex_digest():
    key = services.route_cache_key(WAYPOINTS)
    assert len(key) == 64 and int(key, 16) >= 0
    assert key == services.route_cache_key(list(WAYPOINTS))
    assert key != services.route_cache_key(WAYPOINTS[::-1])


def test_the_cache_key_changes_with_the_layout_version(monkeypatch):
    before = services.route_cache_key(WAYPOINTS)
    monkeypatch.setattr(services, "CACHE_VERSION", "v2")
    assert services.route_cache_key(WAYPOINTS) != before


def test_the_cache_key_rounds_to_four_decimals():
    close = [(lat + 0.00004, lon - 0.00004) for lat, lon in WAYPOINTS]
    far = [(lat + 0.0003, lon) for lat, lon in WAYPOINTS]
    assert services.route_cache_key(close) == services.route_cache_key(WAYPOINTS)
    assert services.route_cache_key(far) != services.route_cache_key(WAYPOINTS)


def route_data() -> RouteData:
    coordinates = [(32.0 + i * 0.01, -96.0 + i * 0.02) for i in range(11)]
    return RouteData(
        coordinates=coordinates,
        leg_end_indices=(4, 10),
        legs=(RouteLeg(100.5, 120.25), RouteLeg(200.0, 240.0)),
    )


def test_a_route_survives_the_round_trip_through_the_cache_format():
    original = route_data()
    restored = services.route_from_payload(services.route_to_payload(original))

    assert restored.leg_end_indices == original.leg_end_indices
    assert restored.legs == original.legs
    assert len(restored.coordinates) == len(original.coordinates)
    for (a_lat, a_lon), (b_lat, b_lon) in zip(restored.coordinates, original.coordinates, strict=True):
        assert a_lat == pytest.approx(b_lat, abs=1e-5) and a_lon == pytest.approx(b_lon, abs=1e-5)


def test_the_cached_payload_is_plain_json():
    import json

    payload = services.route_to_payload(route_data())
    assert json.loads(json.dumps(payload)) == payload


@pytest.mark.parametrize("indices", [[-1, 5], [5, 4], [0, 11], [3, 99]])
def test_leg_indices_outside_the_geometry_are_refused(indices):
    payload = services.route_to_payload(route_data())
    payload["leg_end_indices"] = indices
    with pytest.raises(ValueError):
        services.route_from_payload(payload)


def test_the_waypoints_come_from_the_request_in_order(plan_payload):
    from apps.planner.serializers import PlanRequestSerializer

    serializer = PlanRequestSerializer(data=plan_payload)
    assert serializer.is_valid(), serializer.errors
    assert services.waypoints_of(serializer.to_request_data()) == WAYPOINTS


def test_osrm_fixture_builder_agrees_with_the_cache_roundtrip():
    from apps.planner.providers import osrm

    parsed = osrm.parse_route(osrm_payload())
    again = services.route_from_payload(services.route_to_payload(parsed))
    assert again.leg_end_indices == parsed.leg_end_indices
