"""CSRF protection: login and register (no session yet) and every unsafe request once signed in."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from tests.support.contract import assert_error
from tests.support.osrm import register_osrm

PASSWORD = "Zx9-battery-staple-42"
FORBIDDEN_MESSAGE = "Your session check failed. Reload the page and try again."


@pytest.fixture
def dana(make_user):
    return make_user("dana@example.com", PASSWORD)


@pytest.fixture
def signed_in(signed_in_browser):
    return signed_in_browser


def test_login_without_a_token_is_forbidden(dana):
    client = APIClient(enforce_csrf_checks=True)
    error = assert_error(
        client.post("/api/auth/login", {"email": dana.email, "password": PASSWORD}, format="json"),
        403,
        "forbidden",
    )
    assert error["message"] == FORBIDDEN_MESSAGE
    assert client.get("/api/auth/me").json() == {"user": None}


def test_register_without_a_token_is_forbidden():
    client = APIClient(enforce_csrf_checks=True)
    assert_error(
        client.post("/api/auth/register", {"email": "a@example.com", "password": PASSWORD}, format="json"),
        403,
        "forbidden",
    )
    from apps.accounts.models import User

    assert not User.objects.exists()


def test_the_refusal_does_not_say_which_check_failed(dana):
    client = APIClient(enforce_csrf_checks=True)
    text = client.post("/api/auth/login", {}, format="json").content.decode().lower()
    for hint in ("cookie", "origin", "referer", "token missing", "incorrect"):
        assert hint not in text


@pytest.mark.parametrize("token", ["", "garbage", "x" * 64, "a" * 10])
def test_login_with_a_wrong_token_is_forbidden(dana, token):
    client = APIClient(enforce_csrf_checks=True)
    client.get("/api/auth/csrf")
    client.credentials(HTTP_X_CSRFTOKEN=token)
    assert_error(
        client.post("/api/auth/login", {"email": dana.email, "password": PASSWORD}, format="json"),
        403,
        "forbidden",
    )


def test_a_token_without_its_cookie_is_forbidden(dana):
    """A token copied from one browser is useless in another that never got the cookie."""
    donor = APIClient()
    token = donor.get("/api/auth/csrf").json()["csrf"]

    attacker = APIClient(enforce_csrf_checks=True)
    attacker.credentials(HTTP_X_CSRFTOKEN=token)
    assert_error(
        attacker.post("/api/auth/login", {"email": dana.email, "password": PASSWORD}, format="json"),
        403,
        "forbidden",
    )


def test_a_token_from_another_session_is_forbidden(dana):
    donor = APIClient()
    token = donor.get("/api/auth/csrf").json()["csrf"]

    victim = APIClient(enforce_csrf_checks=True)
    victim.get("/api/auth/csrf")
    victim.credentials(HTTP_X_CSRFTOKEN=token)
    assert_error(
        victim.post("/api/auth/login", {"email": dana.email, "password": PASSWORD}, format="json"),
        403,
        "forbidden",
    )


def test_login_with_a_valid_token_works(browser, dana):
    response = browser.post("/api/auth/login", {"email": dana.email, "password": PASSWORD}, format="json")
    assert response.status_code == 200


def test_register_with_a_valid_token_works(browser):
    response = browser.post("/api/auth/register", {"email": "fresh@example.com", "password": PASSWORD}, format="json")
    assert response.status_code == 201


def test_a_request_from_another_origin_is_forbidden_even_with_a_valid_token(browser, dana):
    response = browser.post(
        "/api/auth/login",
        {"email": dana.email, "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="https://evil.example",
    )
    assert_error(response, 403, "forbidden")


def test_a_request_from_the_same_origin_passes(browser, dana):
    response = browser.post(
        "/api/auth/login",
        {"email": dana.email, "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="http://testserver",
    )
    assert response.status_code == 200


def test_a_trusted_origin_passes(browser, dana, settings):
    settings.CSRF_TRUSTED_ORIGINS = ["https://app.example.org"]
    response = browser.post(
        "/api/auth/login",
        {"email": dana.email, "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="https://app.example.org",
    )
    assert response.status_code == 200


# Signed in -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/api/trips", {"request": {}}),
        ("patch", "/api/trips/00000000-0000-4000-8000-000000000000", {"title": "x"}),
        ("delete", "/api/trips/00000000-0000-4000-8000-000000000000", None),
        ("post", "/api/auth/logout", None),
    ],
)
def test_unsafe_requests_need_the_token_once_signed_in(signed_in, method, path, body):
    signed_in.forget_token()
    call = getattr(signed_in, method)
    response = call(path, body, format="json") if body is not None else call(path)
    assert_error(response, 403, "forbidden")


def test_a_signed_in_user_cannot_save_a_trip_without_the_token(signed_in, rsps, plan_payload):
    register_osrm(rsps)
    signed_in.forget_token()
    assert_error(signed_in.post("/api/trips", {"request": plan_payload}, format="json"), 403, "forbidden")
    from apps.trips.models import Trip

    assert not Trip.objects.exists()


def test_the_same_trip_save_works_with_the_token(signed_in, rsps, plan_payload):
    register_osrm(rsps)
    response = signed_in.post("/api/trips", {"request": plan_payload}, format="json")
    assert response.status_code == 201


def test_a_signed_in_user_can_rename_and_delete_with_the_token(signed_in, rsps, plan_payload):
    register_osrm(rsps)
    trip_id = signed_in.post("/api/trips", {"request": plan_payload}, format="json").json()["id"]

    assert signed_in.patch(f"/api/trips/{trip_id}", {"title": "Renamed"}, format="json").status_code == 200
    assert signed_in.delete(f"/api/trips/{trip_id}").status_code == 204


def test_safe_requests_never_need_the_token(signed_in):
    signed_in.forget_token()
    assert signed_in.get("/api/trips").status_code == 200
    assert signed_in.get("/api/auth/me").status_code == 200


def test_planning_works_without_a_token_when_signed_out(rsps, plan_payload):
    """Planning has no session to protect. DRF only enforces CSRF for session-authenticated users."""
    register_osrm(rsps)
    client = APIClient(enforce_csrf_checks=True)
    assert client.post("/api/plan", plan_payload, format="json").status_code == 200


def test_planning_while_signed_in_needs_the_token(signed_in, rsps, plan_payload):
    register_osrm(rsps)
    signed_in.forget_token()
    assert_error(signed_in.post("/api/plan", plan_payload, format="json"), 403, "forbidden")
