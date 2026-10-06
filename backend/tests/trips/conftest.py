from __future__ import annotations

import pytest

from tests.support.osrm import register_osrm


@pytest.fixture
def osrm(rsps):
    """Every route lookup in these tests gets the same realistic Dallas, Memphis, Denver answer."""
    return register_osrm(rsps)


@pytest.fixture
def create_trip(osrm, plan_payload):
    """Save a trip through the API as the given client. Extra keyword arguments go in the body."""

    def create(client, **body):
        response = client.post("/api/trips", {"request": plan_payload} | body, format="json")
        assert response.status_code == 201, response.content[:400]
        return response.json()

    return create


@pytest.fixture
def other_api(make_user):
    """A second signed-in user, for ownership tests."""
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_login(make_user("other.driver@example.com", name="Otto Other"))
    return client
