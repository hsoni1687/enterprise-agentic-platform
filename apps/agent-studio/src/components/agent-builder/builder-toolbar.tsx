"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bot, Loader2, CheckCircle2, AlertTriangle, ArrowLeft,
  FlaskConical, Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AgentBuilderState } from "./use-agent-builder";

interface Props {
  state: AgentBuilderState;
}

export function BuilderToolbar({ state }: Props) {
  const {
    agentConfig,
    setAgentConfig,
    deploy,
    isDeploying,
    deployError,
    deployedAgentId,
    attached,
  } = state;

  const [nameEditing, setNameEditing] = useState(false);
  const [localName, setLocalName] = useState(agentConfig.name);

  const commitName = () => {
    setAgentConfig({ name: localName || "New Agent" });
    setNameEditing(false);
  };

  const isReady = agentConfig.systemPrompt.length >= 10 && agentConfig.name.length > 0;

  return (
    <div
      className="flex items-center gap-3 px-4 h-12 border-b shrink-0"
      style={{
        background: "rgba(8,8,14,0.98)",
        borderColor: "rgba(255,255,255,0.07)",
      }}
    >
      {/* Back */}
      <Link href="/agents">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-white/30 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </Link>

      <Separator orientation="vertical" className="h-4 bg-white/10" />

      {/* Icon */}
      <div
        className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
        style={{ background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.3)" }}
      >
        <Bot className="h-4 w-4 text-violet-400" />
      </div>

      {/* Agent Name */}
      {nameEditing ? (
        <Input
          autoFocus
          className="h-7 w-48 text-sm border-violet-500/40 bg-white/5 text-white/90 font-medium"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") {
              setLocalName(agentConfig.name);
              setNameEditing(false);
            }
          }}
        />
      ) : (
        <button
          className="text-sm font-semibold text-white/80 hover:text-white transition-colors truncate max-w-48"
          onClick={() => {
            setLocalName(agentConfig.name);
            setNameEditing(true);
          }}
          title="Click to rename"
        >
          {agentConfig.name}
        </button>
      )}

      {/* Experimental badge */}
      <Badge
        className="gap-1 text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 shrink-0"
        style={{
          background: "rgba(245,158,11,0.12)",
          border: "1px solid rgba(245,158,11,0.25)",
          color: "#F59E0B",
        }}
      >
        <FlaskConical className="h-2.5 w-2.5" />
        Experimental
      </Badge>

      {/* Primitive count chip */}
      {attached.length > 0 && (
        <div
          className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
          style={{
            background: "rgba(139,92,246,0.12)",
            border: "1px solid rgba(139,92,246,0.2)",
            color: "#a78bfa",
          }}
        >
          {attached.length} attached
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Deploy status */}
      {deployedAgentId && (
        <div className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Deployed</span>
          <Link
            href={`/agents/${deployedAgentId}`}
            className="text-xs underline underline-offset-2 hover:text-emerald-300"
          >
            View agent →
          </Link>
        </div>
      )}

      {deployError && (
        <div className="flex items-center gap-1.5 text-red-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="text-xs truncate max-w-[200px]">{deployError}</span>
        </div>
      )}

      {/* Deploy button */}
      <Button
        size="sm"
        className="h-8 gap-2 text-xs font-semibold shrink-0"
        style={{
          background: isReady
            ? "linear-gradient(135deg, #7C3AED, #4F46E5)"
            : "rgba(255,255,255,0.05)",
          border: isReady ? "none" : "1px solid rgba(255,255,255,0.1)",
          color: isReady ? "#fff" : "rgba(255,255,255,0.3)",
          boxShadow: isReady ? "0 0 20px rgba(124,58,237,0.35)" : "none",
          cursor: isReady && !isDeploying ? "pointer" : "not-allowed",
        }}
        disabled={!isReady || isDeploying}
        onClick={deploy}
        title={!isReady ? "Add a name and system prompt first" : "Deploy this agent"}
      >
        {isDeploying ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Deploying…
          </>
        ) : (
          <>
            <Rocket className="h-3.5 w-3.5" />
            Deploy Agent
          </>
        )}
      </Button>
    </div>
  );
}
