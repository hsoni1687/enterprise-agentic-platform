import httpx
from tools.base import ToolDef

_DDG_URL = "https://html.duckduckgo.com/html/"
_MAX_RESULTS = 10


class WebSearchTool(ToolDef):
    name = "web-search"
    description = (
        "Search the web using DuckDuckGo and return ranked results with titles, "
        "URLs, and snippets. No API key required."
    )
    auth_level = "read"

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "max_results": {
                    "type": "integer",
                    "default": 5,
                    "minimum": 1,
                    "maximum": _MAX_RESULTS,
                    "description": "Maximum number of results to return",
                },
            },
            "required": ["query"],
        }

    async def call(self, query: str, max_results: int = 5) -> dict:
        max_results = min(max_results, _MAX_RESULTS)
        results = []

        async with httpx.AsyncClient(
            timeout=15,
            follow_redirects=True,
            verify=False,
            headers={"User-Agent": "Mozilla/5.0 (compatible; A1AgentPlatform/1.0)"},
        ) as client:
            resp = await client.post(_DDG_URL, data={"q": query, "b": ""})
            html = resp.text

        # Parse results from DuckDuckGo HTML response
        import re

        # Extract result blocks — each result has class "result__body"
        # Pattern: <a class="result__a" href="...">title</a> and snippet in result__snippet
        link_pattern = re.compile(
            r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
            re.DOTALL,
        )
        snippet_pattern = re.compile(
            r'class="result__snippet"[^>]*>(.*?)</div>',
            re.DOTALL,
        )

        links = link_pattern.findall(html)
        snippets = snippet_pattern.findall(html)

        def strip_tags(s: str) -> str:
            return re.sub(r"<[^>]+>", "", s).strip()

        for i, (url, title) in enumerate(links[:max_results]):
            snippet = strip_tags(snippets[i]) if i < len(snippets) else ""
            results.append(
                {
                    "rank": i + 1,
                    "title": strip_tags(title),
                    "url": url,
                    "snippet": snippet,
                }
            )

        return {
            "query": query,
            "results": results,
            "count": len(results),
        }
