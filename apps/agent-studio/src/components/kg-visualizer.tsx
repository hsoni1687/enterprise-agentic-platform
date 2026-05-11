"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  NodeTypes,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { kgApi } from "@/lib/api";
import { KGNode, KGEdge } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KGNodeInspector } from "./kg-node-inspector";

const NODE_COLORS: Record<string, string> = {
  Service: "#3b82f6",
  Database: "#22c55e",
  Environment: "#6b7280",
  Team: "#a855f7",
  Deployment: "#f59e0b",
};

const KGNodeComponent = ({ data }: { data: { label: string; type: string } }) => {
  const color = NODE_COLORS[data.type] || "#94a3b8";
  return (
    <div
      className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xs font-semibold cursor-pointer hover:shadow-lg transition-shadow"
      style={{ backgroundColor: color }}
      title={`${data.label} (${data.type})`}
    >
      {data.label.substring(0, 2).toUpperCase()}
    </div>
  );
};

const nodeTypes: NodeTypes = {
  kgNode: KGNodeComponent,
};

interface KGVisualizerProps {
  graphId: string;
  mode: "preview" | "explore";
  onNodeSelect?: (node: KGNode) => void;
}

function KGVisualizerInner({
  graphId,
  mode,
  onNodeSelect,
}: KGVisualizerProps) {
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const { data: kgNodes = [], isLoading: nodesLoading } = useQuery({
    queryKey: ["kg-nodes", graphId],
    queryFn: () => kgApi.listNodes(graphId),
  });

  const { data: kgEdges = [], isLoading: edgesLoading } = useQuery({
    queryKey: ["kg-edges", graphId],
    queryFn: () => kgApi.listEdges(graphId),
  });

  const nodeTypes_ = useMemo(() => {
    return kgNodes
      .filter((n) => !typeFilter || n.node_type === typeFilter)
      .filter((n) =>
        searchFilter ? n.label.toLowerCase().includes(searchFilter.toLowerCase()) : true
      );
  }, [kgNodes, searchFilter, typeFilter]);

  const nodeTypeOptions = useMemo(
    () => Array.from(new Set(kgNodes.map((n) => n.node_type))),
    [kgNodes]
  );

  const layout = useCallback(() => {
    if (nodeTypes_.length === 0) return;

    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: "LR" });

    nodeTypes_.forEach((n) => {
      dagreGraph.setNode(n.id, { width: 50, height: 50 });
    });

    kgEdges.forEach((e) => {
      if (nodeTypes_.some((n) => n.id === e.from_node_id) && nodeTypes_.some((n) => n.id === e.to_node_id)) {
        dagreGraph.setEdge(e.from_node_id, e.to_node_id);
      }
    });

    dagre.layout(dagreGraph);

    const newNodes = nodeTypes_.map((n) => ({
      id: n.id,
      data: { label: n.label, type: n.node_type },
      position: dagreGraph.node(n.id) || { x: 0, y: 0 },
      type: "kgNode",
    }));

    const newEdges = kgEdges
      .filter((e) => nodeTypes_.some((n) => n.id === e.from_node_id && nodeTypes_.some((n2) => n2.id === e.to_node_id)))
      .map((e) => ({
        id: e.id,
        source: e.from_node_id,
        target: e.to_node_id,
        label: e.relationship_type,
        type: "smoothstep",
        animated: false,
      }));

    setNodes(newNodes as never[]);
    setEdges(newEdges as never[]);

    setTimeout(() => fitView({ padding: 0.2 }), 50);
  }, [nodeTypes_, kgEdges, setNodes, setEdges, fitView]);

  useMemo(() => {
    layout();
  }, [layout]);

  const handleNodeClick = useCallback(
    (e: any) => {
      const node = e.node;
      const kgNode = kgNodes.find((n) => n.id === node.id);
      if (kgNode) {
        setSelectedNode(kgNode);
        onNodeSelect?.(kgNode);
      }
    },
    [kgNodes, onNodeSelect]
  );

  if (nodesLoading || edgesLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        Loading graph...
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {mode === "explore" && (
        <div className="border-b p-3 space-y-3">
          <Input
            placeholder="Search nodes by label..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="h-8"
          />
          <div className="flex gap-2 items-center">
            <Select value={typeFilter || ""} onValueChange={(v) => setTypeFilter(v || null)}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All types</SelectItem>
                {nodeTypeOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => layout()}>
              Relayout
            </Button>
          </div>
        </div>
      )}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
        {mode === "explore" && selectedNode && (
          <KGNodeInspector
            node={selectedNode}
            graphId={graphId}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}

export function KGVisualizer({
  graphId,
  mode,
  onNodeSelect,
}: KGVisualizerProps) {
  return (
    <ReactFlowProvider>
      <KGVisualizerInner graphId={graphId} mode={mode} onNodeSelect={onNodeSelect} />
    </ReactFlowProvider>
  );
}
