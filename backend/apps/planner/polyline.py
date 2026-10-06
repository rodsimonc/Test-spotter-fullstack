"""Google's encoded polyline format, used to keep cached routes small.

A cross-country route has tens of thousands of points. As JSON pairs that is close to a megabyte
per cached row. Encoded at 5 decimal places (about a metre) it is a fifth of that.
"""

from __future__ import annotations

from collections.abc import Iterable

PRECISION = 5
_SCALE = 10**PRECISION


def encode(points: Iterable[tuple[float, float]]) -> str:
    out: list[str] = []
    prev_lat = prev_lon = 0
    for lat, lon in points:
        lat_i, lon_i = round(lat * _SCALE), round(lon * _SCALE)
        out.append(_encode_value(lat_i - prev_lat))
        out.append(_encode_value(lon_i - prev_lon))
        prev_lat, prev_lon = lat_i, lon_i
    return "".join(out)


def decode(text: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(text):
        delta_lat, index = _decode_value(text, index)
        delta_lon, index = _decode_value(text, index)
        lat += delta_lat
        lon += delta_lon
        points.append((lat / _SCALE, lon / _SCALE))
    return points


def _encode_value(value: int) -> str:
    value = ~(value << 1) if value < 0 else value << 1
    chars = []
    while value >= 0x20:
        chars.append(chr((0x20 | (value & 0x1F)) + 63))
        value >>= 5
    chars.append(chr(value + 63))
    return "".join(chars)


def _decode_value(text: str, index: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        if index >= len(text):
            raise ValueError("Truncated polyline.")
        byte = ord(text[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            break
    return (~(result >> 1) if result & 1 else result >> 1), index
