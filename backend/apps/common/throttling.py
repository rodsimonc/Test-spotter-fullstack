"""Per-IP rate limits, one named scope per endpoint family."""

from __future__ import annotations

import logging

from django.db import DatabaseError
from rest_framework.throttling import ScopedRateThrottle

from .client_ip import client_ip

logger = logging.getLogger(__name__)


class ScopedIPThrottle(ScopedRateThrottle):
    """Counts requests per client address for the scope named on the view.

    The counters live in the database cache so every serverless instance sees the same numbers.
    If that table is missing or the database hiccups, the request goes through. A broken limiter
    should not take the whole API down with it.
    """

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": client_ip(request)}

    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except DatabaseError:
            logger.warning("Throttle cache unavailable, letting the request through.")
            return True
