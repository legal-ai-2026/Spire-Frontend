"use client";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, CloudRain, Loader2, MapPin,
  Moon, Mountain, Plus, Radio, Shield, Thermometer, TrendingDown,
  TrendingUp, Users, Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSimulation } from "@/contexts/SimulationContext";
import type { BattlespaceSession, Mission, SensorTrack, SoldierReadiness, SoldierPosition } from "@/types";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------
interface ForceSoldier {
  id: number; rank: string; name: string; unit?: string;
  readiness: SoldierReadiness | null;
  position: SoldierPosition | null;
}
interface ForceStatusResponse {
  soldiers: ForceSoldier[];
  kpis: { total: number; available: number; on_mission: number; casualty: number; rest: number; no_data: number };
}

type UnitPos = { callsign: string; grid?: string; status?: string };

interface AdversaryMove  { move_type: string; description: string; target?: string; timing?: string; probability: string; }
interface SimRiskVector  { risk_type: string; severity: string; description: string; affected_units: string[]; recommended_action: string; confidence_score: number; }
interface SimRec         { priority: string; action: string; rationale: string; }

interface SquadMember {
  name: string; role: string; fit_score: number;
  key_strengths: string[]; key_weaknesses: string[];
  readiness_note: string;
  mission_contribution: "positive" | "neutral" | "liability";
  recommendation: string;
}
interface SquadAssessment {
  overall_readiness: string;
  team_fit_score: number;
  critical_gaps: string[];
  members: SquadMember[];
}
interface EnvFactor {
  factor: string; label: string; impact: string;
  severity: "high" | "medium" | "low";
  affected_skills?: string[];
}
interface SimResult {
  outcome_verdict?: "likely_success" | "marginal" | "likely_failure";
  outcome_confidence?: number;
  situation_summary?: string;
  adversary_moves: AdversaryMove[];
  risk_vectors: SimRiskVector[];
  recommendations: SimRec[];
  squad_assessment?: SquadAssessment;
  environmental_factors?: EnvFactor[];
  ai_model_used?: string;
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------
const SEVERITY_STYLE: Record<string, { bar: string; badge: string }> = {
  critical: { bar: "bg-red-500",   badge: "bg-red-500/20 text-red-400" },
  high:     { bar: "bg-[#f85149]", badge: "bg-[#f85149]/20 text-[#f85149]" },
  medium:   { bar: "bg-[#f59e0b]", badge: "bg-[#f59e0b]/20 text-[#f59e0b]" },
  low:      { bar: "bg-[#3fb950]", badge: "bg-[#3fb950]/20 text-[#3fb950]" },
};
const OP_STYLE: Record<string, string> = {
  available:  "bg-[#3fb950]/10 text-[#3fb950] border border-[#3fb950]/30",
  on_mission: "bg-[#58a6ff]/10 text-[#58a6ff] border border-[#58a6ff]/30",
  rest:       "bg-[#8b949e]/10 text-[#8b949e] border border-[#30363d]",
  casualty:   "bg-[#f85149]/10 text-[#f85149] border border-[#f85149]/30",
};
const CONTRIB_STYLE: Record<string, string> = {
  positive: "bg-[#3fb950]/20 text-[#3fb950]",
  neutral:  "bg-[#f59e0b]/20 text-[#f59e0b]",
  liability:"bg-[#f85149]/20 text-[#f85149]",
};
const VERDICT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  likely_success:  { bg: "border-[#3fb950]/40 bg-[#3fb950]/5",  text: "text-[#3fb950]",  label: "Likely Success"  },
  marginal:        { bg: "border-[#f59e0b]/40 bg-[#f59e0b]/5",  text: "text-[#f59e0b]",  label: "Marginal"        },
  likely_failure:  { bg: "border-[#f85149]/40 bg-[#f85149]/5",  text: "text-[#f85149]",  label: "Likely Failure"  },
};
const ENV_ICON: Record<string, React.ReactNode> = {
  terrain:     <Mountain size={13} />,
  weather:     <CloudRain size={13} />,
  duration:    <Moon size={13} />,
  threat_level:<Thermometer size={13} />,
};
const FATIGUE_COLOR = (fi: number) =>
  fi <= 0.20 ? "text-[#3fb950]" : fi <= 0.50 ? "text-[#f59e0b]" : "text-[#f85149]";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function BattlespacePage() {
  const { startTracking, getSessionJob, clearSessionJob } = useSimulation();

  const [sessions,     setSessions]     = useState<BattlespaceSession[]>([]);
  const [missions,     setMissions]     = useState<Mission[]>([]);
  const [active,       setActive]       = useState<BattlespaceSession | null>(null);
  const [simResult,    setSimResult]    = useState<SimResult | null>(null);
  const [forceStatus,  setForceStatus]  = useState<ForceStatusResponse | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState("");
  const [showNew,      setShowNew]      = useState(false);
  const [trackForm,    setTrackForm]    = useState({ track_type: "friendly", callsign: "", grid: "" });
  // Collapsible report sections
  const [openSection,  setOpenSection]  = useState<string | null>("squad");

  const activeRef = useRef(active);

  const [form, setForm] = useState({
    session_name: "", scenario_description: "",
    mission_id: "",
    intel_report: "",
    friendly_callsign: "", friendly_grid: "",
    enemy_callsign: "", enemy_grid: "",
  });

  // Keep ref in sync so the job-watcher effect can read current active session
  useEffect(() => { activeRef.current = active; }, [active]);

  // Watch simulation context for the active session — apply result when job completes
  useEffect(() => {
    if (!active) return;
    const job = getSessionJob(active.id);
    if (!job) return;
    if (job.status === "completed" && job.result && !simResult) {
      setSimResult(job.result as unknown as SimResult);
      setOpenSection("squad");
      // Refresh session so risk vectors panel reflects newly persisted data
      api.get<BattlespaceSession>(`/api/v1/battlespace/${active.id}`)
        .then(updated => setActive(updated))
        .catch(() => {});
    }
    if (job.status === "failed") {
      setError(job.error ?? "Simulation failed");
    }
  }); // no deps — runs every render, cheap because getSessionJob reads a ref

  useEffect(() => {
    Promise.all([
      api.get<BattlespaceSession[]>("/api/v1/battlespace"),
      api.get<Mission[]>("/api/v1/missions"),
      api.get<ForceStatusResponse>("/api/v1/soldiers/force-status").catch(() => null),
    ]).then(([s, m, fs]) => {
      setSessions(s);
      setMissions(m);
      setForceStatus(fs);

      // Auto-open session created from Team Builder
      const pending = sessionStorage.getItem("battlespace_open");
      if (pending) {
        sessionStorage.removeItem("battlespace_open");
        const target = s.find(sess => sess.id === parseInt(pending));
        if (target) openSession(target);
      }
    }).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openSession(session: BattlespaceSession) {
    const full = await api.get<BattlespaceSession>(`/api/v1/battlespace/${session.id}`);
    setActive(full);
    setOpenSection("squad");
    // If the background job for this session already completed, show its result immediately
    const existingJob = getSessionJob(session.id);
    if (existingJob?.status === "completed" && existingJob.result) {
      setSimResult(existingJob.result as unknown as SimResult);
    } else {
      setSimResult(null);
    }
    setError("");
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      const friendly = form.friendly_callsign
        ? [{ callsign: form.friendly_callsign, grid: form.friendly_grid }] : [];
      const enemy = form.enemy_callsign
        ? [{ callsign: form.enemy_callsign, grid: form.enemy_grid }] : [];
      const intel = form.intel_report ? [form.intel_report] : [];

      const s = await api.post<BattlespaceSession>("/api/v1/battlespace", {
        session_name:         form.session_name,
        scenario_description: form.scenario_description,
        mission_id:           form.mission_id ? parseInt(form.mission_id) : null,
        friendly_units: friendly,
        known_enemy: enemy,
        intel_reports: intel,
      });
      setSessions(prev => [s, ...prev]);
      setShowNew(false);
      await openSession(s);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function handleAddTrack(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!active) return;
    setError("");
    try {
      await api.post<SensorTrack>(`/api/v1/battlespace/${active.id}/sensor-tracks`, trackForm);
      const updated = await api.get<BattlespaceSession>(`/api/v1/battlespace/${active.id}`);
      setActive(updated);
      setTrackForm({ track_type: "friendly", callsign: "", grid: "" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function handleSimulate() {
    if (!active) return;
    setSimResult(null);
    setError("");
    clearSessionJob(active.id);
    try {
      const res = await api.post<{ job_id: number; status: string; session_id: number }>(
        `/api/v1/battlespace/${active.id}/simulate-adversary`, {},
      );
      startTracking(res.job_id, active.id, active.session_name);
      // Request notification permission early so the prompt doesn't fire mid-background
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start simulation");
    }
  }

  function toggleSection(key: string) {
    setOpenSection(prev => prev === key ? null : key);
  }

  const trackColor = (t: string) =>
    t === "friendly" ? "text-[#3fb950]" : t === "enemy" ? "text-[#f85149]" : "text-[#f59e0b]";

  // ---------------------------------------------------------------------------
  // Sub-renders
  // ---------------------------------------------------------------------------
  function SectionHeader({ id, label, count, color }: { id: string; label: string; count?: number; color: string }) {
    return (
      <button
        type="button"
        onClick={() => toggleSection(id)}
        className="w-full flex items-center justify-between py-2 hover:opacity-80 transition-opacity"
      >
        <span className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>
          {label}{count != null ? ` (${count})` : ""}
        </span>
        {openSection === id
          ? <ChevronDown size={13} className="text-[#8b949e]" />
          : <ChevronRight size={13} className="text-[#8b949e]" />
        }
      </button>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">Battlespace</h1>
          <p className="text-[#8b949e] text-xs mt-0.5">Phase 03 — Adversarial AI Co-Pilot</p>
        </div>
        <button onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#f85149] hover:bg-red-600 text-white text-sm font-semibold rounded-md transition-colors">
          <Plus size={14} /> New Session
        </button>
      </div>

      {error && <div className="p-3 bg-[#f85149]/10 border border-[#f85149]/30 text-[#f85149] text-sm rounded-md">{error}</div>}

      {/* New Session Form */}
      {showNew && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Create Battlespace Session</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Session Name *</label>
              <input required value={form.session_name}
                onChange={e => setForm(p => ({ ...p, session_name: e.target.value }))}
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#f85149]" />
            </div>
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Scenario Description</label>
              <textarea value={form.scenario_description} rows={2}
                onChange={e => setForm(p => ({ ...p, scenario_description: e.target.value }))}
                placeholder="Describe the operational scenario, objective, and known conditions…"
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none resize-none" />
            </div>
            {/* Mission link — pulls squad + terrain + weather into simulation */}
            <div>
              <label className="block text-[10px] text-[#f59e0b] uppercase tracking-wider mb-1">
                Linked Mission <span className="normal-case text-[#6e7681]">(optional — enables squad analysis in simulation)</span>
              </label>
              <select value={form.mission_id}
                onChange={e => setForm(p => ({ ...p, mission_id: e.target.value }))}
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#f59e0b]">
                <option value="">None — simulate without squad context</option>
                {missions.map(m => (
                  <option key={m.id} value={String(m.id)}>
                    {m.mission_name} ({m.mission_type} · {m.threat_level} threat)
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-[#3fb950] uppercase tracking-wider mb-1">Friendly Callsign</label>
                <input value={form.friendly_callsign}
                  onChange={e => setForm(p => ({ ...p, friendly_callsign: e.target.value }))}
                  placeholder="e.g. Alpha-6"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-[#3fb950] uppercase tracking-wider mb-1">Friendly Grid</label>
                <input value={form.friendly_grid}
                  onChange={e => setForm(p => ({ ...p, friendly_grid: e.target.value }))}
                  placeholder="e.g. GP123456"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-[#f85149] uppercase tracking-wider mb-1">Enemy Callsign</label>
                <input value={form.enemy_callsign}
                  onChange={e => setForm(p => ({ ...p, enemy_callsign: e.target.value }))}
                  placeholder="e.g. OPFOR-1"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-[#f85149] uppercase tracking-wider mb-1">Enemy Grid</label>
                <input value={form.enemy_grid}
                  onChange={e => setForm(p => ({ ...p, enemy_grid: e.target.value }))}
                  placeholder="e.g. GP789012"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Intel Report</label>
              <input value={form.intel_report}
                onChange={e => setForm(p => ({ ...p, intel_report: e.target.value }))}
                placeholder="e.g. Enemy convoy observed moving north at 0600"
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none" />
            </div>
            <div className="flex gap-2">
              <button type="submit"
                className="px-4 py-2 bg-[#f85149] text-white text-sm font-semibold rounded-md hover:bg-red-600">Create</button>
              <button type="button" onClick={() => setShowNew(false)}
                className="px-4 py-2 bg-[#21262d] text-[#8b949e] text-sm rounded-md hover:text-white">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Force Status Panel ── */}
      {forceStatus && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={15} className="text-[#f59e0b]" />
            <h2 className="text-sm font-semibold text-white">Force Status</h2>
            <span className="ml-auto text-[10px] text-[#6e7681]">{forceStatus.kpis.total} soldiers</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {[
              { label: "Available",  count: forceStatus.kpis.available,  color: "text-[#3fb950]" },
              { label: "On Mission", count: forceStatus.kpis.on_mission,  color: "text-[#58a6ff]" },
              { label: "Rest",       count: forceStatus.kpis.rest,        color: "text-[#8b949e]" },
              { label: "Casualty",   count: forceStatus.kpis.casualty,    color: "text-[#f85149]" },
            ].map(k => (
              <div key={k.label} className="bg-[#0d1117] rounded p-2.5 text-center">
                <p className={`text-xl font-black ${k.color}`}>{k.count}</p>
                <p className="text-[10px] text-[#8b949e]">{k.label}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {forceStatus.soldiers.map(s => {
              const opStatus  = s.position?.operational_status ?? "no_data";
              const styleClass = OP_STYLE[opStatus] ?? "bg-[#21262d] text-[#8b949e] border border-[#30363d]";
              const fatigue    = s.readiness?.fatigue_index;
              return (
                <div key={s.id} className="bg-[#0d1117] rounded-md px-3 py-2.5 flex items-start gap-2.5">
                  <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                    opStatus === "available"  ? "bg-[#3fb950]" :
                    opStatus === "on_mission" ? "bg-[#58a6ff]" :
                    opStatus === "casualty"   ? "bg-[#f85149]" :
                    opStatus === "rest"       ? "bg-[#8b949e]" : "bg-[#30363d]"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs text-white truncate">{s.rank} {s.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded capitalize shrink-0 ${styleClass}`}>
                        {opStatus === "no_data" ? "unknown" : opStatus.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {s.unit && <span className="text-[10px] text-[#6e7681]">{s.unit}</span>}
                      {s.position?.mgrs_grid && (
                        <span className="flex items-center gap-0.5 text-[10px] text-[#f59e0b] font-mono">
                          <MapPin size={9} />{s.position.mgrs_grid}
                        </span>
                      )}
                      {fatigue != null && (
                        <span className={`flex items-center gap-0.5 text-[10px] ${FATIGUE_COLOR(fatigue)}`}>
                          <Moon size={9} />{Math.round(fatigue * 100)}% fatigue
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {forceStatus.kpis.no_data > 0 && (
              <div className="bg-[#0d1117] rounded-md px-3 py-2.5 flex items-center gap-2 col-span-full">
                <div className="w-2 h-2 rounded-full bg-[#30363d] shrink-0" />
                <span className="text-[10px] text-[#6e7681]">
                  {forceStatus.kpis.no_data} soldier{forceStatus.kpis.no_data !== 1 ? "s" : ""} with no position data
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sessions + Active Session ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sessions list */}
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Sessions</h2>
          {loading ? (
            <div className="text-[#8b949e] text-sm">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="text-[#8b949e] text-sm">No sessions yet</div>
          ) : sessions.map(s => {
            const job = getSessionJob(s.id);
            const isSimulating = job?.status === "pending" || job?.status === "running";
            const simDone = job?.status === "completed";
            return (
              <button key={s.id}
                onClick={() => openSession(s)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  active?.id === s.id
                    ? "border-[#f85149] bg-[#f85149]/10"
                    : "border-[#30363d] bg-[#161b22] hover:border-[#8b949e]"
                }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white font-medium">{s.session_name}</span>
                  {isSimulating ? (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b]">
                      <Loader2 size={9} className="animate-spin" />simulating
                    </span>
                  ) : simDone ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#58a6ff]/20 text-[#58a6ff]">completed</span>
                  ) : (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      s.status === "active" ? "bg-[#3fb950]/20 text-[#3fb950]" : "bg-[#30363d] text-[#8b949e]"
                    }`}>{s.status}</span>
                  )}
                </div>
                <p className="text-[10px] text-[#8b949e] truncate">{s.scenario_description ?? "No description"}</p>
                {s.mission_id && (
                  <p className="text-[9px] text-[#f59e0b] mt-0.5">Mission #{s.mission_id} linked</p>
                )}
              </button>
            );
          })}
        </div>

        {/* Active Session detail */}
        {active && (
          <div className="lg:col-span-2 space-y-4">
            {/* Session header */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-white font-semibold">{active.session_name}</h2>
                  <p className="text-xs text-[#8b949e] mt-0.5">{active.scenario_description}</p>
                  {active.mission_id && (
                    <p className="text-[10px] text-[#f59e0b] mt-1">
                      Linked to {missions.find(m => m.id === active.mission_id)?.mission_name ?? `Mission #${active.mission_id}`}
                      {" — squad &amp; terrain context will be included in simulation"}
                    </p>
                  )}
                </div>
                {(() => {
                  const job = getSessionJob(active.id);
                  const isRunning = job?.status === "pending" || job?.status === "running";
                  return (
                    <button
                      onClick={handleSimulate}
                      disabled={isRunning || active.status === "closed"}
                      className="flex items-center gap-1.5 px-4 py-2 bg-[#f85149] hover:bg-red-600 text-white text-sm font-semibold rounded-md disabled:opacity-50 transition-colors shrink-0 ml-3"
                    >
                      {isRunning
                        ? <><Loader2 size={14} className="animate-spin" />Simulating…</>
                        : <><Zap size={14} />Run Simulation</>
                      }
                    </button>
                  );
                })()}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div className="bg-[#0d1117] rounded-md p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Shield size={12} className="text-[#3fb950]" />
                    <span className="text-[10px] text-[#3fb950] uppercase tracking-wider font-semibold">Friendly</span>
                  </div>
                  {active.friendly_units.length === 0 ? (
                    <p className="text-[10px] text-[#6e7681]">None reported</p>
                  ) : active.friendly_units.map((u, i) => {
                    const unit = u as UnitPos;
                    return (
                      <p key={i} className="text-xs text-white">
                        {unit.callsign}{unit.grid && <span className="ml-1 text-[#8b949e]">{unit.grid}</span>}
                      </p>
                    );
                  })}
                </div>
                <div className="bg-[#0d1117] rounded-md p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle size={12} className="text-[#f85149]" />
                    <span className="text-[10px] text-[#f85149] uppercase tracking-wider font-semibold">Enemy</span>
                  </div>
                  {active.known_enemy.length === 0 ? (
                    <p className="text-[10px] text-[#6e7681]">None reported</p>
                  ) : active.known_enemy.map((u, i) => {
                    const unit = u as UnitPos;
                    return (
                      <p key={i} className="text-xs text-white">
                        {unit.callsign}{unit.grid && <span className="ml-1 text-[#8b949e]">{unit.grid}</span>}
                      </p>
                    );
                  })}
                </div>
              </div>
              {active.intel_reports.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Intel Reports</p>
                  {active.intel_reports.map((r, i) => (
                    <p key={i} className="text-xs text-[#8b949e] border-l-2 border-[#f59e0b] pl-2 mb-1">{r}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Add Sensor Track */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Radio size={14} className="text-[#8b949e]" />
                <h3 className="text-sm font-semibold text-white">Add Sensor Track</h3>
              </div>
              <form onSubmit={handleAddTrack} className="flex gap-2">
                <select value={trackForm.track_type}
                  onChange={e => setTrackForm(p => ({ ...p, track_type: e.target.value }))}
                  className="px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none w-28">
                  {["friendly","enemy","unknown"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input required value={trackForm.callsign}
                  onChange={e => setTrackForm(p => ({ ...p, callsign: e.target.value }))}
                  placeholder="Callsign"
                  className="flex-1 px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none" />
                <input value={trackForm.grid}
                  onChange={e => setTrackForm(p => ({ ...p, grid: e.target.value }))}
                  placeholder="Grid"
                  className="w-28 px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none" />
                <button type="submit"
                  className="px-3 py-1.5 bg-[#21262d] text-[#8b949e] hover:text-white text-sm rounded-md">Add</button>
              </form>
              {(active.sensor_tracks?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {active.sensor_tracks?.map(t => (
                    <span key={t.id} className={`text-[10px] px-2 py-0.5 bg-[#0d1117] rounded border border-[#30363d] ${trackColor(t.track_type)}`}>
                      {t.callsign}{t.grid && ` (${t.grid})`}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── SIMULATION IN PROGRESS BANNER ── */}
            {(() => {
              const job = getSessionJob(active.id);
              const isRunning = job?.status === "pending" || job?.status === "running";
              if (!isRunning) return null;
              return (
                <div className="bg-[#161b22] border border-[#f59e0b]/40 rounded-lg p-5 flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin text-[#f59e0b] shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-white">ATHENA is analyzing the battlespace…</p>
                    <p className="text-[11px] text-[#8b949e] mt-0.5">
                      This runs in the background — you can navigate away and you&apos;ll be notified when it&apos;s ready.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* ── FULL SIMULATION REPORT ── */}
            {simResult && (
              <div className="bg-[#161b22] border border-[#f85149]/40 rounded-lg overflow-hidden">
                {/* Report header + outcome verdict */}
                <div className="px-5 py-4 border-b border-[#21262d] flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-[#f85149] animate-pulse shrink-0" />
                  <h3 className="text-sm font-semibold text-white">ATHENA — Simulation Report</h3>
                  {simResult.outcome_verdict && (() => {
                    const v = VERDICT_STYLE[simResult.outcome_verdict!] ?? VERDICT_STYLE.marginal;
                    return (
                      <div className={`ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border ${v.bg}`}>
                        {simResult.outcome_verdict === "likely_success"
                          ? <TrendingUp size={13} className={v.text} />
                          : simResult.outcome_verdict === "likely_failure"
                          ? <TrendingDown size={13} className={v.text} />
                          : <AlertTriangle size={13} className={v.text} />
                        }
                        <span className={`text-xs font-bold ${v.text}`}>{v.label}</span>
                        {simResult.outcome_confidence != null && (
                          <span className="text-[10px] text-[#6e7681]">
                            {Math.round(simResult.outcome_confidence * 100)}% conf.
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="px-5 py-4 space-y-1">
                  {/* Situation summary */}
                  {simResult.situation_summary && (
                    <p className="text-sm text-[#8b949e] leading-relaxed border-l-2 border-[#f85149] pl-3 mb-4">
                      {simResult.situation_summary}
                    </p>
                  )}

                  {/* ── Squad Assessment ── */}
                  {simResult.squad_assessment && (
                    <div className="border border-[#21262d] rounded-lg overflow-hidden">
                      <SectionHeader id="squad" label="Squad Assessment"
                        count={simResult.squad_assessment.members?.length}
                        color="text-[#f59e0b]" />
                      {openSection === "squad" && (
                        <div className="space-y-3 pb-3">
                          {/* Overall readiness + fit score */}
                          <div className="flex items-start gap-3 px-1">
                            <div className="flex-1 bg-[#0d1117] rounded-md p-3">
                              <p className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Overall Readiness</p>
                              <p className="text-xs text-[#e6edf3]">{simResult.squad_assessment.overall_readiness}</p>
                            </div>
                            {simResult.squad_assessment.team_fit_score != null && (
                              <div className="bg-[#0d1117] rounded-md p-3 text-center w-24 shrink-0">
                                <p className={`text-2xl font-black ${
                                  simResult.squad_assessment.team_fit_score >= 0.75 ? "text-[#3fb950]" :
                                  simResult.squad_assessment.team_fit_score >= 0.55 ? "text-[#f59e0b]" : "text-[#f85149]"
                                }`}>{(simResult.squad_assessment.team_fit_score * 100).toFixed(0)}%</p>
                                <p className="text-[9px] text-[#6e7681]">team fit</p>
                              </div>
                            )}
                          </div>
                          {/* Critical gaps */}
                          {simResult.squad_assessment.critical_gaps?.length > 0 && (
                            <div className="px-1">
                              <p className="text-[10px] text-[#f85149] uppercase tracking-wider mb-1.5">Critical Gaps</p>
                              <div className="flex flex-wrap gap-1.5">
                                {simResult.squad_assessment.critical_gaps.map((g, i) => (
                                  <span key={i} className="text-[10px] px-2 py-0.5 bg-[#f85149]/10 text-[#f85149] rounded border border-[#f85149]/20">
                                    {g}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Per-member cards */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-1">
                            {simResult.squad_assessment.members?.map((m, i) => (
                              <div key={i} className="bg-[#0d1117] rounded-md p-3 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-xs font-semibold text-white">{m.name}</p>
                                    <p className="text-[10px] text-[#6e7681] capitalize">{m.role?.replace(/_/g, " ")}</p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1">
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${CONTRIB_STYLE[m.mission_contribution] ?? CONTRIB_STYLE.neutral}`}>
                                      {m.mission_contribution}
                                    </span>
                                    {m.fit_score != null && (
                                      <span className="text-[9px] text-[#6e7681]">
                                        {(m.fit_score * 100).toFixed(0)}% fit
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                                  {m.key_strengths?.length > 0 && (
                                    <div>
                                      <p className="text-[#3fb950] mb-0.5">Strengths</p>
                                      {m.key_strengths.map((s, j) => (
                                        <p key={j} className="text-[#8b949e] capitalize">{s.replace(/_/g, " ")}</p>
                                      ))}
                                    </div>
                                  )}
                                  {m.key_weaknesses?.length > 0 && (
                                    <div>
                                      <p className="text-[#f85149] mb-0.5">Weaknesses</p>
                                      {m.key_weaknesses.map((s, j) => (
                                        <p key={j} className="text-[#8b949e] capitalize">{s.replace(/_/g, " ")}</p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {m.readiness_note && (
                                  <p className="text-[10px] text-[#f59e0b] border-l border-[#f59e0b]/40 pl-2">
                                    {m.readiness_note}
                                  </p>
                                )}
                                {m.recommendation && (
                                  <p className="text-[10px] text-[#8b949e] italic">{m.recommendation}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Environmental Factors ── */}
                  {(simResult.environmental_factors?.length ?? 0) > 0 && (
                    <div className="border border-[#21262d] rounded-lg overflow-hidden mt-2">
                      <SectionHeader id="env" label="Environmental Factors"
                        count={simResult.environmental_factors!.length}
                        color="text-[#58a6ff]" />
                      {openSection === "env" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pb-3 px-1">
                          {simResult.environmental_factors!.map((f, i) => {
                            const sev = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.medium;
                            return (
                              <div key={i} className="bg-[#0d1117] rounded-md p-3">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className={`${f.severity === "high" ? "text-[#f85149]" : f.severity === "medium" ? "text-[#f59e0b]" : "text-[#3fb950]"}`}>
                                    {ENV_ICON[f.factor] ?? <Mountain size={13} />}
                                  </span>
                                  <span className="text-xs font-semibold text-white">{f.label}</span>
                                  <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${sev.badge}`}>
                                    {f.severity}
                                  </span>
                                </div>
                                <p className="text-[11px] text-[#8b949e] leading-relaxed">{f.impact}</p>
                                {f.affected_skills && f.affected_skills.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {f.affected_skills.map((sk, j) => (
                                      <span key={j} className="text-[9px] px-1.5 py-0.5 bg-[#21262d] text-[#6e7681] rounded capitalize">
                                        {sk.replace(/_/g, " ")}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Adversary Moves ── */}
                  {simResult.adversary_moves?.length > 0 && (
                    <div className="border border-[#21262d] rounded-lg overflow-hidden mt-2">
                      <SectionHeader id="moves" label="Likely Adversary Moves"
                        count={simResult.adversary_moves.length}
                        color="text-[#f85149]" />
                      {openSection === "moves" && (
                        <div className="space-y-2 pb-3 px-1">
                          {simResult.adversary_moves.map((m, i) => (
                            <div key={i} className="bg-[#0d1117] rounded-md p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] px-1.5 py-0.5 bg-[#f85149]/20 text-[#f85149] rounded capitalize">
                                  {m.move_type}
                                </span>
                                <span className={`text-[10px] ${
                                  m.probability === "high"   ? "text-[#f85149]" :
                                  m.probability === "medium" ? "text-[#f59e0b]" : "text-[#3fb950]"
                                }`}>{m.probability} prob.</span>
                              </div>
                              <p className="text-xs text-[#e6edf3]">{m.description}</p>
                              {m.timing && <p className="text-[10px] text-[#8b949e] mt-0.5">Timing: {m.timing}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Risk Vectors ── */}
                  {simResult.risk_vectors?.length > 0 && (
                    <div className="border border-[#21262d] rounded-lg overflow-hidden mt-2">
                      <SectionHeader id="risks" label="Risk Vectors"
                        count={simResult.risk_vectors.length}
                        color="text-[#f59e0b]" />
                      {openSection === "risks" && (
                        <div className="space-y-2 pb-3 px-1">
                          {simResult.risk_vectors.map((rv, i) => {
                            const style = SEVERITY_STYLE[rv.severity] ?? SEVERITY_STYLE.medium;
                            return (
                              <div key={i} className="bg-[#0d1117] rounded-md p-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${style.badge}`}>{rv.severity}</span>
                                  <span className="text-[10px] text-[#8b949e] capitalize">{rv.risk_type.replace(/_/g, " ")}</span>
                                </div>
                                <p className="text-xs text-[#e6edf3] mb-1">{rv.description}</p>
                                <p className="text-[10px] text-[#3fb950]">→ {rv.recommended_action}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Recommendations ── */}
                  {simResult.recommendations?.length > 0 && (
                    <div className="border border-[#21262d] rounded-lg overflow-hidden mt-2">
                      <SectionHeader id="recs" label="Recommendations"
                        count={simResult.recommendations.length}
                        color="text-[#3fb950]" />
                      {openSection === "recs" && (
                        <div className="space-y-2 pb-3 px-1">
                          {simResult.recommendations.map((r, i) => (
                            <div key={i} className="flex gap-3 bg-[#0d1117] rounded-md p-3">
                              <span className={`text-[10px] px-1.5 py-0.5 h-fit rounded font-bold uppercase shrink-0 ${
                                r.priority === "immediate"  ? "bg-[#f85149]/20 text-[#f85149]" :
                                r.priority === "short_term" ? "bg-[#f59e0b]/20 text-[#f59e0b]" :
                                "bg-[#21262d] text-[#8b949e]"
                              }`}>{r.priority.replace("_"," ")}</span>
                              <div>
                                <p className="text-xs text-white">{r.action}</p>
                                <p className="text-[10px] text-[#8b949e] mt-0.5">{r.rationale}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Persisted risk vectors (no active sim result) */}
            {!simResult && (active.risk_vectors?.length ?? 0) > 0 && (
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
                <h3 className="text-sm font-semibold text-white mb-3">Identified Risk Vectors</h3>
                <div className="space-y-2">
                  {active.risk_vectors?.map(rv => {
                    const style = SEVERITY_STYLE[rv.severity] ?? SEVERITY_STYLE.medium;
                    return (
                      <div key={rv.id} className="bg-[#0d1117] rounded-md p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${style.badge}`}>{rv.severity}</span>
                          <span className="text-[10px] text-[#8b949e] capitalize">{rv.risk_type.replace(/_/g, " ")}</span>
                        </div>
                        <p className="text-xs text-[#e6edf3]">{rv.description}</p>
                        <p className="text-[10px] text-[#3fb950] mt-0.5">→ {rv.recommended_action}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
