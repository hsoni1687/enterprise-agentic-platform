"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Zap, Wrench, Shield, Network, Webhook, Cable,
  ChevronDown, ChevronRight, Loader2, GripVertical,
} from "lucide-react";
import { skillsApi, toolsApi, platformApi, mcpApi, kgApi } from "@/lib/api";
import { Input } from "@/components/ui/input";
import type { DragPrimitive, PrimitiveType, AgentBuilderState } from "./use-agent-builder";
import { PRIMITIVE_CONFIG, dragTracker } from "./use-agent-builder";

// ── Section config ─────────────────────────────────────────────────────────────

interface SectionDef {
  type: PrimitiveType;
  label: string;
  icon: typeof Zap;
}

const SECTIONS: SectionDef[] = [
  { type: "skill",          label: "Skills",          icon: Zap     },
  { type: "tool",           label: "Tools",            icon: Wrench  },
  { type: "guardrail",      label: "Guardrails",       icon: Shield  },
  { type: "knowledge_graph",label: "Knowledge Graphs", icon: Network },
  { type: "hook",           label: "Hooks",            icon: Webhook },
  { type: "mcp",            label: "MCP Servers",      icon: Cable   },
];

// ── Drag helpers ──────────────────────────────────────────────────────────────

function startDrag(e: React.DragEvent, primitive: DragPrimitive) {
  e.dataTransfer.setData("application/reactflow", JSON.stringify(primitive));
  e.dataTransfer.effectAllowed = "move";
  dragTracker.set(primitive.primitiveType);
}

function endDrag() {
  dragTracker.set(null);
}

// ── Library Item ──────────────────────────────────────────────────────────────

