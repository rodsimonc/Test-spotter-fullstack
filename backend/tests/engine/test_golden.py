"""Hand-worked trips, asserted to the minute.

Every number below was worked out on paper first, from the rules in docs/hos-rules.md.
Unless a test says otherwise the truck drives exactly one mile per minute (60 mph), the
router reports a shorter time than that, and the zone is America/Chicago on dates that
sit in daylight time (UTC-05:00).

Row format: (kind, start, end, start_mile, end_mile).
"""

from __future__ import annotations

from apps.planner.assemble import build_plan

from .compliance import Expect, check_plan
from .helpers import day_entries, make_request, make_route, rows


def run(
    departure: str,
    cycle: float,
    leg1: float,
    leg2: float,
    osrm1: float | None = None,
    osrm2: float | None = None,
    **kwargs,
):
    req = make_request(departure=departure, cycle=cycle, **kwargs)
    route = make_route(leg1, leg2, osrm1, osrm2)
    plan = build_plan(req, route)
    expect = Expect(
        leg_miles=(leg1, leg2),
        osrm_minutes=(route.legs[0].osrm_duration_minutes, route.legs[1].osrm_duration_minutes),
        cycle_used_hours=cycle,
        departure=departure,
        timezone=req.timezone,
        header=kwargs.get("header") or {},
    )
    assert check_plan(plan, expect) == []
    return plan


def remarks(plan: dict, day: int) -> list[tuple[int, str]]:
    return [(r["minute"], r["note"]) for r in plan["logs"][day - 1]["remarks"]]


def totals(plan: dict, day: int) -> tuple[int, int, int, int]:
    t = plan["logs"][day - 1]["totals"]
    return t["off_duty"], t["sleeper"], t["driving"], t["on_duty"]


def test_golden_1_short_single_day():
    """90 mi to the pickup, 150 mi to the dropoff, cycle 10 h, leaves 08:00.

    Leg 1: OSRM says 100 min, 90 mi at 60 mph is 90 min, so 100 min wins.
    Leg 2: OSRM says 140 min, 150 mi at 60 mph is 150 min, so 150 min wins.

    08:00 drive 100 min          -> 09:40 (mile 90)
    09:40 pickup 60 min          -> 10:40
    10:40 drive 150 min          -> 13:10 (mile 240)
    13:10 dropoff 60 min         -> 14:10
    Nothing hits a limit: 250 min of driving, 8 h break clock peaks at 150 min.

    Day 1 in minutes after midnight: off duty 0-480, driving 480-580, on duty 580-640,
    driving 640-790, on duty 790-850, off duty 850-1440.
    Recap: on duty today 250 + 120 = 370. A = 10 h (600) + 370 = 970. B = 4200 - 970 = 3230.
    """
    plan = run("2026-10-07T08:00", 10, 90, 150, osrm1=100, osrm2=140)

    assert rows(plan) == [
        ("drive", "2026-10-07 08:00", "2026-10-07 09:40", 0.0, 90.0),
        ("pickup", "2026-10-07 09:40", "2026-10-07 10:40", 90.0, 90.0),
        ("drive", "2026-10-07 10:40", "2026-10-07 13:10", 90.0, 240.0),
        ("dropoff", "2026-10-07 13:10", "2026-10-07 14:10", 240.0, 240.0),
    ]
    assert day_entries(plan, 1) == [
        ("off_duty", "idle", 0, 480),
        ("driving", "drive", 480, 580),
        ("on_duty", "pickup", 580, 640),
        ("driving", "drive", 640, 790),
        ("on_duty", "dropoff", 790, 850),
        ("off_duty", "idle", 850, 1440),
    ]
    assert totals(plan, 1) == (1070, 0, 250, 120)
    assert remarks(plan, 1) == [
        (480, "Departed, driving to pickup"),
        (580, "Pickup, loading (1 hr)"),
        (640, "Left pickup, driving to dropoff"),
        (790, "Dropoff, unloading (1 hr)"),
        (850, "Off duty"),
    ]
    log = plan["logs"][0]
    assert log["recap"] == {
        "on_duty_today_minutes": 370,
        "a_minutes": 970,
        "b_minutes": 3230,
        "c_minutes": 970,
        "restart_completed": False,
    }
    assert (log["total_miles_driving"], log["total_mileage_today"]) == (240, 240)
    assert (log["from_place"], log["to_place"]) == ("Dallas, TX", "Denver, CO")

    summary = plan["summary"]
    assert summary["distance_miles"] == 240.0
    assert (summary["driving_minutes"], summary["on_duty_minutes"], summary["elapsed_minutes"]) == (250, 370, 370)
    assert (summary["fuel_stops"], summary["breaks"], summary["rests"], summary["restarts"], summary["days"]) == (
        0,
        0,
        0,
        0,
        1,
    )
    assert summary["depart_at"] == "2026-10-07T08:00:00-05:00"
    assert summary["arrive_at"] == "2026-10-07T14:10:00-05:00"
    assert summary["cycle_used_end_hours"] == 16.17  # 970 min
    assert [leg["duration_minutes"] for leg in summary["legs"]] == [100, 150]
    assert [leg["osrm_duration_minutes"] for leg in summary["legs"]] == [100, 140]
    assert plan["warnings"] == []
    assert [(s["id"], s["kind"], s["mile"], s["place"]) for s in plan["stops"]] == [
        ("start", "start", 0.0, "Dallas, TX"),
        ("pickup", "pickup", 90.0, "Memphis, TN"),
        ("dropoff", "dropoff", 240.0, "Denver, CO"),
        ("end", "end", 240.0, "Denver, CO"),
    ]


