import os
import re
from pathlib import Path
from tools.base import ToolDef

_WORKSPACE = os.getenv("AGENT_WORKSPACE", "/tmp/agent-workspace")
_MAX_MATCHES = 200
_MAX_FILE_SIZE = 500_000  # 500 KB — skip binary-like large files


def _resolve_workspace() -> Path:
    return Path(_WORKSPACE).resolve()


class GrepTool(ToolDef):
    name = "grep"
    description = (
        "Search for a regex pattern across files in the agent workspace. "
        "Returns file paths, line numbers, and matching lines."
    )
    auth_level = "read"

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regular expression to search for",
                },
                "include": {
                    "type": "string",
                    "default": "**/*",
                    "description": "Glob pattern for files to search (default: all files)",
                },
                "case_sensitive": {
                    "type": "boolean",
                    "default": True,
                    "description": "Whether the search is case-sensitive",
                },
                "context_lines": {
                    "type": "integer",
                    "default": 0,
                    "minimum": 0,
                    "maximum": 5,
                    "description": "Number of context lines to include around each match",
                },
                "max_results": {
                    "type": "integer",
                    "default": 50,
                    "minimum": 1,
                    "maximum": _MAX_MATCHES,
                    "description": "Maximum number of matches to return",
                },
            },
            "required": ["pattern"],
        }

    async def call(
        self,
        pattern: str,
        include: str = "**/*",
        case_sensitive: bool = True,
        context_lines: int = 0,
        max_results: int = 50,
    ) -> dict:
        workspace = _resolve_workspace()
        workspace.mkdir(parents=True, exist_ok=True)
        max_results = min(max_results, _MAX_MATCHES)

        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return {"error": f"Invalid regex: {e}", "matches": [], "count": 0}

        matches = []
        files_searched = 0

        for filepath in sorted(workspace.glob(include)):
            if not filepath.is_file():
                continue
            if filepath.stat().st_size > _MAX_FILE_SIZE:
                continue

            try:
                text = filepath.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue

            lines = text.splitlines()
            files_searched += 1

            for line_no, line in enumerate(lines, start=1):
                if regex.search(line):
                    ctx_start = max(0, line_no - 1 - context_lines)
                    ctx_end = min(len(lines), line_no + context_lines)
                    context = lines[ctx_start:ctx_end]

                    matches.append(
                        {
                            "file": str(filepath.relative_to(workspace)),
                            "line": line_no,
                            "match": line,
                            "context": context if context_lines > 0 else None,
                        }
                    )

                    if len(matches) >= max_results:
                        break

            if len(matches) >= max_results:
                break

        return {
            "pattern": pattern,
            "matches": matches,
            "count": len(matches),
            "files_searched": files_searched,
            "truncated": len(matches) == max_results,
        }
