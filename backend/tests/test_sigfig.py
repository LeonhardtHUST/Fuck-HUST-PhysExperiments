"""有效数字引擎的单测：位数解析、修约、对齐规则。"""

from decimal import Decimal

import pytest

from experiments.core.sigfig import (
    add_sub_places,
    consensus_places,
    decimal_places,
    format_places,
    format_readout,
    format_sig,
    format_with_uncertainty,
    mul_div_sigfigs,
    parse_readout,
    round_places,
    round_sig,
    significant_digits,
    uncertainty_places,
)


def test_trailing_zero_carries_significance():
    readout = parse_readout("12.30")
    assert readout is not None
    assert readout.places == 2
    assert readout.sigfigs == 4
    assert parse_readout("12.3").places == 1  # type: ignore[union-attr]
    assert parse_readout("12.3").sigfigs == 3  # type: ignore[union-attr]


def test_leading_zeros_are_not_significant():
    readout = parse_readout("0.000100")
    assert readout is not None
    assert readout.places == 6
    assert readout.sigfigs == 3


def test_scientific_notation_keeps_mantissa_digits():
    readout = parse_readout("1.20e-3")
    assert readout is not None
    assert readout.value == Decimal("0.00120")
    assert readout.mantissa_decimals == 2
    # 末位在 10^-5，而不是尾数上的第 2 位小数
    assert readout.places == 5
    assert readout.sigfigs == 3


def test_negative_and_integer_readouts():
    assert parse_readout("-0.030").places == 3  # type: ignore[union-attr]
    assert parse_readout("-0.030").sigfigs == 2  # type: ignore[union-attr]
    assert parse_readout("100").sigfigs == 3  # type: ignore[union-attr]
    assert parse_readout("0").sigfigs == 1  # type: ignore[union-attr]


@pytest.mark.parametrize("text", ["", "  ", "--", "N/A", "1,20", "12abc", None, True])
def test_unparsable_values_are_rejected(text):
    assert parse_readout(text) is None


def test_formatters_never_pad_by_default():
    assert format_sig(632.8123, 4) == "632.8"
    assert format_sig(1.2, 4) == "1.2"
    assert format_places(1.2, 2) == "1.2"
    assert format_places(1.2, 2, pad=True) == "1.20"


def test_scientific_output_declares_significant_digits():
    assert format_sig(6.626e-34, 3) == "6.63e-34"
    assert format_sig(2.99792458e8, 3) == "3.00e8"
    assert format_sig(0.000123456, 3) == "0.000123"


def test_raw_readout_is_passed_through_verbatim():
    assert format_readout("1.20") == "1.20"
    assert format_readout("1.2") == "1.2"
    assert format_readout("1.20e-3") == "1.20e-3"
    assert format_readout("-0.030") == "-0.030"


def test_add_sub_aligns_to_coarsest_last_digit():
    assert add_sub_places("12.30", "1.2") == 1
    assert add_sub_places("0.10", "0.001") == 2
    assert format_places(Decimal("12.30") + Decimal("1.2"), add_sub_places("12.30", "1.2")) == "13.5"


def test_mul_div_takes_fewest_significant_digits():
    assert mul_div_sigfigs("1.20", "2.0") == 2
    assert mul_div_sigfigs("12.30", "1.2") == 2
    assert mul_div_sigfigs("1", "1") == 2  # clamp 下限，避免把结果压成 1 位
    assert mul_div_sigfigs("1.234567", "2.345678") == 6  # clamp 上限


def test_uncertainty_rounding_rule():
    # 首位 1/2 保留 2 位有效数字，其余 1 位
    assert uncertainty_places("0.023") == 3
    assert uncertainty_places("0.000123") == 5
    assert uncertainty_places(3.0) == 0
    assert uncertainty_places("0.5") == 1
    assert format_with_uncertainty(1.23456, 0.023) == ("1.235", "0.023")


def test_rounding_is_half_up_not_bankers():
    assert round_sig(Decimal("2.5"), 1) == Decimal("3")
    assert round_places(Decimal("2.345"), 2) == Decimal("2.35")


def test_helpers():
    assert decimal_places("1.20e-3") == 5
    assert significant_digits("1.20e-3") == 3
    assert consensus_places(["12.30", "12.35", "12.4"]) == 1
    assert consensus_places([]) is None