def test_golden_2a_exactly_eleven_hours_of_driving_needs_no_rest():
    """330 mi then 330 mi, leaves 06:00, cycle 0.

    Driving is 330 + 330 = 660 min, exactly the 11-hour limit, reached at the last minute
    of the trip. A rest is only needed before more driving, so none is inserted.
    Each stretch is 330 min, under the 480 min break clock, and the pickup resets it anyway.

    06:00 drive 330 -> 11:30; pickup -> 12:30; drive 330 -> 18:00; dropoff -> 19:00.
    The window is 13 h long at the end, inside 14 h.
    """
    plan = run("2026-10-07T06:00", 0, 330, 330, osrm1=300, osrm2=330)

    assert rows(plan) == [
        ("drive", "2026-10-07 06:00", "2026-10-07 11:30", 0.0, 330.0),
        ("pickup", "2026-10-07 11:30", "2026-10-07 12:30", 330.0, 330.0),
        ("drive", "2026-10-07 12:30", "2026-10-07 18:00", 330.0, 660.0),
        ("dropoff", "2026-10-07 18:00", "2026-10-07 19:00", 660.0, 660.0),
    ]
    assert totals(plan, 1) == (660, 0, 660, 120)
    summary = plan["summary"]
    assert (summary["rests"], summary["breaks"], summary["days"], summary["elapsed_minutes"]) == (0, 0, 1, 780)
    assert plan["logs"][0]["recap"]["a_minutes"] == 780


