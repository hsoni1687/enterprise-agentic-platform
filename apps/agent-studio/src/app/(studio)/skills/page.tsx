"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Trash2, Loader2, Zap, Edit2, Globe2, Lock, Search,
  Upload, Link as LinkIcon, Eye, Shield, Star, Users,
  ChevronDown, ChevronRight, Filter,
} from "lucide-react";
import { getRuntimeTenant, skillsApi, toolsApi } from "@/lib/api";
import { SkillManifest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// ── Schema ────────────────────────────────────────────────────────────────────

const skillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  sop: z.string().min(1, "SOP required"),
  mutating: z.boolean(),
  approval_required: z.boolean(),
  published_by: z.string().min(1),
  visibility: z.enum(["private", "public"]),
  team_id: z.string().optional(),
  hooks_json: z.string().optional(),
  tools: z.array(z.object({ name: z.string().min(1), version: z.string().min(1) })),
});

type SkillForm = z.infer<typeof skillSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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

function parseJsonish<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function parseSkillMarkdown(markdown: string): SkillForm {
  const { attrs, body } = parseFrontmatter(markdown);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const rawName = attrs.name || heading || "imported-skill";
  const name = slugify(rawName) || "imported-skill";
  const description =
    attrs.description ||
    body.replace(/^#\s+.+$/m, "").split(/\n\s*\n/).map((p) => p.trim()).find(Boolean) ||
    `Imported skill ${name}`;
  return {
    id: attrs.id || name,
    name,
    version: attrs.version || "1.0.0",
    description,
    sop: attrs.sop || body.trim(),
    mutating: attrs.mutating === "true",
    approval_required: attrs.approval_required === "true",
    published_by: attrs.published_by || "studio-user",
    visibility: attrs.visibility === "public" ? "public" : "private",
    team_id: attrs.team_id || "",
    hooks_json: JSON.stringify(parseJsonish(attrs.hooks, []), null, 2),
    tools: parseJsonish(attrs.tools, [{ name: "", version: "1.0.0" }]),
  };
}

function githubRawCandidates(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const blobIdx = parts.indexOf("blob");
      const treeIdx = parts.indexOf("tree");
      if (parts.length >= 5 && blobIdx === 2) {
        const [owner, repo, , branch, ...rest] = parts;
        return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest.join("/")}`];
      }
      if (parts.length >= 5 && treeIdx === 2) {
        const [owner, repo, , branch, ...rest] = parts;
        if (rest[rest.length - 1]?.toLowerCase().endsWith(".md")) {
          return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest.join("/")}`];
        }
        return ["SKILL.md", "skill.md"].map(
          (f) => `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${[...rest, f].join("/")}`
        );
      }
    }
  } catch { return [url]; }
  return [url];
}

async function fetchSkillMarkdownFromUrl(url: string) {
  const candidates = githubRawCandidates(url);
  for (const c of candidates) {
    const r = await fetch(c);
    if (r.ok) return r.text();
    if (r.status !== 404) throw new Error(`Failed to fetch Skill.md (${r.status})`);
  }
  throw new Error("SKILL.md not found at the provided URL");
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  staged: "bg-yellow-500/15 text-yellow-500",
  active: "bg-green-500/15 text-green-400",
  paused: "bg-orange-500/15 text-orange-400",
  archived: "bg-muted text-muted-foreground line-through",
};

const CATEGORY_COLORS: Record<string, string> = {
  "data": "bg-blue-500/15 text-blue-400",
  "ops": "bg-orange-500/15 text-orange-400",
  "ai": "bg-violet-500/15 text-violet-400",
  "security": "bg-red-500/15 text-red-400",
  "integration": "bg-teal-500/15 text-teal-400",
  "default": "bg-muted text-muted-foreground",
};

const SKILL_AVATARS = ["bg-violet-500/20", "bg-blue-500/20", "bg-teal-500/20", "bg-orange-500/20", "bg-pink-500/20"];

