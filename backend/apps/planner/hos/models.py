"""Plain data the simulation produces. No Django, no I/O."""

from __future__ import annotations

from dataclasses import dataclass


class EngineError(Exception):
    """The planner could not build a plan from these inputs."""


@dataclass(frozen=True)
class DriveLeg:
    """One driving leg as the simulation sees it."""

    miles: float
    #: Whole minutes of driving, already floored at 60 mph.
    minutes: int


@dataclass(frozen=True)
class SimSegment:
    """A block of time with one duty status. Times are minutes after departure."""

    status: str
    kind: str
    start_min: int
    end_min: int
    start_mile: float
    end_mile: float
    #: 1 for the drive to the pickup, 2 for the loaded drive. 0 for everything else.
    leg: int = 0
    #: Why a rest, break or restart was inserted. Empty for everything else.
    reason: str = ""

    @property
    def minutes(self) -> int:
        return self.end_min - self.start_min


@dataclass(frozen=True)
class SimResult:
    segments: tuple[SimSegment, ...]
    #: Minutes counted in the 70-hour cycle at the end of the trip, since the last restart.
    cycle_end_minutes: int

    @property
    def total_minutes(self) -> int:
        return self.segments[-1].end_min if self.segments else 0
