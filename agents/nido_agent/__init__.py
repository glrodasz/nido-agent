"""ADK CLI entry point: `adk web agents` / `adk run agents/nido_agent`.

The real app lives in the installed `nido` package; this shim re-exports it so the ADK agent
loader (which imports `<agents_dir>/<name>`) finds `app` and `root_agent`.
"""

from nido.agent.app import app, root_agent

__all__ = ["app", "root_agent"]
