"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Trash2, Loader2, Bot, MessageSquare, Sparkles,
  ChevronRight, ChevronLeft, Check, Search,
  Zap, Wrench, Cable, Shield, Webhook, Activity,
  DollarSign, UserCheck, Clock, Circle, CheckCircle2,
  AlertTriangle, Ban, EyeOff, BookOpen,
} from "lucide-react";
import Link from "next/link";
import { agentsApi, skillsApi, toolsApi, mcpApi, platformApi, kgApi, setRuntimeTenant, PlatformGuardrail, PlatformHook } from "@/lib/api";
import { useTenant } from "@/contexts/tenant-context";
import { ManifestAssistantPanel, AssistantDraft } from "@/components/manifest-assistant-panel";
import { AgentRecord, SkillManifest, ToolSpec, MCPServer, AgentTier, TIER_DEFAULTS, TIER_AUTONOMY, KGGraph } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Schema ────────────────────────────────────────────────────────────────────

const agentSchema = z.object({
  name: z.string().min(1, "Required"),
  system_prompt: z.string().min(10, "System prompt too short"),
  max_iterations: z.number().int().min(1).max(100),
  memory_budget_mb: z.number().int().min(64),
  skills: z.array(z.object({ id: z.string().optional(), name: z.string().min(1), version: z.string().min(1) })),
  tools: z.array(z.object({ name: z.string().min(1), version: z.string().min(1) })).optional(),
  mcp_servers: z.array(z.string()).optional(),
});

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
}

type AgentForm = z.infer<typeof agentSchema>;

// ── Static catalog items (no backend yet for guardrails/hooks on agent) ───────

// Guardrails and hooks are loaded from the platform catalog API (not hardcoded).
// Admin-created items show a badge but are fully toggleable — nothing is forced.

const ACTION_ICON: Record<string, typeof Ban> = { block: Ban, redact: EyeOff, flag: AlertTriangle };
const ACTION_COLOR: Record<string, string> = {
  block: "text-red-400 bg-red-500/10",
  redact: "text-orange-400 bg-orange-500/10",
  flag: "text-amber-400 bg-amber-500/10",
};

// ── Wizard steps ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: "identity",   label: "Identity",   icon: Bot },
  { id: "behavior",   label: "Behavior",   icon: Sparkles },
  { id: "skills",     label: "Skills",     icon: Zap },
  { id: "tools-mcp",  label: "Tools & MCP",icon: Wrench },
  { id: "knowledge",  label: "Knowledge",  icon: BookOpen },
  { id: "safety",     label: "Safety",     icon: Shield },
  { id: "review",     label: "Review",     icon: CheckCircle2 },
] as const;

type StepId = typeof STEPS[number]["id"];

// ── Sub-components ────────────────────────────────────────────────────────────


