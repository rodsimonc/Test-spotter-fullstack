"""Per-IP rate limits, one counter per endpoint family, kept in the database cache."""

from __future__ import annotations

import logging

import pytest
from rest_framework.test import APIClient

from apps.common.throttling import ScopedIPThrottle
from tests.support.contract import assert_error
from tests.support.osrm import CHICAGO, NOMINATIM_REVERSE, PHOTON_SEARCH, photon_payload, register_osrm

PASSWORD = "Zx9-battery-staple-42"

pytestmark = pytest.mark.usefixtures("throttle_table")


@pytest.fixture
def upstreams(rsps):
    register_osrm(rsps)
    rsps.add("GET", PHOTON_SEARCH, json=photon_payload(CHICAGO))
    rsps.add("GET", NOMINATIM_REVERSE, json={"error": "Unable to geocode"})


@pytest.fixture
def clock(monkeypatch):
    """A clock the test moves by hand. Throttling reads time through `ScopedIPThrottle.timer`."""
    now = {"t": 1_000_000.0}
    monkeypatch.setattr(ScopedIPThrottle, "timer", staticmethod(lambda: now["t"]))
    return now


def hit(client, method, path, body=None, **extra):
    call = getattr(client, method)
    return call(path, body, format="json", **extra) if body is not None else call(path, **extra)


def exhaust(client, method, path, allowed, body=None, **extra):
    """Make `allowed` requests that must all pass the limiter, then return the next response."""
    for n in range(allowed):
        response = hit(client, method, path, body, **extra)
        assert response.status_code != 429, f"throttled early, on request {n + 1} of {allowed}"
    return hit(client, method, path, body, **extra)


# Rates from the spec ----------------------------------------------------------------------


def test_plan_allows_30_a_minute(api, plan_payload, upstreams):
    blocked = exhaust(api, "post", "/api/plan", 30, plan_payload)
    assert_error(blocked, 429, "throttled")


def test_geocode_search_allows_90_a_minute(api, upstreams):
    blocked = exhaust(api, "get", "/api/geocode/search?q=chi", 90)
    assert_error(blocked, 429, "throttled")


def test_reverse_geocode_allows_30_a_minute(api, upstreams):
    blocked = exhaust(api, "get", "/api/geocode/reverse?lat=41.9&lon=-87.6", 30)
    assert_error(blocked, 429, "throttled")


def test_login_allows_10_a_minute(api, make_user):
    make_user("dana@example.com", PASSWORD)
    body = {"email": "dana@example.com", "password": "wrong-password-1"}
    assert_error(exhaust(api, "post", "/api/auth/login", 10, body), 429, "throttled")


def test_register_allows_10_a_minute(api):
    bodies = [{"email": f"user{n}@example.com", "password": PASSWORD} for n in range(11)]
    for body in bodies[:10]:
        assert api.post("/api/auth/register", body, format="json").status_code == 201
        api.post("/api/auth/logout")
    assert_error(api.post("/api/auth/register", bodies[10], format="json"), 429, "throttled")


def test_trips_allow_60_a_minute(auth_api):
    assert_error(exhaust(auth_api, "get", "/api/trips", 60), 429, "throttled")


def test_a_correct_password_is_refused_once_the_limit_is_hit(api, make_user):
    make_user("dana@example.com", PASSWORD)
    exhaust(api, "post", "/api/auth/login", 10, {"email": "dana@example.com", "password": "wrong-password-1"})
    assert_error(
        api.post("/api/auth/login", {"email": "dana@example.com", "password": PASSWORD}, format="json"),
        429,
        "throttled",
    )


# What the 429 looks like --------------------------------------------------------------------


def test_the_429_carries_retry_after_and_the_shared_error_body(api, plan_payload, upstreams, clock):
    exhaust(api, "post", "/api/plan", 30, plan_payload)
    clock["t"] += 20

    response = api.post("/api/plan", plan_payload, format="json")

    error = assert_error(response, 429, "throttled", fields=False)
    assert response["Retry-After"] == "40"
    assert error["message"] == "Too many requests. Try again in 40 seconds."
    assert response["Cache-Control"] == "no-store"


def test_retry_after_is_never_zero(api, plan_payload, upstreams, clock):
    exhaust(api, "post", "/api/plan", 30, plan_payload)
    clock["t"] += 59.9
    assert int(api.post("/api/plan", plan_payload, format="json")["Retry-After"]) >= 1


# Windows, scopes and clients ----------------------------------------------------------------


def test_requests_pass_again_after_the_minute_is_up(api, plan_payload, upstreams, clock):
    exhaust(api, "post", "/api/plan", 30, plan_payload)
    assert api.post("/api/plan", plan_payload, format="json").status_code == 429

    clock["t"] += 61

    assert api.post("/api/plan", plan_payload, format="json").status_code == 200


