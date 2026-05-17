-- Add applies_to field to platform_guardrails
-- Determines at which phase of execution the guardrail is enforced:
--   input  → checked against user prompt / tool call arguments before execution
--   output → checked against LLM / tool results after execution
--   both   → checked at both phases

ALTER TABLE platform_guardrails
  ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'output'
    CHECK (applies_to IN ('input', 'output', 'both'));

-- Update seeded guardrails with correct applies_to values
UPDATE platform_guardrails SET applies_to = 'input'  WHERE id = 'gr-prompt-injection'; -- detect injection in user input
UPDATE platform_guardrails SET applies_to = 'output' WHERE id = 'gr-pii-block';        -- redact PII from outputs
UPDATE platform_guardrails SET applies_to = 'output' WHERE id = 'gr-toxic-content';    -- block toxic outputs
UPDATE platform_guardrails SET applies_to = 'output' WHERE id = 'gr-secret-leak';      -- redact secrets from outputs
UPDATE platform_guardrails SET applies_to = 'output' WHERE id = 'gr-off-topic';        -- flag off-topic responses
UPDATE platform_guardrails SET applies_to = 'output' WHERE id = 'gr-length-limit';     -- flag oversized outputs
UPDATE platform_guardrails SET applies_to = 'output' WHERE id = 'gr-hallucination';    -- flag hallucinations
