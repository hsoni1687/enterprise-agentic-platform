"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ScrollText, Search, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, Info, Clock, Zap, Bot,
  Wrench, UserCheck, Activity, ExternalLink, Cpu, Database,
  Loader2, ChevronLeft, Calendar, Filter, BrainCircuit, Copy, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  logsApi, runsApi, LANGFUSE_URL,
  type RunEvent, type AgentRun, type LogLevel, type LogSource,
} from "@/lib/api";

// ── Time-range presets ────────────────────────────────────────────────────────

type PresetKey = "15m" | "1h" | "3h" | "6h" | "12h" | "24h" | "3d" | "7d" | "30d" | "custom";

interface TimeRange {
  preset: PresetKey;
  from: Date;
  to:   Date;
}

const PRESETS: { key: PresetKey; label: string; minutes: number }[] = [
  { key: "15m",  label: "Last 15 min",  minutes: 15       },
  { key: "1h",   label: "Last 1 hour",  minutes: 60       },
  { key: "3h",   label: "Last 3 hours", minutes: 180      },
  { key: "6h",   label: "Last 6 hours", minutes: 360      },
  { key: "12h",  label: "Last 12 h",    minutes: 720      },
  { key: "24h",  label: "Last 24 h",    minutes: 1440     },
  { key: "3d",   label: "Last 3 days",  minutes: 4320     },
  { key: "7d",   label: "Last 7 days",  minutes: 10080    },
  { key: "30d",  label: "Last 30 days", minutes: 43200    },
];

function makePreset(key: PresetKey, minutes: number): TimeRange {
  const to   = new Date();
  const from = new Date(to.getTime() - minutes * 60_000);
  return { preset: key, from, to };
}

const DEFAULT_RANGE = makePreset("24h", 1440);

// ── Level / Source config ─────────────────────────────────────────────────────

const LEVEL_CFG: Record<LogLevel, { icon: typeof Info; color: string; bg: string }> = {
  success: { icon: CheckCircle2,  color: "text-emerald-400", bg: "bg-emerald-500/10" },
  info:    { icon: Info,          color: "text-blue-400",    bg: "bg-blue-500/10"    },
  warn:    { icon: AlertTriangle, color: "text-amber-400",   bg: "bg-amber-500/10"   },
  error:   { icon: XCircle,       color: "text-red-400",     bg: "bg-red-500/10"     },
};

const SRC_CFG: Record<LogSource, { icon: typeof ScrollText; label: string }> = {
  agent:     { icon: Bot,       label: "Agent"     },
  skill:     { icon: Zap,       label: "Skill"     },
  tool:      { icon: Wrench,    label: "Tool"      },
  hook:      { icon: Activity,  label: "Hook"      },
  guardrail: { icon: UserCheck, label: "Guardrail" },
  llm:       { icon: Cpu,       label: "LLM"       },
  system:    { icon: Database,  label: "System"    },
};

// ── Tiny helpers ──────────────────────────────────────────────────────────────

