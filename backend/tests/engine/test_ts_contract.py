"""The types.ts reader and checker. A checker that cannot fail would prove nothing."""

from __future__ import annotations

import pytest

from .ts_contract import Contract, load

SAMPLE = """
// A comment line.
export type Mode = 'car' | 'bike'

/** Leading bar, several lines. */
export type Kind =
  | 'a'
  | 'b'
  | 'idle'

export interface Point {
  /** Latitude. */
  lat: number
  lon: number
}

export interface Named extends Point {
  name: string
  note?: string
  mode: Mode
  both: [number, number]
  box: [[number, number], [number, number]]
  tags: string[]
  grid: [number, number][]
  kind: Exclude<Kind, 'idle'>
  loose?: Partial<Point>
  by_name: Record<string, string[]>
  flag: boolean
  choice: 'x' | 'y'
}

export const IGNORED: Record<Mode, string> = { car: 'Car', bike: 'Bike' }
"""


def good() -> dict:
    return {
        "lat": 1.5,
        "lon": -2,
        "name": "n",
        "mode": "car",
        "both": [1, 2],
        "box": [[1, 2], [3, 4]],
        "tags": ["a", "b"],
        "grid": [[1, 2], [3, 4]],
        "kind": "a",
        "by_name": {"k": ["v"]},
        "flag": True,
        "choice": "y",
    }


@pytest.fixture(scope="module")
def sample() -> Contract:
    return Contract.from_text(SAMPLE)


def test_a_matching_value_has_no_problems(sample):
    assert sample.check(good(), "Named") == []


def test_optional_members_may_be_present_or_missing(sample):
    assert sample.check({**good(), "note": "hi", "loose": {"lat": 3}}, "Named") == []
    assert sample.check({**good(), "loose": {}}, "Named") == []


def test_members_of_the_base_interface_are_required(sample):
    problems = sample.check({k: v for k, v in good().items() if k != "lat"}, "Named")
    assert problems == ["$.lat: missing"]


def test_fields_lists_the_base_interface_first(sample):
    assert sample.fields("Named")[:3] == ["lat", "lon", "name"]


@pytest.mark.parametrize(
    ("change", "fragment"),
    [
        ({"extra": 1}, "$.extra: not declared"),
        ({"lat": "1"}, "$.lat: expected a finite number"),
        ({"lat": True}, "$.lat: expected a finite number"),
        ({"lat": float("nan")}, "$.lat: expected a finite number"),
        ({"lat": float("inf")}, "$.lat: expected a finite number"),
        ({"name": 4}, "$.name: expected a string"),
        ({"flag": 1}, "$.flag: expected a boolean"),
        ({"mode": "train"}, "$.mode"),
        ({"choice": "z"}, "$.choice"),
        ({"both": [1]}, "$.both: expected a list of 2"),
        ({"both": [1, 2, 3]}, "$.both: expected a list of 2"),
        ({"both": "ab"}, "$.both: expected a list of 2"),
        ({"box": [[1, 2], [3]]}, "$.box[1]"),
        ({"tags": "abc"}, "$.tags: expected a list"),
        ({"tags": ["a", 2]}, "$.tags[1]: expected a string"),
        ({"grid": [[1, 2], [3, "x"]]}, "$.grid[1][1]"),
        ({"kind": "idle"}, "$.kind: 'idle' is not one of"),
        ({"kind": ["a"]}, "$.kind"),
        ({"loose": {"nope": 1}}, "$.loose.nope: not declared"),
        ({"loose": {"lat": "x"}}, "$.loose.lat"),
        ({"by_name": {"k": "v"}}, "$.by_name.k: expected a list"),
        ({"by_name": []}, "$.by_name: expected an object"),
    ],
)
def test_each_kind_of_mismatch_is_reported(sample, change, fragment):
    problems = sample.check({**good(), **change}, "Named")
    assert any(fragment in p for p in problems), problems


def test_a_missing_required_member_is_reported_by_name(sample):
    value = good()
    del value["by_name"]
    assert sample.check(value, "Named") == ["$.by_name: missing"]


def test_a_non_object_is_reported(sample):
    assert sample.check([], "Named") == ["$: expected an object, got list"]


def test_values_below_the_declarations_are_ignored(sample):
    assert "IGNORED" not in sample.declarations


def test_an_unknown_name_raises():
    with pytest.raises(ValueError, match="does not declare Nope"):
        Contract.from_text(SAMPLE).check({}, "Nope")


def test_a_construct_the_reader_does_not_know_raises():
    with pytest.raises(ValueError, match="cannot check the generic type Readonly"):
        Contract.from_text("export interface A { x: Readonly<string> }").check({"x": "a"}, "A")
    with pytest.raises(ValueError, match="cannot read"):
        Contract.from_text("export enum Bad { A }")


# --- the real file -------------------------------------------------------------------------------


def test_the_real_file_declares_every_shape_the_plan_uses():
    names = set(load().declarations)
    assert {
        "PlanRequest",
        "PlanResponse",
        "PlanSummary",
        "LegSummary",
        "RouteGeometry",
        "Stop",
        "Segment",
        "DailyLog",
        "LogEntry",
        "Remark",
        "LogTotals",
        "LogRecap",
        "LogHeader",
        "DutyStatus",
        "StopKind",
        "SegmentKind",
    } <= names


def test_plan_response_fields_match_the_documented_contract():
    assert load().fields("PlanResponse") == [
        "request",
        "summary",
        "route",
        "stops",
        "segments",
        "logs",
        "directions",
        "assumptions",
        "warnings",
    ]
    assert load().fields("DailyLog") == [
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
    ]