def test_golden_2b_one_minute_over_eleven_hours_forces_a_rest():
    """Same trip with 331 mi on the second leg.

    After 330 + 330 = 660 min the 11-hour limit is used up with 1 min of driving left.
    06:00 drive 330 -> 11:30; pickup -> 12:30; drive 330 -> 18:00 (mile 660);
    rest 600 min in the sleeper berth -> 04:00 next day; drive 1 min -> 04:01 (mile 661);
    dropoff -> 05:01. Elapsed 330 + 60 + 330 + 600 + 1 + 60 = 1381 min.

    Day 1 (minutes): off duty 0-360, driving 360-690, on duty 690-750, driving 750-1080,
    sleeper 1080-1440. Day 2: sleeper 0-240, driving 240-241, on duty 241-301, off duty 301-1440.
    """
    plan = run("2026-10-07T06:00", 0, 330, 331, osrm1=300, osrm2=331)

    assert rows(plan) == [
        ("drive", "2026-10-07 06:00", "2026-10-07 11:30", 0.0, 330.0),
        ("pickup", "2026-10-07 11:30", "2026-10-07 12:30", 330.0, 330.0),
        ("drive", "2026-10-07 12:30", "2026-10-07 18:00", 330.0, 660.0),
        ("rest", "2026-10-07 18:00", "2026-10-08 04:00", 660.0, 660.0),
        ("drive", "2026-10-08 04:00", "2026-10-08 04:01", 660.0, 661.0),
        ("dropoff", "2026-10-08 04:01", "2026-10-08 05:01", 661.0, 661.0),
    ]
    assert day_entries(plan, 1) == [
        ("off_duty", "idle", 0, 360),
        ("driving", "drive", 360, 690),
        ("on_duty", "pickup", 690, 750),
        ("driving", "drive", 750, 1080),
        ("sleeper", "rest", 1080, 1440),
    ]
    assert day_entries(plan, 2) == [
        ("sleeper", "rest", 0, 240),
        ("driving", "drive", 240, 241),
        ("on_duty", "dropoff", 241, 301),
        ("off_duty", "idle", 301, 1440),
    ]
    assert totals(plan, 1) == (360, 360, 660, 60)
    assert totals(plan, 2) == (1139, 240, 1, 60)
    assert [plan["logs"][i]["total_miles_driving"] for i in (0, 1)] == [660, 1]
    # The rest began on day 1, so day 2 opens mid-rest with no remark at minute 0.
    assert remarks(plan, 1)[-1] == (1080, "10-hour rest, sleeper berth")
    assert remarks(plan, 2) == [
        (240, "Driving to dropoff"),
        (241, "Dropoff, unloading (1 hr)"),
        (301, "Off duty"),
    ]
    assert [log["recap"]["a_minutes"] for log in plan["logs"]] == [720, 781]
    assert plan["summary"]["arrive_at"] == "2026-10-08T05:01:00-05:00"


def test_golden_3_late_pickup_runs_a_full_hour_with_20_minutes_of_driving_left():
    """640 mi deadhead, 300 mi loaded, leaves 06:00, cycle 0.

    06:00 drive 480 -> 14:00 (mile 480): the 8-hour break clock is up.
    14:00 break 30 -> 14:30.
    14:30 drive 160 -> 17:10 (mile 640): 640 min driven, so 20 min remain on the 11-hour clock.
    17:10 pickup 60 -> 18:10. The window has used 480 + 30 + 160 + 60 = 730 min, 110 min left,
          so the 11-hour limit binds first, not the 14-hour window.
    18:10 drive 20 -> 18:30 (mile 660): 11 hours of driving done.
    18:30 rest 600 -> 04:30 next day.
    04:30 drive 280 -> 09:10 (mile 940). 09:10 dropoff -> 10:10. Elapsed 1690 min.

    Day 1 totals: off 360 + 30, sleeper 330, driving 480 + 160 + 20 = 660, on duty 60.
    """
    plan = run("2026-10-07T06:00", 0, 640, 300, osrm1=600, osrm2=280)

    assert rows(plan) == [
        ("drive", "2026-10-07 06:00", "2026-10-07 14:00", 0.0, 480.0),
        ("break", "2026-10-07 14:00", "2026-10-07 14:30", 480.0, 480.0),
        ("drive", "2026-10-07 14:30", "2026-10-07 17:10", 480.0, 640.0),
        ("pickup", "2026-10-07 17:10", "2026-10-07 18:10", 640.0, 640.0),
        ("drive", "2026-10-07 18:10", "2026-10-07 18:30", 640.0, 660.0),
        ("rest", "2026-10-07 18:30", "2026-10-08 04:30", 660.0, 660.0),
        ("drive", "2026-10-08 04:30", "2026-10-08 09:10", 660.0, 940.0),
        ("dropoff", "2026-10-08 09:10", "2026-10-08 10:10", 940.0, 940.0),
    ]
    assert day_entries(plan, 1) == [
        ("off_duty", "idle", 0, 360),
        ("driving", "drive", 360, 840),
        ("off_duty", "break", 840, 870),
        ("driving", "drive", 870, 1030),
        ("on_duty", "pickup", 1030, 1090),
        ("driving", "drive", 1090, 1110),
        ("sleeper", "rest", 1110, 1440),
    ]
    assert totals(plan, 1) == (390, 330, 660, 60)
    assert totals(plan, 2) == (830, 270, 280, 60)
    assert [plan["logs"][i]["total_miles_driving"] for i in (0, 1)] == [660, 280]
    assert plan["summary"]["elapsed_minutes"] == 1690
    assert plan["summary"]["arrive_at"] == "2026-10-08T10:10:00-05:00"


