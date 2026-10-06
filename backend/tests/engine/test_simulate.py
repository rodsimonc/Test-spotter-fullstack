"""Table tests for each limit in the simulator, one rule at a time.

A leg is `DriveLeg(miles, minutes)`. With miles equal to minutes the truck does one mile a
minute. To look at one rule alone, the other limits are pushed far away with `loose()`.
"""

from __future__ import annotations

import pytest

from apps.planner.hos import simulate as sim_module
from apps.planner.hos.constants import DEFAULT_LIMITS, Limits
from apps.planner.hos.models import DriveLeg, EngineError
from apps.planner.hos.simulate import drive_minutes, simulate

NONE = DriveLeg(0.0, 0)
HUGE = 10**7


def leg(minutes: int, miles: float | None = None) -> DriveLeg:
    return DriveLeg(float(minutes) if miles is None else miles, minutes)


def loose(**overrides) -> Limits:
    """Default limits with every rule except the overridden ones moved out of reach."""
    base = {
        "max_driving": HUGE,
        "window": HUGE,
        "break_after_driving": HUGE,
        "cycle": HUGE,
        "fuel_interval_miles": 1e12,
    }
    base.update(overrides)
    return Limits(**base)


FUEL_ONLY = loose(fuel_interval_miles=1000.0)


def summarize(result) -> list[tuple]:
    return [(s.kind, s.start_min, s.end_min, round(s.start_mile, 3), round(s.end_mile, 3)) for s in result.segments]


# --- drive_minutes -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("miles", "osrm", "expected"),
    [
        (60.0, 30.0, 60),  # 60 mph floor beats a fast router
        (60.0, 75.0, 75),  # a slow router wins
        (450.0, 0.0, 450),
        (100.5, 90.0, 101),  # rounds up, so the truck never exceeds 60 mph
        (100.0, 100.0 + 1e-12, 100),  # float noise does not cost a minute
        (0.01, 0.0, 1),  # any real distance takes a minute
        (0.0, 0.0, 0),
        (0.0, 0.4, 1),
        (1000.0, 1200.0, 1200),
    ],
)
def test_drive_minutes(miles, osrm, expected):
    assert drive_minutes(miles, osrm) == expected


@pytest.mark.parametrize("miles, osrm", [(-1.0, 5.0), (5.0, -1.0), (float("nan"), 1.0), (1.0, float("inf"))])
def test_drive_minutes_rejects_nonsense(miles, osrm):
    with pytest.raises(EngineError):
        drive_minutes(miles, osrm)


# --- 8-hour break --------------------------------------------------------------------------------


def test_break_after_eight_hours_of_driving():
    result = simulate(leg(500), NONE, 0)
    assert summarize(result) == [
        ("drive", 0, 480, 0.0, 480.0),
        ("break", 480, 510, 480.0, 480.0),
        ("drive", 510, 530, 480.0, 500.0),
        ("pickup", 530, 590, 500.0, 500.0),
        ("dropoff", 590, 650, 500.0, 500.0),
    ]
    assert result.segments[1].status == "off_duty"


def test_no_break_when_driving_ends_exactly_at_eight_hours():
    result = simulate(leg(480), NONE, 0)
    assert [s.kind for s in result.segments] == ["drive", "pickup", "dropoff"]


def test_one_minute_over_eight_hours_needs_a_break():
    result = simulate(leg(481), NONE, 0)
    assert [s.kind for s in result.segments] == ["drive", "break", "drive", "pickup", "dropoff"]
    assert result.segments[2].minutes == 1


def test_pickup_counts_as_the_break_and_resets_the_clock():
    # 400 + 400 min of driving. Each stretch is under 480 and the pickup sits between them.
    result = simulate(leg(400), leg(400), 0, loose(max_driving=HUGE))
    assert [s.kind for s in result.segments] == ["drive", "pickup", "drive", "dropoff"]


def test_fuel_stop_counts_as_the_break():
    # Fuel every 470 miles. After 470 min the 30-minute fuel stop resets the 480 min clock,
    # so the remaining 130 min of driving needs no break.
    limits = Limits(max_driving=HUGE, window=HUGE, cycle=HUGE, fuel_interval_miles=470.0)
    result = simulate(leg(600), NONE, 0, limits)
    assert [s.kind for s in result.segments] == ["drive", "fuel", "drive", "pickup", "dropoff"]
    assert summarize(result)[:3] == [
        ("drive", 0, 470, 0.0, 470.0),
        ("fuel", 470, 500, 470.0, 470.0),
        ("drive", 500, 630, 470.0, 600.0),
    ]


