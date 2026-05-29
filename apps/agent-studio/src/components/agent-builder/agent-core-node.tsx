"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Bot, Cpu, Layers } from "lucide-react";
import type { AgentTier } from "@/lib/types";
import type { PrimitiveType } from "./use-agent-builder";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentCoreData {
  name: string;
  systemPrompt: string;
  model: string;
  tier: AgentTier;
  maxIterations: number;
  memoryBudgetMb: number;
  description: string;
}

interface AgentCoreNodeProps {
  data: AgentCoreData;
  selected?: boolean;
}

// ── Capability ring config ────────────────────────────────────────────────────

const RINGS: Array<{ type: PrimitiveType; label: string; color: string }> = [
  { type: "skill",          label: "Skills",      color: "#8B5CF6" },
  { type: "tool",           label: "Tools",       color: "#3B82F6" },
  { type: "guardrail",      label: "Guardrails",  color: "#EF4444" },
  { type: "knowledge_graph",label: "Knowledge",   color: "#10B981" },
  { type: "hook",           label: "Hooks",       color: "#F59E0B" },
  { type: "mcp",            label: "MCP",         color: "#06B6D4" },
];

const TIER_LABEL: Record<AgentTier, { label: string; color: string }> = {
  deep: { label: "Agent", color: "#8B5CF6" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export const AgentCoreNode = memo(function AgentCoreNode({
  data,
  selected,
}: AgentCoreNodeProps) {
  const tier = TIER_LABEL["deep"];
  const modelShort = data.model?.split("/").pop() ?? data.model ?? "—";

  return (
    <div
      className="relative rounded-xl border transition-all duration-300"
      style={{
        width: 280,
        background: "linear-gradient(135deg, rgba(15,15,25,0.97) 0%, rgba(20,15,35,0.97) 100%)",
        borderColor: selected ? "rgba(139,92,246,0.8)" : "rgba(139,92,246,0.35)",
        boxShadow: selected
          ? "0 0 0 1px rgba(139,92,246,0.5), 0 0 32px rgba(139,92,246,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
          : "0 0 20px rgba(139,92,246,0.12), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* Connection handle — incoming from primitives */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "rgba(139,92,246,0.6)", border: "1px solid rgba(139,92,246,0.4)", width: 10, height: 10 }}
      />

      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-white/5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.3)" }}
        >
          <Bot className="h-5 w-5" style={{ color: "#8B5CF6" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{data.name || "New Agent"}</div>
          <div className="text-[10px] text-white/40 truncate">{data.description || "No description"}</div>
        </div>
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest shrink-0"
          style={{ color: tier.color, background: `${tier.color}18`, border: `1px solid ${tier.color}30` }}
        >
          {tier.label}
        </span>
      </div>

      {/* Model + Iterations Row */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <Cpu className="h-3 w-3 text-white/30" />
          <span className="text-[11px] text-white/50 font-mono">{modelShort}</span>
        </div>
        <div className="h-3 w-px bg-white/10" />
        <div className="flex items-center gap-1.5">
          <Layers className="h-3 w-3 text-white/30" />
          <span className="text-[11px] text-white/50">{data.maxIterations} steps</span>
        </div>
      </div>

      {/* System Prompt Preview */}
      <div className="px-4 py-2.5 border-b border-white/5">
        <div className="text-[9px] uppercase tracking-widest text-white/25 mb-1">System Prompt</div>
        <div className="text-[11px] text-white/55 line-clamp-2 leading-relaxed font-mono">
          {data.systemPrompt || "—"}
        </div>
      </div>

      {/* Capability Rings */}
      <div className="px-4 py-3">
        <div className="text-[9px] uppercase tracking-widest text-white/25 mb-2.5">Capability Layers</div>
        <div className="space-y-1.5">
          {RINGS.map(({ label, color }) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-[60px] shrink-0 text-[10px] text-white/35">{label}</div>
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: "0%",
                    background: `linear-gradient(90deg, ${color}80, ${color})`,
                    boxShadow: `0 0 6px ${color}60`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pulse ring when selected */}
      {selected && (
        <div
          className="absolute inset-0 rounded-xl pointer-events-none animate-pulse"
          style={{ boxShadow: "0 0 0 2px rgba(139,92,246,0.3)" }}
        />
      )}
    </div>
  );
});
