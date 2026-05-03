"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useState } from "react";
import {
  Activity, BarChart2, Bot, Brain, CalendarCheck, CalendarDays, Crosshair, Database,
  LayoutDashboard, LogOut, Menu, Network, Shield, Target, Users, X,
} from "lucide-react";
import { useAuth } from "./AuthContext";

const NAV = [
  { href: "/dashboard",          label: "Dashboard",         icon: LayoutDashboard, phase: null,  group: null },
  { href: "/soldiers",           label: "Soldiers",          icon: Users,           phase: "01",  group: "data" },
  { href: "/assess",             label: "Evaluate",          icon: Database,        phase: "01",  group: "data" },
  { href: "/events",             label: "Training Events",   icon: CalendarCheck,   phase: "01",  group: "data" },
  { href: "/analysis/leader",    label: "Leader Analysis",   icon: Activity,        phase: "01",  group: "analysis" },
  { href: "/analysis/unit",      label: "Unit Analysis",     icon: BarChart2,       phase: "01",  group: "analysis" },
  { href: "/analysis/battalion", label: "Battalion Overview",icon: Target,          phase: "01",  group: "analysis" },
  { href: "/teams",              label: "Team Builder",      icon: Shield,          phase: "02",  group: "ops" },
  { href: "/training",           label: "Training Schedule", icon: CalendarDays,    phase: "02",  group: "ops" },
  { href: "/battlespace",        label: "Battlespace",       icon: Crosshair,       phase: "03",  group: "ops" },
  { href: "/ranger-training",    label: "Ranger AI",         icon: Bot,             phase: "S1",  group: "agents" },
  { href: "/cognitive-adapt",    label: "Cognitive Adapt",   icon: Brain,           phase: "S2",  group: "agents" },
  { href: "/ops-gateway",        label: "Ops Gateway",       icon: Network,         phase: "S3",  group: "agents" },
];

const PHASE_COLORS: Record<string, string> = {
  "01": "text-[#3fb950]",
  "02": "text-[#f59e0b]",
  "03": "text-[#f85149]",
  "S1": "text-[#58a6ff]",
  "S2": "text-[#a371f7]",
  "S3": "text-[#f59e0b]",
};

export default function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function handleLogout() {
    logout();
    router.push("/login");
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[#30363d] flex items-center justify-between">
        <div>
          <div className="text-xl font-black text-white tracking-tight">C2D2</div>
          <div className="text-[10px] text-[#8b949e] uppercase tracking-widest mt-0.5">
            Combat Decision Dominance
          </div>
        </div>
        <button
          onClick={closeSidebar}
          className="md:hidden p-1 text-[#8b949e] hover:text-white transition-colors"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon, phase, group }, idx) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          const prevGroup = idx > 0 ? NAV[idx - 1].group : null;
          const showDivider = group !== null && group !== prevGroup && idx > 0;
          return (
            <div key={href}>
              {showDivider && (
                <div className="mx-3 my-2 border-t border-[#21262d]" />
              )}
              <Link
                href={href}
                onClick={closeSidebar}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-[#21262d] text-white"
                    : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
                }`}
              >
                <Icon size={16} />
                <span className="flex-1 leading-tight">{label}</span>
                {phase && (
                  <span className={`text-[10px] font-bold ${PHASE_COLORS[phase] ?? ""}`}>
                    P{phase}
                  </span>
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* User */}
      {user && (
        <div className="px-4 py-3 border-t border-[#30363d]">
          <div className="text-xs text-[#8b949e] truncate">{user.full_name ?? user.email}</div>
          <div className="text-[10px] text-[#3fb950] uppercase mt-0.5">{user.role}</div>
          <button
            onClick={handleLogout}
            className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8b949e] hover:text-[#f85149] transition-colors"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#0d1117]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar — drawer on mobile, static on desktop */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 w-64 flex flex-col bg-[#161b22] border-r border-[#30363d]
          transform transition-transform duration-200 ease-in-out
          md:static md:w-56 md:translate-x-0 md:flex-shrink-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {sidebarContent}
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#161b22] border-b border-[#30363d] flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-[#8b949e] hover:text-white transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-black text-white tracking-tight">C2D2</span>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
