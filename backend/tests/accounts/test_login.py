"""POST /api/auth/login: success, one generic failure, and session handling."""

from __future__ import annotations

import pytest
from django.contrib.auth import SESSION_KEY
from django.contrib.sessions.models import Session

from tests.support.contract import assert_error

URL = "/api/auth/login"
PASSWORD = "Zx9-battery-staple-42"
GENERIC = "Email or password is incorrect."


@pytest.fixture
def dana(make_user):
    return make_user("dana@example.com", PASSWORD, name="Dana Driver")


def creds(**overrides) -> dict:
    return {"email": "dana@example.com", "password": PASSWORD} | overrides


def test_login_returns_the_user_and_starts_a_session(api, dana):
    response = api.post(URL, creds(), format="json")

    assert response.status_code == 200
    assert response.json()["user"] == {"id": dana.id, "email": "dana@example.com", "name": "Dana Driver"}
    assert api.get("/api/auth/me").json()["user"]["id"] == dana.id


def test_login_sets_last_login(api, dana):
    assert dana.last_login is None
    api.post(URL, creds(), format="json")
    dana.refresh_from_db()
    assert dana.last_login is not None


@pytest.mark.parametrize("typed", ["DANA@EXAMPLE.COM", "Dana@Example.com", "  dana@example.com  "])
def test_email_matching_ignores_case_and_edge_spaces(api, dana, typed):
    assert api.post(URL, creds(email=typed), format="json").status_code == 200


def test_login_never_returns_the_hash(api, dana):
    text = api.post(URL, creds(), format="json").content.decode()
    assert PASSWORD not in text and "pbkdf2" not in text and "md5$" not in text


@pytest.mark.parametrize(
    "attempt",
    [
        {"email": "dana@example.com", "password": "wrong-password-1"},
        {"email": "nobody@example.com", "password": PASSWORD},
        {"email": "nobody@example.com", "password": "wrong-password-1"},
        {"email": "not-an-email", "password": PASSWORD},
        {"email": "dana@example.com", "password": PASSWORD + " "},
        {"email": "dana@example.com", "password": PASSWORD.upper()},
        {"email": "' OR '1'='1", "password": "' OR '1'='1"},
        {"email": "dana@example.com' --", "password": PASSWORD},
    ],
)
def test_every_bad_credential_gets_the_same_answer(api, dana, attempt):
    response = api.post(URL, attempt, format="json")

    error = assert_error(response, 400, "invalid_credentials", fields=False)
    assert error["message"] == GENERIC
    assert "sessionid" not in response.cookies or not response.cookies["sessionid"].value


def test_wrong_password_and_unknown_email_are_indistinguishable(api, dana):
    wrong_password = api.post(URL, creds(password="wrong-password-1"), format="json")
    unknown_email = api.post(URL, creds(email="ghost@example.com"), format="json")

    assert wrong_password.status_code == unknown_email.status_code
    assert wrong_password.json() == unknown_email.json()
    assert set(wrong_password.headers) == set(unknown_email.headers)


def test_an_unknown_email_still_pays_for_a_password_hash(api, dana, monkeypatch):
    """Without the dummy hash, response time would tell an attacker which emails have accounts."""
    from apps.accounts.models import User

    hashed = []
    original = User.set_password

    def spy(self, raw_password):
        hashed.append(raw_password)
        return original(self, raw_password)

    monkeypatch.setattr(User, "set_password", spy)
    api.post(URL, creds(email="ghost@example.com", password="wrong-password-1"), format="json")

    assert hashed == ["wrong-password-1"]


def test_a_deactivated_account_gets_the_same_generic_answer(api, dana):
    dana.is_active = False
    dana.save()
    error = assert_error(api.post(URL, creds(), format="json"), 400, "invalid_credentials")
    assert error["message"] == GENERIC


def test_a_failed_login_does_not_sign_anyone_in(api, dana):
    api.post(URL, creds(password="wrong-password-1"), format="json")
    assert api.get("/api/auth/me").json() == {"user": None}


@pytest.mark.parametrize(
    ("payload", "fields"),
    [
        ({}, {"email", "password"}),
        ({"email": "dana@example.com"}, {"password"}),
        ({"password": PASSWORD}, {"email"}),
        ({"email": "", "password": ""}, {"email", "password"}),
        ({"email": None, "password": None}, {"email", "password"}),
    ],
)
def test_missing_fields_are_named(api, payload, fields):
    error = assert_error(api.post(URL, payload, format="json"), 400, "validation_error", fields=True)
    assert set(error["fields"]) == fields


@pytest.mark.parametrize(
    "payload", [{"email": "a" * 300, "password": "x"}, {"email": "a@example.com", "password": "x" * 200}]
)
def test_oversized_credentials_give_the_generic_message(api, payload):
    error = assert_error(api.post(URL, payload, format="json"), 400, "validation_error", fields=True)
    assert GENERIC in sum(error["fields"].values(), [])


def test_non_string_credentials_do_not_crash(api, dana):
    for value in (123, ["a"], {"a": 1}, True):
        response = api.post(URL, {"email": value, "password": value}, format="json")
        assert response.status_code == 400, value


def test_login_swaps_a_planted_session_for_a_new_one(api, dana):
    session = api.session
    session["planted"] = "value"
    session.save()
    planted = session.session_key

    api.post(URL, creds(), format="json")

    fresh = api.cookies["sessionid"].value
    assert fresh != planted, "the session id must change at login"
    assert not Session.objects.filter(session_key=planted).exists()
    stored = Session.objects.get(session_key=fresh).get_decoded()
    assert stored[SESSION_KEY] == str(dana.pk)
    assert "planted" not in stored, "nothing from the old session may carry over"


def test_each_login_gets_its_own_session(dana):
    from rest_framework.test import APIClient

    first, second = APIClient(), APIClient()
    first.post(URL, creds(), format="json")
    second.post(URL, creds(), format="json")
    assert first.cookies["sessionid"].value != second.cookies["sessionid"].value
    first.post("/api/auth/logout")
    assert second.get("/api/auth/me").json()["user"]["id"] == dana.id


def test_login_returns_a_csrf_token_that_works_for_the_next_request(browser, dana):
    old_token = browser.post(URL, creds(), format="json").json()["csrf"]
    assert old_token
    browser.credentials(HTTP_X_CSRFTOKEN=old_token)
    assert browser.post("/api/auth/logout").status_code == 204


def test_the_token_fetched_before_login_stops_working_after_it(browser, dana):
    """Django rotates the CSRF secret at login. The page must pick up the token the response carries."""
    response = browser.post(URL, creds(), format="json")
    assert response.status_code == 200
    assert_error(browser.post("/api/auth/logout"), 403, "forbidden")


def test_login_is_post_only(api):
    assert_error(api.get(URL), 405, "method_not_allowed")
