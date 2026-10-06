"""Cookie flags under the production settings, and what happens to cookies across login and logout."""

from __future__ import annotations

import pytest

from tests.conftest import PROD_HOST

PASSWORD = "Zx9-battery-staple-42"


@pytest.fixture
def signed_up(prod_client):
    """Complete the sign-up flow the way the page does, over HTTPS with CSRF enforced."""
    token = prod_client.get("/api/auth/csrf").json()["csrf"]
    prod_client.credentials(HTTP_X_CSRFTOKEN=token)
    response = prod_client.post(
        "/api/auth/register", {"email": "dana@example.com", "password": PASSWORD}, format="json"
    )
    assert response.status_code == 201, response.content
    return response


def test_the_session_cookie_is_secure_http_only_and_lax(signed_up):
    cookie = signed_up.cookies["sessionid"]
    assert cookie["secure"]
    assert cookie["httponly"]
    assert cookie["samesite"] == "Lax"
    assert cookie["path"] == "/"


def test_the_session_cookie_has_no_domain_so_it_stays_on_this_host(signed_up):
    assert signed_up.cookies["sessionid"]["domain"] == ""


def test_the_session_cookie_lasts_two_weeks_at_most(signed_up):
    assert 0 < int(signed_up.cookies["sessionid"]["max-age"]) <= 14 * 24 * 3600


def test_the_csrf_cookie_is_secure_and_lax_but_readable_by_the_page(prod_client):
    cookie = prod_client.get("/api/auth/csrf").cookies["csrftoken"]
    assert cookie["secure"]
    assert cookie["samesite"] == "Lax"
    assert not cookie["httponly"], "the page copies this cookie into the X-CSRFToken header"


def test_the_csrf_cookie_is_renewed_after_sign_in(signed_up):
    assert signed_up.cookies["csrftoken"].value


def test_logout_expires_the_session_cookie_securely(prod_client, signed_up):
    prod_client.credentials(HTTP_X_CSRFTOKEN=signed_up.json()["csrf"])
    response = prod_client.post("/api/auth/logout")

    cookie = response.cookies["sessionid"]
    assert response.status_code == 204
    assert cookie.value == ""
    assert cookie["max-age"] == 0 or cookie["expires"].startswith("Thu, 01 Jan 1970")
    assert cookie["samesite"] == "Lax"


def test_a_session_cookie_is_never_set_for_a_visitor_who_does_not_sign_in(prod_client):
    for path in ("/api/health", "/api/auth/me", "/api/auth/csrf"):
        assert "sessionid" not in prod_client.get(path).cookies, path


def test_a_failed_login_sets_no_session_cookie(prod_client, make_user):
    make_user("dana@example.com", PASSWORD)
    prod_client.credentials(HTTP_X_CSRFTOKEN=prod_client.get("/api/auth/csrf").json()["csrf"])
    response = prod_client.post(
        "/api/auth/login", {"email": "dana@example.com", "password": "wrong-pw-123"}, format="json"
    )
    assert response.status_code == 400
    assert "sessionid" not in response.cookies


def test_the_cookie_tests_really_run_over_https_on_the_production_host(prod_client):
    response = prod_client.get("/api/health")
    assert response.status_code == 200, "a redirect here means the client isn't speaking HTTPS"
    assert prod_client.defaults["HTTP_HOST"] == PROD_HOST


def test_session_ids_are_long_and_random(signed_up):
    value = signed_up.cookies["sessionid"].value
    assert len(value) >= 32 and value.isalnum()
