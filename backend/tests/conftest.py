"""Shared fixtures for the API, security, accounts and trips tests.

This file also loads under `-p no:django` (the engine tests), so it imports nothing from Django
at module level and only wires things up when pytest-django is active.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.support import engine_stub
from tests.support.osrm import DALLAS, DENVER, MEMPHIS


def _django_active(config: pytest.Config) -> bool:
    return config.pluginmanager.hasplugin("django")


#: Test folders that need a database. The engine and gazetteer tests run without Django.
_DJANGO_DIRS = {"api", "security", "accounts", "trips"}
_TESTS_DIR = Path(__file__).resolve().parent


def pytest_configure(config: pytest.Config) -> None:
    if _django_active(config):
        engine_stub.install()


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if not _django_active(config):
        return
    for item in items:
        folder = item.path.resolve().relative_to(_TESTS_DIR).parts[0]
        if folder in _DJANGO_DIRS:
            item.add_marker(pytest.mark.django_db)


@pytest.fixture
def rsps():
    """Every outbound HTTP call is mocked. A call with no registered response fails like a dead network."""
    import responses

    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        yield mock


@pytest.fixture(autouse=True)
def _api_test_defaults(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    """A closed network and instant retries for every Django-backed test."""
    if not _django_active(request.config):
        return
    request.getfixturevalue("rsps")
    from apps.planner.providers import http

    monkeypatch.setattr(http, "RETRY_DELAY_SECONDS", 0)


@pytest.fixture
def real_engine():
    if not engine_stub.using_real_engine():
        pytest.skip("The real HOS engine isn't in use (PLANNER_TEST_ENGINE).")


@pytest.fixture
def api():
    from rest_framework.test import APIClient

    return APIClient()


class CsrfClient:
    """A client that enforces CSRF like a browser. Call `refresh()` after anything that rotates it."""

    def __init__(self) -> None:
        from rest_framework.test import APIClient

        self.client = APIClient(enforce_csrf_checks=True)

    def __getattr__(self, name):
        return getattr(self.client, name)

    def refresh(self) -> str:
        token = self.client.get("/api/auth/csrf").json()["csrf"]
        self.client.credentials(HTTP_X_CSRFTOKEN=token)
        return token

    def forget_token(self) -> None:
        self.client.credentials()


@pytest.fixture
def browser():
    """A CSRF-enforcing client that has already fetched its token."""
    client = CsrfClient()
    client.refresh()
    return client


@pytest.fixture
def signed_in_browser(user):
    """A CSRF-enforcing client signed in as `user` and holding a valid token."""
    client = CsrfClient()
    client.client.force_login(user)
    client.refresh()
    return client


@pytest.fixture
def make_user(db):
    from apps.accounts.models import User

    counter = {"n": 0}

    def make(email: str | None = None, password: str = "Zx9-battery-staple-42", name: str = "") -> User:
        counter["n"] += 1
        return User.objects.create_user(email or f"driver{counter['n']}@example.com", password, name=name)

    return make


@pytest.fixture
def user(make_user):
    return make_user("driver@example.com", name="Dana Driver")


@pytest.fixture
def auth_api(user):
    """An API client signed in as `user`, with CSRF checks off."""
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_login(user)
    return client


@pytest.fixture
def throttle_table(db):
    """Empty counters for a rate-limit test.

    Django's test runner already runs `createcachetable`, as deployment does. Calling it again is
    harmless and keeps the dependency visible. Each test's transaction rolls the counters back.
    """
    from django.core.cache import cache
    from django.core.management import call_command

    call_command("createcachetable", verbosity=0)
    cache.clear()
    return cache


PROD_HOST = "trips.example.com"


@pytest.fixture
def prod_security(settings):
    """Put the production security settings, read from a clean environment, on the live settings.

    Request through `prod_client` (or pass `secure=True` and `HTTP_HOST=PROD_HOST`) so the
    HTTPS redirect and secure cookies behave as they would on the deployed site.
    """
    from tests.support.prod_settings import load_settings, security_values

    values = security_values(load_settings())
    for name, value in values.items():
        setattr(settings, name, value)
    return values


@pytest.fixture
def prod_client(prod_security):
    """A CSRF-enforcing client that talks HTTPS to the production host name."""
    from rest_framework.test import APIClient

    class HttpsClient(APIClient):
        # Django's test client marks a request secure per call, so every call is forced to HTTPS.
        def generic(self, method, path, data="", content_type="application/octet-stream", secure=False, **extra):
            return super().generic(method, path, data, content_type, True, **extra)

    # Browsers send Origin on every POST. Django also accepts a Referer, but over HTTPS needs one.
    return HttpsClient(enforce_csrf_checks=True, HTTP_HOST=PROD_HOST, HTTP_ORIGIN=f"https://{PROD_HOST}")


@pytest.fixture
def plan_payload() -> dict:
    return {
        "current": {"label": "Dallas, Texas, United States", "lat": DALLAS[0], "lon": DALLAS[1]},
        "pickup": {"label": "Memphis, Tennessee, United States", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
        "dropoff": {"label": "Denver, Colorado, United States", "lat": DENVER[0], "lon": DENVER[1]},
        "cycle_used_hours": 24,
        "departure": "2026-10-07T06:00",
        "timezone": "America/Chicago",
        "header": {"driver_name": "Dana Driver", "truck_number": "101"},
    }
