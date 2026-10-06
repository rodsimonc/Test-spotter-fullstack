"""Small pure helpers in the trips app."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from apps.planner.types import PlaceData, PlanRequestData
from apps.trips.serializers import build_summary, default_title


def request_with(current: str, dropoff: str) -> PlanRequestData:
    return PlanRequestData(
        current=PlaceData(current, 32.0, -96.0),
        pickup=PlaceData("Memphis, TN", 35.0, -90.0),
        dropoff=PlaceData(dropoff, 39.0, -104.0),
        cycle_used_hours=0,
        departure=datetime(2026, 10, 7, 6, 0, tzinfo=ZoneInfo("America/Chicago")),
        timezone="America/Chicago",
        header={},
    )


@pytest.mark.parametrize(
    ("current", "dropoff", "title"),
    [
        ("Dallas, Texas, United States", "Denver, Colorado, United States", "Dallas to Denver"),
        ("Dallas", "Denver", "Dallas to Denver"),
        ("  Dallas  , TX", " Denver ,CO", "Dallas to Denver"),
        (", Texas", "Denver", "Trip to Denver"),
        ("Dallas", "", "Dallas to Trip"),
        ("A" * 80 + ", TX", "B" * 80, f"{'A' * 50} to {'B' * 50}"),
        ("<b>Dallas</b>, TX", "O'Hare", "<b>Dallas</b> to O'Hare"),
    ],
)
def test_default_title_uses_the_first_part_of_each_label(current, dropoff, title):
    assert default_title(request_with(current, dropoff)) == title


def test_a_default_title_always_fits_the_column():
    assert len(default_title(request_with("A" * 200, "B" * 200))) <= 120


def test_build_summary_picks_only_what_the_list_needs():
    request = request_with("Dallas, TX", "Denver, CO")
    result = {
        "summary": {
            "distance_miles": 1556.8,
            "days": 3,
            "depart_at": "2026-10-07T06:00:00-05:00",
            "arrive_at": "2026-10-09T09:19:00-05:00",
            "fuel_stops": 1,
        },
        "logs": ["too big to copy"],
    }

    assert build_summary(request, result) == {
        "current_label": "Dallas, TX",
        "pickup_label": "Memphis, TN",
        "dropoff_label": "Denver, CO",
        "distance_miles": 1556.8,
        "days": 3,
        "depart_at": "2026-10-07T06:00:00-05:00",
        "arrive_at": "2026-10-09T09:19:00-05:00",
    }


def test_trip_str_is_the_title():
    from apps.trips.models import Trip

    assert str(Trip(title="Fall run")) == "Fall run"
