"use client";

import { useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Settings,
  Zap,
  BarChart3,
  FileText,
  LogOut,
  Server,
  Hammer,
  Network,
  BookOpen,
  Shield,
  ChevronRight,
  Bot,
} from "lucide-react";

const navGroups = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Tenants", href: "/tenants", icon: Users },
    ],
  },
  {
    label: "Platform Catalog",
    items: [
      { label: "System Agents", href: "/system-agents", icon: Bot },
      { label: "System Skills", href: "/system-skills", icon: Zap },
      { label: "System Tools", href: "/system-tools", icon: Hammer },
      { label: "Knowledge Graphs", href: "/knowledge-graphs", icon: Network },
      { label: "Cookbooks", href: "/cookbooks", icon: BookOpen },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { label: "LLM Config", href: "/llm-config", icon: Settings },
      { label: "MCP Servers", href: "/mcp-servers", icon: Server },
    ],
  },
  {
    label: "Observability",
    items: [
      { label: "Executions", href: "/executions", icon: BarChart3 },
      { label: "Cost Tracking", href: "/cost", icon: BarChart3 },
      { label: "Audit Log", href: "/audit", icon: FileText },
    ],
  },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const key = sessionStorage.getItem("admin_api_key");
    if (!key) router.push("/login");
  }, [router]);

  function handleLogout() {
    sessionStorage.removeItem("admin_api_key");
    router.push("/login");
  }

  const allItems = navGroups.flatMap((g) => g.items);
  const currentLabel = allItems.find((item) => item.href === pathname)?.label ?? "Admin Console";

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "hsl(0,0%,9%)" }}>
      {/* Sidebar */}
      <aside className="w-60 flex flex-col shrink-0 border-r" style={{ background: "hsl(0,0%,11%)", borderColor: "rgba(255,255,255,0.08)" }}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(139,92,246,0.2)" }}>
            <Shield className="h-4 w-4 text-violet-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Admin Console</p>
            <p className="text-[10px] text-white/40">Platform Operations</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 px-2 mb-1.5">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ label, href, icon: Icon }) => {
                  const active = pathname === href;
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`nav-item ${active ? "nav-item-active" : ""}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{label}</span>
                      {active && <ChevronRight className="h-3 w-3 opacity-50 shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-3 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <button
            onClick={handleLogout}
            className="nav-item w-full"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Topbar */}
        <header
          className="flex h-10 shrink-0 items-center justify-between border-b px-6"
          style={{ background: "hsl(0,0%,11%)", borderColor: "rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white/40">Admin</span>
            <ChevronRight className="h-3 w-3 text-white/20" />
            <span className="font-medium text-white">{currentLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/30">Platform Admin</span>
            <div className="h-6 w-6 rounded-full bg-violet-500/20 flex items-center justify-center">
              <Shield className="h-3 w-3 text-violet-400" />
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
