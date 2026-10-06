"""Work out which client a request came from, for throttling.

By default only `REMOTE_ADDR` is used. A client can send any `X-Forwarded-For` it likes, so the
header is read only when `TRUST_PROXY_HEADERS` is on, meaning a proxy we control sits in front.

Each trusted proxy appends the address of the peer it saw. With N trusted proxies, the client is
therefore the Nth value from the right. Anything further left was supplied by the client and is
ignored. Vercel overwrites the header with a single address, which this rule handles too.
"""

from __future__ import annotations

import ipaddress

from django.conf import settings
from django.http import HttpRequest

UNKNOWN = "unknown"


def _parse(raw: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        address = ipaddress.ip_address(raw.strip())
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        return address.ipv4_mapped
    return address


def _forwarded_client(header: str, trusted_proxies: int):
    parts = [part for part in (p.strip() for p in header.split(",")) if part]
    if not parts:
        return None
    index = len(parts) - trusted_proxies
    return _parse(parts[index] if index >= 0 else parts[0])


def client_ip(request: HttpRequest) -> str:
    """Return a stable identifier for the caller. IPv6 callers share a bucket per /64."""
    address = None
    if settings.TRUST_PROXY_HEADERS:
        header = request.META.get("HTTP_X_FORWARDED_FOR", "")
        address = _forwarded_client(header, settings.TRUSTED_PROXY_COUNT)
    if address is None:
        address = _parse(request.META.get("REMOTE_ADDR", ""))
    if address is None:
        return UNKNOWN
    if isinstance(address, ipaddress.IPv6Address):
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)
