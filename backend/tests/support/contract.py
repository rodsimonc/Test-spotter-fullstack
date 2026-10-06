"""Shape checks written by hand from `frontend/src/api/types.ts`.

They check keys and basic types, not hours-of-service numbers.
"""

from __future__ import annotations

from typing import Any

PLACE = {"label", "lat", "lon"}
HEADER = {
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
}
REQUEST = {"current", "pickup", "dropoff", "cycle_used_hours", "departure", "timezone", "header"}
LEG = {"from", "to", "distance_miles", "duration_minutes", "osrm_duration_minutes"}
SUMMARY = {
    "distance_miles",
    "driving_minutes",
    "on_duty_minutes",
    "elapsed_minutes",
    "depart_at",
    "arrive_at",
    "days",
    "fuel_stops",
    "breaks",
    "rests",
    "restarts",
    "cycle_used_start_hours",
    "cycle_used_end_hours",
    "legs",
}
ROUTE = {"geometry", "bounds", "leg_end_indices"}
STOP = {
    "id",
    "kind",
    "title",
    "place",
    "lat",
    "lon",
    "mile",
    "arrive_at",
    "depart_at",
    "duration_minutes",
    "day",
    "note",
}
SEGMENT = {"id", "status", "kind", "start_at", "end_at", "minutes", "start_mile", "end_mile", "place", "note"}
ENTRY = {"status", "kind", "start_min", "end_min", "place", "note"}
REMARK = {"minute", "place", "note"}
TOTALS = {"off_duty", "sleeper", "driving", "on_duty"}
RECAP = {"on_duty_today_minutes", "a_minutes", "b_minutes", "c_minutes", "restart_completed"}
LOG = {
    "day",
    "date",
    "from_place",
    "to_place",
    "total_miles_driving",
    "total_mileage_today",
    "entries",
    "totals",
    "remarks",
    "recap",
    "header",
    "vehicle",
}
RESPONSE = {"request", "summary", "route", "stops", "segments", "logs", "assumptions", "warnings"}


def has_keys(obj: Any, keys: set[str], where: str) -> None:
    assert isinstance(obj, dict), f"{where} should be an object, got {type(obj).__name__}"
    assert set(obj) == keys, f"{where} keys differ: extra {set(obj) - keys}, missing {keys - set(obj)}"


def assert_plan_request(obj: Any) -> None:
    has_keys(obj, REQUEST, "request")
    for name in ("current", "pickup", "dropoff"):
        has_keys(obj[name], PLACE, f"request.{name}")
    has_keys(obj["header"], HEADER, "request.header")


def assert_plan_response(obj: Any) -> None:
    has_keys(obj, RESPONSE, "plan")
    assert_plan_request(obj["request"])
    has_keys(obj["summary"], SUMMARY, "summary")
    assert len(obj["summary"]["legs"]) == 2
    for i, leg in enumerate(obj["summary"]["legs"]):
        has_keys(leg, LEG, f"summary.legs[{i}]")
    has_keys(obj["route"], ROUTE, "route")
    assert len(obj["route"]["leg_end_indices"]) == 2
    assert len(obj["route"]["bounds"]) == 2
    for i, stop in enumerate(obj["stops"]):
        has_keys(stop, STOP, f"stops[{i}]")
    for i, segment in enumerate(obj["segments"]):
        has_keys(segment, SEGMENT, f"segments[{i}]")
    assert obj["logs"], "a plan always has at least one log"
    for i, log in enumerate(obj["logs"]):
        has_keys(log, LOG, f"logs[{i}]")
        has_keys(log["totals"], TOTALS, f"logs[{i}].totals")
        has_keys(log["recap"], RECAP, f"logs[{i}].recap")
        has_keys(log["header"], HEADER, f"logs[{i}].header")
        for entry in log["entries"]:
            has_keys(entry, ENTRY, f"logs[{i}].entries")
        for remark in log["remarks"]:
            has_keys(remark, REMARK, f"logs[{i}].remarks")
    assert all(isinstance(a, str) for a in obj["assumptions"])
    assert all(isinstance(w, str) for w in obj["warnings"])


def assert_error(response: Any, status: int, code: str, *, fields: bool | None = None) -> dict[str, Any]:
    """Check the shared error body. Returns the `error` object for further asserts."""
    assert response.status_code == status, f"expected {status}, got {response.status_code}: {response.content[:300]!r}"
    body = response.json()
    assert set(body) == {"error"}, body
    error = body["error"]
    assert error["code"] == code, error
    assert isinstance(error["message"], str) and error["message"]
    allowed = {"code", "message", "fields"}
    assert set(error) <= allowed, error
    if fields is True:
        assert error.get("fields"), error
    if fields is False:
        assert "fields" not in error, error
    assert "Traceback" not in response.content.decode()
    return error
