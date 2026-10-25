"""Regression tests for the sound/light calculation engine and report chain.

All values below are synthetic, hand-checkable fixtures. They do not claim
validation against complete real experimental data.
"""

import json
import math
from pathlib import Path

import pytest

from experiments.soundlight import docs, engine


def _light_rows():
    return {
        "T": [1.23456, 1.23456, 1.23456],
        "dt": [1.0, 1.0, 1.0],
        "x1": [0.0, 0.0, 0.0],
        "x2": [809.4321, 809.4321, 809.4321],
    }


def test_air_resonance_known_result_and_temperature_formula():
    rows = {"l": [float(i * 4.5) for i in range(12)]}
    run = engine.analyze("air_resonance", rows,
                         {"temperature_degC": 25.0, "f_khz": 38.0})
    assert run["status"] == "success"
    assert math.isclose(run["arrays"]["dlm"], 4.5)
    assert math.isclose(run["arrays"]["v_exp"], 342.0)
    expected = 331.45 * math.sqrt(1.0 + 25.0 / 273.15)
    assert math.isclose(run["arrays"]["v_theory"], expected)


def test_water_phase_uncertainty_uses_six_progressive_differences():
    first = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0]
    delta = [0.70, 0.72, 0.74, 0.76, 0.78, 0.80]
    rows = {"l": first + [first[i] + 6 * delta[i] for i in range(6)]}
    run = engine.analyze("water_phase", rows, {"f_mhz": 1.0})
    assert run["status"] == "success"
    a = run["arrays"]
    expected_s = 0.03741657386773942
    assert math.isclose(a["dlm"], 0.75)
    assert math.isclose(a["v"], 1500.0)
    assert math.isclose(a["s"], expected_s)
    assert math.isclose(a["u_a_v"], 2e6 * 2.571 * expected_s / math.sqrt(6) * 1e-3)


def test_air_resonance_accepts_ten_rows_with_five_progressive_differences():
    """行数可自由增删：10 个读数 → k=5 组逐差，而不是报“应有 12 个数据”。"""
    rows = {"l": [float(i * 4.5) for i in range(10)]}
    run = engine.analyze("air_resonance", rows,
                         {"temperature_degC": 25.0, "f_khz": 38.0})
    assert run["status"] == "success", run.get("errors")
    a = run["arrays"]
    assert a["k"] == 5
    assert a["n"] == 10
    assert len(a["delta_l"]) == 5
    assert math.isclose(a["dlm"], 4.5)
    assert math.isclose(a["v_exp"], 342.0)


def test_water_phase_uncertainty_follows_k_and_dof_for_ten_rows():
    first = [10.0, 20.0, 30.0, 40.0, 50.0]
    delta = [0.70, 0.72, 0.74, 0.76, 0.78]
    rows = {"l": first + [first[i] + 5 * delta[i] for i in range(5)]}
    run = engine.analyze("water_phase", rows, {"f_mhz": 1.0})
    assert run["status"] == "success", run.get("errors")
    a = run["arrays"]
    assert a["k"] == 5 and a["dof"] == 4
    assert math.isclose(a["t95"], 2.776)
    assert math.isclose(a["dlm"], 0.74)
    assert math.isclose(a["u_a_v"], 2e6 * 2.776 * a["s"] / math.sqrt(5) * 1e-3)


def test_thirteen_rows_use_six_progressive_differences_and_drop_the_midpoint():
    rows = {"l": [float(i * 4.5) for i in range(13)]}
    run = engine.analyze("air_resonance", rows,
                         {"temperature_degC": 25.0, "f_khz": 38.0})
    assert run["status"] == "success", run.get("errors")
    a = run["arrays"]
    assert a["k"] == 6
    assert a["used_points"] == 12
    assert math.isclose(a["dlm"], 4.5)


def test_too_few_rows_reports_the_minimum_instead_of_the_lecture_count():
    run = engine.analyze("air_resonance", {"l": [1.0, 5.5, 10.0]},
                         {"temperature_degC": 25.0, "f_khz": 38.0})
    assert run["status"] == "validation_error"
    assert any("至少需要 4 个数据" in error and "实际收到 3 个" in error
               for error in run["errors"])


def test_light_method_works_with_two_rows_and_rejects_mismatched_columns():
    two = {"T": [1.2, 1.2], "dt": [1.0, 1.0], "x1": [0.0, 0.0], "x2": [800.0, 800.0]}
    run = engine.analyze("light_sine", two, {"f_mhz": 150.0})
    assert run["status"] == "success", run.get("errors")

    ragged = {"T": [1.2, 1.2, 1.2], "dt": [1.0, 1.0], "x1": [0.0, 0.0], "x2": [800.0, 800.0]}
    bad = engine.analyze("light_sine", ragged, {"f_mhz": 150.0})
    assert bad["status"] == "validation_error"
    assert any("各列行数需一致" in error for error in bad["errors"])