def test_golden_4_thousand_mile_fuel_stop():
    """400 mi to the pickup, 700 mi loaded (1,100 mi total), cycle 10 h, leaves 05:00.

    05:00 drive 400 -> 11:40 (mile 400); pickup -> 12:40 (the pickup resets the break clock).
    12:40 drive: limits are 260 min of driving left (660 - 400), 600 miles to fuel, so 260
          -> 17:00 (mile 660). 11 hours done: rest 600 -> 03:00 next day.
    03:00 drive: fuel is 340 mi away (1000 - 660), the leg has 440 left, so 340
          -> 08:40 (mile 1000). Fuel stop 30 -> 09:10 (on duty, counts as the break).
    09:10 drive the last 100 -> 10:50 (mile 1100). Dropoff -> 11:50. Elapsed 1850 min.

    Cycle at the end: 600 + 1100 driving + 60 + 30 + 60 on duty = 1850 min = 30.83 h.
    Day 1: off 0-300, driving 300-700, on duty 700-760, driving 760-1020, sleeper 1020-1440.
    Day 2: sleeper 0-180, driving 180-520, on duty 520-550, driving 550-650, on duty 650-710, off 710-1440.
    Recap day 1: on duty 720, A = 600 + 720 = 1320. Day 2: on duty 530, A = 1850.
    """
    plan = run("2026-10-07T05:00", 10, 400, 700, osrm1=380, osrm2=690)

    assert rows(plan) == [
        ("drive", "2026-10-07 05:00", "2026-10-07 11:40", 0.0, 400.0),
        ("pickup", "2026-10-07 11:40", "2026-10-07 12:40", 400.0, 400.0),
        ("drive", "2026-10-07 12:40", "2026-10-07 17:00", 400.0, 660.0),
        ("rest", "2026-10-07 17:00", "2026-10-08 03:00", 660.0, 660.0),
        ("drive", "2026-10-08 03:00", "2026-10-08 08:40", 660.0, 1000.0),
        ("fuel", "2026-10-08 08:40", "2026-10-08 09:10", 1000.0, 1000.0),
        ("drive", "2026-10-08 09:10", "2026-10-08 10:50", 1000.0, 1100.0),
        ("dropoff", "2026-10-08 10:50", "2026-10-08 11:50", 1100.0, 1100.0),
    ]
    assert day_entries(plan, 2) == [
        ("sleeper", "rest", 0, 180),
        ("driving", "drive", 180, 520),
        ("on_duty", "fuel", 520, 550),
        ("driving", "drive", 550, 650),
        ("on_duty", "dropoff", 650, 710),
        ("off_duty", "idle", 710, 1440),
    ]
    assert totals(plan, 1) == (300, 420, 660, 60)
    assert totals(plan, 2) == (730, 180, 440, 90)
    assert [plan["logs"][i]["total_miles_driving"] for i in (0, 1)] == [660, 440]
    assert [log["recap"]["a_minutes"] for log in plan["logs"]] == [1320, 1850]
    assert [log["recap"]["b_minutes"] for log in plan["logs"]] == [2880, 2350]
    assert plan["summary"]["fuel_stops"] == 1
    assert plan["summary"]["cycle_used_end_hours"] == 30.83
    fuel = next(s for s in plan["stops"] if s["kind"] == "fuel")
    assert (fuel["id"], fuel["mile"], fuel["duration_minutes"], fuel["day"]) == ("fuel-1", 1000.0, 30, 2)


