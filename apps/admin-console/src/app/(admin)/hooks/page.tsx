"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Webhook,
  Plus,
  Edit2,
  XCircle,
  Eye,
  BarChart3,
  ShieldCheck,
  Lock,
  Plug,
  Activity,
  Clock,
  Info,
  RefreshCw,
} from "lucide-react";
import { adminApi } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type HookPhase = "pre" | "post" | "both";
type HookCategory = "Observability" | "Governance" | "Privacy" | "Integration";

interface Hook {
  id: string;
  name: string;
  type: string;
  description: string;
  phase: HookPhase;
  category: HookCategory;
  enabled: boolean;
  admin_managed: boolean;
}

// ─── Explainers & config schemas ──────────────────────────────────────────────

const HOOK_DETAIL: Record<
  string,
  { icon: React.ElementType; explainer: string; schema: object }
> = {
  audit_log: {
    icon: Activity,
    explainer:
      "Runs after every skill invocation (both pre and post phases). Captures the full invocation envelope — tenant ID, agent ID, skill name, input snapshot, output snapshot, latency, and trace ID — then writes to the platform audit store. Retains logs for 90 days by default.",
    schema: {
      retention_days: 90,
      include_inputs: true,
      include_outputs: true,
      redact_pii: true,
    },
  },
  cost_meter: {
    icon: BarChart3,
    explainer:
      "Intercepts the post-execution response to extract token counts from the LLM response metadata. Applies the configured cost-per-token rate to compute an estimated USD cost, then increments per-agent and per-tenant counters in the cost ledger. Aggregates are flushed to the cost store every 60 s.",
    schema: {
      cost_per_input_token_usd: 0.000003,
      cost_per_output_token_usd: 0.000015,
      flush_interval_seconds: 60,
    },
  },
  hitl_intercept: {
    icon: ShieldCheck,
    explainer:
      "Before a mutating skill executes, the HITL hook posts an approval request to the configured review queue. Execution is suspended until an operator approves or rejects the request. If no decision is made within the timeout window the skill is automatically cancelled.",
    schema: {
      timeout_seconds: 300,
      notify_channel: "slack",
      auto_cancel_on_timeout: true,
      mutating_only: true,
    },
  },
  rate_limit: {
    icon: Lock,
    explainer:
      "Checks a sliding-window counter keyed by tenant ID before allowing a skill to run. If the tenant has exceeded the configured request-per-minute threshold the hook returns a 429-equivalent error and increments a rate-limit-exceeded metric.",
    schema: {
      requests_per_minute: 60,
      burst_allowance: 10,
      key_by: "tenant_id",
    },
  },
  pii_strip: {
    icon: Eye,
    explainer:
      "Runs in the pre-execution phase to sanitize skill inputs before they are forwarded to the LLM or logged. Uses a combination of regex patterns and an NER model to identify and replace PII tokens with placeholder strings.",
    schema: {
      patterns: ["ssn", "credit_card", "email", "phone"],
      replacement: "[REDACTED]",
      model: "ner-pii-v2",
    },
  },
  webhook: {
    icon: Plug,
    explainer:
      "After a skill completes, packages the result payload as JSON and POSTs it to the configured endpoint with an HMAC-SHA256 signature header. Supports configurable retry policies with exponential back-off.",
    schema: {
      url: "https://example.com/webhook",
      secret: "changeme",
      retry_attempts: 3,
      timeout_ms: 5000,
    },
  },
};

