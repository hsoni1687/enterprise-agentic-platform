"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Edit2, Loader2, AlertCircle, Lock } from "lucide-react";
import { adminApi } from "@/lib/api";

export default function SystemSkillsPage() {
  const queryClient = useQueryClient();
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    version: "",
    description: "",
    mutating: false,
    approval_required: false,
    sop: "",
  });

  const { data: skillsData, isLoading, isError, error } = useQuery({
    queryKey: ["system-skills"],
    queryFn: () => adminApi.listSystemSkills(),
  });

  const skills = skillsData?.skills || [];
  const selectedSkill = useMemo(
    () => skills.find((s: any) => s.id === selectedSkillId) || skills[0],
    [skills, selectedSkillId]
  );

  const updateMutation = useMutation({
    mutationFn: async (data: typeof editForm) => {
      if (!selectedSkill) return;
      return adminApi.updateSystemSkill(selectedSkill.id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-skills"] });
      setIsEditOpen(false);
    },
  });

  function handleEditSkill() {
    if (!selectedSkill) return;
    setEditForm({
      name: selectedSkill.name,
      version: selectedSkill.version,
      description: selectedSkill.description,
      mutating: selectedSkill.mutating,
      approval_required: selectedSkill.approval_required,
      sop: selectedSkill.sop,
    });
    setIsEditOpen(true);
  }

  async function handleSaveSkill() {
    await updateMutation.mutateAsync(editForm);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">System Skills</h1>
        <p className="text-muted-foreground mt-1">
          Manage platform-level system skills and their configurations
        </p>
      </div>

      {isError && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-md">
          <AlertCircle className="h-4 w-4" />
          <span>{error instanceof Error ? error.message : "Failed to load system skills"}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Skill List */}
        <div className="lg:col-span-1">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/50">
              <h2 className="font-semibold text-sm">System Skills</h2>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : skills.length > 0 ? (
              <div className="divide-y divide-border">
                {skills.map((skill: any) => (
                  <button
                    key={skill.id}
                    onClick={() => setSelectedSkillId(skill.id)}
                    className={`w-full text-left p-3 transition-colors ${
                      selectedSkill?.id === skill.id
                        ? "bg-primary/10 border-l-2 border-l-primary"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {skill.mutating && (
                        <Lock className="h-3 w-3 mt-1 text-yellow-600 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{skill.name}</p>
                        <p className="text-xs text-muted-foreground">{skill.version}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No system skills found
              </div>
            )}
          </div>
        </div>

        {/* Skill Details */}
        <div className="lg:col-span-2">
          {selectedSkill ? (
            <div className="bg-card border border-border rounded-lg p-6 space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold">{selectedSkill.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Version {selectedSkill.version}
                  </p>
                </div>
                <button
                  onClick={handleEditSkill}
                  className="inline-flex items-center gap-2 px-3 py-1 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
                >
                  <Edit2 className="h-4 w-4" />
                  Edit
                </button>
              </div>

              <div className="space-y-4 border-t border-border pt-6">
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedSkill.description}
                  </p>
                </div>

                {selectedSkill.tools && selectedSkill.tools.length > 0 && (
                  <div>
                    <label className="text-sm font-medium">Tools</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedSkill.tools.map((tool: any) => (
                        <div
                          key={`${tool.name}-${tool.version}`}
                          className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200"
                        >
                          {tool.name} ({tool.version})
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium">Configuration</label>
                  <div className="mt-2 space-y-2 text-sm">
                    <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                      <span>Mutating</span>
                      <span className="font-medium">
                        {selectedSkill.mutating ? (
                          <span className="text-yellow-600">Yes</span>
                        ) : (
                          <span className="text-green-600">No</span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                      <span>Approval Required</span>
                      <span className="font-medium">
                        {selectedSkill.approval_required ? (
                          <span className="text-orange-600">Yes</span>
                        ) : (
                          <span className="text-gray-600">No</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedSkill.sop && (
                  <div>
                    <label className="text-sm font-medium">Standard Operating Procedure</label>
                    <pre className="mt-2 p-3 text-xs bg-muted rounded overflow-auto max-h-48">
                      {selectedSkill.sop}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg p-6 flex items-center justify-center h-96 text-muted-foreground">
              {isLoading ? "Loading..." : "No skill selected"}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {isEditOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-2xl w-full max-h-96 overflow-auto p-6 space-y-4">
            <h3 className="text-lg font-bold">Edit System Skill</h3>

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
                <label className="text-sm font-medium">SOP</label>
                <textarea
                  value={editForm.sop}
                  onChange={(e) => setEditForm({ ...editForm, sop: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm font-mono"
                  rows={6}
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.mutating}
                    onChange={(e) => setEditForm({ ...editForm, mutating: e.target.checked })}
                    className="w-4 h-4"
                  />
                  Mutating
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.approval_required}
                    onChange={(e) =>
                      setEditForm({ ...editForm, approval_required: e.target.checked })
                    }
                    className="w-4 h-4"
                  />
                  Approval Required
                </label>
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
                onClick={handleSaveSkill}
                disabled={updateMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {updateMutation.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
