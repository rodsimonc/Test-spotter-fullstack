"""Short text for log remarks, timeline segments and stop cards.

Remark notes are what a driver would scribble on a paper log. Stop notes are longer and
say why the stop is there. Both assume the default limits in `constants.Limits`.
"""

from __future__ import annotations

from .constants import (
    KIND_BREAK,
    KIND_DRIVE,
    KIND_DROPOFF,
    KIND_FUEL,
    KIND_IDLE,
    KIND_PICKUP,
    KIND_REST,
    KIND_RESTART,
)
from .models import SimSegment

DEPART = "Departed, driving to pickup"
TO_PICKUP = "Driving to pickup"
LEFT_PICKUP = "Left pickup, driving to dropoff"
TO_DROPOFF = "Driving to dropoff"
PICKUP = "Pickup, loading (1 hr)"
FUEL = "Fuel stop (30 min)"
BREAK = "30-minute break"
REST = "10-hour rest, sleeper berth"
RESTART = "34-hour restart"
DROPOFF = "Dropoff, unloading (1 hr)"
OFF_DUTY = "Off duty"

#: Reasons a rest or restart is inserted.
REASON_DRIVING_LIMIT = "driving_limit"
REASON_WINDOW = "window"
REASON_CYCLE = "cycle"

_FIXED = {
    KIND_PICKUP: PICKUP,
    KIND_DROPOFF: DROPOFF,
    KIND_FUEL: FUEL,
    KIND_BREAK: BREAK,
    KIND_REST: REST,
    KIND_RESTART: RESTART,
    KIND_IDLE: OFF_DUTY,
}


def segment_note(seg: SimSegment, previous: SimSegment | None) -> str:
    """Remark text for one segment. Driving depends on what came before it."""
    if seg.kind != KIND_DRIVE:
        return _FIXED[seg.kind]
    if seg.leg == 1:
        return DEPART if seg.start_min == 0 else TO_PICKUP
    after_pickup = previous is not None and previous.kind == KIND_PICKUP
    return LEFT_PICKUP if after_pickup else TO_DROPOFF


def stop_note(kind: str, reason: str = "") -> str:
    """Longer note shown on a stop card and map popup."""
    if kind == "start":
        return "Trip starts here."
    if kind == "end":
        return "Trip ends here. Off duty."
    if kind == KIND_PICKUP:
        return "Loading takes 1 hour. On duty, not driving."
    if kind == KIND_DROPOFF:
        return "Unloading takes 1 hour. On duty, not driving."
    if kind == KIND_FUEL:
        return "Fuel at least every 1,000 miles. 30 minutes on duty, not driving."
    if kind == KIND_BREAK:
        return "8 hours of driving reached. 30 minutes off duty."
    if kind == KIND_REST:
        if reason == REASON_WINDOW:
            return "14-hour window reached. 10 hours in the sleeper berth."
        return "11 hours of driving reached. 10 hours in the sleeper berth."
    if kind == KIND_RESTART:
        return "70-hour cycle used up. 34 hours off duty resets it."
    return ""
