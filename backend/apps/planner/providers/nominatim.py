"""Nominatim reverse lookups, used when someone clicks the map to pick a place."""

from __future__ import annotations

import unicodedata
from typing import Any

from django.conf import settings

from apps.common.errors import UpstreamError

from . import http

SERVICE = "address lookup"
MAX_LABEL_CHARS = 200
#: A click should feel instant. If Nominatim is slow, the bundled town list answers instead.
TIMEOUT = (2.0, 3.0)

_LOCALITY_KEYS = (
    "city",
    "town",
    "village",
    "hamlet",
    "municipality",
    "suburb",
    "city_district",
    "county",
)


def reverse(lat: float, lon: float) -> str | None:
    """Return a label for the point, or None when Nominatim has nothing for it."""
    reply = http.get_json(
        f"{settings.NOMINATIM_BASE_URL}/reverse",
        service=SERVICE,
        params={
            "format": "jsonv2",
            "lat": f"{lat:.6f}",
            "lon": f"{lon:.6f}",
            "zoom": 14,
            "addressdetails": 1,
        },
        timeout=TIMEOUT,
        retries=0,
    )
    if reply.status != 200:
        raise UpstreamError("The address lookup turned the request down.")
    return parse_label(reply.data)


def _clean(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return "".join(c for c in value if unicodedata.category(c) not in {"Cc", "Cs"}).strip()


def parse_label(payload: Any) -> str | None:
    if not isinstance(payload, dict) or "error" in payload:
        return None
    address = payload.get("address")
    if isinstance(address, dict):
        locality = next((_clean(address.get(k)) for k in _LOCALITY_KEYS if address.get(k)), "")
        parts = [locality, _clean(address.get("state")), _clean(address.get("country"))]
        if locality:
            return ", ".join(part for part in parts if part)[:MAX_LABEL_CHARS]
    # Open country has no town. The first parts of display_name still say roughly where.
    display = _clean(payload.get("display_name"))
    if not display:
        return None
    return ", ".join(part.strip() for part in display.split(",")[:3])[:MAX_LABEL_CHARS]
