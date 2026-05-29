"use client";

import { useState } from "react";
import { Code2, Zap, Wrench, Shield, Network, Webhook, Cable, X, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRIMITIVE_CONFIG } from "./use-agent-builder";
import type { AgentBuilderState } from "./use-agent-builder";

interface Props {
  state: AgentBuilderState;
}

const STAT_ICONS = {
  skill:          { icon: Zap,     color: "#8B5CF6" },
  tool:           { icon: Wrench,  color: "#3B82F6" },
  guardrail:      { icon: Shield,  color: "#EF4444" },
  knowledge_graph:{ icon: Network, color: "#10B981" },
  hook:           { icon: Webhook, color: "#F59E0B" },
  mcp:            { icon: Cable,   color: "#06B6D4" },
};

export function ManifestPreviewBar({ state }: Props) {
  const {
    attached,
    manifest,
    costEstimate,
    isJsonPreviewOpen,
    setIsJsonPreviewOpen,
    agentConfig,
  } = state;

  const [copied, setCopied] = useState(false);

  const counts = Object.fromEntries(
    Object.keys(STAT_ICONS).map((type) => [
      type,
      attached.filter((a) => a.primitiveType === type).length,
    ])
  );

  const totalPrimitives = attached.length;

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const autonomyColor =
    agentConfig.tier === "deep"
      ? "#8B5CF6"
      : agentConfig.tier === "workflow"
      ? "#F59E0B"
      : "#6B7280";

  return (
    <div
      className="shrink-0 border-t"
      style={{
        background: "rgba(6,6,12,0.98)",
        borderColor: "rgba(255,255,255,0.07)",
      }}
    >
      {/* JSON Preview Drawer */}
      {isJsonPreviewOpen && (
        <div
          className="border-b overflow-hidden"
          style={{
            maxHeight: 280,
            borderColor: "rgba(255,255,255,0.07)",
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-2 border-b"
            style={{ borderColor: "rgba(255,255,255,0.05)" }}
          >
            <div className="flex items-center gap-2">
              <Code2 className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-[11px] text-white/50 font-semibold">Live Manifest JSON</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-white/40 hover:text-white"
                onClick={copyJson}
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-white/30 hover:text-white"
                onClick={() => setIsJsonPreviewOpen(false)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <pre
            className="overflow-y-auto px-4 py-3 text-[11px] leading-relaxed font-mono scrollbar-thin"
            style={{
              maxHeight: 232,
              color: "#a5b4fc",
              background: "rgba(0,0,0,0.3)",
            }}
          >
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </div>
      )}

      {/* Stats Bar */}
      <div className="flex items-center gap-4 px-4 h-11">
        {/* Primitive counts */}
        <div className="flex items-center gap-3">
          {(Object.entries(STAT_ICONS) as Array<[keyof typeof STAT_ICONS, typeof STAT_ICONS[keyof typeof STAT_ICONS]]>).map(
            ([type, { icon: Icon, color }]) => {
              const count = counts[type] ?? 0;
              if (count === 0) return null;
              return (
                <div key={type} className="flex items-center gap-1">
                  <Icon className="h-3 w-3" style={{ color }} />
                  <span className="text-[11px] text-white/50 tabular-nums">{count}</span>
                </div>
              );
            }
          )}
          {totalPrimitives === 0 && (
            <span className="text-[11px] text-white/25 italic">No primitives attached</span>
          )}
        </div>

        <div className="h-4 w-px bg-white/8" />

        {/* Autonomy */}
        <div className="flex items-center gap-1.5">
          <div
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: autonomyColor, boxShadow: `0 0 4px ${autonomyColor}` }}
          />
          <span className="text-[11px] text-white/40 capitalize">{agentConfig.tier} tier</span>
        </div>

        {/* Cost */}
        <div className="text-[11px] text-white/40">
          Est.{" "}
          <span className="text-white/60 font-mono">${costEstimate}</span>
          <span className="text-white/25">/run</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* JSON Toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-[11px] text-white/40 hover:text-white/70 px-2.5"
          onClick={() => setIsJsonPreviewOpen((o) => !o)}
        >
          <Code2 className="h-3 w-3" />
          {isJsonPreviewOpen ? "Hide JSON" : "View JSON"}
          <ChevronUp
            className="h-3 w-3 transition-transform"
            style={{ transform: isJsonPreviewOpen ? "rotate(0deg)" : "rotate(180deg)" }}
          />
        </Button>
      </div>
    </div>
  );
}
