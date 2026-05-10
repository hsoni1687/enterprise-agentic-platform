#!/usr/bin/env python3
"""
Web search implementation using DuckDuckGo's API (no auth required).
"""

import requests
import json
import sys
from typing import Optional


def web_search(query: str, max_results: int = 10) -> dict:
    """
    Search the web using DuckDuckGo's instant answer API.

    Args:
        query: The search query
        max_results: Maximum number of results to return

    Returns:
        dict with 'results' list containing title, url, snippet for each result
    """
    try:
        # DuckDuckGo instant answer endpoint (no auth required)
        url = "https://api.duckduckgo.com/"
        params = {
            "q": query,
            "format": "json",
            "no_html": 1,
            "skip_disambig": 1,
            "max_results": max_results
        }

        # Add timeout and verify SSL
        response = requests.get(url, params=params, timeout=10, verify=True)
        response.raise_for_status()

        data = response.json()
        results = []

        # Extract instant answer if available
        if data.get("AbstractText"):
            results.append({
                "title": data.get("Heading", ""),
                "url": data.get("AbstractURL", ""),
                "snippet": data.get("AbstractText", "")
            })

        # Extract related topics
        if data.get("RelatedTopics"):
            for topic in data.get("RelatedTopics", [])[:max_results]:
                if "Text" in topic and "FirstURL" in topic:
                    results.append({
                        "title": topic.get("Text", "").split(" - ")[0],
                        "url": topic.get("FirstURL", ""),
                        "snippet": topic.get("Text", "")
                    })

        return {
            "results": results[:max_results],
            "total": len(results),
            "query": query
        }

    except requests.exceptions.RequestException as e:
        return {
            "error": f"Failed to fetch search results: {str(e)}",
            "results": []
        }
    except Exception as e:
        return {
            "error": f"Search error: {str(e)}",
            "results": []
        }


if __name__ == "__main__":
    # Handle stdin input
    try:
        input_data = json.loads(sys.stdin.read())
        query = input_data.get("query", "")
        max_results = input_data.get("max_results", 10)

        if not query:
            print(json.dumps({"error": "query parameter is required"}))
            sys.exit(1)

        result = web_search(query, max_results)
        print(json.dumps(result))

    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON input"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
