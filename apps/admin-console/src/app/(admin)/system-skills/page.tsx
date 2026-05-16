"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Edit2, Loader2, AlertCircle, Lock, Plus, Globe2, Upload, Link as LinkIcon } from "lucide-react";
import { adminApi } from "@/lib/api";

type SkillDraft = {
  name: string;
  version: string;
  description: string;
  sop: string;
  mutating: boolean;
  approval_required: boolean;
  published_by: string;
  tools_json: string;
  hooks_json: string;
};

const fieldClass =
  "mt-1 w-full px-3 py-2 border border-zinc-700 rounded-md bg-zinc-950 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500";
const textFieldClass = `${fieldClass} text-sm`;
const monoFieldClass = `${fieldClass} text-xs font-mono`;

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseScalar(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { attrs: {} as Record<string, string>, body: markdown };
  const attrs: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > -1) attrs[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1));
  }
  return { attrs, body: markdown.slice(match[0].length) };
}

function parseJsonish(value: string | undefined, fallback: unknown[]) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseSkillMarkdown(markdown: string): SkillDraft {
  const { attrs, body } = parseFrontmatter(markdown);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const name = attrs.name || heading || "imported-skill";
  const description =
    attrs.description ||
    body
      .replace(/^#\s+.+$/m, "")
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find(Boolean) ||
    `Imported skill ${name}`;
  const sop = attrs.sop || body.trim();
  return {
    name: slugify(name) || "imported-skill",
    version: attrs.version || "1.0.0",
    description,
    sop,
    mutating: attrs.mutating === "true",
    approval_required: attrs.approval_required === "true",
    published_by: attrs.published_by || "platform-admin",
    tools_json: JSON.stringify(parseJsonish(attrs.tools, []), null, 2),
    hooks_json: JSON.stringify(parseJsonish(attrs.hooks, []), null, 2),
  };
}

function githubRawCandidates(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const blobIndex = parts.indexOf("blob");
      const treeIndex = parts.indexOf("tree");
      if (parts.length >= 5 && blobIndex === 2) {
        const [owner, repo, , branch, ...pathParts] = parts;
        return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathParts.join("/")}`];
      }
      if (parts.length >= 5 && treeIndex === 2) {
        const [owner, repo, , branch, ...pathParts] = parts;
        if (pathParts[pathParts.length - 1]?.toLowerCase().endsWith(".md")) {
          return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathParts.join("/")}`];
        }
        return ["SKILL.md", "skill.md"].map(
          (file) => `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${[...pathParts, file].join("/")}`
        );
      }
    }
  } catch {
    return [url];
  }
  return [url];
}

async function fetchSkillMarkdownFromUrl(url: string) {
  const candidates = githubRawCandidates(url);
  for (const candidate of candidates) {
    const response = await fetch(candidate);
    if (response.ok) return response.text();
    if (response.status !== 404) throw new Error(`Failed to fetch Skill.md (${response.status})`);
  }
  throw new Error("SKILL.md not found at the provided URL");
}

