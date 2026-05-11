"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { ChevronLeft, AlertCircle, Loader2 } from "lucide-react";

export default function GraphDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenant") || "unknown";
  const graphId = params.id;

  const { data: graph, isLoading: graphLoading } = useQuery({
    queryKey: ["admin-graph", graphId, tenantId],
    queryFn: () => adminApi.getGraph(graphId, tenantId),
  });

  const { data: nodes = [], isLoading: nodesLoading } = useQuery({
    queryKey: ["admin-graph-nodes", graphId, tenantId],
    queryFn: () => adminApi.getGraphNodes(graphId, tenantId),
    enabled: !!graph,
  });

  const { data: edges = [], isLoading: edgesLoading } = useQuery({
    queryKey: ["admin-graph-edges", graphId, tenantId],
    queryFn: () => adminApi.getGraphEdges(graphId, tenantId),
    enabled: !!graph,
  });

  const isLoading = graphLoading || nodesLoading || edgesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading graph details...</span>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-md">
          <AlertCircle className="h-4 w-4" />
          <span>Graph not found</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Knowledge Graphs
      </button>

      <div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">{graph.name}</h1>
            <p className="text-muted-foreground mt-1">{graph.description}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{tenantId}</p>
            <p className="text-muted-foreground text-xs">Tenant</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-2xl font-bold">{nodes.length}</div>
          <div className="text-sm text-muted-foreground">Nodes</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-2xl font-bold">{edges.length}</div>
          <div className="text-sm text-muted-foreground">Edges</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm font-mono text-xs">{graph.scope}</div>
          <div className="text-sm text-muted-foreground">Scope</div>
        </div>
      </div>

      {graph.domain && (
        <div className="border rounded-lg p-4">
          <div className="text-sm font-semibold mb-2">Domain</div>
          <div className="text-sm text-muted-foreground">{graph.domain}</div>
        </div>
      )}

      {graph.schema && (
        <div className="border rounded-lg p-4">
          <div className="text-sm font-semibold mb-2">Schema</div>
          <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-64">
            {JSON.stringify(graph.schema, null, 2)}
          </pre>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted border-b px-4 py-3">
          <h3 className="font-semibold">Nodes ({nodes.length})</h3>
        </div>
        <div className="divide-y max-h-96 overflow-y-auto">
          {nodes.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No nodes</div>
          ) : (
            nodes.map((node: any) => (
              <div key={node.id} className="px-4 py-3 border-b last:border-b-0 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{node.id}</span>
                  <span className="inline-block px-2 py-0.5 bg-primary/20 text-primary text-xs rounded">
                    {node.node_type}
                  </span>
                </div>
                <div className="font-semibold text-sm">{node.label}</div>
                {node.properties && Object.keys(node.properties).length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {JSON.stringify(node.properties)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted border-b px-4 py-3">
          <h3 className="font-semibold">Edges ({edges.length})</h3>
        </div>
        <div className="divide-y max-h-96 overflow-y-auto">
          {edges.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No edges</div>
          ) : (
            edges.map((edge: any) => (
              <div key={edge.id} className="px-4 py-3 border-b last:border-b-0 space-y-1">
                <div className="text-xs font-mono text-muted-foreground">{edge.id}</div>
                <div className="text-sm">
                  <span className="font-semibold">{edge.relationship_type}</span>
                  <div className="text-xs text-muted-foreground mt-1">
                    From: {edge.from_node_id}
                  </div>
                  <div className="text-xs text-muted-foreground">To: {edge.to_node_id}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground border-t pt-4">
        <p>Created: {new Date(graph.created_at).toLocaleString()}</p>
        <p>Updated: {new Date(graph.updated_at).toLocaleString()}</p>
      </div>
    </div>
  );
}
