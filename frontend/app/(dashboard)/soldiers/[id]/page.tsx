"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Moon, Activity, Save, ChevronDown, ChevronUp } from "lucide-react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid
} from "recharts";
import { api } from "@/lib/api";
import type { Assessment, Soldier, SoldierReadiness, SoldierPosition } from "@/types";

const RADAR_DIMS = [
  { key: "leadership",       label: "Leadership" },
  { key: "decision_making",  label: "Decision" },
  { key: "stress_tolerance", label: "Stress" },
  { key: "tactical",         label: "Tactical" },
  { key: "communication",    label: "Comms" },
  { key: "teamwork",         label: "Teamwork" },
  { key: "adaptability",     label: "Adapt" },
];

const INJURY_STYLES: Record<string, string> = {
  fit:         "bg-[#3fb950]/20 text-[#3fb950]",
  light_duty:  "bg-[#f59e0b]/20 text-[#f59e0b]",
  unfit:       "bg-[#f85149]/20 text-[#f85149]",
};

const OP_STATUS_STYLES: Record<string, string> = {
  available:  "bg-[#3fb950]/20 text-[#3fb950]",
  on_mission: "bg-[#58a6ff]/20 text-[#58a6ff]",
  rest:       "bg-[#8b949e]/20 text-[#8b949e]",
  casualty:   "bg-[#f85149]/20 text-[#f85149]",
};

