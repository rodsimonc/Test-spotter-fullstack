"""Plain data passed between the HTTP layer, the router client and the HOS engine.

No Django imports here. The engine and its tests must run without Django set up.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class PlaceData:
    label: str
    lat: float
    lon: float


@dataclass(frozen=True)
class PlanRequestData:
    current: PlaceData
    pickup: PlaceData
    dropoff: PlaceData
    cycle_used_hours: float
    #: Timezone-aware, in the home terminal zone.
    departure: datetime
    #: IANA name, for example "America/Chicago".
    timezone: str
    #: Every LogHeader key is present. Unset values are "".
    header: dict[str, str]


@dataclass(frozen=True)
class RouteLeg:
    distance_miles: float
    #: What the router said, before the planner applies its 60 mph floor.
    osrm_duration_minutes: float


@dataclass(frozen=True)
class RouteData:
    #: Full-resolution (lat, lon) points from the current location through the pickup to the dropoff.
    coordinates: list[tuple[float, float]]
    #: Index into `coordinates` where leg 1 (current to pickup) and leg 2 (pickup to dropoff) end.
    leg_end_indices: tuple[int, int]
    legs: tuple[RouteLeg, RouteLeg]
