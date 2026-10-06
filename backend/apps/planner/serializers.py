"""Request validation for the planner endpoints, and the mapping onto the engine's data classes."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import datetime
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo, available_timezones

from rest_framework import serializers

from apps.common.fields import CleanCharField, FiniteFloatField

from .types import PlaceData, PlanRequestData

HEADER_FIELDS = (
    "driver_name",
    "co_driver_name",
    "carrier_name",
    "main_office_address",
    "home_terminal_address",
    "truck_number",
    "trailer_number",
    "shipper",
    "commodity",
    "shipping_doc_no",
)

LABEL_MAX = 200
HEADER_MAX = 120
DEPARTURE_FORMAT = "%Y-%m-%dT%H:%M"
_DEPARTURE_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}")
_MIN_YEAR, _MAX_YEAR = 2000, 2100
#: Five decimals is about a metre. Points closer than that count as the same place.
_SAME_POINT_DECIMALS = 5


@lru_cache(maxsize=1)
def _known_timezones() -> frozenset[str]:
    return frozenset(available_timezones())


class PlaceSerializer(serializers.Serializer):
    """A named point. Problems are reported as one list under the place's own field name."""

    default_error_messages = {"invalid": "A place needs a name, a latitude and a longitude."}

    label = CleanCharField(
        max_length=LABEL_MAX,
        error_messages={
            "required": "Place name is required.",
            "blank": "Place name is required.",
            "null": "Place name is required.",
            "max_length": f"Place name can be at most {LABEL_MAX} characters.",
        },
    )
    lat = FiniteFloatField(name="Latitude", min_value=-90, max_value=90)
    lon = FiniteFloatField(name="Longitude", min_value=-180, max_value=180)

    def to_internal_value(self, data):
        try:
            return super().to_internal_value(data)
        except serializers.ValidationError as exc:
            detail = exc.detail
            messages = (
                [str(m) for value in detail.values() for m in value]
                if isinstance(detail, dict)
                else [str(m) for m in detail]
            )
            raise serializers.ValidationError(messages) from None


def _header_field() -> CleanCharField:
    return CleanCharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        max_length=HEADER_MAX,
        error_messages={"max_length": f"Use at most {HEADER_MAX} characters."},
    )


class HeaderSerializer(serializers.Serializer):
    """Free text printed at the top of each daily log. Every field is optional."""

    driver_name = _header_field()
    co_driver_name = _header_field()
    carrier_name = _header_field()
    main_office_address = _header_field()
    home_terminal_address = _header_field()
    truck_number = _header_field()
    trailer_number = _header_field()
    shipper = _header_field()
    commodity = _header_field()
    shipping_doc_no = _header_field()


def _place_field(what: str) -> PlaceSerializer:
    return PlaceSerializer(error_messages={"required": f"Choose a {what}.", "null": f"Choose a {what}."})


class PlanRequestSerializer(serializers.Serializer):
    current = _place_field("current location")
    pickup = _place_field("pickup location")
    dropoff = _place_field("dropoff location")
    cycle_used_hours = FiniteFloatField(name="Cycle hours used", min_value=0, max_value=70)
    departure = serializers.CharField(
        error_messages={
            "required": "Choose a departure time.",
            "blank": "Choose a departure time.",
            "null": "Choose a departure time.",
        }
    )
    timezone = serializers.CharField(
        max_length=64,
        error_messages={
            "required": "Choose a time zone.",
            "blank": "Choose a time zone.",
            "null": "Choose a time zone.",
        },
    )
    header = HeaderSerializer(required=False, allow_null=True)

    def validate_timezone(self, value: str) -> str:
        value = value.strip()
        if value not in _known_timezones():
            raise serializers.ValidationError("Choose a valid time zone, like America/Chicago.")
        return value

    def validate_departure(self, value: str) -> datetime:
        value = value.strip()
        message = "Use the format YYYY-MM-DDTHH:mm, like 2026-10-07T06:00."
        if not _DEPARTURE_PATTERN.fullmatch(value):
            raise serializers.ValidationError(message)
        try:
            parsed = datetime.strptime(value, DEPARTURE_FORMAT)
        except ValueError:
            raise serializers.ValidationError(message) from None
        if not _MIN_YEAR <= parsed.year <= _MAX_YEAR:
            raise serializers.ValidationError(f"Choose a date between {_MIN_YEAR} and {_MAX_YEAR}.")
        return parsed

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        points = {
            (round(p["lat"], _SAME_POINT_DECIMALS), round(p["lon"], _SAME_POINT_DECIMALS))
            for p in (attrs["current"], attrs["pickup"], attrs["dropoff"])
        }
        if len(points) == 1:
            raise serializers.ValidationError(
                {"dropoff": ["Choose at least one place that's different from the others."]}
            )
        attrs["departure"] = attrs["departure"].replace(tzinfo=ZoneInfo(attrs["timezone"]))
        return attrs

    def to_request_data(self) -> PlanRequestData:
        """Call after `is_valid()`."""
        return build_request_data(self.validated_data)


def build_request_data(data: Mapping[str, Any]) -> PlanRequestData:
    """Map validated plan-request data onto the engine's data class."""
    header = dict.fromkeys(HEADER_FIELDS, "")
    header.update({k: v or "" for k, v in (data.get("header") or {}).items()})
    return PlanRequestData(
        current=PlaceData(**data["current"]),
        pickup=PlaceData(**data["pickup"]),
        dropoff=PlaceData(**data["dropoff"]),
        cycle_used_hours=data["cycle_used_hours"],
        departure=data["departure"],
        timezone=data["timezone"],
        header=header,
    )


def request_data_to_dict(request: PlanRequestData) -> dict[str, Any]:
    """The `PlanRequest` JSON for a validated request. Used when saving a trip."""
    return {
        "current": _place_dict(request.current),
        "pickup": _place_dict(request.pickup),
        "dropoff": _place_dict(request.dropoff),
        "cycle_used_hours": request.cycle_used_hours,
        "departure": request.departure.strftime(DEPARTURE_FORMAT),
        "timezone": request.timezone,
        "header": dict(request.header),
    }


def _place_dict(place: PlaceData) -> dict[str, Any]:
    return {"label": place.label, "lat": place.lat, "lon": place.lon}


class SearchQuerySerializer(serializers.Serializer):
    q = CleanCharField(
        min_length=2,
        max_length=120,
        error_messages={
            "required": "Type at least 2 characters.",
            "blank": "Type at least 2 characters.",
            "min_length": "Type at least 2 characters.",
            "max_length": "Search text can be at most 120 characters.",
        },
    )
    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=8,
        default=5,
        error_messages={
            "invalid": "Limit must be a whole number from 1 to 8.",
            "min_value": "Limit must be a whole number from 1 to 8.",
            "max_value": "Limit must be a whole number from 1 to 8.",
        },
    )
    lat = FiniteFloatField(name="Latitude", min_value=-90, max_value=90, allow_strings=True, required=False)
    lon = FiniteFloatField(name="Longitude", min_value=-180, max_value=180, allow_strings=True, required=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if ("lat" in attrs) != ("lon" in attrs):
            missing = "lon" if "lat" in attrs else "lat"
            raise serializers.ValidationError({missing: ["Send both lat and lon to bias results, or neither."]})
        return attrs


class ReverseQuerySerializer(serializers.Serializer):
    lat = FiniteFloatField(name="Latitude", min_value=-90, max_value=90, allow_strings=True)
    lon = FiniteFloatField(name="Longitude", min_value=-180, max_value=180, allow_strings=True)
