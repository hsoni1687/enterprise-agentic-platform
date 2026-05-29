"use client";

import { useState } from "react";
import { Zap, Wrench, Shield, Network, Webhook, Cable, X } from "lucide-react";
import { PRIMITIVE_CONFIG } from "./use-agent-builder";
import type { AttachedPrimitive, PrimitiveType } from "./use-agent-builder";

const TYPE_ICON: Record<PrimitiveType, typeof Zap> = {
  skill:           Zap,
  tool:            Wrench,
  guardrail:       Shield,
  knowledge_graph: Network,
  hook:            Webhook,
  mcp:             Cable,
};

interface Props {
  primitive: AttachedPrimitive;
  onRemove: () => void;
  onClick?: () => void;
  selected?: boolean;
}

export function PrimitiveChip({ primitive, onRemove, onClick, selected }: Props) {
  const [hovered, setHovered] = useState(false);
  const cfg = PRIMITIVE_CONFIG[primitive.primitiveType];
  const Icon = TYPE_ICON[primitive.primitiveType] ?? Zap;

  return (
    <div
      className="group inline-flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-all duration-150 select-none"
      style={{
        background: selected ? cfg.bgColor : hovered ? `${cfg.color}0d` : "rgba(255,255,255,0.03)",
        borderColor: selected
          ? cfg.color
          : hovered
          ? `${cfg.color}50`
          : "rgba(255,255,255,0.08)",
        boxShadow: selected ? `0 0 12px ${cfg.color}20` : "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
        style={{ background: `${cfg.color}18` }}
      >
        <Icon className="h-3 w-3" style={{ color: cfg.color }} />
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-white/80 truncate block">{primitive.name}</span>
        {primitive.version && (
          <span className="text-[10px] text-white/25 font-mono">v{primitive.version}</span>
        )}
      </div>

      <button
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: "rgba(239,68,68,0.15)", color: "#EF4444" }}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