def test_each_scope_counts_separately(api, plan_payload, upstreams, make_user):
    make_user("dana@example.com", PASSWORD)
    exhaust(api, "post", "/api/auth/login", 10, {"email": "dana@example.com", "password": "wrong-password-1"})

    assert api.post("/api/plan", plan_payload, format="json").status_code == 200
    assert api.get("/api/geocode/search?q=chi").status_code == 200
    assert (
        api.post("/api/auth/register", {"email": "new@example.com", "password": PASSWORD}, format="json").status_code
        == 201
    )


def test_each_address_has_its_own_counter(plan_payload, upstreams):
    first, second = APIClient(REMOTE_ADDR="198.51.100.1"), APIClient(REMOTE_ADDR="198.51.100.2")
    assert_error(exhaust(first, "post", "/api/plan", 30, plan_payload), 429, "throttled")

    assert second.post("/api/plan", plan_payload, format="json").status_code == 200


def test_ipv6_addresses_in_one_64_share_a_counter(plan_payload, upstreams):
    first = APIClient(REMOTE_ADDR="2001:db8:1:2::1")
    second = APIClient(REMOTE_ADDR="2001:db8:1:2:ffff:ffff:ffff:ffff")
    other_network = APIClient(REMOTE_ADDR="2001:db8:1:3::1")
    exhaust(first, "post", "/api/plan", 30, plan_payload)

    assert second.post("/api/plan", plan_payload, format="json").status_code == 429
    assert other_network.post("/api/plan", plan_payload, format="json").status_code == 200


def test_unthrottled_endpoints_stay_open(api, upstreams):
    for path in ("/api/health", "/api/auth/me", "/api/auth/csrf"):
        for _ in range(120):
            assert api.get(path).status_code == 200


def test_logout_is_not_throttled(api):
    for _ in range(40):
        assert api.post("/api/auth/logout").status_code == 204


# Spoofing ------------------------------------------------------------------------------------


def test_x_forwarded_for_is_ignored_by_default(plan_payload, upstreams):
    """Changing a header on every request must not buy a fresh allowance."""
    client = APIClient(REMOTE_ADDR="198.51.100.9")
    for n in range(30):
        assert (
            client.post("/api/plan", plan_payload, format="json", HTTP_X_FORWARDED_FOR=f"10.0.0.{n}").status_code == 200
        )

    blocked = client.post("/api/plan", plan_payload, format="json", HTTP_X_FORWARDED_FOR="10.9.9.9")

    assert_error(blocked, 429, "throttled")


def test_forwarded_headers_count_when_a_trusted_proxy_sets_them(plan_payload, upstreams, settings):
    settings.TRUST_PROXY_HEADERS = True
    settings.TRUSTED_PROXY_COUNT = 1
    proxy = APIClient(REMOTE_ADDR="10.1.1.1")
    exhaust(proxy, "post", "/api/plan", 30, plan_payload, HTTP_X_FORWARDED_FOR="203.0.113.7")

    same_client = proxy.post("/api/plan", plan_payload, format="json", HTTP_X_FORWARDED_FOR="203.0.113.7")
    different_client = proxy.post("/api/plan", plan_payload, format="json", HTTP_X_FORWARDED_FOR="203.0.113.8")

    assert same_client.status_code == 429
    assert different_client.status_code == 200


def test_extra_left_hand_entries_cannot_dodge_the_limit_behind_a_trusted_proxy(plan_payload, upstreams, settings):
    settings.TRUST_PROXY_HEADERS = True
    settings.TRUSTED_PROXY_COUNT = 1
    proxy = APIClient(REMOTE_ADDR="10.1.1.1")
    for n in range(30):
        proxy.post("/api/plan", plan_payload, format="json", HTTP_X_FORWARDED_FOR=f"1.1.1.{n}, 203.0.113.7")

    blocked = proxy.post("/api/plan", plan_payload, format="json", HTTP_X_FORWARDED_FOR="9.9.9.9, 203.0.113.7")

    assert_error(blocked, 429, "throttled")


# When the counter store is unavailable -----------------------------------------------------


def test_a_broken_cache_table_lets_requests_through_and_says_so(api, plan_payload, upstreams, monkeypatch, caplog):
    from django.db import DatabaseError

    def broken(self, request, view):
        raise DatabaseError("no such table: django_cache")

    monkeypatch.setattr("rest_framework.throttling.ScopedRateThrottle.allow_request", broken)

    with caplog.at_level(logging.WARNING, logger="apps.common.throttling"):
        response = api.post("/api/plan", plan_payload, format="json")

    assert response.status_code == 200
    assert "Throttle cache unavailable" in caplog.text


def test_a_view_with_no_scope_is_never_counted(api, monkeypatch):
    seen = []
    original = ScopedIPThrottle.get_cache_key
    monkeypatch.setattr(ScopedIPThrottle, "get_cache_key", lambda self, r, v: seen.append(1) or original(self, r, v))
    api.get("/api/health")
    assert seen == []
