"""Strict serializer fields shared by every app."""

from __future__ import annotations

import math
import unicodedata

from rest_framework import serializers

_BAD_CATEGORIES = frozenset({"Cc", "Cs"})  # control characters and lone surrogates
_MAX_NUMBER_TEXT = 32


class CleanCharField(serializers.CharField):
    """Text with surrounding spaces trimmed and no control characters.

    Null bytes would break Postgres JSON columns, and lone surrogates cannot be encoded as
    UTF-8. Everything else, including markup and quotes, is kept exactly as sent. Escaping is the
    renderer's job.
    """

    default_error_messages = {"control_chars": "Remove control characters."}

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if any(unicodedata.category(char) in _BAD_CATEGORIES for char in value):
            self.fail("control_chars")
        return value


class FiniteFloatField(serializers.Field):
    """A real number. Rejects booleans, NaN, Infinity and anything past the given range.

    JSON numbers like `1e999` parse to infinity in Python, so a range check alone is not enough.
    """

    def __init__(
        self,
        *,
        name: str,
        min_value: float | None = None,
        max_value: float | None = None,
        allow_strings: bool = False,
        **kwargs,
    ):
        self.min_value = min_value
        self.max_value = max_value
        self.allow_strings = allow_strings
        messages = {
            "required": f"{name} is required.",
            "null": f"{name} is required.",
            "invalid": f"{name} must be a number.",
            "range": self._range_message(name, min_value, max_value),
        }
        messages.update(kwargs.pop("error_messages", {}))
        super().__init__(error_messages=messages, **kwargs)

    @staticmethod
    def _range_message(name: str, low: float | None, high: float | None) -> str:
        if low is not None and high is not None:
            return f"{name} must be between {low:g} and {high:g}."
        if low is not None:
            return f"{name} must be at least {low:g}."
        if high is not None:
            return f"{name} must be at most {high:g}."
        return f"{name} is out of range."

    def to_internal_value(self, data):
        if isinstance(data, bool):
            self.fail("invalid")
        if isinstance(data, str):
            if not self.allow_strings or len(data) > _MAX_NUMBER_TEXT:
                self.fail("invalid")
        elif not isinstance(data, int | float):
            self.fail("invalid")
        try:
            value = float(data)
        except (ValueError, OverflowError):
            self.fail("invalid")
        if not math.isfinite(value):
            self.fail("invalid")
        if (self.min_value is not None and value < self.min_value) or (
            self.max_value is not None and value > self.max_value
        ):
            self.fail("range")
        return value

    def to_representation(self, value):
        return float(value)
