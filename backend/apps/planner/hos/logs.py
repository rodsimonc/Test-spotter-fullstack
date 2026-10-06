"""Daily log sheets from simulation segments.

Each sheet is one calendar day at the home terminal, midnight to midnight. Segments that
cross midnight are cut in two. The clock offset is fixed for the whole trip (see
assemble.py), so every sheet is exactly 1,440 minutes.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
from typing import Any

from . import notes
from .constants import (
    DEFAULT_LIMITS,
    DRIVING,
    KIND_DRIVE,
    KIND_IDLE,
    KIND_RESTART,
    MINUTES_PER_DAY,
    OFF_DUTY,
    ON_DUTY,
    SLEEPER,
)
from .models import SimSegment

#: Maps miles from the start of the trip to short place text such as "Kearney, NE".
PlaceAt = Callable[[float], str]

_WORKING = (DRIVING, ON_DUTY)


def vehicle_text(header: Mapping[str, str]) -> str:
    """ "Truck 101 / Trailer 202", or an empty string."""
    parts = []
    if header.get("truck_number"):
        parts.append(f"Truck {header['truck_number']}")
    if header.get("trailer_number"):
        parts.append(f"Trailer {header['trailer_number']}")
    return " / ".join(parts)


def day_count(departure: datetime, total_minutes: int) -> int:
    """Number of log sheets. A trip that ends exactly at midnight does not start a new day."""
    start = departure.hour * 60 + departure.minute
    return max(1, math.ceil((start + total_minutes) / MINUTES_PER_DAY))


def apportion(values: list[float], target: int) -> list[int]:
    """Round each value down, then hand the leftover whole units to the largest remainders.

    The results add up to `target` exactly, which plain rounding of each day does not.
    """
    floors = [math.floor(v) for v in values]
    short = target - sum(floors)
    order = sorted(range(len(values)), key=lambda i: (values[i] - floors[i], -i), reverse=True)
    for i in order[: max(0, short)]:
        floors[i] += 1
    return floors


def build_daily_logs(
    segments: tuple[SimSegment, ...],
    departure: datetime,
    place_at: PlaceAt,
    cycle_used_minutes: int,
    header: Mapping[str, str],
    total_miles: float,
    cycle_limit: int = DEFAULT_LIMITS.cycle,
) -> list[dict[str, Any]]:
    start_of_day = departure.hour * 60 + departure.minute
    end_abs = start_of_day + segments[-1].end_min
    n_days = day_count(departure, segments[-1].end_min)

    entries: list[list[dict[str, Any]]] = [[] for _ in range(n_days)]
    remarks: list[list[dict[str, Any]]] = [[] for _ in range(n_days)]
    drive_miles = [0.0] * n_days

    if start_of_day > 0:
        entries[0].append(_entry(OFF_DUTY, KIND_IDLE, 0, start_of_day, place_at(0.0), notes.OFF_DUTY))

    previous: SimSegment | None = None
    for seg in segments:
        a_start = start_of_day + seg.start_min
        a_end = start_of_day + seg.end_min
        note = notes.segment_note(seg, previous)
        if previous is None or (previous.status, previous.kind) != (seg.status, seg.kind):
            day, minute = divmod(a_start, MINUTES_PER_DAY)
            remarks[day].append({"minute": minute, "place": place_at(seg.start_mile), "note": note})
        for day in range(a_start // MINUTES_PER_DAY, (a_end - 1) // MINUTES_PER_DAY + 1):
            lo = max(a_start, day * MINUTES_PER_DAY)
            hi = min(a_end, (day + 1) * MINUTES_PER_DAY)
            mile_at_lo = seg.start_mile + (seg.end_mile - seg.start_mile) * (lo - a_start) / seg.minutes
            entries[day].append(
                _entry(
                    seg.status,
                    seg.kind,
                    lo - day * MINUTES_PER_DAY,
                    hi - day * MINUTES_PER_DAY,
                    place_at(mile_at_lo),
                    note,
                )
            )
            if seg.kind == KIND_DRIVE:
                drive_miles[day] += (seg.end_mile - seg.start_mile) * (hi - lo) / seg.minutes
        previous = seg

    if end_abs % MINUTES_PER_DAY:
        last = n_days - 1
        minute = end_abs - last * MINUTES_PER_DAY
        place = place_at(total_miles)
        entries[last].append(_entry(OFF_DUTY, KIND_IDLE, minute, MINUTES_PER_DAY, place, notes.OFF_DUTY))
        remarks[last].append({"minute": minute, "place": place, "note": notes.OFF_DUTY})

    whole_miles = apportion(drive_miles, round(total_miles))
    restart_ends = [start_of_day + s.end_min for s in segments if s.kind == KIND_RESTART]
    vehicle = vehicle_text(header)

    def mile_at(abs_minute: int) -> float:
        t = abs_minute - start_of_day
        if t <= 0:
            return 0.0
        if t >= segments[-1].end_min:
            return total_miles
        for seg in segments:
            if seg.start_min <= t < seg.end_min:
                return seg.start_mile + (seg.end_mile - seg.start_mile) * (t - seg.start_min) / seg.minutes
        return total_miles  # unreachable, segments are contiguous

    logs: list[dict[str, Any]] = []
    for i in range(n_days):
        totals = _totals(entries[i])
        logs.append(
            {
                "day": i + 1,
                "date": (departure.date() + timedelta(days=i)).isoformat(),
                "from_place": place_at(mile_at(i * MINUTES_PER_DAY)),
                "to_place": place_at(mile_at(min((i + 1) * MINUTES_PER_DAY, end_abs))),
                "total_miles_driving": whole_miles[i],
                "total_mileage_today": whole_miles[i],
                "entries": entries[i],
                "totals": totals,
                "remarks": remarks[i],
                "recap": _recap(i, entries, totals, restart_ends, cycle_used_minutes, cycle_limit),
                "header": dict(header),
                "vehicle": vehicle,
            }
        )
    return logs


def _entry(status: str, kind: str, start_min: int, end_min: int, place: str, note: str) -> dict[str, Any]:
    return {"status": status, "kind": kind, "start_min": start_min, "end_min": end_min, "place": place, "note": note}


def _totals(day_entries: list[dict[str, Any]]) -> dict[str, int]:
    totals = {OFF_DUTY: 0, SLEEPER: 0, DRIVING: 0, ON_DUTY: 0}
    for e in day_entries:
        totals[e["status"]] += e["end_min"] - e["start_min"]
    return totals


def _working_minutes_after(day_entries: list[dict[str, Any]], day_index: int, cutoff_abs: int) -> int:
    """Driving plus on-duty minutes on one day that fall at or after `cutoff_abs`."""
    base = day_index * MINUTES_PER_DAY
    total = 0
    for e in day_entries:
        if e["status"] in _WORKING:
            lo = max(base + e["start_min"], cutoff_abs)
            hi = base + e["end_min"]
            if hi > lo:
                total += hi - lo
    return total


def _recap(
    i: int,
    entries: list[list[dict[str, Any]]],
    totals: dict[str, int],
    restart_ends: list[int],
    prior: int,
    cycle_limit: int,
) -> dict[str, Any]:
    """Recap for the 70-hour/8-day driver, in minutes.

    A counts today and the 7 days before it. C counts today and the 6 before. Hours the
    driver had already used when the trip began stay in both until a 34-hour restart
    finishes, after which counting starts at zero from the minute the restart ends.
    """
    day_start, day_end = i * MINUTES_PER_DAY, (i + 1) * MINUTES_PER_DAY
    finished = [r for r in restart_ends if r <= day_end]
    cutoff = max(finished) if finished else None
    carried = prior if cutoff is None else 0
    floor = cutoff or 0

    def window(days: int) -> int:
        first = max(0, i - days + 1)
        return carried + sum(_working_minutes_after(entries[k], k, floor) for k in range(first, i + 1))

    a = window(8)
    return {
        "on_duty_today_minutes": totals[DRIVING] + totals[ON_DUTY],
        "a_minutes": a,
        "b_minutes": max(0, cycle_limit - a),
        "c_minutes": window(7),
        "restart_completed": any(day_start < r <= day_end for r in restart_ends),
    }
