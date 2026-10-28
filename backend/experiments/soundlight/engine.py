#!/usr/bin/env python3
"""声速光速的测量（exp02）— 数据分析引擎。

对外接口：
    process_method(method, rows, params) -> dict
        返回 {status, errors, results, plots} 供前端展示。
    analyze(method, rows, params) -> dict
        返回 {status, errors, results, plots, arrays, params_used} 供报告生成使用。

rows: dict[str, list]，每列为 list[float | None]（长度须与方法输入列一致）。
params: dict[str, float]，未给出的参数使用默认值。

计算规则与单位换算（行数可自由增删，以 config 的 min_rows 为下限；n=12/3 与讲义一致）：
  A. air_resonance  空气中共振法：输入 l(mm) n 个 + {temperature_degC=25.0, f_khz=38}。
       逐差 k=n//2 组：Δl_i=(l[i+k]-l[i])/k (mm, i=0..k-1；n=12 时 k=6)；
       波长 λ=2*mean(Δl) 由 mm 换算为 m；
       实验声速 v_exp = f_khz*1000 * λ_m；理论声速 v_theory = 331.45*sqrt(1+t/273.15)
       （理想气体声速根式温度修正，讲义式）。
  B. water_phase    水中相位法：输入 l(mm) n 个 + {f_mhz=1.0}，同上逐差；
       v = f_mhz*1e6 * λ_m。A 类不确定度：s=std(Δl,ddof=1)，
       U_A_Δl_m = t95(k-1)*s/√k 再换算为米（n=12 → 2.571*s/√6，与讲义一致）；
       U_A(m/s) = 2*f_Hz*U_A_Δl_m（因 v=f*2*Δl_m）。
  C. tof            飞行时间法：输入 L(mm)、T(μs) 各 n 个（n≥3，讲义：连续 12 组）。
       流水线：计数域解码 → 行级有效性 → 拟合 → 主结果。
       a) 解码：T<0 视为设备按有符号 16 位计数差导出，仅尝试单次回绕 T+65536；
          正数 T 原样使用，绝不机械加减模数。
       b) 有效性：T 缺失/非数字、T=0、L≤0 的行逐行剔除并记 warning；
          剔除后有效点仍 ≥3 即继续，<3 才失败。
       c) 拟合：T = aL + b，主结果 v = 1000/a (m/s)；逐点 v_i = 1000*L_i/T_i
          仅作诊断（固定系统延迟 T0 使逐点值系统性偏低）。
  D. light_sine     光速正弦法：输入 T(μs)、Δt(μs)、x1(mm)、x2(mm) 各 n 个（n≥2）+ {f_mhz=150, c_ref=2.998e8}。
       Δx_i=|x2-x1|；逐点 r_i=Δx_i/Δt_i (mm/μs)，平均值 r_mean（讲义：计算 Δx/Δt 的平均值）；
       λ(mm) = 2*T_mean(μs)*r_mean(mm/μs)，λ_m = λ_mm*1e-3；c_exp = f_mhz*1e6 * λ_m；
       结果含绝对误差 error_abs（|c_exp-c_ref|）。
  E. light_lissajous 光速李萨如法：输入 x1(mm)、x2(mm) 各 n 个（n≥2）；λ = 4*Δx_mean（mm→m）；
       c_exp = f_mhz*1e6 * λ_m。
"""

from __future__ import annotations

import base64
import io
import json
import math
import re
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from experiments.core.numerics import fit

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Noto Sans CJK SC", "WenQuanYi Micro Hei", "Microsoft YaHei", "SimHei", "DejaVu Sans"],
    "axes.unicode_minus": False,
    "figure.dpi": 150,
    "savefig.dpi": 200,
})

BLUE = "#2563eb"
ORANGE = "#f59e0b"
RED = "#dc2626"
GREEN = "#10b981"
GRAY = "#6b7280"

with (Path(__file__).with_name("config.json")).open(encoding="utf-8") as _config_file:
    _CONFIG = json.load(_config_file)
_METHOD_CONFIG = {item["id"]: item for item in _CONFIG}
_METHOD_NAMES = {method: item["name"] for method, item in _METHOD_CONFIG.items()}

# Calculation validation and the public config consume the same field schema.
# count = 讲义推荐条数（仅作为前端默认行数），min_rows = 计算所需最少条数。
_COLUMNS = {
    method: [(column["key"], int(column.get("min_rows", 1)),
              f'{column["label"]} ({column["unit"]})')
             for column in item["table_cols"]]
    for method, item in _METHOD_CONFIG.items()
}
_PARAM_DEFAULTS = {
    method: {param["key"]: param["default"] for param in item["params"]}
    for method, item in _METHOD_CONFIG.items()
}

