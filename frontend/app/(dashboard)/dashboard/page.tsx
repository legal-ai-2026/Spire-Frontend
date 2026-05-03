"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Crosshair, Database, Shield, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { Assessment, BattlespaceSession, Mission, Soldier } from "@/types";

export default function DashboardPage() {
  const [soldiers, setSoldiers]     = useState<Soldier[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [missions, setMissions]     = useState<Mission[]>([]);
  const [sessions, setSessions]     = useState<BattlespaceSession[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get<Soldier[]>("/api/v1/soldiers"),
      api.get<Assessment[]>("/api/v1/assessments"),
      api.get<Mission[]>("/api/v1/missions"),
      api.get<BattlespaceSession[]>("/api/v1/battlespace"),
    ]).then(([s, a, m, bs]) => {
      if (s.status === "fulfilled") setSoldiers(s.value);
      if (a.status === "fulfilled") setAssessments(a.value);
      if (m.status === "fulfilled") setMissions(m.value);
      if (bs.status === "fulfilled") setSessions(bs.value);
    }).finally(() => setLoading(false));
  }, []);

  const activeSessions = sessions.filter(s => s.status === "active").length;
  const activeMissions = missions.filter(m => m.status === "active" || m.status === "planning").length;
  const recentAssessments = assessments.slice(0, 5);

  const phases = [
    {
      num: "01",
      title: "Data Capture & Training",
      color: "border-[#3fb950] text-[#3fb950]",
      bg: "bg-[#3fb950]/10",
      stats: [
        { label: "Active Soldiers", value: soldiers.filter(s => s.is_active).length },
        { label: "Assessments", value: assessments.length },
      ],
      links: [
        { href: "/soldiers", label: "Soldier Roster" },
        { href: "/assess",   label: "New Assessment" },
      ],
      description: "Capture training data via OCR, voice, and manual entry. AI scores leadership across 5 dimensions.",
    },
    {
      num: "02",
      title: "Team Optimization",
      color: "border-[#f59e0b] text-[#f59e0b]",
      bg: "bg-[#f59e0b]/10",
      stats: [
        { label: "Active Missions", value: activeMissions },
        { label: "Teams Built", value: missions.filter(m => m.selected_composition_id).length },
      ],
      links: [
        { href: "/teams", label: "Mission Planner" },
      ],
      description: "ML-scored team selection for mission-specific fit. Explainable rationale for every recommendation.",
    },
    {
      num: "03",
      title: "Adversarial Co-Pilot",
      color: "border-[#f85149] text-[#f85149]",
      bg: "bg-[#f85149]/10",
      stats: [
        { label: "Active Sessions", value: activeSessions },
        { label: "Total Sessions", value: sessions.length },
      ],
      links: [
        { href: "/battlespace", label: "Battlespace" },
      ],
      description: "Real-time adversarial simulation. AI surfaces risk vectors and recommends adaptive actions.",
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#8b949e]">Loading intelligence…</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight">C2D2 Dashboard</h1>
        <p className="text-[#8b949e] text-sm mt-0.5">
          AI-Powered Force Intelligence Platform
        </p>
      </div>

      {/* Phase Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {phases.map(phase => (
          <div
            key={phase.num}
            className={`bg-[#161b22] border-l-4 ${phase.color} rounded-lg p-5`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <span className={`text-xs font-bold uppercase tracking-widest ${phase.color}`}>
                  Phase {phase.num}
                </span>
                <h3 className="text-white font-semibold mt-0.5">{phase.title}</h3>
              </div>
            </div>
            <p className="text-[#8b949e] text-xs mb-4 leading-relaxed">{phase.description}</p>
            <div className="flex gap-4 mb-4">
              {phase.stats.map(stat => (
                <div key={stat.label} className={`flex-1 ${phase.bg} rounded-md px-3 py-2`}>
                  <div className="text-xl font-bold text-white">{stat.value}</div>
                  <div className="text-[10px] text-[#8b949e] uppercase tracking-wide">{stat.label}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              {phase.links.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-xs px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-white rounded-md transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Assessments */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg">
        <div className="px-5 py-4 border-b border-[#30363d] flex items-center gap-2">
          <Activity size={16} className="text-[#8b949e]" />
          <h2 className="text-sm font-semibold text-white">Recent Assessments</h2>
        </div>
        {recentAssessments.length === 0 ? (
          <div className="px-5 py-8 text-center text-[#8b949e] text-sm">
            No assessments yet.{" "}
            <Link href="/assess" className="text-[#3fb950] hover:underline">
              Create one
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[#30363d]">
            {recentAssessments.map(a => (
              <div key={a.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <span className="text-xs text-[#8b949e] uppercase">{a.assessment_type}</span>
                  <span className="ml-2 text-xs text-[#6e7681] capitalize">
                    via {a.capture_method.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex gap-4 text-xs">
                  {a.score_leadership != null && (
                    <span className="text-[#3fb950]">
                      Leadership: {a.score_leadership.toFixed(1)}
                    </span>
                  )}
                  {a.ai_analyzed && (
                    <span className="text-[#f59e0b]">AI Scored</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
