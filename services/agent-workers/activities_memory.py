import os
import json
import logging
import psycopg2
from pgvector.psycopg2 import register_vector
from temporalio import activity
from openai import AsyncOpenAI

# DB Configuration
DB_URL = os.getenv("POSTGRES_URL", "postgresql://postgres:postgres@localhost:5432/agentplatform")
DEFAULT_EMBEDDING_DIMENSIONS = 1536

logger = logging.getLogger(__name__)


def get_litellm_api_key() -> str:
    return os.getenv("OPENAI_API_KEY") or os.getenv("LITELLM_MASTER_KEY", "sk-litellm-dev")


def get_embedding_model() -> str:
    return os.getenv("EMBEDDING_MODEL", "local-embedding")


def get_embedding_dimensions() -> int:
    try:
        return int(os.getenv("EMBEDDING_DIMENSIONS", str(DEFAULT_EMBEDDING_DIMENSIONS)))
    except ValueError:
        return DEFAULT_EMBEDDING_DIMENSIONS


def normalize_embedding_dimensions(embedding: list[float]) -> list[float]:
    dimensions = get_embedding_dimensions()
    if len(embedding) == dimensions:
        return embedding
    if len(embedding) > dimensions:
        return embedding[:dimensions]
    return embedding + [0.0] * (dimensions - len(embedding))


def get_db_connection():
    conn = psycopg2.connect(DB_URL)
    register_vector(conn)
    return conn


def _llm_client() -> AsyncOpenAI:
    gateway_url = os.getenv("LLM_GATEWAY_URL", "http://localhost:4000/v1")
    return AsyncOpenAI(base_url=gateway_url, api_key=get_litellm_api_key(), max_retries=0)


# ── Existing activities (unchanged) ──────────────────────────────────────────

@activity.defn
async def recall_memories(query: str, agent_id: str, limit: int = 3) -> list[str]:
    """Retrieves semantically relevant memories from the vector store."""
    logger.info(f"Recalling memories for agent {agent_id}: {query}")

    client = _llm_client()

    try:
        resp = await client.embeddings.create(
            input=[query],
            model=get_embedding_model()
        )
        query_embedding = normalize_embedding_dimensions(resp.data[0].embedding)

        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT content FROM agent_memories
                    WHERE agent_id = %s
                    ORDER BY embedding <=> %s
                    LIMIT %s
                    """,
                    (agent_id, query_embedding, limit)
                )
                results = cur.fetchall()
                return [row[0] for row in results]
    except Exception as e:
        logger.error(f"Failed to recall memories: {e}")
        return []


@activity.defn
async def store_memory(content: str, agent_id: str, metadata: dict = None) -> bool:
    """Stores a new fact or observation as a vector memory."""
    return await _store_typed_memory(content, agent_id, "observation", metadata)


# ── New: typed memory helper (internal) ──────────────────────────────────────

async def _store_typed_memory(
    content: str,
    agent_id: str,
    memory_type: str,
    metadata: dict = None,
) -> bool:
    """
    Internal helper — stores a memory with an explicit memory_type.
    memory_type must be one of: observation | learned_strategy | failure_pattern | tool_preference
    """
    logger.info(f"Storing {memory_type} memory for agent {agent_id}: {content[:60]}...")

    client = _llm_client()

    try:
        resp = await client.embeddings.create(
            input=[content],
            model=get_embedding_model()
        )
        embedding = normalize_embedding_dimensions(resp.data[0].embedding)

        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO agent_memories
                        (agent_id, content, embedding, metadata, memory_type)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (agent_id, content, embedding, json.dumps(metadata or {}), memory_type)
                )
            conn.commit()
        return True
    except Exception as e:
        logger.error(f"Failed to store {memory_type} memory: {e}")
        return False


# ── New: reflect_on_run ───────────────────────────────────────────────────────

_REFLECTION_SYSTEM = """You are a self-improvement module for an AI agent.

After each completed run you analyze what happened and extract concrete learnings.
Output ONLY valid JSON — no prose outside the JSON object.

Return this exact shape:
{
  "learned_strategies": [
    "A reusable insight about HOW to solve this class of problem (max 3, each under 120 chars)"
  ],
  "failure_patterns": [
    "What went wrong and why — only include if a task failed or was retried (max 2)"
  ],
  "tool_preferences": [
    "Which tool/skill worked well for what, formatted as 'use <tool> when <condition>' (max 2)"
  ],
  "propose_manifest_update": true | false,
  "proposal_reason": "One sentence: why a manifest update would help. Empty string if false above."
}

