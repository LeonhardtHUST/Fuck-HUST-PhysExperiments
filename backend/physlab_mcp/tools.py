"""Tool implementations behind the PhysLab MCP server.

Every function here takes JSON-native arguments and returns a JSON-native dict;
nothing imports ``mcp`` or FastAPI, so the whole surface is unit-testable
without speaking the protocol.  ``physlab_mcp.server`` only adds docstrings the
model reads and the ``isError`` translation.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from app.experiment_gate import missing_required_methods
from experiments.core.exceptions import ExperimentInputError
from experiments.core.registry import PUBLIC_EXPERIMENT_IDS, registry

from physlab_mcp import artifacts, payloads, references
from physlab_mcp.errors import ToolDisabled, ToolError, ToolInputError
from physlab_mcp.payloads import PayloadKind

DATA_COLLECTION_FLAG = "PHYSICSLAB_MCP_ENABLE_DATA_COLLECTION"
PRIVACY_NOTE = (
    "贡献前请确认图片中已删除或遮盖姓名、学号、联系方式与人脸；"
    "系统会重新编码图片以去除拍摄时间与位置等元数据，但不会自动识别个人信息。"
)


# --------------------------------------------------------------------- helpers

def experiment_name(adapter: Any) -> str:
    config = getattr(adapter, "config", None)
    if isinstance(config, dict) and config.get("name"):
        return str(config["name"])
    try:
        return str(adapter.catalog_entry()["name"])
    except Exception:  # pragma: no cover - catalogue entries always carry a name
        return str(adapter.id)


def data_collection_tools_enabled() -> bool:
    flag = os.getenv(DATA_COLLECTION_FLAG, "").strip().lower()
    return flag in {"1", "true", "yes", "on"}


def _require_collection_enabled() -> None:
    if not data_collection_tools_enabled():
        raise ToolDisabled(
            f"数据共建工具未启用：请在 backend/.env.local 设置 {DATA_COLLECTION_FLAG}=true 后重启"
        )
    from app.data_collection import collection_enabled

    if not collection_enabled():
        raise ToolDisabled(
            "数据共建功能未启用：请在后端设置 ENABLE_DATA_COLLECTION=true 后重启"
        )


def _read_image(image_path: str, *, limit: int) -> bytes:
    path = Path(str(image_path)).expanduser()
    if not path.is_file():
        raise ToolInputError(f"图片文件不存在：{image_path}")
    content = path.read_bytes()
    if not content:
        raise ToolInputError("图片内容为空")
    if len(content) > limit:
        raise ToolInputError(f"图片不能超过 {limit // (1024 * 1024)} MB")
    return content


# --------------------------------------------------------------------- queries

def list_experiments(include_legacy: bool = False) -> dict[str, Any]:
    entries = registry.catalogue(include_legacy=include_legacy)
    for entry in entries:
        entry["payload_kind"] = payloads.detect_kind(registry.get(entry["id"]))
    return {
        "count": len(entries),
        "experiments": entries,
        "request_shapes": payloads.REQUEST_SHAPES,
        "next_step": "选定实验后先调用 get_experiment_config 取列与参数结构，再提交 data。",
    }


def get_experiment_config(experiment_id: str) -> dict[str, Any]:
    adapter, kind = payloads.resolve(experiment_id)
    return {
        "experiment_id": adapter.id,
        "name": experiment_name(adapter),
        "payload_kind": kind,
        "request_shape": payloads.REQUEST_SHAPES[kind],
        "config": payloads.json_safe(adapter.config),
    }


def get_experiment_schema(experiment_id: str) -> dict[str, Any]:
    adapter, kind = payloads.resolve(experiment_id)
    return {
        "experiment_id": adapter.id,
        "payload_kind": kind,
        "schema": payloads.json_safe(adapter.schema()),
    }


def get_data_reference(experiment_id: str) -> dict[str, Any]:
    return references.get_reference(experiment_id)


# ------------------------------------------------------------ compute & verify

def validate_experiment_data(experiment_id: str, data: Any) -> dict[str, Any]:
    adapter, kind = payloads.resolve(experiment_id)
    payload = payloads.process_payload(adapter, kind, data)
    try:
        validation = adapter.validate(payload)
    except ExperimentInputError as exc:
        raise ToolInputError(str(exc)) from exc
    return {
        "experiment_id": adapter.id,
        "payload_kind": kind,
        "valid": bool(validation.get("valid")),
        "errors": payloads.json_safe(validation.get("errors", [])),
        "warnings": payloads.json_safe(validation.get("warnings", [])),
        "validation": payloads.json_safe(validation),
    }


def process_experiment_data(
    experiment_id: str, data: Any, inline_plots: bool = False,
) -> dict[str, Any]:
    adapter, kind = payloads.resolve(experiment_id)
    payload = payloads.process_payload(adapter, kind, data)
    try:
        result = adapter.process(payload)
    except ExperimentInputError as exc:
        raise ToolInputError(str(exc)) from exc
    response = payloads.json_safe(result)
    plots = response.get("plots") or {}
    if plots and not inline_plots:
        response["plots"] = artifacts.save_plots(plots, experiment_id=adapter.id)
        response["plots_are"] = "文件路径（需要 base64 时给 inline_plots=true）"
    elif plots:
        response["plots"] = {
            method_id: artifacts.as_data_uri(plot) if isinstance(plot, str) else plot
            for method_id, plot in plots.items()
        }
        response["plots_are"] = "base64 data URI"
    response["experiment_id"] = adapter.id
    response["payload_kind"] = kind
    return response


# ---------------------------------------------------------------- documents

def _gate(adapter: Any, kind: PayloadKind, payload: dict[str, Any]) -> None:
    if kind != "general":
        return
    missing = missing_required_methods(adapter.config, payload)
    if missing:
        raise ToolInputError(f"请先填写完全部必做实验：{'、'.join(missing)}")


def generate_experiment_report(
    experiment_id: str, data: Any, fmt: str = "docx",
) -> dict[str, Any]:
    adapter, kind = payloads.resolve(experiment_id)
    selected = payloads.check_format(fmt)
    payload = payloads.report_payload(adapter, kind, data)
    _gate(adapter, kind, payload)
    if not payload:
        raise ToolInputError("未提供任何实验数据")
    try:
        content = adapter.build_report(payload, selected)
    except ToolError:
        raise
    except Exception as exc:
        raise ToolInputError(f"报告生成失败：{exc}") from exc
    name = experiment_name(adapter)
    return {
        "status": "success",
        "experiment_id": adapter.id,
        "fmt": selected,
        "file": artifacts.save_bytes(content, label=f"{name}-实验报告", fmt=selected),
    }


def generate_record_sheet(experiment_id: str, fmt: str = "docx") -> dict[str, Any]:
    adapter, _kind = payloads.resolve(experiment_id)
    selected = payloads.check_format(fmt)
    try:
        content = adapter.build_record_sheet(selected)
    except Exception as exc:
        raise ToolInputError(f"记录表生成失败：{exc}") from exc
    name = experiment_name(adapter)
    return {
        "status": "success",
        "experiment_id": adapter.id,
        "fmt": selected,
        "file": artifacts.save_bytes(content, label=f"{name}-数据记录表", fmt=selected),
    }


# ---------------------------------------------------------------------- OCR

def recognize_record_sheet(
    image_path: str, experiment_id: str = "", table_id: str = "",
) -> dict[str, Any]:
    from app.ocr_service import (
        MAX_IMAGE_BYTES,
        InvalidOCRImage,
        OCRUnavailable,
        recognize_numeric_candidates,
    )

    content = _read_image(image_path, limit=MAX_IMAGE_BYTES)
    try:
        result = recognize_numeric_candidates(content)
    except InvalidOCRImage as exc:
        raise ToolInputError(str(exc)) from exc
    except OCRUnavailable as exc:
        raise ToolDisabled(str(exc)) from exc
    return {
        "status": "success",
        "experiment_id": experiment_id,
        "table_id": table_id,
        **payloads.json_safe(result),
        "note": "识别结果只是候选值，必须由使用者逐项确认后才能用于计算。",
    }


# ------------------------------------------------------------ data collection

def data_collection_status() -> dict[str, Any]:
    from app.data_collection import TEMPLATE_VERSION, collection_enabled

    return {
        "enabled": collection_enabled(),
        "mcp_tools_enabled": data_collection_tools_enabled(),
        "template_version": TEMPLATE_VERSION,
        "privacy_note": PRIVACY_NOTE,
    }


def contribute_record_sheet(
    image_path: str,
    experiment_id: str,
    consent: bool,
    template_version: str = "2.0",
    collection_mode: bool = False,
) -> dict[str, Any]:
    _require_collection_enabled()
    from app.data_collection import (
        MAX_COLLECTION_IMAGE_BYTES,
        CollectionValidationError,
        local_storage,
        sanitize_record_image,
        validate_template_version,
    )

    if consent is not True:
        raise ToolInputError("只有明确同意后才会保存记录表")
    if experiment_id not in PUBLIC_EXPERIMENT_IDS:
        raise ToolInputError(f"实验不存在或未公开：{experiment_id}")
    content = _read_image(image_path, limit=MAX_COLLECTION_IMAGE_BYTES)
    try:
        version = validate_template_version(template_version)
        metadata = local_storage().create_session(
            experiment_id=experiment_id,
            template_version=version,
            image=sanitize_record_image(content),
            collection_mode=collection_mode,
        )
    except CollectionValidationError as exc:
        raise ToolInputError(str(exc)) from exc
    except OSError as exc:
        raise ToolError("记录表贡献暂时不可用，不影响报告生成") from exc
    from app.collection_stats import estimate_samples

    return {
        "status": "pending_confirmation",
        "session_id": metadata["session_id"],
        "revision": metadata["revision"],
        "experiment_id": experiment_id,
        "collection_mode": bool(collection_mode),
        "estimated_samples": estimate_samples(experiment_id),
        "next_step": "确认数据后调用 commit_contributed_data 提交；撤回用 withdraw_contribution。",
        "privacy_note": PRIVACY_NOTE,
    }


def commit_contributed_data(
    session_id: str, experiment_id: str, confirmed_data: Any, consent: bool,
    template_version: str = "2.0",
) -> dict[str, Any]:
    _require_collection_enabled()
    from app.data_collection import (
        CollectionNotFoundError,
        CollectionValidationError,
        local_storage,
        normalize_confirmed_fields,
        validate_template_version,
    )

    request = payloads.collection_payload({
        "experiment_id": experiment_id,
        "template_version": template_version,
        "consent": consent,
        "confirmed_data": confirmed_data,
    })
    if request.consent is not True:
        raise ToolInputError("只有明确同意后才会保存确认数据")
    if request.experiment_id not in PUBLIC_EXPERIMENT_IDS:
        raise ToolInputError(f"实验不存在或未公开：{request.experiment_id}")
    try:
        version = validate_template_version(request.template_version)
        fields = normalize_confirmed_fields(request.experiment_id, request.confirmed_data)
        metadata = local_storage().commit_session(
            session_id=session_id,
            experiment_id=request.experiment_id,
            template_version=version,
            fields=fields,
        )
    except CollectionNotFoundError as exc:
        raise ToolInputError(str(exc)) from exc
    except CollectionValidationError as exc:
        raise ToolInputError(str(exc)) from exc
    except OSError as exc:
        raise ToolError("确认数据暂时无法保存，不影响报告生成") from exc
    from app.collection_stats import estimate_samples

    return {
        "status": metadata["status"],
        "session_id": metadata["session_id"],
        "revision": metadata["revision"],
        "field_count": len(metadata["fields"]),
        "experiment_id": request.experiment_id,
        "collection_mode": metadata.get("collection_mode") is True,
        "estimated_samples": estimate_samples(request.experiment_id, metadata["fields"]),
    }


def withdraw_contribution(session_id: str) -> dict[str, Any]:
    _require_collection_enabled()
    from app.data_collection import (
        CollectionNotFoundError,
        CollectionValidationError,
        local_storage,
    )

    try:
        local_storage().delete_session(session_id)
    except CollectionNotFoundError as exc:
        raise ToolInputError(str(exc)) from exc
    except CollectionValidationError as exc:
        raise ToolInputError(str(exc)) from exc
    except OSError as exc:
        raise ToolError("暂时无法删除数据贡献会话") from exc
    return {"status": "deleted", "session_id": session_id}
