"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Edit2, Loader2, AlertCircle } from "lucide-react";
import { adminApi } from "@/lib/api";

export default function SystemToolsPage() {
  const queryClient = useQueryClient();
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    version: "",
    description: "",
    auth_level: "read-only",
    sandbox_required: false,
    input_schema: "{}",
    output_schema: "{}",
  });

  const { data: toolsData, isLoading, isError, error } = useQuery({
    queryKey: ["system-tools"],
    queryFn: () => adminApi.listSystemTools(),
  });

  const tools = toolsData?.tools || [];
  const selectedTool = useMemo(
    () => tools.find((t: any) => t.id === selectedToolId) || tools[0],
    [tools, selectedToolId]
  );

  const updateMutation = useMutation({
    mutationFn: async (data: typeof editForm) => {
      if (!selectedTool) return;
      try {
        return adminApi.updateSystemTool(selectedTool.id, {
          ...data,
          input_schema: data.input_schema ? JSON.parse(data.input_schema) : undefined,
          output_schema: data.output_schema ? JSON.parse(data.output_schema) : undefined,
        });
      } catch (e) {
        throw new Error("Invalid JSON in schema fields");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-tools"] });
      setIsEditOpen(false);
    },
  });

  function handleEditTool() {
    if (!selectedTool) return;
    setEditForm({
      name: selectedTool.name,
      version: selectedTool.version,
      description: selectedTool.description,
      auth_level: selectedTool.auth_level,
      sandbox_required: selectedTool.sandbox_required,
      input_schema: JSON.stringify(selectedTool.input_schema || {}, null, 2),
      output_schema: JSON.stringify(selectedTool.output_schema || {}, null, 2),
    });
    setIsEditOpen(true);
  }

  async function handleSaveTool() {
    await updateMutation.mutateAsync(editForm);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">System Tools</h1>
        <p className="text-muted-foreground mt-1">
          Manage platform-level system tools and their specifications
        </p>
      </div>

      {isError && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-md">
          <AlertCircle className="h-4 w-4" />
          <span>{error instanceof Error ? error.message : "Failed to load system tools"}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tool List */}
        <div className="lg:col-span-1">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/50">
              <h2 className="font-semibold text-sm">System Tools</h2>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : tools.length > 0 ? (
              <div className="divide-y divide-border">
                {tools.map((tool: any) => (
                  <button
                    key={tool.id}
                    onClick={() => setSelectedToolId(tool.id)}
                    className={`w-full text-left p-3 transition-colors ${
                      selectedTool?.id === tool.id
                        ? "bg-primary/10 border-l-2 border-l-primary"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="font-medium text-sm truncate">{tool.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          tool.auth_level === "mutating"
                            ? "bg-yellow-500/15 text-yellow-600"
                            : "bg-green-500/15 text-green-600"
                        }`}
                      >
                        {tool.auth_level}
                      </span>
                      <span className="text-xs text-muted-foreground">{tool.version}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No system tools found
              </div>
            )}
          </div>
        </div>

        {/* Tool Detail */}
        <div className="lg:col-span-2">
          {selectedTool ? (
            <div className="bg-card border border-border rounded-lg p-6 space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold">{selectedTool.name}</h2>
                  <p className="text-sm text-muted-foreground font-mono mt-1">
                    {selectedTool.id}
                  </p>
                </div>
                <button
                  onClick={handleEditTool}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
                >
                  <Edit2 className="h-4 w-4" />
                  Edit
                </button>
              </div>

              <div className="space-y-4 border-t border-border pt-6">
                <div>
                  <label className="text-sm font-medium">Version</label>
                  <p className="text-sm text-muted-foreground font-mono mt-1">
                    {selectedTool.version}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium">Description</label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedTool.description}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium">Auth Level</label>
                  <div className="mt-1">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded text-xs font-medium ${
                        selectedTool.auth_level === "mutating"
                          ? "bg-yellow-500/15 text-yellow-600"
                          : "bg-green-500/15 text-green-600"
                      }`}
                    >
                      {selectedTool.auth_level}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Sandbox Required</label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedTool.sandbox_required ? "Yes" : "No"}
                  </p>
                </div>

                {selectedTool.input_schema && (
                  <div>
                    <label className="text-sm font-medium">Input Schema</label>
                    <pre className="mt-2 p-3 text-xs bg-muted rounded overflow-auto max-h-48 font-mono">
                      {JSON.stringify(selectedTool.input_schema, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedTool.output_schema && (
                  <div>
                    <label className="text-sm font-medium">Output Schema</label>
                    <pre className="mt-2 p-3 text-xs bg-muted rounded overflow-auto max-h-48 font-mono">
                      {JSON.stringify(selectedTool.output_schema, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg p-6 flex items-center justify-center h-96 text-muted-foreground">
              {isLoading ? "Loading..." : "No tool selected"}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {isEditOpen && selectedTool && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h3 className="text-lg font-bold">Edit System Tool</h3>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm"
                  disabled
                />
              </div>

              <div>
                <label className="text-sm font-medium">Version</label>
                <input
                  type="text"
                  value={editForm.version}
                  onChange={(e) => setEditForm({ ...editForm, version: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm"
                  disabled
                />
              </div>

              <div>
                <label className="text-sm font-medium">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm"
                  rows={2}
                />
              </div>

              <div>
                <label className="text-sm font-medium">Auth Level</label>
                <select
                  value={editForm.auth_level}
                  onChange={(e) => setEditForm({ ...editForm, auth_level: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm"
                >
                  <option value="read-only">Read-Only</option>
                  <option value="mutating">Mutating</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sandbox-required"
                  checked={editForm.sandbox_required}
                  onChange={(e) => setEditForm({ ...editForm, sandbox_required: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="sandbox-required" className="text-sm font-medium cursor-pointer">
                  Sandbox Required
                </label>
              </div>

              <div>
                <label className="text-sm font-medium">Input Schema (JSON)</label>
                <textarea
                  value={editForm.input_schema}
                  onChange={(e) => setEditForm({ ...editForm, input_schema: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm font-mono"
                  rows={5}
                />
              </div>

              <div>
                <label className="text-sm font-medium">Output Schema (JSON)</label>
                <textarea
                  value={editForm.output_schema}
                  onChange={(e) => setEditForm({ ...editForm, output_schema: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm font-mono"
                  rows={5}
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-4 border-t border-border">
              <button
                onClick={() => setIsEditOpen(false)}
                className="px-4 py-2 text-sm font-medium border border-border rounded-md hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTool}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