def test_short_fuel_stop_does_not_count_as_a_break():
    # A 10-minute fuel stop is not a 30-minute gap, so the break clock keeps running.
    limits = Limits(max_driving=HUGE, window=HUGE, cycle=HUGE, fuel_interval_miles=470.0, fuel_length=10)
    result = simulate(leg(600), NONE, 0, limits)
    assert [s.kind for s in result.segments] == ["drive", "fuel", "drive", "break", "drive", "pickup", "dropoff"]


# --- 11-hour driving limit -----------------------------------------------------------------------


def test_rest_after_eleven_hours_of_driving():
    result = simulate(leg(700), NONE, 0)
    assert summarize(result) == [
        ("drive", 0, 480, 0.0, 480.0),
        ("break", 480, 510, 480.0, 480.0),
        ("drive", 510, 690, 480.0, 660.0),
        ("rest", 690, 1290, 660.0, 660.0),
        ("drive", 1290, 1330, 660.0, 700.0),
        ("pickup", 1330, 1390, 700.0, 700.0),
        ("dropoff", 1390, 1450, 700.0, 700.0),
    ]
    rest = result.segments[3]
    assert (rest.status, rest.reason) == ("sleeper", "driving_limit")


def test_the_rest_resets_the_break_clock():
    # 400 min, rest, then 400 more minutes. The rest is a gap longer than 30 minutes.
    result = simulate(leg(800), NONE, 0, loose(max_driving=660))
    kinds = [s.kind for s in result.segments]
    assert kinds == ["drive", "rest", "drive", "pickup", "dropoff"]
    assert [s.minutes for s in result.segments[:3]] == [660, 600, 140]


def test_exactly_eleven_hours_total_needs_no_rest():
    result = simulate(leg(330), leg(330), 0)
    assert [s.kind for s in result.segments] == ["drive", "pickup", "drive", "dropoff"]


def test_driving_limit_is_shared_across_both_legs():
    result = simulate(leg(400), leg(400), 0)
    assert [s.kind for s in result.segments] == ["drive", "pickup", "drive", "rest", "drive", "dropoff"]
    assert [s.minutes for s in result.segments if s.kind == "drive"] == [400, 260, 140]


# --- 14-hour window ------------------------------------------------------------------------------
# With a 1-hour pickup and 30-minute fuel and break stops the real 14-hour window can never
# bind before the 11-hour limit does (the most one window holds before the dropoff is 13 hours).
# These tests shrink the window so the code path runs.


def test_window_forces_a_rest_before_the_driving_limit():
    result = simulate(leg(400), NONE, 0, loose(window=300))
    assert summarize(result)[:3] == [
        ("drive", 0, 300, 0.0, 300.0),
        ("rest", 300, 900, 300.0, 300.0),
        ("drive", 900, 1000, 300.0, 400.0),
    ]
    assert result.segments[1].reason == "window"


def test_window_keeps_running_through_non_driving_time():
    # Window of 200 min. Drive 100, pickup 60, then only 40 min of window are left.
    result = simulate(leg(100), leg(100), 0, loose(window=200))
    assert summarize(result) == [
        ("drive", 0, 100, 0.0, 100.0),
        ("pickup", 100, 160, 100.0, 100.0),
        ("drive", 160, 200, 100.0, 140.0),
        ("rest", 200, 800, 140.0, 140.0),
        ("drive", 800, 860, 140.0, 200.0),
        ("dropoff", 860, 920, 200.0, 200.0),
    ]


def test_a_pickup_that_starts_with_no_window_left_still_takes_its_full_hour():
    result = simulate(leg(300), leg(50), 0, loose(window=300))
    assert summarize(result) == [
        ("drive", 0, 300, 0.0, 300.0),
        ("pickup", 300, 360, 300.0, 300.0),  # runs past the window
        ("rest", 360, 960, 300.0, 300.0),
        ("drive", 960, 1010, 300.0, 350.0),
        ("dropoff", 1010, 1070, 350.0, 350.0),
    ]


def test_window_restarts_when_the_rest_ends():
    result = simulate(leg(700), NONE, 0, loose(window=300))
    drives = [s.minutes for s in result.segments if s.kind == "drive"]
    assert drives == [300, 300, 100]


def test_real_window_never_binds_before_the_driving_limit():
    # The longest window the default rules allow before the dropoff is 780 minutes.
    result = simulate(leg(330), leg(2000), 0)
    for seg in result.segments:
        if seg.kind == "rest":
            assert seg.reason == "driving_limit"


# --- 70-hour cycle and the 34-hour restart ---------------------------------------------------------


def test_restart_when_the_cycle_runs_out_mid_leg():
    # 4100 min used, so 100 min of driving left.
    result = simulate(leg(300), NONE, 4100)
    assert summarize(result) == [
        ("drive", 0, 100, 0.0, 100.0),
        ("restart", 100, 2140, 100.0, 100.0),
        ("drive", 2140, 2340, 100.0, 300.0),
        ("pickup", 2340, 2400, 300.0, 300.0),
        ("dropoff", 2400, 2460, 300.0, 300.0),
    ]
    assert result.segments[1].status == "off_duty"
    assert result.cycle_end_minutes == 200 + 60 + 60  # driving after the restart, pickup, dropoff