function skillAvatar(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
  return SKILL_AVATARS[Math.abs(hash) % SKILL_AVATARS.length];
}

function groupSkillsByName(skills: SkillManifest[]) {
  return skills.reduce<Record<string, SkillManifest[]>>((acc, skill) => {
    acc[skill.name] = [...(acc[skill.name] ?? []), skill].sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true })
    );
    return acc;
  }, {});
}

// ── SkillCard ─────────────────────────────────────────────────────────────────

function SkillCard({
  name,
  versions,
  currentTenant,
  onStage,
  onActivate,
  isAdminManaged,
}: {
  name: string;
  versions: SkillManifest[];
  currentTenant: string;
  onStage: (id: string) => void;
  onActivate: (id: string) => void;
  isAdminManaged: boolean;
}) {
  const latest = versions[0];
  const [expanded, setExpanded] = useState(false);
  const avatarColor = skillAvatar(name);

  return (
    <div className={`catalog-card group ${isAdminManaged ? "catalog-card-admin" : ""}`}>
      {isAdminManaged && (
        <div className="flex items-center gap-1.5 mb-3">
          <Shield className="h-3 w-3 text-violet-400" />
          <span className="text-[10px] font-medium text-violet-400 uppercase tracking-wider">Admin Managed</span>
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${avatarColor}`}>
          <Zap className="h-5 w-5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium text-sm font-mono truncate">{name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{latest.description}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className={`status-badge ${STATUS_COLORS[latest.status] ?? "bg-muted text-muted-foreground"}`}>
                {latest.status}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-[10px] font-mono text-muted-foreground">v{latest.version}</span>
            {versions.length > 1 && (
              <span className="text-[10px] text-muted-foreground">+{versions.length - 1} more</span>
            )}
            {latest.visibility === "public" ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Globe2 className="h-3 w-3" /> public
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Lock className="h-3 w-3" /> private
              </span>
            )}
            {latest.mutating && (
              <span className="status-badge bg-orange-500/15 text-orange-400">mutating</span>
            )}
            {latest.approval_required && (
              <span className="status-badge bg-blue-500/15 text-blue-400">approval</span>
            )}
            {latest.team_id && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Users className="h-3 w-3" /> {latest.team_id}
              </span>
            )}
          </div>

          {latest.tools?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {latest.tools.slice(0, 3).map((t) => (
                <span key={t.name + t.version} className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">
                  {t.name}
                </span>
              ))}
              {latest.tools.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{latest.tools.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {versions.length} version{versions.length !== 1 ? "s" : ""}
        </button>
        <div className="flex items-center gap-1.5">
          <SkillDetailSheet skill={latest} />
          {!isAdminManaged && latest.status !== "archived" && (
            <EditSkillSheet skill={latest} onUpdated={() => {}} />
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-1.5">
          {versions.map((skill) => {
            const owned = skill.tenant_id === currentTenant && skill.scope !== "system";
            return (
              <div key={skill.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">v{skill.version}</span>
                  <span className={`status-badge ${STATUS_COLORS[skill.status] ?? ""}`}>{skill.status}</span>
                  {!owned && <Badge variant="outline" className="text-[10px]">read-only</Badge>}
                </div>
                {owned && (
                  <div className="flex items-center gap-1">
                    {skill.status === "draft" && (
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => onStage(skill.id)}>
                        Stage
                      </Button>
                    )}
                    {skill.status === "staged" && (
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => onActivate(skill.id)}>
                        Activate
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SkillDetailSheet ──────────────────────────────────────────────────────────

function SkillDetailSheet({ skill }: { skill: SkillManifest }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" />}>
        <Eye className="h-3.5 w-3.5" />
        View
      </SheetTrigger>
      <SheetContent className="w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono">{skill.name}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 text-sm space-y-5 mt-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">v{skill.version}</Badge>
            <Badge variant={skill.scope === "system" ? "secondary" : "outline"}>
              {skill.scope === "system" ? "admin" : "tenant"}
            </Badge>
            <Badge variant="outline">{skill.visibility ?? "private"}</Badge>
            <Badge variant="outline">{skill.status}</Badge>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Description</div>
            <p className="text-muted-foreground">{skill.description}</p>
          </div>
          {skill.sop && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">SOP</div>
              <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                {skill.sop}
              </pre>
            </div>
          )}
          {skill.tools?.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Tools</div>
              <div className="flex flex-wrap gap-1.5">
                {skill.tools.map((t) => (
                  <span key={`${t.name}-${t.version}`} className="rounded bg-muted px-2 py-1 text-xs font-mono">
                    {t.name}@{t.version}
                  </span>
                ))}
              </div>
            </div>
          )}
          {skill.hooks && skill.hooks.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Hooks</div>
              <div className="flex flex-wrap gap-1.5">
                {skill.hooks.map((h, i) => (
                  <span key={`${h.phase}-${h.type}-${i}`} className="rounded bg-muted px-2 py-1 text-xs font-mono">
                    {h.phase}:{h.type}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border border-border bg-card p-2">Mutating: {skill.mutating ? "Yes" : "No"}</div>
            <div className="rounded border border-border bg-card p-2">Approval: {skill.approval_required ? "Required" : "None"}</div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── SkillFormFields ───────────────────────────────────────────────────────────

function SkillFormFields({
  register,
  control,
  errors,
  approvedTools,
}: {
  register: ReturnType<typeof useForm<SkillForm>>["register"];
  control: ReturnType<typeof useForm<SkillForm>>["control"];
  errors: ReturnType<typeof useForm<SkillForm>>["formState"]["errors"];
  approvedTools?: { name: string }[];
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "tools" });

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Skill ID</Label>
          <Input placeholder="skill-uuid" {...register("id")} />
          {errors.id && <p className="text-xs text-destructive">{errors.id.message}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Version</Label>
          <Input placeholder="1.0.0" {...register("version")} />
          {errors.version && <p className="text-xs text-destructive">{errors.version.message}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Name</Label>
        <Input placeholder="query-slow-logs" {...register("name")} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Description</Label>
        <Input placeholder="Short description" {...register("description")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Standard Operating Procedure (SOP)</Label>
        <Textarea rows={5} placeholder="Step-by-step instructions the agent follows..." {...register("sop")} />
        {errors.sop && <p className="text-xs text-destructive">{errors.sop.message}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Tools</Label>
          <button
            type="button"
            onClick={() => append({ name: "", version: "1.0.0" })}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Add Tool
          </button>
        </div>
        {approvedTools && approvedTools.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Approved: {approvedTools.map((t) => t.name).join(", ")}
          </p>
        )}
        {fields.map((field, i) => (
          <div key={field.id} className="flex gap-2">
            <Input placeholder="tool-name" {...register(`tools.${i}.name`)} className="flex-1" />
            <Input placeholder="1.0.0" {...register(`tools.${i}.version`)} className="w-24" />
            <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" {...register("mutating")} /> Mutating (HITL required)
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" {...register("approval_required")} /> Approval Required
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Visibility</Label>
          <select {...register("visibility")} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="private">Private to team</option>
            <option value="public">Public marketplace</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Team ID</Label>
          <Input placeholder="default-team" {...register("team_id")} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Hooks JSON</Label>
        <Textarea rows={4} placeholder='[{"phase":"pre","type":"audit_log"}]' {...register("hooks_json")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Published By</Label>
        <Input placeholder="platform-admin" {...register("published_by")} />
      </div>
    </>
  );
}

// ── CreateSkillSheet ──────────────────────────────────────────────────────────

function CreateSkillSheet({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const { register, handleSubmit, reset, control, setValue, formState: { errors } } = useForm<SkillForm>({
    resolver: zodResolver(skillSchema),
    defaultValues: {
      mutating: false, approval_required: false, visibility: "private",
      team_id: "", hooks_json: "[]", tools: [{ name: "", version: "1.0.0" }],
    },
  });

  const { data: approvedTools } = useQuery({
    queryKey: ["tools", "approved"],
    queryFn: () => toolsApi.list("approved"),
  });

  const mutation = useMutation({
    mutationFn: (data: SkillForm) => {
      const { hooks_json, ...rest } = data;
      return skillsApi.create({ ...rest, hooks: JSON.parse(hooks_json || "[]") });
    },
    onSuccess: () => { reset(); setOpen(false); onCreated(); },
  });

  function applySkillMarkdown(markdown: string) {
    const parsed = parseSkillMarkdown(markdown);
    (Object.keys(parsed) as Array<keyof SkillForm>).forEach((k) => setValue(k, parsed[k] as never));
    setImportError(null);
    setImportSuccess("Imported SKILL.md — review fields then create.");
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-4 w-4" />
        New Skill
      </SheetTrigger>
      <SheetContent className="w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Skill</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="mt-6 flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Upload className="h-4 w-4" />
              Import Skill.md
            </div>
            <div className="flex gap-2">
              <Input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="GitHub file or folder URL…"
                className="flex-1"
              />
              <Button
                type="button" variant="outline" size="sm"
                onClick={async () => {
                  if (!importUrl.trim()) return;
                  setImportError(null); setImportSuccess(null);
                  try { applySkillMarkdown(await fetchSkillMarkdownFromUrl(importUrl.trim())); }
                  catch (e) { setImportError(e instanceof Error ? e.message : "Failed to import"); }
                }}
              >
                <LinkIcon className="h-4 w-4" />
              </Button>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-background">
              <Upload className="h-4 w-4" />
              Upload .md file
              <input type="file" accept=".md,.markdown,text/markdown,text/plain" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) f.text().then(applySkillMarkdown);
                }}
              />
            </label>
            {importError && <p className="text-xs text-destructive">{importError}</p>}
            {importSuccess && <p className="text-xs text-green-600">{importSuccess}</p>}
          </div>

          <SkillFormFields register={register} control={control} errors={errors} approvedTools={approvedTools} />

          {mutation.error && <p className="text-xs text-destructive">{String(mutation.error)}</p>}
          <Button type="submit" disabled={mutation.isPending} className="mt-2">
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Skill
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── EditSkillSheet ────────────────────────────────────────────────────────────

function EditSkillSheet({ skill, onUpdated }: { skill: SkillManifest; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, control, formState: { errors } } = useForm<SkillForm>({
    resolver: zodResolver(skillSchema),
    values: {
      id: skill.id,
      name: skill.name,
      version: skill.version,
      description: skill.description,
      sop: skill.sop,
      mutating: skill.mutating,
      approval_required: skill.approval_required,
      published_by: skill.published_by,
      visibility: skill.visibility ?? "private",
      team_id: skill.team_id ?? "",
      hooks_json: JSON.stringify(skill.hooks ?? [], null, 2),
      tools: skill.tools ?? [],
    },
  });

  const { data: approvedTools } = useQuery({
    queryKey: ["tools", "approved"],
    queryFn: () => toolsApi.list("approved"),
  });

  const mutation = useMutation({
    mutationFn: (data: SkillForm) => {
      const { hooks_json, ...rest } = data;
      return skillsApi.update(skill.id, { ...rest, hooks: JSON.parse(hooks_json || "[]"), status: skill.status });
    },
    onSuccess: () => { setOpen(false); onUpdated(); },
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" variant="ghost" className="h-7 w-7 p-0" />}>
        <Edit2 className="h-3.5 w-3.5" />
      </SheetTrigger>
      <SheetContent className="w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Skill</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="mt-6 flex flex-col gap-4">
          <SkillFormFields register={register} control={control} errors={errors} approvedTools={approvedTools} />
          {mutation.error && <p className="text-xs text-destructive">{String(mutation.error)}</p>}
          <Button type="submit" disabled={mutation.isPending} className="mt-2">
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const FILTER_OPTIONS = ["all", "active", "draft", "staged", "public", "private", "mutating"] as const;
type FilterOption = typeof FILTER_OPTIONS[number];

export default function SkillsPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
  const currentTenant = getRuntimeTenant();

  const { data: skills, isLoading, isError } = useQuery({
    queryKey: ["skills", "available"],
    queryFn: () => skillsApi.available(),
  });

  const filtered = useMemo(() => {
    const all = skills ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((skill) => {
      if (q && !skill.name.toLowerCase().includes(q) &&
          !skill.description.toLowerCase().includes(q) &&
          !skill.tools?.some((t) => t.name.toLowerCase().includes(q))) return false;
      if (activeFilter === "active") return skill.status === "active";
      if (activeFilter === "draft") return skill.status === "draft";
      if (activeFilter === "staged") return skill.status === "staged";
      if (activeFilter === "public") return skill.visibility === "public";
      if (activeFilter === "private") return skill.visibility !== "public";
      if (activeFilter === "mutating") return skill.mutating;
      return true;
    });
  }, [skills, query, activeFilter]);

  const grouped = groupSkillsByName(filtered);
  const adminSkills = (skills ?? []).filter((s) => s.scope === "system");
  const featuredNames = Object.keys(grouped).filter(
    (n) => grouped[n][0].status === "active" && grouped[n][0].scope === "system"
  ).slice(0, 3);

  const stageMutation = useMutation({
    mutationFn: (id: string) => skillsApi.transition(id, { target_state: "staged", actor: "studio-user" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
  const activateMutation = useMutation({
    mutationFn: (id: string) => skillsApi.transition(id, { target_state: "active", actor: "studio-user" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["skills"] });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15">
              <Zap className="h-4 w-4 text-violet-400" />
            </div>
            <h1 className="text-xl font-semibold">Skills Catalog</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Discover, compose, and manage skills — reusable AI capabilities that agents execute via the skill dispatcher.
          </p>
        </div>
        <CreateSkillSheet onCreated={invalidate} />
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Skills", value: Object.keys(groupSkillsByName(skills ?? [])).length },
          { label: "Active", value: (skills ?? []).filter((s) => s.status === "active").length },
          { label: "Admin Managed", value: adminSkills.length },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Featured admin skills */}
      {featuredNames.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Star className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-medium">Featured</span>
            <Badge variant="secondary" className="text-xs">Admin curated</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {featuredNames.map((name) => {
              const latest = grouped[name][0];
              return (
                <div key={name} className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-3.5 w-3.5 text-violet-400" />
                    <span className="text-[10px] font-medium text-violet-400 uppercase tracking-wider">Admin Managed</span>
                  </div>
                  <p className="font-mono text-sm font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{latest.description}</p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-[10px] font-mono text-muted-foreground">v{latest.version}</span>
                    <SkillDetailSheet skill={latest} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Separator />

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills, tools, descriptions…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`filter-chip ${activeFilter === f ? "filter-chip-active" : ""}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      {!isLoading && (
        <p className="text-xs text-muted-foreground">
          {Object.keys(grouped).length} skill{Object.keys(grouped).length !== 1 ? "s" : ""}
          {activeFilter !== "all" || query ? ` matching "${activeFilter !== "all" ? activeFilter : query}"` : ""}
        </p>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load skills. Is skill-catalog running on :8087?
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && Object.keys(grouped).length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
            <Zap className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No skills found</p>
          <p className="text-xs text-muted-foreground mt-1">
            {query || activeFilter !== "all" ? "Try adjusting your search or filters." : "Click New Skill to compose one from tools."}
          </p>
        </div>
      )}

      {/* Grid */}
      {!isLoading && !isError && Object.keys(grouped).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Object.entries(grouped).map(([name, versions]) => (
            <SkillCard
              key={name}
              name={name}
              versions={versions}
              currentTenant={currentTenant}
              onStage={(id) => stageMutation.mutate(id)}
              onActivate={(id) => activateMutation.mutate(id)}
              isAdminManaged={versions[0].scope === "system"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
