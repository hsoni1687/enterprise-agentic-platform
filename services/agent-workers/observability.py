"""
Central observability module for agent-workers.

Responsibilities
────────────────
1. emit()         — async, best-effort write to agent_run_events (Postgres)
2. get_langfuse() — lazy singleton Langfuse v2 client
3. lf_trace()     — get/create a Langfuse trace keyed by workflow_id
4. lf_span()      — create a child span on a trace
5. lf_end_span()  — close a span with output / level
6. lf_flush()     — flush pending Langfuse events (call at end of activity)
7. lf_metadata()  — extra_body dict for openai/litellm calls to link LLM generations
8. workflow_ctx() — extract (workflow_id, run_id) from Temporal activity context

Design principles
─────────────────
• Every function is non-fatal: exceptions are logged as warnings, never re-raised.
• The DB write pool is created lazily on first call (no startup cost).
• Langfuse is disabled gracefully when LANGFUSE_PUBLIC_KEY is absent.
• workflow_id is the single correlation key that links Temporal ↔ Langfuse ↔ DB.
• Langfuse SDK v2.x required — matches the self-hosted Langfuse v2 server.
"""

import asyncio
import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _json_safe(obj: Any) -> Any:
    """
    Recursively make an object JSON-safe.  Prevents the Langfuse SDK from
    storing Python repr strings (e.g. "{'key': 'val'}") in the DB which causes
    the Langfuse UI's tRPC query to crash on JSON parsing.
    """
    if obj is None:
        return None
    try:
        json.dumps(obj)  # fast-path: already serialisable
        return obj
    except (TypeError, ValueError):
        pass
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(i) for i in obj]
    return str(obj)


# ── Langfuse (SDK v2, compatible with self-hosted Langfuse v2 server) ──────────

_langfuse = None

# Cache of trace objects keyed by workflow_id to avoid redundant API calls
_trace_cache: dict[str, Any] = {}


def get_langfuse():
    """Lazy Langfuse v2 singleton. Returns None when keys are not configured."""
    global _langfuse
    if _langfuse is None:
        pub  = os.getenv("LANGFUSE_PUBLIC_KEY", "")
        sec  = os.getenv("LANGFUSE_SECRET_KEY", "")
        host = os.getenv("LANGFUSE_HOST", "http://langfuse:3000")
        if pub and sec:
            try:
                from langfuse import Langfuse  # noqa: PLC0415
                _langfuse = Langfuse(public_key=pub, secret_key=sec, host=host)
                logger.info("Langfuse v2 client initialised (host=%s)", host)
            except Exception as exc:
                logger.warning("Langfuse init failed (non-fatal): %s", exc)
    return _langfuse


def lf_trace(workflow_id: str, agent_id: str = "", tenant_id: str = "", name: str = "agent_run"):
    """
    Get or create a Langfuse v2 trace whose ID equals the Temporal workflow_id.
    Returns the trace object (or None if Langfuse is unavailable).
    Safe to call multiple times — re-uses cached trace.
    """
    if not workflow_id:
        return None
    if workflow_id in _trace_cache:
        return _trace_cache[workflow_id]

    lf = get_langfuse()
    if lf is None:
        return None
    try:
        trace = lf.trace(
            id=workflow_id,
            name=name,
            user_id=agent_id or None,
            metadata=_json_safe({"agent_id": agent_id, "tenant_id": tenant_id}),
        )
        _trace_cache[workflow_id] = trace
        return trace
    except Exception as exc:
        logger.warning("lf_trace(%s) failed (non-fatal): %s", workflow_id, exc)
        return None


def lf_span(workflow_id: str, name: str, input_data: Any = None, metadata: Optional[dict] = None):
    """
    Create a Langfuse v2 SPAN linked to the trace for workflow_id.
    Returns the span object so the caller can call lf_end_span() on it.
    """
    trace = lf_trace(workflow_id)
    if trace is None:
        return None
    try:
        return trace.span(
            name=name,
            input=input_data,
            metadata=metadata,
        )
    except Exception as exc:
        logger.warning("lf_span(%s/%s) failed (non-fatal): %s", workflow_id, name, exc)
        return None


def lf_generation(
    workflow_id: str,
    name: str,
    model: str = "",
    input_data: Any = None,
    output_data: Any = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    metadata: Optional[dict] = None,
):
    """
    Create and immediately close a Langfuse v2 GENERATION linked to the trace.
    Use this for LLM calls so Langfuse shows proper token counts and cost tracking.
    """
    trace = lf_trace(workflow_id)
    if trace is None:
        return None
    try:
        gen = trace.generation(
            name=name,
            model=model or None,
            input=_json_safe(input_data),
            output=_json_safe(output_data),
            usage={
                "input":  tokens_in,
                "output": tokens_out,
                "total":  tokens_in + tokens_out,
                "unit":   "TOKENS",
            } if (tokens_in or tokens_out) else None,
            metadata=_json_safe(metadata) if metadata else None,
        )
        gen.end()
        return gen
    except Exception as exc:
        logger.warning("lf_generation(%s/%s) failed (non-fatal): %s", workflow_id, name, exc)
        return None


