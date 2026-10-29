"""派生量的有效数字规则：位数从哪来，必须能回答。

原始读数（学生写在记录纸上的数字）永远走字符串原样通道，不经过本模块。
本模块只管「由读数算出来的量」：拟合斜率、平均值、不确定度、相对误差……
每条规则都带 ``source`` 与 ``rationale``，``python -m experiments.core.precision --audit``
可以把全部结果键的位数来源打印出来，避免出现没人知道为什么是 3 位的数字。

规则解析顺序（``precision_for``）：

1. 精确规则 ``RESULT_RULES[(实验, 方法, 键)]``
2. 实验通配 ``RESULT_RULES[(实验, "*", 键)]``
3. 全局键名规则 ``GLOBAL_KEY_RULES``（百分比、R²、计数、不确定度…）
4. 列继承：结果键与某个读数列同名/同前缀 → 与读数同末位
5. 单位默认：``UNIT_SIGFIG``（派生单位按有效数字）→ ``UNIT_PLACES``（直读量按小数位）
6. 兜底 4 位有效数字（审计会点名，新增结果键时应当显式补规则）
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from experiments.core.sigfig import (
    SIG_MAX,
    SIG_MIN,
    format_places,
    format_readout,
    format_sig,
    parse_readout,
)

__all__ = [
    "Precision",
    "Rule",
    "RESULT_RULES",
    "precision_for",
    "format_result",
    "explain",
    "DEFAULT_PRECISION",
]


@dataclass(frozen=True)
class Rule:
    """``kind`` 取值：sig / places / pct / int / unc / column。"""

    kind: str
    value: int | str | None = None
    note: str = ""


@dataclass(frozen=True)
class Precision:
    places: int | None = None
    sigfigs: int | None = None
    source: str = ""
    rationale: str = ""

    def format(self, value: Any) -> str:
        if value is None or value == "":
            return ""
        # 字符串是原始读数或上游已排版好的文本，原样透传。
        if isinstance(value, str):
            return format_readout(value)
        try:
            number = float(value)
        except (TypeError, ValueError):
            return str(value)
        # 退化数据（读数正好等于背景、除零）会算出 inf/nan：与旧行为一致，打印占位符。
        if not math.isfinite(number):
            return "—"
        try:
            if self.sigfigs is not None:
                return format_sig(number, self.sigfigs)
            if self.places is not None:
                return format_places(number, self.places)
        except (TypeError, ValueError):
            return str(value)
        return str(value)


DEFAULT_PRECISION = Precision(sigfigs=4, source="default:sig4", rationale="未声明规则，按 4 位有效数字")


def _sig(n: int, note: str) -> Rule:
    return Rule("sig", max(SIG_MIN, min(SIG_MAX, n)), note)


def _places(n: int, note: str) -> Rule:
    return Rule("places", n, note)


def _column(key: str, note: str) -> Rule:
    return Rule("column", key, note)


# 只写「默认规则答不上来」的例外：定标量（波长、普朗克常数、声速…）
# 与逐差/平均值（必须与读数同末位）两类。
RESULT_RULES: dict[tuple[str, str, str], Rule] = {
    # 迈克尔逊：氦氖激光波长 632.8 nm，仪器给到 4 位
    ("michelson", "wavelength", "wavelength"): _sig(4, "激光波长按 4 位有效数字报告（632.8 nm）"),
    ("michelson", "wavelength", "delta_d_mean"): _column("position", "逐差平均与位置读数同末位"),
    ("michelson", "wavelength", "delta_d_std"): _column("position", "标准差与位置读数同末位"),
    # 光电效应：h ~ 6.626e-34 J·s，4 位；逸出功 ~eV，3 位
    ("photoelectric", "*", "h"): _sig(4, "普朗克常数按 4 位有效数字报告"),
    ("photoelectric", "*", "nu0"): _sig(4, "截止频率按 4 位有效数字报告"),
    ("photoelectric", "*", "work_function"): _sig(3, "逸出功量级 eV，3 位有效数字"),
    ("photoelectric", "*", "max_current"): _sig(3, "饱和电流 3 位有效数字"),
    ("photoelectric", "*", "min_current"): _sig(3, "最小电流 3 位有效数字"),
    ("photoelectric-franck-hertz", "*", "h"): _sig(4, "普朗克常数按 4 位有效数字报告"),
    ("photoelectric-franck-hertz", "*", "nu0"): _sig(4, "截止频率按 4 位有效数字报告"),
    ("photoelectric-franck-hertz", "*", "work_function"): _sig(3, "逸出功量级 eV，3 位有效数字"),
    ("photoelectric-franck-hertz", "*", "max_current"): _sig(3, "饱和电流 3 位有效数字"),
    ("photoelectric-franck-hertz", "*", "min_current"): _sig(3, "最小电流 3 位有效数字"),
    # 弗兰克-赫兹：峰值电压读数 0.1 V
    ("franck-hertz", "peaks", "v0"): _places(1, "峰值电压由 0.1 V 分度的电压表读出"),
    ("franck-hertz", "peaks", "spacing_std"): _places(2, "峰间距标准差比读数多留一位"),
    ("franck-hertz", "*", "current_max"): _sig(3, "峰值电流 3 位有效数字"),
    # 核磁共振：旋磁比与 g 因子都是 4 位
    ("nmr", "*", "gamma"): _sig(4, "旋磁比按 4 位有效数字报告"),
    ("nmr", "*", "g_factor"): _sig(4, "g 因子按 4 位有效数字报告"),
    ("nmr", "waveform", "max_symmetry_error"): _places(2, "波形对称性误差按 0.01 ms 报告"),
    # 多量程电表：斜率 4 位、截距按读数末位、最大偏差 2 位
    ("multimeter", "*", "slope"): _sig(4, "校准斜率按 4 位有效数字"),
    ("multimeter", "*", "intercept"): _places(1, "截距与电表读数末位一致"),
    ("multimeter", "*", "max_abs_error"): _places(2, "最大偏差比读数多留一位"),
    ("multimeter", "unknown", "mean_reference"): _places(2, "参考读数平均与读数同末位"),
    ("multimeter", "unknown", "mean_measured"): _places(2, "测量读数平均与读数同末位"),
    # 电桥
    ("bridge", "balanced", "rx_mean"): _sig(4, "平衡电阻按 4 位有效数字"),
    ("bridge", "balanced", "theory"): _sig(4, "理论值按 4 位有效数字"),
    ("bridge", "cu50", "r0"): _places(2, "Pt100/Cu50 电阻箱读至 0.01 Ω"),
    ("bridge", "cu50", "alpha"): _sig(4, "温度系数按 4 位有效数字"),
    ("bridge", "capacitor", "cx"): _sig(4, "电容按 4 位有效数字"),
    ("bridge", "capacitor", "rc"): _sig(4, "等效电阻按 4 位有效数字"),
    ("bridge", "capacitor", "tan_delta"): _sig(3, "损耗角正切 3 位有效数字"),
    ("bridge", "inductor", "lx"): _sig(4, "电感按 4 位有效数字"),
    ("bridge", "inductor", "rl"): _sig(4, "等效电阻按 4 位有效数字"),
    ("bridge", "inductor", "q"): _sig(3, "品质因数 3 位有效数字"),
    ("bridge", "thermistor", "b_constant"): _sig(4, "材料常数 B 按 4 位有效数字"),
    ("bridge", "thermistor", "r25"): _places(2, "25 ℃ 电阻读至 0.01 Ω"),
    # 霍尔传感器
    ("gmr", "*", "sensitivity"): _sig(3, "灵敏度 3 位有效数字"),
    ("gmr", "*", "sensitivity_up"): _sig(3, "灵敏度 3 位有效数字"),
    ("gmr", "*", "sensitivity_down"): _sig(3, "灵敏度 3 位有效数字"),
    ("gmr", "*", "sensitivity25"): _sig(3, "灵敏度 3 位有效数字"),
    ("gmr", "*", "sensitivity100"): _sig(3, "灵敏度 3 位有效数字"),
    ("gmr", "transfer", "hysteresis"): _places(1, "磁滞按 0.1 mV 报告"),
    ("gmr", "transfer", "b_max"): _sig(4, "最大磁感应强度按 4 位有效数字"),
    ("gmr", "resistance", "gmr_a"): _sig(3, "磁电阻比 3 位有效数字"),
    ("gmr", "resistance", "gmr_b"): _sig(3, "磁电阻比 3 位有效数字"),
    # 表面张力
    ("surface-tension", "*", "sensitivity"): _sig(3, "传感器灵敏度 3 位有效数字"),
    ("surface-tension", "*", "sensitivity_used"): _sig(3, "传感器灵敏度 3 位有效数字"),
    ("surface-tension", "*", "sigma"): _sig(3, "表面张力系数 3 位有效数字"),
    ("surface-tension", "*", "sigma_std"): _sig(2, "标准差取 2 位有效数字"),
    ("surface-tension", "*", "sigma_reference"): _sig(3, "参考值 3 位有效数字"),
    ("surface-tension", "*", "absolute_error"): _sig(2, "绝对误差取 2 位有效数字"),
    ("surface-tension", "*", "height"): _places(2, "液柱高度读至 0.01 mm"),
    ("surface-tension", "*", "diameter"): _places(2, "毛细管内径读至 0.01 mm"),
    # 导热系数
    ("thermal-conductivity", "*", "cooling_rate"): _sig(3, "冷却速率 3 位有效数字"),
    ("thermal-conductivity", "*", "lambda"): _sig(4, "导热系数按 4 位有效数字"),
    ("thermal-conductivity", "*", "geometry_factor"): _sig(4, "几何因子按 4 位有效数字"),
    ("thermal-conductivity", "heating", "t1"): _places(1, "温度读至 0.1 ℃"),
    ("thermal-conductivity", "heating", "t2"): _places(1, "温度读至 0.1 ℃"),
    ("thermal-conductivity", "heating", "steady_drift"): _places(2, "温度漂移 0.01 ℃"),
    # 粘滞系数
    ("viscosity", "diameter", "diameter"): _column("x1", "钢球直径由边缘坐标相减，与读数同末位"),
    ("viscosity", "diameter", "diameter_std"): _places(3, "直径标准差比读数多留一位"),
    ("viscosity", "*", "eta_20"): _sig(3, "粘滞系数 3 位有效数字"),
    ("viscosity", "*", "eta_mean"): _sig(3, "粘滞系数 3 位有效数字"),
    ("viscosity", "*", "re_min"): _sig(3, "雷诺数 3 位有效数字"),
    ("viscosity", "*", "re_max"): _sig(3, "雷诺数 3 位有效数字"),
    # 太阳能电池
    ("solar-cell", "*", "p_max"): _sig(3, "最大功率 3 位有效数字"),
    ("solar-cell", "*", "u_opt"): _places(2, "最佳工作电压读至 0.01 V"),
    ("solar-cell", "*", "i_opt"): _places(1, "最佳工作电流读至 0.1 mA"),
    ("solar-cell", "*", "fill_factor"): _sig(3, "填充因子 3 位有效数字"),
    ("solar-cell", "*", "energy"): _sig(3, "能量 3 位有效数字"),
    ("solar-cell", "*", "power_before"): _sig(3, "功率 3 位有效数字"),
    ("solar-cell", "*", "power_after"): _sig(3, "功率 3 位有效数字"),
    ("solar-cell", "*", "power_gain"): _sig(3, "功率 3 位有效数字"),
    ("solar-cell", "*", "input_power"): _sig(3, "输入功率 3 位有效数字"),
    ("solar-cell", "*", "unshaded_isc"): _places(1, "短路电流读至 0.1 mA"),
    ("solar-cell", "*", "minimum_ratio"): _sig(3, "最低电流占比 3 位有效数字"),
    ("solar-cell", "*", "final_voltage"): _places(2, "终止电压读至 0.01 V"),
    ("solar-cell", "*", "duration"): _places(1, "充电时长读至 0.1 min"),
    # 声速光速：速度量按 4 位有效数字，逐差平均与读数同末位
    ("sound-light", "*", "v_exp"): _sig(4, "声速按 4 位有效数字报告"),
    ("sound-light", "*", "v_theory"): _sig(4, "理论声速按 4 位有效数字报告"),
    ("sound-light", "*", "v"): _sig(4, "声速按 4 位有效数字报告"),
    ("sound-light", "*", "v_fit"): _sig(4, "拟合声速按 4 位有效数字报告"),
    ("sound-light", "*", "v_mean"): _sig(4, "平均声速按 4 位有效数字报告"),
    ("sound-light", "*", "v_std"): _sig(3, "速度标准差 3 位有效数字"),
    ("sound-light", "*", "c_exp"): _sig(4, "光速按 4 位有效数字报告"),
    ("sound-light", "*", "error_abs"): _sig(3, "绝对误差 3 位有效数字"),
    ("sound-light", "*", "delta_l_mean"): _column("l", "逐差平均间距与共振位置读数同末位"),
    ("sound-light", "*", "s_delta_l"): _column("l", "逐差标准差与共振位置读数同末位"),
    ("sound-light", "*", "delta_x_mean"): _column("x1", "逐差平均位移与位置读数同末位"),
    ("sound-light", "*", "delta_t_mean"): _column("T", "逐差平均时间与周期读数同末位"),
    ("sound-light", "*", "t_mean"): _column("T", "时间平均与周期读数同末位"),
    ("sound-light", "*", "slope"): _sig(4, "拟合斜率按 4 位有效数字"),
    ("sound-light", "*", "intercept"): _places(1, "截距与示波器读数末位一致"),
    ("sound-light", "*", "r_mean"): _sig(4, "距离比按 4 位有效数字"),
    # 偏振光（报告里的 summary 键）
    ("polarization", "*", "slope"): _sig(3, "马吕斯拟合斜率 3 位有效数字"),
    ("polarization", "*", "theory_slope"): _sig(3, "理论斜率 3 位有效数字"),
    ("polarization", "*", "intercept"): _sig(3, "拟合截距 3 位有效数字"),
    ("polarization", "*", "extinction_ratio"): _sig(3, "消光比 3 位有效数字"),
    ("polarization", "*", "degree_of_polarization"): _sig(3, "偏振度 3 位有效数字"),
    ("polarization", "*", "ratio_exp"): _sig(3, "光强比 3 位有效数字"),
    ("polarization", "*", "ratio_theory"): _sig(3, "理论光强比 3 位有效数字"),
    ("polarization", "*", "ratio"): _sig(3, "光强比 3 位有效数字"),
    ("polarization", "*", "I_max_exp"): _places(2, "光强计读至 0.01 μW"),
    ("polarization", "*", "I_min_exp"): _places(2, "光强计读至 0.01 μW"),
    ("polarization", "*", "I_max"): _places(2, "光强计读至 0.01 μW"),
    ("polarization", "*", "I_min"): _places(2, "光强计读至 0.01 μW"),
    ("polarization", "*", "I_mean"): _places(2, "光强计读至 0.01 μW"),
    ("polarization", "*", "A_avg"): _places(2, "振幅参数与光强读数同量级"),
    ("polarization", "*", "A_from_max"): _places(2, "振幅参数与光强读数同量级"),
    ("polarization", "*", "A_from_min"): _places(2, "振幅参数与光强读数同量级"),
    ("polarization", "*", "A_nl_fit"): _places(2, "非线性拟合振幅 0.01 μW"),
    ("polarization", "*", "std_dev"): _places(3, "标准差比读数多留一位"),
    ("polarization", "*", "theta_qwp"): _places(1, "波片刻度读至 0.1°"),
    ("polarization", "*", "theta_nl_fit"): _places(2, "拟合角度 0.01°"),
    ("polarization", "*", "theta_nl_err"): _places(2, "拟合角度误差 0.01°"),
    ("polarization", "*", "max_abs_error"): _places(2, "最大偏差 0.01"),
    ("polarization", "*", "cos2theta"): _places(4, "cos²θ 为中间量，4 位小数足够定位"),
    ("polarization", "*", "I_corrected"): _places(2, "背景修正列与光强读数同末位"),
    ("polarization", "*", "delta_c"): _places(1, "角度差值与度盘读数同末位（0.1°）"),
    ("polarization", "*", "delta_p2"): _places(1, "角度差值与度盘读数同末位（0.1°）"),
    ("polarization", "*", "delta_error_minute"): _places(0, "分度读到 1′，ΔP2−2ΔC 以整分报告"),
}

_PCT_KEYS = re.compile(
    r"(relative_error|error_rel|relative_diff_pct|slope_deviation_pct|alpha_error|r0_error|"
    r"h_error|minimum_ratio|_pct$|^cv_pct$|percent)"
)
_R2_KEYS = re.compile(r"^(r_squared|r_squared_\d+|r2|r_squared_raw)$")
_COUNT_KEYS = re.compile(
    r"^(data_points|valid_points|excluded_points|observed_rows|sample_count|groups|rows|points)$"
)
_UNC_KEYS = re.compile(r"^(u_a|u_b|uncertainty|u)$")
_STD_KEYS = re.compile(r"(_std$|^std_dev$|_sd$)")
# 状态码/文字结论不是数值，原样打印
_TEXT_KEYS = re.compile(r"(_code$|_state$|^state$|_trend$)")

GLOBAL_KEY_RULES: tuple[tuple[re.Pattern[str], Rule], ...] = (
    (_PCT_KEYS, Rule("pct", 2, "百分比/相对误差按 2 位小数报告")),
    (_R2_KEYS, Rule("places", 4, "拟合优度 R² 按 4 位小数报告")),
    (_COUNT_KEYS, Rule("int", None, "计数为精确整数")),
    (_UNC_KEYS, Rule("unc", None, "A 类不确定度按 U 的修约规则")),
    (_STD_KEYS, Rule("sig", 3, "标准差取 3 位有效数字")),
    (_TEXT_KEYS, Rule("text", None, "状态码/文字结论，原样打印")),
)

# 直接测量量：按仪器能读到的末位（小数位）报告
UNIT_PLACES: dict[str, int] = {
    "mm": 2, "cm": 2, "m": 3, "km": 3, "nm": 1,
    "V": 2, "mV": 2, "kV": 3, "A": 3, "mA": 2, "μA": 1, "nA": 1,
    "W": 3, "mW": 2, "μW": 2,
    "Ω": 2, "kΩ": 3, "MΩ": 3,
    "μF": 2, "nF": 1, "mH": 2, "H": 3,
    "μs": 1, "ms": 2, "s": 2, "min": 2, "h": 2,
    "°C": 1, "K": 1, "°": 1, "′": 0, "%": 2,
    "Hz": 2, "kHz": 3, "MHz": 3, "Gs": 2, "mT": 2,
}

# 派生量：按有效数字报告（单位本身就说明是算出来的）
UNIT_SIGFIG: dict[str, int] = {
    "m/s": 4, "Pa·s": 3, "W/(m·K)": 4, "J·s": 4, "MHz/T": 4,
    "N/m": 3, "mV/Gs": 3, "mV/A": 3, "μs/mm": 4, "mm/μs": 4,
    "eV": 3, "J": 3, "mW": 3, "Pa": 3,
}


def _column_profile(
    key: str,
    columns: Sequence[Mapping[str, Any]] | None,
    rows: Sequence[Mapping[str, Any]] | None,
) -> tuple[int | None, str | None]:
    """某读数末位：同一列取最细的一位（仪器能读到的最小分度）。"""
    if not rows:
        return None, None
    places: list[int] = []
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        readout = parse_readout(row.get(key))
        if readout is not None:
            places.append(readout.places)
    if not places:
        return None, None
    return max(places), key


def _match_column(key: str, columns: Sequence[Mapping[str, Any]] | None) -> str | None:
    """结果键与读数列同名/同词干时，沿用该列的末位。"""
    if not columns:
        return None
    candidates = [str(column.get("key", "")) for column in columns if column.get("key")]
    for name in candidates:
        if key == name or key.startswith(f"{name}_") or key.endswith(f"_{name}"):
            return name
        if key.startswith("delta_") and key[len("delta_"):].split("_")[0] == name:
            return name
    return None


def _apply(rule: Rule, *, source: str, experiment_id: str, method_id: str, key: str,
           unit: str | None, columns, rows) -> Precision | None:
    if rule.kind == "column":
        places, column_key = _column_profile(str(rule.value), columns, rows)
        if places is None:
            return None
        return Precision(places=places, source=f"{source}<-{column_key}",
                         rationale=rule.note or f"与 {column_key} 列读数同末位")
    if rule.kind == "sig":
        return Precision(sigfigs=int(rule.value), source=source, rationale=rule.note)
    if rule.kind == "places":
        return Precision(places=int(rule.value), source=source, rationale=rule.note)
    if rule.kind == "pct":
        return Precision(places=int(rule.value or 2), source=source,
                         rationale=rule.note or "百分比按 2 位小数")
    if rule.kind == "int":
        return Precision(places=0, source=source, rationale=rule.note or "计数为整数")
    if rule.kind == "unc":
        return Precision(sigfigs=2, source=source,
                         rationale=rule.note or "不确定度按首位 1/2 取 2 位")
    if rule.kind == "text":
        return Precision(source=source, rationale=rule.note or "文字结论，原样打印")
    return None


def precision_for(
    experiment_id: str,
    method_id: str,
    key: str,
    *,
    unit: str | None = None,
    rows: Sequence[Mapping[str, Any]] | None = None,
    columns: Sequence[Mapping[str, Any]] | None = None,
) -> Precision:
    exact = RESULT_RULES.get((experiment_id, method_id, key))
    if exact is not None:
        applied = _apply(exact, source=f"rule:exact:{experiment_id}/{method_id}.{key}",
                         experiment_id=experiment_id, method_id=method_id, key=key,
                         unit=unit, columns=columns, rows=rows)
        if applied is not None:
            return applied

    wildcard = RESULT_RULES.get((experiment_id, "*", key))
    if wildcard is not None:
        applied = _apply(wildcard, source=f"rule:exact:{experiment_id}/*.{key}",
                         experiment_id=experiment_id, method_id=method_id, key=key,
                         unit=unit, columns=columns, rows=rows)
        if applied is not None:
            return applied

    for pattern, rule in GLOBAL_KEY_RULES:
        if pattern.search(key):
            name = {_PCT_KEYS: "percent", _R2_KEYS: "r2", _COUNT_KEYS: "count",
                    _UNC_KEYS: "uncertainty", _STD_KEYS: "std",
                    _TEXT_KEYS: "text"}.get(pattern, "global")
            return _apply(rule, source=f"global:{name}:{key}", experiment_id=experiment_id,
                          method_id=method_id, key=key, unit=unit,
                          columns=columns, rows=rows) or DEFAULT_PRECISION

    matched = _match_column(key, columns)
    if matched:
        places, column_key = _column_profile(matched, columns, rows)
        if places is not None:
            return Precision(places=places, source=f"column:{experiment_id}/{method_id}.{key}<-{column_key}",
                             rationale=f"结果与 {column_key} 列读数同末位")

    if unit and unit in UNIT_SIGFIG:
        return Precision(sigfigs=UNIT_SIGFIG[unit], source=f"unit:significant:{unit}",
                         rationale=f"派生单位 {unit} 按 {UNIT_SIGFIG[unit]} 位有效数字")
    if unit and unit in UNIT_PLACES:
        return Precision(places=UNIT_PLACES[unit], source=f"unit:places:{unit}",
                         rationale=f"{unit} 量按 {UNIT_PLACES[unit]} 位小数报告")

    return DEFAULT_PRECISION


def format_result(
    value: Any,
    experiment_id: str,
    method_id: str,
    key: str,
    *,
    unit: str | None = None,
    rows: Sequence[Mapping[str, Any]] | None = None,
    columns: Sequence[Mapping[str, Any]] | None = None,
) -> str:
    """派生量唯一的格式化入口。"""
    return precision_for(
        experiment_id, method_id, key, unit=unit, rows=rows, columns=columns
    ).format(value)


def explain(
    experiment_id: str,
    method_id: str,
    key: str,
    *,
    unit: str | None = None,
    rows: Sequence[Mapping[str, Any]] | None = None,
    columns: Sequence[Mapping[str, Any]] | None = None,
) -> Precision:
    return precision_for(experiment_id, method_id, key, unit=unit, rows=rows, columns=columns)


# --------------------------------------------------------------------------- #
# 审计：把每个结果键的位数来源打印出来，新增实验时用它检查是否落到兜底规则
# --------------------------------------------------------------------------- #

def _iter_config_results(experiment_id: str | None) -> Iterable[tuple[str, str, str, str]]:
    root = Path(__file__).resolve().parents[2] / "experiments"
    for config_path in sorted(root.glob("*/config.json")):
        raw = json.loads(config_path.read_text(encoding="utf-8"))
        if isinstance(raw, list):  # 声速光速：顶层是方法数组
            experiment = raw[0].get("experiment_id") if raw else None
            experiment = experiment or "sound-light"
            for method in raw:
                for output in method.get("outputs", []):
                    yield experiment, str(method.get("id", "")), str(output.get("key", "")), str(output.get("unit", ""))
            continue
        experiment = str(raw.get("id", config_path.parent.name))
        for method in raw.get("methods", []):
            for result in method.get("results", []):
                yield experiment, str(method.get("id", "")), str(result.get("key", "")), str(result.get("unit", ""))
    if experiment_id:
        return


def audit(experiment_id: str | None = None) -> int:
    rows = list(_iter_config_results(experiment_id))
    print(f"{'实验':22} {'方法':20} {'结果键':22} {'单位':10} {'位数':10} 来源")
    fallback = 0
    for experiment, method, key, unit in rows:
        if experiment_id and experiment != experiment_id:
            continue
        precision = precision_for(experiment, method, key, unit=unit or None)
        digits = f"sig{precision.sigfigs}" if precision.sigfigs is not None else f"dec{precision.places}"
        if precision.source == DEFAULT_PRECISION.source:
            fallback += 1
        print(f"{experiment:22} {method:20} {key:22} {unit:10} {digits:10} {precision.source}")
    print(f"\n共 {len(rows)} 项；落到兜底规则 {fallback} 项", file=sys.stderr)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="派生量有效数字规则审计")
    parser.add_argument("--audit", action="store_true", help="打印每个结果键的位数来源")
    parser.add_argument("--experiment", default=None, help="只看某个实验")
    args = parser.parse_args(argv)
    if args.audit or args.experiment:
        return audit(args.experiment)
    parser.print_help()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
