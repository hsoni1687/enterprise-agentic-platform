"use client";

import { useState, useMemo, useCallback } from "react";
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import { agentsApi } from "@/lib/api";
import type { AgentTier } from "@/lib/types";
import { TIER_DEFAULTS, TIER_AUTONOMY } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

export const AGENT_CORE_NODE_ID = "agent-core";

// ── Primitive Types ───────────────────────────────────────────────────────────

export type PrimitiveType =
  | "skill"
  | "tool"
  | "guardrail"
  | "knowledge_graph"
  | "hook"
  | "mcp";

export interface DragPrimitive {
  id: string;
  name: string;
  version?: string;
  description?: string;
  primitiveType: PrimitiveType;
  metadata?: Record<string, unknown>;
}

export interface AttachedPrimitive extends DragPrimitive {
  attachedAt: number;
}

// ── Module-level drag tracker (safe for browser, avoids dataTransfer restrictions) ──

let _dragType: PrimitiveType | null = null;
export const dragTracker = {
  set: (type: PrimitiveType | null) => {
    _dragType = type;
  },
  get: () => _dragType,
};

// ── Visual Config per Primitive Type ─────────────────────────────────────────

export const PRIMITIVE_CONFIG: Record<
  PrimitiveType,
  { color: string; bgColor: string; borderColor: string; label: string }
> = {
  skill: {
    color: "#8B5CF6",
    bgColor: "rgba(139,92,246,0.10)",
    borderColor: "rgba(139,92,246,0.4)",
    label: "Skills",
  },
  tool: {
    color: "#3B82F6",
    bgColor: "rgba(59,130,246,0.10)",
    borderColor: "rgba(59,130,246,0.4)",
    label: "Tools",
  },
  guardrail: {
    color: "#EF4444",
    bgColor: "rgba(239,68,68,0.10)",
    borderColor: "rgba(239,68,68,0.4)",
    label: "Guardrails",
  },
  knowledge_graph: {
    color: "#10B981",
    bgColor: "rgba(16,185,129,0.10)",
    borderColor: "rgba(16,185,129,0.4)",
    label: "Knowledge Graphs",
  },
  hook: {
    color: "#F59E0B",
    bgColor: "rgba(245,158,11,0.10)",
    borderColor: "rgba(245,158,11,0.4)",
    label: "Hooks",
  },
  mcp: {
    color: "#06B6D4",
    bgColor: "rgba(6,182,212,0.10)",
    borderColor: "rgba(6,182,212,0.4)",
    label: "MCP Servers",
  },
};

// ── Agent Core Config ─────────────────────────────────────────────────────────

export interface AgentCoreConfig {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  tier: AgentTier;
  maxIterations: number;
  memoryBudgetMb: number;
}

const INITIAL_CONFIG: AgentCoreConfig = {
  name: "New Agent",
  description: "",
  systemPrompt: "You are a helpful enterprise assistant.",
  model: "claude-sonnet-4-5",
  tier: "deep",
  maxIterations: 100,
  memoryBudgetMb: 512,
};

// ── Initial ReactFlow node (the always-present agent core) ────────────────────

