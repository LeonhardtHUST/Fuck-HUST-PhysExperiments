"""Index over the per-experiment ``data_reference.json`` cards.

Every published experiment ships a 「数据特征参考」 file next to its config; the
folder name does not always match the public experiment id (``soundlight`` vs
``sound-light``), so the index is keyed by the ``experiment_id`` field *inside*
the file.  A new experiment therefore needs no change here.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from physlab_mcp.errors import ToolInputError

EXPERIMENTS_DIR = Path(__file__).resolve().parents[1] / "experiments"
REFERENCE_FILENAME = "data_reference.json"


@lru_cache(maxsize=1)
def _index() -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for path in sorted(EXPERIMENTS_DIR.glob(f"*/{REFERENCE_FILENAME}")):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        experiment_id = str(document.get("experiment_id") or path.parent.name)
        index[experiment_id] = {**document, "source_file": str(path)}
    return index


def available() -> list[str]:
    return sorted(_index())


def get_reference(experiment_id: str) -> dict[str, Any]:
    document = _index().get(experiment_id)
    if document is None:
        raise ToolInputError(
            f"实验「{experiment_id}」没有数据特征参考；可用实验 ID：{'、'.join(available())}"
        )
    return json.loads(json.dumps(document, ensure_ascii=False))


def reload() -> None:
    """Drop the cache (tests, and after adding an experiment at runtime)."""
    _index.cache_clear()
