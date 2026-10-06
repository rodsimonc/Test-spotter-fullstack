"""Builds the full plan response from a request and a route.

Pure: no network, no Django, no database. The HTTP layer fetches the route and calls
`build_plan`. Everything in the result is plain JSON types and matches `PlanResponse` in
frontend/src/api/types.ts.

Time zones. The home terminal zone is resolved once, and its UTC offset at departure is
used for the whole trip. Every log day is then exactly 1,440 minutes, even if the real
zone changes its clocks mid-trip. When that happens the plan carries a warning.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .gazetteer import describe_place
from .hos import notes
from .hos.constants import (
    DEFAULT_LIMITS,
    DRIVING,
    KIND_BREAK,
    KIND_DRIVE,
    KIND_DROPOFF,
    KIND_FUEL,
    KIND_PICKUP,
    KIND_REST,
    KIND_RESTART,
    MINUTES_PER_DAY,
)
from .hos.geometry import LatLon, RouteProfile, bounds, build_profile, point_at_mile, simplify
from .hos.logs import build_daily_logs
from .hos.models import DriveLeg, EngineError, SimResult, SimSegment
from .hos.simulate import drive_minutes, simulate
from .types import PlaceData, PlanRequestData, RouteData

#: Route points sent to the browser.
MAX_GEOMETRY_POINTS = 1500
#: A first leg longer than this earns a warning.
LONG_DEADHEAD_MILES = 500.0
#: Trips with at least this many log sheets earn a warning.
LONG_TRIP_DAYS = 4

HEADER_KEYS = (
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

_TITLES = {
    "start": "Start",
    KIND_PICKUP: "Pickup",
    KIND_DROPOFF: "Dropoff",
    KIND_FUEL: "Fuel stop",
    KIND_BREAK: "30-minute break",
    KIND_REST: "10-hour rest",
    KIND_RESTART: "34-hour restart",
    "end": "End of trip",
}


def build_plan(req: PlanRequestData, route: RouteData) -> dict[str, Any]:
    zone, departure = _resolve_departure(req)
    cycle_minutes = _cycle_minutes(req.cycle_used_hours)

    leg_a, leg_b = route.legs
    legs = (
        DriveLeg(leg_a.distance_miles, drive_minutes(leg_a.distance_miles, leg_a.osrm_duration_minutes)),
        DriveLeg(leg_b.distance_miles, drive_minutes(leg_b.distance_miles, leg_b.osrm_duration_minutes)),
    )
    sim = simulate(legs[0], legs[1], cycle_minutes)
    total_miles = legs[0].miles + legs[1].miles

    profile = build_profile(route.coordinates, route.leg_end_indices, (legs[0].miles, legs[1].miles))
    point_at = _point_resolver(req, profile, legs[0].miles, total_miles)
    place_at = _place_resolver(point_at)
    header = {key: str(req.header.get(key, "")) for key in HEADER_KEYS}

    logs = build_daily_logs(sim.segments, departure, place_at, cycle_minutes, header, total_miles)
    n_days = len(logs)
    segments = _segments(sim.segments, departure, place_at)
    stops = _stops(sim.segments, departure, n_days, point_at, place_at, total_miles)
    summary = _summary(
        req, sim, legs, leg_a.osrm_duration_minutes, leg_b.osrm_duration_minutes, departure, n_days, total_miles
    )
    change = _clock_change(zone, departure, sim.total_minutes)

    return {
        "request": _echo(req, departure),
        "summary": summary,
        "route": _route(route),
        "stops": stops,
        "segments": segments,
        "logs": logs,
        "assumptions": _assumptions(zone, departure),
        "warnings": _warnings(req, sim, cycle_minutes, legs[0].miles, n_days, zone, departure, change),
    }


def _resolve_departure(req: PlanRequestData) -> tuple[ZoneInfo, datetime]:
    """Zone, and the departure as an aware datetime at a fixed offset.

    The wall-clock time the user typed is kept as is. Only the offset is decided here:
    whatever the zone's offset is at that wall time.
    """
    try:
        zone = ZoneInfo(req.timezone)
    except (ZoneInfoNotFoundError, ValueError, OSError) as exc:
        raise EngineError(f"Unknown time zone: {req.timezone!r}") from exc
    wall = req.departure.replace(tzinfo=None, second=0, microsecond=0)
    offset = wall.replace(tzinfo=zone).utcoffset()
    if offset is None:
        raise EngineError(f"Time zone {req.timezone!r} has no UTC offset.")
    return zone, wall.replace(tzinfo=timezone(offset))


def _cycle_minutes(hours: float) -> int:
    if not math.isfinite(hours) or hours < 0:
        raise EngineError("Cycle hours used must be a number from 0 up.")
    return round(hours * 60)


def _point_resolver(
    req: PlanRequestData, profile: RouteProfile, pickup_mile: float, total_miles: float
) -> Callable[[float], LatLon]:
    """Mile to coordinate. The three named places use the coordinates the user chose."""
    # Later entries win when two named places sit at the same mile (a zero-length leg).
    anchors: dict[float, PlaceData] = {}
    anchors[total_miles] = req.dropoff
    anchors[pickup_mile] = req.pickup
    anchors[0.0] = req.current

    def point_at(mile: float) -> LatLon:
        place: PlaceData | None = anchors.get(mile)
        if place is not None:
            return (place.lat, place.lon)
        return point_at_mile(profile, mile)

    return point_at


def _place_resolver(point_at: Callable[[float], LatLon]) -> Callable[[float], str]:
    cache: dict[float, str] = {}

    def place_at(mile: float) -> str:
        key = round(mile, 3)
        if key not in cache:
            cache[key] = describe_place(*point_at(mile))
        return cache[key]

    return place_at


def _iso(departure: datetime, minutes: int) -> str:
    return (departure + timedelta(minutes=minutes)).isoformat()


def _echo(req: PlanRequestData, departure: datetime) -> dict[str, Any]:
    def place(p: PlaceData) -> dict[str, Any]:
        return {"label": p.label, "lat": p.lat, "lon": p.lon}

    return {
        "current": place(req.current),
        "pickup": place(req.pickup),
        "dropoff": place(req.dropoff),
        "cycle_used_hours": req.cycle_used_hours,
        "departure": departure.strftime("%Y-%m-%dT%H:%M"),
        "timezone": req.timezone,
        "header": {key: str(req.header.get(key, "")) for key in HEADER_KEYS},
    }


def _route(route: RouteData) -> dict[str, Any]:
    e1, e2 = route.leg_end_indices
    full = route.coordinates[: e2 + 1]
    points, indices = simplify(route.coordinates, route.leg_end_indices, MAX_GEOMETRY_POINTS)
    (south, west), (north, east) = bounds(full)
    return {
        "geometry": [[round(lat, 5), round(lon, 5)] for lat, lon in points],
        "bounds": [[round(south, 5), round(west, 5)], [round(north, 5), round(east, 5)]],
        "leg_end_indices": [indices[0], indices[1]],
    }


def _segments(
    sim_segments: tuple[SimSegment, ...], departure: datetime, place_at: Callable[[float], str]
) -> list[dict[str, Any]]:
    out = []
    previous: SimSegment | None = None
    for i, seg in enumerate(sim_segments, start=1):
        out.append(
            {
                "id": i,
                "status": seg.status,
                "kind": seg.kind,
                "start_at": _iso(departure, seg.start_min),
                "end_at": _iso(departure, seg.end_min),
                "minutes": seg.minutes,
                "start_mile": round(seg.start_mile, 1),
                "end_mile": round(seg.end_mile, 1),
                "place": place_at(seg.start_mile),
                "note": notes.segment_note(seg, previous),
            }
        )
        previous = seg
    return out


def _stops(
    sim_segments: tuple[SimSegment, ...],
    departure: datetime,
    n_days: int,
    point_at: Callable[[float], LatLon],
    place_at: Callable[[float], str],
    total_miles: float,
) -> list[dict[str, Any]]:
    start_of_day = departure.hour * 60 + departure.minute

    def day_of(minute: int) -> int:
        return min(n_days, (start_of_day + minute) // MINUTES_PER_DAY + 1)

    def stop(stop_id: str, kind: str, start: int, end: int, mile: float, reason: str = "") -> dict[str, Any]:
        lat, lon = point_at(mile)
        return {
            "id": stop_id,
            "kind": kind,
            "title": _TITLES[kind],
            "place": place_at(mile),
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "mile": round(mile, 1),
            "arrive_at": _iso(departure, start),
            "depart_at": _iso(departure, end),
            "duration_minutes": end - start,
            "day": day_of(start),
            "note": notes.stop_note(kind, reason),
        }

    stops = [stop("start", "start", 0, 0, 0.0)]
    counts: Counter[str] = Counter()
    for seg in sim_segments:
        if seg.kind == KIND_DRIVE:
            continue
        counts[seg.kind] += 1
        once = seg.kind in (KIND_PICKUP, KIND_DROPOFF)
        stop_id = seg.kind if once else f"{seg.kind}-{counts[seg.kind]}"
        stops.append(stop(stop_id, seg.kind, seg.start_min, seg.end_min, seg.start_mile, seg.reason))
    end = sim_segments[-1].end_min
    stops.append(stop("end", "end", end, end, total_miles))
    return stops


def _summary(
    req: PlanRequestData,
    sim: SimResult,
    legs: tuple[DriveLeg, DriveLeg],
    osrm_a: float,
    osrm_b: float,
    departure: datetime,
    n_days: int,
    total_miles: float,
) -> dict[str, Any]:
    by_kind: Counter[str] = Counter(seg.kind for seg in sim.segments)
    driving = sum(seg.minutes for seg in sim.segments if seg.status == DRIVING)
    working = sum(seg.minutes for seg in sim.segments if seg.status in (DRIVING, "on_duty"))
    return {
        "distance_miles": round(total_miles, 1),
        "driving_minutes": driving,
        "on_duty_minutes": working,
        "elapsed_minutes": sim.total_minutes,
        "depart_at": departure.isoformat(),
        "arrive_at": _iso(departure, sim.total_minutes),
        "days": n_days,
        "fuel_stops": by_kind[KIND_FUEL],
        "breaks": by_kind[KIND_BREAK],
        "rests": by_kind[KIND_REST],
        "restarts": by_kind[KIND_RESTART],
        "cycle_used_start_hours": req.cycle_used_hours,
        "cycle_used_end_hours": round(sim.cycle_end_minutes / 60, 2),
        "legs": [
            {
                "from": "current",
                "to": "pickup",
                "distance_miles": round(legs[0].miles, 1),
                "duration_minutes": legs[0].minutes,
                "osrm_duration_minutes": round(osrm_a),
            },
            {
                "from": "pickup",
                "to": "dropoff",
                "distance_miles": round(legs[1].miles, 1),
                "duration_minutes": legs[1].minutes,
                "osrm_duration_minutes": round(osrm_b),
            },
        ],
    }


def _format_offset(offset: timedelta) -> str:
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    hours, rest = divmod(abs(minutes), 60)
    return f"UTC{sign}{hours:02d}:{rest:02d}"


def _assumptions(zone: ZoneInfo, departure: datetime) -> list[str]:
    offset = _format_offset(departure.utcoffset() or timedelta(0))
    return [
        "Property-carrying driver on a 70-hour, 8-day schedule. No adverse driving conditions.",
        "The driver starts rested with a full tank. The 14-hour window opens at departure.",
        "Hours already used in the cycle stay counted until a 34-hour restart. None of them drop out of the 8-day window during the trip.",
        "Drive time is the slower of the OSRM estimate and distance at 60 mph. OSRM models a car.",
        "Pickup and dropoff take 1 hour each. Fuel takes 30 minutes, at least once every 1,000 miles. All three are On Duty (not driving).",
        "A 30-minute break follows 8 hours of driving. Any non-driving stop of 30 minutes or more counts as the break.",
        "After 11 hours of driving the driver takes 10 hours in the sleeper berth. A 34-hour restart is logged Off Duty.",
        "No split sleeper pairing, short-haul exception or personal conveyance.",
        f"Times use the home terminal zone, {zone.key}. Its UTC offset at departure ({offset}) holds for the whole trip, so every log sheet is exactly 24 hours.",
        'Place names come from the nearest town of 5,000 people or more (GeoNames), so a stop in open country reads like "12 mi SW of Kearney, NE".',
    ]


def _clock_change(zone: ZoneInfo, departure: datetime, total_minutes: int) -> datetime | None:
    """Local time in the real zone when its offset first differs from the fixed one, if ever."""
    fixed = departure.utcoffset()
    start = departure.astimezone(UTC)

    def differs(minute: int) -> bool:
        return (start + timedelta(minutes=minute)).astimezone(zone).utcoffset() != fixed

    checkpoints = list(range(0, total_minutes + 1, 360))
    if checkpoints[-1] != total_minutes:
        checkpoints.append(total_minutes)
    previous = -1
    for minute in checkpoints:
        if differs(minute):
            lo, hi = previous, minute
            while hi - lo > 1:
                mid = (lo + hi) // 2
                lo, hi = (lo, mid) if differs(mid) else (mid, hi)
            return (start + timedelta(minutes=hi)).astimezone(zone)
        previous = minute
    return None


def _in_north_america(place: PlaceData) -> bool:
    return 14.0 <= place.lat <= 72.0 and -170.0 <= place.lon <= -50.0


def _hours_text(minutes: int) -> str:
    if minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} hour" if hours == 1 else f"{hours} hours"
    return f"{minutes} minutes"


def _warnings(
    req: PlanRequestData,
    sim: SimResult,
    cycle_minutes: int,
    deadhead_miles: float,
    n_days: int,
    zone: ZoneInfo,
    departure: datetime,
    change: datetime | None,
) -> list[str]:
    out: list[str] = []
    restarts = sum(1 for seg in sim.segments if seg.kind == KIND_RESTART)
    cycle_spent = cycle_minutes >= DEFAULT_LIMITS.cycle
    if cycle_spent:
        out.append(
            "Your cycle is already at 70 hours or more, so the trip starts with a 34-hour restart, logged Off Duty."
        )
    extra = restarts - (1 if cycle_spent else 0)
    if extra == 1:
        out.append("The 70-hour cycle runs out on this trip, so the plan adds a 34-hour restart, logged Off Duty.")
    elif extra > 1:
        out.append(
            f"The 70-hour cycle runs out {extra} times on this trip, "
            f"so the plan adds a 34-hour restart each time ({extra} in all), logged Off Duty."
        )
    if n_days >= LONG_TRIP_DAYS:
        out.append(f"This trip spans {n_days} days, so it has {n_days} daily log sheets.")
    if deadhead_miles > LONG_DEADHEAD_MILES:
        out.append(
            f"The drive to the pickup is {round(deadhead_miles):,} miles. It counts toward your hours like any other driving."
        )
    if not all(_in_north_america(p) for p in (req.current, req.pickup, req.dropoff)):
        out.append(
            "One or more places are outside North America. The plan applies US hours-of-service rules, which may not apply there."
        )
    if change is not None:
        shift = abs((change.utcoffset() or timedelta(0)) - (departure.utcoffset() or timedelta(0)))
        out.append(
            f"Clocks in {zone.key} change on {change:%B} {change.day} during this trip. "
            f"The sheets keep the {_format_offset(departure.utcoffset() or timedelta(0))} offset from departure, "
            f"so every day stays 24 hours, and times after the change differ from local clocks by "
            f"{_hours_text(int(shift.total_seconds() // 60))}."
        )
    return out
