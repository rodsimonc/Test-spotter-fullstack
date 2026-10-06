from __future__ import annotations

from tests.support.contract import assert_error


def test_health_answers_ok_without_an_account(api):
    response = api.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_is_never_cached_and_makes_no_outbound_calls(api, rsps):
    response = api.get("/api/health")
    assert response["Cache-Control"] == "no-store"
    assert len(rsps.calls) == 0


def test_health_does_not_touch_the_database(api, django_assert_num_queries):
    with django_assert_num_queries(0):
        api.get("/api/health")


def test_health_is_get_only(api):
    assert_error(api.post("/api/health"), 405, "method_not_allowed")
