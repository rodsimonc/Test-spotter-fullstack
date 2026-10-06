"""Minute-resolution hours-of-service simulation.

One pass over: drive leg 1, pickup, drive leg 2, dropoff. All times are whole minutes
after departure. Driving advances in chunks, each limited by the tightest of: the leg
that is left, the 8-hour break clock, the 11-hour driving clock, the 14-hour window, the
70-hour cycle and the fuel interval. When a chunk would be empty, the stop that clears
the blocking limit goes in and the loop runs again.

When several limits block at the same minute the order is: fuel, restart, rest, break.
Fuel comes first because it is on duty and also counts as the 30-minute break. A restart
beats a rest because 34 hours off clears everything a 10-hour rest does.

Work that is not driving is never cut short. A pickup that starts with 20 minutes left in
the window still takes its full hour, and the rest follows.
"""

from __future__ import annotations

import math

from . import notes
from .constants import (
    DEFAULT_LIMITS,
    DRIVING,
    FLOOR_SPEED_MPH,
    KIND_BREAK,
    KIND_DRIVE,
    KIND_DROPOFF,
    KIND_FUEL,
    KIND_PICKUP,
    KIND_REST,
    KIND_RESTART,
    OFF_DUTY,
    ON_DUTY,
    SLEEPER,
    Limits,
)
from .models import DriveLeg, EngineError, SimResult, SimSegment

#: A logic bug must raise, never hang. Real trips need a few dozen steps.
MAX_STEPS = 50_000

_EPS = 1e-9


def drive_minutes(miles: float, osrm_minutes: float) -> int:
    """Planner drive time: the slower of the router and 60 mph, rounded up to a minute.

    Rounding up keeps the truck at or under 60 mph. Any real distance costs at least one
    minute, so no miles go missing.
    """
    if not (math.isfinite(miles) and math.isfinite(osrm_minutes)) or miles < 0 or osrm_minutes < 0:
        raise EngineError("Route distance and duration must be finite and not negative.")
    at_floor_speed = miles / FLOOR_SPEED_MPH * 60.0
    minutes = max(0, math.ceil(max(osrm_minutes, at_floor_speed) - _EPS))
    if miles > 0:
        minutes = max(minutes, 1)
    return minutes


def simulate(
    leg1: DriveLeg,
    leg2: DriveLeg,
    cycle_used_minutes: int,
    limits: Limits = DEFAULT_LIMITS,
) -> SimResult:
    """Run the trip and return contiguous segments from departure to the end of dropoff."""
    if cycle_used_minutes < 0:
        raise EngineError("Cycle hours used cannot be negative.")
    return _Simulation((leg1, leg2), cycle_used_minutes, limits).run()


class _Simulation:
    def __init__(self, legs: tuple[DriveLeg, DriveLeg], cycle_used: int, limits: Limits) -> None:
        self.legs = legs
        self.limits = limits
        self.segments: list[SimSegment] = []
        self.t = 0
        #: Miles from the start of the trip.
        self.mile = 0.0
        #: Driving minutes since the last 10-hour rest.
        self.drive_run = 0
        #: Driving minutes since the last non-driving gap of 30 minutes or more.
        self.break_run = 0
        #: Minute at which the current 14-hour window opened.
        self.window_start = 0
        #: On-duty minutes counted in the cycle since the last restart.
        self.cycle = cycle_used
        #: Odometer reading at the last fill.
        self.fuel_mile = 0.0
        self.steps = 0

    def run(self) -> SimResult:
        lim = self.limits
        if self.cycle >= lim.cycle:
            # Nothing can be driven yet. Restart first, so the clock is clean for the whole trip.
            self._stationary(OFF_DUTY, KIND_RESTART, lim.restart_length, reason=notes.REASON_CYCLE)
        self._drive(1, self.legs[0], base_mile=0.0)
        self._stationary(ON_DUTY, KIND_PICKUP, lim.pickup_length)
        self._drive(2, self.legs[1], base_mile=self.legs[0].miles)
        self._stationary(ON_DUTY, KIND_DROPOFF, lim.dropoff_length)
        return SimResult(tuple(self.segments), self.cycle)

    def _drive(self, leg_no: int, leg: DriveLeg, base_mile: float) -> None:
        if leg.minutes <= 0:
            self.mile = base_mile + leg.miles
            return
        lim = self.limits
        driven = 0
        while driven < leg.minutes:
            self._tick()
            fuel_room = self._fuel_room(leg, base_mile, driven)
            cycle_room = lim.cycle - self.cycle
            drive_room = lim.max_driving - self.drive_run
            window_room = lim.window - (self.t - self.window_start)
            break_room = lim.break_after_driving - self.break_run
            chunk = min(leg.minutes - driven, fuel_room, cycle_room, drive_room, window_room, break_room)
            if chunk <= 0:
                self._clear_blocking_limit(fuel_room, cycle_room, drive_room, window_room)
                continue
            driven += chunk
            end_mile = base_mile + leg.miles if driven == leg.minutes else base_mile + leg.miles * driven / leg.minutes
            start = self.t
            self.t += chunk
            self.segments.append(SimSegment(DRIVING, KIND_DRIVE, start, self.t, self.mile, end_mile, leg=leg_no))
            self.mile = end_mile
            self.drive_run += chunk
            self.break_run += chunk
            self.cycle += chunk

    def _clear_blocking_limit(self, fuel_room: float, cycle_room: int, drive_room: int, window_room: int) -> None:
        lim = self.limits
        if fuel_room <= 0:
            self._stationary(ON_DUTY, KIND_FUEL, lim.fuel_length)
        elif cycle_room <= 0:
            self._stationary(OFF_DUTY, KIND_RESTART, lim.restart_length, reason=notes.REASON_CYCLE)
        elif drive_room <= 0:
            self._stationary(SLEEPER, KIND_REST, lim.rest_length, reason=notes.REASON_DRIVING_LIMIT)
        elif window_room <= 0:
            self._stationary(SLEEPER, KIND_REST, lim.rest_length, reason=notes.REASON_WINDOW)
        else:
            self._stationary(OFF_DUTY, KIND_BREAK, lim.break_length)

    def _fuel_room(self, leg: DriveLeg, base_mile: float, driven: int) -> float:
        """Driving minutes left before the odometer would pass the fuel interval.

        Uses floor, so the truck stops a little short of 1,000 miles and never past it.
        """
        if leg.miles <= 0:
            return math.inf
        limit_mile = self.fuel_mile + self.limits.fuel_interval_miles
        per_minute = leg.miles / leg.minutes
        allowed = math.floor((limit_mile - base_mile) / per_minute + _EPS)
        # Float noise can overshoot by one minute. Walk back until the odometer is safe.
        while allowed > 0 and base_mile + leg.miles * allowed / leg.minutes > limit_mile + _EPS:
            allowed -= 1
        return allowed - driven

    def _stationary(self, status: str, kind: str, minutes: int, reason: str = "") -> None:
        start = self.t
        self.t += minutes
        self.segments.append(SimSegment(status, kind, start, self.t, self.mile, self.mile, reason=reason))
        if minutes >= self.limits.break_length:
            self.break_run = 0
        if status == ON_DUTY:
            self.cycle += minutes
        if kind == KIND_FUEL:
            self.fuel_mile = self.mile
        elif kind in (KIND_REST, KIND_RESTART):
            self.drive_run = 0
            self.window_start = self.t
            if kind == KIND_RESTART:
                self.cycle = 0

    def _tick(self) -> None:
        self.steps += 1
        if self.steps > MAX_STEPS:
            raise EngineError("The simulation did not finish. Check the route distances.")