function LibraryItem({
  primitive,
  alreadyAdded,
}: {
  primitive: DragPrimitive;
  alreadyAdded: boolean;
}) {
  const cfg = PRIMITIVE_CONFIG[primitive.primitiveType];
  const Icon = SECTIONS.find((s) => s.type === primitive.primitiveType)?.icon ?? Zap;

  return (
    <div
      draggable={!alreadyAdded}
      onDragStart={(e) => !alreadyAdded && startDrag(e, primitive)}
      onDragEnd={endDrag}
      className="group flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-all duration-150 select-none"
      style={{
        cursor: alreadyAdded ? "default" : "grab",
        opacity: alreadyAdded ? 0.45 : 1,
        background: alreadyAdded ? "transparent" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!alreadyAdded)
          (e.currentTarget as HTMLElement).style.background = `${cfg.color}12`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <GripVertical className="h-3 w-3 text-white/15 shrink-0 group-hover:text-white/30 transition-colors" />
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.color}25` }}
      >
        <Icon className="h-3 w-3" style={{ color: cfg.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white/80 truncate font-medium">{primitive.name}</div>
        {primitive.version && (
          <div className="text-[10px] text-white/30 font-mono">v{primitive.version}</div>
        )}
      </div>
      {alreadyAdded && (
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
          style={{ background: `${cfg.color}15`, color: cfg.color }}
        >
          Added
        </span>
      )}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function LibrarySection({
  section,
  items,
  search,
  addedIds,
}: {
  section: SectionDef;
  items: DragPrimitive[];
  search: string;
  addedIds: Set<string>;
}) {
  const [open, setOpen] = useState(true);
  const cfg = PRIMITIVE_CONFIG[section.type];
  const Icon = section.icon;

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          !search ||
          i.name.toLowerCase().includes(search.toLowerCase()) ||
          (i.description ?? "").toLowerCase().includes(search.toLowerCase())
      ),
    [items, search]
  );

  if (filtered.length === 0 && search) return null;

  return (
    <div className="mb-1">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 rounded-md transition-colors hover:bg-white/5"
        onClick={() => setOpen((o) => !o)}
      >
        <div
          className="flex h-5 w-5 items-center justify-center rounded"
          style={{ background: `${cfg.color}18` }}
        >
          <Icon className="h-3 w-3" style={{ color: cfg.color }} />
        </div>
        <span className="flex-1 text-left text-xs font-semibold text-white/70">{section.label}</span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ background: `${cfg.color}15`, color: `${cfg.color}cc` }}
        >
          {filtered.length}
        </span>
        {open ? (
          <ChevronDown className="h-3 w-3 text-white/25" />
        ) : (
          <ChevronRight className="h-3 w-3 text-white/25" />
        )}
      </button>

      {open && (
        <div className="mt-0.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-2 text-[11px] text-white/25 italic">None available</div>
          ) : (
            filtered.map((item) => (
              <LibraryItem
                key={`${item.primitiveType}-${item.id}`}
                primitive={item}
                alreadyAdded={addedIds.has(`${item.primitiveType}-${item.id}`)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface Props {
  state: AgentBuilderState;
}

export function PrimitiveLibraryPanel({ state }: Props) {
  const { attached } = state;
  const [search, setSearch] = useState("");

  const { data: skills = [], isLoading: loadingSkills } = useQuery({
    queryKey: ["builder-skills"],
    queryFn: () => skillsApi.listWithSystem("active"),
  });

  const { data: tools = [], isLoading: loadingTools } = useQuery({
    queryKey: ["builder-tools"],
    queryFn: () => toolsApi.list("active"),
  });

  const { data: guardrails = [], isLoading: loadingGuardrails } = useQuery({
    queryKey: ["builder-guardrails"],
    queryFn: () => platformApi.listGuardrails(),
  });

  const { data: kgs = [], isLoading: loadingKGs } = useQuery({
    queryKey: ["builder-kgs"],
    queryFn: () => kgApi.listGraphs(),
  });

  const { data: mcpResult, isLoading: loadingMCP } = useQuery({
    queryKey: ["builder-mcp"],
    queryFn: () => mcpApi.listServers(),
  });
  const mcpList = mcpResult?.servers ?? [];

  const isLoading =
    loadingSkills || loadingTools || loadingGuardrails || loadingKGs || loadingMCP;

  // Build typed primitive lists
  const skillItems: DragPrimitive[] = useMemo(
    () =>
      skills.map((s) => ({
        id: s.id,
        name: s.name,
        version: s.version,
        description: s.description,
        primitiveType: "skill" as PrimitiveType,
      })),
    [skills]
  );

  const toolItems: DragPrimitive[] = useMemo(
    () =>
      tools.map((t) => ({
        id: t.id,
        name: t.name,
        version: t.version,
        description: t.description,
        primitiveType: "tool" as PrimitiveType,
      })),
    [tools]
  );

  const guardrailItems: DragPrimitive[] = useMemo(
    () =>
      guardrails.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        primitiveType: "guardrail" as PrimitiveType,
      })),
    [guardrails]
  );

  const kgItems: DragPrimitive[] = useMemo(
    () =>
      kgs.map((k) => ({
        id: k.id,
        name: k.name,
        description: k.description ?? "",
        primitiveType: "knowledge_graph" as PrimitiveType,
      })),
    [kgs]
  );

  const mcpItems: DragPrimitive[] = useMemo(
    () =>
      mcpList.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.url ?? "",
        primitiveType: "mcp" as PrimitiveType,
      })),
    [mcpList]
  );

  // Track which primitives are already attached
  const addedIds = useMemo(() => {
    const set = new Set<string>();
    attached.forEach((a) => set.add(`${a.primitiveType}-${a.id}`));
    return set;
  }, [attached]);

  const sectionData: Record<PrimitiveType, DragPrimitive[]> = {
    skill:          skillItems,
    tool:           toolItems,
    guardrail:      guardrailItems,
    knowledge_graph: kgItems,
    hook:           [],
    mcp:            mcpItems,
  };

  return (
    <div
      className="flex flex-col h-full border-r"
      style={{
        width: 264,
        minWidth: 264,
        background: "rgba(8,8,14,0.97)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      {/* Header */}
      <div
        className="px-4 pt-4 pb-3 border-b"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <div className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2.5">
          Component Library
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/25" />
          <Input
            className="h-8 pl-8 text-xs border-white/10 bg-white/5 placeholder:text-white/20 text-white/80 focus:border-violet-500/40"
            placeholder="Search primitives…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Instruction */}
      <div
        className="px-4 py-2 border-b"
        style={{ borderColor: "rgba(255,255,255,0.04)" }}
      >
        <p className="text-[10px] text-white/25 leading-relaxed">
          Drag items onto the canvas to attach them to your agent.
        </p>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5 scrollbar-thin">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-white/25">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading…</span>
          </div>
        ) : (
          SECTIONS.map((section) => (
            <LibrarySection
              key={section.type}
              section={section}
              items={sectionData[section.type]}
              search={search}
              addedIds={addedIds}
            />
          ))
        )}
      </div>

      {/* Footer count */}
      <div
        className="px-4 py-2.5 border-t text-[10px] text-white/20"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        {attached.length} primitive{attached.length !== 1 ? "s" : ""} attached
      </div>
    </div>
  );
}
