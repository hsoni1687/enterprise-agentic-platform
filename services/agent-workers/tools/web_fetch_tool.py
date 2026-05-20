import re
import httpx
from tools.base import ToolDef

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; A1AgentPlatform/1.0)"}
_MAX_CHARS = 12_000


def _strip_html(html: str) -> str:
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<[^>]+>", " ", html)
    html = re.sub(r"[ \t]+", " ", html)
    html = re.sub(r"\n{3,}", "\n\n", html)
    return html.strip()


class WebFetchTool(ToolDef):
    name = "web-fetch"
    description = (
        "Fetch content from any public URL and return it as plain text. "
        "HTML is stripped to readable text. Redirects are followed automatically."
    )
    auth_level = "read"

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Fully-qualified URL to fetch"},
                "timeout_seconds": {
                    "type": "integer",
                    "default": 30,
                    "description": "Request timeout in seconds",
                },
                "max_chars": {
                    "type": "integer",
                    "default": 12000,
                    "description": "Max characters to return from the page",
                },
            },
            "required": ["url"],
        }

    async def call(self, url: str, timeout_seconds: int = 30, max_chars: int = _MAX_CHARS) -> dict:
        async with httpx.AsyncClient(
            timeout=timeout_seconds,
            follow_redirects=True,
            verify=False,
            headers=_HEADERS,
        ) as client:
            resp = await client.get(url)

        content_type = resp.headers.get("content-type", "")
        raw = resp.text

        if "html" in content_type or raw.lstrip().startswith("<"):
            text = _strip_html(raw)
        else:
            text = raw

        text = text[:max_chars]

        return {
            "url": str(resp.url),
            "status_code": resp.status_code,
            "content_type": content_type,
            "content": text,
            "chars": len(text),
        }
