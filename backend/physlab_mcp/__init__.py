"""PhysLab MCP server: the experiment engines exposed as Model Context Protocol tools.

Layout:

* ``tools``      – protocol-free implementations (dict in, dict out)
* ``payloads``   – normalises AI payloads onto the three existing request shapes
* ``artifacts``  – writes reports / record sheets / plots to disk and describes them
* ``references`` – index over each experiment's ``data_reference.json``
* ``server``     – FastMCP wiring, tool docstrings and the stdio entry point

The package is deliberately *not* named ``mcp``: the official SDK is imported as
``mcp`` and ``backend/`` sits on ``sys.path``, so a local ``mcp`` package would
shadow it.
"""

from __future__ import annotations

__all__ = ["build_server", "main"]


def __getattr__(name: str):
    """Keep ``import physlab_mcp`` free of the (heavier) engine and SDK imports."""
    if name == "build_server":
        from physlab_mcp.server import build_server

        return build_server
    if name == "main":
        from physlab_mcp.server import main

        return main
    raise AttributeError(name)
