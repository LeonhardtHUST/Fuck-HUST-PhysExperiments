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


# ────────────────────────────────── 时差法（tof）：解码 / 剔除 / 拟合

def _tof_rows(n=12, v=1500.0, t0=20.0, start=40.0, step=20.0):
    """固定延迟模型 T = T0 + L/v（对应分析报告 Case F）：T0 使逐点 v 系统性偏低。"""
    distance = [start + step * i for i in range(n)]
    return {"L": distance, "T": [t0 + 1000.0 * l / v for l in distance]}


def _result(run, key):
    return next(item["value"] for item in run["results"] if item["key"] == key)


def test_tof_fit_is_the_primary_result():
    run = engine.analyze("tof", _tof_rows(), {})
    assert run["status"] == "success", run.get("errors")
    assert math.isclose(_result(run, "v_fit"), 1500.0, rel_tol=1e-9)
    assert math.isclose(_result(run, "slope"), 1000.0 / 1500.0, rel_tol=1e-6)
    assert math.isclose(_result(run, "intercept"), 20.0, abs_tol=1e-6)
    assert math.isclose(_result(run, "r2"), 1.0, abs_tol=1e-9)
    assert _result(run, "valid_points") == 12
    assert _result(run, "excluded_points") == 0
    assert run["warnings"] == []
    assert [item["key"] for item in run["results"]] == [
        "v_fit", "slope", "intercept", "r2", "error_rel",
        "v_mean", "v_std", "valid_points", "excluded_points",
    ]


def test_tof_pointwise_mean_stays_below_the_fit_under_fixed_delay():
    """固定延迟把短距离点拉低：逐点均值必须明显低于拟合声速，否则说明模型退化。"""
    run = engine.analyze("tof", _tof_rows(), {})
    assert run["status"] == "success", run.get("errors")
    assert _result(run, "v_mean") < 0.95 * _result(run, "v_fit")
    assert _result(run, "v_std") > 0.0


def test_tof_single_wrap_is_recovered_to_the_same_result():
    """T<0 视为有符号 16 位计数差；恢复后结果应与未回绕时完全一致。

    输入契约只有 T(μs) 一个字段（没有 count 层），故用 T-65536 等价模拟
    设备导出的有符号差值；真实 rx/tx 时间戳无法在本仓库构造。
    """
    plain = engine.analyze("tof", _tof_rows(), {})
    wrapped_rows = _tof_rows()
    wrapped_rows["T"][4] -= engine.TOF_COUNT_MOD
    wrapped = engine.analyze("tof", wrapped_rows, {})
    assert wrapped["status"] == "success", wrapped.get("errors")
    assert wrapped["arrays"]["recovered_rows"] == [5]
    assert math.isclose(_result(wrapped, "v_fit"), _result(plain, "v_fit"), rel_tol=1e-12)
    assert len(wrapped["warnings"]) == 1
    assert "第 5 行" in wrapped["warnings"][0]
    assert "回绕" in wrapped["warnings"][0]


def test_tof_never_shifts_positive_readings():
    """正数 T 一律原样使用：不做 ±65536，也不因离群而剔除。"""
    rows = _tof_rows()
    rows["T"][-1] += engine.TOF_COUNT_MOD
    run = engine.analyze("tof", rows, {})
    assert run["status"] == "success", run.get("errors")
    assert run["arrays"]["T"] == rows["T"]
    assert _result(run, "valid_points") == 12
    assert _result(run, "excluded_points") == 0


def test_tof_missing_rows_are_skipped_and_raw_table_keeps_every_row():
    rows = _tof_rows()
    for index in (0, 2, 5, 8, 11):
        rows["T"][index] = None
    run = engine.analyze("tof", rows, {})
    assert run["status"] == "success", run.get("errors")
    assert _result(run, "valid_points") == 7
    assert _result(run, "excluded_points") == 5
    assert run["arrays"]["dropped_rows"] == [1, 3, 6, 9, 12]
    assert len(run["warnings"]) == 5

    # 报告原始表必须保留全部录入行（表头 + 12 行），剔除行留空、行序不变
    raw_tables = [block for block in docs._raw_blocks([("tof", run)])
                  if block.get("kind") == "table"]
    assert len(raw_tables[0]["rows"]) == 13
    body = raw_tables[0]["rows"][1:]
    assert body[0][2]["text"] == ""          # 第 1 行 T 被剔除 → 留空
    assert body[1][2]["text"] != ""          # 第 2 行有效 → 保留


def test_tof_three_valid_points_are_enough():
    rows = {"L": [40.0, 80.0, 140.0, 200.0],
            "T": [46.666, 73.333, 113.333, None]}
    run = engine.analyze("tof", rows, {})
    assert run["status"] == "success", run.get("errors")
    assert _result(run, "valid_points") == 3
    assert math.isclose(_result(run, "v_fit"), 1500.0, rel_tol=1e-3)


