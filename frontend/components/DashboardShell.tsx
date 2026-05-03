"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode } from "react";
import {
  Activity, BarChart2, Bot, Brain, CalendarCheck, CalendarDays, Crosshair, Database,
  LayoutDashboard, LogOut, Network, Shield, Target, Users,
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

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0d1117]">
      {/* Sidebar — icon-only on mobile, full on md+ */}
      <aside className="flex-shrink-0 flex flex-col bg-[#161b22] border-r border-[#30363d] w-14 md:w-56 overflow-y-auto">
        {/* Logo */}
        <div className="px-0 md:px-4 py-4 md:py-5 border-b border-[#30363d] flex items-center justify-center md:justify-start">
          <div className="text-base md:text-xl font-black text-white tracking-tight">C2</div>
          <div className="hidden md:block">
            <span className="text-xl font-black text-white tracking-tight">D2</span>
            <div className="text-[10px] text-[#8b949e] uppercase tracking-widest mt-0.5">
              Combat Decision Dominance
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-1 md:px-2 py-4">
          {NAV.map(({ href, label, icon: Icon, phase, group }, idx) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            const prevGroup = idx > 0 ? NAV[idx - 1].group : null;
            const showDivider = group !== null && group !== prevGroup && idx > 0;
            return (
              <div key={href}>
                {showDivider && (
                  <div className="mx-2 my-2 border-t border-[#21262d]" />
                )}
                <Link
                  href={href}
                  title={label}
                  className={`flex items-center justify-center md:justify-start gap-3 px-0 md:px-3 py-2 rounded-md text-sm transition-colors ${
                    active
                      ? "bg-[#21262d] text-white"
                      : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
                  }`}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  <span className="hidden md:block flex-1 leading-tight">{label}</span>
                  {phase && (
                    <span className={`hidden md:block text-[10px] font-bold ${PHASE_COLORS[phase] ?? ""}`}>
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
          <div className="px-1 md:px-4 py-3 border-t border-[#30363d] flex flex-col items-center md:items-start">
            <div className="hidden md:block text-xs text-[#8b949e] truncate w-full">{user.full_name ?? user.email}</div>
            <div className="hidden md:block text-[10px] text-[#3fb950] uppercase mt-0.5">{user.role}</div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="mt-1 md:mt-2 flex items-center gap-1.5 text-[11px] text-[#8b949e] hover:text-[#f85149] transition-colors"
            >
              <LogOut size={14} />
              <span className="hidden md:inline">Sign out</span>
            </button>
          </div>
        )}
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {children}
      </main>
    </div>
  );
}