V0 = 331.45   # 0 °C 空气中声速参考值 (m/s)
T0 = 273.15   # 绝对零度参考 (K)

# 时差法（tof）解码与验收常量。参考值只在这里定义，docs.py 通过别名复用。
SOUND_WATER_REF = 1480.0               # 水中声速常用参考值 (m/s)
TOF_COUNT_MOD = 65536                  # 16 位计数器模数；65535 是最大计数值，不是模数
TOF_WRAP_SPEED_BAND = (500.0, 3000.0)  # 回绕恢复闸门：恢复后隐式声速必须落在该带宽内
TOF_UNIT_SPEED_BAND = (100.0, 10000.0)  # 最终拟合声速的合理性界限，越界只告警（疑单位错误）
TOF_MIN_VALID_POINTS = 3               # 能否拟合的有效点下限（与 config 的 min_rows 一致）


class TofDecodeError(ValueError):
    """时差法数据在解码/有效性层就无法计算；消息可直接展示给用户（不加「计算失败：」前缀）。"""

# Student t 因子（置信 95%，双侧），下标为自由度；自由度超出查表范围时用正态近似。
_T95_BY_DOF = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
    26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
}


# ──────────────────────────────────────────────── rounding helpers

def _sig(x, n=4):
    """Round to n significant figures."""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if x == 0 or not math.isfinite(x):
        return x
    digits = n - 1 - int(math.floor(math.log10(abs(x))))
    return round(x, digits)


def _mean(vals):
    return sum(vals) / len(vals)


def _t95(dof: int) -> float:
    """置信 95% 的 Student t 因子；dof 越大越接近 1.96。"""
    dof = max(1, int(dof))
    return _T95_BY_DOF.get(dof, 1.96 if dof > 30 else 12.706)


def progressive_difference(values):
    """逐差法：n 个读数取 k = n//2 组，Δ_i = |l[i+k] - l[i]| / k。

    n=12 时 k=6，与讲义「隔 6 次相减、共 6 组」完全一致；
    n=10 时 k=5；奇数个数据时末尾 1 点（中点）不参与逐差。
    """
    n = len(values)
    k = n // 2
    if k < 2:
        raise ValueError(f"逐差法至少需要 4 个数据，当前只有 {n} 个")
    return k, [abs(values[i + k] - values[i]) / k for i in range(k)]


# ──────────────────────────────────────────────── validation

def _parse_col(rows, key, min_len, label, errors, *, lenient=False):
    """Extract numeric column; return list[float|None] or None on structural error.

    行数可以自由增删，只要不少于 min_len（列长度下限）即可。
    lenient=True（仅时差法）时，无法识别为数字的格子留 None 交给行级剔除，
    不再整表报错；min_len 与「有效点数下限」是两个独立检查，不能互相替代。
    """
    raw = rows.get(key)
    if not isinstance(raw, list):
        errors.append(f"{label}：缺少该数据列，请检查输入")
        return None
    if len(raw) < min_len:
        errors.append(f"{label}：至少需要 {min_len} 个数据，实际收到 {len(raw)} 个")
        return None
    out = [None] * len(raw)
    n_valid = 0
    for i, v in enumerate(raw):
        if v is None:
            continue
        if isinstance(v, str):
            v = v.strip()
            if v == "":
                continue
        try:
            value = float(v)
            if isinstance(v, bool) or not math.isfinite(value):
                raise ValueError("需要有限数值")
            out[i] = value
            n_valid += 1
        except (TypeError, ValueError):
            if not lenient:
                errors.append(f"{label}：第 {i + 1} 个数据无法识别为数字")
    if n_valid == 0:
        errors.append(f"{label}：该列数据为空，请填写完整")
    return out


def _parse_params(method, params):
    used = {}
    defaults = _PARAM_DEFAULTS[method]
    params = params or {}
    for key, dflt in defaults.items():
        try:
            used[key] = float(params.get(key, dflt))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"参数 {key} 必须为有效数值") from exc
        if isinstance(params.get(key), bool) or not math.isfinite(used[key]):
            raise ValueError(f"参数 {key} 必须为有限数值")
        if key == "temperature_degC":
            if used[key] <= -T0:
                raise ValueError("环境温度必须高于绝对零度")
        elif used[key] <= 0:
            raise ValueError(f"参数 {key} 必须大于零")
    return used


