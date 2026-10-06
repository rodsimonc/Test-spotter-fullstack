"""Road-by-road directions, condensed from the router's turn list.

Pure: no Django, no network. The router sends one step per turn, ramp and name change, which
for a long haul is hundreds of lines. `condense` boils that down to one line per stretch of
road. `render` writes the wording and fills in the place names the user typed.

The two halves are split on purpose. `condense` knows nothing about place labels, so its result
(`Stretch` values) can live in the route cache, where trips with different labels share a row.
Anything weird in the router's data makes a leg give up and return nothing. It never raises.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

from .types import RawStep, Stretch

#: A step shorter than this is folded into the one before it.
MIN_STEP_MILES = 0.5
#: Lines per leg, counting the departure and the arrival.
MAX_STEPS_PER_LEG = 120
#: How far the steps may stray from the leg's own distance before we stop trusting them.
MAX_DRIFT_MILES = 0.5
MAX_DRIFT_FRACTION = 0.05
MAX_ROAD_CHARS = 80

COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
_WORDS = ("north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest")
KINDS = ("depart", "road", "arrive")

_SPACE_BEFORE_DIGIT = re.compile(r"^([A-Za-z]+) (?=\d)")
_NUMBERED_ROAD = re.compile(r"^[A-Za-z]+-\d")
_LEG_ENDS = (("current", "pickup"), ("pickup", "dropoff"))
_STRETCH_FIELDS = {"kind", "road", "heading", "distance_miles", "mile", "lat", "lon"}

LegStretches = tuple[Stretch, ...]
TripStretches = tuple[LegStretches, LegStretches]


@dataclass
class _Group:
    """Raw steps merged into one line, while the condensing is still under way."""

    kind: str
    key: str
    miles: float
    bearing: float | None
    lat: float
    lon: float


# --- reading single values ---------------------------------------------------------------


def _tidy(text: str) -> str:
    """One line of printable text, at most `MAX_ROAD_CHARS` long. Map data is untrusted."""
    printable = "".join(ch if ch.isprintable() else " " for ch in text)
    return " ".join(printable.split())[:MAX_ROAD_CHARS].rstrip()


def road_key(step: RawStep) -> str:
    """The road a step is on: its first reference ("I-40", "US-287"), else its name, else nothing."""
    for part in step.ref.split(";"):
        ref = _tidy(part)
        if ref:
            return _SPACE_BEFORE_DIGIT.sub(r"\1-", ref)
    return _tidy(step.name)


def compass(bearing: float) -> str:
    """The 8-point abbreviation for a bearing in degrees."""
    return COMPASS[int(((bearing % 360) + 22.5) // 45) % 8]


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _where(step: RawStep) -> tuple[float, float] | None:
    """The step's (lat, lon), or None when it has no usable location."""
    lat, lon = step.lat, step.lon
    if lat is None or lon is None or not (_is_number(lat) and _is_number(lon)) or abs(lat) > 90 or abs(lon) > 180:
        return None
    return lat, lon


def city(label: str) -> str:
    """The part of a place label before the first comma: Dallas for "Dallas, Texas, United States"."""
    return label.split(",")[0].strip() or label.strip()


# --- condensing --------------------------------------------------------------------------


def _group(body: Sequence[RawStep]) -> list[_Group]:
    groups: list[_Group] = []
    for step in body:
        where = _where(step)
        if where is None:
            if not groups:
                return []  # With no start point there is no first line to show.
            groups[-1].miles += step.distance_miles  # Nowhere to place it, so it belongs to the line before.
            continue
        key = road_key(step)
        bearing = step.bearing_after if _is_number(step.bearing_after) else None
        if not groups:
            groups.append(_Group("depart", key, step.distance_miles, bearing, *where))
        elif step.distance_miles >= MIN_STEP_MILES and key and key != groups[-1].key:
            groups.append(_Group("road", key, step.distance_miles, bearing, *where))
        else:
            # Too short, no road, or the same road as before: it belongs to the line before.
            groups[-1].miles += step.distance_miles
    return groups


def _cap(groups: list[_Group]) -> None:
    """Fold the shortest road into the line before it until the leg fits the limit."""
    while len(groups) >= MAX_STEPS_PER_LEG:  # One slot is kept for the arrival.
        shortest = min(range(1, len(groups)), key=lambda i: groups[i].miles)
        groups[shortest - 1].miles += groups[shortest].miles
        del groups[shortest]
        # Folding can leave the same road on both sides of the gap.
        if shortest < len(groups) and groups[shortest].key == groups[shortest - 1].key:
            groups[shortest - 1].miles += groups[shortest].miles
            del groups[shortest]


def _headings(groups: Sequence[_Group]) -> list[str] | None:
    headings: list[str] = []
    for group in groups:
        if group.bearing is not None:
            headings.append(compass(group.bearing))
        elif headings:
            headings.append(headings[-1])
        else:
            return None
    return headings


