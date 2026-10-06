"""POST /api/auth/register: who can sign up, what happens to the session, and the password rules."""

from __future__ import annotations

import pytest
from django.contrib.auth import SESSION_KEY
from django.contrib.sessions.models import Session
from django.db import IntegrityError

from apps.accounts.models import User, UserManager
from tests.support import ts_contract
from tests.support.contract import assert_error

URL = "/api/auth/register"
GOOD_PASSWORD = "Zx9-battery-staple-42"


def body(**overrides) -> dict:
    return {"email": "new.driver@example.com", "password": GOOD_PASSWORD, "name": "Nia Driver"} | overrides


def test_register_creates_the_account_and_signs_in(api):
    response = api.post(URL, body(), format="json")

    assert response.status_code == 201
    data = response.json()
    assert data["user"] == {"id": User.objects.get().id, "email": "new.driver@example.com", "name": "Nia Driver"}
    ts_contract.load().assert_matches(data["user"], "User")
    assert api.get("/api/auth/me").json()["user"]["email"] == "new.driver@example.com"


def test_register_returns_a_fresh_csrf_token(browser):
    token = browser.post(URL, body(), format="json").json()["csrf"]
    assert token
    browser.credentials(HTTP_X_CSRFTOKEN=token)
    assert browser.post("/api/auth/logout").status_code == 204


def test_register_never_returns_the_password_or_its_hash(api):
    text = api.post(URL, body(), format="json").content.decode()
    assert GOOD_PASSWORD not in text
    assert "pbkdf2" not in text and "md5$" not in text and "password" not in text.lower()


def test_the_password_is_stored_hashed(api):
    api.post(URL, body(), format="json")
    user = User.objects.get()
    assert user.password != GOOD_PASSWORD
    assert user.password.startswith(("pbkdf2_", "md5$"))
    assert user.check_password(GOOD_PASSWORD)


def test_name_is_optional(api):
    response = api.post(URL, {"email": "a@example.com", "password": GOOD_PASSWORD}, format="json")
    assert response.status_code == 201
    assert response.json()["user"]["name"] == ""


@pytest.mark.parametrize("typed", ["Mixed.Case@Example.COM", "  spaced@example.com  "])
def test_email_is_trimmed_and_lowercased(api, typed):
    response = api.post(URL, body(email=typed), format="json")
    assert response.status_code == 201
    assert response.json()["user"]["email"] == typed.strip().lower()
    assert User.objects.get().email == typed.strip().lower()


@pytest.mark.parametrize("second", ["dana@example.com", "DANA@EXAMPLE.COM", "Dana@Example.com", " dana@example.com "])
def test_an_email_can_only_register_once_whatever_its_case(api, second):
    assert api.post(URL, body(email="Dana@example.com"), format="json").status_code == 201
    api.post("/api/auth/logout")

    error = assert_error(api.post(URL, body(email=second), format="json"), 400, "validation_error", fields=True)

    assert error["fields"] == {"email": ["An account with this email already exists."]}
    assert User.objects.count() == 1


def test_two_sign_ups_racing_for_one_address_get_the_same_answer(api, monkeypatch):
    def lose_the_race(self, *args, **kwargs):
        raise IntegrityError("UNIQUE constraint failed: accounts_user.email")

    monkeypatch.setattr(UserManager, "create_user", lose_the_race)
    error = assert_error(api.post(URL, body(), format="json"), 400, "validation_error", fields=True)
    assert error["fields"] == {"email": ["An account with this email already exists."]}


@pytest.mark.parametrize(
    ("email", "message"),
    [
        (None, "Enter your email."),
        ("", "Enter your email."),
        ("   ", "Enter your email."),
        ("not-an-email", "Enter a valid email address."),
        ("a@b", "Enter a valid email address."),
        ("two@@example.com", "Enter a valid email address."),
        ("spa ce@example.com", "Enter a valid email address."),
        ("a" * 250 + "@example.com", "Use at most 254 characters."),
        (12345, "Enter a valid email address."),
        (["a@example.com"], "Enter a valid email address."),
        ({"email": "a@example.com"}, "Enter a valid email address."),
        (True, "Enter a valid email address."),
    ],
)
def test_bad_emails_are_rejected_with_a_message(api, email, message):
    error = assert_error(api.post(URL, body(email=email), format="json"), 400, "validation_error", fields=True)
    assert error["fields"]["email"] == [message]
    assert not User.objects.exists()


