"use client";
import { useEffect, useState } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { api } from "@/lib/api";
import type { BattalionOverview } from "@/types";

const LDR_FIELDS = ["Planning", "Attn to Detail", "Time Mgmt", "Decisiveness", "Tactics"];
const UNIT_COLORS = ["#3fb950", "#f59e0b", "#58a6ff", "#f85149", "#a371f7", "#e07b00"];

function ScoreCell({ v }: { v: number | undefined }) {
  if (v == null) return <span className="text-[#6e7681]">—</span>;
  const color = v >= 4 ? "#3fb950" : v >= 3 ? "#f59e0b" : "#f85149";
  return <span style={{ color }} className="font-bold">{v.toFixed(1)}</span>;
}

export default function BattalionOverviewPage() {
  const [data, setData]     = useState<BattalionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");

  useEffect(() => {
    api.get<BattalionOverview>("/api/v1/analysis/battalion")
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#8b949e]">Loading battalion overview…</div>;
  if (error)   return <div className="p-6 text-[#f85149]">{error}</div>;
  if (!data)   return null;

  // Bar chart: per-unit eval count
  const barData = data.units.map(u => ({
    unit: u.unit.replace(" Co", "").replace("Alpha", "A").replace("Bravo", "B").replace("Charlie", "C"),
    evals: u.eval_count,
  }));

  // Battalion radar
  const bnRadar = LDR_FIELDS.map(f => ({
    subject: f,
    "Leader Eval": data.battalion_leader_avg[f] ?? 0,
    "UMP":          data.battalion_ump_avg[f] ?? 0,
  }));

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-black text-white">Battalion Performance Overview</h1>
        <p className="text-[#8b949e] text-xs mt-0.5">Phase 01 — Cross-Unit Analysis · Battalion-Wide Metrics</p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Soldiers",  value: data.total_soldiers,  color: "#3fb950" },
          { label: "Total Evals",     value: data.total_evals,     color: "#f59e0b" },
          { label: "Units Reporting", value: data.units.filter(u => u.eval_count > 0).length, color: "#58a6ff" },
          { label: "Units Total",     value: data.units.length,    color: "#a371f7" },
        ].map(tile => (
          <div key={tile.label} className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <div className="text-3xl font-black" style={{ color: tile.color }}>{tile.value}</div>
            <div className="text-[10px] text-[#8b949e] uppercase tracking-wider mt-1">{tile.label}</div>
          </div>
        ))}
      </div>

      {/* Battalion radar + eval counts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Object.keys(data.battalion_leader_avg).length > 0 && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Battalion Average — Leader vs UMP</h3>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={bnRadar}>
                <PolarGrid stroke="#30363d" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "#8b949e", fontSize: 11 }} />
                <Radar name="Leader Eval" dataKey="Leader Eval" stroke="#3fb950" fill="#3fb950" fillOpacity={0.2} />
                <Radar name="UMP"         dataKey="UMP"         stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#8b949e" }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}

        {barData.some(d => d.evals > 0) && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Evaluations by Unit</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                <XAxis dataKey="unit" tick={{ fill: "#8b949e", fontSize: 11 }} />
                <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", fontSize: 11 }} />
                <Bar dataKey="evals" fill="#3fb950" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Per-unit overlaid radar comparison */}
      {(() => {
        const active = data.units.filter(u => Object.keys(u.leader_averages).length > 0);
        if (!active.length) return null;
        const companyRadar = LDR_FIELDS.map(f => {
          const entry: Record<string, string | number> = { subject: f };
          active.forEach(u => { entry[u.unit] = u.leader_averages[f] ?? 0; });
          return entry;
        });
        return (
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Company Performance Comparison</h3>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={companyRadar}>
                <PolarGrid stroke="#30363d" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "#8b949e", fontSize: 11 }} />
                {active.map((u, i) => (
                  <Radar
                    key={u.unit}
                    name={u.unit}
                    dataKey={u.unit}
                    stroke={UNIT_COLORS[i % UNIT_COLORS.length]}
                    fill={UNIT_COLORS[i % UNIT_COLORS.length]}
                    fillOpacity={0.2}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 11, color: "#8b949e" }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        );
      })()}

      {/* Summary table */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-[#30363d]">
          <h3 className="text-sm font-semibold text-white">Company Comparison</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#8b949e] uppercase text-[10px] tracking-wider border-b border-[#30363d]">
                <th className="text-left px-5 py-2">Unit</th>
                <th className="text-center px-3 py-2">Soldiers</th>
                <th className="text-center px-3 py-2">Evals</th>
                {LDR_FIELDS.map(f => <th key={f} className="text-center px-3 py-2 whitespace-nowrap">{f}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.units.map((u, i) => (
                <tr key={u.unit} className="border-b border-[#21262d] last:border-0 hover:bg-[#21262d]/50">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: UNIT_COLORS[i % UNIT_COLORS.length] }} />
                      <span className="text-[#c9d1d9] font-medium">{u.unit}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center text-[#8b949e]">{u.soldier_count}</td>
                  <td className="px-3 py-2.5 text-center text-[#8b949e]">{u.eval_count}</td>
                  {LDR_FIELDS.map(f => (
                    <td key={f} className="px-3 py-2.5 text-center">
                      <ScoreCell v={u.leader_averages[f]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
