"""Builders shared by the engine tests."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from apps.planner.types import PlaceData, PlanRequestData, RouteData, RouteLeg

DALLAS = (32.7767, -96.7970)
MEMPHIS = (35.1495, -90.0490)
DENVER = (39.7392, -104.9903)


def _line(a: tuple[float, float], b: tuple[float, float], steps: int) -> list[tuple[float, float]]:
    return [(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps) for i in range(steps + 1)]


def make_route(
    leg1_miles: float,
    leg2_miles: float,
    osrm1: float | None = None,
    osrm2: float | None = None,
    a: tuple[float, float] = DALLAS,
    b: tuple[float, float] = MEMPHIS,
    c: tuple[float, float] = DENVER,
    steps: int = 30,
) -> RouteData:
    """A straight-line route whose legs report the given miles.

    `osrm1` and `osrm2` are the router's durations in minutes. They default to 90 percent of
    the 60 mph time, which is what a car profile tends to say, so the 60 mph floor decides.
    A zero-mile leg collapses onto one point: leg 1 onto `a`, leg 2 onto the pickup.
    """
    osrm1 = leg1_miles * 0.9 if osrm1 is None else osrm1
    osrm2 = leg2_miles * 0.9 if osrm2 is None else osrm2
    if leg1_miles > 0 and leg2_miles > 0:
        coordinates = _line(a, b, steps) + _line(b, c, steps)[1:]
        indices = (steps, 2 * steps)
    elif leg1_miles > 0:
        coordinates = _line(a, b, steps)
        indices = (steps, steps)
    elif leg2_miles > 0:
        coordinates = _line(a, c, steps)
        indices = (0, steps)
    else:
        coordinates = [a, a]
        indices = (0, 1)
    return RouteData(
        coordinates=coordinates,
        leg_end_indices=indices,
        legs=(RouteLeg(leg1_miles, osrm1), RouteLeg(leg2_miles, osrm2)),
    )


def make_request(
    departure: str = "2026-10-07T06:00",
    tz: str = "America/Chicago",
    cycle: float = 0.0,
    header: dict[str, str] | None = None,
    a: tuple[float, float] = DALLAS,
    b: tuple[float, float] = MEMPHIS,
    c: tuple[float, float] = DENVER,
) -> PlanRequestData:
    return PlanRequestData(
        current=PlaceData("Start", a[0], a[1]),
        pickup=PlaceData("Pickup", b[0], b[1]),
        dropoff=PlaceData("Dropoff", c[0], c[1]),
        cycle_used_hours=cycle,
        departure=datetime.fromisoformat(departure).replace(tzinfo=ZoneInfo(tz)),
        timezone=tz,
        header=dict(header or {}),
    )


def rows(plan: dict) -> list[tuple]:
    """Segments as (kind, start, end, start_mile, end_mile), times as local "YYYY-MM-DD HH:MM"."""

    def stamp(iso: str) -> str:
        return iso[:16].replace("T", " ")

    return [
        (s["kind"], stamp(s["start_at"]), stamp(s["end_at"]), s["start_mile"], s["end_mile"]) for s in plan["segments"]
    ]


def day_entries(plan: dict, day: int) -> list[tuple]:
    """Entries of one log day as (status, kind, start_min, end_min)."""
    return [(e["status"], e["kind"], e["start_min"], e["end_min"]) for e in plan["logs"][day - 1]["entries"]]
