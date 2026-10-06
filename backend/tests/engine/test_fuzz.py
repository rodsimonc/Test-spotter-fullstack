"""Random trips, each one held to the independent checker in compliance.py.

The checker is written from the FMCSA guide and shares no code with the engine, so a rule
the engine gets wrong shows up as a plain-language problem here. Hypothesis shrinks a failure
to the smallest trip that still breaks a rule, and prints it.

Coverage the strategies aim for:
- 0 to 5,000 miles over two legs, either of which can be empty, with router times from far
  faster than 60 mph to far slower.
- Cycle hours from 0 to 70, with extra weight on the edges (0, 69.75, 70).
- Any departure minute, on random dates and on the days around clock changes, in zones with
  daylight time, without it (Phoenix, Honolulu) and with a half-hour offset (St. John's).
- Places in North America, in Europe, or all on one spot.
"""

from __future__ import annotations

import json
from datetime import date, datetime, time

from hypothesis import HealthCheck, given, note, settings
from hypothesis import strategies as st

from apps.planner.assemble import build_plan

from . import ts_contract
from .compliance import Expect, check_plan
from .helpers import make_request, make_route

CONTRACT = ts_contract.load()

ZONES = [
    "America/Chicago",
    "America/Phoenix",
    "America/Los_Angeles",
    "Pacific/Honolulu",
    "America/New_York",
    "America/St_Johns",
]
HEADER_KEYS = [
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
]

# Weeks that hold a spring-forward or fall-back day in 2026 and 2027, so trips of up to two
# weeks start before, on, and after the change.
CLOCK_CHANGE_WINDOWS = [
    (date(2026, 2, 24), date(2026, 3, 10)),
    (date(2026, 10, 20), date(2026, 11, 3)),
    (date(2027, 3, 1), date(2027, 3, 15)),
    (date(2027, 10, 26), date(2027, 11, 8)),
]
# Minutes after midnight worth hitting on purpose: the edges of the day and the hour clocks skip.
SPECIAL_MINUTES = [0, 1, 59, 60, 119, 120, 150, 179, 180, 1319, 1380, 1438, 1439]

settings.register_profile(
    "engine-fuzz", deadline=None, suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large]
)
settings.load_profile("engine-fuzz")


def miles() -> st.SearchStrategy[float]:
    return st.one_of(
        st.just(0.0),
        st.floats(0.1, 80.0).map(lambda x: round(x, 3)),
        st.floats(80.0, 1500.0).map(lambda x: round(x, 3)),
        st.floats(1500.0, 3000.0).map(lambda x: round(x, 3)),
    )


def router_speed_factor() -> st.SearchStrategy[float]:
    """OSRM minutes per mile. Under 1.0 the 60 mph floor decides, over 1.0 the router does."""
    return st.one_of(st.just(0.0), st.floats(0.3, 0.95), st.just(1.0), st.floats(1.05, 2.0))


def cycle_hours() -> st.SearchStrategy[float]:
    quarter_hours = st.integers(0, 280).map(lambda n: n / 4)
    return st.one_of(quarter_hours, st.sampled_from([0.0, 0.25, 8.0, 40.0, 60.0, 69.0, 69.75, 70.0]))


def dates(clock_changes_only: bool) -> st.SearchStrategy[date]:
    near_changes = st.one_of(*(st.dates(lo, hi) for lo, hi in CLOCK_CHANGE_WINDOWS))
    return (
        near_changes if clock_changes_only else st.one_of(st.dates(date(2025, 1, 1), date(2028, 12, 31)), near_changes)
    )


def departure_minute() -> st.SearchStrategy[int]:
    return st.one_of(st.integers(0, 1439), st.sampled_from(SPECIAL_MINUTES))


NORTH_AMERICA = st.tuples(st.floats(26.0, 49.0), st.floats(-122.0, -70.0))
EUROPE = st.tuples(st.floats(40.0, 55.0), st.floats(-5.0, 30.0))