export default function SystemSkillsPage() {
  const queryClient = useQueryClient();
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    version: "",
    description: "",
    mutating: false,
    approval_required: false,
    sop: "",
    tools_json: "[]",
    hooks_json: "[]",
  });
  const [createForm, setCreateForm] = useState({
    name: "",
    version: "1.0.0",
    description: "",
    mutating: false,
    approval_required: false,
    sop: "",
    published_by: "platform-admin",
    tools_json: "[]",
    hooks_json: "[]",
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
    mutationFn: async (data: any) => {
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
      tools_json: JSON.stringify(selectedSkill.tools ?? [], null, 2),
      hooks_json: JSON.stringify(selectedSkill.hooks ?? [], null, 2),
    });
    setIsEditOpen(true);
  }

  async function handleSaveSkill() {
    const { tools_json, hooks_json, ...fields } = editForm;
    await updateMutation.mutateAsync({
      ...fields,
      tools: JSON.parse(tools_json || "[]"),
      hooks: JSON.parse(hooks_json || "[]"),
    } as any);
  }

  async function handleCreateSkill() {
    setCreateError(null);
    try {
      const { tools_json, hooks_json, ...fields } = createForm;
      await adminApi.createSystemSkill({
        ...fields,
        tools: JSON.parse(tools_json || "[]"),
        hooks: JSON.parse(hooks_json || "[]"),
      });
      queryClient.invalidateQueries({ queryKey: ["system-skills"] });
      setIsCreateOpen(false);
      setImportSuccess(null);
      setCreateForm({
        name: "",
        version: "1.0.0",
        description: "",
        mutating: false,
        approval_required: false,
        sop: "",
        published_by: "platform-admin",
        tools_json: "[]",
        hooks_json: "[]",
      });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create skill");
    }
  }

  function applySkillMarkdown(markdown: string) {
    const parsed = parseSkillMarkdown(markdown);
    setCreateForm((current) => ({ ...current, ...parsed }));
    setIsCreateOpen(true);
    setImportError(null);
    setImportSuccess("Imported SKILL.md. Review the populated fields, then create the skill.");
  }

  async function handleImportFromUrl() {
    if (!importUrl.trim()) return;
    setImportError(null);
    setImportSuccess(null);
    try {
      applySkillMarkdown(await fetchSkillMarkdownFromUrl(importUrl.trim()));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to import Skill.md");
    }
  }

  async function handleImportFile(file: File | null) {
    if (!file) return;
    applySkillMarkdown(await file.text());
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground mb-3">
            <Globe2 className="h-3 w-3" />
            Admin managed catalog
          </div>
          <h1 className="text-3xl font-bold">Skills Catalog</h1>
          <p className="text-muted-foreground mt-1">
            Create platform skills that every tenant can view and use.
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Skill
        </button>
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
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-sm">Admin Skills</h2>
                <button
                  onClick={() => setIsCreateOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-background"
                >
                  <Plus className="h-3 w-3" />
                  New
                </button>
              </div>
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
                <p>No admin skills found</p>
                <button
                  onClick={() => setIsCreateOpen(true)}
                  className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                >
                  <Plus className="h-3 w-3" />
                  Create first skill
                </button>
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

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-3xl w-full max-h-[90vh] overflow-auto p-6 space-y-4">
            <h3 className="text-lg font-bold">Create Admin Skill</h3>
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Upload className="h-4 w-4" />
                Import Skill.md
              </div>
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  className="flex-1 px-3 py-2 border border-zinc-700 rounded-md text-sm bg-zinc-950 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                  placeholder="GitHub file or folder URL, e.g. .../tree/.../frontend-design"
                />
                <button
                  type="button"
                  onClick={handleImportFromUrl}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border border-border rounded-md hover:bg-background"
                >
                  <LinkIcon className="h-4 w-4" />
                  Import URL
                </button>
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 px-3 py-2 text-sm font-medium border border-border rounded-md hover:bg-background">
                  <Upload className="h-4 w-4" />
                  Upload File
                  <input
                    type="file"
                    accept=".md,.markdown,text/markdown,text/plain"
                    className="hidden"
                    onChange={(e) => handleImportFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {importError && <p className="text-xs text-destructive">{importError}</p>}
              {importSuccess && <p className="text-xs text-green-600">{importSuccess}</p>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className={textFieldClass}
                  placeholder="incident-triage"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Version</label>
                <input
                  value={createForm.version}
                  onChange={(e) => setCreateForm({ ...createForm, version: e.target.value })}
                  className={textFieldClass}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className={textFieldClass}
                rows={2}
              />
            </div>
            <div>
              <label className="text-sm font-medium">SOP / Skill Instructions</label>
              <textarea
                value={createForm.sop}
                onChange={(e) => setCreateForm({ ...createForm, sop: e.target.value })}
                className={`${textFieldClass} font-mono`}
                rows={7}
                placeholder="Markdown instructions the agent will receive as virtual SKILL.md content"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Tools JSON</label>
                <textarea
                  value={createForm.tools_json}
                  onChange={(e) => setCreateForm({ ...createForm, tools_json: e.target.value })}
                  className={monoFieldClass}
                  rows={5}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Hooks JSON</label>
                <textarea
                  value={createForm.hooks_json}
                  onChange={(e) => setCreateForm({ ...createForm, hooks_json: e.target.value })}
                  className={monoFieldClass}
                  rows={5}
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createForm.mutating}
                  onChange={(e) => setCreateForm({ ...createForm, mutating: e.target.checked })}
                />
                Mutating
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createForm.approval_required}
                  onChange={(e) => setCreateForm({ ...createForm, approval_required: e.target.checked })}
                />
                Approval Required
              </label>
            </div>
            <div className="flex gap-3 justify-end pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 text-sm font-medium border border-border rounded-md hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSkill}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 transition-colors"
              >
                Create Skill
              </button>
            </div>
            {createError && <p className="text-xs text-destructive">{createError}</p>}
          </div>
        </div>
      )}

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
                  className={textFieldClass}
                  disabled
                />
              </div>

              <div>
                <label className="text-sm font-medium">Version</label>
                <input
                  type="text"
                  value={editForm.version}
                  onChange={(e) => setEditForm({ ...editForm, version: e.target.value })}
                  className={textFieldClass}
                  disabled
                />
              </div>

              <div>
                <label className="text-sm font-medium">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className={textFieldClass}
                  rows={2}
                />
              </div>

              <div>
                <label className="text-sm font-medium">SOP</label>
                <textarea
                  value={editForm.sop}
                  onChange={(e) => setEditForm({ ...editForm, sop: e.target.value })}
                  className={`${textFieldClass} font-mono`}
                  rows={6}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Tools JSON</label>
                  <textarea
                    value={editForm.tools_json}
                    onChange={(e) => setEditForm({ ...editForm, tools_json: e.target.value })}
                    className={monoFieldClass}
                    rows={5}
                    placeholder='[{"name":"bash","version":"1.0.0"}]'
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Hooks JSON</label>
                  <textarea
                    value={editForm.hooks_json}
                    onChange={(e) => setEditForm({ ...editForm, hooks_json: e.target.value })}
                    className={monoFieldClass}
                    rows={5}
                    placeholder='[{"phase":"pre","type":"audit_log"}]'
                  />
                </div>
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
