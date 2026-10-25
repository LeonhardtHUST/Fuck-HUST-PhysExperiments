"""Normalise AI-supplied payloads onto the request shapes the API already uses.

The registry holds three different request shapes:

* ``general``      – method-keyed ``{methodId: {rows, params}}`` (11 experiments)
* ``polarization`` – one flat object (``bg_uw`` / ``malus`` / ``halfwave`` / …)
* ``sound-light``  – one method per call (``{method, rows, params}``)

Instead of making the model guess, the shape is detected from the adapter
itself (``ConfiguredExperiment`` vs. the two bespoke implementations), so a new
experiment is covered without touching this module.  Every payload then goes
through the same Pydantic models the HTTP routes use, which is what turns a
nested ``KeyError`` into a readable Chinese message.
"""

from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import ValidationError

from app.models import (
    CollectionCommitRequest,
    GenericExperimentRequest,
    ProcessRequest,
    SoundLightProcessRequest,
    SoundLightReportRequest,
)
from experiments.core.configured import ConfiguredExperiment
from experiments.core.exceptions import UnknownExperimentError
from experiments.core.registry import registry
from physlab_mcp.errors import ToolInputError, UnknownToolExperiment

PayloadKind = Literal["general", "polarization", "sound-light"]

#: Shipped verbatim in ``list_experiments`` so the model can build a payload
#: without a second round-trip.
REQUEST_SHAPES: dict[str, str] = {
    "general": (
        '方法键控：{"<方法ID>": {"rows": [{"<列key>": 数值, ...}], '
        '"params": {"<参数key>": 数值}}}'
    ),
    "polarization": (
        '扁平结构：{"bg_uw": 0.0, "theta_qwp": 30.0, '
        '"malus": {"rows": [{"theta": 0, "i_left": 12.3, "i_right": 12.1}]}, '
        '"halfwave": {"initial": {"c_deg": 0, "p2_deg": 0}, "rows": [...]}, '
        '"quarterwave": {"rows": [{"phi": 0, "i_raw": 1.2}]}, '
        '"circular": {"rows": [{"angle": 0, "i_raw": 1.2}]}}'
    ),
    "sound-light": (
        '单方法：{"method": "<方法ID>", "rows": {"<列key>": [数值, ...]}, '
        '"params": {"<参数key>": 数值}}'
    ),
}

_SUPPORTED_FORMATS = ("docx", "pdf")


def detect_kind(adapter: Any) -> PayloadKind:
    if isinstance(adapter, ConfiguredExperiment):
        return "general"
    config = getattr(adapter, "config", None)
    if isinstance(config, list):
        return "sound-light"
    if isinstance(config, dict) and "subExperiments" in config:
        return "polarization"
    return "general"


def available_ids() -> list[str]:
    return [experiment.id for experiment in registry.all()]


def resolve(experiment_id: str) -> tuple[Any, PayloadKind]:
    try:
        adapter = registry.get(experiment_id)
    except UnknownExperimentError as exc:
        raise UnknownToolExperiment(
            f"实验不存在：{experiment_id}；可用实验 ID：{'、'.join(available_ids())}。"
            "可调用 list_experiments 查看实验清单。"
        ) from exc
    return adapter, detect_kind(adapter)


def check_format(fmt: str) -> str:
    value = (fmt or "").strip().lower()
    if value not in _SUPPORTED_FORMATS:
        raise ToolInputError("fmt 必须是 docx 或 pdf")
    return value


def json_safe(value: Any) -> Any:
    """Render engine output as strict JSON (NaN/Inf → null, numpy scalars unwrapped)."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, int):
        return value
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        return json_safe(tolist())
    return value


def _invalid(kind: PayloadKind, model: str, exc: ValidationError) -> ToolInputError:
    problems = []
    for error in exc.errors()[:5]:
        location = ".".join(str(part) for part in error.get("loc", ())) or "data"
        problems.append(f"{location}: {error.get('msg', '')}")
    return ToolInputError(
        f"入参结构不符合「{kind}」形状（按 {model} 校验）：{'；'.join(problems)}。"
        f"期望结构：{REQUEST_SHAPES[kind]}"
    )


def _unwrap(payload: Any) -> dict[str, Any]:
    """Accept ``{"data": {...}}`` as well as the bare body."""
    if not isinstance(payload, dict):
        raise ToolInputError("data 必须是一个 JSON 对象")
    if set(payload) == {"data"} and isinstance(payload["data"], dict):
        return payload["data"]
    return payload


def _soundlight_single(payload: dict[str, Any]) -> dict[str, Any]:
    """Merge ``{methodId: {rows, params}}`` into the single-method body."""
    if "method" in payload:
        return payload
    if len(payload) == 1:
        method_id, submitted = next(iter(payload.items()))
        if isinstance(submitted, dict) and "rows" in submitted:
            return {
                "method": method_id,
                "rows": submitted.get("rows") or {},
                "params": submitted.get("params") or {},
            }
    return payload


def process_payload(adapter: Any, kind: PayloadKind, payload: Any) -> dict[str, Any]:
    body = _unwrap(payload)
    try:
        if kind == "polarization":
            return ProcessRequest(**body).model_dump()
        if kind == "sound-light":
            request = SoundLightProcessRequest(**_soundlight_single(body))
            return {"method": request.method, "rows": request.rows, "params": request.params}
        return GenericExperimentRequest(data=body).data
    except ValidationError as exc:
        model = {
            "polarization": "ProcessRequest",
            "sound-light": "SoundLightProcessRequest",
            "general": "GenericExperimentRequest",
        }[kind]
        raise _invalid(kind, model, exc) from exc


def report_payload(adapter: Any, kind: PayloadKind, payload: Any) -> dict[str, Any]:
    body = _unwrap(payload)
    try:
        if kind == "polarization":
            return ProcessRequest(**body).model_dump()
        if kind == "sound-light":
            if "method" in body:
                single = _soundlight_single(body)
                data = {single["method"]: {"rows": single.get("rows") or {},
                                           "params": single.get("params") or {}}}
            else:
                data = {str(method_id): {"rows": submitted.get("rows") or {},
                                         "params": submitted.get("params") or {}}
                        for method_id, submitted in body.items()
                        if isinstance(submitted, dict)}
            return SoundLightReportRequest(data=data).data
        return GenericExperimentRequest(data=body).data
    except ValidationError as exc:
        model = {
            "polarization": "ProcessRequest",
            "sound-light": "SoundLightReportRequest",
            "general": "GenericExperimentRequest",
        }[kind]
        raise _invalid(kind, model, exc) from exc


def collection_payload(payload: Any) -> CollectionCommitRequest:
    body = _unwrap(payload)
    try:
        return CollectionCommitRequest(**body)
    except ValidationError as exc:
        problems = "；".join(
            f"{'.'.join(str(part) for part in error.get('loc', ())) or 'data'}: {error.get('msg', '')}"
            for error in exc.errors()[:5]
        )
        raise ToolInputError(
            f"共建提交参数不合法：{problems}。"
            "需要 experiment_id、template_version、consent 与 confirmed_data。"
        ) from exc
