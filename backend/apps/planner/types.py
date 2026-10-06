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
class RawStep:
    """One step of the router's turn list, in the units the planner uses.

    Nothing here is trusted text. `name` and `ref` are whatever the map data says.
    """

    distance_miles: float
    name: str
    #: "I 40" or "I 40;US 64". Empty when the road has no reference.
    ref: str
    #: The router's maneuver type: "depart", "turn", "new name", "arrive" and so on.
    maneuver: str
    #: None when the router sent no usable location for the step.
    lat: float | None
    lon: float | None
    #: Compass bearing in degrees just after the maneuver, or None when it is missing.
    bearing_after: float | None


@dataclass(frozen=True)
class Stretch:
    """One condensed line of the directions, before any wording is written.

    It holds nothing that depends on the place labels the user typed, so it is safe to cache.
    """

    #: "depart", "road" or "arrive".
    kind: str
    road: str
    #: N, NE, E, SE, S, SW, W or NW. Empty on arrival.
    heading: str
    distance_miles: float
    #: Miles from the start of the whole trip to where the stretch begins.
    mile: float
    lat: float
    lon: float


@dataclass(frozen=True)
class RouteData:
    #: Full-resolution (lat, lon) points from the current location through the pickup to the dropoff.
    coordinates: list[tuple[float, float]]
    #: Index into `coordinates` where leg 1 (current to pickup) and leg 2 (pickup to dropoff) end.
    leg_end_indices: tuple[int, int]
    legs: tuple[RouteLeg, RouteLeg]
    #: Condensed directions for leg 1 and leg 2, or None when the router gave no usable steps.
    directions: tuple[tuple[Stretch, ...], tuple[Stretch, ...]] | None = None