def test_report_prose_and_raw_table_follow_the_actual_row_count():
    air = engine.analyze("air_resonance", {"l": [float(i * 4.5) for i in range(10)]},
                         {"temperature_degC": 25.0, "f_khz": 38.0})
    assert air["status"] == "success", air.get("errors")
    text = "\n".join(block.get("text", "") for block in docs._proc_1a(air))
    assert "l1 至 l10" in text
    assert "隔 5 次相减" in text
    assert "5 组逐差" in text
    assert "l12" not in text

    # 报告原始数据表按实际录入行数生成（表头 + 10 行）
    raw_tables = [block for block in docs._raw_blocks([("air_resonance", air)])
                  if block.get("kind") == "table"]
    assert len(raw_tables[0]["rows"]) == 11


def test_water_uncertainty_text_uses_dof_and_k_of_actual_rows():
    first = [10.0, 20.0, 30.0, 40.0, 50.0]
    delta = [0.70, 0.72, 0.74, 0.76, 0.78]
    wat = engine.analyze("water_phase",
                         {"l": first + [first[i] + 5 * delta[i] for i in range(5)]},
                         {"f_mhz": 1.0})
    assert wat["status"] == "success", wat.get("errors")
    text = "\n".join(block.get("text", "") for block in docs._proc_1b(wat))
    assert "t0.95(4) = 2.776" in text
    assert "/√5" in text
    assert "n − 1 = 5" not in text


def test_progressive_difference_accepts_consistent_reverse_reading_direction():
    rows = {"l": [100.0 - i * 4.5 for i in range(12)]}
    run = engine.analyze("air_resonance", rows,
                         {"temperature_degC": 25.0, "f_khz": 38.0})
    assert run["status"] == "success"
    assert math.isclose(run["arrays"]["dlm"], 4.5)


def test_light_report_uses_engine_full_precision_result():
    run = engine.analyze("light_sine", _light_rows(), {"f_mhz": 150.0})
    assert run["status"] == "success"
    expected = 150e6 * 2 * 1.23456 * 809.4321 * 1e-3
    assert math.isclose(run["arrays"]["c_exp"], expected)
    text = "\n".join(
        block.get("text", "")
        for block in docs._proc_2a("light_sine", run)
    )
    assert f"= {expected:.0f} m/s" in text
    assert "299895000 m/s" not in text


def test_square_wave_reuses_formula_but_keeps_method_identity():
    sine = engine.analyze("light_sine", _light_rows(), {"f_mhz": 150.0})
    square = engine.analyze("light_square", _light_rows(), {"f_mhz": 150.0})
    assert square["status"] == "success"
    assert square["method"] == "light_square"
    assert square["method_name"] == "光速测量（方波）"
    assert square["arrays"]["c_exp"] == sine["arrays"]["c_exp"]


def test_zero_delta_t_is_rejected_without_dropping_the_point():
    rows = _light_rows()
    rows["dt"][1] = 0.0
    run = engine.analyze("light_sine", rows, {"f_mhz": 150.0})
    assert run["status"] == "validation_error"
    assert any("必须全部大于零" in error for error in run["errors"])


@pytest.mark.document
def test_report_never_declares_synthetic_data_correct_or_trustworthy():
    run = engine.analyze("light_sine", _light_rows(), {"f_mhz": 150.0})
    blocks = docs._err_sources_blocks([("light_sine", run)])
    text = "\n".join(block.get("text", "") for block in blocks)
    assert "测量与数据处理正确" not in text
    assert "结果可信" not in text
    assert "是否符合实验要求需结合原始记录" in text


def test_public_config_matches_engine_columns_and_defaults():
    config_path = (Path(__file__).parents[1] / "experiments" / "soundlight"
                   / "config.json")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    assert [item["id"] for item in config] == [
        "air_resonance", "water_phase", "tof", "light_sine",
        "light_square", "light_lissajous",
    ]
    for item in config:
        engine_id = "light_sine" if item["id"] == "light_square" else item["id"]
        # count 是讲义推荐行数（前端默认渲染），min_rows 才是计算下限
        config_columns = [(col["key"], col["count"], col.get("min_rows", 1))
                          for col in item["table_cols"]]
        engine_columns = [(key, min_rows) for key, min_rows, _label
                          in engine._COLUMNS[engine_id]]
        assert [(key, min_rows) for key, _count, min_rows in config_columns] == engine_columns
        # 默认行数不得低于计算下限，否则默认表格无法计算
        assert all(count >= min_rows for _key, count, min_rows in config_columns)
        config_defaults = {param["key"]: param["default"]
                           for param in item["params"]}
        assert config_defaults == engine._PARAM_DEFAULTS[engine_id]
