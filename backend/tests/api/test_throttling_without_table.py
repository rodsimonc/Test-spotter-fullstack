"""If the cache table is missing, the API still answers. A broken limiter must not take it down."""

from __future__ import annotations

import logging

import pytest
from django.db import connection

from tests.support.osrm import register_osrm


@pytest.fixture(autouse=True)
def no_cache_table(db):
    """Django's test runner creates the table. Drop it, inside the test's own transaction."""
    with connection.cursor() as cursor:
        cursor.execute("DROP TABLE django_cache")


def test_the_table_is_really_gone():
    assert "django_cache" not in connection.introspection.table_names()


def test_planning_works_without_the_cache_table(api, plan_payload, rsps, caplog):
    register_osrm(rsps)

    with caplog.at_level(logging.WARNING, logger="apps.common.throttling"):
        response = api.post("/api/plan", plan_payload, format="json")

    assert response.status_code == 200
    assert "Throttle cache unavailable" in caplog.text


def test_login_works_without_the_cache_table(api, make_user):
    make_user("dana@example.com", "Zx9-battery-staple-42")
    response = api.post(
        "/api/auth/login", {"email": "dana@example.com", "password": "Zx9-battery-staple-42"}, format="json"
    )
    assert response.status_code == 200
