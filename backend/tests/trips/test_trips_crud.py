"""Saved trips: create, list, read, rename and delete for a signed-in user."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.trips.models import Trip
from tests.support import ts_contract
from tests.support.contract import assert_error, assert_plan_response
from tests.support.osrm import OSRM_ROUTE, register_osrm, route_calls, steps_calls

LIST = "/api/trips"


# Create -----------------------------------------------------------------------------------


def test_create_returns_the_full_trip(auth_api, create_trip, real_engine):
    trip = create_trip(auth_api)

    ts_contract.load().assert_matches(trip, "Trip")
    assert_plan_response(trip["result"])
    assert uuid.UUID(trip["id"])
    assert trip["title"] == "Dallas to Denver"
    assert trip["current_label"] == "Dallas, Texas, United States"
    assert trip["pickup_label"] == "Memphis, Tennessee, United States"
    assert trip["dropoff_label"] == "Denver, Colorado, United States"
    assert trip["distance_miles"] == trip["result"]["summary"]["distance_miles"]
    assert trip["days"] == trip["result"]["summary"]["days"] == len(trip["result"]["logs"])
    assert trip["depart_at"] == trip["result"]["summary"]["depart_at"]
    assert trip["arrive_at"] == trip["result"]["summary"]["arrive_at"]


def test_create_stores_the_normalized_request_and_the_server_result(auth_api, create_trip, plan_payload):
    trip = create_trip(auth_api)

    stored = Trip.objects.get(pk=trip["id"])
    assert stored.request == trip["request"] == trip["result"]["request"]
    assert stored.request["departure"] == "2026-10-07T06:00"
    assert stored.request["header"]["driver_name"] == "Dana Driver"
    assert stored.request["header"]["carrier_name"] == ""
    assert stored.result == trip["result"]


def test_create_uses_the_given_title_trimmed(auth_api, create_trip):
    assert create_trip(auth_api, title="  Fall run  ")["title"] == "Fall run"


@pytest.mark.parametrize("title", ["", "   "])
def test_a_blank_title_gets_the_default(auth_api, create_trip, title):
    assert create_trip(auth_api, title=title)["title"] == "Dallas to Denver"


def test_a_missing_title_gets_the_default(auth_api, create_trip):
    assert create_trip(auth_api)["title"] == "Dallas to Denver"


def test_create_ignores_a_result_the_client_made_up(auth_api, create_trip, real_engine):
    fake = {"summary": {"distance_miles": 1, "days": 99}, "logs": []}
    trip = create_trip(auth_api, result=fake, summary={"days": 99}, id=str(uuid.uuid4()))

    assert trip["result"] != fake
    assert trip["distance_miles"] > 1000 and trip["days"] < 10
    assert Trip.objects.get(pk=trip["id"]).result == trip["result"]


def test_create_cannot_assign_another_owner(auth_api, other_api, create_trip):
    other_id = other_api.get("/api/auth/me").json()["user"]["id"]
    trip = create_trip(auth_api, owner=other_id, owner_id=other_id)
    me = auth_api.get("/api/auth/me").json()["user"]["id"]
    assert Trip.objects.get(pk=trip["id"]).owner_id == me


def test_create_plans_on_the_server_so_a_bad_request_is_refused(auth_api, osrm, plan_payload):
    plan_payload["cycle_used_hours"] = 80
    error = assert_error(
        auth_api.post(LIST, {"request": plan_payload}, format="json"), 400, "validation_error", fields=True
    )
    assert error["fields"] == {"request.cycle_used_hours": ["Cycle hours used must be between 0 and 70."]}
    assert not Trip.objects.exists()


def test_create_without_a_request_names_the_field(auth_api):
    error = assert_error(auth_api.post(LIST, {"title": "x"}, format="json"), 400, "validation_error", fields=True)
    assert "request" in error["fields"]


def test_create_with_an_empty_request_lists_every_missing_part(auth_api):
    error = assert_error(auth_api.post(LIST, {"request": {}}, format="json"), 400, "validation_error", fields=True)
    assert {
        "request.current",
        "request.pickup",
        "request.dropoff",
        "request.cycle_used_hours",
        "request.departure",
        "request.timezone",
    } <= set(error["fields"])


@pytest.mark.parametrize("title", ["T" * 121, "bad\x00title", "bad\ttitle"])
def test_create_rejects_bad_titles(auth_api, osrm, plan_payload, title):
    error = assert_error(
        auth_api.post(LIST, {"title": title, "request": plan_payload}, format="json"),
        400,
        "validation_error",
        fields=True,
    )
    assert "title" in error["fields"]


def test_create_with_no_route_stores_nothing(auth_api, rsps, plan_payload):
    register_osrm(rsps, {"code": "NoRoute"})
    assert_error(auth_api.post(LIST, {"request": plan_payload}, format="json"), 422, "no_route")
    assert not Trip.objects.exists()


def test_create_when_the_router_is_down_stores_nothing(auth_api, rsps, plan_payload):
    rsps.add("GET", OSRM_ROUTE, status=503)
    assert_error(auth_api.post(LIST, {"request": plan_payload}, format="json"), 502, "upstream_error")
    assert not Trip.objects.exists()


def test_saving_right_after_planning_reuses_the_cached_route(auth_api, rsps, plan_payload):
    register_osrm(rsps)
    auth_api.post("/api/plan", plan_payload, format="json")
    auth_api.post(LIST, {"request": plan_payload}, format="json")
    assert len(route_calls(rsps)) == 1, "the save should not ask the router a second time"
    assert len(steps_calls(rsps)) == 1, "or for the turn list"


def test_a_trip_saved_before_directions_existed_reads_back_with_an_empty_list(auth_api, create_trip):
    trip = create_trip(auth_api)
    stored = Trip.objects.get(pk=trip["id"])
    stored.result = {k: v for k, v in stored.result.items() if k != "directions"}
    stored.save()

    read = auth_api.get(f"{LIST}/{trip['id']}").json()

    assert read["result"]["directions"] == []
    ts_contract.load().assert_matches(read, "Trip")


def test_a_saved_trip_reads_back_with_the_directions_it_was_saved_with(auth_api, create_trip):
    trip = create_trip(auth_api)
    assert len(trip["result"]["directions"]) == 2
    assert auth_api.get(f"{LIST}/{trip['id']}").json()["result"]["directions"] == trip["result"]["directions"]


def test_create_is_not_available_signed_out(api, osrm, plan_payload):
    assert_error(api.post(LIST, {"request": plan_payload}, format="json"), 401, "not_authenticated")


def test_two_saves_make_two_trips(auth_api, create_trip):
    first, second = create_trip(auth_api), create_trip(auth_api)
    assert first["id"] != second["id"]
    assert Trip.objects.count() == 2


# List -------------------------------------------------------------------------------------


def test_list_is_empty_for_a_new_account(auth_api):
    assert auth_api.get(LIST).json() == {"results": [], "count": 0}


def test_list_returns_summaries_newest_first(auth_api, create_trip):
    trips = [create_trip(auth_api, title=f"Trip {n}") for n in range(3)]
    now = timezone.now()
    for age, trip in enumerate(trips):
        Trip.objects.filter(pk=trip["id"]).update(created_at=now - timedelta(hours=age))

    data = auth_api.get(LIST).json()

    assert data["count"] == 3
    assert [t["title"] for t in data["results"]] == ["Trip 0", "Trip 1", "Trip 2"]
    for row in data["results"]:
        ts_contract.load().assert_matches(row, "TripSummary")
        assert "request" not in row and "result" not in row


def test_list_does_not_load_the_big_columns(auth_api, create_trip):
    create_trip(auth_api)
    with CaptureQueriesContext(connection) as queries:
        auth_api.get(LIST)
    select = next(q["sql"] for q in queries if 'FROM "trips_trip"' in q["sql"] and "COUNT" not in q["sql"])
    assert '"trips_trip"."result"' not in select
    assert '"trips_trip"."request"' not in select


def test_list_paginates(auth_api, create_trip):
    for n in range(5):
        create_trip(auth_api, title=f"Trip {n}")
    now = timezone.now()
    for age, trip in enumerate(Trip.objects.order_by("title")):
        Trip.objects.filter(pk=trip.pk).update(created_at=now - timedelta(hours=age))

    page = auth_api.get(LIST, {"limit": 2, "offset": 1}).json()

    assert page["count"] == 5
    assert [t["title"] for t in page["results"]] == ["Trip 1", "Trip 2"]
    assert auth_api.get(LIST, {"limit": 2, "offset": 4}).json()["results"][0]["title"] == "Trip 4"


def test_list_past_the_end_is_empty_but_still_counts(auth_api, create_trip):
    create_trip(auth_api)
    assert auth_api.get(LIST, {"offset": 50}).json() == {"results": [], "count": 1}


def test_list_defaults_to_twenty_a_page(auth_api, user):
    Trip.objects.bulk_create([Trip(owner=user, title=f"T{n}", request={}, result={}, summary={}) for n in range(25)])
    data = auth_api.get(LIST).json()
    assert len(data["results"]) == 20 and data["count"] == 25


@pytest.mark.parametrize(
    "params",
    [{"limit": 0}, {"limit": 101}, {"limit": -1}, {"limit": "many"}, {"limit": "1.5"}, {"offset": -1}, {"offset": "x"}],
)
def test_list_rejects_out_of_range_paging(auth_api, params):
    error = assert_error(auth_api.get(LIST, params), 400, "validation_error", fields=True)
    assert set(error["fields"]) <= {"limit", "offset"}


def test_list_accepts_the_page_size_limits(auth_api):
    assert auth_api.get(LIST, {"limit": 1}).status_code == 200
    assert auth_api.get(LIST, {"limit": 100, "offset": 0}).status_code == 200


def test_list_is_not_cached(auth_api):
    assert auth_api.get(LIST)["Cache-Control"] == "no-store"


# Read -------------------------------------------------------------------------------------


def test_read_returns_the_whole_trip(auth_api, create_trip):
    created = create_trip(auth_api)
    fetched = auth_api.get(f"{LIST}/{created['id']}").json()
    assert fetched == created
    ts_contract.load().assert_matches(fetched, "Trip")


def test_read_with_an_id_that_is_not_a_uuid_is_a_404(auth_api):
    assert_error(auth_api.get(f"{LIST}/not-a-uuid"), 404, "not_found")
    assert_error(auth_api.get(f"{LIST}/123"), 404, "not_found")


def test_read_of_an_unknown_uuid_is_a_404(auth_api):
    assert_error(auth_api.get(f"{LIST}/{uuid.uuid4()}"), 404, "not_found")


# Rename -----------------------------------------------------------------------------------


def test_rename_changes_only_the_title(auth_api, create_trip):
    created = create_trip(auth_api)

    response = auth_api.patch(f"{LIST}/{created['id']}", {"title": "  Renamed run  "}, format="json")

    assert response.status_code == 200
    renamed = response.json()
    assert renamed["title"] == "Renamed run"
    assert renamed["result"] == created["result"] and renamed["request"] == created["request"]
    assert renamed["id"] == created["id"] and renamed["created_at"] == created["created_at"]
    assert auth_api.get(f"{LIST}/{created['id']}").json()["title"] == "Renamed run"


def test_rename_moves_updated_at_but_not_created_at(auth_api, create_trip):
    created = create_trip(auth_api)
    before = Trip.objects.get(pk=created["id"])
    Trip.objects.filter(pk=before.pk).update(updated_at=before.updated_at - timedelta(days=1))

    auth_api.patch(f"{LIST}/{created['id']}", {"title": "Later"}, format="json")

    after = Trip.objects.get(pk=created["id"])
    assert after.updated_at > before.updated_at - timedelta(hours=1)
    assert after.created_at == before.created_at


def test_rename_cannot_change_the_request_or_the_result(auth_api, create_trip):
    created = create_trip(auth_api)
    auth_api.patch(
        f"{LIST}/{created['id']}",
        {"title": "Kept", "result": {"x": 1}, "request": {"y": 2}, "owner": 99, "summary": {}},
        format="json",
    )
    stored = Trip.objects.get(pk=created["id"])
    assert stored.result == created["result"] and stored.request == created["request"]
    assert stored.owner.email == "driver@example.com"


@pytest.mark.parametrize(
    ("title", "message"),
    [
        ("", "Give the trip a name."),
        ("   ", "Give the trip a name."),
        (None, "Give the trip a name."),
        ("T" * 121, "Use at most 120 characters."),
        ("bad\x00title", "Remove control characters."),
    ],
)
def test_rename_rejects_bad_titles(auth_api, create_trip, title, message):
    created = create_trip(auth_api)
    error = assert_error(
        auth_api.patch(f"{LIST}/{created['id']}", {"title": title}, format="json"), 400, "validation_error", fields=True
    )
    assert error["fields"]["title"] == [message]
    assert Trip.objects.get(pk=created["id"]).title == "Dallas to Denver"


def test_rename_needs_a_title(auth_api, create_trip):
    created = create_trip(auth_api)
    error = assert_error(
        auth_api.patch(f"{LIST}/{created['id']}", {}, format="json"), 400, "validation_error", fields=True
    )
    assert error["fields"]["title"] == ["Give the trip a name."]


def test_a_120_character_title_is_fine(auth_api, create_trip):
    created = create_trip(auth_api)
    response = auth_api.patch(f"{LIST}/{created['id']}", {"title": "T" * 120}, format="json")
    assert response.status_code == 200 and len(response.json()["title"]) == 120


def test_put_is_not_supported(auth_api, create_trip):
    created = create_trip(auth_api)
    assert_error(auth_api.put(f"{LIST}/{created['id']}", {"title": "x"}, format="json"), 405, "method_not_allowed")


# Delete -----------------------------------------------------------------------------------


def test_delete_removes_the_trip(auth_api, create_trip):
    created = create_trip(auth_api)

    response = auth_api.delete(f"{LIST}/{created['id']}")

    assert response.status_code == 204 and response.content == b""
    assert not Trip.objects.exists()
    assert_error(auth_api.get(f"{LIST}/{created['id']}"), 404, "not_found")
    assert auth_api.get(LIST).json() == {"results": [], "count": 0}


def test_deleting_twice_is_a_404_the_second_time(auth_api, create_trip):
    created = create_trip(auth_api)
    auth_api.delete(f"{LIST}/{created['id']}")
    assert_error(auth_api.delete(f"{LIST}/{created['id']}"), 404, "not_found")


def test_delete_leaves_the_users_other_trips_alone(auth_api, create_trip):
    keep, drop = create_trip(auth_api, title="Keep"), create_trip(auth_api, title="Drop")
    auth_api.delete(f"{LIST}/{drop['id']}")
    assert [t["title"] for t in auth_api.get(LIST).json()["results"]] == ["Keep"]
    assert Trip.objects.get().pk == uuid.UUID(keep["id"])


def test_post_to_a_trip_is_not_supported(auth_api, create_trip):
    created = create_trip(auth_api)
    assert_error(auth_api.post(f"{LIST}/{created['id']}", {}, format="json"), 405, "method_not_allowed")


def test_trip_urls_need_no_trailing_slash(auth_api):
    assert_error(auth_api.get(f"{LIST}/"), 404, "not_found")
