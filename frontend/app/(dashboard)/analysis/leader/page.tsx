"use client";
import { useEffect, useState } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { api } from "@/lib/api";
import type { LeaderAnalysis, Soldier } from "@/types";

const LDR_FIELDS = ["Planning", "Attn to Detail", "Time Mgmt", "Decisiveness", "Tactics"];
const UMP_COLOR = "#f59e0b";
const LDR_COLOR = "#3fb950";

const PROFICIENCY_COLOR: Record<string, string> = {
  T:   "text-[#3fb950] bg-[#3fb950]/10",
  "P+":"text-[#58a6ff] bg-[#58a6ff]/10",
  P:   "text-[#f59e0b] bg-[#f59e0b]/10",
  "P-":"text-[#e07b00] bg-[#e07b00]/10",
  U:   "text-[#f85149] bg-[#f85149]/10",
};

export default function LeaderAnalysisPage() {
  const [soldiers, setSoldiers] = useState<Soldier[]>([]);
  const [soldierId, setSoldierId] = useState<string>("");
  const [data, setData]   = useState<LeaderAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Soldier[]>("/api/v1/soldiers").then(setSoldiers);
  }, []);

  useEffect(() => {
    if (!soldierId) return;
    setLoading(true); setError(""); setData(null);
    api.get<LeaderAnalysis>(`/api/v1/analysis/leader/${soldierId}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [soldierId]);

  // Build radar data combining leader + UMP averages
  const radarData = LDR_FIELDS.map(label => ({
    subject: label,
    "Leader Eval": data?.leader_averages[label] ?? 0,
    "UMP":          data?.ump_averages[label] ?? 0,
  }));

  const hasLeaderData = data && Object.keys(data.leader_averages).length > 0;
  const hasUmpData    = data && Object.keys(data.ump_averages).length > 0;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-black text-white">Individual Performance Analysis</h1>
        <p className="text-[#8b949e] text-xs mt-0.5">Phase 01 — Leader Evaluation · Unit Mission Proficiency · ST&EO</p>
      </div>

      {/* Soldier selector */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Select Soldier</label>
        <select
          value={soldierId}
          onChange={e => setSoldierId(e.target.value)}
          className="w-full max-w-sm px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
        >
          <option value="">Choose soldier…</option>
          {soldiers.map(s => (
            <option key={s.id} value={String(s.id)}>{s.rank} {s.name} — {s.unit}</option>
          ))}
        </select>
      </div>

      {loading && <div className="text-[#8b949e] text-sm">Loading analysis…</div>}
      {error   && <div className="text-[#f85149] text-sm">{error}</div>}

      {data && (
        <>
          {/* Soldier header */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 flex items-center justify-between">
            <div>
              <div className="text-lg font-bold text-white">{data.soldier.rank} {data.soldier.name}</div>
              <div className="text-xs text-[#8b949e]">{data.soldier.unit} · {data.soldier.mos}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black text-[#3fb950]">{data.eval_count}</div>
              <div className="text-[10px] text-[#8b949e] uppercase">Total Evals</div>
            </div>
          </div>

          {/* Radar + trends row */}
          {(hasLeaderData || hasUmpData) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Radar chart */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
                <h3 className="text-sm font-semibold text-white mb-3">Performance Comparison</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#30363d" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#8b949e", fontSize: 11 }} />
                    <Radar name="Leader Eval" dataKey="Leader Eval" stroke={LDR_COLOR} fill={LDR_COLOR} fillOpacity={0.2} />
                    <Radar name="UMP"         dataKey="UMP"         stroke={UMP_COLOR} fill={UMP_COLOR} fillOpacity={0.15} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#8b949e" }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Average scores table */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
                <h3 className="text-sm font-semibold text-white mb-3">Average Scores</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[#8b949e] uppercase text-[10px] tracking-wider border-b border-[#30363d]">
                      <th className="text-left pb-2">Category</th>
                      <th className="text-center pb-2">Leader</th>
                      <th className="text-center pb-2">UMP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LDR_FIELDS.map(label => {
                      const lv = data.leader_averages[label];
                      const uv = data.ump_averages[label];
                      return (
                        <tr key={label} className="border-b border-[#21262d]">
                          <td className="py-2 text-[#c9d1d9]">{label}</td>
                          <td className="py-2 text-center">
                            {lv != null ? (
                              <span style={{ color: lv >= 4 ? "#3fb950" : lv >= 3 ? "#f59e0b" : "#f85149" }} className="font-bold">
                                {lv.toFixed(1)}
                              </span>
                            ) : <span className="text-[#6e7681]">—</span>}
                          </td>
                          <td className="py-2 text-center">
                            {uv != null ? (
                              <span style={{ color: uv >= 4 ? "#3fb950" : uv >= 3 ? "#f59e0b" : "#f85149" }} className="font-bold">
                                {uv.toFixed(1)}
                              </span>
                            ) : <span className="text-[#6e7681]">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Trend charts */}
          {data.leader_trend.length > 1 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Leader Evaluation Trend</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.leader_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="event" tick={{ fill: "#8b949e", fontSize: 10 }} />
                  <YAxis domain={[0, 5]} tick={{ fill: "#8b949e", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {LDR_FIELDS.map((f, i) => (
                    <Line key={f} type="monotone" dataKey={f} stroke={["#3fb950","#f59e0b","#58a6ff","#f85149","#a371f7"][i]}
                      dot={false} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {data.ump_trend.length > 1 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Unit Mission Proficiency Trend</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.ump_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="event" tick={{ fill: "#8b949e", fontSize: 10 }} />
                  <YAxis domain={[0, 5]} tick={{ fill: "#8b949e", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {LDR_FIELDS.map((f, i) => (
                    <Line key={f} type="monotone" dataKey={`ump_${f}`} name={f}
                      stroke={["#3fb950","#f59e0b","#58a6ff","#f85149","#a371f7"][i]}
                      dot={false} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ST&EO proficiency */}
          {data.steo_summary.length > 0 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-[#30363d]">
                <h3 className="text-sm font-semibold text-white">SQD ST&EO Mission Proficiency</h3>
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

          {/* No data yet */}
          {!hasLeaderData && !hasUmpData && data.steo_summary.length === 0 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-8 text-center">
              <p className="text-[#8b949e] text-sm">No structured evaluations recorded yet for this soldier.</p>
              <p className="text-[#6e7681] text-xs mt-1">Submit a Leader, Unit, or ST&EO evaluation from the Evaluate page.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
