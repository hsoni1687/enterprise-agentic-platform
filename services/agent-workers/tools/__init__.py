"""
Built-in platform tools.

Each tool is a self-contained ToolDef subclass with:
  - name / description / auth_level class attributes
  - input_schema property (JSON Schema)
  - call(**kwargs) async method (the actual implementation)

Import via: from tools.registry import ALL_TOOLS, get_tool
"""
from tools.bash_tool import BashTool
from tools.web_fetch_tool import WebFetchTool
from tools.web_search_tool import WebSearchTool
from tools.file_read_tool import FileReadTool
from tools.file_write_tool import FileWriteTool
from tools.file_edit_tool import FileEditTool
from tools.glob_tool import GlobTool
from tools.grep_tool import GrepTool
from tools.todo_tool import TodoTool

__all__ = [
    "BashTool",
    "WebFetchTool",
    "WebSearchTool",
    "FileReadTool",
    "FileWriteTool",
    "FileEditTool",
    "GlobTool",
    "GrepTool",
    "TodoTool",
]