Rules:
- learned_strategies: generalise beyond this specific prompt. If nothing useful, return [].
- failure_patterns: only include real failures. If everything succeeded, return [].
- tool_preferences: only include if you observed a clear tool fit. Otherwise [].
- propose_manifest_update: true only if you have HIGH confidence a system_prompt or
  max_iterations change would meaningfully improve future performance.
- Keep every string under 150 characters."""


@activity.defn
async def reflect_on_run(
    agent_id: str,
    tenant_id: str,
    prompt: str,
    plan: dict,
    task_results: dict,
    task_statuses: dict,
    final_answer: str,
    model: str,
) -> bool:
    """
    Post-run reflection: extract typed learnings and store them as vector memories.

    Called fire-and-forget after every successful run. Non-fatal — a reflection
    failure never affects the user-visible result.

    Stores:
      - learned_strategies → memory_type='learned_strategy'
      - failure_patterns   → memory_type='failure_pattern'
      - tool_preferences   → memory_type='tool_preference'

    If the LLM recommends a manifest update, queues a proposal via
    propose_manifest_update (separate activity in the workflow).
    """
    logger.info(f"[REFLECT] Starting post-run reflection for agent {agent_id}")

    # Build a concise run summary for the LLM — cap sizes to avoid large prompts
    failures = {tid: task_results.get(tid, "")[:200]
                for tid, status in task_statuses.items()
                if status != "succeeded"}
    successes = {tid: status for tid, status in task_statuses.items() if status == "succeeded"}

    tasks_summary = []
    for task in (plan.get("tasks") or []):
        tid = task.get("task_id", "")
        tasks_summary.append({
            "task_id":    tid,
            "description": task.get("description", "")[:120],
            "resource":    task.get("resource_name", ""),
            "status":      task_statuses.get(tid, "unknown"),
            "result_preview": str(task_results.get(tid, ""))[:150],
        })

    user_msg = f"""Agent: {agent_id}
Prompt: {prompt[:200]}

Tasks executed:
{json.dumps(tasks_summary, indent=2)[:1500]}

Failures: {len(failures)}, Successes: {len(successes)}
Final answer length: {len(final_answer)} chars

Extract learnings from this run."""

    client = _llm_client()
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _REFLECTION_SYSTEM},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0,
            max_tokens=600,
        )
        raw = resp.choices[0].message.content or "{}"
        # Strip markdown fences
        import re
        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw)
        reflection = json.loads(raw)
    except Exception as e:
        logger.warning(f"[REFLECT] LLM reflection failed (non-fatal): {e}")
        return False

    # Store each learning type
    stored = 0
    for strategy in reflection.get("learned_strategies") or []:
        if strategy and len(strategy) > 10:
            ok = await _store_typed_memory(
                f"[strategy] {strategy}",
                agent_id,
                "learned_strategy",
                {"source_prompt": prompt[:100], "model": model},
            )
            if ok:
                stored += 1

    for pattern in reflection.get("failure_patterns") or []:
        if pattern and len(pattern) > 10:
            ok = await _store_typed_memory(
                f"[failure] {pattern}",
                agent_id,
                "failure_pattern",
                {"source_prompt": prompt[:100], "model": model},
            )
            if ok:
                stored += 1

    for pref in reflection.get("tool_preferences") or []:
        if pref and len(pref) > 10:
            ok = await _store_typed_memory(
                f"[tool_pref] {pref}",
                agent_id,
                "tool_preference",
                {"source_prompt": prompt[:100], "model": model},
            )
            if ok:
                stored += 1

    logger.info(f"[REFLECT] Stored {stored} learnings for agent {agent_id}")

    # Signal whether a manifest proposal should be triggered
    return bool(reflection.get("propose_manifest_update"))


# ── New: propose_manifest_update ─────────────────────────────────────────────

_PROPOSAL_SYSTEM = """You are a manifest optimization advisor for an AI agent.

You are given the agent's current configuration and its recent typed memories
(learned strategies, failure patterns, tool preferences).

Your job: propose ONE concrete manifest improvement that would have the highest impact.
Output ONLY valid JSON — no prose outside the JSON object.

