"""Response headers, with test settings and with the production security settings."""

from __future__ import annotations

import pytest

from tests.conftest import PROD_HOST
from tests.support.osrm import CHICAGO, PHOTON_SEARCH, photon_payload, register_osrm

PUBLIC_GETS = [
    "/api/health",
    "/api/auth/csrf",
    "/api/auth/me",
    "/api/geocode/search?q=chi",
    "/api/geocode/reverse?lat=41.9&lon=-87.6",
    "/api/trips",  # a 401 for a signed-out visitor
    "/api/nope",  # a 404
    "/api/geocode/search?q=x",  # a 400
]


@pytest.fixture(autouse=True)
def upstreams(rsps):
    rsps.add("GET", PHOTON_SEARCH, json=photon_payload(CHICAGO))
    rsps.add("GET", "https://nominatim.test/reverse", json={"error": "Unable to geocode"})
    register_osrm(rsps)


@pytest.mark.parametrize("path", PUBLIC_GETS)
def test_every_api_answer_carries_the_basic_hardening_headers(api, path):
    response = api.get(path)

    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["X-Frame-Options"] == "DENY"
    assert response["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert response["Cache-Control"] == "no-store"
    assert response["Content-Type"].startswith("application/json")


def test_post_answers_carry_them_too(api, plan_payload):
    response = api.post("/api/plan", plan_payload, format="json")
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["X-Frame-Options"] == "DENY"
    assert response["Cache-Control"] == "no-store"


@pytest.mark.parametrize("path", ["/api/health", "/api/nope", "/api/trips"])
def test_the_server_does_not_announce_its_software(api, path):
    response = api.get(path)
    for name in ("Server", "X-Powered-By", "X-Django-Version", "X-AspNet-Version"):
        assert name not in response.headers


def test_cross_origin_requests_get_no_cors_permission(api):
    """Same-origin deployment: nothing should ever grant a foreign page access."""
    response = api.get("/api/health", HTTP_ORIGIN="https://evil.example")
    assert not any(name.lower().startswith("access-control-") for name in response.headers)


def test_a_preflight_request_is_not_answered_with_permission(api):
    response = api.options(
        "/api/plan",
        HTTP_ORIGIN="https://evil.example",
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type",
    )
    assert "Access-Control-Allow-Origin" not in response.headers


def test_api_answers_are_not_html(api):
    for path in PUBLIC_GETS:
        assert "text/html" not in api.get(path)["Content-Type"], path


# Production settings --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/health", "/api/auth/me", "/api/nope"])
def test_https_answers_carry_a_year_of_hsts(prod_client, path):
    response = prod_client.get(path)
    assert response["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains; preload"


def test_production_keeps_the_basic_hardening_headers(prod_client):
    response = prod_client.get("/api/health")
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["X-Frame-Options"] == "DENY"
    assert response["Referrer-Policy"] == "strict-origin-when-cross-origin"


def test_plain_http_is_sent_to_https_in_production(prod_security, api):
    response = api.get("/api/health", HTTP_HOST=PROD_HOST)
    assert response.status_code == 301
    assert response["Location"] == f"https://{PROD_HOST}/api/health"


def test_the_redirect_keeps_the_query_string(prod_security, api):
    response = api.get("/api/geocode/search?q=chicago&limit=3", HTTP_HOST=PROD_HOST)
    assert response["Location"] == f"https://{PROD_HOST}/api/geocode/search?q=chicago&limit=3"


def test_an_unknown_host_is_refused_in_production(prod_client):
    response = prod_client.get("/api/health", HTTP_HOST="evil.example")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"
    assert "evil.example" not in response.content.decode()


def test_hsts_is_not_sent_over_plain_http_in_development(api):
    assert "Strict-Transport-Security" not in api.get("/api/health").headers