def test_tof_two_valid_points_report_insufficient_points():
    rows = {"L": [40.0, 60.0, 80.0, 100.0],
            "T": [46.666, 60.0, None, None]}
    run = engine.analyze("tof", rows, {})
    assert run["status"] == "validation_error"
    message = "；".join(run["errors"])
    assert "有效点不足" in message
    assert "有效 2 点" in message
    assert "至少需要 3 点" in message
    assert "计算失败：" not in message


def test_tof_out_of_range_speed_only_warns():
    """把 count 当 μs 之类的单位错误只告警，由使用者核对；不整组判失败。"""
    rows = _tof_rows()
    rows["T"] = [value * 1000.0 for value in rows["T"]]
    run = engine.analyze("tof", rows, {})
    assert run["status"] == "success", run.get("errors")
    assert any("不在" in warning and "常见范围" in warning for warning in run["warnings"])


def test_tof_unrecoverable_negative_reading_is_dropped():
    rows = _tof_rows(n=6)
    rows["T"][0] = -20000.0
    run = engine.analyze("tof", rows, {})
    assert run["status"] == "success", run.get("errors")
    assert run["arrays"]["dropped_rows"] == [1]
    assert any("无法可靠解码" in warning for warning in run["warnings"])


def test_tof_zero_reading_is_dropped_instead_of_failing():
    rows = _tof_rows()
    rows["T"][2] = 0.0
    run = engine.analyze("tof", rows, {})
    assert run["status"] == "success", run.get("errors")
    assert run["arrays"]["dropped_rows"] == [3]
    assert _result(run, "valid_points") == 11


def test_tof_single_distance_and_reversed_slope_fail_with_reasons():
    same = {"L": [100.0, 100.0, 100.0], "T": [90.0, 90.0, 90.0]}
    flat = engine.analyze("tof", same, {})
    assert flat["status"] == "validation_error"
    assert any("有效传播距离种类不足" in error for error in flat["errors"])

    reversed_rows = {"L": [40.0, 80.0, 140.0], "T": [120.0, 90.0, 60.0]}
    backwards = engine.analyze("tof", reversed_rows, {})
    assert backwards["status"] == "validation_error"
    assert any("拟合斜率不为正" in error for error in backwards["errors"])


def test_tof_reproduces_the_reported_seven_point_dataset():
    """分析报告 §4 给出的 7 组可确认有效数据（数据源自报告，非设备原始导出）。"""
    rows = {"L": [40.0, 60.0, 80.0, 100.0, 140.0, 180.06, 240.0],
            "T": [45.0, 58.0, 71.0, 83.0, 109.0, 135.0, 174.0]}
    run = engine.analyze("tof", rows, {})
    assert run["status"] == "success", run.get("errors")
    assert math.isclose(_result(run, "v_fit"), 1552.8, rel_tol=1e-3)
    assert math.isclose(_result(run, "slope"), 0.6440025, rel_tol=1e-4)
    assert math.isclose(_result(run, "intercept"), 19.1428, rel_tol=2e-3)
    assert math.isclose(_result(run, "r2"), 0.999948, rel_tol=1e-4)
    assert math.isclose(_result(run, "error_rel"), 4.92, abs_tol=0.05)


def test_tof_report_text_states_fit_and_constant_reference():
    run = engine.analyze("tof", _tof_rows(), {})
    text = "\n".join(block.get("text", "") for block in docs._proc_1c(run))
    assert "1000/a" in text
    assert "R²" in text
    assert f"{engine.SOUND_WATER_REF:g}" in text
    assert "固定延迟" in text


def test_tof_report_text_lists_dropped_rows():
    rows = _tof_rows()
    rows["T"][2] = 0.0
    run = engine.analyze("tof", rows, {})
    text = "\n".join(block.get("text", "") for block in docs._proc_1c(run))
    assert "数据修复与剔除说明" in text
    assert "第 3 行" in text


def test_tof_process_method_exposes_warnings():
    rows = _tof_rows()
    rows["T"][2] = None
    payload = engine.process_method("tof", rows, {})
    assert payload["status"] == "success", payload.get("errors")
    assert isinstance(payload["warnings"], list) and len(payload["warnings"]) == 1


def test_soundlight_config_outputs_match_tof_results():
    config_path = (Path(__file__).parents[1] / "experiments" / "soundlight"
                   / "config.json")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    tof = next(item for item in config if item["id"] == "tof")
    run = engine.analyze("tof", _tof_rows(), {})
    assert [output["key"] for output in tof["outputs"]] == [
        item["key"] for item in run["results"]
    ]

