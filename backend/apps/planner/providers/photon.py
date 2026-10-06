"""Photon (Komoot's OpenStreetMap search) for the place typeahead."""

from __future__ import annotations

import math
import unicodedata
from typing import Any

from django.conf import settings

from apps.common.errors import UpstreamError

from . import http

SERVICE = "place search"
MAX_LABEL_CHARS = 200


def search(query: str, limit: int, lat: float | None = None, lon: float | None = None) -> list[dict[str, Any]]:
    params: dict[str, http.QueryValue] = {"q": query, "limit": limit, "lang": "en"}
    if lat is not None and lon is not None:
        params["lat"] = f"{lat:.5f}"
        params["lon"] = f"{lon:.5f}"
    reply = http.get_json(f"{settings.PHOTON_BASE_URL}/api/", service=SERVICE, params=params)
    if reply.status == 429:
        raise UpstreamError("The place search is busy. Try again in a moment.")
    if reply.status != 200:
        raise UpstreamError("The place search turned the request down.")
    return parse_results(reply.data, limit)


def parse_results(payload: Any, limit: int) -> list[dict[str, Any]]:
    """Read Photon's GeoJSON into `GeocodeResult` dicts. Entries that don't parse are skipped."""
    features = payload.get("features") if isinstance(payload, dict) else None
    if not isinstance(features, list):
        raise UpstreamError("The place search sent an answer we couldn't read.")

    results: list[dict[str, Any]] = []
    seen: set[tuple[str, float, float]] = set()
    for feature in features:
        result = _read_feature(feature)
        if result is None:
            continue
        marker = (result["label"], round(result["lat"], 3), round(result["lon"], 3))
        if marker in seen:
            continue
        seen.add(marker)
        results.append(result)
        if len(results) >= limit:
            break
    return results


def _text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return "".join(c for c in value if unicodedata.category(c) not in {"Cc", "Cs"}).strip()


def _read_feature(feature: Any) -> dict[str, Any] | None:
    if not isinstance(feature, dict):
        return None
    geometry, props = feature.get("geometry"), feature.get("properties")
    coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
    if not isinstance(props, dict) or not isinstance(coords, list | tuple) or len(coords) < 2:
        return None
    lon, lat = coords[0], coords[1]
    if not all(isinstance(v, int | float) and not isinstance(v, bool) for v in (lon, lat)):
        return None
    if not (math.isfinite(lat) and math.isfinite(lon)) or abs(lat) > 90 or abs(lon) > 180:
        return None

    name = _text(props.get("name"))
    street = _text(props.get("street"))
    street_line = f"{_text(props.get('housenumber'))} {street}".strip() if street else ""
    city = _text(props.get("city"))
    primary = name or street_line or city
    if not primary:
        return None

    # A feature that is itself a state or a country must not repeat its own name. A city
    # inside a state of the same name (New York, Washington) keeps both.
    kind = props.get("type")
    context: list[str] = []
    for part, part_kind in (
        (city, "city"),
        (_text(props.get("state")), "state"),
        (_text(props.get("country")), "country"),
    ):
        if part and not (part == primary and part_kind in {"city", kind}):
            context.append(part)

    return {
        "label": ", ".join([primary, *context])[:MAX_LABEL_CHARS],
        "lat": float(lat),
        "lon": float(lon),
        "detail": ", ".join(context),
    }