def test_on_duty_work_may_run_past_70_hours():
    # Cycle 4190: 10 min of driving gets to 4200. The pickup still happens (to 4260),
    # and the restart goes in before the next driving.
    result = simulate(leg(10), leg(50), 4190)
    assert summarize(result) == [
        ("drive", 0, 10, 0.0, 10.0),
        ("pickup", 10, 70, 10.0, 10.0),
        ("restart", 70, 2110, 10.0, 10.0),
        ("drive", 2110, 2160, 10.0, 60.0),
        ("dropoff", 2160, 2220, 60.0, 60.0),
    ]


def test_cycle_at_exactly_seventy_hours_restarts_before_any_driving():
    result = simulate(leg(100), NONE, 4200)
    assert [s.kind for s in result.segments] == ["restart", "drive", "pickup", "dropoff"]
    assert result.segments[0].start_min == 0


def test_cycle_one_minute_short_of_seventy_still_drives_one_minute():
    result = simulate(leg(100), NONE, 4199)
    assert [(s.kind, s.minutes) for s in result.segments] == [
        ("drive", 1),
        ("restart", 2040),
        ("drive", 99),
        ("pickup", 60),
        ("dropoff", 60),
    ]


def test_cycle_above_seventy_hours_restarts_first():
    result = simulate(leg(100), NONE, 5000)
    assert result.segments[0].kind == "restart"
    assert result.cycle_end_minutes == 100 + 60 + 60


def test_exhausted_cycle_with_no_deadhead_restarts_before_the_pickup():
    result = simulate(NONE, leg(100), 4200)
    assert [s.kind for s in result.segments] == ["restart", "pickup", "drive", "dropoff"]


def test_restart_clears_the_driving_and_window_clocks():
    # Drive 300 min, cycle runs out, restart, then 300 more minutes need no rest even
    # though 600 min of driving in total is close to the 660 limit and the window is short.
    limits = Limits(window=400)
    result = simulate(leg(600), NONE, 4200 - 300, limits)
    assert [s.kind for s in result.segments] == ["drive", "restart", "drive", "pickup", "dropoff"]


# --- fuel ------------------------------------------------------------------------------------------


def test_fuel_stop_every_thousand_miles():
    result = simulate(leg(2500), NONE, 0, FUEL_ONLY)
    assert summarize(result) == [
        ("drive", 0, 1000, 0.0, 1000.0),
        ("fuel", 1000, 1030, 1000.0, 1000.0),
        ("drive", 1030, 2030, 1000.0, 2000.0),
        ("fuel", 2030, 2060, 2000.0, 2000.0),
        ("drive", 2060, 2560, 2000.0, 2500.0),
        ("pickup", 2560, 2620, 2500.0, 2500.0),
        ("dropoff", 2620, 2680, 2500.0, 2500.0),
    ]
    assert all(s.status == "on_duty" for s in result.segments if s.kind == "fuel")


def test_exactly_a_thousand_miles_needs_no_fuel_stop():
    result = simulate(leg(400), leg(600), 0, FUEL_ONLY)
    assert "fuel" not in [s.kind for s in result.segments]


def test_a_thousand_and_one_miles_needs_one_fuel_stop():
    result = simulate(leg(400), leg(601), 0, FUEL_ONLY)
    assert [s.kind for s in result.segments].count("fuel") == 1


def test_fuel_due_at_the_pickup_is_taken_after_loading():
    result = simulate(leg(1000), leg(100), 0, FUEL_ONLY)
    assert summarize(result) == [
        ("drive", 0, 1000, 0.0, 1000.0),
        ("pickup", 1000, 1060, 1000.0, 1000.0),
        ("fuel", 1060, 1090, 1000.0, 1000.0),
        ("drive", 1090, 1190, 1000.0, 1100.0),
        ("dropoff", 1190, 1250, 1100.0, 1100.0),
    ]


def test_fuel_uses_floor_so_the_odometer_never_passes_a_thousand():
    # 1,500 mi in 1,700 min is 0.88235 mi per minute. 1,133 min reaches 999.7 mi,
    # and a 1,134th minute would pass 1,000, so the stop comes after minute 1,133.
    result = simulate(leg(1700, miles=1500.0), NONE, 0, FUEL_ONLY)
    first_drive, fuel = result.segments[0], result.segments[1]
    assert (first_drive.minutes, fuel.kind) == (1133, "fuel")
    assert fuel.start_mile == pytest.approx(999.7059, abs=1e-3)
    assert fuel.start_mile <= 1000.0


