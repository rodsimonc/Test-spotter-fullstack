"""Independent compliance checker for finished plans.

Written from the FMCSA guide and the assessment brief. It imports nothing from
apps.planner, so the engine and this file cannot share a bug by sharing a helper. The rule
numbers are typed in again below on purpose.

Every public function returns a list of problem strings. An empty list means the plan is clean.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

DRIVE_LIMIT = 11 * 60
WINDOW = 14 * 60
BREAK_AFTER = 8 * 60
BREAK_LEN = 30
REST_LEN = 10 * 60
RESTART_LEN = 34 * 60
CYCLE = 70 * 60
FUEL_EVERY = 1000.0
DAY = 24 * 60

STATUS_OF = {
    "drive": "driving",
    "pickup": "on_duty",
    "dropoff": "on_duty",
    "fuel": "on_duty",
    "break": "off_duty",
    "rest": "sleeper",
    "restart": "off_duty",
}
LENGTH_OF = {"pickup": 60, "dropoff": 60, "fuel": 30, "break": 30, "rest": 600, "restart": 2040}
SUPPORT = ("break", "rest", "restart", "fuel")
WORKING = ("driving", "on_duty")
REMARK_NOTES = {
    "Departed, driving to pickup",
    "Driving to pickup",
    "Left pickup, driving to dropoff",
    "Driving to dropoff",
    "Pickup, loading (1 hr)",
    "Fuel stop (30 min)",
    "30-minute break",
    "10-hour rest, sleeper berth",
    "34-hour restart",
    "Dropoff, unloading (1 hr)",
    "Off duty",
}
#: Miles in the JSON are rounded to one decimal, so differences can be off by 0.1.
MILE_TOLERANCE = 0.11


@dataclass(frozen=True)
class Expect:
    """What the plan was asked for, typed in from the test and not read back from the plan."""

    leg_miles: tuple[float, float]
    osrm_minutes: tuple[float, float]
    cycle_used_hours: float
    departure: str
    timezone: str
    header: dict[str, str] = field(default_factory=dict)
    outside_north_america: bool = False


@dataclass(frozen=True)
class Seg:
    kind: str
    status: str
    start: int
    end: int
    m0: float
    m1: float


def planner_minutes(miles: float, osrm_minutes: float) -> int:
    """Drive time: slower of the router and 60 mph, rounded up. 60 mph is one mile a minute."""
    minutes = max(0, math.ceil(max(osrm_minutes, miles) - 1e-9))
    return max(1, minutes) if miles > 0 else minutes


def check_plan(plan: dict[str, Any], expect: Expect) -> list[str]:
    problems: list[str] = []
    try:
        json.dumps(plan, allow_nan=False)
    except (TypeError, ValueError) as exc:
        return [f"plan is not JSON safe: {exc}"]

    dep = datetime.fromisoformat(plan["summary"]["depart_at"])
    problems += _check_zone(plan, expect, dep)

    def minute_of(iso: str) -> int:
        return (datetime.fromisoformat(iso) - dep) // timedelta(minutes=1)

    segs = [
        Seg(s["kind"], s["status"], minute_of(s["start_at"]), minute_of(s["end_at"]), s["start_mile"], s["end_mile"])
        for s in plan["segments"]
    ]
    for i, s in enumerate(plan["segments"]):
        if s["id"] != i + 1:
            problems.append(f"segment ids are not 1..n at {i}")
        if s["minutes"] != segs[i].end - segs[i].start:
            problems.append(f"segment {i} minutes do not match its times")
        if not s["place"] or not s["note"]:
            problems.append(f"segment {i} has no place or note")

    prior = round(expect.cycle_used_hours * 60)
    leg_minutes = (
        planner_minutes(expect.leg_miles[0], expect.osrm_minutes[0]),
        planner_minutes(expect.leg_miles[1], expect.osrm_minutes[1]),
    )
    problems += check_timeline(segs, prior, leg_minutes, expect.leg_miles)
    if problems:
        return problems  # later checks assume a sound timeline

    dep_min = dep.hour * 60 + dep.minute
    problems += _check_summary(plan, expect, segs, leg_minutes, prior)
    problems += _check_stops(plan, segs, dep_min, minute_of)
    problems += _check_logs(plan, expect, segs, dep, dep_min, prior)
    problems += _check_warnings(plan, expect, segs, dep, prior)
    return problems


def check_timeline(
    segs: list[Seg], prior: int, leg_minutes: tuple[int, int], leg_miles: tuple[float, float]
) -> list[str]:
    """Structure, fixed durations, miles and every hours-of-service limit."""
    p: list[str] = []
    if not segs:
        return ["no segments"]
    if segs[0].start != 0:
        p.append("timeline does not start at departure")

    for i, s in enumerate(segs):
        if s.end <= s.start:
            p.append(f"segment {i} ({s.kind}) has no length")
        if STATUS_OF.get(s.kind) != s.status:
            p.append(f"segment {i}: kind {s.kind} cannot have status {s.status}")
        want = LENGTH_OF.get(s.kind)
        if want is not None and s.end - s.start != want:
            p.append(f"segment {i}: {s.kind} lasts {s.end - s.start} minutes, expected {want}")
        if i and s.start != segs[i - 1].end:
            p.append(f"segment {i} does not start where {i - 1} ends")
        if i and abs(s.m0 - segs[i - 1].m1) > 1e-6:
            p.append(f"segment {i} start mile does not match the previous end mile")
        if s.kind != "drive" and abs(s.m1 - s.m0) > 1e-6:
            p.append(f"segment {i}: {s.kind} moves the truck")
        if s.kind == "drive" and s.m1 < s.m0:
            p.append(f"segment {i}: the truck drives backwards")
    if p:
        return p

    kinds = [s.kind for s in segs]
    if kinds.count("pickup") != 1 or kinds.count("dropoff") != 1:
        return ["a trip needs exactly one pickup and one dropoff"]
    pick = kinds.index("pickup")
    if kinds[-1] != "dropoff" or pick > kinds.index("dropoff"):
        return ["the trip must end with the dropoff, after the pickup"]

    total = leg_miles[0] + leg_miles[1]
    for leg, chunk in enumerate((segs[:pick], segs[pick + 1 :])):
        driven = sum(s.end - s.start for s in chunk if s.kind == "drive")
        if driven != leg_minutes[leg]:
            p.append(f"leg {leg + 1}: drove {driven} minutes, expected {leg_minutes[leg]}")
        if leg_minutes[leg] > 0:
            per_minute = leg_miles[leg] / leg_minutes[leg]
            if per_minute > 1.0 + 1e-9:
                p.append(f"leg {leg + 1}: planner speed is over 60 mph")
            for s in chunk:
                if s.kind == "drive" and abs((s.m1 - s.m0) - (s.end - s.start) * per_minute) > MILE_TOLERANCE:
                    p.append(f"leg {leg + 1}: a drive segment covers the wrong number of miles")
    if abs(segs[pick].m0 - leg_miles[0]) > MILE_TOLERANCE / 2:
        p.append("pickup is not at the end of leg 1")
    if abs(segs[-1].m1 - total) > MILE_TOLERANCE / 2:
        p.append("trip does not end at the total distance")

    p += _walk_limits(segs, prior)
    marks = [0.0] + [s.m0 for s in segs if s.kind == "fuel"] + [total]
    for a, b in zip(marks, marks[1:], strict=False):
        if b - a > FUEL_EVERY + MILE_TOLERANCE:
            p.append(f"{b - a:.1f} miles between fuel stops")
    return p


def _walk_limits(segs: list[Seg], prior: int) -> list[str]:
    p: list[str] = []
    driven = since_break = nd_run = off_run = 0
    cycle = prior
    window_start = 0
    reopen = False
    last_fuel = 0.0

    if prior >= CYCLE and segs[0].kind != "restart":
        p.append("cycle is already used up but the trip does not start with a restart")

    for i, s in enumerate(segs):
        m = s.end - s.start
        if s.status in ("off_duty", "sleeper"):
            # Each stop must have a reason: the limit it clears has to be at its edge.
            if s.kind == "break" and since_break != BREAK_AFTER:
                p.append(f"segment {i}: break taken with {since_break} minutes of driving")
            if s.kind == "rest" and driven < DRIVE_LIMIT and s.start - window_start < WINDOW:
                p.append(f"segment {i}: rest taken early (driven {driven}, window used {s.start - window_start})")
            if s.kind == "restart" and cycle < CYCLE:
                p.append(f"segment {i}: restart taken with only {cycle} minutes in the cycle")
            off_run += m
            nd_run += m
            if off_run >= REST_LEN:
                driven = 0
                reopen = True
            if off_run >= RESTART_LEN:
                cycle = 0
            if nd_run >= BREAK_LEN:
                since_break = 0
            continue

        if reopen:
            window_start = s.start
            reopen = False
        off_run = 0
        if s.kind == "fuel":
            if s.m0 - last_fuel < FUEL_EVERY - 1.0 - MILE_TOLERANCE:
                p.append(f"segment {i}: fuel stop after only {s.m0 - last_fuel:.1f} miles")
            last_fuel = s.m0
        if s.status == "on_duty":
            cycle += m
            nd_run += m
            if nd_run >= BREAK_LEN:
                since_break = 0
        else:
            nd_run = 0
            driven += m
            since_break += m
            cycle += m
            if driven > DRIVE_LIMIT:
                p.append(f"segment {i}: {driven} minutes driven since the last 10-hour rest")
            if since_break > BREAK_AFTER:
                p.append(f"segment {i}: {since_break} minutes driven since the last 30-minute break")
            if s.end > window_start + WINDOW:
                p.append(f"segment {i}: driving past the 14-hour window")
            if cycle > CYCLE:
                p.append(f"segment {i}: driving past 70 hours in the cycle")

    for i, s in enumerate(segs):
        if s.kind not in SUPPORT:
            continue
        j = i + 1
        while j < len(segs) and segs[j].kind in SUPPORT:
            j += 1
        after = segs[j].kind if j < len(segs) else None
        allowed = ("drive", "pickup") if i == 0 else ("drive",)
        if after not in allowed:
            p.append(f"segment {i} ({s.kind}) is not followed by driving")
    return p


def _check_zone(plan: dict[str, Any], expect: Expect, dep: datetime) -> list[str]:
    p: list[str] = []
    wall = datetime.fromisoformat(expect.departure)
    real = wall.replace(tzinfo=ZoneInfo(expect.timezone)).utcoffset()
    if dep.utcoffset() != real:
        p.append(f"departure offset {dep.utcoffset()} is not the zone offset {real}")
    if dep.replace(tzinfo=None) != wall:
        p.append("departure wall clock changed")
    echo = plan["request"]
    if echo["departure"] != expect.departure or echo["timezone"] != expect.timezone:
        p.append("request echo changed the departure or the zone")
    if echo["cycle_used_hours"] != expect.cycle_used_hours:
        p.append("request echo changed the cycle hours")
    stamps = [plan["summary"]["arrive_at"]]
    stamps += [s[k] for s in plan["segments"] for k in ("start_at", "end_at")]
    stamps += [s[k] for s in plan["stops"] for k in ("arrive_at", "depart_at")]
    if any(datetime.fromisoformat(t).utcoffset() != real for t in stamps):
        p.append("a timestamp carries a different offset")
    return p


def _check_summary(
    plan: dict[str, Any], expect: Expect, segs: list[Seg], leg_minutes: tuple[int, int], prior: int
) -> list[str]:
    p: list[str] = []
    s = plan["summary"]
    elapsed = segs[-1].end
    count = defaultdict(int)
    for seg in segs:
        count[seg.kind] += 1
    driving = sum(x.end - x.start for x in segs if x.kind == "drive")
    working = sum(x.end - x.start for x in segs if x.status in WORKING)
    expected = {
        "driving_minutes": driving,
        "on_duty_minutes": working,
        "elapsed_minutes": elapsed,
        "fuel_stops": count["fuel"],
        "breaks": count["break"],
        "rests": count["rest"],
        "restarts": count["restart"],
    }
    for key, value in expected.items():
        if s[key] != value:
            p.append(f"summary {key} is {s[key]}, expected {value}")
    if abs(s["distance_miles"] - (expect.leg_miles[0] + expect.leg_miles[1])) > MILE_TOLERANCE:
        p.append("summary distance does not match the legs")
    dep = datetime.fromisoformat(s["depart_at"])
    if datetime.fromisoformat(s["arrive_at"]) - dep != timedelta(minutes=elapsed):
        p.append("arrive_at is not departure plus elapsed minutes")
    dep_min = dep.hour * 60 + dep.minute
    if s["days"] != math.ceil((dep_min + elapsed) / DAY) or s["days"] != len(plan["logs"]):
        p.append("summary days does not match the number of log sheets")
    if s["cycle_used_start_hours"] != expect.cycle_used_hours:
        p.append("summary cycle start changed")
    legs = s["legs"]
    for k in (0, 1):
        if legs[k]["duration_minutes"] != leg_minutes[k]:
            p.append(f"leg {k + 1} duration in the summary is wrong")
        if legs[k]["osrm_duration_minutes"] != round(expect.osrm_minutes[k]):
            p.append(f"leg {k + 1} OSRM duration in the summary is wrong")
        if abs(legs[k]["distance_miles"] - expect.leg_miles[k]) > 0.051:
            p.append(f"leg {k + 1} distance in the summary is wrong")
    end_cycle = _cycle_at_end(segs, prior)
    if abs(s["cycle_used_end_hours"] * 60 - end_cycle) > 1.0:
        p.append(f"cycle at the end is {end_cycle} minutes, summary says {s['cycle_used_end_hours']} hours")
    return p


def _cycle_at_end(segs: list[Seg], prior: int) -> int:
    cycle, off_run = prior, 0
    for s in segs:
        if s.status in ("off_duty", "sleeper"):
            off_run += s.end - s.start
            if off_run >= RESTART_LEN:
                cycle = 0
        else:
            off_run = 0
            cycle += s.end - s.start
    return cycle


def _check_stops(plan: dict[str, Any], segs: list[Seg], dep_min: int, minute_of) -> list[str]:
    p: list[str] = []
    stops = plan["stops"]
    ids = [s["id"] for s in stops]
    if len(set(ids)) != len(ids):
        p.append("stop ids are not unique")
    if stops[0]["kind"] != "start" or stops[-1]["kind"] != "end":
        return p + ["stops must begin with start and finish with end"]
    n_days = len(plan["logs"])
    inner = [s for s in segs if s.kind != "drive"]
    if len(stops) != len(inner) + 2:
        return p + [f"{len(stops)} stops for {len(inner)} non-driving segments"]
    for stop, seg in zip(stops[1:-1], inner, strict=True):
        if stop["kind"] != seg.kind:
            p.append(f"stop {stop['id']} is {stop['kind']}, segment is {seg.kind}")
        if (minute_of(stop["arrive_at"]), minute_of(stop["depart_at"])) != (seg.start, seg.end):
            p.append(f"stop {stop['id']} times do not match its segment")
        if abs(stop["mile"] - seg.m0) > MILE_TOLERANCE / 2:
            p.append(f"stop {stop['id']} mile does not match its segment")
    for a, b in zip(stops, stops[1:], strict=False):
        if b["mile"] + 1e-9 < a["mile"]:
            p.append(f"stop {b['id']} is behind {a['id']}")
        if minute_of(b["arrive_at"]) < minute_of(a["depart_at"]):
            p.append(f"stop {b['id']} arrives before {a['id']} leaves")
    for stop in stops:
        arrive, depart = minute_of(stop["arrive_at"]), minute_of(stop["depart_at"])
        if depart - arrive != stop["duration_minutes"]:
            p.append(f"stop {stop['id']} duration does not match its times")
        want_day = min(n_days, (dep_min + arrive) // DAY + 1)
        if stop["day"] != want_day:
            p.append(f"stop {stop['id']} is on day {stop['day']}, expected {want_day}")
        if not (-90 <= stop["lat"] <= 90 and -180 <= stop["lon"] <= 180):
            p.append(f"stop {stop['id']} has an impossible coordinate")
        if not stop["place"] or not stop["title"] or not stop["note"]:
            p.append(f"stop {stop['id']} is missing text")
    if plan["logs"][0]["from_place"] != stops[0]["place"]:
        p.append("first log does not start at the start stop")
    if plan["logs"][-1]["to_place"] != stops[-1]["place"]:
        p.append("last log does not end at the end stop")
    return p


def _check_logs(
    plan: dict[str, Any], expect: Expect, segs: list[Seg], dep: datetime, dep_min: int, prior: int
) -> list[str]:
    p: list[str] = []
    logs = plan["logs"]
    end_abs = dep_min + segs[-1].end
    n_days = math.ceil(end_abs / DAY)
    if len(logs) != n_days:
        return [f"{len(logs)} log sheets, expected {n_days}"]

    # Rebuild every minute of every day from the segments alone.
    grid = [["off_duty"] * DAY for _ in range(n_days)]
    expected_remarks: dict[int, set[int]] = defaultdict(set)
    miles_by_day = [0.0] * n_days
    for s in segs:
        a0, a1 = dep_min + s.start, dep_min + s.end
        expected_remarks[a0 // DAY].add(a0 % DAY)
        for a in range(a0, a1):
            grid[a // DAY][a % DAY] = s.status
        if s.kind == "drive":
            for day in range(a0 // DAY, (a1 - 1) // DAY + 1):
                overlap = min(a1, (day + 1) * DAY) - max(a0, day * DAY)
                miles_by_day[day] += (s.m1 - s.m0) * overlap / (s.end - s.start)
    if end_abs % DAY:
        expected_remarks[end_abs // DAY].add(end_abs % DAY)

    restart_ends = [dep_min + s.end for s in segs if s.kind == "restart"]
    working = [[1 if status in WORKING else 0 for status in day] for day in grid]
    header = {**dict.fromkeys(_HEADER_KEYS, ""), **expect.header}
    vehicle_parts = []
    if header["truck_number"]:
        vehicle_parts.append(f"Truck {header['truck_number']}")
    if header["trailer_number"]:
        vehicle_parts.append(f"Trailer {header['trailer_number']}")

    miles_total = 0
    for d, log in enumerate(logs):
        tag = f"day {d + 1}"
        if log["day"] != d + 1 or log["date"] != (dep.date() + timedelta(days=d)).isoformat():
            p.append(f"{tag}: wrong day number or date")
        entries = log["entries"]
        if not entries or entries[0]["start_min"] != 0 or entries[-1]["end_min"] != DAY:
            p.append(f"{tag}: entries do not cover 0 to 1440")
            continue
        rebuilt: list[str] = []
        for j, e in enumerate(entries):
            if e["end_min"] <= e["start_min"]:
                p.append(f"{tag}: entry {j} is empty")
            if j and e["start_min"] != entries[j - 1]["end_min"]:
                p.append(f"{tag}: gap before entry {j}")
            if e["kind"] != "idle" and STATUS_OF.get(e["kind"]) != e["status"]:
                p.append(f"{tag}: entry {j} kind {e['kind']} has status {e['status']}")
            if not e["place"]:
                p.append(f"{tag}: entry {j} has no place")
            rebuilt += [e["status"]] * (e["end_min"] - e["start_min"])
        if rebuilt != grid[d]:
            first = next((m for m in range(DAY) if m >= len(rebuilt) or rebuilt[m] != grid[d][m]), -1)
            p.append(f"{tag}: entries disagree with the segments from minute {first}")
        totals = {status: grid[d].count(status) for status in ("off_duty", "sleeper", "driving", "on_duty")}
        if log["totals"] != totals or sum(totals.values()) != DAY:
            p.append(f"{tag}: totals {log['totals']} should be {totals}")

        minutes = [r["minute"] for r in log["remarks"]]
        if minutes != sorted(minutes) or len(set(minutes)) != len(minutes):
            p.append(f"{tag}: remarks are not one per minute in order")
        if set(minutes) != expected_remarks[d]:
            p.append(f"{tag}: remark minutes {sorted(set(minutes))} should be {sorted(expected_remarks[d])}")
        for r in log["remarks"]:
            if not r["place"] or r["note"] not in REMARK_NOTES:
                p.append(f"{tag}: bad remark {r}")

        if abs(log["total_miles_driving"] - miles_by_day[d]) > 1.0 + MILE_TOLERANCE:
            p.append(f"{tag}: {log['total_miles_driving']} miles driven, expected about {miles_by_day[d]:.1f}")
        if log["total_mileage_today"] != log["total_miles_driving"]:
            p.append(f"{tag}: mileage today differs from miles driving")
        miles_total += log["total_miles_driving"]

        finished = [r for r in restart_ends if r <= (d + 1) * DAY]
        cut = max(finished) if finished else 0
        carried = 0 if finished else prior

        def counted(k: int, cut: int = cut) -> int:
            return sum(working[k][max(0, cut - k * DAY) :])

        a = carried + sum(counted(k) for k in range(max(0, d - 7), d + 1))
        c = carried + sum(counted(k) for k in range(max(0, d - 6), d + 1))
        recap = log["recap"]
        want = {
            "on_duty_today_minutes": sum(working[d]),
            "a_minutes": a,
            "b_minutes": max(0, CYCLE - a),
            "c_minutes": c,
            "restart_completed": any(d * DAY < r <= (d + 1) * DAY for r in restart_ends),
        }
        if recap != want:
            p.append(f"{tag}: recap {recap} should be {want}")

        if log["header"] != header or log["vehicle"] != " / ".join(vehicle_parts):
            p.append(f"{tag}: header or vehicle text changed")
        if not log["from_place"] or not log["to_place"]:
            p.append(f"{tag}: missing from or to place")
    if miles_total != round(expect.leg_miles[0] + expect.leg_miles[1]):
        p.append(f"daily miles add up to {miles_total}, trip is {sum(expect.leg_miles):.1f}")
    return p


_HEADER_KEYS = (
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


def _check_warnings(plan: dict[str, Any], expect: Expect, segs: list[Seg], dep: datetime, prior: int) -> list[str]:
    p: list[str] = []
    warnings = plan["warnings"]
    n_days = len(plan["logs"])

    def has(prefix: str) -> bool:
        return any(w.startswith(prefix) or prefix in w for w in warnings)

    restarts = sum(1 for s in segs if s.kind == "restart")
    if (restarts > 0) != has("34-hour restart"):
        p.append("restart warning does not match the restarts in the timeline")
    if (prior >= CYCLE) != has("already at 70 hours"):
        p.append("cycle-used-up warning is wrong")
    if (n_days >= 4) != has("This trip spans"):
        p.append("long-trip warning is wrong")
    if (expect.leg_miles[0] > 500) != has("The drive to the pickup"):
        p.append("deadhead warning is wrong")
    if expect.outside_north_america != has("outside North America"):
        p.append("outside-North-America warning is wrong")

    zone = ZoneInfo(expect.timezone)
    end = dep.astimezone(ZoneInfo("UTC")) + timedelta(minutes=segs[-1].end)
    start = dep.astimezone(ZoneInfo("UTC"))
    changes = any(t.astimezone(zone).utcoffset() != dep.utcoffset() for t in (start, end))
    if changes != has("Clocks in"):
        p.append(f"clock-change warning is wrong (zone changes during trip: {changes})")

    assumptions = " ".join(plan["assumptions"])
    if expect.timezone not in assumptions or "UTC" not in assumptions:
        p.append("assumptions do not name the zone and offset")
    return p
