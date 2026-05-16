"use client";

import { useState } from "react";
import {
  Webhook, Plus, Shield, Zap, Clock, DollarSign, UserCheck,
  Activity, Info, ChevronRight, Eye, Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// ── Types ─────────────────────────────────────────────────────────────────────

type HookPhase = "pre" | "post";
type HookType = "audit_log" | "cost_meter" | "hitl_intercept" | "rate_limit" | "custom";
type HookCategory = "Observability" | "Safety" | "Cost Control" | "Compliance";

interface HookDefinition {
  id: string;
  type: HookType;
  phase: HookPhase | "both";
  name: string;
  description: string;
  category: HookCategory;
  admin_managed: boolean;
  builtin: boolean;
  config_schema?: Record<string, { type: string; description: string; default?: unknown }>;
  enabled: boolean;
  skill_count: number;
}

interface SkillHookBinding {
  skill_name: string;
  skill_version: string;
  hooks: Array<{ phase: HookPhase; type: HookType; config?: Record<string, unknown> }>;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const BUILTIN_HOOKS: HookDefinition[] = [
  {
    id: "hook-audit-log",
    type: "audit_log",
    phase: "both",
    name: "Audit Log",
    description: "Records every skill invocation with input/output, timing, and actor identity to the audit trail.",
    category: "Observability",
    admin_managed: true,
    builtin: true,
    enabled: true,
    skill_count: 12,
  },
  {
    id: "hook-cost-meter",
    type: "cost_meter",
    phase: "post",
    name: "Cost Meter",
    description: "Tracks token usage and estimates cost per invocation. Aggregates by skill, agent, and team.",
    category: "Cost Control",
    admin_managed: false,
    builtin: true,
    enabled: true,
    skill_count: 8,
    config_schema: {
      budget_limit_usd: { type: "number", description: "Monthly budget cap in USD", default: 100 },
      alert_threshold: { type: "number", description: "Alert at this fraction of budget (0–1)", default: 0.8 },
    },
  },
  {
    id: "hook-hitl",
    type: "hitl_intercept",
    phase: "pre",
    name: "HITL Intercept",
    description: "Pauses skill execution and routes to a human approver when the skill is marked as mutating.",
    category: "Safety",
    admin_managed: true,
    builtin: true,
    enabled: true,
    skill_count: 5,
  },
  {
    id: "hook-rate-limit",
    type: "rate_limit",
    phase: "pre",
    name: "Rate Limiter",
    description: "Enforces per-skill, per-agent, or per-tenant invocation rate limits to prevent abuse.",
    category: "Cost Control",
    admin_managed: false,
    builtin: true,
    enabled: false,
    skill_count: 3,
    config_schema: {
      max_per_minute: { type: "number", description: "Maximum invocations per minute", default: 60 },
      max_per_day: { type: "number", description: "Maximum invocations per day", default: 5000 },
    },
  },
];

const MOCK_SKILL_BINDINGS: SkillHookBinding[] = [
  {
    skill_name: "query-slow-logs",
    skill_version: "1.2.0",
    hooks: [
      { phase: "pre", type: "audit_log" },
      { phase: "pre", type: "hitl_intercept" },
      { phase: "post", type: "audit_log" },
      { phase: "post", type: "cost_meter" },
    ],
  },
  {
    skill_name: "summarize-tickets",
    skill_version: "2.0.1",
    hooks: [
      { phase: "pre", type: "audit_log" },
      { phase: "post", type: "audit_log" },
      { phase: "post", type: "cost_meter" },
    ],
  },
  {
    skill_name: "send-notification",
    skill_version: "1.0.0",
    hooks: [
      { phase: "pre", type: "rate_limit", config: { max_per_minute: 10 } },
      { phase: "pre", type: "hitl_intercept" },
      { phase: "post", type: "audit_log" },
    ],
  },
];

// ── Constants ─────────────────────────────────────────────────────────────────

const HOOK_ICONS: Record<HookType, typeof Webhook> = {
  audit_log: Activity,
  cost_meter: DollarSign,
  hitl_intercept: UserCheck,
  rate_limit: Clock,
  custom: Code2,
};

const CATEGORY_COLORS: Record<HookCategory, string> = {
  "Observability": "bg-blue-500/10 text-blue-400",
  "Safety": "bg-red-500/10 text-red-400",
  "Cost Control": "bg-amber-500/10 text-amber-400",
  "Compliance": "bg-violet-500/10 text-violet-400",
};

const PHASE_COLORS: Record<string, string> = {
  pre: "bg-teal-500/10 text-teal-400",
  post: "bg-purple-500/10 text-purple-400",
  both: "bg-blue-500/10 text-blue-400",
};

// ── HookDetailSheet ───────────────────────────────────────────────────────────

function HookDetailSheet({ hook }: { hook: HookDefinition }) {
  const Icon = HOOK_ICONS[hook.type];
  return (
    <Sheet>
      <SheetTrigger render={<Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" />}>
        <Eye className="h-3.5 w-3.5" />
        Details
      </SheetTrigger>
      <SheetContent className="w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {hook.name}
          </SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 mt-4 space-y-5 text-sm">
          <div className="flex flex-wrap gap-2">
            <span className={`status-badge ${PHASE_COLORS[hook.phase]}`}>{hook.phase}</span>
            <span className={`status-badge ${CATEGORY_COLORS[hook.category]}`}>{hook.category}</span>
            {hook.admin_managed && (
              <span className="status-badge bg-violet-500/10 text-violet-400">Admin Managed</span>
            )}
            {hook.builtin && <Badge variant="secondary" className="text-xs">Built-in</Badge>}
          </div>
          <p className="text-muted-foreground">{hook.description}</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border border-border bg-card p-2">
              Used by: <span className="font-semibold">{hook.skill_count} skills</span>
            </div>
            <div className="rounded border border-border bg-card p-2">
              Status: <span className={`font-semibold ${hook.enabled ? "text-green-400" : "text-muted-foreground"}`}>
                {hook.enabled ? "Active" : "Disabled"}
              </span>
            </div>
          </div>
          {hook.config_schema && (
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-3 tracking-wider">Configuration Parameters</p>
              <div className="space-y-2">
                {Object.entries(hook.config_schema).map(([key, schema]) => (
                  <div key={key} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-medium">{key}</span>
                      <span className="text-xs text-muted-foreground">{schema.type}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{schema.description}</p>
                    {schema.default !== undefined && (
                      <p className="text-xs text-muted-foreground mt-0.5">Default: <span className="font-mono">{String(schema.default)}</span></p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-3 tracking-wider">Execution Flow</p>
            <div className="flex items-center gap-2 text-xs">
              {(hook.phase === "pre" || hook.phase === "both") && (
                <>
                  <span className="rounded bg-muted px-2 py-1">Request</span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <span className="rounded bg-teal-500/10 text-teal-400 px-2 py-1 border border-teal-500/20">{hook.name} (pre)</span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                </>
              )}
              <span className="rounded bg-muted px-2 py-1">Skill</span>
              {(hook.phase === "post" || hook.phase === "both") && (
                <>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <span className="rounded bg-purple-500/10 text-purple-400 px-2 py-1 border border-purple-500/20">{hook.name} (post)</span>
                </>
              )}
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="rounded bg-muted px-2 py-1">Response</span>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── HookCard ──────────────────────────────────────────────────────────────────

function HookCard({
  hook,
  onToggle,
}: {
  hook: HookDefinition;
  onToggle: (id: string) => void;
}) {
  const Icon = HOOK_ICONS[hook.type];

  return (
    <div className={`catalog-card ${hook.admin_managed ? "catalog-card-admin" : ""}`}>
      {hook.admin_managed && (
        <div className="flex items-center gap-1.5 mb-2">
          <Shield className="h-3 w-3 text-violet-400" />
          <span className="text-[10px] font-medium text-violet-400 uppercase tracking-wider">Admin Managed</span>
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${CATEGORY_COLORS[hook.category].split(" ")[0]}`}>
          <Icon className={`h-4 w-4 ${CATEGORY_COLORS[hook.category].split(" ")[1]}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-sm">{hook.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{hook.description}</p>
            </div>
            <button
              onClick={() => !hook.admin_managed && onToggle(hook.id)}
              disabled={hook.admin_managed}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                hook.enabled ? "bg-green-500" : "bg-muted"
              } ${hook.admin_managed ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                hook.enabled ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`status-badge ${PHASE_COLORS[hook.phase]}`}>{hook.phase}</span>
            <span className={`status-badge ${CATEGORY_COLORS[hook.category]}`}>{hook.category}</span>
            {hook.builtin && <Badge variant="outline" className="text-[10px]">Built-in</Badge>}
            <span className="text-[10px] text-muted-foreground">{hook.skill_count} skills</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end mt-3 pt-2 border-t border-border/50">
        <HookDetailSheet hook={hook} />
      </div>
    </div>
  );
}

// ── SkillBindingCard ──────────────────────────────────────────────────────────

function SkillBindingCard({ binding }: { binding: SkillHookBinding }) {
  const preHooks = binding.hooks.filter((h) => h.phase === "pre");
  const postHooks = binding.hooks.filter((h) => h.phase === "post");

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-yellow-400" />
        <span className="font-mono text-sm font-medium">{binding.skill_name}</span>
        <span className="text-xs text-muted-foreground">v{binding.skill_version}</span>
      </div>
      <div className="flex items-center gap-2 text-xs overflow-x-auto pb-1">
        <span className="text-muted-foreground shrink-0">Pre:</span>
        {preHooks.length === 0
          ? <span className="text-muted-foreground">none</span>
          : preHooks.map((h, i) => {
              const Icon = HOOK_ICONS[h.type];
              return (
                <span key={i} className="flex items-center gap-1 rounded bg-teal-500/10 text-teal-400 px-2 py-0.5 shrink-0">
                  <Icon className="h-3 w-3" />
                  {h.type.replace(/_/g, " ")}
                </span>
              );
            })
        }
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="rounded bg-muted px-2 py-0.5 shrink-0">Skill</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground shrink-0">Post:</span>
        {postHooks.length === 0
          ? <span className="text-muted-foreground">none</span>
          : postHooks.map((h, i) => {
              const Icon = HOOK_ICONS[h.type];
              return (
                <span key={i} className="flex items-center gap-1 rounded bg-purple-500/10 text-purple-400 px-2 py-0.5 shrink-0">
                  <Icon className="h-3 w-3" />
                  {h.type.replace(/_/g, " ")}
                </span>
              );
            })
        }
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const CATEGORY_FILTERS = ["All", "Observability", "Safety", "Cost Control", "Compliance"] as const;

export default function HooksPage() {
  const [hooks, setHooks] = useState<HookDefinition[]>(BUILTIN_HOOKS);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [activeTab, setActiveTab] = useState<"hooks" | "bindings">("hooks");

  function toggleHook(id: string) {
    setHooks((prev) => prev.map((h) => h.id === id ? { ...h, enabled: !h.enabled } : h));
  }

  const filtered = hooks.filter((h) => categoryFilter === "All" || h.category === categoryFilter);
  const adminCount = hooks.filter((h) => h.admin_managed).length;
  const enabledCount = hooks.filter((h) => h.enabled).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15">
              <Webhook className="h-4 w-4 text-blue-400" />
            </div>
            <h1 className="text-xl font-semibold">Hooks</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Lifecycle hooks run before (pre) or after (post) every skill execution — for observability, cost control, HITL approval, and rate limiting.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" disabled title="Coming soon">
          <Plus className="h-4 w-4" />
          Custom Hook
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Hook Types", value: hooks.length },
          { label: "Active", value: enabledCount },
          { label: "Admin Managed", value: adminCount },
          { label: "Skills with Hooks", value: MOCK_SKILL_BINDINGS.length },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Architecture explainer */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Info className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">Hook Execution Model</p>
        </div>
        <div className="flex items-center gap-2 text-xs overflow-x-auto pb-1">
          {["Agent Request", "Pre-hooks", "Skill Dispatcher", "Skill Execution", "Post-hooks", "Agent Response"].map((step, i, arr) => (
            <div key={step} className="flex items-center gap-2 shrink-0">
              <span className={`rounded px-2.5 py-1.5 font-medium ${
                step.includes("hooks") ? "bg-violet-500/10 text-violet-400 border border-violet-500/20" : "bg-muted text-foreground"
              }`}>
                {step}
              </span>
              {i < arr.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Hooks are declarative — attach them to skills via the SOP manifest. The skill dispatcher runs all pre-hooks in order, then the skill, then all post-hooks.
          <strong className="text-foreground"> Guardrails</strong> differ: they can block execution; hooks are observational unless using HITL intercept.
        </p>
      </div>

      <Separator />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([["hooks", "Hook Types"], ["bindings", "Skill Bindings"]] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-violet-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {tab === "hooks" && <span className="ml-1.5 text-xs text-muted-foreground">({hooks.length})</span>}
            {tab === "bindings" && <span className="ml-1.5 text-xs text-muted-foreground">({MOCK_SKILL_BINDINGS.length})</span>}
          </button>
        ))}
      </div>

      {activeTab === "hooks" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {CATEGORY_FILTERS.map((c) => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`filter-chip ${categoryFilter === c ? "filter-chip-active" : ""}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((hook) => (
              <HookCard key={hook.id} hook={hook} onToggle={toggleHook} />
            ))}
          </div>
        </div>
      )}

      {activeTab === "bindings" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Showing how hooks are bound to skills in your tenant. Configure hooks per-skill in the skill SOP manifest.
          </p>
          <div className="space-y-3">
            {MOCK_SKILL_BINDINGS.map((binding) => (
              <SkillBindingCard key={binding.skill_name} binding={binding} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
