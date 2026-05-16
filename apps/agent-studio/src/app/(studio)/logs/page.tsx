"use client";

import { useState, useMemo } from "react";
import {
  ScrollText, Search, Filter, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, Info, Clock, Zap, Bot,
  Wrench, UserCheck, Activity, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// ── Types ─────────────────────────────────────────────────────────────────────

type LogLevel = "info" | "warn" | "error" | "success";
type LogSource = "agent" | "skill" | "tool" | "hook" | "guardrail" | "system";

interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  source_id: string;
  message: string;
  tenant_id: string;
  agent_id?: string;
  skill_id?: string;
  tool_name?: string;
  duration_ms?: number;
  details?: Record<string, unknown>;
}

// ── Mock log generator ────────────────────────────────────────────────────────

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function offsetDate(secondsAgo: number) {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

const MOCK_LOGS: LogEntry[] = [
  {
    id: genId(), timestamp: offsetDate(5), level: "success", source: "skill",
    source_id: "query-slow-logs", message: "Skill execution completed",
    tenant_id: "default-tenant", agent_id: "agent-ops-v2", skill_id: "query-slow-logs",
    duration_ms: 423,
    details: { invocation_id: "inv-abc123", tool_calls: 2, tokens_used: 312 },
  },
  {
    id: genId(), timestamp: offsetDate(8), level: "info", source: "hook",
    source_id: "audit_log", message: "Pre-hook audit_log recorded invocation",
    tenant_id: "default-tenant", skill_id: "query-slow-logs",
    details: { phase: "pre", actor: "agent-ops-v2" },
  },
  {
    id: genId(), timestamp: offsetDate(12), level: "info", source: "tool",
    source_id: "postgres-query", message: "Tool invoked: postgres-query",
    tenant_id: "default-tenant", tool_name: "postgres-query",
    duration_ms: 187,
    details: { query_type: "SELECT", rows_returned: 42 },
  },
  {
    id: genId(), timestamp: offsetDate(30), level: "warn", source: "guardrail",
    source_id: "gr-pii-block", message: "PII detected and redacted in output",
    tenant_id: "default-tenant", agent_id: "agent-support",
    details: { pattern: "SSN", action: "redact", field: "output" },
  },
  {
    id: genId(), timestamp: offsetDate(45), level: "success", source: "agent",
    source_id: "agent-support", message: "Chat session completed",
    tenant_id: "default-tenant", agent_id: "agent-support",
    duration_ms: 2341,
    details: { turns: 3, skills_invoked: 1 },
  },
  {
    id: genId(), timestamp: offsetDate(90), level: "info", source: "hook",
    source_id: "hitl_intercept", message: "HITL approval requested",
    tenant_id: "default-tenant", skill_id: "send-notification", agent_id: "agent-ops-v2",
    details: { approval_id: "appr-xyz789", reason: "Skill is mutating" },
  },
  {
    id: genId(), timestamp: offsetDate(120), level: "success", source: "hook",
    source_id: "hitl_intercept", message: "HITL approved by human reviewer",
    tenant_id: "default-tenant", skill_id: "send-notification",
    duration_ms: 28400,
    details: { approval_id: "appr-xyz789", reviewer: "harshit@example.com" },
  },
  {
    id: genId(), timestamp: offsetDate(180), level: "error", source: "tool",
    source_id: "slack-post", message: "Tool execution failed: connection timeout",
    tenant_id: "default-tenant", tool_name: "slack-post",
    duration_ms: 5000,
    details: { error: "ETIMEDOUT", retries: 3 },
  },
  {
    id: genId(), timestamp: offsetDate(240), level: "success", source: "skill",
    source_id: "summarize-tickets", message: "Skill execution completed",
    tenant_id: "default-tenant", agent_id: "agent-support", skill_id: "summarize-tickets",
    duration_ms: 891,
    details: { invocation_id: "inv-def456", tokens_used: 1204, model: "claude-sonnet-4-6" },
  },
  {
    id: genId(), timestamp: offsetDate(300), level: "warn", source: "system",
    source_id: "skill-dispatcher", message: "Rate limit approaching for skill: postgres-query",
    tenant_id: "default-tenant",
    details: { current_rpm: 48, limit_rpm: 60, percentage: 80 },
  },
  {
    id: genId(), timestamp: offsetDate(360), level: "info", source: "agent",
    source_id: "agent-ops-v2", message: "Agent started — temporal workflow initiated",
    tenant_id: "default-tenant", agent_id: "agent-ops-v2",
    details: { workflow_id: "wf-ghi012", model: "ollama/qwen2.5:14b" },
  },
  {
    id: genId(), timestamp: offsetDate(420), level: "error", source: "guardrail",
    source_id: "gr-prompt-injection", message: "Prompt injection attempt blocked",
    tenant_id: "default-tenant", agent_id: "agent-support",
    details: { pattern: "ignore previous instructions", action: "block" },
  },
];

// ── Constants ─────────────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<LogLevel, { icon: typeof CheckCircle2; color: string; bg: string }> = {
  success: { icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/10" },
  info:    { icon: Info,         color: "text-blue-400",  bg: "bg-blue-500/10"  },
  warn:    { icon: AlertTriangle,color: "text-amber-400", bg: "bg-amber-500/10" },
  error:   { icon: XCircle,      color: "text-red-400",   bg: "bg-red-500/10"   },
};

const SOURCE_CONFIG: Record<LogSource, { icon: typeof ScrollText; label: string }> = {
  agent:     { icon: Bot,         label: "Agent"     },
  skill:     { icon: Zap,         label: "Skill"     },
  tool:      { icon: Wrench,      label: "Tool"      },
  hook:      { icon: Activity,    label: "Hook"      },
  guardrail: { icon: CheckCircle2, label: "Guardrail" },
  system:    { icon: ScrollText,  label: "System"    },
};

const SOURCE_FILTERS: Array<LogSource | "all"> = ["all", "agent", "skill", "tool", "hook", "guardrail", "system"];
const LEVEL_FILTERS: Array<LogLevel | "all"> = ["all", "success", "info", "warn", "error"];

// ── LogRow ────────────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const level = LEVEL_CONFIG[entry.level];
  const source = SOURCE_CONFIG[entry.source];
  const LevelIcon = level.icon;
  const SourceIcon = source.icon;

  return (
    <div className={`border-b border-border/50 last:border-0 ${entry.level === "error" ? "bg-red-500/3" : ""}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-2.5 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 text-xs">
          {/* Time */}
          <span className="shrink-0 text-muted-foreground w-20 font-mono">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>

          {/* Level */}
          <span className={`shrink-0 flex items-center gap-1 w-16 font-medium ${level.color}`}>
            <LevelIcon className="h-3 w-3" />
            {entry.level}
          </span>

          {/* Source badge */}
          <span className={`shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${level.bg} ${level.color} w-20`}>
            <SourceIcon className="h-3 w-3" />
            {source.label}
          </span>

          {/* Source ID */}
          <span className="shrink-0 font-mono text-muted-foreground w-36 truncate">
            {entry.source_id}
          </span>

          {/* Message */}
          <span className="flex-1 truncate">{entry.message}</span>

          {/* Duration */}
          {entry.duration_ms !== undefined && (
            <span className="shrink-0 flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              {entry.duration_ms >= 1000
                ? `${(entry.duration_ms / 1000).toFixed(1)}s`
                : `${entry.duration_ms}ms`}
            </span>
          )}

          {/* Expand indicator */}
          <span className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 bg-muted/20">
          <div className="rounded-lg border border-border bg-card p-3 text-xs space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <p className="text-muted-foreground mb-0.5">Timestamp</p>
                <p className="font-mono">{new Date(entry.timestamp).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-0.5">Tenant</p>
                <p className="font-mono">{entry.tenant_id}</p>
              </div>
              {entry.agent_id && (
                <div>
                  <p className="text-muted-foreground mb-0.5">Agent</p>
                  <p className="font-mono truncate">{entry.agent_id}</p>
                </div>
              )}
              {entry.skill_id && (
                <div>
                  <p className="text-muted-foreground mb-0.5">Skill</p>
                  <p className="font-mono truncate">{entry.skill_id}</p>
                </div>
              )}
              {entry.tool_name && (
                <div>
                  <p className="text-muted-foreground mb-0.5">Tool</p>
                  <p className="font-mono truncate">{entry.tool_name}</p>
                </div>
              )}
            </div>
            {entry.details && (
              <div>
                <p className="text-muted-foreground mb-1">Details</p>
                <pre className="rounded bg-muted p-2 overflow-auto max-h-32 font-mono text-xs">
                  {JSON.stringify(entry.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<LogSource | "all">("all");
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (sourceFilter !== "all" && log.source !== sourceFilter) return false;
      if (levelFilter !== "all" && log.level !== levelFilter) return false;
      if (q && !log.message.toLowerCase().includes(q) &&
          !log.source_id.toLowerCase().includes(q) &&
          !log.source.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, query, sourceFilter, levelFilter]);

  const counts = {
    total: logs.length,
    error: logs.filter((l) => l.level === "error").length,
    warn: logs.filter((l) => l.level === "warn").length,
    success: logs.filter((l) => l.level === "success").length,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <ScrollText className="h-4 w-4 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-semibold">Event Logs</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Lifecycle events from agents, skills, tools, hooks, and guardrails across your tenant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setLogs([...MOCK_LOGS])}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled>
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Events", value: counts.total, color: "" },
          { label: "Errors", value: counts.error, color: "text-red-400" },
          { label: "Warnings", value: counts.warn, color: "text-amber-400" },
          { label: "Successes", value: counts.success, color: "text-green-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-semibold mt-0.5 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages, sources…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setSourceFilter(f as typeof sourceFilter)}
              className={`filter-chip ${sourceFilter === f ? "filter-chip-active" : ""}`}
            >
              {f}
            </button>
          ))}
          <span className="text-muted-foreground/40">|</span>
          {LEVEL_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setLevelFilter(f as typeof levelFilter)}
              className={`filter-chip ${levelFilter === f ? "filter-chip-active" : ""} ${
                f === "error" ? "hover:text-red-400 hover:border-red-500/50" :
                f === "warn" ? "hover:text-amber-400 hover:border-amber-500/50" : ""
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Log table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Column headers */}
        <div className="flex items-center gap-3 px-4 py-2 bg-muted/50 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="w-20">Time</span>
          <span className="w-16">Level</span>
          <span className="w-20">Source</span>
          <span className="w-36">ID</span>
          <span className="flex-1">Message</span>
          <span className="w-16 text-right">Duration</span>
          <span className="w-4" />
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <ScrollText className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm">No matching log entries.</p>
          </div>
        ) : (
          <div>
            {filtered.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Showing {filtered.length} of {logs.length} events · Live streaming coming soon
      </p>
    </div>
  );
}
