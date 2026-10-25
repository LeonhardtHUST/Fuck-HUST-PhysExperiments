"""Report precondition shared by the HTTP route and the MCP tools.

``app.routers.reports`` used to keep this check inline.  The MCP server needs
the same decision without FastAPI, so the rule lives here and each caller
formats its own error (``HTTPException`` vs. a tool error).
"""

from __future__ import annotations

from typing import Any


def missing_required_methods(config: Any, data: dict[str, dict[str, Any]] | None) -> list[str]:
    """Names of required sub-experiments that are not completely filled in.

    ``config`` is the experiment config dict (``{"methods": [...]}``).  The
    sound-light config is a bare method list and its bespoke report route never
    runs this gate, so a non-dict config simply has no requirements.
    """
    if not isinstance(config, dict):
        return []
    submitted_data = data or {}
    missing: list[str] = []
    for method in config.get("methods", []) or []:
        if not method.get("required"):
            continue
        submitted = submitted_data.get(method["id"]) or {}
        rows = submitted.get("rows", []) or []
        columns = [column["key"] for column in method.get("columns", [])]
        # 行数可自由增删：只要求达到计算下限（rowCount 仅是讲义推荐条数），
        # 且已提交的每一行都填完整
        min_rows = max(1, int(method.get("minRows") or 1))
        params = submitted.get("params", {}) or {}
        required_params = [parameter["key"] for parameter in method.get("params", [])
                           if parameter.get("required")]
        complete = (
            len(rows) >= min_rows
            and all(row.get(key) not in (None, "")
                    for row in rows for key in columns)
            # 现场实测的参数（如卧式电桥的预平衡 Rn）缺一不可，否则该方法的公式根本无法反解
            and all(params.get(key) not in (None, "") for key in required_params)
        )
        if not complete:
            missing.append(method["name"])
    return missing
