"""The shared error body, tested branch by branch on the handler itself."""

from __future__ import annotations

import pytest
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import SuspiciousOperation
from django.http import Http404
from rest_framework import exceptions

from apps.common import errors
from apps.common.exceptions import api_exception_handler, error_body, flatten_errors


def handle(exc: Exception):
    response = api_exception_handler(exc, {"view": None})
    return response.status_code, response.data["error"], response


def test_error_body_leaves_out_empty_fields():
    assert error_body("x", "y") == {"error": {"code": "x", "message": "y"}}
    assert error_body("x", "y", {}) == {"error": {"code": "x", "message": "y"}}
    assert error_body("x", "y", {"a": ["b"]})["error"]["fields"] == {"a": ["b"]}


# flatten_errors -----------------------------------------------------------------------------


def test_flatten_errors_joins_nested_paths_with_dots():
    detail = {"request": {"current": ["Choose a current location."], "header": {"driver_name": ["Too long."]}}}
    assert flatten_errors(detail) == {
        "request.current": ["Choose a current location."],
        "request.header.driver_name": ["Too long."],
    }


def test_flatten_errors_numbers_list_items():
    assert flatten_errors({"rows": [{}, {"a": ["bad"]}]}) == {"rows.1.a": ["bad"]}


def test_flatten_errors_files_top_level_messages_under_non_field_errors():
    assert flatten_errors(["One thing is wrong."]) == {"non_field_errors": ["One thing is wrong."]}
    assert flatten_errors("Just a string.") == {"non_field_errors": ["Just a string."]}


def test_flatten_errors_keeps_several_messages_for_one_field():
    assert flatten_errors({"password": ["Too short.", "Too common."]}) == {"password": ["Too short.", "Too common."]}


def test_flatten_errors_handles_mixed_lists():
    assert flatten_errors({"a": ["text", {"b": ["deep"]}]}) == {"a": ["text"], "a.1.b": ["deep"]}


# The handler --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("exc", "status", "code"),
    [
        (errors.UpstreamError(), 502, "upstream_error"),
        (errors.NoRouteError(), 422, "no_route"),
        (errors.RouteTooLongError(), 422, "route_too_long"),
        (errors.PlanFailed(), 422, "plan_failed"),
        (errors.PayloadTooLarge(), 413, "payload_too_large"),
        (errors.InvalidCredentials(), 400, "invalid_credentials"),
        (errors.TripLimitReached(), 422, "trip_limit_reached"),
        (errors.TripTooLarge(), 422, "trip_too_large"),
        (errors.ApiError(), 500, "server_error"),
    ],
)
def test_every_api_error_keeps_its_status_and_code(exc, status, code):
    got_status, error, _response = handle(exc)
    assert (got_status, error["code"]) == (status, code)
    assert error["message"]


def test_a_custom_message_replaces_the_default():
    _status, error, _ = handle(errors.UpstreamError("The routing service is busy."))
    assert error["message"] == "The routing service is busy."


def test_validation_errors_list_their_fields():
    status, error, _ = handle(exceptions.ValidationError({"email": ["Enter your email."]}))
    assert status == 400 and error["code"] == "validation_error"
    assert error["fields"] == {"email": ["Enter your email."]}


def test_a_validation_error_with_no_field_has_no_fields_key_when_empty():
    status, error, _ = handle(exceptions.ValidationError({}))
    assert status == 400 and "fields" not in error


def test_parse_errors_are_a_400_without_leaking_the_parser_message():
    status, error, _ = handle(exceptions.ParseError("JSON parse error - Expecting value: line 1 column 1 (char 0)"))
    assert status == 400 and error["message"] == "The request body isn't valid JSON."
    assert "Expecting" not in str(error)


@pytest.mark.parametrize("exc", [exceptions.NotAuthenticated(), exceptions.AuthenticationFailed("Bad token.")])
def test_authentication_problems_are_401(exc):
    status, error, _ = handle(exc)
    assert (status, error["code"]) == (401, "not_authenticated")


@pytest.mark.parametrize(
    "exc", [exceptions.PermissionDenied("nope"), DjangoPermissionDenied("CSRF Failed: Origin checking failed")]
)
def test_permission_problems_are_403_with_a_generic_message(exc):
    status, error, _ = handle(exc)
    assert (status, error["code"]) == (403, "forbidden")
    assert "CSRF" not in error["message"] and "Origin" not in error["message"]


@pytest.mark.parametrize("exc", [Http404("No Trip matches the given query."), exceptions.NotFound("Not found.")])
def test_missing_things_are_404_with_a_generic_message(exc):
    status, error, _ = handle(exc)
    assert (status, error["code"]) == (404, "not_found")
    assert "Trip" not in error["message"]


def test_wrong_method_is_405():
    status, error, _ = handle(exceptions.MethodNotAllowed("PUT"))
    assert (status, error["code"]) == (405, "method_not_allowed")


def test_wrong_content_type_is_415():
    status, error, _ = handle(exceptions.UnsupportedMediaType("text/plain"))
    assert (status, error["code"]) == (415, "unsupported_media_type")


def test_an_unacceptable_accept_header_is_406():
    status, error, _ = handle(exceptions.NotAcceptable())
    assert (status, error["code"]) == (406, "not_acceptable")


def test_throttled_sets_retry_after_rounded_up():
    status, error, response = handle(exceptions.Throttled(wait=12.2))
    assert (status, error["code"]) == (429, "throttled")
    assert response["Retry-After"] == "13"
    assert "13 seconds" in error["message"]


def test_throttled_without_a_wait_time_says_a_minute():
    _status, error, response = handle(exceptions.Throttled())
    assert response["Retry-After"] == "60"
    assert "60 seconds" in error["message"]


def test_suspicious_requests_are_a_plain_400():
    status, error, _ = handle(SuspiciousOperation("Invalid HTTP_HOST header: 'evil.example'."))
    assert (status, error["code"]) == (400, "validation_error")
    assert "evil.example" not in error["message"]


def test_other_api_exceptions_get_their_own_status_and_a_generic_message():
    class Teapot(exceptions.APIException):
        status_code = 418
        default_detail = "internal detail that should not be shown"

    status, error, _ = handle(Teapot())
    assert status == 418 and error["code"] == "validation_error"
    assert "internal detail" not in error["message"]


def test_an_unexpected_exception_is_a_500_with_no_details(caplog):
    status, error, _ = handle(RuntimeError("connection string postgres://user:hunter2@db/prod"))

    assert (status, error["code"]) == (500, "server_error")
    assert "hunter2" not in str(error) and "postgres" not in str(error)
    assert "Unhandled error" in caplog.text


def test_the_500_is_logged_with_the_view_name(caplog):
    class ExampleView:
        pass

    api_exception_handler(RuntimeError("boom"), {"view": ExampleView()})
    assert "ExampleView" in caplog.text
