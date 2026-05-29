"use client";

import { memo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { Zap, Wrench, Shield, Network, Webhook, Cable, X } from "lucide-react";
import { PRIMITIVE_CONFIG, type PrimitiveType } from "./use-agent-builder";

// ── Icons per type ────────────────────────────────────────────────────────────

const TYPE_ICON: Record<PrimitiveType, typeof Zap> = {
  skill:          Zap,
  tool:           Wrench,
  guardrail:      Shield,
  knowledge_graph: Network,
  hook:           Webhook,
  mcp:            Cable,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface PrimitiveNodeData {
  id: string;
  name: string;
  version?: string;
  description?: string;
  primitiveType: PrimitiveType;
  nodeId: string;
  onRemove?: (nodeId: string) => void;
}

interface PrimitiveNodeProps {
  id: string;
  data: PrimitiveNodeData;
  selected?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const PrimitiveNode = memo(function PrimitiveNode({
  id,
  data,
  selected,
}: PrimitiveNodeProps) {
  const [hovered, setHovered] = useState(false);
  const cfg = PRIMITIVE_CONFIG[data.primitiveType];
  const Icon = TYPE_ICON[data.primitiveType] ?? Zap;

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.onRemove) data.onRemove(id);
  };

  return (
    <div
      className="relative rounded-lg border transition-all duration-200 cursor-pointer"
      style={{
        width: 180,
        background: `linear-gradient(135deg, rgba(10,10,18,0.96) 0%, ${cfg.bgColor} 100%)`,
        borderColor: selected ? cfg.color : hovered ? `${cfg.color}80` : cfg.borderColor,
        boxShadow: selected
          ? `0 0 0 1px ${cfg.color}50, 0 0 20px ${cfg.color}25`
          : hovered
          ? `0 0 14px ${cfg.color}20`
          : `0 0 8px ${cfg.color}10`,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Source handle — connects to Agent Core */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: cfg.color,
          border: `1px solid ${cfg.color}80`,
          width: 8,
          height: 8,
        }}
      />

      <div className="flex items-start gap-2.5 p-3">
        {/* Icon */}
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md mt-0.5"
          style={{
            background: `${cfg.color}18`,
            border: `1px solid ${cfg.color}30`,
          }}
        >
          <Icon className="h-4 w-4" style={{ color: cfg.color }} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div
            className="text-[9px] uppercase tracking-widest font-bold mb-0.5"
            style={{ color: `${cfg.color}90` }}
          >
            {cfg.label}
          </div>
          <div className="text-xs font-medium text-white/85 truncate">{data.name}</div>
          {data.version && (
            <div className="text-[10px] text-white/30 font-mono">v{data.version}</div>
          )}
        </div>

        {/* Remove button */}
        {hovered && (
          <button
            className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full transition-colors"
            style={{
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#EF4444",
            }}
            onClick={handleRemove}
            title="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Description tooltip row */}
      {data.description && hovered && (
        <div className="px-3 pb-2.5">
          <div
            className="text-[10px] text-white/40 line-clamp-2 leading-relaxed border-t pt-2"
            style={{ borderColor: `${cfg.color}15` }}
          >
            {data.description}
          </div>
        </div>
      )}

      {/* Active glow dot */}
      <div
        className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full"
        style={{
          background: cfg.color,
          boxShadow: `0 0 6px ${cfg.color}`,
        }}
      />
    </div>
  );
});
