"""Hours-of-service numbers in one place.

Every limit the simulation obeys is a field of `Limits`, so tests can tighten one rule
(for example the 14-hour window) and watch the engine react. The defaults are the rules in
docs/hos-rules.md.
"""

from __future__ import annotations

from dataclasses import dataclass

MINUTES_PER_DAY = 24 * 60

#: Truck speed floor. Drive time is never shorter than distance at this speed.
FLOOR_SPEED_MPH = 60.0

#: Duty status values on the wire (see `DutyStatus` in frontend/src/api/types.ts).
OFF_DUTY = "off_duty"
SLEEPER = "sleeper"
DRIVING = "driving"
ON_DUTY = "on_duty"

#: Segment and entry kinds on the wire (see `SegmentKind`).
KIND_DRIVE = "drive"
KIND_PICKUP = "pickup"
KIND_DROPOFF = "dropoff"
KIND_FUEL = "fuel"
KIND_BREAK = "break"
KIND_REST = "rest"
KIND_RESTART = "restart"
KIND_IDLE = "idle"


@dataclass(frozen=True)
class Limits:
    """Rules and fixed durations, all in minutes except the fuel interval (miles)."""

    #: 11-hour driving limit, counted since the last 10-hour rest.
    max_driving: int = 11 * 60
    #: 14-hour window, counted from the moment the driver comes on duty after a rest.
    window: int = 14 * 60
    #: Driving allowed before a 30-minute non-driving gap is needed.
    break_after_driving: int = 8 * 60
    break_length: int = 30
    #: Sleeper berth rest that resets the 11-hour and 14-hour clocks.
    rest_length: int = 10 * 60
    #: 70 hours in 8 days.
    cycle: int = 70 * 60
    restart_length: int = 34 * 60
    #: Assessment rule: fuel at least once every 1,000 miles.
    fuel_interval_miles: float = 1000.0
    fuel_length: int = 30
    pickup_length: int = 60
    dropoff_length: int = 60


DEFAULT_LIMITS = Limits()