def test_golden_5_cycle_runs_out_and_a_34_hour_restart_goes_in():
    """Cycle 68.5 h (4110 min, so 90 min left), 300 mi then 300 mi, leaves 06:00.

    06:00 drive 90 -> 07:30 (mile 90): the cycle hits 70 h. 34-hour restart (Off Duty)
          -> 17:30 on Oct 8 (07:30 + 24 h = Oct 8 07:30, + 10 h).
    17:30 drive the remaining 210 -> 21:00 (mile 300); pickup -> 22:00.
    22:00 drive 300 -> 03:00 on Oct 9 (mile 600); dropoff -> 04:00. Elapsed 90 + 2040 + 210 + 60 + 300 + 60 = 2760.
    After the restart the cycle starts at zero: 210 + 60 + 300 + 60 = 630 min = 10.5 h at the end.

    Day 1 (Oct 7): off 0-360, driving 360-450, restart (off duty) 450-1440.
    Day 2 (Oct 8): restart 0-1050, driving 1050-1260, on duty 1260-1320, driving 1320-1440.
    Day 3 (Oct 9): driving 0-180, on duty 180-240, off 240-1440.
    Recap day 1: A = 4110 + 90 = 4200, B = 0. Day 2: the restart finished at minute 1050, so only
    work after it counts: 210 + 60 + 120 = 390, B = 3810, restart_completed. Day 3: 390 + 240 = 630.
    """
    plan = run("2026-10-07T06:00", 68.5, 300, 300, osrm1=280, osrm2=280)

    assert rows(plan) == [
        ("drive", "2026-10-07 06:00", "2026-10-07 07:30", 0.0, 90.0),
        ("restart", "2026-10-07 07:30", "2026-10-08 17:30", 90.0, 90.0),
        ("drive", "2026-10-08 17:30", "2026-10-08 21:00", 90.0, 300.0),
        ("pickup", "2026-10-08 21:00", "2026-10-08 22:00", 300.0, 300.0),
        ("drive", "2026-10-08 22:00", "2026-10-09 03:00", 300.0, 600.0),
        ("dropoff", "2026-10-09 03:00", "2026-10-09 04:00", 600.0, 600.0),
    ]
    assert day_entries(plan, 1) == [
        ("off_duty", "idle", 0, 360),
        ("driving", "drive", 360, 450),
        ("off_duty", "restart", 450, 1440),
    ]
    assert day_entries(plan, 2) == [
        ("off_duty", "restart", 0, 1050),
        ("driving", "drive", 1050, 1260),
        ("on_duty", "pickup", 1260, 1320),
        ("driving", "drive", 1320, 1440),
    ]
    assert day_entries(plan, 3) == [
        ("driving", "drive", 0, 180),
        ("on_duty", "dropoff", 180, 240),
        ("off_duty", "idle", 240, 1440),
    ]
    assert [totals(plan, d) for d in (1, 2, 3)] == [(1350, 0, 90, 0), (1050, 0, 330, 60), (1200, 0, 180, 60)]
    assert [log["total_miles_driving"] for log in plan["logs"]] == [90, 330, 180]
    recaps = [log["recap"] for log in plan["logs"]]
    assert [(r["on_duty_today_minutes"], r["a_minutes"], r["b_minutes"], r["c_minutes"]) for r in recaps] == [
        (90, 4200, 0, 4200),
        (390, 390, 3810, 390),
        (240, 630, 3570, 630),
    ]
    assert [r["restart_completed"] for r in recaps] == [False, True, False]
    assert plan["summary"]["restarts"] == 1
    assert plan["summary"]["cycle_used_end_hours"] == 10.5
    assert plan["summary"]["days"] == 3
    assert plan["warnings"] == [
        "The 70-hour cycle runs out on this trip, so the plan adds a 34-hour restart, logged Off Duty."
    ]
    restart = next(s for s in plan["stops"] if s["kind"] == "restart")
    assert (restart["id"], restart["duration_minutes"], restart["mile"], restart["day"]) == ("restart-1", 2040, 90.0, 1)


