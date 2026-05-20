import os
from pathlib import Path
from tools.base import ToolDef

_WORKSPACE = os.getenv("AGENT_WORKSPACE", "/tmp/agent-workspace")
_MAX_MATCHES = 500


def _resolve_workspace() -> Path:
    return Path(_WORKSPACE).resolve()


class GlobTool(ToolDef):
    name = "glob"
    description = (
        "Find files in the agent workspace matching a glob pattern. "
        "Returns matching paths relative to the workspace root."
    )
    auth_level = "read"

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern, e.g. '**/*.py' or 'src/*.txt'",
                },
                "max_results": {
                    "type": "integer",
                    "default": 100,
                    "minimum": 1,
                    "maximum": _MAX_MATCHES,
                    "description": "Maximum number of matches to return",
                },
            },
            "required": ["pattern"],
        }

    async def call(self, pattern: str, max_results: int = 100) -> dict:
        workspace = _resolve_workspace()
        workspace.mkdir(parents=True, exist_ok=True)

        max_results = min(max_results, _MAX_MATCHES)
        matches = []

        for p in workspace.glob(pattern):
            if len(matches) >= max_results:
                break
            rel = str(p.relative_to(workspace))
            matches.append(
                {
                    "path": rel,
                    "type": "file" if p.is_file() else "directory",
                    "size": p.stat().st_size if p.is_file() else None,
                }
            )

        matches.sort(key=lambda x: x["path"])

        return {
            "pattern": pattern,
            "matches": matches,
            "count": len(matches),
            "truncated": len(matches) == max_results,
        }