function StepIndicator({ current }: { current: StepId }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0 px-6 pb-4 pt-2">
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
              <span className={`text-[9px] font-medium whitespace-nowrap ${active ? "text-violet-400" : done ? "text-foreground/60" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 mx-1.5 mb-4 transition-colors ${i < currentIdx ? "bg-violet-500/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Selected items chips ──────────────────────────────────────────────────────

function SelectedChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-400">
      {label}
      <button type="button" onClick={onRemove} className="hover:text-white transition-colors">×</button>
    </span>
  );
}

// ── Wizard steps content ──────────────────────────────────────────────────────

function StepIdentity({ register, errors, watchedName }: {
  register: ReturnType<typeof useForm<AgentForm>>["register"];
  errors: ReturnType<typeof useForm<AgentForm>>["formState"]["errors"];
  watchedName: string;
}) {
  const autoId = watchedName ? slugify(watchedName) : "";
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold mb-0.5">Agent Identity</p>
        <p className="text-xs text-muted-foreground">Give your agent a name. Model is picked from the workspace selector at runtime.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input placeholder="Incident Responder" {...register("name")} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        {autoId && (
          <p className="text-[11px] text-muted-foreground">
            ID will be auto-assigned: <span className="font-mono text-foreground/60">{autoId}</span>
          </p>
        )}
      </div>
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 flex items-center gap-2.5 mt-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-violet-500/10 shrink-0">
          <span className="text-[11px]">🎛</span>
        </div>
        <div>
          <p className="text-xs font-medium">Model is a workspace setting</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Switch the active model anytime from the top-right selector. Every execution picks it up automatically.
          </p>
        </div>
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
        <Textarea
          rows={8}
          placeholder="You are an expert incident responder. Your goal is to diagnose and resolve production incidents by querying logs, checking metrics, and taking remediation steps as needed..."
          {...register("system_prompt")}
        />
        {errors.system_prompt && <p className="text-xs text-destructive">{errors.system_prompt.message}</p>}
        <p className="text-xs text-muted-foreground">The instructions that define how the agent thinks and acts.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Max Iterations</Label>
          <Input type="number" {...register("max_iterations", { valueAsNumber: true })} />
          <p className="text-xs text-muted-foreground">Max tool-call loops before the agent stops.</p>
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
  selectedSkills,
  onToggle,
  availableSkills,
  isLoading,
}: {
  selectedSkills: AgentForm["skills"];
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
        <p className="text-sm font-semibold mb-0.5">Attach Skills</p>
        <p className="text-xs text-muted-foreground">
          Skills are reusable AI capabilities executed by the skill dispatcher. The agent picks which skill to run based on the task.
        </p>
      </div>

      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSkills.map((s) => (
            <SelectedChip
              key={s.name}
              label={`${s.name}@${s.version}`}
              onRemove={() => {
                const match = availableSkills.find((av) => av.name === s.name);
                if (match) onToggle(match);
              }}
            />
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills…"
          className="pl-8 h-8 text-xs"
        />
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading skills…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <p className="text-xs text-muted-foreground py-4 text-center">No active skills found.</p>
      )}

      <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto pr-1">
        {filtered.map((skill) => {
          const selected = selectedNames.has(skill.name);
          return (
            <button
              key={skill.id}
              type="button"
              onClick={() => onToggle(skill)}
              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all ${
                selected
                  ? "border-violet-500/50 bg-violet-500/10"
                  : "border-border hover:border-violet-500/30 hover:bg-muted/30"
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
                    {skill.mutating && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">mutating</span>
                    )}
                    {skill.scope === "system" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">admin</span>
                    )}
                  </div>
                  {skill.description && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{skill.description}</p>
                  )}
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
  selectedTools,
  onToggleTool,
  selectedMCPServers,
  onToggleMCP,
  availableTools,
  availableMCP,
  toolsLoading,
  mcpLoading,
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
      {/* Tools */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold mb-0.5">Direct Tools</p>
          <p className="text-xs text-muted-foreground">
            Tools the agent can call directly. System tools are auto-injected. Mutating tools require HITL approval.
          </p>
        </div>

        {selectedTools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedTools.map((t) => (
              <SelectedChip
                key={t.name}
                label={`${t.name}@${t.version}`}
                onRemove={() => {
                  const match = availableTools.find((av) => av.name === t.name);
                  if (match) onToggleTool(match);
                }}
              />
            ))}
          </div>
        )}

        {toolsLoading && <p className="text-xs text-muted-foreground">Loading tools…</p>}
        {!toolsLoading && availableTools.length === 0 && (
          <p className="text-xs text-muted-foreground">No approved tools in registry.</p>
        )}

        <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
          {availableTools.map((tool) => {
            const selected = selectedToolNames.has(tool.name);
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onToggleTool(tool)}
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

      {/* MCP Servers */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold mb-0.5">MCP Servers</p>
          <p className="text-xs text-muted-foreground">
            Connect MCP servers to give this agent access to external tools and resources.
          </p>
        </div>

        {selectedMCPServers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedMCPServers.map((id) => {
              const server = availableMCP.find((s) => s.id === id);
              return (
                <SelectedChip key={id} label={server?.name ?? id} onRemove={() => onToggleMCP(id)} />
              );
            })}
          </div>
        )}

        {mcpLoading && <p className="text-xs text-muted-foreground">Loading MCP servers…</p>}
        {!mcpLoading && availableMCP.length === 0 && (
          <p className="text-xs text-muted-foreground">No MCP servers configured. Add one in the MCP Servers section.</p>
        )}

        <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1">
          {availableMCP.filter((s) => s.enabled).map((server) => {
            const selected = selectedMCPSet.has(server.id);
            return (
              <button
                key={server.id}
                type="button"
                onClick={() => onToggleMCP(server.id)}
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

function StepKnowledge({
  selectedKGs,
  onToggleKG,
  availableGraphs,
  kgLoading,
}: {
  selectedKGs: string[];
  onToggleKG: (id: string) => void;
  availableGraphs: KGGraph[];
  kgLoading: boolean;
}) {
  const selectedSet = new Set(selectedKGs);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold mb-0.5">Knowledge Graphs</p>
        <p className="text-xs text-muted-foreground">
          Attached graphs are semantically searched at runtime — relevant chunks are injected into the agent's context automatically.
        </p>
      </div>

      {selectedKGs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedKGs.map((id) => {
            const g = availableGraphs.find((x) => x.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-400">
                {g?.name ?? id}
                <button type="button" onClick={() => onToggleKG(id)} className="hover:text-white transition-colors">×</button>
              </span>
            );
          })}
        </div>
      )}

      {kgLoading && <p className="text-xs text-muted-foreground">Loading knowledge graphs…</p>}
      {!kgLoading && availableGraphs.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <BookOpen className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No knowledge graphs available.</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Create one under <span className="font-medium">Connect → Knowledge Graphs</span>.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto pr-1">
        {availableGraphs.map((graph) => {
          const selected = selectedSet.has(graph.id);
          return (
            <button
              key={graph.id}
              type="button"
              onClick={() => onToggleKG(graph.id)}
              className={`text-left rounded-lg border px-3 py-2.5 transition-all ${
                selected
                  ? "border-violet-500/50 bg-violet-500/10"
                  : "border-border hover:border-violet-500/30 hover:bg-muted/30"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded ${
                  selected ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground"
                }`}>
                  {selected ? <Check className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{graph.name}</p>
                  {graph.description && (
                    <p className="text-[10px] text-muted-foreground truncate">{graph.description}</p>
                  )}
                  {graph.domain && (
                    <p className="text-[10px] text-muted-foreground">Domain: {graph.domain}</p>
                  )}
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0 capitalize">{graph.scope}</Badge>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepSafety({
  selectedGuardrails,
  onToggleGuardrail,
  selectedHooks,
  onToggleHook,
  catalogGuardrails,
  catalogHooks,
}: {
  selectedGuardrails: string[];
  onToggleGuardrail: (id: string) => void;
  selectedHooks: string[];
  onToggleHook: (id: string) => void;
  catalogGuardrails: PlatformGuardrail[];
  catalogHooks: PlatformHook[];
}) {
  const guardrailSet = new Set(selectedGuardrails);
  const hookSet = new Set(selectedHooks);

  return (
    <div className="space-y-6">
      {/* Guardrails */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold mb-0.5">Guardrails</p>
          <p className="text-xs text-muted-foreground">
            Choose which enforcement gates to attach to this agent. Toggle any on or off — nothing is forced.
          </p>
        </div>

        {catalogGuardrails.length === 0 ? (
          <p className="text-xs text-muted-foreground border border-dashed rounded-lg px-3 py-4 text-center">
            No guardrails in catalog yet. Ask your admin to add some.
          </p>
        ) : (
          <div className="space-y-2">
            {catalogGuardrails.map((gr) => {
              const action = gr.action ?? "flag";
              const ActionIcon = ACTION_ICON[action] ?? AlertTriangle;
              const selected = guardrailSet.has(gr.id);
              return (
                <div
                  key={gr.id}
                  onClick={() => onToggleGuardrail(gr.id)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-all ${
                    selected ? "border-violet-500/40 bg-violet-500/8" : "border-border hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-medium">{gr.name}</p>
                      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${ACTION_COLOR[action]}`}>
                        <ActionIcon className="h-2.5 w-2.5" />{action}
                      </span>
                      {gr.admin_managed && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">admin</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{gr.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleGuardrail(gr.id); }}
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

      <Separator />

      {/* Hooks */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold mb-0.5">Hooks</p>
          <p className="text-xs text-muted-foreground">
            Lifecycle hooks run before/after skill execution. Guardrails enforce; hooks observe and extend.
          </p>
        </div>

        {catalogHooks.length === 0 ? (
          <p className="text-xs text-muted-foreground border border-dashed rounded-lg px-3 py-4 text-center">
            No hooks in catalog yet. Ask your admin to add some.
          </p>
        ) : (
          <div className="space-y-2">
            {catalogHooks.map((hook) => {
              const selected = hookSet.has(hook.id);
              const phase = hook.phase ?? "both";
              return (
                <div
                  key={hook.id}
                  onClick={() => onToggleHook(hook.id)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-all ${
                    selected ? "border-violet-500/40 bg-violet-500/8" : "border-border hover:border-muted-foreground/30"
                  }`}
                >
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-violet-500/20" : "bg-muted"}`}>
                    <Webhook className={`h-3.5 w-3.5 ${selected ? "text-violet-400" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-medium">{hook.name}</p>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        phase === "pre" ? "bg-teal-500/10 text-teal-400"
                        : phase === "post" ? "bg-purple-500/10 text-purple-400"
                        : "bg-blue-500/10 text-blue-400"
                      }`}>{phase}</span>
                      {hook.admin_managed && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">admin</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{hook.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleHook(hook.id); }}
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

function StepReview({
  form,
  selectedGuardrails,
  selectedHooks,
  availableMCP,
  catalogGuardrails,
  catalogHooks,
  selectedKGs,
  availableGraphs,
}: {
  form: AgentForm;
  selectedGuardrails: string[];
  selectedHooks: string[];
  availableMCP: MCPServer[];
  catalogGuardrails: PlatformGuardrail[];
  catalogHooks: PlatformHook[];
  selectedKGs: string[];
  availableGraphs: KGGraph[];
}) {
  const enabledGuardrails = catalogGuardrails.filter((g) => selectedGuardrails.includes(g.id));
  const enabledHooks = catalogHooks.filter((h) => selectedHooks.includes(h.id));
  const attachedGraphs = availableGraphs.filter((g) => selectedKGs.includes(g.id));

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold mb-0.5">Review Configuration</p>
        <p className="text-xs text-muted-foreground">Check everything before creating the agent.</p>
      </div>

      <Section title="Identity">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div><p className="text-muted-foreground">Name</p><p className="font-medium">{form.name || "—"}</p></div>
          <div><p className="text-muted-foreground">Max Iterations</p><p>{form.max_iterations}</p></div>
          <div><p className="text-muted-foreground">Memory Budget</p><p>{form.memory_budget_mb} MB</p></div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">Model: picked from workspace selector at execution time</p>
      </Section>

      <Section title="System Prompt">
        <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line">{form.system_prompt || "—"}</p>
      </Section>

      <Section title={`Skills (${form.skills.filter((s) => s.name).length})`}>
        {form.skills.filter((s) => s.name).length === 0
          ? <p className="text-xs text-muted-foreground">No skills attached</p>
          : <div className="flex flex-wrap gap-1">
              {form.skills.filter((s) => s.name).map((s) => (
                <span key={s.name} className="text-xs bg-muted rounded px-2 py-0.5 font-mono">{s.name}@{s.version}</span>
              ))}
            </div>
        }
      </Section>

      <div className="grid grid-cols-2 gap-3">
        <Section title={`Tools (${(form.tools ?? []).length})`}>
          {(form.tools ?? []).length === 0
            ? <p className="text-xs text-muted-foreground">No direct tools</p>
            : <div className="flex flex-wrap gap-1">
                {(form.tools ?? []).map((t) => (
                  <span key={t.name} className="text-xs bg-muted rounded px-2 py-0.5 font-mono">{t.name}</span>
                ))}
              </div>
          }
        </Section>
        <Section title={`MCP (${(form.mcp_servers ?? []).length})`}>
          {(form.mcp_servers ?? []).length === 0
            ? <p className="text-xs text-muted-foreground">No MCP servers</p>
            : <div className="flex flex-wrap gap-1">
                {(form.mcp_servers ?? []).map((id) => {
                  const server = availableMCP.find((s) => s.id === id);
                  return <span key={id} className="text-xs bg-muted rounded px-2 py-0.5">{server?.name ?? id}</span>;
                })}
              </div>
          }
        </Section>
      </div>

      <Section title={`Knowledge Graphs (${attachedGraphs.length})`}>
        {attachedGraphs.length === 0
          ? <p className="text-xs text-muted-foreground">No knowledge graphs attached</p>
          : <div className="flex flex-wrap gap-1">{attachedGraphs.map((g) => (
              <span key={g.id} className="text-xs bg-muted rounded px-2 py-0.5">{g.name}</span>
            ))}</div>
        }
      </Section>

      <div className="grid grid-cols-2 gap-3">
        <Section title={`Guardrails (${enabledGuardrails.length})`}>
          <div className="flex flex-wrap gap-1">
            {enabledGuardrails.map((g) => (
              <span key={g.id} className="text-xs bg-muted rounded px-2 py-0.5">{g.name}</span>
            ))}
          </div>
        </Section>
        <Section title={`Hooks (${enabledHooks.length})`}>
          {enabledHooks.length === 0
            ? <p className="text-xs text-muted-foreground">No hooks enabled</p>
            : <div className="flex flex-wrap gap-1">
                {enabledHooks.map((h) => (
                  <span key={h.id} className="text-xs bg-muted rounded px-2 py-0.5">{h.name}</span>
                ))}
              </div>
          }
        </Section>
      </div>
    </div>
  );
}

// ── Tier metadata ─────────────────────────────────────────────────────────────

const TIER_META: Record<AgentTier, {
  label: string;
  tagline: string;
  icon: string;
  color: string;
  badge: string;
  examples: string[];
  speed: number;
  cost: number;
  power: number;
}> = {
  lite: {
    label: "Lite Agent",
    tagline: "Fast, focused, single-purpose",
    icon: "⚡",
    color: "border-green-500/40 bg-green-500/5 hover:border-green-500/70",
    badge: "bg-green-500/10 text-green-400",
    examples: ["FAQ bot", "API caller", "Notifier", "Validator"],
    speed: 95, cost: 95, power: 30,
  },
  workflow: {
    label: "Workflow Agent",
    tagline: "Multi-step, structured, predictable",
    icon: "🔗",
    color: "border-blue-500/40 bg-blue-500/5 hover:border-blue-500/70",
    badge: "bg-blue-500/10 text-blue-400",
    examples: ["Support router", "Deploy pipeline", "Data enrichment", "Escalation flow"],
    speed: 55, cost: 60, power: 65,
  },
  deep: {
    label: "Deep Agent",
    tagline: "Autonomous, reasoning, long-running",
    icon: "🧠",
    color: "border-purple-500/40 bg-purple-500/5 hover:border-purple-500/70",
    badge: "bg-purple-500/10 text-purple-400",
    examples: ["Researcher", "Autonomous debugger", "Financial analyst", "Investigator"],
    speed: 20, cost: 25, power: 95,
  },
};

function TierBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function TierPicker({ onSelect }: { onSelect: (tier: AgentTier) => void }) {
  return (
    <div className="p-6 flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">What are you building?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the agent type that matches your use case. You can change this later.
        </p>
      </div>
      <div className="grid gap-3">
        {(["lite", "workflow", "deep"] as AgentTier[]).map((tier) => {
          const meta = TIER_META[tier];
          return (
            <button
              key={tier}
              type="button"
              onClick={() => onSelect(tier)}
              className={`text-left rounded-xl border p-4 transition-all cursor-pointer group ${meta.color}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm">{meta.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${meta.badge}`}>
                      {tier}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{meta.tagline}</p>
                  <div className="flex flex-col gap-1.5 mb-3">
                    <TierBar label="Speed" value={meta.speed} />
                    <TierBar label="Cost" value={meta.cost} />
                    <TierBar label="Power" value={meta.power} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {meta.examples.map((ex) => (
                      <span key={ex} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {ex}
                      </span>
                    ))}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── CreateAgentDialog (wizard) ────────────────────────────────────────────────

function CreateAgentDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<AgentTier | null>(null);
  const [step, setStep] = useState<StepId>("identity");
  const [showAssistant, setShowAssistant] = useState(false);

  const [selectedGuardrails, setSelectedGuardrails] = useState<string[]>([]);
  const [selectedHooks, setSelectedHooks] = useState<string[]>(["hook-audit-log"]);
  const [selectedMCPServers, setSelectedMCPServers] = useState<string[]>([]);
  const [selectedKGs, setSelectedKGs] = useState<string[]>([]);

  const { register, handleSubmit, reset, control, setValue, watch, formState: { errors } } = useForm<AgentForm>({
    resolver: zodResolver(agentSchema),
    defaultValues: {
      max_iterations: 20,
      memory_budget_mb: 256,
      skills: [],
      tools: [],
      mcp_servers: [],
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
  const { data: mcpData, isLoading: mcpLoading } = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => mcpApi.listServers(),
    enabled: open,
  });
  const { data: catalogGuardrailsData } = useQuery({
    queryKey: ["platform-guardrails"],
    queryFn: () => platformApi.listGuardrails(),
    enabled: open,
  });
  const { data: catalogHooksData } = useQuery({
    queryKey: ["platform-hooks"],
    queryFn: () => platformApi.listHooks(),
    enabled: open,
  });
  const { data: kgData, isLoading: kgLoading } = useQuery({
    queryKey: ["knowledge-graphs"],
    queryFn: () => kgApi.listGraphs(),
    enabled: open,
  });

  const availableSkills = activeSkills ?? [];
  const availableTools = approvedTools ?? [];
  const availableMCP = mcpData?.servers ?? [];
  const catalogGuardrails = catalogGuardrailsData ?? [];
  const catalogHooks = catalogHooksData ?? [];
  const availableGraphs: KGGraph[] = kgData ?? [];

  const mutation = useMutation({
    mutationFn: (data: AgentForm) => {
      const autoId = slugify(data.name);
      return agentsApi.create({
        ...data,
        id: autoId,
        version: "1.0.0",
        mcp_servers: selectedMCPServers,
        knowledge_graph_ids: selectedKGs,
        guardrail_ids: selectedGuardrails,
        hook_ids: selectedHooks,
        tier: tier ?? "deep",
        autonomy_level: TIER_AUTONOMY[tier ?? "deep"],
        execution_config: TIER_DEFAULTS[tier ?? "deep"] as import("@/lib/types").ExecutionConfig,
      });
    },
    onSuccess: () => {
      reset();
      setStep("identity");
      setTier(null);
      setSelectedGuardrails([]);
      setSelectedHooks(["hook-audit-log"]);
      setSelectedMCPServers([]);
      setSelectedKGs([]);
      setOpen(false);
      onCreated();
    },
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

  function toggleKG(id: string) {
    setSelectedKGs((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const isFirst = stepIdx === 0;
  const isLast = step === "review";

  function goNext() { const s = STEPS[stepIdx + 1]; if (s) setStep(s.id); }
  function goPrev() { const s = STEPS[stepIdx - 1]; if (s) setStep(s.id); }

  function handleApplyAssistantDraft(draft: AssistantDraft) {
    if (draft.system_prompt) setValue("system_prompt", draft.system_prompt);
    if (draft.skills?.length) setValue("skills", draft.skills);
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) { reset(); setStep("identity"); setTier(null); setShowAssistant(false); }
  }

  function handleTierSelect(selectedTier: AgentTier) {
    setTier(selectedTier);
    if (selectedTier === "lite") setValue("max_iterations", 1);
    else if (selectedTier === "workflow") setValue("max_iterations", 20);
    else setValue("max_iterations", 100);
  }

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New Agent
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton
          className="w-[92vw] max-w-[900px] h-[88vh] max-h-[820px]"
        >
          {/* ── Header ── */}
          <div className="shrink-0 flex items-center justify-between border-b border-border px-6 py-3.5">
            <div className="flex items-center gap-2.5">
              <DialogTitle className="text-base">
                {tier ? `New ${TIER_META[tier].label}` : "Create Agent"}
              </DialogTitle>
              {tier && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TIER_META[tier].badge}`}>
                  {TIER_META[tier].icon} {tier}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mr-8">
              {tier && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setTier(null); setStep("identity"); }} className="h-7 text-xs text-muted-foreground gap-1">
                  <ChevronLeft className="h-3 w-3" /> Change type
                </Button>
              )}
              {tier && (
                <Button type="button" variant="outline" size="sm" onClick={() => setShowAssistant(!showAssistant)} className="gap-1.5 h-7 text-xs">
                  <Sparkles size={12} />
                  {showAssistant ? "Hide" : "AI"} Assistant
                </Button>
              )}
            </div>
          </div>

          {/* ── Body ── */}
          <div className="flex flex-1 overflow-hidden min-h-0">

            {/* Tier picker */}
            {!tier && (
              <div className="flex-1 overflow-y-auto">
                <TierPicker onSelect={handleTierSelect} />
              </div>
            )}

            {/* Step sidebar + content */}
            {tier && (
              <>
                {/* Left: step nav */}
                <nav className="w-44 shrink-0 border-r border-border overflow-y-auto py-4 flex flex-col gap-0.5 px-2">
                  {STEPS.map((s, i) => {
                    const done = i < stepIdx;
                    const active = s.id === step;
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStep(s.id)}
                        className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-colors text-left ${
                          active
                            ? "bg-violet-500/15 text-violet-400 font-medium"
                            : done
                            ? "text-foreground/70 hover:bg-muted/50"
                            : "text-muted-foreground hover:bg-muted/40"
                        }`}
                      >
                        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                          done
                            ? "bg-violet-500 text-white"
                            : active
                            ? "bg-violet-500/20 text-violet-400 ring-1 ring-violet-500/40"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                        </div>
                        {s.label}
                      </button>
                    );
                  })}
                </nav>

                {/* Right: step content + optional assistant */}
                <div className="flex flex-1 overflow-hidden min-w-0">
                  <form
                    onSubmit={handleSubmit((d) => mutation.mutate(d))}
                    className="flex flex-col flex-1 overflow-hidden min-w-0"
                  >
                    <div className="flex-1 overflow-y-auto px-7 py-6">
                      {step === "identity" && (
                        <StepIdentity register={register} errors={errors} watchedName={formValues.name ?? ""} />
                      )}
                      {step === "behavior" && (
                        <StepBehavior register={register} errors={errors} />
                      )}
                      {step === "skills" && (
                        <StepSkills selectedSkills={formValues.skills ?? []} onToggle={toggleSkill} availableSkills={availableSkills} isLoading={skillsLoading} />
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
                      {step === "knowledge" && (
                        <StepKnowledge selectedKGs={selectedKGs} onToggleKG={toggleKG} availableGraphs={availableGraphs} kgLoading={kgLoading} />
                      )}
                      {step === "safety" && (
                        <StepSafety
                          selectedGuardrails={selectedGuardrails}
                          onToggleGuardrail={(id) => setSelectedGuardrails((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
                          selectedHooks={selectedHooks}
                          onToggleHook={(id) => setSelectedHooks((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
                          catalogGuardrails={catalogGuardrails}
                          catalogHooks={catalogHooks}
                        />
                      )}
                      {step === "review" && (
                        <StepReview
                          form={formValues}
                          selectedGuardrails={selectedGuardrails}
                          selectedHooks={selectedHooks}
                          availableMCP={availableMCP}
                          catalogGuardrails={catalogGuardrails}
                          catalogHooks={catalogHooks}
                          selectedKGs={selectedKGs}
                          availableGraphs={availableGraphs}
                        />
                      )}
                      {mutation.error && <p className="text-xs text-destructive mt-3">{String(mutation.error)}</p>}
                    </div>

                    {/* Footer */}
                    <div className="shrink-0 border-t border-border px-7 py-3.5 flex items-center justify-between bg-muted/10">
                      <Button type="button" variant="outline" size="sm" onClick={goPrev} disabled={isFirst} className="gap-1.5">
                        <ChevronLeft className="h-4 w-4" /> Back
                      </Button>
                      <span className="text-xs text-muted-foreground">{stepIdx + 1} of {STEPS.length}</span>
                      {isLast ? (
                        <Button type="submit" size="sm" disabled={mutation.isPending} className="gap-1.5">
                          {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Create Agent
                        </Button>
                      ) : (
                        <Button type="button" size="sm" onClick={goNext} className="gap-1.5">
                          Next <ChevronRight className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </form>

                  {/* AI Assistant panel */}
                  {showAssistant && (
                    <div className="w-60 border-l border-border flex flex-col shrink-0">
                      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                        <Sparkles size={13} className="text-violet-400" />
                        <p className="text-xs font-medium">Manifest Assistant</p>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <ManifestAssistantPanel
                          availableSkills={availableSkills}
                          availableTools={availableTools}
                          onApply={handleApplyAssistantDraft}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Status ────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  staged: "bg-yellow-500/15 text-yellow-400",
  active: "bg-green-500/15 text-green-400",
  paused: "bg-orange-500/15 text-orange-400",
  archived: "bg-muted text-muted-foreground",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { tenantId } = useTenant();

  // Keep the runtime tenant in sync whenever the workspace tenant selector changes
  useEffect(() => {
    setRuntimeTenant(tenantId);
    qc.invalidateQueries({ queryKey: ["agents"] });
  }, [tenantId, qc]);

  const { data: allAgents, isLoading, isError } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => agentsApi.list(),
  });

  const agents = useMemo(() => {
    return allAgents?.filter((a: AgentRecord) => a.status !== "archived" && a.id?.trim()) ?? [];
  }, [allAgents]);

  const deployMutation = useMutation({
    mutationFn: async (id: string) => {
      await agentsApi.transition(id, { target_state: "staged", actor: "studio-user" });
      return agentsApi.transition(id, { target_state: "active", actor: "studio-user" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => agentsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agents"] }); setDeleteConfirmId(null); },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15">
              <Bot className="h-4 w-4 text-violet-400" />
            </div>
            <h1 className="text-xl font-semibold">Agents</h1>
          </div>
          <p className="text-sm text-muted-foreground">Autonomous agents composed from skills, tools, and safety policies.</p>
        </div>
        <CreateAgentDialog onCreated={() => qc.invalidateQueries({ queryKey: ["agents"] })} />
      </div>

      <Separator className="mb-6" />

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load agents. Is agent-registry running on :8088?
        </div>
      )}

      {!isLoading && !isError && agents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
            <Bot className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No agents yet</p>
          <p className="text-xs text-muted-foreground mt-1">Click <strong>New Agent</strong> to create one.</p>
        </div>
      )}

      {agents.length > 0 && (
        <div className="grid gap-3">
          {agents.map((agent: AgentRecord) => (
            <div key={agent.id} className="catalog-card catalog-card-hover">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Bot className="h-4 w-4 text-violet-400 shrink-0" />
                    <span className="font-semibold text-sm">{agent.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">v{agent.version}</span>
                    <span className={`status-badge ${STATUS_COLORS[agent.status] ?? ""}`}>{agent.status}</span>
                    {agent.tier && TIER_META[agent.tier as AgentTier] && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TIER_META[agent.tier as AgentTier].badge}`}>
                        {TIER_META[agent.tier as AgentTier].icon} {agent.tier}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs mt-1.5 line-clamp-2">{agent.system_prompt}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                    <span className="font-mono text-foreground/70">{agent.model}</span>
                    <span>·</span>
                    <span>{agent.max_iterations} iterations</span>
                    {agent.skills?.length > 0 && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Zap className="h-3 w-3" />{agent.skills.length} skill{agent.skills.length !== 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                    {(agent.mcp_servers ?? []).length > 0 && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Cable className="h-3 w-3" />{agent.mcp_servers!.length} MCP
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {agent.status === "active" && (
                    <Link href={`/agents/${agent.id}/chat`}>
                      <Button size="sm" className="gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5" />Chat
                      </Button>
                    </Link>
                  )}
                  {agent.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => deployMutation.mutate(agent.id)}
                      disabled={deployMutation.isPending && deployMutation.variables === agent.id}>
                      {deployMutation.isPending && deployMutation.variables === agent.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : "Deploy"}
                    </Button>
                  )}
                  <Link href={`/agents/${agent.id}`}>
                    <Button size="sm" variant="ghost">View</Button>
                  </Link>
                  <Button size="sm" variant="outline" onClick={() => setDeleteConfirmId(agent.id)}
                    className="text-destructive border-destructive/30 hover:bg-destructive/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <Sheet open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <SheetContent side="right">
          <SheetHeader><SheetTitle>Delete Agent</SheetTitle></SheetHeader>
          <div className="py-6 space-y-4">
            <p className="text-sm text-muted-foreground">Are you sure? This cannot be undone.</p>
            <div className="flex gap-2 justify-end pt-4">
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
                disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? <><Loader2 className="h-3 w-3 animate-spin mr-2" />Deleting…</> : "Delete"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