def test_miles_since_fuel_never_exceed_the_interval_on_awkward_speeds():
    for miles, minutes in [(1234.5, 1500), (3000.0, 3001), (777.7, 800), (4999.9, 5600)]:
        result = simulate(leg(minutes, miles=miles), leg(minutes, miles=miles), 0, FUEL_ONLY)
        last = 0.0
        for seg in result.segments:
            if seg.kind == "fuel":
                assert seg.start_mile - last <= 1000.0 + 1e-9
                last = seg.start_mile
        assert result.segments[-1].end_mile - last <= 1000.0 + 1e-9


def test_a_leg_with_miles_but_no_fuel_room_left_never_drives_past_the_limit():
    # Fuel interval smaller than one minute of driving: the guard must raise, not loop.
    with pytest.raises(EngineError):
        simulate(leg(10), NONE, 0, loose(fuel_interval_miles=0.5))


# --- priorities when limits collide ----------------------------------------------------------------


def test_fuel_comes_first_and_then_the_restart_clears_everything():
    # At minute 600 the break, driving, window, cycle and fuel limits all hit together.
    limits = Limits(break_after_driving=600, max_driving=600, window=600, cycle=600, fuel_interval_miles=600.0)
    result = simulate(leg(700), NONE, 0, limits)
    assert [(s.kind, s.minutes) for s in result.segments][:4] == [
        ("drive", 600),
        ("fuel", 30),
        ("restart", 2040),
        ("drive", 100),
    ]


def test_fuel_comes_before_the_rest_and_a_rest_covers_the_break():
    limits = Limits(break_after_driving=600, max_driving=600, window=600, cycle=HUGE, fuel_interval_miles=600.0)
    result = simulate(leg(700), NONE, 0, limits)
    assert [(s.kind, s.minutes) for s in result.segments][:4] == [
        ("drive", 600),
        ("fuel", 30),
        ("rest", 600),
        ("drive", 100),
    ]


def test_rest_beats_the_break_when_both_are_due():
    limits = Limits(break_after_driving=600, max_driving=600, window=HUGE, cycle=HUGE, fuel_interval_miles=1e12)
    result = simulate(leg(700), NONE, 0, limits)
    assert [s.kind for s in result.segments][:3] == ["drive", "rest", "drive"]
    assert "break" not in [s.kind for s in result.segments]


# --- shape of the output ----------------------------------------------------------------------------


def test_zero_length_legs_are_skipped_but_pickup_and_dropoff_still_happen():
    assert [s.kind for s in simulate(NONE, NONE, 0).segments] == ["pickup", "dropoff"]
    assert [s.kind for s in simulate(NONE, leg(30), 0).segments] == ["pickup", "drive", "dropoff"]
    assert [s.kind for s in simulate(leg(30), NONE, 0).segments] == ["drive", "pickup", "dropoff"]


def test_segments_are_contiguous_with_positive_length():
    result = simulate(leg(900), leg(1400), 1500)
    assert result.segments[0].start_min == 0
    for a, b in zip(result.segments, result.segments[1:], strict=False):
        assert b.start_min == a.end_min
        assert b.start_mile == a.end_mile
    assert all(s.minutes > 0 for s in result.segments)
    assert result.total_minutes == result.segments[-1].end_min


def test_drive_segments_carry_their_leg_number():
    result = simulate(leg(100), leg(100), 0)
    assert [(s.kind, s.leg) for s in result.segments] == [("drive", 1), ("pickup", 0), ("drive", 2), ("dropoff", 0)]


def test_leg_two_starts_at_the_end_of_leg_one_in_miles():
    result = simulate(DriveLeg(123.4, 130), DriveLeg(50.6, 60), 0)
    pickup = next(s for s in result.segments if s.kind == "pickup")
    assert pickup.start_mile == 123.4
    assert result.segments[-1].end_mile == pytest.approx(174.0)


def test_negative_cycle_is_rejected():
    with pytest.raises(EngineError):
        simulate(leg(10), NONE, -1)


def test_step_cap_raises_instead_of_hanging(monkeypatch):
    monkeypatch.setattr(sim_module, "MAX_STEPS", 3)
    with pytest.raises(EngineError):
        simulate(leg(5000), NONE, 0)


def test_default_limits_match_the_rule_book():
    d = DEFAULT_LIMITS
    assert (d.max_driving, d.window, d.break_after_driving, d.break_length) == (660, 840, 480, 30)
    assert (d.rest_length, d.cycle, d.restart_length) == (600, 4200, 2040)
    assert (d.fuel_interval_miles, d.fuel_length, d.pickup_length, d.dropoff_length) == (1000.0, 30, 60, 60)
