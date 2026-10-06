"""Base view and the plain-Django error views, all answering in the API's error shape."""

from __future__ import annotations

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.http import HttpRequest, JsonResponse
from rest_framework.views import APIView

from .errors import PayloadTooLarge
from .exceptions import error_body


class ApiView(APIView):
    """Base for every endpoint. Responses are private and never cached by anything in between."""

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        return response


def _json_error(status: int, code: str, message: str) -> JsonResponse:
    response = JsonResponse(error_body(code, message), status=status)
    response.headers["Cache-Control"] = "no-store"
    return response


def bad_request(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    # Django raises this from its CSRF check on login and register before DRF reads the body.
    if isinstance(exception, RequestDataTooBig):
        too_big = PayloadTooLarge.for_limit(settings.DATA_UPLOAD_MAX_MEMORY_SIZE)
        return _json_error(too_big.status_code, too_big.code, str(too_big.detail))
    return _json_error(400, "validation_error", "Bad request.")


def forbidden(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return _json_error(403, "forbidden", "That isn't allowed.")


def not_found(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return _json_error(404, "not_found", "That doesn't exist.")


def server_error(request: HttpRequest) -> JsonResponse:
    return _json_error(500, "server_error", "Something went wrong on our side. Try again.")


def csrf_failure(request: HttpRequest, reason: str = "") -> JsonResponse:
    # `reason` names the exact check that failed. The client can't use it, so it is dropped.
    return _json_error(403, "forbidden", "Your session check failed. Reload the page and try again.")
