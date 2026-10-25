"""Machine-readable report exports: JSONC and Markdown.

DOCX/PDF are rendered from the same ``blocks`` list every experiment already
builds (``four_section_report``).  These two extra formats reuse that list so
all four deliverables stay in sync: a block kind added for Word/PDF is picked
up here without a second content model.

* JSONC — one self-describing document, validated by
  ``docs/schemas/report.schema.json``.  Layout-only blocks (``spacer``) are
  dropped, ``pagebreak`` becomes ``pageBreak`` and table cells are flattened to
  strings, so consumers do not have to know the Word/PDF table spec.
* Markdown — the human-readable flavour: headings, GFM tables, ``$$``
  equations and base64 figures, so a single ``.md`` file stays self-contained.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

REPORT_FORMATS = ("docx", "pdf", "md", "jsonc")
"""Every format ``report_bytes`` accepts (renderers live in ``docbuild``)."""

SCHEMA_VERSION = 1
SCHEMA_PATH = "docs/schemas/report.schema.json"

_TEXT_KINDS = ("h1", "h2", "h3", "sub", "para", "note")
_HEADING_PREFIX = {"h1": "#", "h2": "##", "h3": "###"}


def _text(value: Any) -> str:
    return "" if value is None else str(value).replace("\r", "")


def _cell(value: Any) -> str:
    if isinstance(value, dict):
        return _text(value.get("text", ""))
    return _text(value)


def _table_rows(block: dict) -> list[list[str]]:
    rows = [[_cell(cell) for cell in row] for row in block.get("rows", [])]
    columns = max((len(row) for row in rows), default=0)
    if not columns:
        return []
    return [row + [""] * (columns - len(row)) for row in rows]


def _block(block: dict) -> dict | None:
    """Translate one layout block into the exported schema's vocabulary."""
    kind = block.get("kind")
    if kind in _TEXT_KINDS:
        return {"kind": kind, "text": _text(block.get("text", ""))}
    if kind == "table":
        rows = _table_rows(block)
        return {"kind": "table", "rows": rows} if rows else None
    if kind == "image":
        item = {"kind": "figure", "mime": "image/png", "base64": _text(block.get("b64", ""))}
        caption = _text(block.get("caption", ""))
        if caption:
            item["caption"] = caption
        return item
    if kind == "equation":
        return {"kind": "equation", "latex": _text(block.get("latex", ""))}
    if kind == "lines":
        return {"kind": "ruledLines", "count": int(block.get("n", 1) or 0)}
    if kind == "pagebreak":
        return {"kind": "pageBreak"}
    # ``spacer`` and anything unknown only affect paper layout.
    return None


def build_document(
    blocks: Iterable[dict],
    *,
    experiment_id: str,
    experiment_name: str,
    title: str,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Assemble the exported report document (shared by JSONC and Markdown)."""
    content = [item for item in (_block(block) for block in blocks) if item]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "physlab.report",
        "generator": "PhysicsLab",
        "generatedAt": generated_at or _utc_now(),
        "experiment": {"id": experiment_id, "name": experiment_name},
        "title": title,
        "content": content,
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def to_jsonc(document: dict[str, Any]) -> str:
    """Serialise with a JSONC header; strip the ``//`` lines to get strict JSON."""
    header = "\n".join((
        "// PhysicsLab 完整报告（JSONC）",
        f"// schemaVersion: {SCHEMA_VERSION} · schema: {SCHEMA_PATH}",
        "// 删除注释行后即为合法 JSON；content 按文档顺序排列。",
    ))
    return header + "\n" + json.dumps(document, ensure_ascii=False, indent=2) + "\n"


def _md_cell(value: str) -> str:
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("\n", "<br>").strip()


def _md_table(rows: list[list[str]]) -> list[str]:
    columns = len(rows[0])
    head = "| " + " | ".join(_md_cell(cell) for cell in rows[0]) + " |"
    divider = "| " + " | ".join(["---"] * columns) + " |"
    body = [
        "| " + " | ".join(_md_cell(cell) for cell in row) + " |"
        for row in rows[1:]
    ]
    return [head, divider, *body]


def to_markdown(document: dict[str, Any]) -> str:
    """Render the document as one self-contained Markdown file."""
    experiment = document.get("experiment", {})
    lines: list[str] = [
        f"<!-- physlab.report schemaVersion={document.get('schemaVersion')}"
        f" experiment={experiment.get('id', '')}"
        f" generatedAt={document.get('generatedAt', '')} -->",
    ]
    content = document.get("content", [])
    if not content or content[0].get("kind") != "h1":
        lines += [f"# {document.get('title', '完整报告')}", ""]

    for block in content:
        kind = block.get("kind")
        if kind in _HEADING_PREFIX:
            lines += [f"{_HEADING_PREFIX[kind]} {block.get('text', '')}", ""]
        elif kind == "sub":
            lines += [f"*{block.get('text', '')}*", ""]
        elif kind == "para":
            lines += [block.get("text", ""), ""]
        elif kind == "note":
            quote = block.get("text", "").splitlines() or [""]
            lines += [f"> {line}" if line else ">" for line in quote] + [""]
        elif kind == "table":
            rows = block.get("rows") or []
            if rows:
                lines += _md_table(rows) + [""]
        elif kind == "equation":
            lines += ["$$", block.get("latex", ""), "$$", ""]
        elif kind == "figure":
            caption = block.get("caption", "")
            alt = caption.replace("]", "）")
            mime = block.get("mime", "image/png")
            lines += [f"![{alt}](data:{mime};base64,{block.get('base64', '')})", ""]
            if caption:
                lines += [f"*{caption}*", ""]
        elif kind == "ruledLines":
            lines += [f"> （此处留白 {block.get('count', 0)} 行，供手写）", ""]
        elif kind == "pageBreak":
            lines += ["---", ""]

    return "\n".join(lines).rstrip() + "\n"


def export_bytes(
    blocks: Iterable[dict],
    fmt: str,
    *,
    experiment_id: str,
    experiment_name: str,
    title: str,
) -> bytes:
    """Render a non-DOCX/PDF report format; raises ``ValueError`` for others."""
    if fmt not in ("md", "jsonc"):
        raise ValueError(f"不支持的文本报告格式：{fmt}")
    document = build_document(
        blocks,
        experiment_id=experiment_id,
        experiment_name=experiment_name,
        title=title,
    )
    text = to_jsonc(document) if fmt == "jsonc" else to_markdown(document)
    return text.encode("utf-8")
