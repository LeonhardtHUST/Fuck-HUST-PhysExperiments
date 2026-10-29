"""Significant-figure arithmetic for derived quantities.

原始读数（学生在记录纸上写的数字）**不经过本模块**：它们必须以字符串原样搬运，
末尾 0、前导 0、科学计数法写法都属于数据本身，任何重排都是信息损失。

本模块只回答一个问题：由原始读数算出来的派生量，应该写成几位？
规则来自物理实验的有效数字传统：

* 加减法：结果的末位与参与运算各量中**末位最粗**者对齐。
* 乘除法：结果的有效数字位数取参与运算各量中**最少**者（通常再放宽一位）。
* 不确定度：U 先修约（首位 1/2 保留 2 位，其余保留 1 位），
  被测量结果对齐到 U 的末位。

数值一律用 :class:`decimal.Decimal` 计算，采用 ``ROUND_HALF_UP``，
避免 ``round()`` 的银行家舍入和二进制浮点尾差。
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from typing import Iterable

__all__ = [
    "Readout",
    "parse_readout",
    "decimal_places",
    "significant_digits",
    "format_readout",
    "round_places",
    "round_sig",
    "format_places",
    "format_sig",
    "add_sub_places",
    "mul_div_sigfigs",
    "uncertainty_places",
    "format_with_uncertainty",
    "SIG_MIN",
    "SIG_MAX",
]

SIG_MIN = 2
SIG_MAX = 6

_NUMBER = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
_SCI_SPLIT = re.compile(r"^(?P<mantissa>[+-]?(?:\d+(?:\.\d*)?|\.\d+))[eE](?P<exp>[+-]?\d+)$")


@dataclass(frozen=True)
class Readout:
    """一个原始读数的解析结果。

    ``text`` 保留用户写法；其余字段只用于推算位数。
    """

    text: str
    value: Decimal
    #: 末位所在的绝对小数位：``1.20e-3`` 末位在 10^-5，因此是 5；``120`` 是 0；``1.20e5`` 是 -3。
    places: int
    #: 尾数写法上的小数位：``1.20e-3`` 是 2。
    mantissa_decimals: int
    #: 有效数字位数：``1.20e-3`` 是 3，``12.30`` 是 4，``0.000100`` 是 3。
    sigfigs: int
    #: 计数/序号这类精确整数。
    exact: bool = False


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).strip()
    text = text.replace("−", "-").replace("－", "-")
    text = text.replace("×10^", "e").replace("×10", "e").replace("*10^", "e")
    text = text.replace("E", "e")
    return text


def parse_readout(value: object) -> Readout | None:
    """把读数解析成 :class:`Readout`；无法识别时返回 ``None``，绝不猜测。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        text = format(value, "f")
    elif isinstance(value, int):
        text = str(value)
    elif isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        text = repr(value)
    else:
        text = str(value)
    raw = text.strip()
    if not raw:
        return None
    normalised = _normalise(raw)
    if not _NUMBER.match(normalised):
        return None
    try:
        number = Decimal(normalised)
    except InvalidOperation:  # pragma: no cover - 正则已挡住
        return None

    mantissa, exponent = normalised, 0
    match = _SCI_SPLIT.match(normalised)
    if match:
        mantissa = match.group("mantissa")
        exponent = int(match.group("exp"))
    unsigned = mantissa.lstrip("+-")
    mantissa_decimals = len(unsigned.split(".", 1)[1]) if "." in unsigned else 0
    digits = unsigned.replace(".", "").lstrip("0")
    sigfigs = len(digits) if digits else 1
    return Readout(
        text=raw,
        value=number,
        places=mantissa_decimals - exponent,
        mantissa_decimals=mantissa_decimals,
        sigfigs=sigfigs,
    )


def decimal_places(value: object) -> int | None:
    readout = parse_readout(value)
    return None if readout is None else readout.places


def significant_digits(value: object) -> int | None:
    readout = parse_readout(value)
    return None if readout is None else readout.sigfigs


def format_readout(value: object) -> str:
    """原始读数专用：字符串原样返回（只去首尾空白），数字按最短往返写法。"""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return ""
        return repr(value)
    return str(value)


def _decimal(value: object) -> Decimal | None:
    if isinstance(value, Decimal):
        return value if value.is_finite() else None
    readout = parse_readout(value)
    if readout is not None:
        return readout.value
    if isinstance(value, float) and value == value and value not in (float("inf"), float("-inf")):
        return Decimal(repr(value))
    return None


def _strip(text: str) -> str:
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if text in ("-0", "+0", ""):
        return "0"
    return text