def lf_end_span(span, output: Any = None, level: str = "DEFAULT"):
    """End a span returned by lf_span()."""
    if span is None:
        return
    try:
        span.end(output=output)
    except Exception as exc:
        logger.warning("lf_end_span failed (non-fatal): %s", exc)


def lf_flush():
    """Flush all buffered Langfuse events. Call once at the end of an activity."""
    lf = get_langfuse()
    if lf is None:
        return
    try:
        lf.flush()
    except Exception as exc:
        logger.warning("lf_flush failed (non-fatal): %s", exc)


def lf_trace_url(workflow_id: str) -> str:
    """Return the Langfuse UI URL for the trace with the given workflow_id."""
    host = os.getenv("LANGFUSE_PUBLIC_HOST", os.getenv("LANGFUSE_HOST", "http://localhost:3002"))
    # Normalise: strip trailing slash, strip internal Docker hostname
    host = host.rstrip("/")
    if "langfuse:" in host:
        # Internal Docker URL — swap for the public-facing one
        host = os.getenv("LANGFUSE_PUBLIC_HOST", "http://localhost:3002").rstrip("/")
    return f"{host}/project/default-project/traces/{workflow_id}"


def lf_metadata(workflow_id: str, agent_id: str = "", step_name: str = "llm_call") -> dict:
    """
    Build the extra_body.metadata dict to pass to litellm / openai.chat.completions.create().

    When LiteLLM's Langfuse callback is enabled, it forwards this metadata to
    Langfuse and links the LLM generation to the correct parent trace.

    Usage:
        response = await openai_client.chat.completions.create(
            model=model, messages=messages,
            extra_body=lf_metadata(workflow_id, agent_id, "reasoning_step"),
        )
    """
    if not os.getenv("LANGFUSE_PUBLIC_KEY"):
        return {}
    return {
        "metadata": {
            "trace_id":        workflow_id,
            "trace_name":      f"agent-{agent_id}" if agent_id else "agent_run",
            "generation_name": step_name,
        }
    }


# ── Temporal activity context ──────────────────────────────────────────────────

def workflow_ctx() -> tuple[str, str]:
    """
    Return (workflow_id, run_id) from the active Temporal activity context.
    Returns ("", "") when called outside a Temporal activity (e.g. tests).
    """
    try:
        from temporalio import activity  # noqa: PLC0415
        info = activity.info()
        return info.workflow_id, info.workflow_run_id
    except Exception:
        return "", ""


# ── DB event emission ──────────────────────────────────────────────────────────

_pg_pool = None


async def _get_pg():
    """Lazy asyncpg connection pool. Returns None on failure."""
    global _pg_pool
    if _pg_pool is None:
        try:
            import asyncpg  # noqa: PLC0415
            url = os.getenv(
                "POSTGRES_URL",
                "postgresql://postgres:postgres@postgres:5432/agentplatform",
            )
            # Strip libpq options not supported by asyncpg's URL parser
            url = url.split("?")[0]
            _pg_pool = await asyncpg.create_pool(url, min_size=1, max_size=5)
            logger.info("asyncpg observability pool created")
        except Exception as exc:
            logger.warning("Observability DB pool creation failed (non-fatal): %s", exc)
    return _pg_pool


async def emit(
    *,
    event_type: str,
    level: str,        # info | warn | error | success
    source: str,       # agent | tool | skill | guardrail | hook | llm | system
    source_id: str,
    message: str,
    workflow_id: str = "",
    run_id: str = "",
    tenant_id: str = "default-tenant",
    agent_id: str = "",
    duration_ms: Optional[int] = None,
    details: Optional[dict] = None,
) -> None:
    """
    Write a structured event to agent_run_events.

    Always non-fatal — a DB failure is logged as a warning and silently swallowed
    so that observability never breaks the agent execution path.
    """
    try:
        pool = await _get_pg()
        if pool is None:
            return
        details_json = json.dumps(details) if details else None
        await pool.execute(
            """
            INSERT INTO agent_run_events
                (workflow_id, run_id, tenant_id, agent_id,
                 event_type, level, source, source_id,
                 message, duration_ms, details)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
            """,
            workflow_id,
            run_id,
            tenant_id,
            agent_id,
            event_type,
            level,
            source,
            source_id,
            message,
            duration_ms,
            details_json,
        )
    except Exception as exc:
        logger.warning("emit() DB write failed (non-fatal): %s", exc)
