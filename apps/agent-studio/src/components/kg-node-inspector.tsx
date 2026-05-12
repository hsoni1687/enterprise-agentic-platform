"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { kgApi } from "@/lib/api";
import { KGNode } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, ChevronRight } from "lucide-react";

const NODE_COLORS: Record<string, string> = {
  Service: "#3b82f6",
  Database: "#10b981",
  Environment: "#8b5cf6",
  Team: "#ec4899",
  Deployment: "#f97316",
};

interface KGNodeInspectorProps {
  node: KGNode;
  graphId: string;
  onClose: () => void;
}

export function KGNodeInspector({ node, graphId, onClose }: KGNodeInspectorProps) {
  const queryClient = useQueryClient();
  const [expandedDepth, setExpandedDepth] = useState(1);

  const { data: queryResult } = useQuery({
    queryKey: ["kg-query", graphId, node.id, expandedDepth],
    queryFn: () => kgApi.queryGraph(graphId, node.id, expandedDepth),
  });

  const connectedNodes = queryResult?.nodes?.filter((n) => n.id !== node.id) || [];
  const connectedEdges = queryResult?.edges || [];

  const handleExpand = async () => {
    const newDepth = expandedDepth === 1 ? 2 : 1;
    setExpandedDepth(newDepth);
    await queryClient.invalidateQueries({
      queryKey: ["kg-query", graphId, node.id],
    });
  };

  const color = NODE_COLORS[node.node_type] || "#94a3b8";

  return (
    <div className="absolute inset-0 pointer-events-none flex items-start justify-end p-4">
      <div className="pointer-events-auto w-80 bg-background border rounded-lg shadow-lg flex flex-col max-h-[calc(100vh-8rem)]">
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{node.label}</h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge
                className="text-xs"
                style={{
                  backgroundColor: color,
                  color: "white",
                }}
              >
                {node.node_type}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2 font-mono break-all">
              {node.id}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 flex-shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Properties */}
        {node.properties && Object.keys(node.properties).length > 0 && (
          <div className="border-b p-4 space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase">
              Properties
            </h4>
            <div className="space-y-2">
              {Object.entries(node.properties).map(([key, value]) => (
                <div key={key} className="text-xs">
                  <div className="font-medium text-foreground">{key}</div>
                  <div className="text-muted-foreground">
                    {typeof value === "object"
                      ? JSON.stringify(value, null, 2)
                      : String(value)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connected Nodes */}
        <div className="flex-1 overflow-hidden flex flex-col border-b">
          <div className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                Connected Nodes
              </h4>
              {connectedNodes.length > 0 && expandedDepth < 2 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1 text-xs"
                  onClick={handleExpand}
                >
                  Expand <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>
          </div>

          {connectedNodes.length === 0 ? (
            <div className="px-4 pb-4 text-xs text-muted-foreground">
              No connected nodes
            </div>
          ) : (
            <ScrollArea className="flex-1 px-4">
              <div className="space-y-2 pb-4">
                {connectedNodes.map((connected) => {
                  const edge = connectedEdges.find(
                    (e) =>
                      (e.from_node_id === node.id && e.to_node_id === connected.id) ||
                      (e.from_node_id === connected.id && e.to_node_id === node.id)
                  );
                  const isOutgoing = edge?.from_node_id === node.id;

                  return (
                    <div
                      key={connected.id}
                      className="p-2 bg-muted rounded text-xs space-y-1"
                    >
                      <div className="font-medium flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor:
                              NODE_COLORS[connected.node_type] || "#94a3b8",
                          }}
                        />
                        {connected.label}
                      </div>
                      <div className="text-muted-foreground">
                        {connected.node_type}
                      </div>
                      {edge && (
                        <div className="text-xs text-primary flex items-center gap-1">
                          {isOutgoing ? "→" : "←"} {edge.relationship_type}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Created: {new Date(node.created_at).toLocaleDateString()}
          </p>
          {expandedDepth > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs h-7"
              onClick={() => setExpandedDepth(1)}
            >
              Collapse
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
