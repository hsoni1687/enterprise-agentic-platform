"use client";

import { useCallback, useRef } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  NodeTypes,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGrid } from "lucide-react";
import dagre from "@dagrejs/dagre";
import { AgentCoreNode } from "./agent-core-node";
import { PrimitiveNode } from "./primitive-node";
import { AGENT_CORE_NODE_ID, PRIMITIVE_CONFIG } from "./use-agent-builder";
import type { AgentBuilderState, DragPrimitive } from "./use-agent-builder";

// ── Node type registry ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: NodeTypes = {
  agentCore: AgentCoreNode as any,
  primitive: PrimitiveNode as any,
};

// ── Auto-layout via Dagre ─────────────────────────────────────────────────────

function autoLayout(nodes: Node[], edges: AgentBuilderState["edges"]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 100, nodesep: 40 });

  nodes.forEach((n) => {
    const w = n.id === AGENT_CORE_NODE_ID ? 280 : 180;
    const h = n.id === AGENT_CORE_NODE_ID ? 240 : 90;
    g.setNode(n.id, { width: w, height: h });
  });

  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: {
        x: pos.x - (n.id === AGENT_CORE_NODE_ID ? 140 : 90),
        y: pos.y - (n.id === AGENT_CORE_NODE_ID ? 120 : 45),
      },
    };
  });
}

// ── Inner canvas (needs ReactFlowProvider context) ────────────────────────────

interface CanvasInnerProps {
  state: AgentBuilderState;
}

function CanvasInner({ state }: CanvasInnerProps) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    addPrimitive,
    removePrimitive,
    setSelectedNodeId,
    setNodes,
    setEdges,
  } = state;

  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // ── Drop handling ─────────────────────────────────────────────────────────────

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) return;

      let primitive: DragPrimitive;
      try {
        primitive = JSON.parse(raw);
      } catch {
        return;
      }

      // Convert screen → flow coordinates
      const position = reactFlow.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      addPrimitive(primitive, position);
    },
    [reactFlow, addPrimitive]
  );

  // ── Node click ────────────────────────────────────────────────────────────────

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  // ── Auto-layout ───────────────────────────────────────────────────────────────

  const triggerAutoLayout = useCallback(() => {
    const laid = autoLayout(nodes, edges);
    setNodes(laid);
    window.requestAnimationFrame(() => reactFlow.fitView({ padding: 0.2, duration: 400 }));
  }, [nodes, edges, setNodes, reactFlow]);

  // ── Inject onRemove into primitive nodes ──────────────────────────────────────

  const nodesWithRemove = nodes.map((n) =>
    n.type === "primitive"
      ? { ...n, data: { ...n.data, onRemove: removePrimitive } }
      : n
  );

  return (
    <div ref={wrapperRef} className="relative flex-1 h-full" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodesWithRemove}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.3}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        {/* Dark dotted grid */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(255,255,255,0.07)"
        />

        {/* Controls */}
        <Controls
          style={{
            background: "rgba(12,12,20,0.9)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
          }}
        />

        {/* Minimap */}
        <MiniMap
          style={{
            background: "rgba(12,12,20,0.9)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
          }}
          nodeColor={(n) => {
            if (n.id === AGENT_CORE_NODE_ID) return "#8B5CF6";
            const type = (n.data as Record<string, unknown>).primitiveType as string;
            return PRIMITIVE_CONFIG[type as keyof typeof PRIMITIVE_CONFIG]?.color ?? "#6B7280";
          }}
          maskColor="rgba(0,0,0,0.4)"
        />
      </ReactFlow>

      {/* Auto-layout button */}
      <button
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all hover:scale-105"
        style={{
          background: "rgba(12,12,22,0.9)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.4)",
          backdropFilter: "blur(8px)",
        }}
        onClick={triggerAutoLayout}
        title="Auto-arrange nodes"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Auto Layout
      </button>

      {/* Drop-zone hint (only when no primitives) */}
      {nodes.length <= 1 && (
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3"
          style={{ paddingTop: 40 }}
        >
          <div
            className="rounded-2xl px-8 py-6 text-center"
            style={{
              background: "rgba(139,92,246,0.04)",
              border: "2px dashed rgba(139,92,246,0.15)",
            }}
          >
            <div className="text-sm text-white/20 font-medium mb-1">
              Drag primitives from the library
            </div>
            <div className="text-xs text-white/12">
              Skills · Tools · Guardrails · Knowledge Graphs · Hooks · MCP
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Exported canvas (wraps with provider) ─────────────────────────────────────

interface Props {
  state: AgentBuilderState;
}

export function AgentBuilderCanvas({ state }: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner state={state} />
    </ReactFlowProvider>
  );
}
