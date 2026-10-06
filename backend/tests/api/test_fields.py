"""The strict serializer fields every endpoint shares."""

from __future__ import annotations

import pytest
from rest_framework import serializers

from apps.common.fields import CleanCharField, FiniteFloatField


def float_field(**kwargs) -> FiniteFloatField:
    return FiniteFloatField(name="Speed", **kwargs)


def reject(field, value) -> str:
    with pytest.raises(serializers.ValidationError) as caught:
        field.run_validation(value)
    return str(caught.value.detail[0])


@pytest.mark.parametrize("value", [0, 1, -1, 1.5, 1e10, -1e-10])
def test_ordinary_numbers_pass(value):
    assert float_field().run_validation(value) == float(value)


@pytest.mark.parametrize(
    "value",
    [True, False, "5", "", None, [], {}, float("nan"), float("inf"), float("-inf"), 10**400, -(10**400)],
)
def test_other_types_nan_infinity_and_absurd_integers_are_refused(value):
    with pytest.raises(serializers.ValidationError):
        float_field().run_validation(value)


def test_numeric_strings_are_refused_unless_allowed():
    assert reject(float_field(), "5") == "Speed must be a number."
    assert float_field(allow_strings=True).run_validation("5.5") == 5.5


@pytest.mark.parametrize("text", ["nan", "inf", "-inf", "Infinity", "1e999", "abc", "1,5", " ", "0x10", "1" * 33])
def test_allowed_strings_still_have_to_be_finite_numbers(text):
    with pytest.raises(serializers.ValidationError):
        float_field(allow_strings=True).run_validation(text)


def test_range_messages_name_the_field_and_the_limits():
    assert reject(float_field(min_value=0, max_value=70), 71) == "Speed must be between 0 and 70."
    assert reject(float_field(min_value=0), -1) == "Speed must be at least 0."
    assert reject(float_field(max_value=90), 91) == "Speed must be at most 90."


def test_the_limits_themselves_are_allowed():
    field = float_field(min_value=-90, max_value=90)
    assert field.run_validation(-90) == -90.0 and field.run_validation(90) == 90.0


def test_without_limits_the_range_message_is_generic():
    assert float_field()._range_message("Speed", None, None) == "Speed is out of range."


def test_a_missing_required_value_asks_for_it():
    assert reject(float_field(), serializers.empty) == "Speed is required."


def test_custom_error_messages_win():
    field = float_field(error_messages={"invalid": "Type a number."})
    assert reject(field, "x") == "Type a number."


def test_representation_is_a_float():
    assert float_field().to_representation(3) == 3.0
    assert isinstance(float_field().to_representation(3), float)


# CleanCharField -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "plain",
        "Zoë ünïcode 王 ✓",
        "emoji 🚚",
        "<script>alert(1)</script>",
        "'; DROP TABLE trips; --",
        "tab nbsp",
        "right-to-left ‮ mark",
        "combining é",
    ],
)
def test_text_is_kept_exactly(text):
    assert CleanCharField().run_validation(text) == text


@pytest.mark.parametrize("text", ["a\x00b", "a\nb", "a\tb", "a\x1bb", "a\x7fb", "a\x85b", "lone \ud800 surrogate"])
def test_control_characters_and_lone_surrogates_are_refused(text):
    assert reject(CleanCharField(), text) == "Remove control characters."


def test_edges_are_trimmed():
    assert CleanCharField().run_validation("  hello  ") == "hello"


def test_the_length_limit_counts_characters_not_bytes():
    assert CleanCharField(max_length=3).run_validation("王王王") == "王王王"
    with pytest.raises(serializers.ValidationError):
        CleanCharField(max_length=3).run_validation("王王王王")
