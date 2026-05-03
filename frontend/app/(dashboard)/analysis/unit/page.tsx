"use client";
import { useEffect, useState } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { api } from "@/lib/api";
import type { UnitAnalysis } from "@/types";

const LDR_FIELDS = ["Planning", "Attn to Detail", "Time Mgmt", "Decisiveness", "Tactics"];
const STROKE_COLORS = ["#3fb950", "#f59e0b", "#58a6ff", "#f85149", "#a371f7", "#e07b00", "#79c0ff"];

const PROFICIENCY_COLOR: Record<string, string> = {
  T:    "text-[#3fb950] bg-[#3fb950]/10",
  "P+": "text-[#58a6ff] bg-[#58a6ff]/10",
  P:    "text-[#f59e0b] bg-[#f59e0b]/10",
  "P-": "text-[#e07b00] bg-[#e07b00]/10",
  U:    "text-[#f85149] bg-[#f85149]/10",
};

export default function UnitAnalysisPage() {
  const [units, setUnits]   = useState<string[]>([]);
  const [unit, setUnit]     = useState("");
  const [data, setData]     = useState<UnitAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  useEffect(() => {
    api.get<{ unit?: string }[]>("/api/v1/soldiers").then(s => {
      const us = Array.from(new Set(s.map(x => x.unit ?? "Unknown"))).sort();
      setUnits(us);
      if (us.length) setUnit(us[0]);
    });
  }, []);

  useEffect(() => {
    if (!unit) return;
    setLoading(true); setError(""); setData(null);
    api.get<UnitAnalysis>(`/api/v1/analysis/unit?unit=${encodeURIComponent(unit)}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [unit]);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-black text-white">Unit Collective Analysis</h1>
        <p className="text-[#8b949e] text-xs mt-0.5">Phase 01 — Unit Performance · Leader Comparison · ST&EO Proficiency</p>
      </div>

      {/* Unit selector */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 flex items-center gap-4">
        <div>
          <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Unit</label>
          <select
            value={unit}
            onChange={e => setUnit(e.target.value)}
            className="px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
          >
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {data && (
          <div className="flex gap-6 ml-auto text-center">
            <div><div className="text-2xl font-black text-[#3fb950]">{data.soldier_count}</div><div className="text-[10px] text-[#8b949e]">Soldiers</div></div>
            <div><div className="text-2xl font-black text-white">{data.eval_count}</div><div className="text-[10px] text-[#8b949e]">Evals</div></div>
          </div>
        )}
      </div>

      {loading && <div className="text-[#8b949e] text-sm">Loading unit analysis…</div>}
      {error   && <div className="text-[#f85149] text-sm">{error}</div>}

      {data && (
        <>
          {/* Per-soldier overlaid radar comparison */}
          {(() => {
            const active = data.per_soldier.filter(s => Object.keys(s.leader_averages).length > 0);
            if (!active.length) return null;
            const radarData = LDR_FIELDS.map(label => {
              const entry: Record<string, string | number> = { subject: label };
              active.forEach(s => { entry[`${s.rank} ${s.name}`] = s.leader_averages[label] ?? 0; });
              return entry;
            });
            return (
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
                <h3 className="text-sm font-semibold text-white mb-3">Leader Performance Comparison</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#30363d" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#8b949e", fontSize: 11 }} />
                    {active.map((s, i) => (
                      <Radar
                        key={s.id}
                        name={`${s.rank} ${s.name}`}
                        dataKey={`${s.rank} ${s.name}`}
                        stroke={STROKE_COLORS[i % STROKE_COLORS.length]}
                        fill={STROKE_COLORS[i % STROKE_COLORS.length]}
                        fillOpacity={0.2}
                      />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 11, color: "#8b949e" }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* Unit trend */}
          {data.unit_trend.length > 1 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Unit Leader Evaluation Trend</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.unit_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="event" tick={{ fill: "#8b949e", fontSize: 10 }} />
                  <YAxis domain={[0, 5]} tick={{ fill: "#8b949e", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {LDR_FIELDS.map((f, i) => (
                    <Line key={f} type="monotone" dataKey={f} stroke={STROKE_COLORS[i]}
                      dot={false} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Average scores table */}
          {data.per_soldier.length > 0 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-[#30363d]">
                <h3 className="text-sm font-semibold text-white">Average Scores by Leader</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[#8b949e] uppercase text-[10px] tracking-wider border-b border-[#30363d]">
                      <th className="text-left px-5 py-2">Soldier</th>
                      {LDR_FIELDS.map(f => (
                        <th key={f} className="text-center px-3 py-2 whitespace-nowrap">{f}</th>
                      ))}
                      <th className="text-center px-3 py-2">Evals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.per_soldier.map(s => (
                      <tr key={s.id} className="border-b border-[#21262d] last:border-0 hover:bg-[#21262d]/50">
                        <td className="px-5 py-2.5 text-[#c9d1d9] font-medium">{s.rank} {s.name}</td>
                        {LDR_FIELDS.map(f => {
                          const v = s.leader_averages[f];
                          return (
                            <td key={f} className="px-3 py-2.5 text-center">
                              {v != null ? (
                                <span style={{ color: v >= 4 ? "#3fb950" : v >= 3 ? "#f59e0b" : "#f85149" }} className="font-bold">
                                  {v.toFixed(1)}
                                </span>
                              ) : <span className="text-[#6e7681]">—</span>}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-center text-[#8b949e]">{s.eval_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ST&EO */}
          {data.steo_summary.length > 0 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-[#30363d]">
                <h3 className="text-sm font-semibold text-white">SQD ST&EO — Unit Proficiency</h3>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#8b949e] uppercase text-[10px] tracking-wider border-b border-[#30363d]">
                    <th className="text-left px-5 py-2">Mission</th>
                    <th className="text-center px-4 py-2">Avg Score</th>
                    <th className="text-center px-4 py-2">Proficiency</th>
                    <th className="text-center px-4 py-2">Evals</th>
                  </tr>
                </thead>
                <tbody>
                  {data.steo_summary.map(s => (
                    <tr key={s.mission} className="border-b border-[#21262d] last:border-0">
                      <td className="px-5 py-3 text-[#c9d1d9]">{s.mission}</td>
                      <td className="px-4 py-3 text-center font-bold text-white">{s.avg_score.toFixed(1)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PROFICIENCY_COLOR[s.proficiency] ?? ""}`}>
                          {s.proficiency}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-[#8b949e]">{s.eval_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.eval_count === 0 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-8 text-center">
              <p className="text-[#8b949e] text-sm">No evaluations recorded for {unit} yet.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
