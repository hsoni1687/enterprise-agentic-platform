"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { use } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import {
  Bot, MessageSquare, ArrowLeft, Loader2, Zap, Edit2,
  Sparkles, Cable, Shield, Webhook, Wrench, Check,
  ChevronRight, ChevronLeft, CheckCircle2, Search,
  Activity, DollarSign, UserCheck, Clock,
  Ban, EyeOff, AlertTriangle, Plus, Minus,
} from "lucide-react";
import { agentsApi, skillsApi, toolsApi, modelsApi, mcpApi, platformApi, PlatformGuardrail, PlatformHook, ModelInfo } from "@/lib/api";
import { ManifestAssistantPanel, AssistantDraft } from "@/components/manifest-assistant-panel";
import { AgentRecord, SkillManifest, ToolSpec, MCPServer } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";

// ── Schema ────────────────────────────────────────────────────────────────────

const agentSchema = z.object({
  name: z.string().min(1, "Required"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Must be x.y.z"),
  system_prompt: z.string().min(10, "System prompt too short"),
  model: z.string().min(1, "Required"),
  max_iterations: z.number().int().min(1).max(100),
  memory_budget_mb: z.number().int().min(64),
  skills: z.array(z.object({ id: z.string().optional(), name: z.string().min(1), version: z.string().min(1) })).optional(),
  tools: z.array(z.object({ name: z.string().min(1), version: z.string().min(1) })).optional(),
  mcp_servers: z.array(z.string()).optional(),
});

type AgentForm = z.infer<typeof agentSchema>;

// ── Hook phase icons (keyed by hook type) ─────────────────────────────────────

const HOOK_ICON: Record<string, typeof Activity> = {
  audit_log: Activity,
  cost_meter: DollarSign,
  hitl_intercept: UserCheck,
  rate_limit: Clock,
};

const ACTION_ICON: Record<string, typeof Ban> = { block: Ban, redact: EyeOff, flag: AlertTriangle };
const ACTION_COLOR: Record<string, string> = {
  block: "text-red-400 bg-red-500/10",
  redact: "text-orange-400 bg-orange-500/10",
  flag: "text-amber-400 bg-amber-500/10",
};

// ── Wizard steps ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: "identity",  label: "Identity",    icon: Bot },
  { id: "behavior",  label: "Behavior",    icon: Sparkles },
  { id: "skills",    label: "Skills",      icon: Zap },
  { id: "tools-mcp", label: "Tools & MCP", icon: Wrench },
  { id: "safety",    label: "Safety",      icon: Shield },
  { id: "review",    label: "Review",      icon: CheckCircle2 },
] as const;

type StepId = typeof STEPS[number]["id"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function SelectedChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-400">
      {label}
      <button type="button" onClick={onRemove} className="hover:text-white transition-colors">×</button>
    </span>
  );
}

