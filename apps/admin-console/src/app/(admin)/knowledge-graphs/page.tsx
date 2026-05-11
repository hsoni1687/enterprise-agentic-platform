"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Eye, Trash2, Loader2, AlertCircle } from "lucide-react";

export default function KnowledgeGraphsPage() {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; tenantId: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: graphs = [], isLoading, isError, error } = useQuery({
    queryKey: ["admin-all-graphs"],
    queryFn: () => adminApi.listAllGraphs(),
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminApi.deleteGraph(deleteTarget.id, deleteTarget.tenantId);
      // Invalidate and refetch
      window.location.reload();
    } catch (err) {
      console.error("Failed to delete graph:", err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Knowledge Graphs</h1>
        <p className="text-muted-foreground mt-1">
          Manage all knowledge graphs across the platform
        </p>
      </div>

      {isError && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-md">
          <AlertCircle className="h-4 w-4" />
          <span>
            {error instanceof Error ? error.message : "Failed to load knowledge graphs"}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading graphs...</span>
        </div>
      ) : graphs.length === 0 ? (
        <div className="p-8 border border-dashed rounded-lg text-center">
          <p className="text-muted-foreground">No knowledge graphs found</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Tenant</th>
                <th className="px-4 py-3 text-left font-semibold">Domain</th>
                <th className="px-4 py-3 text-left font-semibold">Description</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {graphs.map((graph: any, idx: number) => (
                <tr key={graph.id} className={idx % 2 === 0 ? "bg-background" : "bg-muted/50"}>
                  <td className="px-4 py-3 font-medium">{graph.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{graph.tenant_id}</td>
                  <td className="px-4 py-3 text-muted-foreground">{graph.domain || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground truncate text-xs">
                    {graph.description || "—"}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 flex justify-end">
                    <button
                      onClick={() =>
                        router.push(
                          `/knowledge-graphs/${graph.id}?tenant=${graph.tenant_id}`
                        )
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                    >
                      <Eye className="h-3 w-3" />
                      View
                    </button>
                    <button
                      onClick={() =>
                        setDeleteTarget({ id: graph.id, tenantId: graph.tenant_id })
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:bg-destructive/90"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border rounded-lg p-6 max-w-sm space-y-4">
            <div>
              <h3 className="font-semibold">Delete Knowledge Graph?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This will permanently delete the graph "{deleteTarget.id}" from tenant{" "}
                {deleteTarget.tenantId}. This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border rounded hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
