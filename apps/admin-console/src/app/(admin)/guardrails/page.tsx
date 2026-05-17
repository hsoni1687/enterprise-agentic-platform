"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  Plus,
  Edit2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  RefreshCw,
} from "lucide-react";
import { adminApi } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type GuardrailAction = "block" | "redact" | "flag";
type GuardrailCategory = "Privacy" | "Security" | "Content Safety" | "Quality";

interface Guardrail {
  id: string;
  name: string;
  description: string;
  category: GuardrailCategory;
  action: GuardrailAction;
  scope: string;
  admin_managed: boolean;
  enabled: boolean;
}

// ─── Regex checks (local playground only) ────────────────────────────────────

const CHECKS: { guardrailId: string; label: string; pattern: RegExp }[] = [
  {
    guardrailId: "gr-pii-block",
    label: "PII Detection",
    pattern: /\b\d{3}-\d{2}-\d{4}\b|\b4[0-9]{12}(?:[0-9]{3})?\b/,
  },
  {
    guardrailId: "gr-prompt-injection",
    label: "Prompt Injection Guard",
    pattern: /ignore previous|forget instructions|you are now|jailbreak/i,
  },
  {
    guardrailId: "gr-secret-leak",
    label: "Secret Leakage Prevention",
    pattern: /sk-[a-zA-Z0-9]{20,}|Bearer [a-zA-Z0-9._-]{20,}/,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<GuardrailAction, string> = {
  block: "bg-red-500/15 text-red-400",
  redact: "bg-orange-500/15 text-orange-400",
  flag: "bg-amber-500/15 text-amber-400",
};

const CATEGORY_FILTER_OPTIONS: (GuardrailCategory | "All")[] = [
  "All",
  "Privacy",
  "Security",
  "Content Safety",
  "Quality",
];

const ALL_CATEGORIES: GuardrailCategory[] = [
  "Privacy",
  "Security",
  "Content Safety",
  "Quality",
];

// ─── Toggle component ─────────────────────────────────────────────────────────

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
  description: string;
  category: GuardrailCategory;
  action: GuardrailAction;
  admin_managed: boolean;
  enabled: boolean;
}

const EMPTY_FORM: ModalFormState = {
  name: "",
  description: "",
  category: "Quality",
  action: "flag",
  admin_managed: false,
  enabled: false,
};

function GuardrailModal({
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
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.description.trim()) errs.description = "Description is required";
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
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
            {initial?.id ? "Edit Guardrail" : "Add Guardrail"}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className={labelCls}>Name *</label>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. PII Detection"
            />
            {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
          </div>

          <div>
            <label className={labelCls}>Description *</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What does this guardrail do?"
            />
            {errors.description && <p className="mt-1 text-xs text-red-400">{errors.description}</p>}
          </div>

          <div>
            <label className={labelCls}>Category</label>
            <select
              className={inputCls}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as GuardrailCategory })}
            >
              {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Action</label>
            <select
              className={inputCls}
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value as GuardrailAction })}
            >
              <option value="block">block</option>
              <option value="redact">redact</option>
              <option value="flag">flag</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="enabled-chk"
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="h-4 w-4 accent-violet-500"
            />
            <label htmlFor="enabled-chk" className="text-sm text-white/70 cursor-pointer">
              Enabled
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="admin-managed"
              type="checkbox"
              checked={form.admin_managed}
              onChange={(e) => setForm({ ...form, admin_managed: e.target.checked })}
              className="h-4 w-4 accent-violet-500"
            />
            <label htmlFor="admin-managed" className="text-sm text-white/70 cursor-pointer">
              Admin Managed <span className="text-white/40">(locks toggle for tenant users)</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white hover:border-white/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 transition-colors disabled:opacity-60"
            >
              {saving ? "Saving…" : initial?.id ? "Save Changes" : "Add Guardrail"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GuardrailsPage() {
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<GuardrailCategory | "All">("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<(ModalFormState & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Playground state
  const [sampleText, setSampleText] = useState("");
  const [checkResults, setCheckResults] = useState<
    { guardrailId: string; name: string; matched: boolean; category: string }[]
  >([]);
  const [hasRun, setHasRun] = useState(false);

  // ── load ────────────────────────────────────────────────────────────────────
  const loadGuardrails = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.listGuardrails();
      setGuardrails(data);
    } catch (e: any) {
      setError(e.message || "Failed to load guardrails");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGuardrails(); }, [loadGuardrails]);

  // ── derived stats ───────────────────────────────────────────────────────────
  const totalCount = guardrails.length;
  const enabledCount = guardrails.filter((g) => g.enabled).length;
  const adminManagedCount = guardrails.filter((g) => g.admin_managed).length;
  const categoriesCount = new Set(guardrails.map((g) => g.category)).size;

  // ── filtered list ───────────────────────────────────────────────────────────
  const filtered =
    activeCategory === "All"
      ? guardrails
      : guardrails.filter((g) => g.category === activeCategory);

  // ── handlers ────────────────────────────────────────────────────────────────
  async function handleToggle(id: string) {
    setTogglingId(id);
    try {
      const updated = await adminApi.toggleGuardrail(id);
      setGuardrails((prev) =>
        prev.map((g) => (g.id === id ? { ...g, enabled: updated.enabled } : g))
      );
    } catch {
      // Silently ignore — optimistic update not needed, DB is source of truth
    } finally {
      setTogglingId(null);
    }
  }

  function openCreate() {
    setEditTarget(null);
    setModalOpen(true);
  }

  function openEdit(g: Guardrail) {
    const { id, ...rest } = g;
    setEditTarget({ id, ...rest });
    setModalOpen(true);
  }

  async function handleSave(data: ModalFormState & { id?: string }) {
    setSaving(true);
    try {
      if (data.id) {
        const updated = await adminApi.updateGuardrail(data.id, data);
        setGuardrails((prev) =>
          prev.map((g) => (g.id === data.id ? { ...g, ...updated } : g))
        );
      } else {
        const created = await adminApi.createGuardrail(data);
        setGuardrails((prev) => [...prev, created]);
      }
      setModalOpen(false);
    } catch (e: any) {
      alert(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function runCheck() {
    if (!sampleText.trim()) return;
    const results = CHECKS.map(({ guardrailId, label, pattern }) => {
      const guardrail = guardrails.find((g) => g.id === guardrailId);
      return {
        guardrailId,
        name: guardrail?.name ?? label,
        matched: pattern.test(sampleText),
        category: guardrail?.category ?? "",
      };
    });
    setCheckResults(results);
    setHasRun(true);
  }

  const triggeredCount = checkResults.filter((r) => r.matched).length;

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15">
            <Shield className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Platform Guardrails</h1>
            <p className="text-sm text-white/50 mt-0.5">
              Manage content safety, security, and quality controls across the platform
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadGuardrails}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/50 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Guardrail
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3">
        <Info className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
        <div className="text-sm text-white/60 leading-relaxed">
          <span className="font-semibold text-violet-300">Admin Managed</span> guardrails (violet border) are enforced platform-wide — tenant users cannot toggle them.{" "}
          <span className="text-white/80">You as admin have full control over all guardrails.</span>{" "}
          Platform-default enabled items were bootstrapped during installation and represent the recommended security baseline.
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error} — <button onClick={loadGuardrails} className="underline">retry</button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="stat-card">
          <p className="text-xs text-white/50">Total</p>
          <p className="mt-1.5 text-3xl font-bold text-white">{totalCount}</p>
          <p className="text-xs text-white/30 mt-1">guardrails</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-white/50">Enabled</p>
          <p className="mt-1.5 text-3xl font-bold text-green-400">{enabledCount}</p>
          <p className="text-xs text-white/30 mt-1">active</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-white/50">Admin Managed</p>
          <p className="mt-1.5 text-3xl font-bold text-violet-400">{adminManagedCount}</p>
          <p className="text-xs text-white/30 mt-1">tenant-restricted</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-white/50">Categories</p>
          <p className="mt-1.5 text-3xl font-bold text-white">{categoriesCount}</p>
          <p className="text-xs text-white/30 mt-1">types</p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {CATEGORY_FILTER_OPTIONS.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`filter-chip ${activeCategory === cat ? "filter-chip-active" : ""}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Guardrail grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="admin-card animate-pulse h-32" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map((g) => (
            <div
              key={g.id}
              className={`admin-card admin-card-hover relative overflow-hidden ${
                g.admin_managed ? "border-l-2 border-l-violet-500/60" : ""
              }`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white">{g.name}</span>
                  <span className="status-badge bg-white/5 text-white/50">{g.category}</span>
                  <span className={`status-badge ${ACTION_STYLES[g.action]}`}>{g.action}</span>
                  {g.admin_managed && (
                    <span className="status-badge bg-violet-500/15 text-violet-400 gap-1">
                      <Shield className="h-3 w-3" />
                      Admin Managed
                    </span>
                  )}
                </div>
              </div>

              {/* Description */}
              <p className="text-sm text-white/50 mb-4 leading-relaxed">{g.description}</p>

              {/* Footer row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Toggle
                    checked={g.enabled}
                    onChange={() => handleToggle(g.id)}
                    loading={togglingId === g.id}
                  />
                  <span className="text-xs text-white/40">
                    {g.enabled ? "Enabled" : "Disabled"}
                  </span>
                  {g.admin_managed && (
                    <span className="text-[10px] text-violet-400/60">tenant-locked</span>
                  )}
                </div>
                <button
                  onClick={() => openEdit(g)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:text-white hover:border-white/20 transition-colors"
                >
                  <Edit2 className="h-3 w-3" />
                  Edit
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="col-span-2 py-12 text-center text-sm text-white/30">
              No guardrails in this category
            </div>
          )}
        </div>
      )}

      {/* Test playground */}
      <div className="admin-card space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <h2 className="text-base font-semibold text-white">Test Playground</h2>
        </div>
        <p className="text-sm text-white/50">
          Enter sample text below to see which guardrails would trigger.
        </p>

        <textarea
          className="w-full rounded-lg border border-white/10 bg-[hsl(0,0%,9%)] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
          rows={5}
          value={sampleText}
          onChange={(e) => { setSampleText(e.target.value); setHasRun(false); }}
          placeholder="Paste sample text to test against active guardrails…"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={runCheck}
            className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 transition-colors disabled:opacity-50"
            disabled={!sampleText.trim()}
          >
            Run Check
          </button>
          {hasRun && (
            <span className="text-sm text-white/40">
              {triggeredCount} of {checkResults.length} checked guardrails triggered
            </span>
          )}
        </div>

        {hasRun && checkResults.length > 0 && (
          <div className="space-y-2">
            {checkResults.map((r) => (
              <div
                key={r.guardrailId}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 ${
                  r.matched
                    ? "bg-red-500/10 border border-red-500/30"
                    : "bg-white/5 border border-white/5"
                }`}
              >
                {r.matched ? (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${r.matched ? "text-red-300" : "text-white/60"}`}>
                    {r.name}
                  </p>
                  <p className="text-xs text-white/30">{r.category}</p>
                </div>
                <span className={`status-badge ${r.matched ? "bg-red-500/20 text-red-400" : "bg-green-500/10 text-green-500"}`}>
                  {r.matched ? "Triggered" : "Clean"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <GuardrailModal
          initial={editTarget}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
          saving={saving}
        />
      )}
    </div>
  );
}
