#!/usr/bin/env python3
"""stdio entry point for the PhysLab MCP server.

An AI client (codex, opencode, CodeBuddy, Claude Desktop, …) starts this file as
a child process and speaks JSON-RPC on stdin/stdout.  Two rules follow from that:

* **stdout carries protocol frames only** — logging goes to stderr and nothing
  in this process may ``print()``.
* every import stays behind ``main()``/the backend path setup so a broken
  optional dependency reports on stderr instead of corrupting the first frame.

Usage::

    python backend/mcp_server.py            # serve on stdio
    python backend/mcp_server.py --check     # print the tool manifest to stderr
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

#: Must be set before matplotlib is imported anywhere in the engine.
os.environ.setdefault("MPLBACKEND", "Agg")


def _configure_logging() -> None:
    logging.basicConfig(
        stream=sys.stderr,
        level=os.getenv("PHYSICSLAB_MCP_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def main(argv: list[str] | None = None) -> int:
    _configure_logging()
    from app.dev_env import load_local_env

    # backend/.env.local switches (ENABLE_DATA_COLLECTION, output dir, …) apply
    # exactly like they do for `uvicorn app.main:app`.
    load_local_env()

    from physlab_mcp.server import main as serve

    return serve(sys.argv[1:] if argv is None else argv)


if __name__ == "__main__":
    raise SystemExit(main())
