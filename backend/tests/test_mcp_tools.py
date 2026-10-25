"""Regression coverage for the PhysLab MCP tool layer.

The tools are protocol-free pure functions, so everything here runs without an
MCP client; the server tests only check that the same functions are registered
(and that the privacy-sensitive ones stay out unless explicitly enabled).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from experiments.core.registry import PUBLIC_EXPERIMENT_IDS, registry
from physlab_mcp import artifacts, payloads, references, tools
from physlab_mcp.errors import ToolDisabled, ToolInputError, UnknownToolExperiment
from tests.test_public_experiment_usability import load_fixture


def process_input(fixture: dict) -> dict:
    if fixture["kind"] == "polarization":
        return {**fixture.get("setup", {}), **fixture["data"]}
    if fixture["kind"] == "sound-light":
        method_id, payload = next(iter(fixture["data"].items()))
        return {"method": method_id, **payload}
    return fixture["data"]


def report_input(fixture: dict) -> dict:
    if fixture["kind"] == "polarization":
        return {**fixture.get("setup", {}), **fixture["data"]}
    # both the method-keyed and the {"data": ...} form are accepted
    return {"data": fixture["data"]}


@pytest.fixture(autouse=True)
def isolated_output_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("PHYSICSLAB_MCP_OUTPUT_DIR", str(tmp_path))
    monkeypatch.delenv(tools.DATA_COLLECTION_FLAG, raising=False)
    monkeypatch.delenv("ENABLE_DATA_COLLECTION", raising=False)
    return tmp_path


def tool_names() -> list[str]:
    from physlab_mcp.server import build_server

    return [tool.name for tool in asyncio.run(build_server().list_tools())]


# ------------------------------------------------------------------- queries

def test_tool_names_cover_the_public_catalogue():
    names = tool_names()
    for expected in (
        "list_experiments",
        "get_experiment_config",
        "get_experiment_schema",
        "get_data_reference",
        "validate_experiment_data",
        "process_experiment_data",
        "generate_experiment_report",
        "generate_record_sheet",
        "recognize_record_sheet",
    ):
        assert expected in names
    # 数据共建默认不注册
    assert "contribute_record_sheet" not in names
    assert "data_collection_status" not in names


def test_list_experiments_documents_the_three_payload_shapes():
    payload = tools.list_experiments()
    assert payload["count"] == len(PUBLIC_EXPERIMENT_IDS)
    assert set(payload["request_shapes"]) == {"general", "polarization", "sound-light"}
    kinds = {entry["id"]: entry["payload_kind"] for entry in payload["experiments"]}
    assert kinds["polarization"] == "polarization"
    assert kinds["sound-light"] == "sound-light"
    assert kinds["michelson"] == "general"


@pytest.mark.parametrize("experiment_id", PUBLIC_EXPERIMENT_IDS)
def test_config_and_schema_are_exposed_for_every_experiment(experiment_id):
    config = tools.get_experiment_config(experiment_id)
    assert config["experiment_id"] == experiment_id
    assert config["payload_kind"] in {"general", "polarization", "sound-light"}
    assert config["config"]
    assert config["request_shape"]

    schema = tools.get_experiment_schema(experiment_id)
    assert schema["schema"]["definition"]["id"] == experiment_id
    assert schema["schema"]["definition"]["methods"]


@pytest.mark.parametrize("experiment_id", PUBLIC_EXPERIMENT_IDS)
def test_data_reference_is_indexed_by_experiment_id(experiment_id):
    document = tools.get_data_reference(experiment_id)
    assert document["experiment_id"] == experiment_id
    assert document["data_reference"]
    assert document["note"]


def test_reference_index_does_not_hardcode_folder_names():
    # sound-light lives in experiments/soundlight/ and is still found by id
    assert "sound-light" in references.available()
    assert references.available() == sorted(references.available())


def test_unknown_experiment_reports_the_available_ids():
    with pytest.raises(UnknownToolExperiment, match="可用实验 ID"):
        tools.get_experiment_config("not-registered")


def test_payload_shape_mismatch_has_a_readable_message():
    with pytest.raises(ToolInputError, match="data 必须是一个 JSON 对象"):
        tools.process_experiment_data("sound-light", ["not", "an", "object"])
    with pytest.raises(ToolInputError, match="入参结构不符合"):
        tools.process_experiment_data("sound-light", {"method": "行波法", "rows": "oops"})


# ---------------------------------------------------------- validate/process

@pytest.mark.parametrize("experiment_id", PUBLIC_EXPERIMENT_IDS)
def test_typical_fixture_validates_and_processes(experiment_id):
    fixture = load_fixture(experiment_id, "typical")
    data = process_input(fixture)

    validation = tools.validate_experiment_data(experiment_id, data)
    assert validation["valid"] is True, validation
    assert validation["errors"] == []

    result = tools.process_experiment_data(experiment_id, data)
    assert result["status"] == "success", result
    assert result["results"]
    assert result["experiment_id"] == experiment_id
    for plot in (result.get("plots") or {}).values():
        assert Path(plot["path"]).is_file()
        assert plot["mime"] == "image/png"
        assert Path(plot["path"]).read_bytes().startswith(b"\x89PNG")


def test_inline_plots_keep_the_data_uri():
    fixture = load_fixture("michelson", "typical")
    result = tools.process_experiment_data("michelson", fixture["data"], inline_plots=True)
    plots = result.get("plots") or {}
    assert plots, "迈克尔逊实验应产生拟合图"
    for plot in plots.values():
        assert isinstance(plot, str) and plot.startswith("data:image/png;base64,")


def test_soundlight_accepts_both_single_method_and_method_keyed_forms():
    fixture = load_fixture("sound-light", "typical")
    method_id, payload = next(iter(fixture["data"].items()))
    flat = tools.process_experiment_data("sound-light", {"method": method_id, **payload})
    keyed = tools.process_experiment_data("sound-light", {method_id: payload})
    assert flat["status"] == keyed["status"] == "success"
    assert flat["results"] == keyed["results"]


def test_invalid_fixture_does_not_crash_processing():
    fixture = load_fixture("michelson", "invalid")
    result = tools.process_experiment_data("michelson", fixture["data"])
    assert result["status"] != "success"
    assert result["errors"]


def test_non_finite_numbers_are_rendered_as_null():
    assert payloads.json_safe({"a": float("nan"), "b": float("inf"), "c": [1.0, 2]}) == {
        "a": None, "b": None, "c": [1.0, 2],
    }


# ---------------------------------------------------------------- documents

@pytest.mark.parametrize("experiment_id", PUBLIC_EXPERIMENT_IDS)
@pytest.mark.parametrize("fmt", ["docx", "pdf"])
@pytest.mark.document
def test_typical_fixture_generates_reports(experiment_id, fmt, isolated_output_dir):
    fixture = load_fixture(experiment_id, "typical")
    payload = tools.generate_experiment_report(experiment_id, report_input(fixture), fmt)
    assert payload["fmt"] == fmt
    artifact = payload["file"]
    path = Path(artifact["path"])
    assert path.is_file()
    assert path.parent == isolated_output_dir
    assert artifact["bytes"] == path.stat().st_size > 1000
    content = path.read_bytes()
    if fmt == "docx":
        assert content.startswith(b"PK")
        assert artifact["mime"].endswith("wordprocessingml.document")
    else:
        assert content.startswith(b"%PDF")
        assert artifact["mime"] == "application/pdf"


@pytest.mark.parametrize("experiment_id", PUBLIC_EXPERIMENT_IDS)
@pytest.mark.parametrize("fmt", ["docx", "pdf"])
@pytest.mark.document
def test_every_experiment_has_a_blank_record_sheet(experiment_id, fmt):
    artifact = tools.generate_record_sheet(experiment_id, fmt)["file"]
    content = Path(artifact["path"]).read_bytes()
    assert content.startswith(b"PK" if fmt == "docx" else b"%PDF")
    assert "-数据记录表-" in artifact["filename"]


def test_report_rejects_a_missing_required_method():
    with pytest.raises(ToolInputError, match="请先填写完全部必做实验"):
        tools.generate_experiment_report("michelson", {}, "docx")


def test_report_rejects_an_unsupported_format():
    with pytest.raises(ToolInputError, match="fmt 必须是 docx 或 pdf"):
        tools.generate_experiment_report("michelson", {}, "xlsx")


def test_report_filenames_are_windows_safe():
    fixture = load_fixture("michelson", "typical")
    artifact = tools.generate_experiment_report("michelson", fixture["data"], "docx")["file"]
    assert not set(artifact["filename"]) & set('<>:"/\\|?*')
    assert artifact["filename"].endswith(".docx")


# ---------------------------------------------------------------------- OCR

def test_recognize_record_sheet_uses_the_local_service(tmp_path, monkeypatch):
    image = tmp_path / "sheet.png"
    image.write_bytes(b"not-a-real-image")

    def fake_recognize(content: bytes) -> dict:
        assert content == b"not-a-real-image"
        return {"candidates": [{"raw_text": "12.3", "value": "12.3",
                                "confidence": 0.9, "bbox": [[0, 0], [1, 0], [1, 1]]}],
                "detected_text_count": 1, "ocr_provider": "fake",
                "ocr_model_version": "test"}

    import app.ocr_service as ocr_service

    monkeypatch.setattr(ocr_service, "recognize_numeric_candidates", fake_recognize)
    result = tools.recognize_record_sheet(str(image), "michelson", "wavelength")
    assert result["status"] == "success"
    assert result["candidates"][0]["value"] == "12.3"
    assert "确认" in result["note"]


def test_recognize_record_sheet_rejects_a_missing_file(tmp_path):
    with pytest.raises(ToolInputError, match="图片文件不存在"):
        tools.recognize_record_sheet(str(tmp_path / "nope.png"))


# ------------------------------------------------------------ data collection

def test_data_collection_tools_are_disabled_by_default(tmp_path):
    with pytest.raises(ToolDisabled, match="PHYSICSLAB_MCP_ENABLE_DATA_COLLECTION"):
        tools.contribute_record_sheet(str(tmp_path / "sheet.png"), "michelson", True)
    with pytest.raises(ToolDisabled):
        tools.withdraw_contribution("session-1")


def test_data_collection_tools_register_only_when_switched_on(monkeypatch):
    monkeypatch.setenv(tools.DATA_COLLECTION_FLAG, "true")
    names = tool_names()
    for expected in ("data_collection_status", "contribute_record_sheet",
                     "commit_contributed_data", "withdraw_contribution"):
        assert expected in names
    status = tools.data_collection_status()
    assert status["mcp_tools_enabled"] is True
    assert status["privacy_note"]


def test_contribute_requires_explicit_consent(monkeypatch, tmp_path):
    monkeypatch.setenv(tools.DATA_COLLECTION_FLAG, "true")
    monkeypatch.setenv("ENABLE_DATA_COLLECTION", "true")
    image = tmp_path / "sheet.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\n")
    with pytest.raises(ToolInputError, match="明确同意"):
        tools.contribute_record_sheet(str(image), "michelson", False)


def test_contribute_rejects_a_private_experiment_id(monkeypatch, tmp_path):
    monkeypatch.setenv(tools.DATA_COLLECTION_FLAG, "true")
    monkeypatch.setenv("ENABLE_DATA_COLLECTION", "true")
    image = tmp_path / "sheet.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\n")
    with pytest.raises(ToolInputError, match="未公开"):
        tools.contribute_record_sheet(str(image), "photoelectric", True)


# ----------------------------------------------------------------- artifacts

def test_output_dir_defaults_to_the_temp_directory(monkeypatch):
    monkeypatch.delenv("PHYSICSLAB_MCP_OUTPUT_DIR", raising=False)
    assert artifacts.output_dir().name == "physlab-mcp"
    assert artifacts.output_dir().is_dir()


def test_saved_documents_never_collide(tmp_path):
    first = artifacts.save_bytes(b"PK\x03\x04", label="实验报告", fmt="docx")
    second = artifacts.save_bytes(b"PK\x03\x04", label="实验报告", fmt="docx")
    assert first["path"] != second["path"]
    assert Path(first["path"]).read_bytes() == b"PK\x03\x04"
    assert json.loads(json.dumps(first))["bytes"] == 4


def test_registry_is_not_polluted_by_legacy_ids():
    assert registry.get("photoelectric").legacy is True
    assert "photoelectric" not in PUBLIC_EXPERIMENT_IDS
