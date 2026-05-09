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
  Wrench,
} from "lucide-react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const key = sessionStorage.getItem("admin_api_key");
    if (!key) {
      router.push("/login");
    }
  }, [router]);

  function handleLogout() {
    sessionStorage.removeItem("admin_api_key");
    router.push("/login");
  }

  const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Tenants", href: "/tenants", icon: Users },
    { label: "LLM Config", href: "/llm-config", icon: Settings },
    { label: "System Agents", href: "/system-agents", icon: Zap },
    { label: "System Tools", href: "/system-tools", icon: Wrench },
    { label: "System Skills", href: "/system-skills", icon: Zap },
    { label: "Executions", href: "/executions", icon: BarChart3 },
    { label: "Cost Tracking", href: "/cost", icon: BarChart3 },
    { label: "MCP Servers", href: "/mcp-servers", icon: Server },
    { label: "Audit Log", href: "/audit", icon: FileText },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-border">
          <h1 className="text-lg font-bold">Admin Console</h1>
          <p className="text-xs text-muted-foreground mt-1">
            A1 Agent Engine
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-border">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-16 border-b border-border bg-card px-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {navItems.find((item) => item.href === pathname)?.label ||
              "Dashboard"}
          </h2>
          <div className="text-xs text-muted-foreground">
            Logged in as Platform Admin
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
