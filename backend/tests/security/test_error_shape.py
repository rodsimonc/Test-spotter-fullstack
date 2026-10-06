"""Every failure, over HTTP, answers with the same JSON body from `docs/api-contract.md`."""

from __future__ import annotations

import json

import pytest
from django.test import Client
from rest_framework.test import APIClient

from apps.planner import services
from tests.support import ts_contract
from tests.support.contract import assert_error
from tests.support.osrm import OSRM_ROUTE, register_osrm

PASSWORD = "Zx9-battery-staple-42"
SECRET_BITS = ("hunter2", "postgres://", "RuntimeError", "Traceback", "site-packages", ".py", 'File "')


@pytest.fixture(autouse=True)
def osrm(rsps):
    return register_osrm(rsps)


def check(response, status: int, code: str, *, fields: bool | None = None) -> dict:
    error = assert_error(response, status, code, fields=fields)
    ts_contract.load().assert_matches(response.json(), "ApiErrorBody")
    assert response["Content-Type"].startswith("application/json")
    assert response["Cache-Control"] == "no-store"
    text = response.content.decode()
    for bit in SECRET_BITS:
        assert bit not in text, f"{bit!r} leaked into the error body"
    return error


def test_400_validation_error_lists_fields(api):
    error = check(api.post("/api/plan", {}, format="json"), 400, "validation_error", fields=True)
    assert error["message"] == "Check the highlighted fields."
    assert all(isinstance(v, list) and all(isinstance(m, str) for m in v) for v in error["fields"].values())


def test_400_malformed_json_has_no_fields(api):
    response = api.generic("POST", "/api/plan", b"{not json", content_type="application/json")
    error = check(response, 400, "validation_error", fields=False)
    assert error["message"] == "The request body isn't valid JSON."


def test_400_bad_host_header(api):
    check(api.get("/api/health", HTTP_HOST="evil.example"), 400, "validation_error", fields=False)


def test_401_signed_out(api):
    error = check(api.get("/api/trips"), 401, "not_authenticated", fields=False)
    assert error["message"] == "Sign in to continue."


def test_403_csrf_failure():
    client = APIClient(enforce_csrf_checks=True)
    error = check(client.post("/api/auth/login", {}, format="json"), 403, "forbidden", fields=False)
    assert "CSRF" not in error["message"]


def test_403_csrf_failure_when_signed_in(user):
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    check(client.post("/api/auth/logout"), 403, "forbidden", fields=False)


@pytest.mark.parametrize(
    "path",
    ["/api/nope", "/api/", "/nope", "/api/trips/", "/api/plan/", "/api/health/", "/", "/admin/", "/api/trips/xyz"],
)
def test_404_unknown_urls_are_json_too(api, path):
    check(api.get(path), 404, "not_found", fields=False)


def test_404_unknown_trip(auth_api):
    check(auth_api.get("/api/trips/00000000-0000-4000-8000-000000000000"), 404, "not_found", fields=False)


def test_404_for_a_post_to_an_unknown_url_does_not_ask_for_csrf(api):
    check(api.post("/api/nope", {}, format="json"), 404, "not_found", fields=False)


def test_405_wrong_method(api):
    check(api.delete("/api/plan"), 405, "method_not_allowed", fields=False)


def test_406_html_only_accept_header(api):
    check(api.get("/api/health", HTTP_ACCEPT="text/html"), 406, "not_acceptable", fields=False)


def test_413_body_too_large(api):
    body = json.dumps({"padding": "x" * (64 * 1024 + 1)})
    check(
        api.generic("POST", "/api/plan", body, content_type="application/json"), 413, "payload_too_large", fields=False
    )


def test_415_wrong_content_type(api):
    check(
        api.generic("POST", "/api/plan", "a=b", content_type="text/plain"), 415, "unsupported_media_type", fields=False
    )


def test_422_no_route(api, plan_payload, rsps):
    rsps.replace("GET", OSRM_ROUTE, json={"code": "NoRoute"})
    check(api.post("/api/plan", plan_payload, format="json"), 422, "no_route", fields=False)


def test_422_route_too_long(api, plan_payload, settings):
    settings.MAX_ROUTE_MILES = 10
    check(api.post("/api/plan", plan_payload, format="json"), 422, "route_too_long", fields=False)


def test_422_plan_failed(api, plan_payload, monkeypatch):
    from apps.planner.hos.models import EngineError

    def refuse(req, route):
        raise EngineError("internal reason with hunter2")

    monkeypatch.setattr(services, "build_plan", refuse)
    error = check(api.post("/api/plan", plan_payload, format="json"), 422, "plan_failed", fields=False)
    assert "hunter2" not in error["message"]


@pytest.mark.usefixtures("throttle_table")
def test_429_throttled(api, make_user):
    make_user("dana@example.com", PASSWORD)
    bad = {"email": "dana@example.com", "password": "wrong-password-1"}
    for _ in range(10):
        api.post("/api/auth/login", bad, format="json")
    response = api.post("/api/auth/login", bad, format="json")
    error = check(response, 429, "throttled", fields=False)
    assert int(response["Retry-After"]) >= 1
    assert "Try again in" in error["message"]


@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_502_when_a_map_service_fails(api, plan_payload, rsps, status):
    rsps.replace("GET", OSRM_ROUTE, status=status, body="<html>Bad gateway at upstream-host-17</html>")
    error = check(api.post("/api/plan", plan_payload, format="json"), 502, "upstream_error", fields=False)
    assert "upstream-host" not in error["message"]


def test_502_when_a_map_service_sends_garbage(api, plan_payload, rsps):
    rsps.replace("GET", OSRM_ROUTE, body="not json at all", status=200)
    check(api.post("/api/plan", plan_payload, format="json"), 502, "upstream_error", fields=False)


def test_502_when_the_connection_dies(api, plan_payload, rsps):
    import requests

    rsps.replace(
        "GET", OSRM_ROUTE, body=requests.ConnectionError("Max retries exceeded with url: /route/v1 (host 10.0.0.5)")
    )
    error = check(api.post("/api/plan", plan_payload, format="json"), 502, "upstream_error", fields=False)
    assert "10.0.0.5" not in error["message"]


def test_500_inside_a_view_hides_the_cause(api, plan_payload, monkeypatch, caplog):
    def explode(request):
        raise RuntimeError("connection string postgres://user:hunter2@db.internal/prod")

    monkeypatch.setattr(services, "plan_trip", explode)

    response = api.post("/api/plan", plan_payload, format="json")

    error = check(response, 500, "server_error", fields=False)
    assert error["message"] == "Something went wrong on our side. Try again in a moment."
    assert "hunter2" in caplog.text, "the cause belongs in the server log, not in the response"


def test_500_outside_the_api_views_is_json_too(settings):
    settings.ROOT_URLCONF = "tests.security.urls_boom"
    client = Client(raise_request_exception=False)
    response = client.get("/boom")
    check(response, 500, "server_error", fields=False)
