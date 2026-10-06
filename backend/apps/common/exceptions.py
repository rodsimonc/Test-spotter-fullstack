"""One error shape for every failure: `{"error": {"code", "message", "fields"?}}`.

Messages are written for the person using the app. Stack traces and exception text never go
into a response.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Mapping
from typing import Any

from django.conf import settings
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import RequestDataTooBig, SuspiciousOperation
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response

from .errors import ApiError, PayloadTooLarge

logger = logging.getLogger(__name__)

NON_FIELD_KEY = "non_field_errors"


def error_body(code: str, message: str, fields: dict[str, list[str]] | None = None) -> dict:
    body: dict[str, Any] = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    return {"error": body}


def flatten_errors(detail: Any, prefix: str = "") -> dict[str, list[str]]:
    """Turn DRF's nested error details into `{"dotted.path": ["message", ...]}`."""
    found: dict[str, list[str]] = {}

    def walk(node: Any, path: str) -> None:
        if isinstance(node, Mapping):
            for key, value in node.items():
                walk(value, f"{path}.{key}" if path else str(key))
        elif isinstance(node, list | tuple):
            for index, item in enumerate(node):
                if isinstance(item, Mapping | list | tuple):
                    walk(item, f"{path}.{index}" if path else str(index))
                else:
                    found.setdefault(path or NON_FIELD_KEY, []).append(str(item))
        else:
            found.setdefault(path or NON_FIELD_KEY, []).append(str(node))

    walk(detail, prefix)
    return found


def _response(
    status_code: int,
    code: str,
    message: str,
    fields: dict[str, list[str]] | None = None,
    headers: dict[str, str] | None = None,
) -> Response:
    return Response(error_body(code, message, fields), status=status_code, headers=headers)


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response:
    if isinstance(exc, ApiError):
        return _response(exc.status_code, exc.code, str(exc.detail))

    if isinstance(exc, exceptions.ValidationError):
        return _response(
            status.HTTP_400_BAD_REQUEST,
            "validation_error",
            "Check the highlighted fields.",
            flatten_errors(exc.detail),
        )

    if isinstance(exc, exceptions.ParseError):
        return _response(status.HTTP_400_BAD_REQUEST, "validation_error", "The request body isn't valid JSON.")

    # DRF rewrites NotAuthenticated to 403 when the authenticator has no challenge header.
    # Session auth has none, so check the class rather than the status.
    if isinstance(exc, exceptions.NotAuthenticated | exceptions.AuthenticationFailed):
        return _response(status.HTTP_401_UNAUTHORIZED, "not_authenticated", "Sign in to continue.")

    if isinstance(exc, exceptions.PermissionDenied | DjangoPermissionDenied):
        return _response(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Your session check failed. Reload the page and try again.",
        )

    if isinstance(exc, Http404 | exceptions.NotFound):
        return _response(status.HTTP_404_NOT_FOUND, "not_found", "That doesn't exist.")

    if isinstance(exc, exceptions.MethodNotAllowed):
        return _response(
            status.HTTP_405_METHOD_NOT_ALLOWED,
            "method_not_allowed",
            "That method isn't supported here.",
        )

    if isinstance(exc, exceptions.UnsupportedMediaType):
        return _response(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "Send the request body as JSON.",
        )

    if isinstance(exc, exceptions.NotAcceptable):
        return _response(status.HTTP_406_NOT_ACCEPTABLE, "not_acceptable", "This API only returns JSON.")

    if isinstance(exc, exceptions.Throttled):
        wait = max(1, math.ceil(exc.wait)) if exc.wait is not None else 60
        return _response(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "throttled",
            f"Too many requests. Try again in {wait} seconds.",
            headers={"Retry-After": str(wait)},
        )

    if isinstance(exc, RequestDataTooBig):
        too_big = PayloadTooLarge.for_limit(settings.DATA_UPLOAD_MAX_MEMORY_SIZE)
        return _response(too_big.status_code, too_big.code, str(too_big.detail))

    if isinstance(exc, SuspiciousOperation):
        return _response(status.HTTP_400_BAD_REQUEST, "validation_error", "Bad request.")

    if isinstance(exc, exceptions.APIException):
        return _response(exc.status_code, "validation_error", "The request couldn't be processed.")

    view = context.get("view")
    logger.exception("Unhandled error in %s", type(view).__name__ if view else "unknown view")
    return _response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "server_error",
        "Something went wrong on our side. Try again in a moment.",
    )