function getHookDetail(type: string) {
  return (
    HOOK_DETAIL[type] ?? {
      icon: Webhook,
      explainer: "No additional documentation available for this hook type.",
      schema: {},
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PHASE_STYLES: Record<HookPhase, string> = {
  pre: "bg-teal-500/15 text-teal-400",
  post: "bg-purple-500/15 text-purple-400",
  both: "bg-blue-500/15 text-blue-400",
};

const CATEGORY_FILTERS: (HookCategory | "All")[] = [
  "All",
  "Observability",
  "Governance",
  "Privacy",
  "Integration",
];

const ALL_CATEGORIES: HookCategory[] = [
  "Observability",
  "Governance",
  "Privacy",
  "Integration",
];

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  loading,
}: {
  checked: boolean;
  onChange: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={loading}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        loading ? "opacity-60 cursor-wait" : "cursor-pointer"
      } ${checked ? "bg-violet-500" : "bg-white/20"}`}
      aria-pressed={checked}
    >
      <span
        className={`inline-block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-[18px]" : ""
        }`}
      />
    </button>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalFormState {
  name: string;
  type: string;
  description: string;
  phase: HookPhase;
  category: HookCategory;
  admin_managed: boolean;
  enabled: boolean;
}

const EMPTY_FORM: ModalFormState = {
  name: "",
  type: "",
  description: "",
  phase: "post",
  category: "Observability",
  admin_managed: false,
  enabled: false,
};

function HookModal({
  initial,
  onSave,
  onClose,
  saving,
}: {
  initial: (ModalFormState & { id?: string }) | null;
  onSave: (data: ModalFormState & { id?: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<ModalFormState>(
    initial ? { ...initial } : { ...EMPTY_FORM }
  );
  const [errors, setErrors] = useState<{ name?: string; description?: string; type?: string }>({});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.description.trim()) errs.description = "Description is required";
    if (!form.type.trim()) errs.type = "Type is required";
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    onSave({ ...form, id: initial?.id });
  }

  const inputCls =
    "w-full rounded-lg border border-white/10 bg-[hsl(0,0%,9%)] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-violet-500";
  const labelCls = "block text-xs font-medium text-white/50 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[hsl(0,0%,13%)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">
            {initial?.id ? "Edit Hook" : "Add Hook"}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className={labelCls}>Name *</label>
            <input className={inputCls} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Audit Log" />
            {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
          </div>

          <div>
            <label className={labelCls}>Type *</label>
            <input className={inputCls} value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              placeholder="e.g. audit_log" />
            {errors.type && <p className="mt-1 text-xs text-red-400">{errors.type}</p>}
          </div>

          <div>
            <label className={labelCls}>Description *</label>
            <textarea className={`${inputCls} resize-none`} rows={3} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What does this hook do?" />
            {errors.description && <p className="mt-1 text-xs text-red-400">{errors.description}</p>}
          </div>

          <div>
            <label className={labelCls}>Phase</label>
            <select className={inputCls} value={form.phase}
              onChange={(e) => setForm({ ...form, phase: e.target.value as HookPhase })}>
              <option value="pre">pre</option>
              <option value="post">post</option>
              <option value="both">both</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Category</label>
            <select className={inputCls} value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as HookCategory })}>
              {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <input id="hook-enabled" type="checkbox" checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="h-4 w-4 accent-violet-500" />
            <label htmlFor="hook-enabled" className="text-sm text-white/70 cursor-pointer">Enabled</label>
          </div>

          <div className="flex items-center gap-3">
            <input id="hook-admin-managed" type="checkbox" checked={form.admin_managed}
              onChange={(e) => setForm({ ...form, admin_managed: e.target.checked })}
              className="h-4 w-4 accent-violet-500" />
            <label htmlFor="hook-admin-managed" className="text-sm text-white/70 cursor-pointer">
              Admin Managed <span className="text-white/40">(locks toggle for tenant users)</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white hover:border-white/20 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 transition-colors disabled:opacity-60">
              {saving ? "Saving…" : initial?.id ? "Save Changes" : "Add Hook"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function HookDetail({ hook }: { hook: Hook }) {
  const detail = getHookDetail(hook.type);
  const Icon = detail.icon;

  return (
    <div className="flex flex-col h-full space-y-5 p-5">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/15">
          <Icon className="h-6 w-6 text-violet-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">{hook.name}</h2>
          <p className="text-xs text-white/40 font-mono">{hook.type}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className={`status-badge ${PHASE_STYLES[hook.phase]}`}>
          <Clock className="h-3 w-3 mr-1" />{hook.phase}
        </span>
        <span className="status-badge bg-white/5 text-white/50">{hook.category}</span>
        {hook.admin_managed && (
          <span className="status-badge bg-violet-500/15 text-violet-400">Admin Managed</span>
        )}
        <span className={`status-badge ${hook.enabled ? "bg-green-500/15 text-green-400" : "bg-white/5 text-white/30"}`}>
          {hook.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-white/30 mb-2">Description</p>
        <p className="text-sm text-white/70 leading-relaxed">{hook.description}</p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-white/30 mb-2">How it works</p>
        <p className="text-sm text-white/60 leading-relaxed">{detail.explainer}</p>
      </div>

      <div className="flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/30 mb-2">Config Schema</p>
        <pre className="rounded-lg bg-[hsl(0,0%,9%)] border border-white/8 p-4 text-xs text-white/60 font-mono overflow-auto leading-relaxed">
          {JSON.stringify(detail.schema, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HooksPage() {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<HookCategory | "All">("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<(ModalFormState & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── load ────────────────────────────────────────────────────────────────────
  const loadHooks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.listHooks();
      setHooks(data);
      if (!selectedId && data.length > 0) setSelectedId(data[0].id);
    } catch (e: any) {
      setError(e.message || "Failed to load hooks");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { loadHooks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── derived stats ───────────────────────────────────────────────────────────
  const totalCount = hooks.length;
  const enabledCount = hooks.filter((h) => h.enabled).length;
  const preCount = hooks.filter((h) => h.phase === "pre" || h.phase === "both").length;
  const postCount = hooks.filter((h) => h.phase === "post" || h.phase === "both").length;

  const filtered =
    activeCategory === "All"
      ? hooks
      : hooks.filter((h) => h.category === activeCategory);

  const selectedHook = hooks.find((h) => h.id === selectedId) ?? null;

  // ── handlers ────────────────────────────────────────────────────────────────
  async function handleToggle(id: string) {
    setTogglingId(id);
    try {
      const updated = await adminApi.toggleHook(id);
      setHooks((prev) =>
        prev.map((h) => (h.id === id ? { ...h, enabled: updated.enabled } : h))
      );
    } catch {
      // ignore
    } finally {
      setTogglingId(null);
    }
  }

  function openCreate() { setEditTarget(null); setModalOpen(true); }

  function openEdit(h: Hook) {
    const { id, ...rest } = h;
    setEditTarget({ id, ...rest });
    setModalOpen(true);
  }

  async function handleSave(data: ModalFormState & { id?: string }) {
    setSaving(true);
    try {
      if (data.id) {
        const updated = await adminApi.updateHook(data.id, data);
        setHooks((prev) =>
          prev.map((h) => (h.id === data.id ? { ...h, ...updated } : h))
        );
      } else {
        const created = await adminApi.createHook(data);
        setHooks((prev) => [...prev, created]);
        setSelectedId(created.id);
      }
      setModalOpen(false);
    } catch (e: any) {
      alert(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15">
            <Webhook className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Platform Hooks</h1>
            <p className="text-sm text-white/50 mt-0.5">
              Manage lifecycle hooks that run before and after skill invocations
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadHooks} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/50 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 transition-colors">
            <Plus className="h-4 w-4" />
            Add Hook
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3">
        <Info className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
        <div className="text-sm text-white/60 leading-relaxed">
          <span className="font-semibold text-violet-300">Admin Managed</span> hooks (violet border) cannot be toggled by tenant users.{" "}
          <span className="text-white/80">You as admin can enable or disable any hook at any time.</span>{" "}
          Platform defaults like Audit Log and Cost Meter are enabled at install time for observability and compliance.
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error} — <button onClick={loadHooks} className="underline">retry</button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="stat-card">
          <p className="text-xs text-white/50">Total Hooks</p>
          <p className="mt-1.5 text-3xl font-bold text-white">{totalCount}</p>
          <p className="text-xs text-white/30 mt-1">registered</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-white/50">Enabled</p>
          <p className="mt-1.5 text-3xl font-bold text-green-400">{enabledCount}</p>
          <p className="text-xs text-white/30 mt-1">active</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-white/50">Pre-execution</p>
          <p className="mt-1.5 text-3xl font-bold text-teal-400">{preCount}</p>
          <p className="text-xs text-white/30 mt-1">hooks</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-white/50">Post-execution</p>
          <p className="mt-1.5 text-3xl font-bold text-purple-400">{postCount}</p>
          <p className="text-xs text-white/30 mt-1">hooks</p>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left panel — list (40%) */}
        <div className="w-2/5 shrink-0 flex flex-col gap-3">
          {/* Filter chips */}
          <div className="flex flex-wrap gap-2">
            {CATEGORY_FILTERS.map((cat) => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className={`filter-chip ${activeCategory === cat ? "filter-chip-active" : ""}`}>
                {cat}
              </button>
            ))}
          </div>

          {/* Hook rows */}
          <div className="admin-card p-0 overflow-hidden flex-1">
            {loading ? (
              <div className="divide-y divide-white/5">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="px-4 py-3.5 animate-pulse">
                    <div className="h-4 bg-white/10 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-white/5 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {filtered.map((h) => {
                  const isSelected = h.id === selectedId;
                  return (
                    <div
                      key={h.id}
                      onClick={() => setSelectedId(h.id)}
                      className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors ${
                        isSelected ? "bg-violet-500/10" : "hover:bg-white/5"
                      } ${h.admin_managed ? "border-l-2 border-l-violet-500/60" : "border-l-2 border-l-transparent"}`}
                    >
                      {/* Name + phase */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">{h.name}</span>
                          <span className={`status-badge shrink-0 ${PHASE_STYLES[h.phase]}`}>{h.phase}</span>
                        </div>
                        <p className="text-xs text-white/40 mt-0.5 font-mono">{h.type}</p>
                      </div>

                      {/* Toggle */}
                      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Toggle
                          checked={h.enabled}
                          onChange={() => handleToggle(h.id)}
                          loading={togglingId === h.id}
                        />
                      </div>

                      {/* Edit */}
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(h); }}
                        className="shrink-0 text-white/30 hover:text-white transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}

                {filtered.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-white/30">
                    No hooks in this category
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — detail (60%) */}
        <div className="flex-1 admin-card p-0 overflow-y-auto">
          {selectedHook ? (
            <HookDetail hook={selectedHook} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-white/30">
              Select a hook to see details
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <HookModal
          initial={editTarget}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
          saving={saving}
        />
      )}
    </div>
  );
}
