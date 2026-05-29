"use client";

import { useState, useCallback } from "react";
import {
  Bot, Cpu, Layers, Zap, Wrench, Shield, Network,
  Webhook, Cable, Plus, AlertTriangle, ChevronDown,
} from "lucide-react";
import { PrimitiveChip } from "./primitive-chip";
import { PRIMITIVE_CONFIG, dragTracker } from "./use-agent-builder";
import type { PrimitiveType, DragPrimitive, AgentBuilderState, AttachedPrimitive } from "./use-agent-builder";

// ── Section definitions ───────────────────────────────────────────────────────

interface SectionDef {
  type: PrimitiveType;
  icon: typeof Zap;
  hint: string;
}

const SECTIONS: SectionDef[] = [
  {
    type: "skill",
    icon: Zap,
    hint: "Drag skills here — composable behaviors the agent can invoke",
  },
  {
    type: "tool",
    icon: Wrench,
    hint: "Drag tools here — APIs and executors the agent can call",
  },
  {
    type: "guardrail",
    icon: Shield,
    hint: "Drag guardrails here — safety policies enforced on every response",
  },
  {
    type: "knowledge_graph",
    icon: Network,
    hint: "Drag knowledge graphs here — domain data the agent can query",
  },
  {
    type: "hook",
    icon: Webhook,
    hint: "Drag hooks here — audit, cost metering, or human-in-the-loop intercepts",
  },
  {
    type: "mcp",
    icon: Cable,
    hint: "Drag MCP servers here — external capability providers",
  },
];

// ── Tier meta ─────────────────────────────────────────────────────────────────

const TIER_META = {
  lite:     { color: "#6B7280", label: "LITE",     desc: "Simple · Fast · Low-cost" },
  workflow: { color: "#F59E0B", label: "WORKFLOW",  desc: "Supervised · Step-based" },
  deep:     { color: "#8B5CF6", label: "DEEP",      desc: "Autonomous · Long-horizon" },
};

// ── Agent Identity Card ───────────────────────────────────────────────────────