const fmt = {
  time: (iso: string) => new Date(iso).toLocaleTimeString(),
  datetime: (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString()
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString();
  },
  duration: (ms: number) => {
    if (!ms || ms < 0) return "—";
    if (ms >= 60_000)  return `${(ms / 60_000).toFixed(1)}m`;
    if (ms >= 1_000)   return `${(ms / 1_000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  },
  isoLocal: (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },
};

// ── Time range picker ─────────────────────────────────────────────────────────

function TimeRangePicker({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (r: TimeRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(fmt.isoLocal(value.from));
  const [customTo,   setCustomTo]   = useState(fmt.isoLocal(value.to));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const applyCustom = () => {
    const from = new Date(customFrom);
    const to   = new Date(customTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) return;
    onChange({ preset: "custom", from, to });
    setOpen(false);
  };

  const label = value.preset === "custom"
    ? `${fmt.datetime(value.from.toISOString())} → ${fmt.datetime(value.to.toISOString())}`
    : PRESETS.find((p) => p.key === value.preset)?.label ?? "Custom";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs border border-border rounded-md px-3 py-1.5 bg-card hover:bg-muted/50 transition-colors"
      >
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{label}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="p-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => { onChange(makePreset(p.key, p.minutes)); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors hover:bg-muted/50
                  ${value.preset === p.key ? "bg-blue-500/10 text-blue-400 font-semibold" : "text-foreground"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="border-t border-border p-3 space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Custom range</p>
            <div className="space-y-1.5">
              <div>
                <label className="text-[10px] text-muted-foreground">From</label>
                <input type="datetime-local" value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full mt-0.5 text-xs bg-muted border border-border rounded px-2 py-1 text-foreground" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">To</label>
                <input type="datetime-local" value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full mt-0.5 text-xs bg-muted border border-border rounded px-2 py-1 text-foreground" />
              </div>
              <Button size="sm" className="w-full h-7 text-xs" onClick={applyCustom}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agent LOV dropdown ────────────────────────────────────────────────────────

function AgentSelect({
  agents,
  value,
  onChange,
}: {
  agents: string[];
  value:  string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-xs border rounded-md px-3 py-1.5 transition-colors min-w-[160px]
          ${value
            ? "border-blue-500/50 bg-blue-500/10 text-blue-400 font-semibold"
            : "border-border bg-card text-foreground hover:bg-muted/50"}`}
      >
        <Bot className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left truncate">{value ?? "All Agents"}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="p-1">
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors hover:bg-muted/50
                ${!value ? "bg-blue-500/10 text-blue-400 font-semibold" : "text-muted-foreground"}`}
            >
              All Agents
            </button>
            {agents.map((a) => (
              <button key={a}
                onClick={() => { onChange(a); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors hover:bg-muted/50 flex items-center gap-2
                  ${value === a ? "bg-blue-500/10 text-blue-400 font-semibold" : "text-foreground"}`}
              >
                <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{a}</span>
              </button>
            ))}
            {agents.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">No agents yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({ run, selected, onClick }: { run: AgentRun; selected: boolean; onClick: () => void }) {
  const statusCls =
    run.status === "success" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" :
    run.status === "error"   ? "text-red-400 border-red-500/30 bg-red-500/5" :
                               "text-amber-400 border-amber-500/30 bg-amber-500/5";
  const Icon = run.status === "success" ? CheckCircle2 : run.status === "error" ? XCircle : Loader2;

  // Human-readable session ID: last ~12 chars of workflow_id
  const sessionLabel = run.workflow_id.slice(-12);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-border/40 transition-all
        hover:bg-muted/40 group
        ${selected ? "bg-muted/60 border-l-[3px] border-l-blue-500 pl-[13px]" : "border-l-[3px] border-l-transparent"}`}
    >
      {/* Top row: time + status */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-muted-foreground font-mono">
          {fmt.datetime(run.started_at)}
        </span>
        <span className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${statusCls}`}>
          <Icon className={`h-2.5 w-2.5 ${run.status === "running" ? "animate-spin" : ""}`} />
          {run.status}
        </span>
      </div>

      {/* Session ID */}
      <p className="text-xs font-mono text-muted-foreground truncate mb-2">
        …{sessionLabel}
      </p>

      {/* Metrics row */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-0.5">
          <Clock className="h-2.5 w-2.5" />
          {fmt.duration(run.duration_ms)}
        </span>
        <span className="flex items-center gap-0.5">
          <Cpu className="h-2.5 w-2.5" />
          {run.llm_calls} LLM
        </span>
        {run.tool_calls > 0 && (
          <span className="flex items-center gap-0.5">
            <Wrench className="h-2.5 w-2.5" />
            {run.tool_calls} tools
          </span>
        )}
        <span className="flex items-center gap-0.5">
          <Activity className="h-2.5 w-2.5" />
          {run.event_count} ev
        </span>
      </div>
    </button>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── LLM Call card — dedicated display for llm_call events ────────────────────

function LLMCallCard({ e }: { e: RunEvent }) {
  const [expanded, setExpanded] = useState(false);
  const d = (e.details ?? {}) as Record<string, any>;
  const model     = d.model ?? e.source_id ?? "unknown";
  const tokensIn  = d.tokens_in  ?? 0;
  const tokensOut = d.tokens_out ?? 0;
  const input  = d.input  ? String(d.input)  : null;
  const output = d.output ? String(d.output) : null;
  const traceUrl = e.workflow_id
    ? `${LANGFUSE_URL}/project/default-project/traces/${e.workflow_id}`
    : null;

  return (
    <div className="border-b border-border/30 last:border-0">
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-2.5 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs">
          <BrainCircuit className="h-3.5 w-3.5 text-violet-400 shrink-0" />
          <span className="font-semibold text-violet-300 shrink-0 truncate max-w-[160px]">
            {model.startsWith("ollama/") ? model.slice(7) : model}
          </span>
          <span className="text-muted-foreground/50 text-[10px] shrink-0">{fmt.time(e.timestamp)}</span>
          <span className="flex-1" />
          {(tokensIn > 0 || tokensOut > 0) && (
            <span className="text-[10px] font-mono text-muted-foreground shrink-0 flex items-center gap-1.5">
              <span title="Input tokens" className="text-blue-400/80">↑{tokensIn.toLocaleString()}</span>
              <span title="Output tokens" className="text-emerald-400/80">↓{tokensOut.toLocaleString()}</span>
              <span className="text-muted-foreground/40">= {(tokensIn+tokensOut).toLocaleString()}</span>
            </span>
          )}
          {e.duration_ms !== undefined && (
            <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5 shrink-0">
              <Clock className="h-2.5 w-2.5" />{fmt.duration(e.duration_ms)}
            </span>
          )}
          {traceUrl && (
            <a href={traceUrl} target="_blank" rel="noopener noreferrer"
              onClick={(ev) => ev.stopPropagation()}
              title="Open in Langfuse"
              className="shrink-0 text-muted-foreground/50 hover:text-blue-400 transition-colors">
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <span className="shrink-0 text-muted-foreground/50">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        </div>

        {/* Collapsed preview — show first line of input/output */}
        {!expanded && (input || output) && (
          <div className="mt-1.5 grid grid-cols-2 gap-2 pl-5">
            {input && (
              <div className="rounded border border-blue-500/15 bg-blue-500/5 px-2 py-1">
                <p className="text-[9px] text-blue-400/70 mb-0.5 uppercase tracking-wider">Input</p>
                <p className="text-[10px] text-muted-foreground/80 truncate font-mono">{input.slice(0, 120)}</p>
              </div>
            )}
            {output && (
              <div className="rounded border border-emerald-500/15 bg-emerald-500/5 px-2 py-1">
                <p className="text-[9px] text-emerald-400/70 mb-0.5 uppercase tracking-wider">Output</p>
                <p className="text-[10px] text-muted-foreground/80 truncate font-mono">{output.slice(0, 120)}</p>
              </div>
            )}
          </div>
        )}
      </button>

      {/* Expanded — full input/output */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {input && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-1">
                  ↑ Prompt / Input
                </p>
                <CopyButton text={input} />
              </div>
              <pre className="rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-3 overflow-auto max-h-64 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-foreground/80">
                {input}
              </pre>
            </div>
          )}
          {output && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                  ↓ LLM Response / Output
                </p>
                <CopyButton text={output} />
              </div>
              <pre className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3 overflow-auto max-h-64 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-foreground/80">
                {output}
              </pre>
            </div>
          )}
          {/* Metadata strip */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground/50 font-mono pt-1 border-t border-border/20">
            <span>model: <span className="text-foreground/60">{model}</span></span>
            {tokensIn > 0 && <span>prompt tokens: <span className="text-blue-400/70">{tokensIn.toLocaleString()}</span></span>}
            {tokensOut > 0 && <span>completion tokens: <span className="text-emerald-400/70">{tokensOut.toLocaleString()}</span></span>}
            {e.duration_ms !== undefined && <span>latency: <span className="text-foreground/60">{fmt.duration(e.duration_ms)}</span></span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({ e }: { e: RunEvent }) {
  const [open, setOpen] = useState(false);
  const lv  = LEVEL_CFG[e.level]  ?? LEVEL_CFG.info;
  const src = SRC_CFG[e.source]   ?? SRC_CFG.system;
  const LvIcon  = lv.icon;
  const SrcIcon = src.icon;
  const traceUrl = e.workflow_id ? `${LANGFUSE_URL}/project/default-project/traces/${e.workflow_id}` : null;

  return (
    <div className={`border-b border-border/30 last:border-0 ${e.level === "error" ? "bg-red-500/[0.03]" : ""}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-2 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2.5 text-xs">
          <span className="shrink-0 text-muted-foreground w-16 font-mono text-[10px]">
            {fmt.time(e.timestamp)}
          </span>

          <span className={`shrink-0 flex items-center gap-1 w-[72px] font-semibold text-[10px] ${lv.color}`}>
            <LvIcon className="h-3 w-3" />
            {e.level}
          </span>

          <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[10px] ${lv.bg} ${lv.color} w-24`}>
            <SrcIcon className="h-2.5 w-2.5" />
            {src.label}
          </span>

          <span className="shrink-0 font-mono text-muted-foreground w-36 truncate text-[10px]">
            {e.source_id}
          </span>

          <span className="flex-1 truncate text-xs">{e.message}</span>

          {e.duration_ms !== undefined && (
            <span className="shrink-0 text-muted-foreground text-[10px] flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {fmt.duration(e.duration_ms)}
            </span>
          )}

          {traceUrl && (
            <a href={traceUrl} target="_blank" rel="noopener noreferrer"
              onClick={(ev) => ev.stopPropagation()}
              title="Open in Langfuse"
              className="shrink-0 text-muted-foreground hover:text-blue-400 transition-colors">
              <ExternalLink className="h-3 w-3" />
            </a>
          )}

          <span className="shrink-0 text-muted-foreground">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-3 bg-muted/10">
          <div className="rounded-lg border border-border bg-card/80 p-3 text-xs space-y-2.5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wider">Timestamp</p>
                <p className="font-mono text-[10px]">{new Date(e.timestamp).toLocaleString()}</p>
              </div>
              {e.agent_id && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wider">Agent</p>
                  <p className="font-mono text-[10px] truncate">{e.agent_id}</p>
                </div>
              )}
              <div className="col-span-2">
                <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wider">Session / Trace</p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[10px] truncate">{e.workflow_id}</p>
                  {traceUrl && (
                    <a href={traceUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 flex items-center gap-0.5 text-[10px] shrink-0">
                      <ExternalLink className="h-2.5 w-2.5" />
                      Langfuse
                    </a>
                  )}
                </div>
              </div>
            </div>
            {e.details && (
              <div className="space-y-2">
                {/* LLM input / output — shown as labelled blocks when present */}
                {(e.details as any).input && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">↑ Input (prompt)</p>
                    <pre className="rounded bg-blue-500/5 border border-blue-500/20 p-2 overflow-auto max-h-32 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                      {String((e.details as any).input)}
                    </pre>
                  </div>
                )}
                {(e.details as any).output && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">↓ Output (LLM response)</p>
                    <pre className="rounded bg-green-500/5 border border-green-500/20 p-2 overflow-auto max-h-32 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                      {String((e.details as any).output)}
                    </pre>
                  </div>
                )}
                {/* All other details as JSON */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Details</p>
                  <pre className="rounded bg-muted p-2 overflow-auto max-h-40 font-mono text-[10px] leading-relaxed">
                    {JSON.stringify(
                      Object.fromEntries(
                        Object.entries(e.details as Record<string, unknown>).filter(
                          ([k]) => k !== "input" && k !== "output"
                        )
                      ),
                      null, 2
                    )}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [agents,        setAgents]        = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [timeRange,     setTimeRange]     = useState<TimeRange>(DEFAULT_RANGE);
  const [runs,          setRuns]          = useState<AgentRun[]>([]);
  const [selectedRun,   setSelectedRun]   = useState<AgentRun | null>(null);
  const [events,        setEvents]        = useState<RunEvent[]>([]);
  const [query,         setQuery]         = useState("");
  const [eventsView,    setEventsView]    = useState<"all" | "llm">("all");
  const [loadingRuns,   setLoadingRuns]   = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [autoRefresh,   setAutoRefresh]   = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // ── Load agent list once ────────────────────────────────────────────────
  useEffect(() => {
    runsApi.agents()
      .then((r) => setAgents(r.agents ?? []))
      .catch(() => setAgents([]));
  }, []);

  // ── Load sessions ───────────────────────────────────────────────────────
  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    setError(null);
    try {
      const res = await runsApi.list({
        agent_id: selectedAgent ?? undefined,
        from:     timeRange.from.toISOString(),
        to:       timeRange.to.toISOString(),
        limit:    100,
      });
      setRuns(res.runs ?? []);
      // If previously selected run is no longer in the list, clear it
      if (selectedRun && !(res.runs ?? []).find((r) => r.workflow_id === selectedRun.workflow_id)) {
        setSelectedRun(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoadingRuns(false);
    }
  }, [selectedAgent, timeRange, selectedRun]);

  useEffect(() => { fetchRuns(); }, [selectedAgent, timeRange]); // eslint-disable-line

  // ── Load events for selected session ────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    if (!selectedRun) { setEvents([]); return; }
    setLoadingEvents(true);
    try {
      const res = await logsApi.list({
        workflow_id: selectedRun.workflow_id,
        q:           query.trim() || undefined,
        limit:       500,
      });
      setEvents(res.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, [selectedRun, query]);

  useEffect(() => { fetchEvents(); }, [selectedRun]); // eslint-disable-line

  // ── Auto-refresh ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      // Slide the time window forward unless using custom range
      if (timeRange.preset !== "custom") {
        const preset = PRESETS.find((p) => p.key === timeRange.preset)!;
        setTimeRange(makePreset(preset.key, preset.minutes));
      }
      fetchRuns();
      if (selectedRun) fetchEvents();
    }, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, timeRange, selectedRun, fetchRuns, fetchEvents]);

  // ── Derived stats ────────────────────────────────────────────────────────
  const stats = {
    total:   runs.length,
    success: runs.filter((r) => r.status === "success").length,
    error:   runs.filter((r) => r.status === "error").length,
    running: runs.filter((r) => r.status === "running").length,
    avgDur:  runs.length
      ? runs.reduce((s, r) => s + r.duration_ms, 0) / runs.length
      : 0,
    llm: runs.reduce((s, r) => s + r.llm_calls, 0),
  };

  const traceUrl = selectedRun
    ? `${LANGFUSE_URL}/project/default-project/traces/${selectedRun.workflow_id}`
    : null;

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-background">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card/60 backdrop-blur px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: title + filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
                <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <span className="font-semibold text-sm">Observability</span>
            </div>

            <div className="w-px h-5 bg-border" />

            {/* Agent LOV */}
            <AgentSelect
              agents={agents}
              value={selectedAgent}
              onChange={(v) => { setSelectedAgent(v); setSelectedRun(null); }}
            />

            {/* Time range */}
            <TimeRangePicker value={timeRange} onChange={(r) => { setTimeRange(r); setSelectedRun(null); }} />

            {selectedAgent && (
              <button
                onClick={() => { setSelectedAgent(null); setSelectedRun(null); }}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
              >
                <XCircle className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant={autoRefresh ? "default" : "outline"} className="gap-1.5 h-7 text-xs"
              onClick={() => setAutoRefresh((v) => !v)}>
              <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`} />
              {autoRefresh ? "Live" : "Auto"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
              onClick={() => { fetchRuns(); if (selectedRun) fetchEvents(); }}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <a href={LANGFUSE_URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 transition-colors hover:bg-muted/50 h-7">
              <ExternalLink className="h-3.5 w-3.5" />
              Langfuse
            </a>
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-3 flex items-center gap-6 text-xs">
          {[
            { label: "Sessions",  value: stats.total,              color: "text-foreground"  },
            { label: "Succeeded", value: stats.success,            color: "text-emerald-400" },
            { label: "Failed",    value: stats.error,              color: "text-red-400"     },
            { label: "Running",   value: stats.running,            color: "text-amber-400"   },
            { label: "LLM calls", value: stats.llm,                color: "text-blue-400"    },
            { label: "Avg dur",   value: fmt.duration(stats.avgDur), color: "text-muted-foreground" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <span className={`font-semibold text-sm ${color}`}>{value}</span>
              <span className="text-muted-foreground text-[10px]">{label}</span>
            </div>
          ))}
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-400">{error} — Is admin-api running on :8089?</p>
        )}
      </div>

      {/* ── Two-panel body ────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex">

        {/* ── Sessions panel ──────────────────────────────────────────────── */}
        <div className="w-72 shrink-0 flex flex-col border-r border-border bg-card/30">
          {/* Panel header */}
          <div className="shrink-0 px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Filter className="h-3 w-3" />
              Sessions
              {selectedAgent && <span className="text-blue-400">· {selectedAgent}</span>}
            </span>
            {selectedRun && (
              <button onClick={() => setSelectedRun(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                <ChevronLeft className="h-3 w-3" /> All
              </button>
            )}
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto">
            {loadingRuns ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4 text-muted-foreground">
                <Bot className="h-7 w-7 mb-3 opacity-30" />
                <p className="text-xs font-medium">No sessions in this period</p>
                <p className="text-[10px] mt-1">Try a wider time range or a different agent.</p>
              </div>
            ) : (
              runs.map((r) => (
                <SessionCard
                  key={r.workflow_id}
                  run={r}
                  selected={selectedRun?.workflow_id === r.workflow_id}
                  onClick={() => setSelectedRun(
                    selectedRun?.workflow_id === r.workflow_id ? null : r
                  )}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Events panel ────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Events header */}
          <div className="shrink-0 px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 bg-card/20">
            {selectedRun ? (
              <div className="flex items-center gap-2 min-w-0">
                <div className={`h-2 w-2 rounded-full shrink-0 ${
                  selectedRun.status === "success" ? "bg-emerald-400" :
                  selectedRun.status === "error"   ? "bg-red-400" :
                                                     "bg-amber-400 animate-pulse"}`} />
                <span className="text-xs font-semibold">{selectedRun.agent_id}</span>
                <span className="text-[10px] text-muted-foreground font-mono truncate hidden md:block">
                  {selectedRun.workflow_id}
                </span>
                {traceUrl && (
                  <a href={traceUrl} target="_blank" rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 flex items-center gap-0.5 text-[10px] shrink-0 ml-1">
                    <ExternalLink className="h-3 w-3" />
                    Langfuse trace
                  </a>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {runs.length > 0
                  ? "← Select a session to drill into its events"
                  : "No sessions — run an agent first"}
              </p>
            )}

            {selectedRun && (
              <div className="flex items-center gap-2 shrink-0">
                {/* View toggle: All / LLM Calls */}
                <div className="flex rounded-md border border-border overflow-hidden text-[10px]">
                  <button
                    onClick={() => setEventsView("all")}
                    className={`px-2.5 py-1 transition-colors ${eventsView === "all"
                      ? "bg-muted text-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setEventsView("llm")}
                    className={`px-2.5 py-1 flex items-center gap-1 transition-colors border-l border-border ${eventsView === "llm"
                      ? "bg-violet-500/15 text-violet-300 font-semibold"
                      : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <BrainCircuit className="h-3 w-3" />
                    LLM Calls
                  </button>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchEvents()}
                    placeholder="Filter events…"
                    className="pl-7 h-7 text-xs w-40" />
                </div>
                <span className="text-[10px] text-muted-foreground">{events.length} events</span>
              </div>
            )}
          </div>

          {/* Column headers — only when a session is selected and in All view */}
          {selectedRun && eventsView === "all" && (
            <div className="shrink-0 flex items-center gap-2.5 px-4 py-1.5 bg-muted/20 border-b border-border
              text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="w-16">Time</span>
              <span className="w-[72px]">Level</span>
              <span className="w-24">Source</span>
              <span className="w-36">ID</span>
              <span className="flex-1">Message</span>
              <span className="w-14 text-right">Duration</span>
              <span className="w-6" />
              <span className="w-4" />
            </div>
          )}

          {/* Events list */}
          <div className="flex-1 overflow-y-auto">
            {!selectedRun ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <ScrollText className="h-10 w-10 mb-3 opacity-20" />
                <p className="text-sm font-medium opacity-60">Select a session</p>
                <p className="text-xs mt-1 opacity-40">Events will appear here</p>
              </div>
            ) : loadingEvents ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading events…</span>
              </div>
            ) : events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Activity className="h-7 w-7 mb-2 opacity-30" />
                <p className="text-sm">No events found for this session</p>
              </div>
            ) : eventsView === "llm" ? (
              // ── LLM Calls view ──────────────────────────────────────────────
              (() => {
                const llmEvents = events.filter(e => e.event_type === "llm_call");
                return llmEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <BrainCircuit className="h-7 w-7 mb-2 opacity-30" />
                    <p className="text-sm">No LLM calls recorded in this session</p>
                    <p className="text-xs mt-1 opacity-60">Run an agent to capture LLM input/output</p>
                  </div>
                ) : (
                  llmEvents.map((e) => <LLMCallCard key={e.id} e={e} />)
                );
              })()
            ) : (
              events.map((e) => <EventRow key={e.id} e={e} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
