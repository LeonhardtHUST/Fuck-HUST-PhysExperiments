"""派生量精度规则的单测：位数来源必须可解释、可审计。"""

from experiments.core.precision import (
    DEFAULT_PRECISION,
    format_result,
    precision_for,
)


def test_wavelength_is_four_significant_digits():
    precision = precision_for("michelson", "wavelength", "wavelength")
    assert precision.sigfigs == 4
    assert format_result(632.8123, "michelson", "wavelength", "wavelength") == "632.8"


def test_differenced_quantity_inherits_readout_places():
    rows = [{"position": "12.30"}, {"position": "12.45"}, {"position": "12.61"}]
    precision = precision_for(
        "michelson", "wavelength", "delta_d_mean", rows=rows,
        columns=[{"key": "position", "unit": "mm"}],
    )
    assert precision.places == 2
    assert "position" in precision.source
    assert format_result(
        0.154, "michelson", "wavelength", "delta_d_mean",
        rows=rows, columns=[{"key": "position", "unit": "mm"}],
    ) == "0.15"


def test_relative_error_is_two_decimals():
    assert format_result(1.2345, "photoelectric", "planck", "h_error", unit="%") == "1.23"
    assert format_result(3.4567, "sound-light", "tof", "error_rel", unit="%") == "3.46"


def test_r_squared_is_four_decimals():
    assert format_result(0.99984, "michelson", "wavelength", "r_squared") == "0.9998"
    assert format_result(0.99984, "sound-light", "tof", "r2") == "0.9998"


def test_counts_are_integers():
    assert format_result(5.0, "viscosity", "diameter_effect", "sample_count") == "5"
    assert format_result(36.0, "sound-light", "tof", "data_points") == "36"


def test_uncertainty_is_two_significant_digits():
    assert format_result(0.00231, "sound-light", "water_phase", "u_a", unit="m/s") == "0.0023"


def test_headline_results_use_declared_rules():
    assert format_result(6.62607e-34, "photoelectric", "planck", "h", unit="J·s") == "6.626e-34"
    assert format_result(299792458.0, "sound-light", "light_sine", "c_exp", unit="m/s") == "2.998e8"
    assert format_result(19.6, "polarization", "malus", "extinction_ratio") == "19.6"
    assert format_result(12.345, "polarization", "malus", "I_max_exp") == "12.35"


def test_unknown_key_falls_back_and_is_marked():
    precision = precision_for("michelson", "wavelength", "no_such_key")
    assert precision.source == DEFAULT_PRECISION.source
    assert precision.sigfigs == 4


def test_strings_pass_through_untouched():
    assert format_result("1.20", "michelson", "wavelength", "wavelength") == "1.20"


def test_audit_has_no_silent_fallbacks():
    """新增结果键若落到兜底规则，审计会点名；这里只守住「不能静默」。"""
    from experiments.core.precision import _iter_config_results

    fallbacks = [
        (experiment, method, key)
        for experiment, method, key, unit in _iter_config_results(None)
        if precision_for(experiment, method, key, unit=unit or None).source == DEFAULT_PRECISION.source
    ]
    assert fallbacks == []