function AgentIdentityCard({
  state,
}: {
  state: AgentBuilderState;
}) {
  const { agentConfig, warnings } = state;
  const tier = TIER_META[agentConfig.tier] ?? TIER_META.workflow;
  const modelShort = agentConfig.model?.split("/").pop() ?? agentConfig.model ?? "—";
  const [promptExpanded, setPromptExpanded] = useState(false);

  return (
    <div
      className="rounded-xl border mb-3 shrink-0"
      style={{
        background: "linear-gradient(135deg, rgba(18,10,40,0.95) 0%, rgba(12,12,24,0.95) 100%)",
        borderColor: "rgba(139,92,246,0.3)",
        boxShadow: "0 0 40px rgba(139,92,246,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "rgba(139,92,246,0.2)",
            border: "1px solid rgba(139,92,246,0.35)",
            boxShadow: "0 0 16px rgba(139,92,246,0.2)",
          }}
        >
          <Bot className="h-5 w-5 text-violet-400" />
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-white leading-tight truncate">
            {agentConfig.name || "New Agent"}
          </h2>
          <p className="text-xs text-white/35 truncate mt-0.5">
            {agentConfig.description || "No description — edit in Inspector →"}
          </p>
        </div>

        <div
          className="shrink-0 px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest"
          style={{
            color: tier.color,
            background: `${tier.color}15`,
            border: `1px solid ${tier.color}30`,
          }}
        >
          {tier.label}
        </div>
      </div>

      {/* Stats row */}
      <div
        className="flex items-center gap-0 border-t border-b px-5 py-2.5"
        style={{ borderColor: "rgba(255,255,255,0.05)" }}
      >
        <div className="flex items-center gap-2 text-xs text-white/40 flex-1">
          <Cpu className="h-3.5 w-3.5 text-white/25" />
          <span className="font-mono">{modelShort}</span>
        </div>
        <div className="h-4 w-px bg-white/10 mx-4" />
        <div className="flex items-center gap-2 text-xs text-white/40 flex-1">
          <Layers className="h-3.5 w-3.5 text-white/25" />
          <span>{agentConfig.maxIterations} steps max</span>
        </div>
        <div className="h-4 w-px bg-white/10 mx-4" />
        <div className="flex items-center gap-2 text-xs text-white/40 flex-1">
          <span className="text-white/25">Mem</span>
          <span>{agentConfig.memoryBudgetMb} MB</span>
        </div>
        <div className="h-4 w-px bg-white/10 mx-4" />
        <div className="text-xs text-white/25 italic">{tier.desc}</div>
      </div>

      {/* System prompt (collapsible) */}
      <button
        className="w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setPromptExpanded((o) => !o)}
      >
        <span className="text-[10px] uppercase tracking-widest text-white/25 font-semibold mt-0.5 shrink-0 w-[100px]">
          System Prompt
        </span>
        <span
          className={`flex-1 text-xs text-white/50 leading-relaxed font-mono ${
            promptExpanded ? "" : "line-clamp-2"
          }`}
        >
          {agentConfig.systemPrompt || "—"}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 text-white/20 shrink-0 mt-0.5 transition-transform"
          style={{ transform: promptExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div
          className="mx-4 mb-4 rounded-lg px-3 py-2 flex flex-col gap-1"
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.2)",
          }}
        >
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-amber-400/80">{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drop Section ───────────────────────────────────────────────────────────────

interface DropSectionProps {
  def: SectionDef;
  items: AttachedPrimitive[];
  selectedPrimitive: AttachedPrimitive | null;
  onDrop: (primitive: DragPrimitive) => void;
  onRemove: (id: string, type: PrimitiveType) => void;
  onSelect: (p: AttachedPrimitive) => void;
}

function DropSection({
  def,
  items,
  selectedPrimitive,
  onDrop,
  onRemove,
  onSelect,
}: DropSectionProps) {
  const [dragOver, setDragOver] = useState(false);
  const cfg = PRIMITIVE_CONFIG[def.type];
  const Icon = def.icon;
  const isMatch = () => dragTracker.get() === def.type;

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (isMatch()) setDragOver(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def.type]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (isMatch()) {
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      } else {
        e.dataTransfer.dropEffect = "none";
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def.type]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when truly leaving the section (not a child element)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) return;
      try {
        const primitive: DragPrimitive = JSON.parse(raw);
        if (primitive.primitiveType === def.type) onDrop(primitive);
      } catch {
        // ignore malformed drop
      }
    },
    [def.type, onDrop]
  );

  const isEmpty = items.length === 0;

  return (
    <div
      className="rounded-xl border transition-all duration-200 overflow-hidden"
      style={{
        borderColor: dragOver ? cfg.color : "rgba(255,255,255,0.07)",
        background: dragOver
          ? `linear-gradient(135deg, ${cfg.bgColor}, rgba(12,12,22,0.98))`
          : "rgba(12,12,22,0.7)",
        boxShadow: dragOver
          ? `0 0 0 1px ${cfg.color}40, 0 0 30px ${cfg.color}15, inset 0 0 30px ${cfg.color}05`
          : "none",
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Section header */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{
          borderBottom: `1px solid ${dragOver ? `${cfg.color}25` : "rgba(255,255,255,0.05)"}`,
        }}
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded transition-all"
          style={{
            background: dragOver ? `${cfg.color}25` : `${cfg.color}12`,
            border: `1px solid ${dragOver ? `${cfg.color}50` : `${cfg.color}20`}`,
          }}
        >
          <Icon className="h-3.5 w-3.5 transition-all" style={{ color: dragOver ? cfg.color : `${cfg.color}80` }} />
        </div>

        <span
          className="flex-1 text-[11px] font-bold uppercase tracking-widest transition-colors"
          style={{ color: dragOver ? cfg.color : `${cfg.color}70` }}
        >
          {cfg.label}
        </span>

        {items.length > 0 && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-bold"
            style={{
              background: `${cfg.color}15`,
              color: cfg.color,
              border: `1px solid ${cfg.color}25`,
            }}
          >
            {items.length}
          </span>
        )}

        <div
          className="flex items-center gap-1 text-[10px] transition-colors"
          style={{ color: dragOver ? `${cfg.color}90` : "rgba(255,255,255,0.15)" }}
        >
          <Plus className="h-3 w-3" />
          <span>{dragOver ? "Release to add" : "Drag here"}</span>
        </div>
      </div>

      {/* Content area */}
      <div className="p-3">
        {isEmpty ? (
          /* Empty drop target */
          <div
            className="rounded-lg px-4 py-4 text-center transition-all duration-200"
            style={{
              border: `1.5px dashed ${dragOver ? cfg.color : `${cfg.color}20`}`,
              background: dragOver ? `${cfg.color}06` : "transparent",
            }}
          >
            <p className="text-xs leading-relaxed transition-colors" style={{ color: dragOver ? `${cfg.color}90` : "rgba(255,255,255,0.18)" }}>
              {dragOver ? `Drop to attach ${cfg.label.toLowerCase()}` : def.hint}
            </p>
          </div>
        ) : (
          /* Chips grid */
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <PrimitiveChip
                key={`${item.primitiveType}-${item.id}`}
                primitive={item}
                selected={
                  selectedPrimitive?.id === item.id &&
                  selectedPrimitive?.primitiveType === item.primitiveType
                }
                onRemove={() => onRemove(item.id, item.primitiveType)}
                onClick={() => onSelect(item)}
              />
            ))}

            {/* Ghost drop slot when section already has items */}
            <div
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-[11px] transition-all duration-150"
              style={{
                borderColor: dragOver ? cfg.color : "rgba(255,255,255,0.08)",
                color: dragOver ? cfg.color : "rgba(255,255,255,0.2)",
                background: dragOver ? `${cfg.color}08` : "transparent",
              }}
            >
              <Plus className="h-3 w-3" />
              {dragOver ? "Release to add" : "Drop more"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent Workbench ───────────────────────────────────────────────────────────

interface Props {
  state: AgentBuilderState;
}

export function AgentWorkbench({ state }: Props) {
  const { attached, addPrimitive, removePrimitive, byType, selectedPrimitive, setSelectedPrimitive } = state;

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-5 space-y-3 scrollbar-thin"
      style={{ background: "rgba(6,6,11,1)" }}
    >
      {/* Agent identity at the top */}
      <AgentIdentityCard state={state} />

      {/* Drop sections */}
      {SECTIONS.map((def) => (
        <DropSection
          key={def.type}
          def={def}
          items={byType(def.type)}
          selectedPrimitive={selectedPrimitive}
          onDrop={addPrimitive}
          onRemove={removePrimitive}
          onSelect={setSelectedPrimitive}
        />
      ))}

      {/* Footer breathing room */}
      <div className="h-4" />
    </div>
  );
}
