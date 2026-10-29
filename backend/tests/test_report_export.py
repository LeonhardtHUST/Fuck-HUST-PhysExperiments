"""JSONC / Markdown exports of the complete report.

The JSONC document is checked against ``docs/schemas/report.schema.json`` without
pulling in a validator dependency: the schema is parsed, the block kinds it
declares are collected, and every exported block must be one of them.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from experiments.core.report_export import SCHEMA_PATH, SCHEMA_VERSION
from tests.test_public_experiment_usability import load_fixture, report_body

CLIENT = TestClient(app)
REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((REPO_ROOT / SCHEMA_PATH).read_text(encoding="utf-8"))


def _report(experiment_id: str, fmt: str):
    fixture = load_fixture(experiment_id, "typical")
    response = CLIENT.post(
        f"/api/experiments/{experiment_id}/report?fmt={fmt}",
        json=report_body(fixture),
    )
    assert response.status_code == 200, response.text
    return response


def _strip_jsonc(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("//"))


def _schema_block_kinds() -> set[str]:
    kinds: set[str] = set()
    for definition in SCHEMA["$defs"].values():
        kind = definition.get("properties", {}).get("kind")
        if not isinstance(kind, dict):
            continue
        kinds.update(kind.get("enum", []))
        if "const" in kind:
            kinds.add(kind["const"])
    return kinds


def test_schema_file_is_valid_json_and_lists_every_block_kind():
    assert SCHEMA["$schema"].startswith("https://json-schema.org/")
    kinds = _schema_block_kinds()

    assert {"h1", "h2", "h3", "sub", "para", "note"} <= kinds
    assert {"table", "equation", "figure", "ruledLines", "pageBreak"} <= kinds
    assert "spacer" not in kinds


@pytest.mark.parametrize("experiment_id", ["multimeter", "polarization", "sound-light"])
def test_jsonc_report_matches_the_repository_schema(experiment_id):
    response = _report(experiment_id, "jsonc")

    assert response.headers["content-type"].startswith("application/jsonc")
    assert ".jsonc" in response.headers["content-disposition"]
    text = response.content.decode("utf-8")
    assert text.startswith("// PhysExp Killer 完整报告（JSONC）")
    assert SCHEMA_PATH in text

    document = json.loads(_strip_jsonc(text))
    assert document["schemaVersion"] == SCHEMA_VERSION
    assert document["kind"] == "physlab.report"
    assert document["experiment"]["id"] == experiment_id
    assert document["experiment"]["name"]
    assert document["generatedAt"].endswith("Z")
    assert document["content"], "报告不应为空"

    kinds = {block["kind"] for block in document["content"]}
    assert kinds <= _schema_block_kinds()
    assert "pageBreak" in kinds
    for block in document["content"]:
        if block["kind"] == "table":
            widths = {len(row) for row in block["rows"]}
            assert len(widths) == 1, "同一张表的每一行列数必须一致"


@pytest.mark.parametrize("experiment_id", ["multimeter", "polarization", "sound-light"])
def test_markdown_report_is_self_contained(experiment_id):
    response = _report(experiment_id, "md")

    assert response.headers["content-type"].startswith("text/markdown")
    assert ".md" in response.headers["content-disposition"]
    text = response.content.decode("utf-8")

    assert text.startswith("<!-- physlab.report schemaVersion=1")
    assert "\n# " in text
    assert "| --- |" in text
    assert "$$" in text
    assert "spacer" not in text


def test_markdown_embeds_figures_as_data_uris():
    response = _report("michelson", "md")
    text = response.content.decode("utf-8")

    assert "!["
    assert "](data:image/png;base64," in text


def test_generic_report_rejects_an_unknown_format():
    response = _report("multimeter", "docx")
    assert response.status_code == 200

    fixture = load_fixture("multimeter", "typical")
    response = CLIENT.post(
        "/api/experiments/multimeter/report?fmt=xlsx",
        json=report_body(fixture),
    )
    assert response.status_code == 400
    assert "jsonc" in response.json()["detail"]
