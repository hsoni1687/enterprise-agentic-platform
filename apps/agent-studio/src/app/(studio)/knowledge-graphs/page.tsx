"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { kgApi } from "@/lib/api";
import { KGGraph } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Eye, Pencil, Loader2, X } from "lucide-react";

export default function KnowledgeGraphsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createDomain, setCreateDomain] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: graphs = [], isLoading } = useQuery({
    queryKey: ["kg-graphs"],
    queryFn: () => kgApi.listGraphs(),
  });

  const { data: graphDetails = {} } = useQuery({
    queryKey: ["kg-graph-details"],
    queryFn: async () => {
      const details: Record<string, { nodeCount: number; edgeCount: number }> =
        {};
      for (const graph of graphs) {
        try {
          const nodes = await kgApi.listNodes(graph.id);
          const edges = await kgApi.listEdges(graph.id);
          details[graph.id] = {
            nodeCount: nodes.length,
            edgeCount: edges.length,
          };
        } catch (e) {
          details[graph.id] = { nodeCount: 0, edgeCount: 0 };
        }
      }
      return details;
    },
    enabled: graphs.length > 0,
  });

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const newGraph = await kgApi.createGraph({
        name: createName,
        domain: createDomain || undefined,
        description: createDescription || undefined,
      });
      setCreateOpen(false);
      setCreateName("");
      setCreateDomain("");
      setCreateDescription("");
      queryClient.invalidateQueries({ queryKey: ["kg-graphs"] });
      router.push(`/knowledge-graphs/${newGraph.id}?tab=builder`);
    } catch (error) {
      console.error("Failed to create graph:", error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await kgApi.deleteGraph(deleteId);
      queryClient.invalidateQueries({ queryKey: ["kg-graphs"] });
      setDeleteId(null);
    } catch (error) {
      console.error("Failed to delete graph:", error);
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading knowledge graphs...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Graphs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage domain ontologies for your agents.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(!createOpen)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Graph
        </Button>
      </div>

      {createOpen && (
        <div className="border rounded-lg p-4 bg-muted/50 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Create Knowledge Graph</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => setCreateOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., DevOps Platform"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="domain">Domain</Label>
              <Input
                id="domain"
                placeholder="e.g., devops, fintech, healthcare"
                value={createDomain}
                onChange={(e) => setCreateDomain(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder="Brief description..."
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={creating || !createName.trim()}
              >
                {creating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {graphs.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            No knowledge graphs yet. Create one to get started.
          </p>
          <Button onClick={() => setCreateOpen(true)} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" />
            Create First Graph
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {graphs.map((graph) => {
            const details = graphDetails[graph.id];
            return (
              <div
                key={graph.id}
                className="border rounded-lg p-4 hover:shadow-lg transition-shadow space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{graph.name}</h3>
                    {graph.domain && (
                      <Badge variant="secondary" className="mt-2 text-xs">
                        {graph.domain}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 flex-shrink-0 text-destructive hover:text-destructive"
                    onClick={() => setDeleteId(graph.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {graph.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {graph.description}
                  </p>
                )}
                {details && (
                  <div className="flex gap-4 text-sm pt-2 border-t">
                    <div>
                      <span className="text-muted-foreground">Nodes: </span>
                      <span className="font-semibold">{details.nodeCount}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Edges: </span>
                      <span className="font-semibold">{details.edgeCount}</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() =>
                      router.push(`/knowledge-graphs/${graph.id}?tab=builder`)
                    }
                  >
                    <Pencil className="h-3 w-3" />
                    Build
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() =>
                      router.push(`/knowledge-graphs/${graph.id}?tab=visualizer`)
                    }
                  >
                    <Eye className="h-3 w-3" />
                    View
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border rounded-lg p-6 max-w-sm space-y-4">
            <div>
              <h3 className="font-semibold">Delete Knowledge Graph?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This action cannot be undone. The graph and all its nodes and edges
                will be permanently deleted.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setDeleteId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Delete"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