def test_missing_email_and_password_are_both_reported(api):
    error = assert_error(api.post(URL, {}, format="json"), 400, "validation_error", fields=True)
    assert error["fields"] == {"email": ["Enter your email."], "password": ["Choose a password."]}


@pytest.mark.parametrize(
    ("password", "fragment"),
    [
        ("short1!", "too short"),
        ("1234567890", "entirely numeric"),
        ("password123", "too common"),
        ("qwertyuiop", "too common"),
        ("new.driver1", "too similar"),
    ],
)
def test_password_rules_run_through_djangos_validators(api, password, fragment):
    error = assert_error(api.post(URL, body(password=password), format="json"), 400, "validation_error", fields=True)
    assert fragment in " ".join(error["fields"]["password"])
    assert not User.objects.exists()


def test_a_password_close_to_the_email_is_rejected(api):
    error = assert_error(
        api.post(URL, body(email="driver.dana@example.com", password="driver.dana"), format="json"),
        400,
        "validation_error",
        fields=True,
    )
    assert any("too similar" in m for m in error["fields"]["password"])


@pytest.mark.parametrize("password", [None, ""])
def test_a_blank_password_is_asked_for(api, password):
    error = assert_error(api.post(URL, body(password=password), format="json"), 400, "validation_error", fields=True)
    assert error["fields"]["password"] == ["Choose a password."]


def test_passwords_over_128_characters_are_refused(api):
    error = assert_error(api.post(URL, body(password="aB3-" * 33), format="json"), 400, "validation_error", fields=True)
    assert error["fields"]["password"] == ["Use at most 128 characters."]


def test_a_128_character_password_is_fine(api):
    assert api.post(URL, body(password="aB3-" * 32), format="json").status_code == 201


def test_passwords_keep_their_spaces(api):
    spaced = "  correct horse battery 99  "
    assert api.post(URL, body(password=spaced), format="json").status_code == 201
    assert User.objects.get().check_password(spaced)


def test_a_non_string_password_is_rejected(api):
    assert_error(api.post(URL, body(password=1234567890123), format="json"), 400, "validation_error", fields=True)


@pytest.mark.parametrize("name", ["N" * 121, "bad\x00name", "tab\tname", "line\nbreak"])
def test_bad_names_are_rejected(api, name):
    error = assert_error(api.post(URL, body(name=name), format="json"), 400, "validation_error", fields=True)
    assert "name" in error["fields"]


def test_names_are_stored_as_typed_apart_from_trimming(api):
    typed = '  <b onmouseover="x()">Zoë "Z" O\'Neil 王</b>  '
    response = api.post(URL, body(name=typed), format="json")
    assert response.json()["user"]["name"] == typed.strip()


def test_extra_fields_cannot_grant_privileges(api):
    api.post(URL, body() | {"is_staff": True, "is_superuser": True, "is_active": False, "id": 999}, format="json")
    user = User.objects.get()
    assert not user.is_staff and not user.is_superuser and user.is_active and user.id != 999


def test_a_body_that_is_not_an_object_is_rejected(api):
    assert api.post(URL, ["a@example.com"], format="json").status_code == 400


def test_signing_up_starts_a_new_session_even_if_one_was_planted(api):
    session = api.session
    session["planted"] = "value"
    session.save()
    planted = session.session_key

    api.post(URL, body(), format="json")

    now = api.cookies["sessionid"].value
    assert now != planted
    assert not Session.objects.filter(session_key=planted).exists()
    assert Session.objects.get(session_key=now).get_decoded()[SESSION_KEY] == str(User.objects.get().pk)


def test_register_is_post_only(api):
    assert_error(api.get(URL), 405, "method_not_allowed")
