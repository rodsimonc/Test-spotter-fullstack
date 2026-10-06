"""The contract checker has to fail on bad JSON, or every test built on it proves nothing."""

from __future__ import annotations

import pytest

from tests.support import ts_contract
from tests.support.ts_contract import Contract

SOURCE = """
// A comment line.
export type Mode = 'a' | 'b'

/** A multi-line union with a leading pipe. */
export type Kind =
  | 'x'
  | 'y'
  | 'z'

export interface Base {
  /** Doc comment. */
  id: string
}

export interface Child extends Base {
  n: number
  maybe?: boolean // trailing comment
  mode: Mode
  pairs: [number, number][]
  tag: Exclude<Kind, 'z'>
  inline: {
    a: string
    b?: number
  }
  bag: Record<string, string[]>
  part?: Partial<Base>
  either: string | null
}

export const IGNORED = { not: 'a type' }
"""


@pytest.fixture(scope="module")
def contract() -> Contract:
    return Contract(SOURCE)


def good() -> dict:
    return {
        "id": "abc",
        "n": 1.5,
        "mode": "a",
        "pairs": [[1, 2], [3.5, 4]],
        "tag": "x",
        "inline": {"a": "text"},
        "bag": {"k": ["v"]},
        "either": None,
    }


def test_good_json_passes(contract):
    assert contract.problems(good(), "Child") == []


def test_optional_fields_may_be_present(contract):
    value = good() | {"maybe": True, "part": {"id": "q"}, "inline": {"a": "t", "b": 2}}
    assert contract.problems(value, "Child") == []


def test_inherited_fields_are_required(contract):
    value = good()
    del value["id"]
    assert contract.problems(value, "Child") == ["child.id: missing"]


def test_missing_field_is_reported(contract):
    value = good()
    del value["n"]
    assert contract.problems(value, "Child") == ["child.n: missing"]


def test_extra_field_is_reported(contract):
    assert contract.problems(good() | {"surprise": 1}, "Child") == ["child.surprise: not in Child"]


def test_extra_field_in_an_inline_object_is_reported(contract):
    value = good() | {"inline": {"a": "t", "c": 1}}
    assert contract.problems(value, "Child") == ["child.inline.c: not in an inline object"]


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("n", "1"),
        ("n", True),
        ("n", float("nan")),
        ("n", float("inf")),
        ("id", 5),
        ("mode", "c"),
        ("mode", 1),
        ("pairs", [[1, 2, 3]]),
        ("pairs", [[1]]),
        ("pairs", {"a": 1}),
        ("pairs", [["1", "2"]]),
        ("tag", "z"),
        ("tag", "nope"),
        ("tag", ["x"]),
        ("inline", "text"),
        ("inline", {"a": 1}),
        ("bag", {"k": "v"}),
        ("bag", ["v"]),
        ("either", 5),
    ],
)
def test_wrong_values_are_reported(contract, field, bad):
    problems = contract.problems(good() | {field: bad}, "Child")
    assert problems, f"{field}={bad!r} should not match"
    assert all(p.startswith(f"child.{field}") for p in problems)


def test_a_non_object_is_reported(contract):
    assert "expected an object" in contract.problems([], "Child")[0]


def test_partial_allows_missing_keys_but_not_unknown_ones(contract):
    assert contract.problems(good() | {"part": {}}, "Child") == []
    assert contract.problems(good() | {"part": {"nope": "x"}}, "Child") == ["child.part.nope: not in Base"]
    assert contract.problems(good() | {"part": {"id": 3}}, "Child")
    assert contract.problems(good() | {"part": "x"}, "Child")


def test_problem_paths_show_where_in_an_array(contract):
    problems = contract.problems(good() | {"pairs": [[1, 2], [3, "x"]]}, "Child")
    assert problems == ["child.pairs[1][1]: expected number, got 'x'"]


def test_assert_matches_raises_with_every_problem_listed(contract):
    with pytest.raises(AssertionError) as caught:
        contract.assert_matches({"id": 1}, "Child")
    message = str(caught.value)
    assert "doesn't match Child" in message
    assert "child.id" in message
    assert "child.n: missing" in message


def test_unknown_interface_is_an_error(contract):
    with pytest.raises(KeyError):
        contract.problems({}, "Nope")


def test_unsupported_generics_raise_instead_of_passing_quietly():
    source = "export interface Odd {\n  x: Readonly<string>\n}\n"
    with pytest.raises(NotImplementedError):
        Contract(source).problems({"x": "a"}, "Odd")


def test_unreadable_types_raise():
    with pytest.raises(ValueError):
        Contract("export interface Odd {\n  x: string )\n}\n")


def test_the_real_types_file_is_read_completely():
    contract = ts_contract.load()
    for name in ("PlanRequest", "PlanResponse", "DailyLog", "Trip", "TripSummary", "User", "ApiErrorBody"):
        assert name in contract.names
    assert set(contract.fields_of("Trip")) == set(contract.fields_of("TripSummary")) | {"request", "result"}
    assert contract.fields_of("PlanRequest")["header"].optional
    assert not contract.fields_of("PlanRequest")["current"].optional