@st.composite
def places(draw):
    """Three (lat, lon) points and whether any of them is outside North America."""
    if draw(st.integers(0, 9)) == 0:
        spot = draw(NORTH_AMERICA)
        return (spot, spot, spot), False
    picks = [draw(st.one_of(NORTH_AMERICA, NORTH_AMERICA, NORTH_AMERICA, EUROPE)) for _ in range(3)]
    outside = any(not (14.0 <= lat <= 72.0 and -170.0 <= lon <= -50.0) for lat, lon in picks)
    return tuple(picks), outside


@st.composite
def headers(draw):
    keys = draw(st.lists(st.sampled_from(HEADER_KEYS), unique=True, max_size=4))
    return {k: draw(st.text(max_size=18)) for k in keys}


@st.composite
def trips(draw, clock_changes_only: bool = False):
    leg1, leg2 = draw(miles()), draw(miles())
    if leg1 + leg2 == 0.0 and draw(st.booleans()):
        leg2 = draw(st.floats(1.0, 400.0).map(lambda x: round(x, 3)))
    factor1, factor2 = draw(router_speed_factor()), draw(router_speed_factor())
    (a, b, c), outside = draw(places())
    day = draw(dates(clock_changes_only))
    minute = draw(departure_minute())
    wall = datetime.combine(day, time(minute // 60, minute % 60))
    return {
        "leg_miles": (leg1, leg2),
        "osrm_minutes": (round(leg1 * factor1, 3), round(leg2 * factor2, 3)),
        "cycle": draw(cycle_hours()),
        "departure": wall.strftime("%Y-%m-%dT%H:%M"),
        "timezone": draw(st.sampled_from(ZONES)),
        "header": draw(headers()),
        "places": (a, b, c),
        "outside": outside,
    }


def plan_and_problems(trip: dict) -> tuple[dict, list[str]]:
    a, b, c = trip["places"]
    req = make_request(
        departure=trip["departure"], tz=trip["timezone"], cycle=trip["cycle"], header=trip["header"], a=a, b=b, c=c
    )
    route = make_route(*trip["leg_miles"], *trip["osrm_minutes"], a=a, b=b, c=c, steps=12)
    plan = build_plan(req, route)
    expect = Expect(
        leg_miles=trip["leg_miles"],
        osrm_minutes=trip["osrm_minutes"],
        cycle_used_hours=trip["cycle"],
        departure=trip["departure"],
        timezone=trip["timezone"],
        header=trip["header"],
        outside_north_america=trip["outside"],
    )
    return plan, check_plan(plan, expect)


@settings(max_examples=400)
@given(trip=trips())
def test_random_trips_follow_every_rule(trip):
    plan, problems = plan_and_problems(trip)
    note(f"{plan['summary']['days']} days, {len(plan['segments'])} segments")
    assert problems == []


@settings(max_examples=250)
@given(trip=trips(clock_changes_only=True))
def test_random_trips_around_clock_changes_keep_every_day_at_24_hours(trip):
    plan, problems = plan_and_problems(trip)
    assert problems == []
    assert all(sum(log["totals"].values()) == 1440 for log in plan["logs"])
    offsets = {stamp[-6:] for stamp in _timestamps(plan)}
    assert len(offsets) == 1, f"one fixed offset expected, found {offsets}"


@settings(max_examples=120)
@given(trip=trips())
def test_random_plans_fit_the_types_and_survive_json(trip):
    plan, _ = plan_and_problems(trip)
    wire = json.loads(json.dumps(plan, allow_nan=False))
    assert wire == plan
    assert CONTRACT.check(wire, "PlanResponse") == []


@settings(max_examples=60)
@given(trip=trips())
def test_planning_twice_gives_the_same_answer(trip):
    first, _ = plan_and_problems(trip)
    second, _ = plan_and_problems(trip)
    assert first == second


def _timestamps(plan: dict) -> list[str]:
    stamps = [plan["summary"]["depart_at"], plan["summary"]["arrive_at"]]
    stamps += [s[k] for s in plan["segments"] for k in ("start_at", "end_at")]
    stamps += [s[k] for s in plan["stops"] for k in ("arrive_at", "depart_at")]
    return stamps