# ──────────────────────────────────────────────── figures

def _fig_b64(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _positions_fig(xs, ls, title, dlm, lam_mm, extra):
    """air / water 通用主图：测量序号 vs 位置 l(mm)。"""
    fig, ax = plt.subplots(figsize=(8.2, 4.4))
    ax.grid(True, ls=":", lw=0.6, alpha=0.7)
    ax.plot(xs, ls, "-o", color=BLUE, ms=5, lw=1.4, label="测量点")
    txt = f"逐差平均间距 Δl ≈ {dlm:.4f} mm（≈ λ/2，λ ≈ {lam_mm:.4f} mm）"
    if extra:
        txt += "\n" + extra
    ax.text(0.02, 0.97, txt, transform=ax.transAxes, fontsize=9.5, va="top",
            bbox=dict(boxstyle="round,pad=0.35", fc="#f1f5f9", ec=BLUE, alpha=0.92))
    ax.set_xlabel("测量序号 i")
    ax.set_ylabel("l (mm)")
    ax.set_title(title)
    ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    return _fig_b64(fig)


def _tof_fig(L, T, slope, intercept, r2, v_fit, v_mean, excluded=0):
    """L(mm) 横轴 vs T(μs) 纵轴；拟合斜率单位为 μs/mm（= 1/(mm/μs)），
    声速 v = 1/斜率 mm/μs × 1000 = 1000/斜率 (m/s)。

    主结果是斜率换算值；逐点平均速度受固定系统延迟拉低，只作诊断量。
    """
    fig, ax = plt.subplots(figsize=(8.2, 4.4))
    ax.grid(True, ls=":", lw=0.6, alpha=0.7)
    ax.scatter(L, T, s=42, color=ORANGE, zorder=3, label="测量点")
    xs = np.linspace(min(L), max(L), 50)
    ax.plot(xs, slope * xs + intercept, color=RED, lw=1.6,
            label="线性拟合 T = a·L + b")
    txt = (f"拟合 v = 1000/a ≈ {v_fit:.1f} m/s（a = {slope:.4f} μs/mm，b = {intercept:.4f} μs）\n"
           f"R² = {r2:.5f}；逐点平均 v = {v_mean:.1f} m/s（诊断，受固定延迟拉低）")
    if excluded:
        txt += f"\n已剔除 {excluded} 行原始数据，详见报告说明"
    ax.text(0.03, 0.95, txt, transform=ax.transAxes, fontsize=9.5, va="top",
            bbox=dict(boxstyle="round,pad=0.35", fc="#f1f5f9", ec=RED, alpha=0.92))
    ax.set_xlabel("传播距离 L (mm)")
    ax.set_ylabel("飞行时间 T (μs)")
    ax.set_title("飞行时间法：T 随 L 变化（v = 1000/斜率 换算）")
    ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    return _fig_b64(fig)


def _light_sine_fig(dt, dx2, slope, intercept, c_exp, err_rel, c_ref, wave):
    fig, ax = plt.subplots(figsize=(8.2, 4.4))
    ax.grid(True, ls=":", lw=0.6, alpha=0.7)
    ax.scatter(dt, dx2, s=42, color=BLUE, zorder=3, label="测量点")
    if slope is not None:
        xs = np.linspace(min(dt), max(dt), 20)
        ax.plot(xs, slope * xs + intercept, color=RED, lw=1.6,
                label="线性拟合（含截距）")
    txt = (f"c_exp ≈ {c_exp:.3e} m/s\n"
           f"相对误差 ≈ {err_rel:.2f} %（c_ref = {c_ref:.3e} m/s）")
    ax.text(0.03, 0.95, txt, transform=ax.transAxes, fontsize=9.5, va="top",
            bbox=dict(boxstyle="round,pad=0.35", fc="#f1f5f9", ec=BLUE, alpha=0.92))
    ax.set_xlabel("相位差 Δt (μs)")
    ax.set_ylabel("往返光程 2Δx (mm)")
    ax.set_title(f"光速相位法（{wave}）：2Δx 随 Δt 变化")
    ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    return _fig_b64(fig)


def _light_lissajous_fig(dx, dxm):
    fig, ax = plt.subplots(figsize=(8.2, 4.4))
    ax.grid(True, ls=":", lw=0.6, alpha=0.7)
    idx = list(range(1, len(dx) + 1))
    ax.scatter(idx, dx, s=60, color=BLUE, zorder=3, label="Δx 测量值")
    ax.axhline(dxm, color=RED, ls="--", lw=1.5, label="均值线")
    txt = (f"Δx 均值 ≈ {dxm:.2f} mm（对应 λ/4）\n"
           f"λ = 4·Δx_mean ≈ {4 * dxm / 1000:.4f} m")
    ax.text(0.03, 0.95, txt, transform=ax.transAxes, fontsize=9.5, va="top",
            bbox=dict(boxstyle="round,pad=0.35", fc="#f1f5f9", ec=BLUE, alpha=0.92))
    ax.set_xlabel("测量序号 i")
    ax.set_ylabel("Δx (mm)")
    ax.set_title("光速李萨如法：Δx 各次测量（π 相位差对应 λ/2 光程，位置移动 λ/4）")
    ax.set_xticks(idx)
    ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    return _fig_b64(fig)


# ──────────────────────────────────────────────── per-method computation

def _calc_air_resonance(cols, p):
    l = cols["l"]
    n = len(l)
    k, dl = progressive_difference(l)
    dlm = _mean(dl)
    lam_m = 2.0 * dlm * 1e-3          # mm -> m
    f_hz = p["f_khz"] * 1000.0
    v_exp = f_hz * lam_m
    # 讲义（235-266 行）：理想气体声速 v = √(γRT/μ)，T = 273.15+t → v_t = v0·√(1+t/273.15)
    v_theory = V0 * math.sqrt(1.0 + p["temperature_degC"] / T0)
    err_abs = abs(v_exp - v_theory)
    err_rel = err_abs / v_theory * 100.0
    results = [
        {"key": "v_exp", "label": "实验声速 v_exp", "value": _sig(v_exp), "unit": "m/s"},
        {"key": "v_theory", "label": "理论声速（温度修正）", "value": _sig(v_theory), "unit": "m/s"},
        {"key": "error_abs", "label": "绝对误差", "value": _sig(err_abs), "unit": "m/s"},
        {"key": "error_rel", "label": "相对误差", "value": round(err_rel, 2), "unit": "%"},
        {"key": "delta_l_mean", "label": "逐差平均间距 Δl", "value": round(dlm, 4), "unit": "mm"},
        {"key": "data_points", "label": "数据点数", "value": n, "unit": ""},
    ]
    s_dl = float(np.std(dl, ddof=1)) if len(dl) > 1 else 0.0
    b64 = _positions_fig(list(range(1, n + 1)), l, "空气中共振法：共振位置 l 随序号变化",
                         dlm, 2.0 * dlm,
                         f"v_exp ≈ {v_exp:.1f} m/s；v_theory ≈ {v_theory:.1f} m/s（t = {p['temperature_degC']:g} °C）")
    arrays = {"l": l, "delta_l": dl, "dlm": dlm, "s": s_dl, "lam_mm": 2.0 * dlm,
              "v_exp": v_exp, "v_theory": v_theory, "err_abs": err_abs,
              "err_rel": err_rel,
              "n": n, "k": k, "used_points": 2 * k, "dof": k - 1, "t95": _t95(k - 1)}
    return results, b64, arrays


def _calc_water_phase(cols, p):
    l = cols["l"]
    n = len(l)
    k, dl = progressive_difference(l)
    dlm = _mean(dl)
    f_hz = p["f_mhz"] * 1e6
    lam_m = 2.0 * dlm * 1e-3
    v = f_hz * lam_m
    s_dl = float(np.std(dl, ddof=1)) if len(dl) > 1 else 0.0
    dof = k - 1
    t95 = _t95(dof)
    # U_A(Δl) = t95(ν=k-1)·s/√k，mm（n=12 → k=6、t95=2.571，与讲义一致）
    ua_dl_mm = t95 * s_dl / math.sqrt(k)
    ua_dl_m = ua_dl_mm * 1e-3                       # mm -> m
    ua_v = 2.0 * f_hz * ua_dl_m                     # v = f*(2*Δl_m)
    results = [
        {"key": "v", "label": "水中声速 v", "value": _sig(v), "unit": "m/s"},
        {"key": "delta_l_mean", "label": "逐差平均间距 Δl", "value": round(dlm, 4), "unit": "mm"},
        {"key": "s_delta_l", "label": "Δl 标准差 s", "value": round(s_dl, 5), "unit": "mm"},
        {"key": "u_a", "label": "A 类不确定度 U_A", "value": _sig(ua_v), "unit": "m/s"},
    ]
    b64 = _positions_fig(list(range(1, n + 1)), l, "水中相位法：匹配位置 l 随序号变化",
                         dlm, 2.0 * dlm,
                         f"v ≈ {v:.1f} m/s；U_A ≈ {ua_v:.2f} m/s")
    arrays = {"l": l, "delta_l": dl, "dlm": dlm, "s": s_dl, "v": v,
              "lam_mm": 2.0 * dlm,
              "ua_dl_mm": ua_dl_mm, "ua_dl_m": ua_dl_m, "u_a_v": ua_v,
              "n": n, "k": k, "used_points": 2 * k, "dof": dof, "t95": t95}
    return results, b64, arrays


def _warning_row(text: str) -> int:
    """把「第 N 行：…」警告排序用的行号取出来；取不到排到最后。"""
    match = re.match(r"第 (\d+) 行", text)
    return int(match.group(1)) if match else 10 ** 6


def _tof_decode(L_raw, T_raw):
    """时差法原始录入值 → 可拟合点。

    返回 (kept, warnings, recovered_rows, dropped_rows)；kept 元素为 (row_no, L, T)，
    row_no 为 1-based 原始行号（报告明细表与图轴据此保持与录入表一致）。

    解码规则（保守）：
      - T>0 一律原样使用，绝不对正数机械加减模数；
      - T<0 视为设备按有符号 16 位计数差导出，仅尝试单次回绕 T + 65536，
        且恢复值必须过「隐式声速带宽」与「与其余点相容」两道闸门；
      - T 缺失/非数字、T=0、L<=0 的行直接剔除。
    任何剔除/恢复都写进 warnings，不静默丢点。
    """
    kept: list[tuple[int, float, float]] = []
    pending: list[tuple[int, float, float, float, float]] = []
    warnings: list[str] = []
    dropped: list[int] = []
    recovered: list[int] = []

    for index, (l, t) in enumerate(zip(L_raw, T_raw)):
        row = index + 1
        if l is None or t is None:
            missing = "、".join(name for name, value in (("L", l), ("T", t)) if value is None)
            warnings.append(f"第 {row} 行：{missing} 缺失或无法识别为数字，已剔除")
            dropped.append(row)
            continue
        if l <= 0:
            warnings.append(f"第 {row} 行：传播距离 L={l:g} mm 不为正，已剔除")
            dropped.append(row)
            continue
        if t > 0:
            kept.append((row, l, t))
            continue
        if t == 0:
            warnings.append(f"第 {row} 行：飞行时间 T=0 μs 无物理意义，已剔除")
            dropped.append(row)
            continue
        candidate = t + TOF_COUNT_MOD
        speed = 1000.0 * l / candidate if candidate > 0 else float("nan")
        if math.isfinite(speed) and TOF_WRAP_SPEED_BAND[0] <= speed <= TOF_WRAP_SPEED_BAND[1]:
            pending.append((row, l, candidate, t, speed))
            continue
        warnings.append(
            f"第 {row} 行：T={t:g} μs 按 16 位计数器回绕解码得 {candidate:g} μs，"
            f"隐式声速 {speed:.1f} m/s 不在 {TOF_WRAP_SPEED_BAND[0]:g}–"
            f"{TOF_WRAP_SPEED_BAND[1]:g} m/s，无法可靠解码，已剔除")
        dropped.append(row)

    # 与其余点相容性：正常点够多时用临时拟合的声速做交叉验证，避免把坏点「修」成好点
    reference = None
    if len(kept) >= TOF_MIN_VALID_POINTS:
        xs = [item[1] for item in kept]
        ys = [item[2] for item in kept]
        if np.ptp(xs) > 0:
            slope = float(np.polyfit(xs, ys, 1)[0])
            if slope > 0:
                reference = 1000.0 / slope
    for row, l, candidate, t, speed in pending:
        if reference and abs(speed - reference) > 0.3 * reference:
            warnings.append(
                f"第 {row} 行：T={t:g} μs 回绕解码得 {candidate:g} μs（隐式声速 {speed:.1f} m/s）"
                f"与其余点 {reference:.1f} m/s 不相容，已剔除")
            dropped.append(row)
            continue
        kept.append((row, l, candidate))
        recovered.append(row)
        warnings.append(f"第 {row} 行：T={t:g} μs 按 16 位计数器（模 {TOF_COUNT_MOD}）"
                        f"回绕恢复为 {candidate:g} μs，已参与拟合")

    kept.sort(key=lambda item: item[0])
    warnings.sort(key=_warning_row)
    return kept, warnings, sorted(recovered), sorted(dropped)


def _calc_tof(cols, p):
    L_raw, T_raw = cols["L"], cols["T"]
    kept, warnings, recovered_rows, dropped_rows = _tof_decode(L_raw, T_raw)
    if len(kept) < TOF_MIN_VALID_POINTS:
        detail = "；".join(warnings) if warnings else "无有效数据"
        raise TofDecodeError(
            f"有效点不足：有效 {len(kept)} 点，至少需要 {TOF_MIN_VALID_POINTS} 点"
            f"才能做 L–T 线性拟合。{detail}")
    L = [item[1] for item in kept]
    T = [item[2] for item in kept]
    if len(set(L)) < 2:
        raise TofDecodeError("有效传播距离种类不足：T = aL + b 拟合需要至少两个不同的传播距离 L")
    fitted = fit(L, T)
    slope = float(fitted["slope"])
    intercept = float(fitted["intercept"])
    r2 = float(fitted["r_squared"])
    if slope <= 0:
        raise TofDecodeError("飞行时间应随传播距离增加：拟合斜率不为正，请核对 L 与 T 是否录反或单位错误")

    v_fit = 1000.0 / slope
    v = [1000.0 * l / t for l, t in zip(L, T)]
    v_mean = _mean(v)
    v_std = float(np.std(v, ddof=1)) if len(v) > 1 else 0.0
    error_rel = abs(v_fit - SOUND_WATER_REF) / SOUND_WATER_REF * 100.0
    if not (TOF_UNIT_SPEED_BAND[0] <= v_fit <= TOF_UNIT_SPEED_BAND[1]):
        warnings.append(
            f"拟合声速 {v_fit:.1f} m/s 不在 {TOF_UNIT_SPEED_BAND[0]:g}–"
            f"{TOF_UNIT_SPEED_BAND[1]:g} m/s 的常见范围，请核对 T 的单位（μs/count）与 L 的单位（mm）")

    valid_points = len(L)
    excluded_points = len(dropped_rows)
    results = [
        {"key": "v_fit", "label": "拟合声速 v（1000/a）", "value": _sig(v_fit), "unit": "m/s"},
        {"key": "slope", "label": "拟合斜率 a", "value": round(slope, 6), "unit": "μs/mm"},
        {"key": "intercept", "label": "拟合截距 b", "value": round(intercept, 4), "unit": "μs"},
        {"key": "r2", "label": "拟合优度 R²", "value": _sig(r2, 5), "unit": ""},
        {"key": "error_rel", "label": "与参考值相对偏差", "value": round(error_rel, 2), "unit": "%"},
        {"key": "v_mean", "label": "逐点平均声速（诊断）", "value": _sig(v_mean), "unit": "m/s"},
        {"key": "v_std", "label": "逐点速度标准差（诊断）", "value": _sig(v_std), "unit": "m/s"},
        {"key": "valid_points", "label": "有效点数", "value": valid_points, "unit": ""},
        {"key": "excluded_points", "label": "剔除点数", "value": excluded_points, "unit": ""},
    ]
    b64 = _tof_fig(L, T, slope, intercept, r2, v_fit, v_mean, excluded_points)
    arrays = {"L": L, "T": T, "v": v,
              "kept_rows": [item[0] for item in kept],
              "L_all": L_raw, "T_all": T_raw,
              "recovered_rows": recovered_rows, "dropped_rows": dropped_rows,
              "v_fit": v_fit, "v_mean": v_mean, "v_std": v_std,
              "slope": slope, "intercept": intercept, "r2": r2,
              "error_rel": error_rel, "valid_points": valid_points,
              "excluded_points": excluded_points, "n": len(L_raw),
              "row_warnings": warnings}
    return results, b64, arrays


def _calc_light_sine(cols, p, wave="正弦波"):
    T = cols["T"]
    dt = cols["dt"]
    x1 = cols["x1"]
    x2 = cols["x2"]
    dx = [abs(x2[i] - x1[i]) for i in range(len(x1))]
    dxm = _mean(dx)
    tm = _mean(T)
    dtm = _mean(dt)
    # 讲义【数据处理】：计算 Δx/Δt 的平均值 → 逐点 r_i = Δx_i/Δt_i (mm/μs) 再取平均 r_mean
    r = [dx[i] / dt[i] for i in range(len(dt))]
    r_mean = _mean(r)
    # 差频原理：c = 2·f_t·T·(Δx/Δt)。量纲：λ(mm)=2·T(μs)·r_mean(mm/μs)，
    # λ(m)=λ(mm)·1e-3，c_exp = f_t(Hz)·λ(m)。
    lam_mm = 2.0 * tm * r_mean
    lam_m = lam_mm * 1e-3
    f_hz = p["f_mhz"] * 1e6
    c_exp = f_hz * lam_m
    c_ref = p.get("c_ref", 299800000.0)
    err_abs = abs(c_exp - c_ref)
    err_rel = err_abs / c_ref * 100.0
    results = [
        {"key": "c_exp", "label": "实验光速 c_exp", "value": _sig(c_exp), "unit": "m/s"},
        {"key": "error_abs", "label": "绝对误差", "value": _sig(err_abs), "unit": "m/s"},
        {"key": "error_rel", "label": "相对误差", "value": round(err_rel, 2), "unit": "%"},
        {"key": "t_mean", "label": "差频周期均值 T", "value": round(tm, 3), "unit": "μs"},
        {"key": "r_mean", "label": "Δx/Δt 的平均值", "value": round(r_mean, 3), "unit": "mm/μs"},
        {"key": "delta_t_mean", "label": "相位差均值 Δt", "value": round(dtm, 3), "unit": "μs"},
        {"key": "delta_x_mean", "label": "Δx 均值", "value": round(dxm, 1), "unit": "mm"},
    ]
    slope, intercept = None, 0.0
    if np.ptp(dt) > 1e-9:
        slope, intercept = np.polyfit(dt, [2.0 * v for v in dx], 1)
    b64 = _light_sine_fig(dt, [2.0 * v for v in dx],
                          float(slope) if slope is not None else None,
                          float(intercept), c_exp, err_rel, c_ref, wave)
    arrays = {"T": T, "dt": dt, "x1": x1, "x2": x2, "dx": dx, "dxm": dxm,
              "r": r, "r_mean": r_mean, "t_mean": tm, "dt_mean": dtm,
              "lam_mm": lam_mm, "c_exp": c_exp, "err_abs": err_abs,
              "err_rel": err_rel}
    return results, b64, arrays


def _calc_light_lissajous(cols, p):
    x1 = cols["x1"]
    x2 = cols["x2"]
    dx = [abs(x2[i] - x1[i]) for i in range(len(x1))]
    dxm = _mean(dx)
    lam_m = 4.0 * dxm * 1e-3
    f_hz = p["f_mhz"] * 1e6
    c_exp = f_hz * lam_m
    c_ref = p.get("c_ref", 299800000.0)
    err_abs = abs(c_exp - c_ref)
    err_rel = err_abs / c_ref * 100.0
    results = [
        {"key": "c_exp", "label": "实验光速 c_exp", "value": _sig(c_exp), "unit": "m/s"},
        {"key": "error_abs", "label": "绝对误差", "value": _sig(err_abs), "unit": "m/s"},
        {"key": "error_rel", "label": "相对误差", "value": round(err_rel, 2), "unit": "%"},
        {"key": "delta_x_mean", "label": "Δx 均值", "value": round(dxm, 1), "unit": "mm"},
    ]
    b64 = _light_lissajous_fig(dx, dxm)
    arrays = {"x1": x1, "x2": x2, "dx": dx, "dxm": dxm, "lam_mm": 4.0 * dxm,
              "c_exp": c_exp, "err_abs": err_abs, "err_rel": err_rel}
    return results, b64, arrays


_CALC = {
    "air_resonance": _calc_air_resonance,
    "water_phase": _calc_water_phase,
    "tof": _calc_tof,
    "light_sine": _calc_light_sine,
    "light_lissajous": _calc_light_lissajous,
}


# ──────────────────────────────────────────────── public API

def _assert_finite(arrays: dict) -> None:
    """arrays 里只校验数值项；None / bool / 非数值键（行号列表等）跳过。

    时差法的 L_all / T_all 会带 None（原始录入留空），不跳过会抛 TypeError
    并被外层兜底成「计算失败：…」，属于最容易被误读成数值崩溃的假故障。
    """
    for value in arrays.values():
        values = value if isinstance(value, list) else [value]
        for item in values:
            if isinstance(item, bool) or not isinstance(item, (int, float)):
                continue
            if not math.isfinite(item):
                raise ValueError("计算结果超出有限数值范围，请检查输入")


def analyze(method, rows, params=None):
    """Full pipeline: validation + computation + main figure + arrays (for reports)."""
    requested_method = method
    if method == "light_square":  # 讲义第 7 页：方法同正弦波；保留独立方法身份
        method = "light_sine"
    if method not in _CALC:
        return {"status": "validation_error",
                "errors": [f"未知实验方法：{method}，可选 {list(_CALC.keys())}"],
                "results": [], "plots": {}, "arrays": {},
                "params_used": {}, "method": requested_method,
                "warnings": []}
    errors = []
    cols = {}
    # 时差法允许局部坏点：无法识别的格子留 None，由 _tof_decode 逐行剔除并记 warning。
    lenient = method == "tof"
    for key, min_len, label in _COLUMNS[method]:
        parsed = _parse_col(rows or {}, key, min_len, label, errors, lenient=lenient)
        if parsed is not None:
            cols[key] = parsed
    # 逐差 / 配对计算要求完整数据（时差法例外，缺失点转成行级剔除）
    if not lenient:
        for key, min_len, label in _COLUMNS[method]:
            parsed = cols.get(key)
            if parsed is None:
                continue
            for i, v in enumerate(parsed):
                if v is None:
                    errors.append(f"{label}：第 {i + 1} 个数据缺失，请补全后再处理")
    # 同一次测量的各列必须行数一致（不同列按行配对，不能静默截断）
    lengths = {key: len(value) for key, value in cols.items()}
    if len(set(lengths.values())) > 1:
        detail = "、".join(f"{key} {count} 行" for key, count in lengths.items())
        errors.append(f"同一张表各列行数需一致（当前：{detail}）")
    if errors:
        return {"status": "validation_error", "errors": errors,
                "results": [], "plots": {}, "arrays": {},
                "params_used": {}, "method": requested_method,
                "warnings": []}
    try:
        params_used = _parse_params(method, params)
        # 只有光速法把 T/dt 当比值分母或周期，要求整列严格为正；
        # 时差法的 T 是直接测量量，走解码 + 行级剔除（见 _tof_decode）。
        if method == "light_sine":
            for key in ("T", "dt"):
                if key in cols and any(v <= 0 for v in cols[key]):
                    raise ValueError(f"{key} 必须全部大于零，不能删除无效测量点后计算")
        if method in ("air_resonance", "water_phase"):
            k = len(cols["l"]) // 2
            if k < 2:
                raise ValueError(f"逐差法至少需要 4 个数据，当前只有 {len(cols['l'])} 个")
            spans = [cols["l"][i + k] - cols["l"][i] for i in range(k)]
            if any(v == 0 for v in spans) or not (all(v > 0 for v in spans)
                                                  or all(v < 0 for v in spans)):
                raise ValueError("逐差方向必须一致且间距非零，请核对记录顺序与位置读数")
        if method in ("light_sine", "light_lissajous"):
            if any(x1 == x2 for x1, x2 in zip(cols["x1"], cols["x2"])):
                raise ValueError("每组反射镜位置 x1 与 x2 必须不同")
        if requested_method == "light_square":
            results, b64, arrays = _calc_light_sine(cols, params_used, wave="方波")
        else:
            results, b64, arrays = _CALC[method](cols, params_used)
        # 行级警告不进 arrays（arrays 只放数值，且要过下面的有限性检查）
        row_warnings = arrays.pop("row_warnings", [])
        _assert_finite(arrays)
        if method == "tof" and arrays["slope"] <= 0:
            raise ValueError("飞行时间应随传播距离增加，当前拟合斜率不为正")
    except TofDecodeError as exc:
        return {"status": "validation_error",
                "errors": [str(exc)],
                "results": [], "plots": {}, "arrays": {},
                "params_used": {}, "method": requested_method,
                "warnings": []}
    except Exception as exc:  # 除零等数值意外
        return {"status": "validation_error",
                "errors": [f"计算失败：{exc}"],
                "results": [], "plots": {}, "arrays": {},
                "params_used": {}, "method": requested_method,
                "warnings": []}
    return {"status": "success", "errors": [],
            "results": results, "plots": {"main": b64},
            "arrays": arrays, "params_used": params_used,
            "method": requested_method,
            "method_name": _METHOD_NAMES[requested_method],
            "warnings": row_warnings}


def process_method(method, rows, params=None):
    """前端处理接口：返回 {status, errors, warnings, results, plots}。"""
    full = analyze(method, rows, params)
    return {"status": full["status"], "errors": full["errors"],
            "warnings": full.get("warnings", []),
            "results": full["results"], "plots": full["plots"],
            "method": full.get("method"), "method_name": full.get("method_name")}