function ModelLabel({ model }: { model: ModelInfo }) {
  const label = model.id.startsWith("ollama/") ? model.id.slice(7) : model.id;
  return (
    <span className="flex items-center gap-2">
      {label}
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
        model.source === "local" ? "bg-green-500/15 text-green-400" : "bg-blue-500/15 text-blue-400"
      }`}>
        {model.source === "local" ? "Local" : "Cloud"}
      </span>
    </span>
  );
}

function StepIndicator({ current }: { current: StepId }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center px-6 pb-4 pt-2">
      {STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = step.id === current;
        const Icon = step.icon;
        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                done ? "bg-violet-500 text-white" :
                active ? "bg-violet-500/20 text-violet-400 ring-1 ring-violet-500/50" :
                "bg-muted text-muted-foreground"
              }`}>
                {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              <span className={`text-[9px] font-medium whitespace-nowrap ${
                active ? "text-violet-400" : done ? "text-foreground/60" : "text-muted-foreground"
              }`}>{step.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 mx-1.5 mb-4 ${i < currentIdx ? "bg-violet-500/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step components (same as Create wizard) ───────────────────────────────────

function StepIdentity({ register, errors, control, availableModels }: {
  register: ReturnType<typeof useForm<AgentForm>>["register"];
  errors: ReturnType<typeof useForm<AgentForm>>["formState"]["errors"];
  control: ReturnType<typeof useForm<AgentForm>>["control"];
  availableModels: ModelInfo[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold mb-0.5">Agent Identity</p>
        <p className="text-xs text-muted-foreground">Update the display name, version, and model.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Name <span className="text-destructive">*</span></Label>
          <Input placeholder="Incident Responder" {...register("name")} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Version <span className="text-destructive">*</span></Label>
          <Input placeholder="1.0.0" {...register("version")} />
          {errors.version && <p className="text-xs text-destructive">{errors.version.message}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Model <span className="text-destructive">*</span></Label>
        <Controller
          name="model"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading models…</div>
                )}
                {availableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <ModelLabel model={m} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
    </div>
  );
}

function StepBehavior({ register, errors }: {
  register: ReturnType<typeof useForm<AgentForm>>["register"];
  errors: ReturnType<typeof useForm<AgentForm>>["formState"]["errors"];
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold mb-0.5">Agent Behavior</p>
        <p className="text-xs text-muted-foreground">Define the system prompt and runtime constraints.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>System Prompt <span className="text-destructive">*</span></Label>
        <Textarea rows={8} placeholder="You are…" {...register("system_prompt")} />
        {errors.system_prompt && <p className="text-xs text-destructive">{errors.system_prompt.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Max Iterations</Label>
          <Input type="number" {...register("max_iterations", { valueAsNumber: true })} />
          <p className="text-xs text-muted-foreground">Max tool-call loops before stopping.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Memory Budget (MB)</Label>
          <Input type="number" {...register("memory_budget_mb", { valueAsNumber: true })} />
          <p className="text-xs text-muted-foreground">Working memory cap for context.</p>
        </div>
      </div>
    </div>
  );
}

function StepSkills({
  selectedSkills, onToggle, availableSkills, isLoading,
}: {
  selectedSkills: NonNullable<AgentForm["skills"]>;
  onToggle: (skill: SkillManifest) => void;
  availableSkills: SkillManifest[];
  isLoading: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = availableSkills.filter((s) => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q);
  });
  const selectedNames = new Set(selectedSkills.map((s) => s.name));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold mb-0.5">Attached Skills</p>
        <p className="text-xs text-muted-foreground">Skills are reusable AI capabilities executed by the skill dispatcher.</p>
      </div>
      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSkills.map((s) => (
            <SelectedChip key={s.name} label={`${s.name}@${s.version}`}
              onRemove={() => { const match = availableSkills.find((av) => av.name === s.name); if (match) onToggle(match); }}
            />
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search skills…" className="pl-8 h-8 text-xs" />
      </div>
      {isLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {!isLoading && filtered.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No active skills found.</p>}
      <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto pr-1">
        {filtered.map((skill) => {
          const selected = selectedNames.has(skill.name);
          return (
            <button key={skill.id} type="button" onClick={() => onToggle(skill)}
              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all ${
                selected ? "border-violet-500/50 bg-violet-500/10" : "border-border hover:border-violet-500/30 hover:bg-muted/30"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${selected ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground"}`}>
                  {selected ? <Check className="h-3.5 w-3.5" /> : <Zap className="h-3 w-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium">{skill.name}</span>
                    <span className="text-[10px] text-muted-foreground">v{skill.version}</span>
                    {skill.mutating && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">mutating</span>}
                    {skill.scope === "system" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">admin</span>}
                  </div>
                  {skill.description && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{skill.description}</p>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepToolsMCP({
  selectedTools, onToggleTool, selectedMCPServers, onToggleMCP,
  availableTools, availableMCP, toolsLoading, mcpLoading,
}: {
  selectedTools: NonNullable<AgentForm["tools"]>;
  onToggleTool: (tool: ToolSpec) => void;
  selectedMCPServers: string[];
  onToggleMCP: (id: string) => void;
  availableTools: ToolSpec[];
  availableMCP: MCPServer[];
  toolsLoading: boolean;
  mcpLoading: boolean;
}) {
  const selectedToolNames = new Set(selectedTools.map((t) => t.name));
  const selectedMCPSet = new Set(selectedMCPServers);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold mb-0.5">Direct Tools</p>
          <p className="text-xs text-muted-foreground">Tools the agent can call directly.</p>
        </div>
        {selectedTools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedTools.map((t) => (
              <SelectedChip key={t.name} label={`${t.name}@${t.version}`}
                onRemove={() => { const match = availableTools.find((av) => av.name === t.name); if (match) onToggleTool(match); }}
              />
            ))}
          </div>
        )}
        {toolsLoading && <p className="text-xs text-muted-foreground">Loading tools…</p>}
        {!toolsLoading && availableTools.length === 0 && <p className="text-xs text-muted-foreground">No approved tools in registry.</p>}
        <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
          {availableTools.map((tool) => {
            const selected = selectedToolNames.has(tool.name);
            return (
              <button key={tool.id} type="button" onClick={() => onToggleTool(tool)}
                className={`text-left rounded-lg border px-3 py-2 transition-all ${
                  selected ? "border-violet-500/50 bg-violet-500/10" : "border-border hover:border-violet-500/30 hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${selected ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {selected ? <Check className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-medium truncate">{tool.name}</p>
                    <p className="text-[10px] text-muted-foreground">v{tool.version} · {tool.auth_level}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold mb-0.5">MCP Servers</p>
          <p className="text-xs text-muted-foreground">External tools and resources via MCP protocol.</p>
        </div>
        {selectedMCPServers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedMCPServers.map((sid) => {
              const server = availableMCP.find((s) => s.id === sid);
              return <SelectedChip key={sid} label={server?.name ?? sid} onRemove={() => onToggleMCP(sid)} />;
            })}
          </div>
        )}
        {mcpLoading && <p className="text-xs text-muted-foreground">Loading MCP servers…</p>}
        {!mcpLoading && availableMCP.length === 0 && <p className="text-xs text-muted-foreground">No MCP servers configured.</p>}
        <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1">
          {availableMCP.filter((s) => s.enabled).map((server) => {
            const selected = selectedMCPSet.has(server.id);
            return (
              <button key={server.id} type="button" onClick={() => onToggleMCP(server.id)}
                className={`text-left rounded-lg border px-3 py-2 transition-all ${
                  selected ? "border-violet-500/50 bg-violet-500/10" : "border-border hover:border-violet-500/30 hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${selected ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {selected ? <Check className="h-3.5 w-3.5" /> : <Cable className="h-3 w-3" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{server.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{server.url}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{server.scope}</Badge>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepSafety({
  selectedGuardrails, onToggleGuardrail, selectedHooks, onToggleHook,
  guardrails, hooks, safetyLoading,
}: {
  selectedGuardrails: string[];
  onToggleGuardrail: (id: string) => void;
  selectedHooks: string[];
  onToggleHook: (id: string) => void;
  guardrails: PlatformGuardrail[];
  hooks: PlatformHook[];
  safetyLoading: boolean;
}) {
  // Every guardrail/hook is a catalog item — user picks which to attach (same model as skills).
  // admin_managed=true just means "admin created it" — shown as a badge, never locked.
  const guardrailSet = new Set(selectedGuardrails);
  const hookSet = new Set(selectedHooks);

  if (safetyLoading) {
    return (
      <div className="space-y-3">
        {[1,2,3].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Guardrails ── */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold mb-0.5">Guardrails</p>
          <p className="text-xs text-muted-foreground">
            Choose which enforcement gates this agent should use. Toggle any guardrail on or off — none are forced.
          </p>
        </div>

        {guardrails.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No guardrails in catalog yet. Ask an admin to create some.</p>
        ) : (
          <div className="space-y-2">
            {guardrails.map((gr) => {
              const ActionIcon = ACTION_ICON[gr.action] ?? AlertTriangle;
              const selected = guardrailSet.has(gr.id);
              return (
                <div key={gr.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all cursor-pointer ${
                  selected ? "border-violet-500/40 bg-violet-500/8" : "border-border hover:border-border/80"
                }`} onClick={() => onToggleGuardrail(gr.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-medium">{gr.name}</p>
                      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${ACTION_COLOR[gr.action]}`}>
                        <ActionIcon className="h-2.5 w-2.5" />{gr.action}
                      </span>
                      {gr.admin_managed && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">admin</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{gr.description}</p>
                  </div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); onToggleGuardrail(gr.id); }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${selected ? "bg-violet-500" : "bg-muted"}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${selected ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* ── Hooks ── */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold mb-0.5">Hooks</p>
          <p className="text-xs text-muted-foreground">
            Choose lifecycle hooks for this agent. Hooks run before/after skill execution — all optional.
          </p>
        </div>
        {hooks.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No hooks in catalog yet. Ask an admin to create some.</p>
        ) : (
          <div className="space-y-2">
            {hooks.map((hook) => {
              const Icon = HOOK_ICON[hook.type] ?? Activity;
              const selected = hookSet.has(hook.id);
              return (
                <div key={hook.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all cursor-pointer ${
                  selected ? "border-violet-500/40 bg-violet-500/8" : "border-border hover:border-border/80"
                }`} onClick={() => onToggleHook(hook.id)}>
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-violet-500/20" : "bg-muted"}`}>
                    <Icon className={`h-3.5 w-3.5 ${selected ? "text-violet-400" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-medium">{hook.name}</p>
                      {hook.admin_managed && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">admin</span>
                      )}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        hook.phase === "pre" ? "bg-teal-500/10 text-teal-400" :
                        hook.phase === "post" ? "bg-purple-500/10 text-purple-400" :
                        "bg-blue-500/10 text-blue-400"
                      }`}>{hook.phase}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{hook.description}</p>
                  </div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); onToggleHook(hook.id); }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${selected ? "bg-violet-500" : "bg-muted"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${selected ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StepReview({ form, selectedGuardrails, selectedHooks, availableMCP, guardrails, hooks }: {
  form: AgentForm;
  selectedGuardrails: string[];
  selectedHooks: string[];
  availableMCP: MCPServer[];
  guardrails: PlatformGuardrail[];
  hooks: PlatformHook[];
}) {
  // Only show what the user explicitly selected — no auto-include of admin items
  const enabledGuardrails = guardrails.filter((g) => selectedGuardrails.includes(g.id));
  const enabledHooks = hooks.filter((h) => selectedHooks.includes(h.id));
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold mb-0.5">Review Changes</p>
        <p className="text-xs text-muted-foreground">Confirm before saving.</p>
      </div>
      <Section title="Identity">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div><p className="text-muted-foreground">Name</p><p className="font-medium">{form.name || "—"}</p></div>
          <div><p className="text-muted-foreground">Version</p><p className="font-mono">{form.version}</p></div>
          <div><p className="text-muted-foreground">Model</p><p className="font-mono truncate">{form.model}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs mt-1">
          <div><p className="text-muted-foreground">Max Iter</p><p>{form.max_iterations}</p></div>
          <div><p className="text-muted-foreground">Memory</p><p>{form.memory_budget_mb} MB</p></div>
        </div>
      </Section>
      <Section title="System Prompt">
        <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line">{form.system_prompt || "—"}</p>
      </Section>
      <Section title={`Skills (${(form.skills ?? []).filter((s) => s.name).length})`}>
        {(form.skills ?? []).filter((s) => s.name).length === 0
          ? <p className="text-xs text-muted-foreground">No skills attached</p>
          : <div className="flex flex-wrap gap-1">{(form.skills ?? []).filter((s) => s.name).map((s) => (
              <span key={s.name} className="text-xs bg-muted rounded px-2 py-0.5 font-mono">{s.name}@{s.version}</span>
            ))}</div>
        }
      </Section>
      <div className="grid grid-cols-2 gap-3">
        <Section title={`Tools (${(form.tools ?? []).length})`}>
          {(form.tools ?? []).length === 0
            ? <p className="text-xs text-muted-foreground">No direct tools</p>
            : <div className="flex flex-wrap gap-1">{(form.tools ?? []).map((t) => (
                <span key={t.name} className="text-xs bg-muted rounded px-2 py-0.5 font-mono">{t.name}</span>
              ))}</div>
          }
        </Section>
        <Section title={`MCP (${(form.mcp_servers ?? []).length})`}>
          {(form.mcp_servers ?? []).length === 0
            ? <p className="text-xs text-muted-foreground">No MCP servers</p>
            : <div className="flex flex-wrap gap-1">{(form.mcp_servers ?? []).map((sid) => {
                const server = availableMCP.find((s) => s.id === sid);
                return <span key={sid} className="text-xs bg-muted rounded px-2 py-0.5">{server?.name ?? sid}</span>;
              })}</div>
          }
        </Section>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Section title={`Guardrails (${enabledGuardrails.length})`}>
          <div className="flex flex-wrap gap-1">{enabledGuardrails.map((g) => (
            <span key={g.id} className="text-xs bg-muted rounded px-2 py-0.5">{g.name}</span>
          ))}</div>
        </Section>
        <Section title={`Hooks (${enabledHooks.length})`}>
          {enabledHooks.length === 0
            ? <p className="text-xs text-muted-foreground">No hooks</p>
            : <div className="flex flex-wrap gap-1">{enabledHooks.map((h) => (
                <span key={h.id} className="text-xs bg-muted rounded px-2 py-0.5">{h.name}</span>
              ))}</div>
          }
        </Section>
      </div>
    </div>
  );
}

// ── Edit wizard sheet ─────────────────────────────────────────────────────────

function EditAgentSheet({ agent, onUpdated }: { agent: AgentRecord; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<StepId>("identity");
  const [showAssistant, setShowAssistant] = useState(false);
  const [selectedGuardrails, setSelectedGuardrails] = useState<string[]>([]);
  const [selectedHooks, setSelectedHooks] = useState<string[]>(["hook-audit-log"]);
  const [selectedMCPServers, setSelectedMCPServers] = useState<string[]>(agent.mcp_servers ?? []);

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors } } = useForm<AgentForm>({
    resolver: zodResolver(agentSchema),
    values: {
      name: agent.name ?? "",
      version: agent.version ?? "1.0.0",
      system_prompt: agent.system_prompt ?? "",
      model: agent.model ?? "",
      max_iterations: agent.max_iterations ?? 20,
      memory_budget_mb: agent.memory_budget_mb ?? 256,
      skills: agent.skills ?? [],
      tools: agent.tools ?? [],
      mcp_servers: agent.mcp_servers ?? [],
    },
  });

  const formValues = watch();

  const { data: activeSkills, isLoading: skillsLoading } = useQuery({
    queryKey: ["skills", "active", "available"],
    queryFn: () => skillsApi.available("active"),
    enabled: open,
  });
  const { data: approvedTools, isLoading: toolsLoading } = useQuery({
    queryKey: ["tools", "approved"],
    queryFn: () => toolsApi.list("approved"),
    enabled: open,
  });
  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: () => modelsApi.list(),
    enabled: open,
  });
  const { data: mcpData, isLoading: mcpLoading } = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => mcpApi.listServers(),
    enabled: open,
  });
  const { data: guardrailsData, isLoading: guardrailsLoading } = useQuery({
    queryKey: ["platform-guardrails"],
    queryFn: () => platformApi.listGuardrails(),
    enabled: open,
  });
  const { data: hooksData, isLoading: hooksLoading } = useQuery({
    queryKey: ["platform-hooks"],
    queryFn: () => platformApi.listHooks(),
    enabled: open,
  });

  const availableModels = modelsData?.models ?? [];
  const availableSkills = activeSkills ?? [];
  const availableTools = approvedTools ?? [];
  const availableMCP = mcpData?.servers ?? [];
  const availableGuardrails = guardrailsData ?? [];
  const availableHooks = hooksData ?? [];

  const mutation = useMutation({
    mutationFn: (data: AgentForm) =>
      agentsApi.update(agent.id, { ...data, mcp_servers: selectedMCPServers }),
    onSuccess: () => { setOpen(false); onUpdated(); },
  });

  function toggleSkill(skill: SkillManifest) {
    const current = formValues.skills ?? [];
    const exists = current.findIndex((s) => s.name === skill.name);
    if (exists >= 0) setValue("skills", current.filter((_, i) => i !== exists));
    else setValue("skills", [...current, { id: skill.id, name: skill.name, version: skill.version }]);
  }

  function toggleTool(tool: ToolSpec) {
    const current = formValues.tools ?? [];
    const exists = current.findIndex((t) => t.name === tool.name);
    if (exists >= 0) setValue("tools", current.filter((_, i) => i !== exists));
    else setValue("tools", [...current, { name: tool.name, version: tool.version }]);
  }

  function toggleMCP(id: string) {
    setSelectedMCPServers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const isFirst = stepIdx === 0;
  const isLast = step === "review";

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) { setStep("identity"); }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger render={<Button size="sm" variant="outline" className="gap-1.5" />}>
        <Edit2 className="h-3.5 w-3.5" />Edit
      </SheetTrigger>

      <SheetContent className="sm:max-w-[680px] overflow-hidden flex flex-col p-0">
        <SheetHeader className="border-b border-border px-6 py-3 flex flex-row items-center justify-between shrink-0">
          <SheetTitle className="text-base font-semibold">Edit Agent</SheetTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAssistant(!showAssistant)} className="gap-2 h-7 text-xs">
            <Sparkles size={13} />
            {showAssistant ? "Hide" : "AI"} Assistant
          </Button>
        </SheetHeader>

        <div className="shrink-0 border-b border-border pb-3">
          <StepIndicator current={step} />
        </div>

        <div className="flex flex-1 overflow-hidden">
          <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {step === "identity" && (
                <StepIdentity register={register} errors={errors} control={control} availableModels={availableModels} />
              )}
              {step === "behavior" && (
                <StepBehavior register={register} errors={errors} />
              )}
              {step === "skills" && (
                <StepSkills
                  selectedSkills={formValues.skills ?? []}
                  onToggle={toggleSkill}
                  availableSkills={availableSkills}
                  isLoading={skillsLoading}
                />
              )}
              {step === "tools-mcp" && (
                <StepToolsMCP
                  selectedTools={formValues.tools ?? []}
                  onToggleTool={toggleTool}
                  selectedMCPServers={selectedMCPServers}
                  onToggleMCP={toggleMCP}
                  availableTools={availableTools}
                  availableMCP={availableMCP}
                  toolsLoading={toolsLoading}
                  mcpLoading={mcpLoading}
                />
              )}
              {step === "safety" && (
                <StepSafety
                  selectedGuardrails={selectedGuardrails}
                  onToggleGuardrail={(id) => setSelectedGuardrails((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
                  selectedHooks={selectedHooks}
                  onToggleHook={(id) => setSelectedHooks((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
                  guardrails={availableGuardrails}
                  hooks={availableHooks}
                  safetyLoading={guardrailsLoading || hooksLoading}
                />
              )}
              {step === "review" && (
                <StepReview
                  form={formValues}
                  selectedGuardrails={selectedGuardrails}
                  selectedHooks={selectedHooks}
                  availableMCP={availableMCP}
                  guardrails={availableGuardrails}
                  hooks={availableHooks}
                />
              )}
              {mutation.error && (
                <p className="text-xs text-destructive mt-3">{String(mutation.error)}</p>
              )}
            </div>

            <div className="shrink-0 border-t border-border px-6 py-3 flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={() => { const prev = STEPS[stepIdx - 1]; if (prev) setStep(prev.id); }} disabled={isFirst} className="gap-1.5">
                <ChevronLeft className="h-4 w-4" />Back
              </Button>
              <span className="text-xs text-muted-foreground">{stepIdx + 1} / {STEPS.length}</span>
              {isLast ? (
                <Button type="submit" size="sm" disabled={mutation.isPending} className="gap-1.5">
                  {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <CheckCircle2 className="h-3.5 w-3.5" />Save Changes
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => { const next = STEPS[stepIdx + 1]; if (next) setStep(next.id); }} className="gap-1.5">
                  Next<ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>

          {showAssistant && (
            <div className="w-64 border-l border-border flex flex-col shrink-0">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Sparkles size={14} className="text-violet-400" />
                <p className="text-xs font-medium">Manifest Assistant</p>
              </div>
              <div className="flex-1 overflow-hidden">
                <ManifestAssistantPanel
                  availableSkills={availableSkills}
                  availableTools={availableTools}
                  onApply={(draft: AssistantDraft) => {
                    if (draft.system_prompt) setValue("system_prompt", draft.system_prompt);
                    if (draft.skills?.length) setValue("skills", draft.skills);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  staged: "bg-yellow-500/15 text-yellow-400",
  active: "bg-green-500/15 text-green-400",
  paused: "bg-orange-500/15 text-orange-400",
  archived: "bg-muted text-muted-foreground",
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-400",
  staged: "bg-yellow-400",
  paused: "bg-orange-400",
  draft: "bg-muted-foreground",
  archived: "bg-muted-foreground",
};

// ── Agent detail page ─────────────────────────────────────────────────────────

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();

  const { data: agent, isLoading } = useQuery({
    queryKey: ["agents", id],
    queryFn: () => agentsApi.get(id),
  });

  const { data: mcpServersData } = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => mcpApi.listServers(),
  });
  const { data: platformGuardrailsData } = useQuery({
    queryKey: ["platform-guardrails"],
    queryFn: () => platformApi.listGuardrails(),
  });
  const { data: platformHooksData } = useQuery({
    queryKey: ["platform-hooks"],
    queryFn: () => platformApi.listHooks(),
  });
  const pageGuardrails = platformGuardrailsData ?? [];
  const pageHooks = platformHooksData ?? [];

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (agent?.status === "draft") {
        await agentsApi.transition(id, { target_state: "staged", actor: "studio-user" });
      }
      return agentsApi.transition(id, { target_state: "active", actor: "studio-user" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", id] }),
  });

  const pauseMutation = useMutation({
    mutationFn: () => agentsApi.transition(id, { target_state: "paused", actor: "studio-user" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", id] }),
  });

  const unpauseMutation = useMutation({
    mutationFn: () => agentsApi.transition(id, { target_state: "active", actor: "studio-user" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", id] }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agent) {
    return <div className="p-6 text-sm text-muted-foreground">Agent not found.</div>;
  }

  const mcpServers = (agent.mcp_servers ?? []).map((sid: string) =>
    mcpServersData?.servers?.find((s: any) => s.id === sid) ?? { id: sid, name: sid, url: "", scope: "unknown" }
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
        <Link href="/agents" className="hover:text-foreground transition-colors">Agents</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">{agent.name}</span>
      </div>

      {/* Header card */}
      <div className="catalog-card mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-500/15">
              <Bot className="h-6 w-6 text-violet-400" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-semibold">{agent.name}</h1>
                <span className="text-sm text-muted-foreground font-mono">v{agent.version}</span>
                <span className={`status-badge ${STATUS_COLORS[agent.status] ?? ""}`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${STATUS_DOT[agent.status] ?? "bg-muted-foreground"}`} />
                  {agent.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-xl line-clamp-2">
                {agent.system_prompt}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                <span className="font-mono text-foreground/70">{agent.model}</span>
                {agent.skills?.length > 0 && (
                  <><span>·</span><span className="flex items-center gap-1"><Zap className="h-3 w-3 text-yellow-400" />{agent.skills.length} skills</span></>
                )}
                {(agent.tools ?? []).length > 0 && (
                  <><span>·</span><span className="flex items-center gap-1"><Wrench className="h-3 w-3" />{agent.tools!.length} tools</span></>
                )}
                {(agent.mcp_servers ?? []).length > 0 && (
                  <><span>·</span><span className="flex items-center gap-1"><Cable className="h-3 w-3 text-blue-400" />{agent.mcp_servers!.length} MCP</span></>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {agent.status !== "archived" && (
              <EditAgentSheet agent={agent} onUpdated={() => qc.invalidateQueries({ queryKey: ["agents", id] })} />
            )}
            {agent.status === "active" && (
              <>
                <Link href={`/agents/${id}/chat`}>
                  <Button size="sm" className="gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" />Chat
                  </Button>
                </Link>
                <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
                  {pauseMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Pause"}
                </Button>
              </>
            )}
            {agent.status === "paused" && (
              <Button size="sm" onClick={() => unpauseMutation.mutate()} disabled={unpauseMutation.isPending}>
                {unpauseMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Resume"}
              </Button>
            )}
            {(agent.status === "draft" || agent.status === "staged") && (
              <Button size="sm" onClick={() => deployMutation.mutate()} disabled={deployMutation.isPending} className="gap-1.5">
                {deployMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Deploy
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Model", value: agent.model.split("/").pop() ?? agent.model, mono: true },
          { label: "Max Iterations", value: String(agent.max_iterations) },
          { label: "Memory Budget", value: `${agent.memory_budget_mb} MB` },
          { label: "Skills", value: String(agent.skills?.length ?? 0) },
        ].map(({ label, value, mono }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
            <p className={`text-sm font-semibold truncate ${mono ? "font-mono" : ""}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4">
        {/* System Prompt */}
        <section className="catalog-card">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-semibold">System Prompt</h2>
          </div>
          <pre className="rounded-lg bg-muted/30 border border-border p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed text-foreground/80 max-h-48 overflow-y-auto">
            {agent.system_prompt}
          </pre>
        </section>

        {/* Skills */}
        {agent.skills?.length > 0 && (
          <section className="catalog-card">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-4 w-4 text-yellow-400" />
              <h2 className="text-sm font-semibold">Skills</h2>
              <Badge variant="outline" className="text-xs ml-auto">{agent.skills.length}</Badge>
            </div>
            <div className="space-y-2">
              {agent.skills.map((skill: any) => (
                <div key={`${skill.name}-${skill.version}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/10 shrink-0">
                    <Zap className="h-3.5 w-3.5 text-yellow-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-medium">{skill.name}</p>
                    <p className="text-[10px] text-muted-foreground">v{skill.version}</p>
                  </div>
                  {skill.scope === "system" && (
                    <Badge variant="outline" className="text-[10px] shrink-0">admin</Badge>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tools & MCP */}
        {((agent.tools ?? []).length > 0 || mcpServers.length > 0) && (
          <div className="grid grid-cols-2 gap-4">
            {(agent.tools ?? []).length > 0 && (
              <section className="catalog-card">
                <div className="flex items-center gap-2 mb-3">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Tools</h2>
                  <Badge variant="outline" className="text-xs ml-auto">{agent.tools!.length}</Badge>
                </div>
                <div className="space-y-1.5">
                  {agent.tools!.map((tool: any) => (
                    <div key={tool.name} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                      <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-mono text-xs">{tool.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">v{tool.version}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {mcpServers.length > 0 && (
              <section className="catalog-card">
                <div className="flex items-center gap-2 mb-3">
                  <Cable className="h-4 w-4 text-blue-400" />
                  <h2 className="text-sm font-semibold">MCP Servers</h2>
                  <Badge variant="outline" className="text-xs ml-auto">{mcpServers.length}</Badge>
                </div>
                <div className="space-y-1.5">
                  {mcpServers.map((server: any) => (
                    <div key={server.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                      <div className="h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                      <span className="text-xs font-medium">{server.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{server.scope}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Safety overview */}
        <section className="catalog-card">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-semibold">Safety Policies</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Guardrails</p>
              <div className="space-y-1.5">
                {pageGuardrails.filter((g) => g.admin_managed).map((g) => {
                  const ActionIcon = ACTION_ICON[g.action] ?? AlertTriangle;
                  return (
                    <div key={g.id} className="flex items-center gap-2 rounded border border-violet-500/20 bg-violet-500/5 px-2.5 py-1.5">
                      <Shield className="h-3 w-3 text-violet-400 shrink-0" />
                      <span className="text-xs">{g.name}</span>
                      <span className={`ml-auto text-[9px] px-1.5 rounded-full ${ACTION_COLOR[g.action]}`}>{g.action}</span>
                    </div>
                  );
                })}
                {pageGuardrails.filter((g) => g.admin_managed).length === 0 && (
                  <p className="text-xs text-muted-foreground">None configured</p>
                )}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Hooks</p>
              <div className="space-y-1.5">
                {pageHooks.filter((h) => h.admin_managed).map((h) => {
                  const Icon = HOOK_ICON[h.type] ?? Activity;
                  return (
                    <div key={h.id} className="flex items-center gap-2 rounded border border-border bg-muted/20 px-2.5 py-1.5">
                      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-xs">{h.name}</span>
                      <span className={`ml-auto text-[9px] px-1.5 rounded ${
                        h.phase === "pre" ? "bg-teal-500/10 text-teal-400" :
                        h.phase === "post" ? "bg-purple-500/10 text-purple-400" :
                        "bg-blue-500/10 text-blue-400"
                      }`}>{h.phase}</span>
                    </div>
                  );
                })}
                {pageHooks.filter((h) => h.admin_managed).length === 0 && (
                  <p className="text-xs text-muted-foreground">None configured</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
