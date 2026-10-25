"""Tool-level errors with student-facing Chinese messages.

The MCP layer turns these into tool results flagged ``isError``; keeping the
messages here (instead of raising ``HTTPException``) lets the tool functions be
called from pytest without a FastAPI app.
"""

from __future__ import annotations


class ToolError(Exception):
    """Base class for every error the MCP tools report deliberately."""


class ToolInputError(ToolError):
    """Argument shape or value is not usable for this experiment."""


class UnknownToolExperiment(ToolInputError):
    """The requested experiment id is not registered."""


class ToolDisabled(ToolError):
    """The tool exists in code but is switched off by configuration."""
