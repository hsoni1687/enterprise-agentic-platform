"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Wrench,
  Zap,
  Bot,
  MessageSquare,
  ScrollText,
  Settings,
  ChevronRight,
  CheckCircle,
  Network,
  BookOpen,
  Shield,
  Webhook,
  Cable,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TenantSelector } from "@/components/tenant-selector";

const navGroups = [
  {
    label: "Compose",
    items: [
      { href: "/tools", label: "Tools", icon: Wrench },
      { href: "/skills", label: "Skills", icon: Zap },
      { href: "/agents", label: "Agents", icon: Bot },
    ],
  },
  {
    label: "Validate",
    items: [
      { href: "/guardrails", label: "Guardrails", icon: Shield },
      { href: "/hooks", label: "Hooks", icon: Webhook },
    ],
  },
  {
    label: "Connect",
    items: [
      { href: "/mcp", label: "MCP Servers", icon: Cable },
      { href: "/knowledge-graphs", label: "Knowledge Graphs", icon: Network },
    ],
  },
  {
    label: "Monitor",
    items: [
      { href: "/chat", label: "Chat", icon: MessageSquare },
      { href: "/approvals", label: "Approvals", icon: CheckCircle },
      { href: "/logs", label: "Logs", icon: ScrollText },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/cookbooks", label: "Cookbooks", icon: BookOpen },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2 px-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary">
            <Bot className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          <span className="font-semibold text-sm tracking-tight group-data-[collapsible=icon]:hidden">
            Agent Studio
          </span>
        </div>
      </SidebarHeader>

      <Separator className="mb-2" />

      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-semibold px-2 group-data-[collapsible=icon]:hidden">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active =
                    pathname === href || pathname.startsWith(href + "/");
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={label}
                        render={<Link href={href} />}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                        {active && (
                          <ChevronRight className="ml-auto h-3 w-3 opacity-50" />
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex h-10 items-center border-b border-border px-4 shrink-0 justify-between">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="mr-3 h-7 w-7" />
              <Separator orientation="vertical" className="h-4 mr-3" />
              <BreadcrumbNav />
            </div>
            <div>
              <TenantSelector />
            </div>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function BreadcrumbNav() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="opacity-40">/</span>}
          <span
            className={
              i === segments.length - 1 ? "text-foreground font-medium" : ""
            }
          >
            {seg}
          </span>
        </span>
      ))}
    </nav>
  );
}