def condense_leg(steps: Sequence[RawStep], leg_miles: float, start_mile: float = 0.0) -> LegStretches:
    """One leg's raw steps as a departure, a line per stretch of road and an arrival.

    `leg_miles` is the router's own distance for the leg. The lines are scaled to it and then
    rounded to 0.1 mile so that they add up to it exactly (to its own rounding, 0.1). `start_mile`
    is where the leg begins in the whole trip. Returns an empty tuple when the steps can't be trusted.
    """
    if not _is_number(leg_miles) or leg_miles < 0:
        return ()
    if not all(_is_number(step.distance_miles) and step.distance_miles >= 0 for step in steps):
        return ()
    body = steps[:-1] if steps and steps[-1].maneuver == "arrive" else steps
    groups = _group(body)
    end = next((where for step in reversed(steps) if (where := _where(step)) is not None), None)
    if not groups or end is None:
        return ()
    _cap(groups)

    total = sum(group.miles for group in groups)
    if abs(total - leg_miles) > max(MAX_DRIFT_MILES, MAX_DRIFT_FRACTION * leg_miles):
        return ()  # The turn list describes some other route.
    headings = _headings(groups)
    if headings is None:
        return ()

    # Rounding the running total, then taking differences, keeps every distance a multiple of 0.1
    # and lets the lines sum to the leg with no one line carrying a big correction. The mile marks
    # come from the unrounded totals, so the ends of a leg land on the same miles as the stops.
    scale = leg_miles / total if total > 0 else 0.0
    target = round(leg_miles, 1)
    starts: list[float] = []
    running = 0.0
    for group in groups:
        starts.append(min(running * scale, leg_miles))
        running += group.miles
    edges = [min(round(start, 1), target) for start in starts] + [target]

    stretches = [
        Stretch(
            kind=group.kind,
            road=group.key,
            heading=headings[i],
            distance_miles=round(edges[i + 1] - edges[i], 1),
            mile=round(start_mile + starts[i], 1),
            lat=group.lat,
            lon=group.lon,
        )
        for i, group in enumerate(groups)
    ]
    stretches.append(Stretch("arrive", "", "", 0.0, round(start_mile + leg_miles, 1), *end))
    return tuple(stretches)


def condense(raw_legs: Sequence[Sequence[RawStep]], leg_miles: Sequence[float]) -> TripStretches | None:
    """Both legs, or None when either one has no usable steps."""
    first = condense_leg(raw_legs[0], leg_miles[0])
    second = condense_leg(raw_legs[1], leg_miles[1], start_mile=leg_miles[0])
    return (first, second) if first and second else None


# --- wording -----------------------------------------------------------------------------


def instruction(kind: str, road: str, heading: str, place: str = "") -> str:
    """The sentence for one line. `place` is the full label of the destination, used on arrival."""
    if kind == "arrive":
        return f"Arrive at {city(place)}"
    if kind == "depart":
        word = _WORDS[COMPASS.index(heading)]
        return f"Head {word} on {road}" if road else f"Head {word}"
    if not road:
        return f"Continue {heading}"
    return f"Take {road} {heading}" if _NUMBERED_ROAD.match(road) else f"Continue on {road}"


def render(stretches: TripStretches | None, current: str, pickup: str, dropoff: str) -> list[dict[str, Any]]:
    """The `directions` field of the plan: two legs, or an empty list when there is nothing to show."""
    if stretches is None:
        return []
    labels = (current, pickup, dropoff)
    legs = []
    for index, leg in enumerate(stretches):
        origin, destination = labels[index], labels[index + 1]
        legs.append(
            {
                "from": _LEG_ENDS[index][0],
                "to": _LEG_ENDS[index][1],
                "title": f"{city(origin)} to {city(destination)}",
                "distance_miles": round(sum(s.distance_miles for s in leg), 1),
                "steps": [
                    {
                        "kind": s.kind,
                        "instruction": instruction(s.kind, s.road, s.heading, destination),
                        "road": s.road,
                        "heading": s.heading,
                        "distance_miles": s.distance_miles,
                        "mile": s.mile,
                        "lat": round(s.lat, 5),
                        "lon": round(s.lon, 5),
                    }
                    for s in leg
                ],
            }
        )
    return legs


# --- the cache form ----------------------------------------------------------------------


def to_payload(stretches: TripStretches | None) -> list[list[dict[str, Any]]]:
    """Plain JSON for the route cache. An empty list means the router had nothing usable."""
    return [] if stretches is None else [[asdict(s) for s in leg] for leg in stretches]


def _read_stretch(item: Any) -> Stretch:
    if not isinstance(item, dict) or set(item) != _STRETCH_FIELDS:
        raise ValueError("Cached directions have the wrong fields.")
    numbers = [item[name] for name in ("distance_miles", "mile", "lat", "lon")]
    if (
        item["kind"] not in KINDS
        or not isinstance(item["road"], str)
        or item["heading"] not in (*COMPASS, "")
        or not all(_is_number(n) for n in numbers)
    ):
        raise ValueError("Cached directions have a bad value.")
    return Stretch(item["kind"], item["road"], item["heading"], *(float(n) for n in numbers))


def from_payload(payload: Any) -> TripStretches | None:
    """Undo `to_payload`. Raises `ValueError` when the data isn't what it wrote."""
    if isinstance(payload, list) and not payload:
        return None
    if not isinstance(payload, list) or len(payload) != 2:
        raise ValueError("Cached directions must hold two legs.")
    legs = []
    for leg in payload:
        if not isinstance(leg, list) or not leg:
            raise ValueError("A cached leg has no lines.")
        legs.append(tuple(_read_stretch(item) for item in leg))
    return legs[0], legs[1]
