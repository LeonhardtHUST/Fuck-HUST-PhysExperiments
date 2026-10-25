"""Local artifact sink for MCP tools.

The protocol cannot stream a 900 KB DOCX or a PDF figure, so every binary the
tools produce (report, blank record sheet, fitting plot) is written to a local
directory and described by ``{path, mime, bytes, filename}``.  The AI client
opens the path itself.

The directory is ``PHYSICSLAB_MCP_OUTPUT_DIR`` when set, otherwise
``<system temp>/physlab-mcp``; the repository work tree is never written to.
"""

from __future__ import annotations

import base64
import binascii
import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MIME_BY_EXTENSION = {
    "docx": DOCX_MIME,
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "svg": "image/svg+xml",
    "json": "application/json",
    "txt": "text/plain",
}
EXTENSION_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
}

#: Windows rejects these in file names; experiment labels also carry Chinese
#: punctuation that is fine, so only strip what actually breaks a path.
_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_MAX_LABEL = 60


def output_dir() -> Path:
    """Resolve (and create) the directory that receives every artifact."""
    configured = os.getenv("PHYSICSLAB_MCP_OUTPUT_DIR", "").strip()
    root = Path(configured).expanduser() if configured else Path(tempfile.gettempdir()) / "physlab-mcp"
    root.mkdir(parents=True, exist_ok=True)
    return root


def sanitize_label(label: str) -> str:
    cleaned = _ILLEGAL.sub("_", label).strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned or "physlab")[:_MAX_LABEL]


def _write(content: bytes, label: str, extension: str) -> dict[str, Any]:
    extension = extension.lower().lstrip(".")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    filename = f"{sanitize_label(label)}-{stamp}-{uuid.uuid4().hex[:6]}.{extension}"
    path = output_dir() / filename
    path.write_bytes(content)
    return {
        "path": str(path.resolve()),
        "mime": MIME_BY_EXTENSION.get(extension, "application/octet-stream"),
        "bytes": len(content),
        "filename": filename,
    }


def save_bytes(content: bytes, *, label: str, fmt: str) -> dict[str, Any]:
    """Write a document (``docx`` / ``pdf``) and describe where it landed."""
    if not content:
        raise ValueError("生成的文档为空")
    return _write(content, label, fmt)


def _decode_plot(value: str) -> tuple[bytes, str]:
    """Accept a bare base64 PNG (what the engines return) or a full data URI."""
    header, separator, payload = value.partition(",")
    if value.startswith("data:"):
        if not separator:
            raise ValueError("data URI 缺少 base64 内容")
        if ";base64" not in header:
            raise ValueError("data URI 不是 base64 编码")
        mime = header[len("data:"):].split(";")[0].strip().lower() or "image/png"
        encoded = payload
    else:
        mime, encoded = "image/png", value
    try:
        return base64.b64decode(encoded, validate=False), mime
    except (binascii.Error, ValueError) as exc:
        raise ValueError("拟合图的 base64 内容无法解码") from exc


def save_plot(value: str, *, label: str) -> dict[str, Any]:
    """Write one chart image and describe where it landed."""
    content, mime = _decode_plot(value)
    if not content:
        raise ValueError("拟合图为空")
    return _write(content, label, EXTENSION_BY_MIME.get(mime, "png"))


def as_data_uri(value: str) -> str:
    """Normalise a bare base64 PNG into a data URI (``inline_plots=True``)."""
    if value.startswith("data:"):
        return value
    return f"data:image/png;base64,{value}"


def save_plots(plots: dict[str, Any], *, experiment_id: str) -> dict[str, Any]:
    """Materialise the ``plots`` envelope; unreadable entries stay untouched."""
    saved: dict[str, Any] = {}
    for method_id, plot in plots.items():
        if not isinstance(plot, str):
            saved[method_id] = plot
            continue
        try:
            saved[method_id] = save_plot(plot, label=f"{experiment_id}-{method_id}-拟合图")
        except ValueError as exc:
            saved[method_id] = {"error": str(exc), "detail": "图像未能落盘"}
    return saved
