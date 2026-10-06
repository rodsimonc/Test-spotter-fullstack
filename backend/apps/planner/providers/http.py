"""The one place outbound HTTP happens.

Every call goes to a base URL taken from settings. User text only ever travels as a query
parameter, never as part of a path or a host, and redirects are not followed, so a request can't
be steered somewhere else.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Mapping
from contextlib import closing
from dataclasses import dataclass
from typing import Any

import requests
from django.conf import settings

from apps.common.errors import UpstreamError

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT_SECONDS = 3.0
READ_TIMEOUT_SECONDS = 8.0
RETRY_DELAY_SECONDS = 0.25

OSRM_MAX_BYTES = 5 * 1024 * 1024
SMALL_MAX_BYTES = 256 * 1024

_CHUNK_BYTES = 64 * 1024
_session = requests.Session()

QueryValue = str | int | float


@dataclass(frozen=True)
class JsonReply:
    status: int
    data: Any


def _reject_constant(name: str) -> None:
    raise ValueError(f"unexpected JSON constant {name}")


def _read_body(response: requests.Response, max_bytes: int, service: str) -> bytes:
    declared = response.headers.get("Content-Length", "")
    if declared.isdigit() and int(declared) > max_bytes:
        raise UpstreamError(f"The {service} sent more data than we accept.")
    body = bytearray()
    # Counting decompressed bytes keeps a small gzip bomb from slipping past the cap.
    for chunk in response.iter_content(chunk_size=_CHUNK_BYTES):
        body.extend(chunk)
        if len(body) > max_bytes:
            raise UpstreamError(f"The {service} sent more data than we accept.")
    return bytes(body)


def get_json(
    url: str,
    *,
    service: str,
    params: Mapping[str, QueryValue] | None = None,
    max_bytes: int = SMALL_MAX_BYTES,
    timeout: tuple[float, float] = (CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
    retries: int = 1,
) -> JsonReply:
    """GET a JSON document.

    Retries `retries` times on connection failures and 5xx answers, but not on read timeouts,
    since a server that is slow once is rarely faster the second time. Anything else that goes
    wrong raises `UpstreamError`. 4xx answers are returned so the caller can read the error body.
    """
    headers = {"User-Agent": settings.HTTP_USER_AGENT, "Accept": "application/json"}
    last_problem = f"The {service} didn't answer."

    for attempt in range(retries + 1):
        if attempt:
            time.sleep(RETRY_DELAY_SECONDS)
        try:
            with closing(
                _session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=timeout,
                    stream=True,
                    allow_redirects=False,
                )
            ) as response:
                if response.status_code >= 500:
                    last_problem = f"The {service} had a problem on its side."
                    logger.warning("%s answered HTTP %s", service, response.status_code)
                    continue
                if 300 <= response.status_code < 400:
                    raise UpstreamError(f"The {service} sent us somewhere else.")
                body = _read_body(response, max_bytes, service)
                status = response.status_code
        except requests.ConnectionError as exc:
            last_problem = f"Couldn't reach the {service}."
            logger.warning("%s connection failed: %s", service, type(exc).__name__)
            continue
        except requests.Timeout as exc:
            logger.warning("%s timed out: %s", service, type(exc).__name__)
            raise UpstreamError(f"The {service} took too long to answer.") from exc
        except requests.RequestException as exc:
            logger.warning("%s request failed: %s", service, type(exc).__name__)
            raise UpstreamError(f"Couldn't talk to the {service}.") from exc

        try:
            data = json.loads(body, parse_constant=_reject_constant)
        except (ValueError, RecursionError) as exc:
            raise UpstreamError(f"The {service} sent an answer we couldn't read.") from exc
        return JsonReply(status=status, data=data)

    raise UpstreamError(last_problem)
