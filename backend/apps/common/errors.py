"""Errors the API raises on purpose. Each one maps to a status and a `code` in the error body."""

from __future__ import annotations

from rest_framework import status
from rest_framework.exceptions import APIException


class ApiError(APIException):
    """Base class. Subclasses set the status, the machine-readable code and a default message."""

    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    code = "server_error"
    default_detail = "Something went wrong on our side. Try again in a moment."

    def __init__(self, message: str | None = None):
        super().__init__(detail=message or self.default_detail, code=self.code)


class UpstreamError(ApiError):
    """OSRM, Photon or Nominatim failed, timed out or sent something unreadable."""

    status_code = status.HTTP_502_BAD_GATEWAY
    code = "upstream_error"
    default_detail = "A map service didn't answer properly. Try again in a moment."


class NoRouteError(ApiError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "no_route"
    default_detail = "No driving route connects those places."


class RouteTooLongError(ApiError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "route_too_long"
    default_detail = "That route is longer than the planner supports."


class PlanFailed(ApiError):
    """The engine refused a trip that passed validation. A bug or an odd route, never bad input."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "plan_failed"
    default_detail = "The planner couldn't build a schedule for that trip."


class PayloadTooLarge(ApiError):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    code = "payload_too_large"
    default_detail = "The request body is too large."

    @classmethod
    def for_limit(cls, limit_bytes: int) -> PayloadTooLarge:
        return cls(f"The request body can be at most {limit_bytes // 1024} KB.")


class InvalidCredentials(ApiError):
    """Wrong email or wrong password. One message for both so the API never reveals which."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = "invalid_credentials"
    default_detail = "Email or password is incorrect."


class TripLimitReached(ApiError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "trip_limit_reached"
    default_detail = "You've reached the limit of saved trips. Delete one to save another."


class TripTooLarge(ApiError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "trip_too_large"
    default_detail = "This trip is too large to save."