Return this exact shape:
{
  "field": "system_prompt | max_iterations | skills | general",
  "proposed_value": "The exact new value (for system_prompt: full text; for max_iterations: integer as string; for skills: JSON array as string; for general: description)",
  "rationale": "Under 200 chars: why this change improves future performance based on the evidence"
}

Rules:
- field must be exactly one of the four values above.
- proposed_value for system_prompt: write the full new system prompt, not a diff.
- proposed_value for max_iterations: a number between 5 and 50.
- If the current performance is already good and no clear improvement is warranted,
  return {"field": "general", "proposed_value": "no_change", "rationale": "Agent is performing well"}
- Base recommendations ONLY on the provided memories — do not hallucinate issues."""


@activity.defn
async def propose_manifest_update(
    agent_id: str,
    tenant_id: str,
    model: str,
) -> bool:
    """
    Analyzes recent typed memories and creates an improvement proposal in the DB.

    Only called when reflect_on_run returns True (high-confidence improvement needed).
    Writes a row to agent_improvement_proposals; the agent owner sees it in the UI.
    """
    logger.info(f"[PROPOSE] Generating manifest proposal for agent {agent_id}")

    # 1. Fetch agent's current manifest from agent-registry
    import httpx
    registry_url = os.getenv("AGENT_REGISTRY_URL", "http://agent-registry:8088")
    current_manifest = {}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{registry_url}/api/v1/agents/{agent_id}",
                headers={"X-Tenant-ID": tenant_id},
                timeout=10.0,
            )
            if resp.status_code == 200:
                current_manifest = resp.json()
    except Exception as e:
        logger.warning(f"[PROPOSE] Could not fetch manifest (non-fatal): {e}")

    # 2. Fetch recent typed memories (last 20 — mix of all types)
    recent_memories: list[str] = []
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT memory_type, content FROM agent_memories
                    WHERE agent_id = %s
                      AND memory_type IN ('learned_strategy','failure_pattern','tool_preference')
                    ORDER BY created_at DESC
                    LIMIT 20
                    """,
                    (agent_id,)
                )
                rows = cur.fetchall()
                recent_memories = [f"[{row[0]}] {row[1]}" for row in rows]
    except Exception as e:
        logger.warning(f"[PROPOSE] Could not fetch memories (non-fatal): {e}")
        return False

    if not recent_memories:
        logger.info(f"[PROPOSE] No typed memories yet for agent {agent_id} — skipping proposal")
        return False

    # 3. Ask LLM for the best proposal
    user_msg = f"""Agent ID: {agent_id}

Current manifest:
- system_prompt: {str(current_manifest.get('system_prompt',''))[:400]}
- max_iterations: {current_manifest.get('max_iterations', 'unknown')}
- skills: {json.dumps(current_manifest.get('skills', []))[:200]}

Recent memories ({len(recent_memories)} entries):
{chr(10).join(recent_memories[:15])}

Propose the single most impactful manifest improvement."""

    client = _llm_client()
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _PROPOSAL_SYSTEM},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0,
            max_tokens=800,
        )
        raw = resp.choices[0].message.content or "{}"
        import re
        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw)
        proposal = json.loads(raw)
    except Exception as e:
        logger.warning(f"[PROPOSE] LLM proposal generation failed: {e}")
        return False

    # Skip no-change proposals
    if proposal.get("proposed_value") == "no_change":
        logger.info(f"[PROPOSE] LLM says no change needed for agent {agent_id}")
        return False

    # 4. Write proposal to DB
    field         = proposal.get("field", "general")
    proposed_val  = str(proposal.get("proposed_value", ""))
    rationale     = str(proposal.get("rationale", ""))[:300]
    current_val   = ""
    if field == "system_prompt":
        current_val = str(current_manifest.get("system_prompt", ""))[:500]
    elif field == "max_iterations":
        current_val = str(current_manifest.get("max_iterations", ""))
    elif field == "skills":
        current_val = json.dumps(current_manifest.get("skills", []))[:300]

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO agent_improvement_proposals
                        (tenant_id, agent_id, field, current_value, proposed_value, rationale)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (tenant_id, agent_id, field, current_val, proposed_val, rationale)
                )
            conn.commit()
        logger.info(f"[PROPOSE] Created improvement proposal for agent {agent_id}: field={field}")
        return True
    except Exception as e:
        logger.error(f"[PROPOSE] Failed to write proposal to DB: {e}")
        return False
