"""Daily log rules: midnight splits, remarks, miles and the recap."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from apps.planner.assemble import build_plan
from apps.planner.hos.logs import apportion, build_daily_logs, vehicle_text
from apps.planner.hos.models import SimSegment

from .helpers import day_entries, make_request, make_route


def plan_for(departure, cycle, leg1, leg2, osrm1=None, osrm2=None, **kwargs):
    return build_plan(make_request(departure=departure, cycle=cycle, **kwargs), make_route(leg1, leg2, osrm1, osrm2))


def hand_built_logs(spec, prior_minutes):
    """Daily logs from a timeline written out by hand, one (status, kind, minutes) per block.

    The truck covers one mile a minute while driving. Departure is midnight, so block
    boundaries and day boundaries line up with the arithmetic in the comments.
    """
    segments, minute, mile = [], 0, 0.0
    for status, kind, length in spec:
        miles = float(length) if kind == "drive" else 0.0
        segments.append(
            SimSegment(status, kind, minute, minute + length, mile, mile + miles, leg=1 if kind == "drive" else 0)
        )
        minute, mile = minute + length, mile + miles
    departure = datetime(2026, 10, 7, 0, 0, tzinfo=timezone(timedelta(hours=-5)))
    return build_daily_logs(tuple(segments), departure, lambda _mile: "Kearney, NE", prior_minutes, {}, mile)


def working_days(hours_per_day):
    """Each day: that many hours of driving, then the sleeper berth until midnight."""
    spec = []
    for hours in hours_per_day:
        spec += [("driving", "drive", hours * 60), ("sleeper", "rest", 1440 - hours * 60)]
    return spec


# --- apportion -----------------------------------------------------------------------------------


def test_apportion_adds_up_to_the_target():
    assert apportion([50.4, 50.4], 101) == [51, 50]
    assert apportion([10.0, 20.0, 30.0], 60) == [10, 20, 30]
    assert apportion([0.6, 0.6, 0.6], 2) == [1, 1, 0]
    assert apportion([99.9], 100) == [100]


def test_apportion_breaks_ties_toward_the_earlier_day():
    assert apportion([1.5, 1.5, 1.5, 1.5], 8) == [2, 2, 2, 2]
    assert apportion([1.25, 1.25, 1.25, 1.25], 6) == [2, 2, 1, 1]


@pytest.mark.parametrize("values", [[0.2, 0.2, 0.2], [100.5, 200.5, 300.5], [1e-12, 5.999999999999], [7.0]])
def test_apportion_never_misses_the_target(values):
    target = round(sum(values))
    assert sum(apportion(values, target)) == target


def test_vehicle_text():
    assert vehicle_text({}) == ""
    assert vehicle_text({"truck_number": "101"}) == "Truck 101"
    assert vehicle_text({"trailer_number": "T-9"}) == "Trailer T-9"
    assert vehicle_text({"truck_number": "101", "trailer_number": "202"}) == "Truck 101 / Trailer 202"


# --- midnight --------------------------------------------------------------------------------------


def test_a_drive_that_crosses_midnight_is_split_and_its_miles_follow_the_minutes():
    # Leaves 22:00, drives 300 min (300 mi): 120 min before midnight, 180 after.
    plan = plan_for("2026-10-07T22:00", 0, 300, 60, osrm1=290, osrm2=50)
    assert day_entries(plan, 1)[1] == ("driving", "drive", 1320, 1440)
    assert day_entries(plan, 2)[0] == ("driving", "drive", 0, 180)
    assert [log["total_miles_driving"] for log in plan["logs"]] == [120, 240]
    # One remark, on the day the drive began.
    assert [r["minute"] for r in plan["logs"][0]["remarks"]][:1] == [1320]
    assert plan["logs"][1]["remarks"][0]["minute"] == 180  # the pickup


def test_places_at_a_midnight_split_describe_where_the_truck_is_then():
    plan = plan_for("2026-10-07T22:00", 0, 300, 60, osrm1=290, osrm2=50)
    day_two_start = plan["logs"][1]["entries"][0]["place"]
    assert day_two_start == plan["logs"][1]["from_place"]
    assert plan["logs"][0]["to_place"] == day_two_start
    assert plan["logs"][0]["from_place"] == "Dallas, TX"


def test_every_sheet_is_a_full_24_hours_even_for_long_trips():
    plan = plan_for("2026-10-07T17:45", 40, 900, 2200)
    assert len(plan["logs"]) >= 5
    for log in plan["logs"]:
        assert log["entries"][0]["start_min"] == 0
        assert log["entries"][-1]["end_min"] == 1440
        assert sum(log["totals"].values()) == 1440
        for a, b in zip(log["entries"], log["entries"][1:], strict=False):
            assert b["start_min"] == a["end_min"]


def test_dates_and_day_numbers_count_up_from_the_departure_date():
    plan = plan_for("2026-12-30T08:00", 0, 900, 1500)
    assert [log["day"] for log in plan["logs"]] == list(range(1, len(plan["logs"]) + 1))
    assert [log["date"] for log in plan["logs"]][:4] == ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]


def test_departure_one_minute_before_midnight():
    plan = plan_for("2026-10-07T23:59", 0, 100, 100)
    assert day_entries(plan, 1) == [("off_duty", "idle", 0, 1439), ("driving", "drive", 1439, 1440)]
    assert day_entries(plan, 2)[0] == ("driving", "drive", 0, 99)


# --- miles -----------------------------------------------------------------------------------------


def test_daily_miles_add_up_to_the_rounded_trip_distance():
    plan = plan_for("2026-10-07T06:00", 0, 413.4, 1017.3)
    assert sum(log["total_miles_driving"] for log in plan["logs"]) == round(413.4 + 1017.3)
    assert all(isinstance(log["total_miles_driving"], int) for log in plan["logs"])


def test_days_without_driving_report_zero_miles():
    # Cycle is used up, so most of day 1 and day 2 are a restart.
    plan = plan_for("2026-10-07T06:00", 70, 100, 100)
    assert plan["logs"][0]["total_miles_driving"] == 0
    assert plan["logs"][0]["total_mileage_today"] == 0


# --- remarks ---------------------------------------------------------------------------------------


def test_one_remark_for_each_change_and_none_at_midnight_for_a_continuing_status():
    plan = plan_for("2026-10-07T14:00", 12, 500, 900, osrm1=480, osrm2=850)
    minutes_by_day = [[r["minute"] for r in log["remarks"]] for log in plan["logs"]]
    assert minutes_by_day == [[840, 1320, 1350, 1370, 1430], [150, 750, 1090, 1120], [0, 600, 680, 740]]
    for log in plan["logs"]:
        starts = {e["start_min"] for e in log["entries"]}
        assert {r["minute"] for r in log["remarks"]} <= starts


def test_remark_places_are_short_town_text():
    plan = plan_for("2026-10-07T06:00", 0, 450, 600)
    for log in plan["logs"]:
        for remark in log["remarks"]:
            assert remark["place"]
            assert "None" not in remark["place"]
            assert len(remark["place"]) < 60


def test_remarks_for_the_named_places_use_the_chosen_coordinates():
    plan = plan_for("2026-10-07T06:00", 0, 300, 300)
    first_day = plan["logs"][0]["remarks"]
    assert first_day[0]["place"] == "Dallas, TX"
    assert next(r for r in first_day if r["note"].startswith("Pickup"))["place"] == "Memphis, TN"
    last = plan["logs"][-1]["remarks"]
    assert next(r for r in last if r["note"].startswith("Dropoff"))["place"] == "Denver, CO"
    assert last[-1]["note"] == "Off duty"
    assert last[-1]["place"] == "Denver, CO"


# --- recap -----------------------------------------------------------------------------------------


def test_recap_adds_prior_hours_to_every_window_until_a_restart():
    plan = plan_for("2026-10-07T06:00", 20, 600, 600)
    # 20 h (1200 min) already used. Day 1 works 11 h driving + 1 h pickup = 720.
    recap = plan["logs"][0]["recap"]
    assert recap["on_duty_today_minutes"] == recap["a_minutes"] - 1200
    assert recap["c_minutes"] == recap["a_minutes"]
    assert recap["b_minutes"] == 4200 - recap["a_minutes"]


def test_recap_b_stops_at_zero_when_the_cycle_is_used_up_exactly():
    # 69.5 h used leaves 30 min of driving. The truck stops at 70 h on the dot (A = 4200),
    # and the 34-hour restart takes over before the rest of the leg.
    plan = plan_for("2026-10-07T06:00", 69.5, 50, 50)
    recap = plan["logs"][0]["recap"]
    assert recap["a_minutes"] == 4200
    assert recap["b_minutes"] == 0


def test_recap_b_is_clamped_when_on_duty_work_runs_past_70_hours():
    # Leg 1 takes the last 30 min of the cycle, then the pickup hour is on duty and is not
    # capped: A reaches 4170 + 30 + 60 = 4260 and B would be -60, so it reads 0.
    plan = plan_for("2026-10-07T06:00", 69.5, 30, 50)
    recap = plan["logs"][0]["recap"]
    assert recap["a_minutes"] == 4260
    assert recap["b_minutes"] == 0


def test_recap_a_looks_back_8_days_and_c_looks_back_7():
    # Day k drives k hours (1 to 10) with 5 hours (300 min) already in the cycle, no restart.
    # A on day n is 300 + the hours of the 8 days up to n. C uses the 7 days up to n.
    logs = hand_built_logs(working_days(range(1, 11)), prior_minutes=300)
    recap = [log["recap"] for log in logs]
    assert [(r["a_minutes"], r["c_minutes"]) for r in recap] == [
        (360, 360),  # day 1: 300 + 1 h
        (480, 480),  # day 2: 300 + 1 h + 2 h
        (660, 660),
        (900, 900),
        (1200, 1200),
        (1560, 1560),
        (1980, 1980),  # day 7: 300 + 28 h. C still has all 7 days
        (2460, 2400),  # day 8: A keeps day 1 (300 + 36 h), C drops it (300 + 35 h)
        (2940, 2820),  # day 9: A is days 2 to 9 (44 h), C is days 3 to 9 (42 h)
        (3420, 3240),  # day 10: A is days 3 to 10 (52 h), C is days 4 to 10 (49 h)
    ]
    assert [r["b_minutes"] for r in recap][-2:] == [1260, 780]  # 4200 minus A
    assert recap[9]["on_duty_today_minutes"] == 600


def test_recap_counts_nothing_before_the_34_hour_restart_ends():
    # Days 1 to 4 drive 1, 2, 3 and 4 hours. On day 4 the restart starts at 04:00 and lasts
    # 34 hours, so it ends on day 5 at 14:00. The driver then works 5 more hours on day 5, and
    # 6 and 7 hours on days 6 and 7.
    spec = working_days([1, 2, 3])
    spec += [("driving", "drive", 240), ("off_duty", "restart", 2040)]
    spec += [("driving", "drive", 300), ("sleeper", "rest", 1440 - 840 - 300)]
    spec += working_days([6, 7])
    logs = hand_built_logs(spec, prior_minutes=300)
    recap = [log["recap"] for log in logs]
    assert [r["restart_completed"] for r in recap] == [False, False, False, False, True, False, False]
    # Day 4 still counts everything: 300 + (1 + 2 + 3 + 4) h.
    assert recap[3]["a_minutes"] == 900
    # Day 5: the 5 hours after 14:00 are all that counts, the 300 minutes carried in are gone.
    assert (recap[4]["a_minutes"], recap[4]["c_minutes"], recap[4]["b_minutes"]) == (300, 300, 3900)
    assert recap[4]["on_duty_today_minutes"] == 300
    # Later days add to that start: 300 + 360, then 300 + 360 + 420.
    assert [r["a_minutes"] for r in recap[5:]] == [660, 1080]


def test_recap_stays_within_what_a_long_trip_can_hold():
    # A trip this long needs a restart. Afterwards the windows start over from zero.
    plan = plan_for("2026-10-07T06:00", 0, 2500, 2500)
    a = [log["recap"]["a_minutes"] for log in plan["logs"]]
    c = [log["recap"]["c_minutes"] for log in plan["logs"]]
    assert len(a) >= 8
    assert any(log["recap"]["restart_completed"] for log in plan["logs"])
    assert all(ci <= ai for ai, ci in zip(a, c, strict=True))
    # Driving stops at 70 hours. Only on-duty work, at most the last hour or two, can pass it.
    assert max(a) <= 4200 + 2 * 60


def test_recap_restart_day_counts_only_work_after_the_restart_ends():
    plan = plan_for("2026-10-07T06:00", 68.5, 300, 300, osrm1=280, osrm2=280)
    flags = [log["recap"]["restart_completed"] for log in plan["logs"]]
    assert flags == [False, True, False]
    assert plan["logs"][1]["recap"]["a_minutes"] == 390


def test_recap_when_the_restart_ends_exactly_at_midnight():
    # Cycle 68.5 h leaves 90 min of driving. Leaving at 05:00, the cycle runs out at 06:30
    # and the 34-hour restart ends 34 h later at 16:30 the next day. Pick a start so the
    # restart ends on midnight: 06:30 + 34 h = 16:30. Use departure 15:30 minus nothing:
    # drive 90 min to 17:00, restart ends 03:00 two days on. Instead aim for 00:00 directly:
    # depart 14:00 - 90 min drive -> 15:30, restart ends 01:30. Not midnight.
    # Departing at 21:30 - 34 h cannot work with a 90-minute drive, so use cycle 70 (no drive).
    # Restart from 14:00 lasts 34 h and ends at 00:00 two days later.
    plan = plan_for("2026-10-07T14:00", 70, 100, 100)
    ends_at = plan["segments"][0]["end_at"]
    assert ends_at == "2026-10-09T00:00:00-05:00"
    recaps = [log["recap"] for log in plan["logs"]]
    assert [r["restart_completed"] for r in recaps][:2] == [False, True]
    # The restart ends on the last minute of day 2, so nothing has been counted since.
    assert recaps[1]["a_minutes"] == 0
    assert recaps[1]["b_minutes"] == 4200
    assert recaps[2]["a_minutes"] == recaps[2]["on_duty_today_minutes"]


def test_recap_on_duty_today_is_lines_three_and_four():
    plan = plan_for("2026-10-07T06:00", 0, 300, 300)
    log = plan["logs"][0]
    assert log["recap"]["on_duty_today_minutes"] == log["totals"]["driving"] + log["totals"]["on_duty"]


def test_header_is_copied_to_every_sheet():
    header = {
        "driver_name": "Ana Reyes",
        "truck_number": "101",
        "trailer_number": "202",
        "carrier_name": "Reyes Freight",
    }
    plan = plan_for("2026-10-07T06:00", 0, 900, 900, header=header)
    for log in plan["logs"]:
        assert log["header"]["driver_name"] == "Ana Reyes"
        assert log["header"]["co_driver_name"] == ""
        assert log["vehicle"] == "Truck 101 / Trailer 202"
    assert len({id(log["header"]) for log in plan["logs"]}) == len(plan["logs"])
