"""原始读数必须逐字进入报告：raw 通道优先，绝不按固定小数位重排。"""

import pytest

from experiments.core import documents
from experiments.core.registry import registry
from experiments.polarization import docbuild
from experiments.soundlight import docs


def test_fmt_keeps_strings_and_does_not_truncate_numbers():
    assert documents.fmt("1.20") == "1.20"
    assert documents.fmt("1.20e-3") == "1.20e-3"
    assert documents.fmt("0.000100") == "0.000100"
    # 12.3456789 不能被截成 12.345679，1.2 也不能被补成 1.200000
    assert documents.fmt(12.3456789) == "12.3456789"
    assert documents.fmt(1.2) == "1.2"


def test_generic_raw_table_prefers_rows_raw():
    experiment = registry.get("michelson")
    method = experiment.config["methods"][0]
    keys = [column["key"] for column in method["columns"]]
    payload = {
        "rows": [{key: 0.0 for key in keys}],
        "rows_raw": [{key: "0" for key in keys}],
    }
    payload["rows"][0][keys[-1]] = 1.2
    payload["rows_raw"][0][keys[-1]] = "1.20"

    block = documents._method_raw_table(method, payload)
    body = [cell["text"] for cell in block["rows"][1]]
    assert body[-1] == "1.20"


def test_generic_raw_table_falls_back_to_numbers():
    experiment = registry.get("michelson")
    method = experiment.config["methods"][0]
    keys = [column["key"] for column in method["columns"]]
    payload = {"rows": [{key: 1.2 for key in keys}]}
    block = documents._method_raw_table(method, payload)
    assert [cell["text"] for cell in block["rows"][1]][-1] == "1.2"


def test_polarization_raw_table_keeps_written_digits():
    data = {
        "malus": {
            "rows": [
                {
                    "theta": 90.0,
                    "i_left": 1.2,
                    "i_right": 2.0,
                    "raw": {"theta": "90.0", "i_left": "1.20", "i_right": "2.00"},
                }
            ]
        }
    }
    tables = docbuild._raw_input_tables(data)
    assert [cell["text"] for cell in tables["malus"][0]] == ["90.0", "1.20", "2.00"]


def test_polarization_halfwave_initial_keeps_minutes():
    data = {
        "halfwave": {
            "initial": {
                "c_deg": 10.0,
                "c_min": 5.0,
                "p2_deg": 20.0,
                "p2_min": 0.0,
                "raw": {"c_deg": "10.0", "c_min": "5", "p2_deg": "20.0", "p2_min": "0"},
            },
            "rows": [],
        }
    }
    tables = docbuild._raw_input_tables(data)
    assert [cell["text"] for cell in tables["halfwave_init"][0]] == ["C 初始消光位置", "10.0", "5"]


def test_soundlight_raw_columns_keep_written_digits():
    values = [10.0, 14.555]
    raw = {"air_resonance": {"rows_raw": {"l": ["10.00", "14.555"]}}}
    assert docs._raw_col(raw, "air_resonance", "l", values, 2) == ["10.00", "14.555"]
    # 没有 raw 时退回原来的按列位数（float 格式化，14.555 -> 14.55）
    assert docs._raw_col(None, "air_resonance", "l", values, 2) == ["10.00", "14.55"]


@pytest.mark.parametrize("text", ["1.20", "0.000100", "1.20e-3", "-0.030"])
def test_soundlight_formatter_passes_strings_through(text):
    assert docs._f(text, 2) == text


def test_generic_result_table_follows_precision_rules():
    experiment = registry.get("michelson")
    method = experiment.config["methods"][0]
    block = documents._result_table(
        method,
        {"wavelength": 632.8123, "relative_error": 1.2345, "delta_d_mean": 0.154},
        "michelson",
        [{"position": "12.30"}, {"position": "12.45"}],
    )
    cells = {row[0]["text"]: row[1]["text"] for row in block["rows"][1:]}
    labels = {field["key"]: field["label"] for field in method["results"]}
    assert cells[labels["wavelength"]] == "632.8"          # 4 位有效数字
    assert cells[labels["relative_error"]] == "1.23"       # 相对误差 2 位小数
    assert cells[labels["delta_d_mean"]] == "0.15"         # 与位置读数同末位


def test_soundlight_result_table_follows_precision_rules():
    run = {"method": "light_sine", "results": [
        {"key": "c_exp", "label": "实验光速", "value": 299792458.0, "unit": "m/s"},
        {"key": "error_rel", "label": "相对误差", "value": 1.23456, "unit": "%"},
        {"key": "data_points", "label": "数据点数", "value": 6.0, "unit": ""},
    ]}
    block = docs._result_table(run, "light_sine", {})
    texts = [row[1]["text"] for row in block["rows"][1:]]
    assert texts == ["2.998e8", "1.23", "6"]
