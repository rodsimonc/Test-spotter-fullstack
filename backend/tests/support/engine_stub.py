"""A stand-in for the HOS engine, so the API tests never depend on the engine being finished.

`PLANNER_TEST_ENGINE` picks which one the API tests run against:

- `auto` (default): the real engine when its modules exist, the stub otherwise.
- `real`: the real engine, and fail loudly if it is missing.
- `fake`: always the stub, which keeps API tests fast and independent of engine changes.

The stub returns something shaped like a `PlanResponse`. It does not follow hours-of-service
rules. Those are tested in `tests/engine`.
"""

from __future__ import annotations

import importlib.util
import math
import os
import sys
import types
from datetime import timedelta
from typing import Any

MODULES = ("apps.planner.assemble", "apps.planner.gazetteer", "apps.planner.hos.models")


def _exists(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except ModuleNotFoundError:
        return False


def real_engine_available() -> bool:
    return all(_exists(name) for name in MODULES)


def choice() -> str:
    return os.environ.get("PLANNER_TEST_ENGINE", "auto").strip().lower()


class FakeEngineError(Exception):
    """Stands in for `apps.planner.hos.models.EngineError`."""


def _place(place: Any) -> dict[str, Any]:
    return {"label": place.label, "lat": place.lat, "lon": place.lon}


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def fake_build_plan(req: Any, route: Any) -> dict[str, Any]:
    """One driving block per leg and a one-hour stop at each end. No limits are applied."""
    start = req.departure.replace(second=0, microsecond=0)
    leg_a, leg_b = route.legs
    drive_a = max(round(leg_a.osrm_duration_minutes), round(leg_a.distance_miles))
    drive_b = max(round(leg_b.osrm_duration_minutes), round(leg_b.distance_miles))
    total = drive_a + 60 + drive_b + 60
    miles = leg_a.distance_miles + leg_b.distance_miles

    def at(minutes: int) -> str:
        return (start + timedelta(minutes=minutes)).isoformat()

    start_min = start.hour * 60 + start.minute
    days = max(1, math.ceil((start_min + total) / 1440))
    plan = [
        ("driving", "drive", 0, drive_a),
        ("on_duty", "pickup", drive_a, drive_a + 60),
        ("driving", "drive", drive_a + 60, drive_a + 60 + drive_b),
        ("on_duty", "dropoff", drive_a + 60 + drive_b, total),
    ]
    segments = [
        {
            "id": i + 1,
            "status": status,
            "kind": kind,
            "start_at": at(a),
            "end_at": at(b),
            "minutes": b - a,
            "start_mile": 0.0,
            "end_mile": round(miles, 1),
            "place": "Somewhere, XX",
            "note": kind,
        }
        for i, (status, kind, a, b) in enumerate(plan)
    ]
    stops = [
        _stop("start", "start", "Start", 0, 0, req.current, 0.0, at, 1),
        _stop("pickup", "pickup", "Pickup", drive_a, drive_a + 60, req.pickup, leg_a.distance_miles, at, 1),
        _stop("dropoff", "dropoff", "Dropoff", total - 60, total, req.dropoff, miles, at, days),
        _stop("end", "end", "End of trip", total, total, req.dropoff, miles, at, days),
    ]
    logs = [_log(day, start, req, miles) for day in range(1, days + 1)]
    coords = route.coordinates
    step = max(1, len(coords) // 200)
    geometry = [[lat, lon] for lat, lon in coords[::step]]
    if geometry[-1] != [coords[-1][0], coords[-1][1]]:
        geometry.append([coords[-1][0], coords[-1][1]])
    lats, lons = [p[0] for p in coords], [p[1] for p in coords]
    return {
        "request": {
            "current": _place(req.current),
            "pickup": _place(req.pickup),
            "dropoff": _place(req.dropoff),
            "cycle_used_hours": req.cycle_used_hours,
            "departure": start.strftime("%Y-%m-%dT%H:%M"),
            "timezone": req.timezone,
            "header": dict(req.header),
        },
        "summary": {
            "distance_miles": round(miles, 1),
            "driving_minutes": drive_a + drive_b,
            "on_duty_minutes": total,
            "elapsed_minutes": total,
            "depart_at": at(0),
            "arrive_at": at(total),
            "days": days,
            "fuel_stops": 0,
            "breaks": 0,
            "rests": 0,
            "restarts": 0,
            "cycle_used_start_hours": req.cycle_used_hours,
            "cycle_used_end_hours": req.cycle_used_hours + total / 60,
            "legs": [
                {
                    "from": "current",
                    "to": "pickup",
                    "distance_miles": round(leg_a.distance_miles, 1),
                    "duration_minutes": drive_a,
                    "osrm_duration_minutes": round(leg_a.osrm_duration_minutes),
                },
                {
                    "from": "pickup",
                    "to": "dropoff",
                    "distance_miles": round(leg_b.distance_miles, 1),
                    "duration_minutes": drive_b,
                    "osrm_duration_minutes": round(leg_b.osrm_duration_minutes),
                },
            ],
        },
        "route": {
            "geometry": geometry,
            "bounds": [[min(lats), min(lons)], [max(lats), max(lons)]],
            "leg_end_indices": [
                min(route.leg_end_indices[0] // step, len(geometry) - 1),
                len(geometry) - 1,
            ],
        },
        "stops": stops,
        "segments": segments,
        "logs": logs,
        "assumptions": ["Stub engine: no hours-of-service rules applied."],
        "warnings": [],
    }


def _stop(stop_id, kind, title, arrive, depart, place, mile, at, day) -> dict[str, Any]:
    return {
        "id": stop_id,
        "kind": kind,
        "title": title,
        "place": place.label,
        "lat": place.lat,
        "lon": place.lon,
        "mile": round(mile, 1),
        "arrive_at": at(arrive),
        "depart_at": at(depart),
        "duration_minutes": depart - arrive,
        "day": day,
        "note": title,
    }


def _log(day: int, start: Any, req: Any, miles: float) -> dict[str, Any]:
    date = (start + timedelta(days=day - 1)).strftime("%Y-%m-%d")
    entries = [{"status": "off_duty", "kind": "idle", "start_min": 0, "end_min": 1440, "place": "", "note": "Off duty"}]
    return {
        "day": day,
        "date": date,
        "from_place": req.current.label,
        "to_place": req.dropoff.label,
        "total_miles_driving": round(miles),
        "total_mileage_today": round(miles),
        "entries": entries,
        "totals": {"off_duty": 1440, "sleeper": 0, "driving": 0, "on_duty": 0},
        "remarks": [{"minute": 0, "place": "Somewhere, XX", "note": "Off duty"}],
        "recap": {
            "on_duty_today_minutes": 0,
            "a_minutes": 0,
            "b_minutes": 4200,
            "c_minutes": 0,
            "restart_completed": False,
        },
        "header": dict(req.header),
        "vehicle": "",
    }


def fake_describe_place(lat: float, lon: float) -> str:
    return f"Stubville, XX ({lat:.2f}, {lon:.2f})"


def _module(name: str, **attrs: Any) -> types.ModuleType:
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    return module


ACTIVE = "unset"


def using_real_engine() -> bool:
    return ACTIVE == "real"


def install() -> str:
    """Register the stub modules the choice calls for. Returns "real" or "fake"."""
    global ACTIVE
    wanted = choice()
    if wanted not in {"auto", "real", "fake"}:
        raise RuntimeError(f"PLANNER_TEST_ENGINE must be auto, real or fake, got {wanted!r}.")
    if wanted == "real" and not real_engine_available():
        raise RuntimeError("PLANNER_TEST_ENGINE=real, but the engine modules are missing.")
    if wanted == "real" or (wanted == "auto" and real_engine_available()):
        ACTIVE = "real"
        return ACTIVE

    package = sys.modules.get("apps.planner")
    for name in MODULES:
        if name == "apps.planner.hos.models":
            # Real exception classes are harmless, so keep them whenever they exist.
            if _exists(name):
                continue
            hos = _module("apps.planner.hos")
            hos.__path__ = []
            stub = _module(name, EngineError=FakeEngineError)
            hos.models = stub
            sys.modules["apps.planner.hos"] = hos
        elif name == "apps.planner.assemble":
            stub = _module(name, build_plan=fake_build_plan)
        else:
            stub = _module(name, describe_place=fake_describe_place, nearest_place=lambda lat, lon: None)
        sys.modules[name] = stub
        if package is not None:
            setattr(package, name.rsplit(".", 1)[1], stub)
    ACTIVE = "fake"
    return ACTIVE