const INITIAL_CORE_NODE: Node = {
  id: AGENT_CORE_NODE_ID,
  type: "agentCore",
  position: { x: 300, y: 180 },
  data: {},
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAgentBuilder() {
  const [agentConfig, setAgentConfigState] = useState<AgentCoreConfig>(INITIAL_CONFIG);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isJsonPreviewOpen, setIsJsonPreviewOpen] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployedAgentId, setDeployedAgentId] = useState<string | null>(null);

  const setAgentConfig = useCallback((partial: Partial<AgentCoreConfig>) => {
    setAgentConfigState((prev) => ({ ...prev, ...partial }));
  }, []);

  // ── ReactFlow node / edge state ───────────────────────────────────────────
  // _nodes tracks positions (ReactFlow source of truth).
  // `nodes` (exported) merges live agentConfig into the core node so
  // AgentCoreNode always renders current values.
  // `attached` is derived from primitive nodes for manifest computation.

  const [_nodes, setNodes, onNodesChange] = useNodesState<Node>([INITIAL_CORE_NODE]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Inject current agentConfig into the core node's data on every render.
  const nodes: Node[] = useMemo(
    () =>
      _nodes.map((n) =>
        n.id === AGENT_CORE_NODE_ID
          ? {
              ...n,
              data: {
                name:           agentConfig.name,
                description:    agentConfig.description,
                systemPrompt:   agentConfig.systemPrompt,
                model:          agentConfig.model,
                tier:           agentConfig.tier,
                maxIterations:  agentConfig.maxIterations,
                memoryBudgetMb: agentConfig.memoryBudgetMb,
              },
            }
          : n
      ),
    [_nodes, agentConfig]
  );

  // ── Derive `attached` from primitive nodes (keeps manifest in sync) ───────

  const attached: AttachedPrimitive[] = useMemo(
    () =>
      _nodes
        .filter((n) => n.type === "primitive" && n.data)
        .map((n) => (n.data as unknown) as AttachedPrimitive),
    [_nodes]
  );

  // ── Primitive actions ─────────────────────────────────────────────────────

  const addPrimitive = useCallback(
    (primitive: DragPrimitive, position?: { x: number; y: number }) => {
      const nodeId = `${primitive.primitiveType}__${primitive.id}`;
      const edgeId = `e-${nodeId}-${AGENT_CORE_NODE_ID}`;
      const cfg = PRIMITIVE_CONFIG[primitive.primitiveType];

      setNodes((prev) => {
        if (prev.some((n) => n.id === nodeId)) return prev; // deduplicate
        const newNode: Node = {
          id: nodeId,
          type: "primitive",
          // If no drop position given, fan-out to the right of the core node
          position: position ?? {
            x: 600 + Math.random() * 60,
            y: 60 + (prev.length - 1) * 90,
          },
          data: ({ ...primitive, attachedAt: Date.now() } as unknown) as Record<string, unknown>,
        };
        return [...prev, newNode];
      });

      setEdges((prev) => {
        if (prev.some((e) => e.id === edgeId)) return prev;
        return [
          ...prev,
          {
            id: edgeId,
            source: nodeId,
            target: AGENT_CORE_NODE_ID,
            animated: false,
            style: { stroke: cfg.color, strokeWidth: 1.5, opacity: 0.7 },
          },
        ];
      });
    },
    [setNodes, setEdges]
  );

  const removePrimitive = useCallback(
    (id: string, type: PrimitiveType) => {
      const nodeId = `${type}__${id}`;
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) => prev.filter((e) => e.source !== nodeId));
      setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
    },
    [setNodes, setEdges]
  );

  const byType = useCallback(
    (type: PrimitiveType) => attached.filter((a) => a.primitiveType === type),
    [attached]
  );

  // ── Selected primitive (convenience wrapper over selectedNodeId) ──────────

  const selectedPrimitive: AttachedPrimitive | null = useMemo(() => {
    if (!selectedNodeId) return null;
    return attached.find((a) => `${a.primitiveType}__${a.id}` === selectedNodeId) ?? null;
  }, [selectedNodeId, attached]);

  const setSelectedPrimitive = useCallback((primitive: AttachedPrimitive | null) => {
    setSelectedNodeId(primitive ? `${primitive.primitiveType}__${primitive.id}` : null);
  }, []);

  // ── Live manifest ─────────────────────────────────────────────────────────

  const manifest = useMemo(() => {
    const skills = attached
      .filter((a) => a.primitiveType === "skill")
      .map((a) => ({ name: a.name, version: a.version ?? "1.0.0" }));
    const tools = attached
      .filter((a) => a.primitiveType === "tool")
      .map((a) => ({ name: a.name, version: a.version ?? "1.0.0" }));
    const guardrailIds = attached.filter((a) => a.primitiveType === "guardrail").map((a) => a.id);
    const hookIds = attached.filter((a) => a.primitiveType === "hook").map((a) => a.id);
    const kgIds = attached.filter((a) => a.primitiveType === "knowledge_graph").map((a) => a.id);
    const mcpServers = attached.filter((a) => a.primitiveType === "mcp").map((a) => a.id);

    const tierCfg = TIER_DEFAULTS[agentConfig.tier];

    return {
      name: agentConfig.name,
      version: "1.0.0",
      description: agentConfig.description,
      system_prompt: agentConfig.systemPrompt,
      model: agentConfig.model,
      tier: agentConfig.tier,
      autonomy_level: TIER_AUTONOMY[agentConfig.tier],
      execution_config: {
        max_duration_seconds: tierCfg.max_duration_seconds ?? 300,
        max_tool_calls: tierCfg.max_tool_calls ?? 20,
        max_tokens: tierCfg.max_tokens ?? 10000,
        max_cost_usd: tierCfg.max_cost_usd ?? 0.1,
        planning_mode: tierCfg.planning_mode ?? "none",
        hitl_on_mutating: tierCfg.hitl_on_mutating ?? false,
      },
      max_iterations: agentConfig.maxIterations,
      memory_budget_mb: agentConfig.memoryBudgetMb,
      skills,
      tools,
      guardrail_ids: guardrailIds,
      hook_ids: hookIds,
      knowledge_graph_ids: kgIds,
      mcp_servers: mcpServers,
    };
  }, [attached, agentConfig]);

  // ── Capability narrative ──────────────────────────────────────────────────

  const capabilityNarrative = useMemo(() => {
    const can: string[] = [];
    const cannot: string[] = [];
    const protects: string[] = [];
    const knows: string[] = [];

    attached.forEach((a) => {
      if (a.primitiveType === "skill") can.push(`Execute: ${a.name}`);
      if (a.primitiveType === "tool") can.push(`Use tool: ${a.name}`);
      if (a.primitiveType === "guardrail") protects.push(`Enforces: ${a.name}`);
      if (a.primitiveType === "knowledge_graph") knows.push(`Knows: ${a.name}`);
      if (a.primitiveType === "hook") protects.push(`Hook: ${a.name}`);
      if (a.primitiveType === "mcp") can.push(`Access MCP: ${a.name}`);
    });

    if (!attached.some((a) => a.primitiveType === "tool")) cannot.push("No tools connected");
    if (!attached.some((a) => a.primitiveType === "guardrail")) cannot.push("No safety guardrails");

    return { can, cannot, protects, knows };
  }, [attached]);

  // ── Cost estimate ─────────────────────────────────────────────────────────

  const costEstimate = useMemo(() => {
    const base = TIER_DEFAULTS[agentConfig.tier].max_cost_usd ?? 0.1;
    const perSkill = 0.005 * attached.filter((a) => a.primitiveType === "skill").length;
    const perTool = 0.003 * attached.filter((a) => a.primitiveType === "tool").length;
    return (base + perSkill + perTool).toFixed(3);
  }, [attached, agentConfig.tier]);

  // ── Warnings ──────────────────────────────────────────────────────────────

  const warnings = useMemo(() => {
    const w: string[] = [];
    const hasMutatingTool = attached.some(
      (a) =>
        a.primitiveType === "tool" &&
        (a.metadata as Record<string, unknown>)?.auth_level === "mutating"
    );
    if (hasMutatingTool && !attached.some((a) => a.primitiveType === "hook")) {
      w.push("Mutating tool attached without a HITL hook");
    }
    if (!attached.some((a) => a.primitiveType === "guardrail") && attached.length > 0) {
      w.push("No guardrails — consider adding PII or safety guardrails");
    }
    if (agentConfig.systemPrompt.length < 50) {
      w.push("System prompt is very short");
    }
    return w;
  }, [attached, agentConfig.systemPrompt]);

  // ── Deploy ────────────────────────────────────────────────────────────────

  const deploy = useCallback(async () => {
    setIsDeploying(true);
    setDeployError(null);
    try {
      const result = await agentsApi.create(manifest as Parameters<typeof agentsApi.create>[0]);
      setDeployedAgentId(result.id);
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setIsDeploying(false);
    }
  }, [manifest]);

  return {
    // ── Core config ───────────────────────────────────────────────────────
    agentConfig,
    setAgentConfig,

    // ── ReactFlow canvas state ────────────────────────────────────────────
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    setNodes,
    setEdges,

    // ── Selection ─────────────────────────────────────────────────────────
    selectedNodeId,
    setSelectedNodeId,
    selectedPrimitive,
    setSelectedPrimitive,

    // ── Primitive actions ─────────────────────────────────────────────────
    attached,
    addPrimitive,
    removePrimitive,
    byType,

    // ── Derived / display ─────────────────────────────────────────────────
    manifest,
    capabilityNarrative,
    costEstimate,
    warnings,

    // ── UI state ──────────────────────────────────────────────────────────
    isJsonPreviewOpen,
    setIsJsonPreviewOpen,
    deploy,
    isDeploying,
    deployError,
    deployedAgentId,
  };
}

export type AgentBuilderState = ReturnType<typeof useAgentBuilder>;