def test_golden_6_multi_day_trip_across_midnight():
    """500 mi deadhead, 900 mi loaded, cycle 12 h, leaves 14:00 on Oct 7.

    14:00 drive 480 -> 22:00 (mile 480). Break 30 -> 22:30.
    22:30 drive 20 -> 22:50 (mile 500). Pickup 60 -> 23:50.
    23:50 drive 160 -> 02:30 Oct 8 (mile 660): 500 + 160 = 660 min, 11 hours. Rest 600 -> 12:30.
    12:30 drive 340 -> 18:10 (mile 1000). Fuel 30 -> 18:40.
    18:40 drive 320 -> 00:00 Oct 9 (mile 1320): 340 + 320 = 660, 11 hours again, ending on midnight exactly.
    00:00 rest 600 -> 10:00. 10:00 drive 80 -> 11:20 (mile 1400). Dropoff 60 -> 12:20.
    Elapsed 2780 min. Three log days.

    Day 1: off 0-840, driving 840-1320, break 1320-1350, driving 1350-1370, on duty 1370-1430, driving 1430-1440.
    Day 2: driving 0-150, sleeper 150-750, driving 750-1090, fuel 1090-1120, driving 1120-1440.
    Day 3: sleeper 0-600, driving 600-680, on duty 680-740, off 740-1440.
    Miles: 510, 810, 80 (the 160 min leg across midnight splits 10 and 150 min).
    Recap with 12 h (720) already used: day 1 on duty 570, A = 1290; day 2 on duty 840, A = 2130;
    day 3 on duty 140, A = 2270 = cycle used at the end (37.83 h).
    """
    plan = run("2026-10-07T14:00", 12, 500, 900, osrm1=480, osrm2=850)

    assert rows(plan) == [
        ("drive", "2026-10-07 14:00", "2026-10-07 22:00", 0.0, 480.0),
        ("break", "2026-10-07 22:00", "2026-10-07 22:30", 480.0, 480.0),
        ("drive", "2026-10-07 22:30", "2026-10-07 22:50", 480.0, 500.0),
        ("pickup", "2026-10-07 22:50", "2026-10-07 23:50", 500.0, 500.0),
        ("drive", "2026-10-07 23:50", "2026-10-08 02:30", 500.0, 660.0),
        ("rest", "2026-10-08 02:30", "2026-10-08 12:30", 660.0, 660.0),
        ("drive", "2026-10-08 12:30", "2026-10-08 18:10", 660.0, 1000.0),
        ("fuel", "2026-10-08 18:10", "2026-10-08 18:40", 1000.0, 1000.0),
        ("drive", "2026-10-08 18:40", "2026-10-09 00:00", 1000.0, 1320.0),
        ("rest", "2026-10-09 00:00", "2026-10-09 10:00", 1320.0, 1320.0),
        ("drive", "2026-10-09 10:00", "2026-10-09 11:20", 1320.0, 1400.0),
        ("dropoff", "2026-10-09 11:20", "2026-10-09 12:20", 1400.0, 1400.0),
    ]
    assert day_entries(plan, 1) == [
        ("off_duty", "idle", 0, 840),
        ("driving", "drive", 840, 1320),
        ("off_duty", "break", 1320, 1350),
        ("driving", "drive", 1350, 1370),
        ("on_duty", "pickup", 1370, 1430),
        ("driving", "drive", 1430, 1440),
    ]
    assert day_entries(plan, 2) == [
        ("driving", "drive", 0, 150),
        ("sleeper", "rest", 150, 750),
        ("driving", "drive", 750, 1090),
        ("on_duty", "fuel", 1090, 1120),
        ("driving", "drive", 1120, 1440),
    ]
    assert day_entries(plan, 3) == [
        ("sleeper", "rest", 0, 600),
        ("driving", "drive", 600, 680),
        ("on_duty", "dropoff", 680, 740),
        ("off_duty", "idle", 740, 1440),
    ]
    assert [totals(plan, d) for d in (1, 2, 3)] == [(870, 0, 510, 60), (0, 600, 810, 30), (700, 600, 80, 60)]
    assert [log["total_miles_driving"] for log in plan["logs"]] == [510, 810, 80]
    assert remarks(plan, 1) == [
        (840, "Departed, driving to pickup"),
        (1320, "30-minute break"),
        (1350, "Driving to pickup"),
        (1370, "Pickup, loading (1 hr)"),
        (1430, "Left pickup, driving to dropoff"),
    ]
    assert remarks(plan, 2) == [
        (150, "10-hour rest, sleeper berth"),
        (750, "Driving to dropoff"),
        (1090, "Fuel stop (30 min)"),
        (1120, "Driving to dropoff"),
    ]
    assert remarks(plan, 3) == [
        (0, "10-hour rest, sleeper berth"),
        (600, "Driving to dropoff"),
        (680, "Dropoff, unloading (1 hr)"),
        (740, "Off duty"),
    ]
    assert [
        (log["recap"]["on_duty_today_minutes"], log["recap"]["a_minutes"], log["recap"]["b_minutes"])
        for log in plan["logs"]
    ] == [
        (570, 1290, 2910),
        (840, 2130, 2070),
        (140, 2270, 1930),
    ]
    summary = plan["summary"]
    assert (summary["distance_miles"], summary["elapsed_minutes"], summary["days"]) == (1400.0, 2780, 3)
    assert (summary["fuel_stops"], summary["breaks"], summary["rests"], summary["restarts"]) == (1, 1, 2, 0)
    assert summary["on_duty_minutes"] == 1550
    assert summary["cycle_used_end_hours"] == 37.83
    assert summary["arrive_at"] == "2026-10-09T12:20:00-05:00"
    assert [s["id"] for s in plan["stops"]] == [
        "start",
        "break-1",
        "pickup",
        "rest-1",
        "fuel-1",
        "rest-2",
        "dropoff",
        "end",
    ]
    assert [s["day"] for s in plan["stops"]] == [1, 1, 1, 2, 2, 3, 3, 3]
    assert plan["warnings"] == []


