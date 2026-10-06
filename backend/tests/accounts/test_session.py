"""GET /api/auth/csrf, GET /api/auth/me and POST /api/auth/logout."""

from __future__ import annotations

from django.contrib.sessions.models import Session

from tests.support import ts_contract
from tests.support.contract import assert_error


def test_csrf_endpoint_sets_the_cookie_and_returns_a_token(api):
    response = api.get("/api/auth/csrf")

    assert response.status_code == 200
    assert response.json()["csrf"]
    assert response.cookies["csrftoken"].value
    assert response["Cache-Control"] == "no-store"


def test_csrf_token_is_masked_differently_each_time(api):
    """Django masks the token per response, which blunts BREACH-style attacks."""
    assert api.get("/api/auth/csrf").json()["csrf"] != api.get("/api/auth/csrf").json()["csrf"]


def test_csrf_cookie_can_be_read_by_the_page(api):
    """The frontend copies the cookie into a header, so it cannot be HttpOnly."""
    cookie = api.get("/api/auth/csrf").cookies["csrftoken"]
    assert not cookie["httponly"]
    assert cookie["samesite"] == "Lax"


def test_csrf_endpoint_is_get_only(api):
    assert_error(api.post("/api/auth/csrf"), 405, "method_not_allowed")


def test_me_is_null_when_signed_out(api):
    response = api.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == {"user": None}


def test_me_returns_the_signed_in_user(auth_api, user):
    data = auth_api.get("/api/auth/me").json()
    assert data == {"user": {"id": user.id, "email": "driver@example.com", "name": "Dana Driver"}}
    ts_contract.load().assert_matches(data["user"], "User")


def test_me_is_never_cached(auth_api):
    assert auth_api.get("/api/auth/me")["Cache-Control"] == "no-store"


def test_me_does_not_answer_posts(auth_api):
    assert_error(auth_api.post("/api/auth/me"), 405, "method_not_allowed")


def test_me_reports_signed_out_after_the_account_is_deactivated(auth_api, user):
    user.is_active = False
    user.save()
    assert auth_api.get("/api/auth/me").json() == {"user": None}


def test_me_reports_signed_out_after_the_account_is_deleted(auth_api, user):
    user.delete()
    assert auth_api.get("/api/auth/me").json() == {"user": None}


def test_logout_ends_the_session(auth_api):
    key = auth_api.cookies["sessionid"].value

    response = auth_api.post("/api/auth/logout")

    assert response.status_code == 204
    assert response.content == b""
    assert auth_api.get("/api/auth/me").json() == {"user": None}
    assert not Session.objects.filter(session_key=key).exists(), "the session row should be deleted"


def test_a_signed_out_session_id_cannot_be_reused(auth_api):
    from rest_framework.test import APIClient

    stolen = auth_api.cookies["sessionid"].value
    auth_api.post("/api/auth/logout")

    thief = APIClient()
    thief.cookies["sessionid"] = stolen
    assert thief.get("/api/auth/me").json() == {"user": None}


def test_logout_when_already_signed_out_is_fine(api):
    assert api.post("/api/auth/logout").status_code == 204


def test_logout_without_a_csrf_token_is_refused_for_a_signed_in_user(user):
    from rest_framework.test import APIClient

    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    assert_error(client.post("/api/auth/logout"), 403, "forbidden")
    assert client.get("/api/auth/me").json()["user"] is not None


def test_session_cookie_is_http_only_with_samesite_lax(api, user):
    api.post("/api/auth/login", {"email": user.email, "password": "Zx9-battery-staple-42"}, format="json")
    cookie = api.cookies["sessionid"]
    assert cookie["httponly"]
    assert cookie["samesite"] == "Lax"
    assert cookie["path"] == "/"


def test_logout_clears_the_session_cookie(api, user):
    api.post("/api/auth/login", {"email": user.email, "password": "Zx9-battery-staple-42"}, format="json")
    api.post("/api/auth/logout")
    assert api.cookies["sessionid"].value == ""