def round_places(value: object, places: int) -> Decimal:
    """按绝对小数位修约（``places`` 可为负，表示修约到十位、百位）。"""
    number = _decimal(value)
    if number is None:
        raise ValueError(f"无法解析为数字：{value!r}")
    quantum = Decimal(1).scaleb(-places)
    with localcontext() as ctx:
        ctx.prec = 80
        return number.quantize(quantum, rounding=ROUND_HALF_UP)


def _adjusted(number: Decimal) -> int:
    """首位有效数字所在的 10 的幂次。"""
    if number == 0:
        return 0
    return number.copy_abs().adjusted()


def round_sig(value: object, sigfigs: int) -> Decimal:
    """按有效数字位数修约。"""
    number = _decimal(value)
    if number is None:
        raise ValueError(f"无法解析为数字：{value!r}")
    if number == 0:
        return Decimal(0)
    digits = max(1, int(sigfigs))
    quantum = Decimal(1).scaleb(_adjusted(number) - digits + 1)
    with localcontext() as ctx:
        ctx.prec = 80
        return number.quantize(quantum, rounding=ROUND_HALF_UP)


def _scientific(number: Decimal, digits: int | None = None, *, pad: bool = False) -> str:
    """科学计数法。``pad=True`` 时尾数补齐到 ``digits`` 位有效数字（下标有效位本身就代表精度）。"""
    if number == 0:
        return "0"
    exponent = _adjusted(number)
    mantissa = number.scaleb(-exponent)
    if pad and digits:
        text = format(mantissa, f".{max(0, digits - 1)}f")
    else:
        text = _strip(format(mantissa, "f"))
    return f"{text}e{exponent}"


def _use_scientific(number: Decimal) -> bool:
    if number == 0:
        return False
    magnitude = number.copy_abs()
    return magnitude >= Decimal("1e5") or magnitude < Decimal("1e-4")


def format_places(value: object, places: int, *, pad: bool = False) -> str:
    """按小数位输出。``pad=True`` 时才补尾部 0（用于不确定度对齐等明确需要定长的场合）。"""
    number = round_places(value, places)
    if _use_scientific(number):
        # 科学计数法与「固定小数位」互斥，这里只保证数值正确，不补尾零。
        return _scientific(number)
    if places > 0:
        text = format(number, f".{places}f")
    else:
        text = format(number, "f")
    return text if pad else _strip(text)


def format_sig(value: object, sigfigs: int, *, pad: bool = False) -> str:
    """按有效数字输出。默认不补假零，避免把 3 位结果写成 3.000。"""
    number = round_sig(value, sigfigs)
    if _use_scientific(number):
        # 科学计数法的尾数位数就是有效数字位数，补零是在表达「有几位有效」而不是伪造精度。
        return _scientific(number, sigfigs, pad=True)
    if pad and number != 0:
        decimals = max(0, sigfigs - (_adjusted(number) + 1))
        return format(number, f".{decimals}f")
    return _strip(format(number, "f"))


def add_sub_places(*values: object) -> int:
    """加减法结果的末位：取各操作数中最粗的末位。"""
    places = [item.places for item in map(parse_readout, values) if item is not None]
    return min(places) if places else 0


def mul_div_sigfigs(*values: object) -> int:
    """乘除法结果的有效数字位数：取各操作数中最少者，并夹在 [2, 6]。"""
    sigfigs = [item.sigfigs for item in map(parse_readout, values) if item is not None]
    if not sigfigs:
        return 4
    return max(SIG_MIN, min(SIG_MAX, min(sigfigs)))


def uncertainty_places(uncertainty: object) -> int:
    """不确定度修约后末位的小数位：首位为 1 或 2 时保留 2 位有效数字，其余保留 1 位。"""
    number = _decimal(uncertainty)
    if number is None or number == 0:
        return 0
    magnitude = number.copy_abs()
    first = magnitude.scaleb(-_adjusted(magnitude)).to_integral_value()
    digits = 2 if int(first) in (1, 2) else 1
    # 末位 = 首位所在幂次往右再走 digits-1 位（小数位记作正数）
    return -_adjusted(magnitude) + (digits - 1)


def format_with_uncertainty(value: object, uncertainty: object) -> tuple[str, str]:
    """把结果与不确定度对齐到同一位，返回 ``(结果, 不确定度)``。"""
    places = uncertainty_places(uncertainty)
    return (
        format_places(value, places, pad=True),
        format_places(uncertainty, places, pad=True),
    )


def consensus_places(values: Iterable[object]) -> int | None:
    """一组读数的共同末位（最粗者），用于“平均值与读数同末位”。"""
    places = [item.places for item in map(parse_readout, values) if item is not None]
    return min(places) if places else None