def test_golden_7_cycle_already_used_up_starts_with_a_restart():
    """Cycle 70 h, 100 mi then 100 mi, leaves 06:00.

    No driving is allowed, so the trip opens with the 34-hour restart: 06:00 -> 16:00 on Oct 8.
    16:00 drive 100 -> 17:40; pickup -> 18:40; drive 100 -> 20:20; dropoff -> 21:20.

    Day 1 recap: A = 4200, B = 0, no restart finished. Day 2: the restart ended at minute 960,
    so A counts 100 + 60 + 100 + 60 = 320 min, B = 3880, restart_completed.
    """
    plan = run("2026-10-07T06:00", 70, 100, 100, osrm1=90, osrm2=90)

    assert rows(plan) == [
        ("restart", "2026-10-07 06:00", "2026-10-08 16:00", 0.0, 0.0),
        ("drive", "2026-10-08 16:00", "2026-10-08 17:40", 0.0, 100.0),
        ("pickup", "2026-10-08 17:40", "2026-10-08 18:40", 100.0, 100.0),
        ("drive", "2026-10-08 18:40", "2026-10-08 20:20", 100.0, 200.0),
        ("dropoff", "2026-10-08 20:20", "2026-10-08 21:20", 200.0, 200.0),
    ]
    recaps = [log["recap"] for log in plan["logs"]]
    assert [(r["a_minutes"], r["b_minutes"], r["restart_completed"]) for r in recaps] == [
        (4200, 0, False),
        (320, 3880, True),
    ]
    assert plan["summary"]["cycle_used_end_hours"] == 5.33
    assert plan["warnings"] == [
        "Your cycle is already at 70 hours or more, so the trip starts with a 34-hour restart, logged Off Duty."
    ]
    assert [s["id"] for s in plan["stops"]][:2] == ["start", "restart-1"]


def test_golden_8_trip_that_ends_exactly_at_midnight_has_no_extra_day():
    """Leaves 13:00, 300 mi then 240 mi: drive 13:00-18:00, pickup -> 19:00, drive 240 -> 23:00,
    dropoff -> 24:00. The trip ends on midnight, so there is one sheet and no trailing Off Duty."""
    plan = run("2026-10-07T13:00", 0, 300, 240, osrm1=250, osrm2=200)

    assert plan["summary"]["days"] == 1
    assert day_entries(plan, 1)[-1] == ("on_duty", "dropoff", 1380, 1440)
    assert remarks(plan, 1)[-1] == (1380, "Dropoff, unloading (1 hr)")
    assert plan["summary"]["arrive_at"] == "2026-10-08T00:00:00-05:00"
    assert plan["stops"][-1]["day"] == 1


def test_golden_9_departure_at_midnight_has_no_leading_off_duty():
    plan = run("2026-10-07T00:00", 0, 60, 60, osrm1=50, osrm2=50)

    assert day_entries(plan, 1)[0] == ("driving", "drive", 0, 60)
    assert remarks(plan, 1)[0] == (0, "Departed, driving to pickup")
