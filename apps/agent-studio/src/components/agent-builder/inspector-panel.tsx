"use client";

import { useState } from "react";
import {
  Bot, Zap, Wrench, Shield, Network, Webhook, Cable,
  CheckCircle2, XCircle, X, ChevronDown, Info,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PRIMITIVE_CONFIG } from "./use-agent-builder";
import type { AgentBuilderState, PrimitiveType, AttachedPrimitive } from "./use-agent-builder";

const TYPE_ICON: Record<PrimitiveType, typeof Zap> = {
  skill:           Zap,
  tool:            Wrench,
  guardrail:       Shield,
  knowledge_graph: Network,
  hook:            Webhook,
  mcp:             Cable,
};

interface Props {
  state: AgentBuilderState;
}

// ── Agent Config Editor ───────────────────────────────────────────────────────

function AgentConfigEditor({ state }: Props) {
  const { agentConfig, setAgentConfig } = state;

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="h-4 w-4 text-violet-400" />
        <span className="text-xs font-semibold text-white/80">Agent Configuration</span>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] uppercase tracking-widest text-white/35">Name</Label>
        <Input
          className="h-8 text-xs border-white/10 bg-white/5 text-white/80"
          value={agentConfig.name}
          onChange={(e) => setAgentConfig({ name: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] uppercase tracking-widest text-white/35">Description</Label>
        <Input
          className="h-8 text-xs border-white/10 bg-white/5 text-white/80"
          placeholder="Brief description…"
          value={agentConfig.description}
          onChange={(e) => setAgentConfig({ description: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] uppercase tracking-widest text-white/35">System Prompt</Label>
        <Textarea
          className="text-xs border-white/10 bg-white/5 text-white/80 resize-none"
          rows={5}
          value={agentConfig.systemPrompt}
          onChange={(e) => setAgentConfig({ systemPrompt: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] uppercase tracking-widest text-white/35">Model</Label>
        <Input
          className="h-8 text-xs border-white/10 bg-white/5 text-white/80 font-mono"
          value={agentConfig.model}
          onChange={(e) => setAgentConfig({ model: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] uppercase tracking-widest text-white/35">Tier</Label>
        <Select
          value={agentConfig.tier}
          onValueChange={(v) => setAgentConfig({ tier: v as "lite" | "workflow" | "deep" })}
        >
          <SelectTrigger className="h-8 text-xs border-white/10 bg-white/5 text-white/80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lite">Lite — Simple, fast, low-cost</SelectItem>
            <SelectItem value="workflow">Workflow — Supervised, step-based</SelectItem>
            <SelectItem value="deep">Deep — Autonomous, long-horizon</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-widest text-white/35">Max Steps</Label>
          <Input
            type="number"
            className="h-8 text-xs border-white/10 bg-white/5 text-white/80"
            value={agentConfig.maxIterations}
            onChange={(e) => setAgentConfig({ maxIterations: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-widest text-white/35">Memory (MB)</Label>
          <Input
            type="number"
            className="h-8 text-xs border-white/10 bg-white/5 text-white/80"
            value={agentConfig.memoryBudgetMb}
            onChange={(e) => setAgentConfig({ memoryBudgetMb: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}

// ── Primitive Detail ──────────────────────────────────────────────────────────

function PrimitiveDetail({
  primitive,
  onRemove,
}: {
  primitive: AttachedPrimitive;
  onRemove: () => void;
}) {
  const cfg = PRIMITIVE_CONFIG[primitive.primitiveType];
  const Icon = TYPE_ICON[primitive.primitiveType] ?? Zap;

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
          style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.color}30` }}
        >
          <Icon className="h-4 w-4" style={{ color: cfg.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-widest font-bold" style={{ color: `${cfg.color}90` }}>
            {cfg.label}
          </div>
          <div className="text-sm font-semibold text-white/85 truncate">{primitive.name}</div>
        </div>
      </div>

      <div
        className="rounded-lg p-3 space-y-2.5"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        {primitive.version && (
          <div className="flex justify-between">
            <span className="text-[11px] text-white/35">Version</span>
            <span className="text-[11px] text-white/65 font-mono">v{primitive.version}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-[11px] text-white/35">Type</span>
          <span className="text-[11px]" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[11px] text-white/35">ID</span>
          <span className="text-[11px] text-white/40 font-mono truncate max-w-[130px]">{primitive.id}</span>
        </div>
      </div>

      {primitive.description && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-white/30">Description</div>
          <p className="text-[11px] text-white/50 leading-relaxed">{primitive.description}</p>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="w-full h-8 text-xs border text-red-400 border-red-500/20 hover:bg-red-500/10 hover:text-red-300"
        onClick={onRemove}
      >
        <X className="h-3 w-3 mr-1.5" />
        Detach from Agent
      </Button>
    </div>
  );
}

// ── Capability Profile ─────────────────────────────────────────────────────────

function CapabilityProfile({ state }: Props) {
  const { capabilityNarrative, costEstimate, agentConfig } = state;
  const [open, setOpen] = useState(true);

  const riskLevel =
    capabilityNarrative.can.length > 5
      ? { label: "High", color: "#EF4444" }
      : capabilityNarrative.can.length > 2
      ? { label: "Medium", color: "#F59E0B" }
      : { label: "Low", color: "#10B981" };

  return (
    <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <button
        className="flex w-full items-center gap-2 px-4 py-3 hover:bg-white/5 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <Info className="h-3.5 w-3.5 text-white/30" />
        <span className="flex-1 text-left text-[10px] uppercase tracking-widest text-white/35 font-semibold">
          Capability Profile
        </span>
        <ChevronDown
          className="h-3 w-3 text-white/25 transition-transform"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {capabilityNarrative.can.length > 0 && (
            <div>
              <div className="text-[10px] text-white/30 mb-1.5">Can do:</div>
              <div className="space-y-1">
                {capabilityNarrative.can.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-white/60">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {capabilityNarrative.protects.length > 0 && (
            <div>
              <div className="text-[10px] text-white/30 mb-1.5">Safety:</div>
              <div className="space-y-1">
                {capabilityNarrative.protects.map((p, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <Shield className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-white/60">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {capabilityNarrative.knows.length > 0 && (
            <div>
              <div className="text-[10px] text-white/30 mb-1.5">Grounded in:</div>
              <div className="space-y-1">
                {capabilityNarrative.knows.map((k, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <Network className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-white/60">{k}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {capabilityNarrative.cannot.length > 0 && (
            <div>
              <div className="text-[10px] text-white/30 mb-1.5">Gaps:</div>
              <div className="space-y-1">
                {capabilityNarrative.cannot.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <XCircle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-amber-400/70">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className="rounded-lg p-3 space-y-2 mt-1"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex justify-between text-[11px]">
              <span className="text-white/35">Est. cost / run</span>
              <span className="text-white/70 font-mono">${costEstimate}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-white/35">Tier</span>
              <span className="text-white/70 capitalize">{agentConfig.tier}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-white/35">Risk level</span>
              <span className="font-semibold" style={{ color: riskLevel.color }}>{riskLevel.label}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyInspector() {
  return (
    <div className="flex flex-col items-center justify-center h-40 px-6 text-center">
      <Bot className="h-8 w-8 text-white/10 mb-3" />
      <p className="text-xs text-white/25 leading-relaxed">
        Click a primitive chip to inspect it, or edit agent settings below.
      </p>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function InspectorPanel({ state }: Props) {
  const { selectedPrimitive, removePrimitive, setSelectedPrimitive } = state;

  return (
    <div
      className="flex flex-col h-full border-l overflow-y-auto"
      style={{
        width: 300,
        minWidth: 300,
        background: "rgba(8,8,14,0.97)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      {/* Panel title */}
      <div
        className="px-4 pt-4 pb-3 border-b shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <div className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">
          Inspector
        </div>
      </div>

      {/* Selected primitive detail */}
      {selectedPrimitive ? (
        <PrimitiveDetail
          primitive={selectedPrimitive}
          onRemove={() => {
            removePrimitive(selectedPrimitive.id, selectedPrimitive.primitiveType);
            setSelectedPrimitive(null);
          }}
        />
      ) : (
        <EmptyInspector />
      )}

      {/* Always-visible divider */}
      <div className="border-t mx-4" style={{ borderColor: "rgba(255,255,255,0.06)" }} />

      {/* Agent Config Editor — always accessible */}
      <AgentConfigEditor state={state} />

      {/* Capability Profile — always visible */}
      <CapabilityProfile state={state} />
    </div>
  );
}
