"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, Loader2, AlertCircle } from "lucide-react";
import { adminApi } from "@/lib/api";

export default function SystemSkillsPage() {
  const queryClient = useQueryClient();
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    version: "",
    description: "",
    sop: "",
    mutating: false,
    approval_required: false,
    tools: [] as Array<{ name: string; version: string }>,
    published_by: "admin",
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

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => adminApi.createSystemSkill(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-skills"] });
      setIsCreateOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<typeof formData>) => {
      if (!selectedSkill) return;
      return adminApi.updateSystemSkill(selectedSkill.id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-skills"] });
      setIsEditOpen(false);
    },
  });

  function resetForm() {
    setFormData({
      name: "",
      version: "",
      description: "",
      sop: "",
      mutating: false,
      approval_required: false,
      tools: [],
      published_by: "admin",
    });
  }

  function handleCreateClick() {
    resetForm();
    setIsCreateOpen(true);
  }

  function handleEditClick() {
    if (!selectedSkill) return;
    setFormData({
      name: selectedSkill.name,
      version: selectedSkill.version,
      description: selectedSkill.description,
      sop: selectedSkill.sop || "",
      mutating: selectedSkill.mutating,
      approval_required: selectedSkill.approval_required,
      tools: selectedSkill.tools || [],
      published_by: selectedSkill.published_by,
    });
    setIsEditOpen(true);
  }

  async function handleSave() {
    if (isCreateOpen) {
      await createMutation.mutateAsync(formData);
    } else {
      await updateMutation.mutateAsync(formData);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">System Skills</h1>
          <p className="text-muted-foreground mt-1">
            Manage platform-level system skills available to all tenants
          </p>
        </div>
        <button
          onClick={handleCreateClick}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Skill
        </button>
      </div>

      {isError && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-md">
          <AlertCircle className="h-4 w-4" />
          <span>{error instanceof Error ? error.message : "Failed to load system skills"}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : skills.length === 0 ? (
        <div className="text-center p-8 text-muted-foreground">
          No system skills configured yet
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {/* Skills List */}
          <div className="col-span-1 border rounded-lg overflow-hidden">
            <div className="bg-muted p-4 border-b font-semibold">System Skills</div>
            <div className="divide-y max-h-96 overflow-y-auto">
              {skills.map((skill: any) => (
                <div
                  key={skill.id}
                  onClick={() => setSelectedSkillId(skill.id)}
                  className={`p-3 cursor-pointer hover:bg-muted transition-colors ${
                    selectedSkill?.id === skill.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="font-medium text-sm">{skill.name}</div>
                  <div className="text-xs text-muted-foreground">{skill.version}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Skill Details */}
          <div className="col-span-2 border rounded-lg overflow-hidden flex flex-col">
            {selectedSkill ? (
              <>
                <div className="bg-muted p-4 border-b flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">{selectedSkill.name}</h2>
                    <p className="text-xs text-muted-foreground">{selectedSkill.version}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleEditClick}
                      className="p-2 hover:bg-background rounded-md transition-colors"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Description
                    </label>
                    <p className="text-sm mt-1">{selectedSkill.description || "—"}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      SOP
                    </label>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{selectedSkill.sop || "—"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Mutating
                      </label>
                      <p className="text-sm mt-1">{selectedSkill.mutating ? "Yes" : "No"}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Approval Required
                      </label>
                      <p className="text-sm mt-1">
                        {selectedSkill.approval_required ? "Yes" : "No"}
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Tools ({selectedSkill.tools?.length || 0})
                    </label>
                    {selectedSkill.tools && selectedSkill.tools.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {selectedSkill.tools.map((tool: any, i: number) => (
                          <div key={i} className="text-sm px-2 py-1 bg-muted rounded">
                            {tool.name}@{tool.version}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm mt-1 text-muted-foreground">—</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Status
                    </label>
                    <p className="text-sm mt-1 capitalize">{selectedSkill.status}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                No skill selected
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {(isCreateOpen || isEditOpen) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-background border rounded-lg max-w-2xl w-full max-h-96 overflow-y-auto">
            <div className="border-b p-4 flex items-center justify-between sticky top-0 bg-background">
              <h2 className="font-semibold">
                {isCreateOpen ? "Create System Skill" : "Edit System Skill"}
              </h2>
              <button
                onClick={() => {
                  setIsCreateOpen(false);
                  setIsEditOpen(false);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    disabled={!isCreateOpen}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Version *</label>
                  <input
                    type="text"
                    value={formData.version}
                    onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    disabled={!isCreateOpen}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">SOP</label>
                <textarea
                  value={formData.sop}
                  onChange={(e) => setFormData({ ...formData, sop: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  rows={3}
                  placeholder="System Operating Procedure"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.mutating}
                    onChange={(e) => setFormData({ ...formData, mutating: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm font-medium">Mutating</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.approval_required}
                    onChange={(e) =>
                      setFormData({ ...formData, approval_required: e.target.checked })
                    }
                    className="rounded"
                  />
                  <span className="text-sm font-medium">Approval Required</span>
                </label>
              </div>

              <div className="border-t pt-4 flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setIsCreateOpen(false);
                    setIsEditOpen(false);
                  }}
                  className="px-4 py-2 text-sm border rounded-md hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 inline mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