function FatigueBar({ index }: { index: number }) {
  const pct   = Math.round(index * 100);
  const color = pct <= 20 ? "bg-[#3fb950]" : pct <= 50 ? "bg-[#f59e0b]" : "bg-[#f85149]";
  const label = pct <= 20 ? "Rested" : pct <= 50 ? "Moderate fatigue" : "High fatigue";
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className="text-[#8b949e]">Fatigue Index</span>
        <span className={pct <= 20 ? "text-[#3fb950]" : pct <= 50 ? "text-[#f59e0b]" : "text-[#f85149]"}>
          {label} ({pct}%)
        </span>
      </div>
      <div className="h-2 bg-[#30363d] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function SoldierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();

  const [soldier, setSoldier]         = useState<Soldier | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [readiness, setReadiness]     = useState<SoldierReadiness | null>(null);
  const [position, setPosition]       = useState<SoldierPosition | null>(null);
  const [loading, setLoading]         = useState(true);

  // Readiness edit state
  const [showReadinessEdit, setShowReadinessEdit] = useState(false);
  const [savingReadiness, setSavingReadiness]     = useState(false);
  const [readinessForm, setReadinessForm] = useState({
    sleep_hours_24h: 8, sleep_hours_48h: 16, injury_status: "fit",
  });

  // Position edit state
  const [showPositionEdit, setShowPositionEdit] = useState(false);
  const [savingPosition, setSavingPosition]     = useState(false);
  const [positionForm, setPositionForm] = useState({
    mgrs_grid: "", lat: "", lon: "", operational_status: "available",
  });

  useEffect(() => {
    Promise.all([
      api.get<Soldier>(`/api/v1/soldiers/${id}`),
      api.get<Assessment[]>(`/api/v1/soldiers/${id}/assessments`),
      api.get<SoldierReadiness>(`/api/v1/soldiers/${id}/readiness`).catch(() => null),
      api.get<SoldierPosition>(`/api/v1/soldiers/${id}/position`).catch(() => null),
    ]).then(([s, a, r, p]) => {
      setSoldier(s);
      setAssessments(a);
      if (r) {
        setReadiness(r);
        setReadinessForm({
          sleep_hours_24h: r.sleep_hours_24h,
          sleep_hours_48h: r.sleep_hours_48h,
          injury_status:   r.injury_status,
        });
      }
      if (p) {
        setPosition(p);
        setPositionForm({
          mgrs_grid:          p.mgrs_grid ?? "",
          lat:                p.lat?.toString() ?? "",
          lon:                p.lon?.toString() ?? "",
          operational_status: p.operational_status,
        });
      }
    }).finally(() => setLoading(false));
  }, [id]);

  async function saveReadiness(e: React.FormEvent) {
    e.preventDefault();
    setSavingReadiness(true);
    try {
      const r = await api.post<SoldierReadiness>(`/api/v1/soldiers/${id}/readiness`, readinessForm);
      setReadiness(r);
      setShowReadinessEdit(false);
    } finally {
      setSavingReadiness(false);
    }
  }

  async function savePosition(e: React.FormEvent) {
    e.preventDefault();
    setSavingPosition(true);
    try {
      const body = {
        mgrs_grid:          positionForm.mgrs_grid || null,
        lat:                positionForm.lat   ? parseFloat(positionForm.lat)   : null,
        lon:                positionForm.lon   ? parseFloat(positionForm.lon)   : null,
        operational_status: positionForm.operational_status,
      };
      const p = await api.post<SoldierPosition>(`/api/v1/soldiers/${id}/position`, body);
      setPosition(p);
      setShowPositionEdit(false);
    } finally {
      setSavingPosition(false);
    }
  }

  if (loading) return <div className="p-6 text-[#8b949e]">Loading…</div>;
  if (!soldier) return <div className="p-6 text-[#f85149]">Soldier not found</div>;

  const radarData = RADAR_DIMS.map(d => ({
    subject: d.label,
    score: Math.round((soldier.skill_vector[d.key as keyof typeof soldier.skill_vector] ?? 0.5) * 100),
    fullMark: 100,
  }));

  const trendData = assessments
    .filter(a => a.score_leadership != null)
    .slice(0, 10)
    .reverse()
    .map((a, i) => ({
      label: `#${i + 1}`,
      leadership: a.score_leadership,
      decision:   a.score_decision_quality,
      stress:     a.score_stress_response,
      tactical:   a.score_tactical,
    }));

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Back + Header */}
      <div>
        <button onClick={() => router.back()} className="flex items-center gap-1 text-xs text-[#8b949e] hover:text-white mb-3">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">{soldier.rank} {soldier.name}</h1>
            <p className="text-[#8b949e] text-sm">{soldier.unit} · {soldier.mos} · {soldier.service_number}</p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <span className={`text-xs px-2 py-1 rounded ${soldier.is_active ? "bg-[#3fb950]/20 text-[#3fb950]" : "bg-[#30363d] text-[#8b949e]"}`}>
              {soldier.is_active ? "Active" : "Inactive"}
            </span>
            <span className="text-xs px-2 py-1 bg-[#21262d] text-[#8b949e] rounded capitalize">
              {soldier.decision_style}
            </span>
            {position && (
              <span className={`text-xs px-2 py-1 rounded capitalize ${OP_STATUS_STYLES[position.operational_status] ?? "bg-[#30363d] text-[#8b949e]"}`}>
                {position.operational_status.replace("_", " ")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ATAK Context Row: Readiness + Position */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Readiness Card */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Moon size={15} className="text-[#58a6ff]" />
              <h2 className="text-sm font-semibold text-white">Readiness</h2>
            </div>
            <button
              onClick={() => setShowReadinessEdit(!showReadinessEdit)}
              className="flex items-center gap-1 text-[10px] text-[#8b949e] hover:text-white transition-colors"
            >
              {showReadinessEdit ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {readiness ? "Edit" : "Log"}
            </button>
          </div>

          {readiness ? (
            <div className="space-y-4">
              <FatigueBar index={readiness.fatigue_index} />
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0d1117] rounded p-3 text-center">
                  <p className="text-xs text-[#8b949e] mb-1">Sleep / 24h</p>
                  <p className="text-xl font-black text-white">{readiness.sleep_hours_24h.toFixed(1)}<span className="text-sm text-[#8b949e]">h</span></p>
                </div>
                <div className="bg-[#0d1117] rounded p-3 text-center">
                  <p className="text-xs text-[#8b949e] mb-1">Sleep / 48h</p>
                  <p className="text-xl font-black text-white">{readiness.sleep_hours_48h.toFixed(1)}<span className="text-sm text-[#8b949e]">h</span></p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#8b949e]">Injury Status</span>
                <span className={`text-[10px] px-2 py-0.5 rounded capitalize font-semibold ${INJURY_STYLES[readiness.injury_status] ?? "bg-[#30363d] text-[#8b949e]"}`}>
                  {readiness.injury_status.replace("_", " ")}
                </span>
              </div>
              {readiness.updated_at && (
                <p className="text-[10px] text-[#6e7681]">
                  Updated {new Date(readiness.updated_at).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[#6e7681]">No readiness data logged yet.</p>
          )}

          {showReadinessEdit && (
            <form onSubmit={saveReadiness} className="mt-4 pt-4 border-t border-[#30363d] space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Sleep / 24h (hrs)</label>
                  <input type="number" step="0.5" min="0" max="24"
                    value={readinessForm.sleep_hours_24h}
                    onChange={e => setReadinessForm(p => ({ ...p, sleep_hours_24h: parseFloat(e.target.value) }))}
                    className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#58a6ff]" />
                </div>
                <div>
                  <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Sleep / 48h (hrs)</label>
                  <input type="number" step="0.5" min="0" max="48"
                    value={readinessForm.sleep_hours_48h}
                    onChange={e => setReadinessForm(p => ({ ...p, sleep_hours_48h: parseFloat(e.target.value) }))}
                    className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#58a6ff]" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Injury Status</label>
                <select value={readinessForm.injury_status}
                  onChange={e => setReadinessForm(p => ({ ...p, injury_status: e.target.value }))}
                  className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none">
                  <option value="fit">Fit</option>
                  <option value="light_duty">Light Duty</option>
                  <option value="unfit">Unfit</option>
                </select>
              </div>
              <button type="submit" disabled={savingReadiness}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#58a6ff] hover:bg-blue-500 text-black text-xs font-semibold rounded-md disabled:opacity-50 transition-colors">
                <Save size={12} /> {savingReadiness ? "Saving…" : "Save Readiness"}
              </button>
            </form>
          )}
        </div>

        {/* Position Card */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-[#f59e0b]" />
              <h2 className="text-sm font-semibold text-white">Position &amp; Status</h2>
            </div>
            <button
              onClick={() => setShowPositionEdit(!showPositionEdit)}
              className="flex items-center gap-1 text-[10px] text-[#8b949e] hover:text-white transition-colors"
            >
              {showPositionEdit ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {position ? "Edit" : "Log"}
            </button>
          </div>

          {position ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#8b949e] uppercase tracking-wider">Operational Status</span>
                <span className={`text-xs px-2.5 py-1 rounded capitalize font-semibold ${OP_STATUS_STYLES[position.operational_status] ?? "bg-[#30363d] text-[#8b949e]"}`}>
                  {position.operational_status.replace("_", " ")}
                </span>
              </div>
              {position.mgrs_grid && (
                <div className="bg-[#0d1117] rounded p-3">
                  <p className="text-[10px] text-[#8b949e] mb-1">MGRS Grid</p>
                  <p className="text-sm font-mono text-[#f59e0b] font-bold">{position.mgrs_grid}</p>
                </div>
              )}
              {(position.lat != null && position.lon != null) && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#0d1117] rounded p-2.5 text-center">
                    <p className="text-[10px] text-[#8b949e] mb-0.5">Lat</p>
                    <p className="text-xs font-mono text-white">{position.lat?.toFixed(5)}</p>
                  </div>
                  <div className="bg-[#0d1117] rounded p-2.5 text-center">
                    <p className="text-[10px] text-[#8b949e] mb-0.5">Lon</p>
                    <p className="text-xs font-mono text-white">{position.lon?.toFixed(5)}</p>
                  </div>
                </div>
              )}
              {position.updated_at && (
                <p className="text-[10px] text-[#6e7681]">
                  Updated {new Date(position.updated_at).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[#6e7681]">No position data logged yet.</p>
          )}

          {showPositionEdit && (
            <form onSubmit={savePosition} className="mt-4 pt-4 border-t border-[#30363d] space-y-3">
              <div>
                <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Operational Status</label>
                <select value={positionForm.operational_status}
                  onChange={e => setPositionForm(p => ({ ...p, operational_status: e.target.value }))}
                  className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none">
                  <option value="available">Available</option>
                  <option value="on_mission">On Mission</option>
                  <option value="rest">Rest</option>
                  <option value="casualty">Casualty</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">MGRS Grid</label>
                <input placeholder="e.g. 38SMB12345678"
                  value={positionForm.mgrs_grid}
                  onChange={e => setPositionForm(p => ({ ...p, mgrs_grid: e.target.value }))}
                  className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm font-mono text-white focus:outline-none focus:border-[#f59e0b]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Latitude</label>
                  <input type="number" step="any" placeholder="0.00000"
                    value={positionForm.lat}
                    onChange={e => setPositionForm(p => ({ ...p, lat: e.target.value }))}
                    className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Longitude</label>
                  <input type="number" step="any" placeholder="0.00000"
                    value={positionForm.lon}
                    onChange={e => setPositionForm(p => ({ ...p, lon: e.target.value }))}
                    className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none" />
                </div>
              </div>
              <button type="submit" disabled={savingPosition}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f59e0b] hover:bg-amber-500 text-black text-xs font-semibold rounded-md disabled:opacity-50 transition-colors">
                <Save size={12} /> {savingPosition ? "Saving…" : "Save Position"}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Skill Profile + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Skill Profile</h2>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#30363d" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: "#8b949e", fontSize: 11 }} />
              <Radar name={soldier.name} dataKey="score" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
              <Tooltip
                contentStyle={{ backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "6px" }}
                labelStyle={{ color: "#e6edf3" }}
                itemStyle={{ color: "#f59e0b" }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">
            Assessment Trend ({assessments.length} evals)
          </h2>
          {trendData.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-[#8b949e] text-sm">
              No scored assessments yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="label" tick={{ fill: "#8b949e", fontSize: 10 }} />
                <YAxis domain={[0, 5]} tick={{ fill: "#8b949e", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "6px" }}
                  labelStyle={{ color: "#e6edf3" }}
                />
                <Line type="monotone" dataKey="leadership" stroke="#3fb950" strokeWidth={2} dot={false} name="Leadership" />
                <Line type="monotone" dataKey="decision"   stroke="#f59e0b" strokeWidth={2} dot={false} name="Decision" />
                <Line type="monotone" dataKey="stress"     stroke="#58a6ff" strokeWidth={2} dot={false} name="Stress Res." />
                <Line type="monotone" dataKey="tactical"   stroke="#f85149" strokeWidth={2} dot={false} name="Tactical" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Leadership Traits */}
      {soldier.leadership_traits.length > 0 && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-3">Leadership Traits</h2>
          <div className="flex flex-wrap gap-2">
            {soldier.leadership_traits.map(t => (
              <span key={t} className="px-2.5 py-1 bg-[#f59e0b]/10 text-[#f59e0b] text-xs rounded-full capitalize">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Assessment History */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg">
        <div className="px-5 py-4 border-b border-[#30363d]">
          <h2 className="text-sm font-semibold text-white">Assessment History</h2>
        </div>
        {assessments.length === 0 ? (
          <div className="px-5 py-8 text-center text-[#8b949e] text-sm">No assessments recorded</div>
        ) : (
          <div className="divide-y divide-[#30363d]">
            {assessments.map(a => (
              <div key={a.id} className="px-5 py-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <span className="text-xs text-white capitalize">{a.assessment_type.replace(/_/g, " ")}</span>
                    <span className="ml-2 text-[10px] text-[#8b949e] capitalize">via {a.capture_method.replace(/_/g, " ")}</span>
                  </div>
                  <span className="text-[10px] text-[#8b949e]">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}
                  </span>
                </div>
                {a.ai_summary && (
                  <p className="text-xs text-[#8b949e] mb-2 leading-relaxed">{a.ai_summary}</p>
                )}
                {a.score_leadership != null && (
                  <div className="flex gap-4 text-[10px]">
                    {[
                      { l: "Leadership", v: a.score_leadership },
                      { l: "Decision",   v: a.score_decision_quality },
                      { l: "Stress",     v: a.score_stress_response },
                      { l: "Tactical",   v: a.score_tactical },
                      { l: "Comms",      v: a.score_communication },
                    ].filter(x => x.v != null).map(x => (
                      <span key={x.l} className="text-[#8b949e]">
                        {x.l}: <span className="text-white">{x.v!.toFixed(1)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
