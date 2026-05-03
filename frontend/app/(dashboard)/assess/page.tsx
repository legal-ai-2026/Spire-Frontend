"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Bot, Camera, CheckCircle, ChevronDown, ChevronRight,
  FileText, Loader2, Mic, Upload, XCircle,
} from "lucide-react";
import { api, OfflineError } from "@/lib/api";
import { system1Api } from "@/lib/system1";
import { AtakDevicePanel, type GpsCoords } from "@/components/AtakDevicePanel";
import type { Assessment, Soldier, TrainingEvent } from "@/types";
import type {
  System1Observation as S1Observation,
  System1PolicyDecision as S1Policy,
  System1RecommendationRecord as S1RecordItem,
  System1RunRecord as S1Run,
  System1RunStatus as S1Status,
  System1ScenarioRecommendation as S1Recommendation,
} from "@/types/system1";

const S1_PHASES = ["Benning", "Mountain", "Florida"] as const;
const S1_TERMINAL = new Set(["pending_approval", "completed", "failed"]);

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

const RATING_BADGE: Record<S1Observation["rating"], string> = {
  GO:        "bg-[#3fb950]/20 text-[#3fb950]",
  NOGO:      "bg-[#f85149]/20 text-[#f85149]",
  UNCERTAIN: "bg-[#f59e0b]/20 text-[#f59e0b]",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type CaptureMode = "structured" | "ocr" | "stt";
type EvalCategory = "leader_eval" | "unit_eval" | "steo_eval";
type Rating = "T" | "P" | "U";

interface Subtask {
  number: number;
  description: string;
}
interface TaskGroup {
  task_group: string;
  subtasks: Subtask[];
}
interface SteoMission {
  mission: string;
  subtasks: Subtask[];
}

const RATING_COLORS: Record<Rating, string> = {
  T: "bg-[#3fb950] text-black border-[#3fb950]",
  P: "bg-[#f59e0b] text-black border-[#f59e0b]",
  U: "bg-[#f85149] text-white border-[#f85149]",
};
const RATING_EMPTY = "bg-transparent text-[#8b949e] border-[#30363d] hover:border-[#8b949e]";

const CATEGORY_LABELS: Record<EvalCategory, string> = {
  leader_eval: "Leader Evaluation",
  unit_eval:   "Unit Evaluation",
  steo_eval:   "SQD ST&EO",
};

// ---------------------------------------------------------------------------
// Sub-components (defined outside AssessPage to preserve identity across renders)
// ---------------------------------------------------------------------------
function ratingKey(taskGroup: string, subtaskNum: number) {
  return `${taskGroup}__${subtaskNum}`;
}

function RatingButton({
  groupKey, sub, ratings, setRating,
}: {
  groupKey: string;
  sub: Subtask;
  ratings: Record<string, Rating>;
  setRating: (key: string, r: Rating) => void;
}) {
  const key = ratingKey(groupKey, sub.number);
  const current = ratings[key];
  return (
    <div className="flex items-start gap-3 py-2 border-b border-[#21262d] last:border-0">
      <span className="text-[11px] text-[#8b949e] w-4 text-right flex-shrink-0 mt-0.5">{sub.number}.</span>
      <span className="flex-1 text-xs text-[#c9d1d9]">{sub.description}</span>
      <div className="flex gap-1 flex-shrink-0">
        {(["T", "P", "U"] as Rating[]).map(r => (
          <button
            key={r}
            type="button"
            onClick={() => setRating(key, r)}
            className={`w-8 h-7 rounded text-[11px] font-bold border transition-all ${
              current === r ? RATING_COLORS[r] : RATING_EMPTY
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskGroupSection({
  group, collapsed, setCollapsed, ratings, setRating,
}: {
  group: TaskGroup;
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  ratings: Record<string, Rating>;
  setRating: (key: string, r: Rating) => void;
}) {
  const key = group.task_group;
  const isOpen = !collapsed[key];
  const rated = group.subtasks.filter(s => ratings[ratingKey(key, s.number)]).length;
  const all = group.subtasks.length;

  return (
    <div className="border border-[#30363d] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#161b22] hover:bg-[#21262d] transition-colors"
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronDown size={14} className="text-[#8b949e]" /> : <ChevronRight size={14} className="text-[#8b949e]" />}
          <span className="text-sm font-semibold text-white">{key}</span>
        </div>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
          rated === all ? "bg-[#3fb950]/20 text-[#3fb950]" : "bg-[#30363d] text-[#8b949e]"
        }`}>
          {rated}/{all}
        </span>
      </button>
      {isOpen && (
        <div className="px-4 py-1 bg-[#0d1117]">
          {group.subtasks.map(sub => (
            <RatingButton key={sub.number} groupKey={key} sub={sub} ratings={ratings} setRating={setRating} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function AssessPage() {
  const [captureMode, setCaptureMode] = useState<CaptureMode>("structured");
  const [evalCategory, setEvalCategory] = useState<EvalCategory>("leader_eval");

  const [soldiers, setSoldiers] = useState<Soldier[]>([]);
  const [events, setEvents]     = useState<TrainingEvent[]>([]);
  const [soldierIdStr, setSoldierIdStr] = useState("");
  const [eventIdStr, setEventIdStr]     = useState("");
  const [notes, setNotes]   = useState("");
  const [file, setFile]     = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ATAK context
  const [gps, setGps] = useState<GpsCoords | null>(null);

  // Reference rubric data
  const [leaderRef, setLeaderRef] = useState<TaskGroup[]>([]);
  const [unitRef, setUnitRef]     = useState<TaskGroup[]>([]);
  const [steoRef, setSteoRef]     = useState<SteoMission[]>([]);
  const [steoMission, setSteoMission] = useState("");

  // T/P/U ratings keyed by category then `${taskGroup}__${subtaskNumber}`
  const [ratingsMap, setRatingsMap] = useState<Record<EvalCategory, Record<string, Rating>>>({
    leader_eval: {}, unit_eval: {}, steo_eval: {},
  });

  // Collapsed state per task group
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<Assessment | null>(null);
  const [catScores, setCatScores] = useState<Record<string, number> | null>(null);
  const [error, setError]       = useState("");
  const [queued, setQueued]     = useState(false);

  // Ranger AI forwarding
  const [sendToRanger, setSendToRanger]         = useState(true);
  const [rangerExpanded, setRangerExpanded]     = useState(false);
  const [rangerInstructor, setRangerInstructor] = useState("instructor-1");
  const [rangerPlatoon, setRangerPlatoon]       = useState("plt-1");
  const [rangerMission, setRangerMission]       = useState("field-eval");
  const [rangerPhase, setRangerPhase]           = useState<typeof S1_PHASES[number]>("Mountain");
  const [rangerRun, setRangerRun]               = useState<S1Run | null>(null);
  const [rangerPolling, setRangerPolling]       = useState(false);
  const [rangerError, setRangerError]           = useState<string | null>(null);
  const [decidingRec, setDecidingRec]           = useState<string | null>(null);
  const [expandedRec, setExpandedRec]           = useState<string | null>(null);
  const rangerPollRef                           = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load soldiers, events, reference data
  useEffect(() => {
    Promise.all([
      api.get<Soldier[]>("/api/v1/soldiers"),
      api.get<TrainingEvent[]>("/api/v1/events"),
      api.get<TaskGroup[]>("/api/v1/analysis/reference/leader"),
      api.get<TaskGroup[]>("/api/v1/analysis/reference/unit"),
      api.get<SteoMission[]>("/api/v1/analysis/reference/steo"),
    ]).then(([s, e, lr, ur, sr]) => {
      setSoldiers(s);
      setEvents(e);
      setLeaderRef(lr);
      setUnitRef(ur);
      setSteoRef(sr);
      if (sr.length) setSteoMission(sr[0].mission);
    }).catch(() => {});
    return () => stopRangerPoll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const soldier = soldiers.find(s => String(s.id) === soldierIdStr);
    if (soldier?.unit) setRangerPlatoon(soldier.unit);
  }, [soldierIdStr, soldiers]);

  useEffect(() => {
    const ev = events.find(e => String(e.id) === eventIdStr);
    if (ev?.event_name) setRangerMission(ev.event_name);
  }, [eventIdStr, events]);

  // ATAK panel callbacks
  const handleAtakLink = useCallback((id: string) => {
    if (id) setSoldierIdStr(id);
  }, []);

  const handleGps = useCallback((coords: GpsCoords | null) => {
    setGps(coords);
  }, []);

  const ratings = ratingsMap[evalCategory];

  function setRating(key: string, r: Rating) {
    setRatingsMap(prev => ({
      ...prev,
      [evalCategory]: { ...prev[evalCategory], [key]: r },
    }));
  }

  function buildRatingsPayload(ref: TaskGroup[], evalType: string, cat: EvalCategory) {
    const r = ratingsMap[cat];
    return ref.flatMap(group =>
      group.subtasks.map(sub => ({
        task_group: group.task_group,
        task_name: evalType,
        subtask_number: sub.number,
        subtask_description: sub.description,
        rating: r[ratingKey(group.task_group, sub.number)] ?? "P",
      }))
    );
  }

  function buildSteoPayload() {
    const mission = steoRef.find(m => m.mission === steoMission);
    if (!mission) return [];
    const r = ratingsMap.steo_eval;
    return mission.subtasks.map(sub => ({
      task_group: "Mission Steps",
      task_name: steoMission,
      subtask_number: sub.number,
      subtask_description: sub.description,
      rating: r[ratingKey(steoMission, sub.number)] ?? "P",
    }));
  }

  function completionPct(ref: TaskGroup[] | SteoMission["subtasks"], isSteo = false): number {
    let total = 0; let rated = 0;
    if (isSteo) {
      const mission = steoRef.find(m => m.mission === steoMission);
      if (!mission) return 0;
      mission.subtasks.forEach(sub => {
        total++;
        if (ratings[ratingKey(steoMission, sub.number)]) rated++;
      });
    } else {
      (ref as TaskGroup[]).forEach(g =>
        g.subtasks.forEach(sub => {
          total++;
          if (ratings[ratingKey(g.task_group, sub.number)]) rated++;
        })
      );
    }
    return total ? Math.round((rated / total) * 100) : 0;
  }

  // Build GPS prefix for notes — mirrors what the ATAK plugin attaches to CoT messages
  function gpsPrefix(): string {
    if (!gps) return "";
    return `[GPS ${gps.lat.toFixed(5)},${gps.lon.toFixed(5)} ±${gps.accuracy}m]\n`;
  }

  function buildRangerFreeText(): string {
    const soldier = soldiers.find(s => String(s.id) === soldierIdStr);
    const soldierLabel = soldier ? `${soldier.rank} ${soldier.name} (${soldier.service_number})` : `Soldier #${soldierIdStr}`;
    const evalLabel = CATEGORY_LABELS[evalCategory];
    const lines: string[] = [`[${evalLabel}] ${soldierLabel}`];

    if (evalCategory === "leader_eval" || evalCategory === "unit_eval") {
      const ref = evalCategory === "leader_eval" ? leaderRef : unitRef;
      ref.forEach(group => {
        const parts = group.subtasks
          .map(sub => {
            const r = ratings[ratingKey(group.task_group, sub.number)];
            return r ? `${sub.description} = ${r}` : null;
          })
          .filter(Boolean);
        if (parts.length) lines.push(`${group.task_group}: ${parts.join(", ")}`);
      });
    } else if (evalCategory === "steo_eval") {
      const mission = steoRef.find(m => m.mission === steoMission);
      if (mission) {
        const parts = mission.subtasks
          .map(sub => {
            const r = ratings[ratingKey(steoMission, sub.number)];
            return r ? `Step ${sub.number} (${sub.description}) = ${r}` : null;
          })
          .filter(Boolean);
        if (parts.length) lines.push(`Mission: ${steoMission}. ${parts.join(". ")}`);
      }
    }

    if (notes.trim()) lines.push(`Notes: ${notes.trim()}`);
    return lines.join("\n");
  }

  function stopRangerPoll() {
    if (rangerPollRef.current) { clearInterval(rangerPollRef.current); rangerPollRef.current = null; }
    setRangerPolling(false);
  }

  async function fetchRangerRun(runId: string) {
    try {
      const { data } = await system1Api.getRun(runId);
      setRangerRun(data);
      if (S1_TERMINAL.has(data.status)) stopRangerPoll();
    } catch {
      // silently ignore transient poll errors
    }
  }

  async function forwardToRanger(assessmentResult: Assessment) {
    setRangerRun(null); setRangerError(null); setRangerPolling(false);
    stopRangerPoll();
    try {
      let audio_b64: string | null = null;
      let image_b64: string[] = [];
      if (captureMode === "stt" && file) audio_b64 = await toBase64(file);
      if (captureMode === "ocr" && file) image_b64 = [await toBase64(file)];

      const soldier = soldiers.find(s => String(s.id) === soldierIdStr);
      const soldierLabel = soldier
        ? `${soldier.rank} ${soldier.name} (${soldier.service_number})`
        : `Soldier #${soldierIdStr}`;
      const free_text = captureMode === "structured"
        ? buildRangerFreeText()
        : (`[${CATEGORY_LABELS[evalCategory]}] ${soldierLabel}\n${assessmentResult.ai_summary ?? notes ?? ""}`).trim() || null;

      const geo = gps
        ? { lat: gps.lat, lon: gps.lon, grid_mgrs: "ATAK" }
        : { lat: 0, lon: 0, grid_mgrs: "00A" };

      const { data } = await system1Api.ingest({
        instructor_id: rangerInstructor,
        platoon_id: rangerPlatoon,
        mission_id: rangerMission,
        phase: rangerPhase,
        timestamp_utc: new Date().toISOString(),
        geo,
        free_text,
        audio_b64,
        image_b64,
      });

      const runId: string = data.run_id;
      setRangerRun(data);

      if (!S1_TERMINAL.has(data.status as S1Status)) {
        setRangerPolling(true);
        rangerPollRef.current = setInterval(() => fetchRangerRun(runId), 2000);
      }
    } catch (err: unknown) {
      setRangerError(err instanceof Error ? err.message : "Ranger AI forwarding failed");
    }
  }

  async function handleRangerDecision(recId: string, decision: "approve" | "reject") {
    if (!rangerRun) return;
    setDecidingRec(recId);
    try {
      await system1Api.decide(recId, { decision });
      await fetchRangerRun(rangerRun.run_id);
    } catch (err: unknown) {
      setRangerError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setDecidingRec(null);
    }
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setLoading(true); setResult(null); setCatScores(null); setQueued(false);
    setRangerRun(null); setRangerError(null);

    const soldierId = parseInt(soldierIdStr);
    if (!soldierId) { setError("Select a soldier"); setLoading(false); return; }

    const notesWithGps = gpsPrefix() + notes;

    try {
      if (captureMode === "structured") {
        const payload = {
          soldier_id: soldierId,
          event_id: eventIdStr ? parseInt(eventIdStr) : null,
          eval_category: evalCategory,
          steo_mission_name: evalCategory === "steo_eval" ? steoMission : null,
          leader_ratings: evalCategory === "leader_eval" ? buildRatingsPayload(leaderRef, "Leader Eval", "leader_eval") : [],
          unit_ratings:   evalCategory === "unit_eval"   ? buildRatingsPayload(unitRef,   "Unit Eval",   "unit_eval")   : [],
          steo_ratings:   evalCategory === "steo_eval"   ? buildSteoPayload()                             : [],
          notes: notesWithGps,
          run_ai_scoring: !!notes.trim(),
        };
        const res = await api.post<Assessment & { category_scores: Record<string, number> }>(
          "/api/v1/assessments/submit-structured", payload
        );
        setResult(res);
        setCatScores((res as typeof res & { category_scores: Record<string, number> }).category_scores ?? null);
        if (sendToRanger) await forwardToRanger(res);
      } else {
        if (!file) { setError("Select a file to upload"); setLoading(false); return; }
        const form = new FormData();
        form.append("soldier_id", String(soldierId));
        if (eventIdStr) form.append("event_id", eventIdStr);
        form.append("assessment_type", "field_eval");
        form.append("file", file);
        if (notesWithGps.trim()) form.append("notes", notesWithGps);
        const endpoint = captureMode === "ocr"
          ? "/api/v1/assessments/capture/ocr"
          : "/api/v1/assessments/capture/stt";
        const res = await api.upload<Assessment>(endpoint, form);
        setResult(res);
        if (sendToRanger) await forwardToRanger(res);
      }
    } catch (err: unknown) {
      if (err instanceof OfflineError) {
        setQueued(true);
      } else {
        setError(err instanceof Error ? err.message : "Submission failed");
      }
    } finally {
      setLoading(false);
    }
  }

  const activeRef = evalCategory === "leader_eval" ? leaderRef : unitRef;
  const pct = captureMode === "structured"
    ? (evalCategory === "steo_eval" ? completionPct([], true) : completionPct(activeRef))
    : 100;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-black text-white">New Evaluation</h1>
        <p className="text-[#8b949e] text-xs mt-0.5">Phase 01 — Data Capture · AI Scoring</p>
      </div>

      {/* ATAK context panel — GPS + device link */}
      <AtakDevicePanel onLink={handleAtakLink} onGps={handleGps} />

      {/* Capture mode */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {([
          { key: "structured" as CaptureMode, label: "Structured Eval", icon: <FileText size={16} />, desc: "Leader / Unit / SQD ST&EO rubric" },
          { key: "ocr"        as CaptureMode, label: "Photo / OCR",     icon: <Camera size={16} />,   desc: "Upload photo of whiteboard or form" },
          { key: "stt"        as CaptureMode, label: "Voice / STT",     icon: <Mic size={16} />,      desc: "Upload audio for transcription" },
        ]).map(m => (
          <button
            key={m.key}
            onClick={() => { setCaptureMode(m.key); setResult(null); setError(""); setQueued(false); }}
            className={`p-4 rounded-lg border text-left transition-colors ${
              captureMode === m.key ? "border-[#3fb950] bg-[#3fb950]/10" : "border-[#30363d] bg-[#161b22] hover:border-[#8b949e]"
            }`}
          >
            <div className={`mb-2 ${captureMode === m.key ? "text-[#3fb950]" : "text-[#8b949e]"}`}>{m.icon}</div>
            <div className="text-sm font-semibold text-white">{m.label}</div>
            <div className="text-[10px] text-[#8b949e] mt-0.5">{m.desc}</div>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Soldier + Event */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Soldier *</label>
              <select
                value={soldierIdStr}
                onChange={e => setSoldierIdStr(e.target.value)}
                required
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
              >
                <option value="">Select soldier…</option>
                {soldiers.map(s => (
                  <option key={s.id} value={String(s.id)}>{s.rank} {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Training Event</label>
              <select
                value={eventIdStr}
                onChange={e => setEventIdStr(e.target.value)}
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
              >
                <option value="">None</option>
                {events.map(ev => (
                  <option key={ev.id} value={String(ev.id)}>{ev.event_name}</option>
                ))}
              </select>
            </div>
          </div>
          {/* GPS tag indicator */}
          {gps && (
            <p className="mt-2 text-[10px] text-[#3fb950]/80">
              GPS coordinates will be attached to this evaluation.
            </p>
          )}
        </div>

        {/* Structured eval */}
        {captureMode === "structured" && (
          <div className="space-y-4">
            {/* Eval type tabs */}
            <div className="flex gap-1 bg-[#161b22] border border-[#30363d] rounded-lg p-1">
              {(["leader_eval", "unit_eval", "steo_eval"] as EvalCategory[]).map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => { setEvalCategory(cat); setCollapsed({}); }}
                  className={`flex-1 py-2 rounded-md text-xs sm:text-sm font-semibold transition-colors ${
                    evalCategory === cat
                      ? "bg-[#3fb950] text-black"
                      : "text-[#8b949e] hover:text-white"
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#3fb950] transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] text-[#8b949e] w-10 text-right">{pct}%</span>
            </div>

            {/* Rating legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              <span><span className="text-[#3fb950] font-bold">T</span> <span className="text-[#8b949e]">= Trained (5)</span></span>
              <span><span className="text-[#f59e0b] font-bold">P</span> <span className="text-[#8b949e]">= Partially Trained (3)</span></span>
              <span><span className="text-[#f85149] font-bold">U</span> <span className="text-[#8b949e]">= Untrained (1)</span></span>
            </div>

            {/* Leader / Unit eval — category sections */}
            {(evalCategory === "leader_eval" || evalCategory === "unit_eval") && (
              <div className="space-y-2">
                {activeRef.map(group => (
                  <TaskGroupSection key={group.task_group} group={group} collapsed={collapsed} setCollapsed={setCollapsed} ratings={ratings} setRating={setRating} />
                ))}
              </div>
            )}

            {/* ST&EO eval */}
            {evalCategory === "steo_eval" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Mission Type *</label>
                  <select
                    value={steoMission}
                    onChange={e => { setSteoMission(e.target.value); setRatingsMap(prev => ({ ...prev, steo_eval: {} })); }}
                    className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
                  >
                    {steoRef.map(m => (
                      <option key={m.mission} value={m.mission}>{m.mission}</option>
                    ))}
                  </select>
                </div>
                <div className="border border-[#30363d] rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-[#161b22] text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
                    Steps — Rate each T / P / U
                  </div>
                  <div className="px-4 py-1 bg-[#0d1117]">
                    {steoRef.find(m => m.mission === steoMission)?.subtasks.map(sub => (
                      <RatingButton key={sub.number} groupKey={steoMission} sub={sub} ratings={ratings} setRating={setRating} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Optional notes */}
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">
                Evaluator Notes <span className="normal-case">(optional — triggers AI scoring)</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Additional observations, context, or freeform notes…"
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-[#3fb950] resize-none"
              />
            </div>
          </div>
        )}

        {/* OCR / STT upload */}
        {(captureMode === "ocr" || captureMode === "stt") && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 space-y-3">
            <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider">
              {captureMode === "ocr" ? "Photo (JPEG / PNG)" : "Audio (M4A / MP3 / WAV)"} *
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-[#30363d] rounded-lg p-8 text-center cursor-pointer hover:border-[#3fb950] transition-colors"
            >
              <Upload size={24} className="mx-auto text-[#8b949e] mb-2" />
              {file ? (
                <p className="text-sm text-[#3fb950]">{file.name}</p>
              ) : (
                <p className="text-sm text-[#8b949e]">Click to select file</p>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={captureMode === "ocr" ? "image/*" : "audio/*"}
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}

        {/* Ranger AI forwarding */}
        <div className="border border-[#30363d] rounded-lg overflow-hidden">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setRangerExpanded(p => !p)}
            onKeyDown={e => e.key === "Enter" && setRangerExpanded(p => !p)}
            className="w-full flex items-center justify-between px-4 py-3 bg-[#161b22] hover:bg-[#21262d] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Bot size={14} className="text-[#58a6ff]" />
              <span className="text-sm font-semibold text-white">Forward to Ranger AI</span>
              <span className="text-[10px] text-[#8b949e]">System 1</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setSendToRanger(p => !p); }}
                className={`relative w-9 h-5 rounded-full transition-colors ${sendToRanger ? "bg-[#58a6ff]" : "bg-[#30363d]"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${sendToRanger ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
              {rangerExpanded ? <ChevronDown size={14} className="text-[#8b949e]" /> : <ChevronRight size={14} className="text-[#8b949e]" />}
            </div>
          </div>
          {rangerExpanded && (
            <div className="px-4 py-3 bg-[#0d1117] grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Instructor ID</label>
                <input value={rangerInstructor} onChange={e => setRangerInstructor(e.target.value)}
                  className="mt-1 w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#58a6ff]" />
              </div>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Platoon ID</label>
                <input value={rangerPlatoon} onChange={e => setRangerPlatoon(e.target.value)}
                  className="mt-1 w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#58a6ff]" />
              </div>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Mission ID</label>
                <input value={rangerMission} onChange={e => setRangerMission(e.target.value)}
                  className="mt-1 w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#58a6ff]" />
              </div>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Phase</label>
                <select value={rangerPhase} onChange={e => setRangerPhase(e.target.value as typeof S1_PHASES[number])}
                  className="mt-1 w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#58a6ff]">
                  {S1_PHASES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {error  && <p className="text-[#f85149] text-xs">{error}</p>}

        {queued && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-900/30 border border-amber-700/50 px-4 py-2.5">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
            <p className="text-xs text-amber-200">
              You&apos;re offline — evaluation saved locally and will sync automatically when connected.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-[#3fb950] hover:bg-green-600 text-black font-bold text-sm rounded-md transition-colors disabled:opacity-50"
        >
          {loading ? "Processing…" : sendToRanger ? "Submit, Score & Forward to Ranger AI" : "Submit & Score"}
        </button>
      </form>

      {/* Evaluation result */}
      {result && (
        <div className="bg-[#161b22] border border-[#3fb950] rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-[#3fb950]" />
            <h2 className="text-sm font-semibold text-white">Evaluation Recorded</h2>
            {result.eval_category && (
              <span className="ml-auto text-[10px] bg-[#3fb950]/10 text-[#3fb950] px-2 py-0.5 rounded-full uppercase tracking-wider">
                {CATEGORY_LABELS[result.eval_category as EvalCategory]}
              </span>
            )}
          </div>

          {catScores && Object.keys(catScores).length > 0 && (
            <div>
              <p className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-2">Category Scores</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {Object.entries(catScores).map(([cat, score]) => {
                  const color = score >= 4.5 ? "#3fb950" : score >= 3 ? "#f59e0b" : "#f85149";
                  const label = score >= 4.5 ? "T" : score >= 3 ? "P" : "U";
                  return (
                    <div key={cat} className="bg-[#0d1117] rounded-lg p-3 text-center">
                      <div className="text-xl font-bold" style={{ color }}>{score.toFixed(1)}</div>
                      <div className="text-[10px] text-[#8b949e] mt-0.5 leading-tight">{cat}</div>
                      <div className="text-[10px] font-bold mt-0.5" style={{ color }}>{label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {result.score_leadership != null && (
            <div>
              <p className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-2">AI Analysis</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {[
                  { l: "Leadership",  v: result.score_leadership,      c: "#3fb950" },
                  { l: "Decision",    v: result.score_decision_quality, c: "#f59e0b" },
                  { l: "Stress Res.", v: result.score_stress_response,  c: "#58a6ff" },
                  { l: "Tactical",    v: result.score_tactical,         c: "#f85149" },
                  { l: "Comms",       v: result.score_communication,    c: "#a371f7" },
                ].map(s => s.v != null && (
                  <div key={s.l} className="bg-[#0d1117] rounded-lg p-3 text-center">
                    <div className="text-xl font-bold" style={{ color: s.c }}>{s.v.toFixed(1)}</div>
                    <div className="text-[10px] text-[#8b949e] mt-0.5">{s.l}</div>
                    <div className="text-[10px] text-[#6e7681]">/ 5.0</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.ai_summary && (
            <p className="text-sm text-[#8b949e] leading-relaxed border-l-2 border-[#3fb950] pl-3">
              {result.ai_summary}
            </p>
          )}
        </div>
      )}

      {/* Ranger AI output panel */}
      {(rangerRun || rangerPolling || rangerError) && (
        <div className="bg-[#161b22] border border-[#58a6ff]/40 rounded-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#30363d] bg-[#0d1117]">
            <Bot size={14} className="text-[#58a6ff] shrink-0" />
            <span className="text-sm font-bold text-white">Ranger AI Output</span>
            {rangerRun && (
              <span className="font-mono text-[10px] text-[#8b949e] ml-1">{rangerRun.run_id.slice(0, 18)}…</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {rangerPolling && (
                <span className="flex items-center gap-1 text-[10px] text-[#f59e0b]">
                  <Loader2 size={10} className="animate-spin" /> Processing…
                </span>
              )}
              {rangerRun && !rangerPolling && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  rangerRun.status === "completed" || rangerRun.status === "pending_approval"
                    ? "bg-[#3fb950]/10 text-[#3fb950]"
                    : rangerRun.status === "failed"
                    ? "bg-[#f85149]/10 text-[#f85149]"
                    : "bg-[#f59e0b]/10 text-[#f59e0b]"
                }`}>
                  {rangerRun.status.replace(/_/g, " ").toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {rangerError && (
            <div className="flex items-center gap-2 m-4 p-3 bg-[#f85149]/10 border border-[#f85149]/30 rounded text-xs text-[#f85149]">
              <AlertTriangle size={12} /> {rangerError}
            </div>
          )}

          {rangerRun?.errors?.length ? (
            <div className="m-4 p-3 bg-[#f85149]/10 border border-[#f85149]/30 rounded text-xs text-[#f85149] space-y-0.5">
              {rangerRun.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          ) : null}

          {/* Observations */}
          {(rangerRun?.observations?.length ?? 0) > 0 && (
            <div className="px-4 pt-3 pb-2">
              <p className="text-[10px] font-bold text-[#8b949e] uppercase tracking-wider mb-2">
                Observations ({rangerRun!.observations!.length})
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {rangerRun!.observations!.map(obs => (
                  <div key={obs.observation_id} className="flex items-start gap-2 text-xs py-1.5 border-b border-[#21262d] last:border-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${RATING_BADGE[obs.rating]}`}>
                      {obs.rating}
                    </span>
                    <div className="flex-1 min-w-0">
                      {obs.soldier_id && <span className="text-[#58a6ff] mr-1.5">{obs.soldier_id}</span>}
                      {obs.task_code  && <span className="text-[#8b949e] mr-1.5">[{obs.task_code}]</span>}
                      <span className="text-[#c9d1d9]">{obs.note}</span>
                    </div>
                    {obs.source && <span className="text-[#6e7681] shrink-0 text-[10px]">{obs.source}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {(rangerRun?.recommendations?.length ?? 0) > 0 && (
            <div className="px-4 pb-4 space-y-2">
              <p className="text-[10px] font-bold text-[#8b949e] uppercase tracking-wider pt-1">
                Recommendations ({rangerRun!.recommendations!.length})
              </p>
              {rangerRun!.recommendations!.map(({ recommendation: rec, policy, status }) => {
                const isPending = status === "pending";
                const isBlocked = status === "blocked";
                const isOpen = expandedRec === rec.recommendation_id;
                return (
                  <div key={rec.recommendation_id}
                    className={`border rounded-lg overflow-hidden ${
                      isBlocked  ? "border-[#f85149]/20 opacity-70"
                      : status === "approved" ? "border-[#3fb950]/30"
                      : status === "rejected" ? "border-[#30363d] opacity-50"
                      : "border-[#30363d]"
                    }`}>
                    <button
                      onClick={() => setExpandedRec(isOpen ? null : rec.recommendation_id)}
                      className="w-full flex items-start gap-2 p-3 text-left hover:bg-[#21262d] transition-colors bg-[#0d1117]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          {rec.target_soldier_id && (
                            <span className="text-[10px] font-bold bg-[#58a6ff]/10 text-[#58a6ff] px-1.5 py-0.5 rounded">
                              {rec.target_soldier_id}
                            </span>
                          )}
                          {rec.risk_level && (
                            <span className={`text-[10px] font-bold ${rec.risk_level === "high" ? "text-[#f85149]" : "text-[#f59e0b]"}`}>
                              {rec.risk_level.toUpperCase()} RISK
                            </span>
                          )}
                          {isBlocked && <span className="text-[10px] font-bold text-[#f85149]">BLOCKED</span>}
                          {status === "approved" && <CheckCircle size={11} className="text-[#3fb950]" />}
                          {status === "rejected" && <XCircle size={11} className="text-[#f85149]" />}
                        </div>
                        <p className="text-xs text-white leading-snug">
                          {rec.proposed_modification ?? rec.rationale}
                        </p>
                        {rec.development_edge && (
                          <p className="text-[10px] text-[#58a6ff] mt-0.5">Edge: {rec.development_edge}</p>
                        )}
                      </div>
                      {isOpen
                        ? <ChevronDown size={13} className="text-[#8b949e] shrink-0 mt-0.5" />
                        : <ChevronRight size={13} className="text-[#8b949e] shrink-0 mt-0.5" />}
                    </button>

                    {isOpen && (
                      <div className="px-3 pb-3 space-y-1.5 text-xs bg-[#0d1117] border-t border-[#21262d]">
                        {rec.learning_objective && (
                          <p className="text-[#8b949e] pt-2"><span className="text-white">Objective: </span>{rec.learning_objective}</p>
                        )}
                        {rec.rationale && (
                          <p className="text-[#8b949e]"><span className="text-white">Rationale: </span>{rec.rationale}</p>
                        )}
                        {rec.safety_checks?.length ? (
                          <div className="space-y-0.5">
                            <span className="text-white">Safety: </span>
                            {rec.safety_checks.map((c, i) => (
                              <p key={i} className="text-[#f59e0b] flex gap-1 items-start">
                                <AlertTriangle size={10} className="shrink-0 mt-0.5" />{c}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {rec.doctrine_refs?.length ? (
                          <div>
                            <span className="text-white">Doctrine: </span>
                            {rec.doctrine_refs.map((d, i) => <p key={i} className="text-[#8b949e]">• {d}</p>)}
                          </div>
                        ) : null}
                        {isBlocked && policy.reasons.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {policy.reasons.map((r, i) => (
                              <p key={i} className="flex items-center gap-1 text-[#f85149]">
                                <XCircle size={10} />{r}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {isPending && (
                      <div className="flex gap-2 px-3 py-2 bg-[#161b22] border-t border-[#21262d]">
                        <button
                          onClick={() => handleRangerDecision(rec.recommendation_id, "approve")}
                          disabled={decidingRec === rec.recommendation_id}
                          className="flex-1 flex items-center justify-center gap-1 bg-[#3fb950]/10 hover:bg-[#3fb950]/20 border border-[#3fb950]/30 text-[#3fb950] text-[11px] font-bold py-1.5 rounded disabled:opacity-50 transition-colors"
                        >
                          {decidingRec === rec.recommendation_id
                            ? <Loader2 size={11} className="animate-spin" />
                            : <CheckCircle size={11} />} Approve
                        </button>
                        <button
                          onClick={() => handleRangerDecision(rec.recommendation_id, "reject")}
                          disabled={decidingRec === rec.recommendation_id}
                          className="flex-1 flex items-center justify-center gap-1 bg-[#f85149]/10 hover:bg-[#f85149]/20 border border-[#f85149]/30 text-[#f85149] text-[11px] font-bold py-1.5 rounded disabled:opacity-50 transition-colors"
                        >
                          <XCircle size={11} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state while polling and no data yet */}
          {rangerPolling && !rangerRun?.observations?.length && !rangerRun?.recommendations?.length && (
            <div className="px-4 py-6 text-center text-xs text-[#8b949e]">
              <Loader2 size={20} className="animate-spin text-[#58a6ff] mx-auto mb-2" />
              Waiting for Ranger AI to process the evaluation…
            </div>
          )}
        </div>
      )}

    </div>
  );
}
