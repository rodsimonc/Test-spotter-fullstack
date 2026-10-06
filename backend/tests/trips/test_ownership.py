"""One user's trips are invisible to every other user, and to anyone signed out."""

from __future__ import annotations

import uuid

import pytest

from apps.trips.models import Trip
from tests.support.contract import assert_error

LIST = "/api/trips"


@pytest.fixture
def owned(auth_api, create_trip):
    """A trip that belongs to `user` (the signed-in `auth_api` client)."""
    return create_trip(auth_api, title="Dana's run")


def test_another_user_cannot_read_the_trip(other_api, owned):
    assert_error(other_api.get(f"{LIST}/{owned['id']}"), 404, "not_found")


def test_another_user_cannot_rename_the_trip(other_api, owned):
    assert_error(other_api.patch(f"{LIST}/{owned['id']}", {"title": "Hijacked"}, format="json"), 404, "not_found")
    assert Trip.objects.get(pk=owned["id"]).title == "Dana's run"


def test_another_user_cannot_delete_the_trip(other_api, owned):
    assert_error(other_api.delete(f"{LIST}/{owned['id']}"), 404, "not_found")
    assert Trip.objects.filter(pk=owned["id"]).exists()


def test_someone_elses_trip_looks_exactly_like_a_trip_that_does_not_exist(other_api, owned):
    """A 403 would confirm the id exists. The 404 bodies must match byte for byte."""
    for method, body in (("get", None), ("patch", {"title": "x"}), ("delete", None)):
        call = getattr(other_api, method)
        mine = call(f"{LIST}/{owned['id']}", body, format="json") if body else call(f"{LIST}/{owned['id']}")
        ghost = call(f"{LIST}/{uuid.uuid4()}", body, format="json") if body else call(f"{LIST}/{uuid.uuid4()}")
        assert mine.status_code == ghost.status_code == 404, method
        assert mine.content == ghost.content, method


def test_the_list_only_shows_the_users_own_trips(auth_api, other_api, owned, create_trip):
    theirs = create_trip(other_api, title="Otto's run")

    mine_list = auth_api.get(LIST).json()
    their_list = other_api.get(LIST).json()

    assert [t["id"] for t in mine_list["results"]] == [owned["id"]] and mine_list["count"] == 1
    assert [t["id"] for t in their_list["results"]] == [theirs["id"]] and their_list["count"] == 1


def test_paging_cannot_reach_another_users_rows(other_api, owned):
    assert other_api.get(LIST, {"offset": 0, "limit": 100}).json() == {"results": [], "count": 0}


def test_the_other_user_can_still_use_their_own_trip(other_api, create_trip):
    theirs = create_trip(other_api)
    assert other_api.patch(f"{LIST}/{theirs['id']}", {"title": "Mine"}, format="json").status_code == 200
    assert other_api.delete(f"{LIST}/{theirs['id']}").status_code == 204


def test_the_owner_still_sees_the_trip_after_someone_else_tries_to_delete_it(auth_api, other_api, owned):
    other_api.delete(f"{LIST}/{owned['id']}")
    assert auth_api.get(f"{LIST}/{owned['id']}").json()["title"] == "Dana's run"


def test_ownership_survives_a_session_swap(owned, make_user):
    """Signing in as someone else on the same browser must not carry the old user's trips over."""
    from rest_framework.test import APIClient

    other = make_user("swap@example.com", "Zx9-battery-staple-42")
    client = APIClient()
    client.force_login(other)
    assert client.get(LIST).json()["count"] == 0
    assert_error(client.get(f"{LIST}/{owned['id']}"), 404, "not_found")


@pytest.mark.parametrize(
    ("method", "body"),
    [("get", None), ("patch", {"title": "x"}), ("delete", None)],
)
def test_signed_out_requests_get_401_not_404(api, owned, method, body):
    call = getattr(api, method)
    path = f"{LIST}/{owned['id']}"
    response = call(path, body, format="json") if body else call(path)
    assert_error(response, 401, "not_authenticated")


def test_signed_out_list_and_create_get_401(api, osrm, plan_payload):
    assert_error(api.get(LIST), 401, "not_authenticated")
    assert_error(api.post(LIST, {"request": plan_payload}, format="json"), 401, "not_authenticated")


def test_the_401_sends_no_challenge_header_that_would_open_a_browser_prompt(api):
    response = api.get(LIST)
    assert "WWW-Authenticate" not in response.headers


def test_a_deactivated_user_loses_access_to_their_trips(auth_api, user, owned):
    user.is_active = False
    user.save()
    assert_error(auth_api.get(f"{LIST}/{owned['id']}"), 401, "not_authenticated")


def test_signing_out_ends_access(auth_api, owned):
    auth_api.post("/api/auth/logout")
    assert_error(auth_api.get(f"{LIST}/{owned['id']}"), 401, "not_authenticated")
