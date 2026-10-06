from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.common.fields import CleanCharField
from apps.planner.serializers import PlanRequestSerializer
from apps.planner.types import PlanRequestData

from .models import Trip

TITLE_MAX = 120
_TITLE_PART_MAX = 50


def _title_error_messages() -> dict[str, str]:
    return {
        "blank": "Give the trip a name.",
        "required": "Give the trip a name.",
        "null": "Give the trip a name.",
        "max_length": f"Use at most {TITLE_MAX} characters.",
    }


class TripCreateSerializer(serializers.Serializer):
    title = CleanCharField(
        required=False,
        allow_blank=True,
        max_length=TITLE_MAX,
        error_messages={"max_length": f"Use at most {TITLE_MAX} characters."},
    )
    request = PlanRequestSerializer()


class TripRenameSerializer(serializers.Serializer):
    title = CleanCharField(max_length=TITLE_MAX, error_messages=_title_error_messages())


class PageSerializer(serializers.Serializer):
    limit = serializers.IntegerField(required=False, min_value=1, max_value=100, default=20)
    offset = serializers.IntegerField(required=False, min_value=0, default=0)


class TripSummarySerializer(serializers.ModelSerializer):
    """Everything the list needs. Reads from `summary`, so `request` and `result` can stay
    unloaded."""

    current_label = serializers.CharField(source="summary.current_label", read_only=True)
    pickup_label = serializers.CharField(source="summary.pickup_label", read_only=True)
    dropoff_label = serializers.CharField(source="summary.dropoff_label", read_only=True)
    distance_miles = serializers.FloatField(source="summary.distance_miles", read_only=True)
    days = serializers.IntegerField(source="summary.days", read_only=True)
    depart_at = serializers.CharField(source="summary.depart_at", read_only=True)
    arrive_at = serializers.CharField(source="summary.arrive_at", read_only=True)

    class Meta:
        model = Trip
        fields = [
            "id",
            "title",
            "created_at",
            "current_label",
            "pickup_label",
            "dropoff_label",
            "distance_miles",
            "days",
            "depart_at",
            "arrive_at",
        ]
        read_only_fields = fields


class TripSerializer(TripSummarySerializer):
    class Meta(TripSummarySerializer.Meta):
        fields = [*TripSummarySerializer.Meta.fields, "request", "result"]
        read_only_fields = fields

    def to_representation(self, instance: Trip) -> dict[str, Any]:
        data = super().to_representation(instance)
        result = data.get("result")
        if isinstance(result, dict) and "directions" not in result:
            # Trips saved before directions existed. The contract says the field is always there.
            data["result"] = {**result, "directions": []}
        return data


def default_title(request: PlanRequestData) -> str:
    """ "Dallas to Denver", from the first part of each label."""

    def town(label: str) -> str:
        return label.split(",")[0].strip()[:_TITLE_PART_MAX] or "Trip"

    return f"{town(request.current.label)} to {town(request.dropoff.label)}"


def build_summary(request: PlanRequestData, result: dict[str, Any]) -> dict[str, Any]:
    summary = result["summary"]
    return {
        "current_label": request.current.label,
        "pickup_label": request.pickup.label,
        "dropoff_label": request.dropoff.label,
        "distance_miles": summary["distance_miles"],
        "days": summary["days"],
        "depart_at": summary["depart_at"],
        "arrive_at": summary["arrive_at"],
    }
