"use client";
import { useState } from "react";
import {
  Brain, Send, CheckCircle, XCircle, AlertTriangle, Plus, Trash2,
  Loader2, ChevronDown, ChevronRight, Info, Shield,
} from "lucide-react";
import { system2Api } from "@/lib/system2";

const S2_API_LABEL = "/api/v1/system2";

type Confidence = "high" | "medium" | "low";
type RiskLevel = "low" | "medium" | "high";
type InjectType = "direct_pressure" | "skill_isolation" | "transfer_test";
type CognitiveDimension =
  | "sensemaking" | "critical_thinking" | "systems_thinking"
  | "leadership_communication" | "execution_reliability"
  | "cognitive_load" | "sleep_fatigue" | "nutrition_strain" | "team_trust";
type EvidenceSourceType =
  | "voice_note" | "transcript" | "ocr_text" | "checklist"
  | "patrol_summary" | "aar" | "weather" | "terrain" | "structured_event";

const DIMENSIONS: CognitiveDimension[] = [
  "sensemaking","critical_thinking","systems_thinking","leadership_communication",
  "execution_reliability","cognitive_load","sleep_fatigue","nutrition_strain","team_trust",
];
const SOURCE_TYPES: EvidenceSourceType[] = [
  "voice_note","transcript","ocr_text","checklist","patrol_summary","aar","weather","terrain","structured_event",
];
const INJECT_LABELS: Record<InjectType, string> = {
  direct_pressure: "Direct Pressure",
  skill_isolation: "Skill Isolation",
  transfer_test: "Transfer Test",
};
const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: "bg-[#3fb950]/20 text-[#3fb950]",
  medium: "bg-[#f59e0b]/20 text-[#f59e0b]",
  low: "bg-[#f85149]/20 text-[#f85149]",
};
const RISK_COLOR: Record<RiskLevel, string> = {
  low: "text-[#3fb950]", medium: "text-[#f59e0b]", high: "text-[#f85149]",
};

interface EvidenceItem {
  id: string;
  source_type: EvidenceSourceType;
  text: string;
  tags: string;
  soldier_ids: string;
  sleep_hours: string;
  cognitive_load: string;
}

interface DimEstimate {
  dimension: CognitiveDimension;
  current_score: number;
  development_priority: number;
  confidence: Confidence;
  trend?: string;
  rationale?: string;
  evidence_refs?: string[];
}

interface StateSnapshot {
  primary_development_dimension?: CognitiveDimension;
  likely_failure_mode?: string;
  state_summary?: string;
  estimates?: DimEstimate[];
}

interface Recommendation {
  recommendation_id: string;
  title: string;
  inject_type: InjectType;
  target_dimension?: CognitiveDimension;
  proposed_inject: string;
  expected_developmental_effect: string;
  rationale: string;
  doctrine_refs?: string[];
  safety_checks?: string[];
  risk_level: RiskLevel;
  safety_risk: number;
  fatigue_risk: number;
  unfair_exposure_risk: number;
  expected_learning_gain: number;
  confidence: Confidence;
  status: "pending_approval" | "blocked";
  block_reason?: string | null;
}

interface AdaptationResponse {
  adaptation_id: string;
  status: string;
  state: StateSnapshot;
  recommendations: Recommendation[];
  blocked_recommendations: Recommendation[];
  approval_required: boolean;
}

function newEvidence(): EvidenceItem {
  return { id: crypto.randomUUID(), source_type: "voice_note", text: "", tags: "", soldier_ids: "", sleep_hours: "", cognitive_load: "" };
}

function ScoreBar({ value, color = "#58a6ff" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 bg-[#30363d] rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(value * 100, 100)}%`, backgroundColor: color }} />
    </div>
  );
}

export default function CognitiveAdaptPage() {
  const [missionId, setMissionId]     = useState("raid-tonight");
  const [instructorId, setInstructorId] = useState("instructor-1");
  const [teamId, setTeamId]           = useState("alpha");
  const [phase, setPhase]             = useState("");
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([newEvidence()]);

  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [adaptation, setAdaptation]   = useState<AdaptationResponse | null>(null);

  const [approvalModal, setApprovalModal] = useState<Recommendation | null>(null);
  const [approvalRationale, setApprovalRationale] = useState("");
  const [approving, setApproving]     = useState(false);
  const [approvalResult, setApprovalResult] = useState<Record<string, "approved" | "rejected">>({});

  const [traceOpen, setTraceOpen]     = useState(false);
  const [expandedRec, setExpandedRec] = useState<string | null>(null);

  function addEvidence() { setEvidenceItems(prev => [...prev, newEvidence()]); }
  function removeEvidence(id: string) { setEvidenceItems(prev => prev.filter(e => e.id !== id)); }
  function updateEvidence(id: string, field: keyof EvidenceItem, value: string) {
    setEvidenceItems(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }

  async function handleSubmit() {
    setError(null); setSubmitting(true);
    try {
      const evidence = evidenceItems
        .filter(e => e.text.trim())
        .map((e, i) => ({
          evidence_id: `obs-${i + 1}`,
          source_type: e.source_type,
          text: e.text,
          tags: e.tags ? e.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
          soldier_ids: e.soldier_ids ? e.soldier_ids.split(",").map(s => s.trim()).filter(Boolean) : [],
          metrics: {
            ...(e.sleep_hours ? { sleep_hours: parseFloat(e.sleep_hours) } : {}),
            ...(e.cognitive_load ? { cognitive_load: parseFloat(e.cognitive_load) } : {}),
          },
        }));
      if (!evidence.length) { setError("Add at least one evidence observation with text."); setSubmitting(false); return; }
      const result = await system2Api.createAdaptation<AdaptationResponse>({
          mission_id: missionId,
          instructor_id: instructorId,
          team_id: teamId,
          phase: phase || null,
          evidence,
          require_human_approval: true,
      });
      setAdaptation(result);
      setApprovalResult({});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApproval(decision: "approved" | "rejected") {
    if (!approvalModal || !adaptation) return;
    if (!approvalRationale.trim()) { setError("Rationale is required before approving or rejecting."); return; }
    setApproving(true); setError(null);
    try {
      await system2Api.approveAdaptation(adaptation.adaptation_id, {
          recommendation_id: approvalModal.recommendation_id,
          decision,
          approver_id: instructorId,
          rationale: approvalRationale,
      });
      setApprovalResult(prev => ({ ...prev, [approvalModal.recommendation_id]: decision }));
      setApprovalModal(null);
      setApprovalRationale("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setApproving(false);
    }
  }

  const dimLabel = (d: string) => d.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const allRecs = [...(adaptation?.recommendations ?? []), ...(adaptation?.blocked_recommendations ?? [])];

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Brain size={24} className="text-[#a371f7]" />
          <div>
            <h1 className="text-xl font-bold text-white">Cognitive Adapt</h1>
            <p className="text-xs text-[#8b949e]">Cognitive Mission Adaptation Engine — System 2 · {S2_API_LABEL}</p>
          </div>
          {adaptation && (
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-[#8b949e]">Adaptation</span>
              <span className="font-mono text-[#a371f7]">{adaptation.adaptation_id.slice(0,20)}…</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${adaptation.status === "pending_approval" ? "bg-[#58a6ff]/10 text-[#58a6ff]" : "bg-[#3fb950]/10 text-[#3fb950]"}`}>
                {adaptation.status.replace(/_/g, " ")}
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[#f85149]/10 border border-[#f85149]/30 rounded-lg text-sm text-[#f85149] flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: Evidence Form */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Send size={14} className="text-[#a371f7]" /> Evidence Ingest
              </h2>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Mission ID</label>
                    <input value={missionId} onChange={e => setMissionId(e.target.value)}
                      className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#a371f7]" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Team ID</label>
                    <input value={teamId} onChange={e => setTeamId(e.target.value)}
                      className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#a371f7]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Instructor ID</label>
                    <input value={instructorId} onChange={e => setInstructorId(e.target.value)}
                      className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#a371f7]" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Phase (opt.)</label>
                    <input value={phase} onChange={e => setPhase(e.target.value)} placeholder="e.g. Mountain"
                      className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#a371f7] placeholder-[#6e7681]" />
                  </div>
                </div>

                <div className="border-t border-[#21262d] pt-3">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-white">Evidence Observations</span>
                    <button onClick={addEvidence} className="flex items-center gap-1 text-[10px] text-[#a371f7] hover:text-white transition-colors">
                      <Plus size={10} /> Add
                    </button>
                  </div>
                  <div className="space-y-3">
                    {evidenceItems.map((ev, idx) => (
                      <div key={ev.id} className="bg-[#0d1117] border border-[#30363d] rounded p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[#8b949e]">Obs #{idx + 1}</span>
                          {evidenceItems.length > 1 && (
                            <button onClick={() => removeEvidence(ev.id)} className="text-[#6e7681] hover:text-[#f85149] transition-colors">
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                        <select value={ev.source_type} onChange={e => updateEvidence(ev.id, "source_type", e.target.value)}
                          className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#a371f7]">
                          {SOURCE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                        </select>
                        <textarea value={ev.text} onChange={e => updateEvidence(ev.id, "text", e.target.value)} rows={2}
                          placeholder="Observation text…"
                          className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs text-white resize-none focus:outline-none focus:border-[#a371f7] placeholder-[#6e7681]" />
                        <div className="grid grid-cols-2 gap-2">
                          <input value={ev.tags} onChange={e => updateEvidence(ev.id, "tags", e.target.value)}
                            placeholder="tags (comma sep)" className="bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#a371f7] placeholder-[#6e7681]" />
                          <input value={ev.soldier_ids} onChange={e => updateEvidence(ev.id, "soldier_ids", e.target.value)}
                            placeholder="soldier IDs" className="bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#a371f7] placeholder-[#6e7681]" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" value={ev.sleep_hours} onChange={e => updateEvidence(ev.id, "sleep_hours", e.target.value)}
                            placeholder="sleep hrs" className="bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#a371f7] placeholder-[#6e7681]" />
                          <input type="number" min="0" max="1" step="0.1" value={ev.cognitive_load} onChange={e => updateEvidence(ev.id, "cognitive_load", e.target.value)}
                            placeholder="cog load 0–1" className="bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#a371f7] placeholder-[#6e7681]" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={handleSubmit} disabled={submitting}
                  className="w-full bg-[#a371f7] hover:bg-[#a371f7]/80 disabled:opacity-50 text-white font-bold text-xs py-2 rounded transition-colors flex items-center justify-center gap-2">
                  {submitting ? <><Loader2 size={14} className="animate-spin" /> Analyzing…</> : <><Brain size={14} /> Analyze &amp; Recommend</>}
                </button>
              </div>
            </div>
          </div>

          {/* Right: State + Recommendations */}
          <div className="lg:col-span-3 space-y-4">
            {!adaptation ? (
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-8 text-center">
                <Brain size={40} className="text-[#30363d] mx-auto mb-3" />
                <p className="text-sm text-[#8b949e]">Submit evidence to see cognitive state and scenario recommendations</p>
              </div>
            ) : (
              <>
                {/* State Panel */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
                  <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <Info size={14} className="text-[#a371f7]" /> Cognitive State
                  </h2>
                  {adaptation.state.primary_development_dimension && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-[#8b949e]">Primary Target:</span>
                      <span className="text-xs font-bold bg-[#a371f7]/20 text-[#a371f7] px-2 py-0.5 rounded">
                        {dimLabel(adaptation.state.primary_development_dimension)}
                      </span>
                    </div>
                  )}
                  {adaptation.state.state_summary && (
                    <p className="text-xs text-[#8b949e] mb-3 leading-relaxed">{adaptation.state.state_summary}</p>
                  )}
                  {adaptation.state.likely_failure_mode && (
                    <div className="mb-3 p-2 bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded text-xs text-[#f59e0b]">
                      <span className="font-bold">Likely Failure Mode: </span>{adaptation.state.likely_failure_mode}
                    </div>
                  )}
                  {(adaptation.state.estimates?.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      {adaptation.state.estimates!.map(est => (
                        <div key={est.dimension} className="space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="flex-1 text-[#c9d1d9]">{dimLabel(est.dimension)}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${CONFIDENCE_COLOR[est.confidence]}`}>{est.confidence}</span>
                            <span className="text-[#8b949e] w-8 text-right">{(est.current_score * 100).toFixed(0)}%</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            <div>
                              <div className="text-[9px] text-[#6e7681] mb-0.5">Score</div>
                              <ScoreBar value={est.current_score} color="#58a6ff" />
                            </div>
                            <div>
                              <div className="text-[9px] text-[#6e7681] mb-0.5">Priority</div>
                              <ScoreBar value={est.development_priority} color="#a371f7" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recommendations */}
                {allRecs.length > 0 && (
                  <div>
                    <h2 className="text-xs font-bold text-[#a371f7] uppercase tracking-wider mb-2">
                      Scenario Recommendations ({allRecs.length})
                    </h2>
                    <div className="space-y-3">
                      {allRecs.map(rec => {
                        const decided = approvalResult[rec.recommendation_id];
                        const isBlocked = rec.status === "blocked";
                        const open = expandedRec === rec.recommendation_id;
                        return (
                          <div key={rec.recommendation_id} className={`bg-[#161b22] border rounded-lg overflow-hidden ${isBlocked ? "border-[#f85149]/20 opacity-70" : "border-[#30363d]"}`}>
                            <button onClick={() => setExpandedRec(open ? null : rec.recommendation_id)}
                              className="w-full flex items-start gap-3 p-4 text-left hover:bg-[#21262d] transition-colors">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#a371f7]/10 text-[#a371f7]`}>
                                    {INJECT_LABELS[rec.inject_type]}
                                  </span>
                                  {rec.target_dimension && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#58a6ff]/10 text-[#58a6ff]">{dimLabel(rec.target_dimension)}</span>
                                  )}
                                  <span className={`text-[10px] font-bold ${RISK_COLOR[rec.risk_level]}`}>
                                    {rec.risk_level.toUpperCase()} RISK
                                  </span>
                                  {decided && (
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${decided === "approved" ? "bg-[#3fb950]/10 text-[#3fb950]" : "bg-[#f85149]/10 text-[#f85149]"}`}>
                                      {decided.toUpperCase()}
                                    </span>
                                  )}
                                  {isBlocked && <span className="text-[10px] font-bold bg-[#f85149]/10 text-[#f85149] px-1.5 py-0.5 rounded">BLOCKED</span>}
                                </div>
                                <p className="text-sm font-semibold text-white">{rec.title}</p>
                                <p className="text-xs text-[#8b949e] mt-0.5 line-clamp-2">{rec.proposed_inject}</p>
                              </div>
                              {open ? <ChevronDown size={14} className="text-[#8b949e] shrink-0 mt-1" /> : <ChevronRight size={14} className="text-[#8b949e] shrink-0 mt-1" />}
                            </button>

                            {open && (
                              <div className="px-4 pb-4 space-y-3 border-t border-[#21262d] text-xs">
                                <div className="pt-3 grid grid-cols-3 gap-2">
                                  {[
                                    { label: "Safety Risk", value: rec.safety_risk, color: "#f85149" },
                                    { label: "Fatigue Risk", value: rec.fatigue_risk, color: "#f59e0b" },
                                    { label: "Learning Gain", value: rec.expected_learning_gain, color: "#3fb950" },
                                  ].map(({ label, value, color }) => (
                                    <div key={label}>
                                      <div className="text-[9px] text-[#6e7681] mb-1">{label}</div>
                                      <ScoreBar value={value} color={color} />
                                      <div className="text-right mt-0.5" style={{ color }}>{(value * 100).toFixed(0)}%</div>
                                    </div>
                                  ))}
                                </div>
                                <p className="text-[#8b949e]"><span className="text-white">Effect:</span> {rec.expected_developmental_effect}</p>
                                <p className="text-[#8b949e]"><span className="text-white">Rationale:</span> {rec.rationale}</p>
                                {rec.safety_checks?.length ? (
                                  <div>
                                    <span className="text-white">Safety:</span>
                                    <ul className="mt-1 space-y-0.5">
                                      {rec.safety_checks.map((c, i) => <li key={i} className="flex gap-1 text-[#f59e0b]"><Shield size={10} className="shrink-0 mt-0.5" />{c}</li>)}
                                    </ul>
                                  </div>
                                ) : null}
                                {rec.doctrine_refs?.length ? (
                                  <div>
                                    <span className="text-white">Doctrine:</span>
                                    <ul className="mt-1 space-y-0.5">
                                      {rec.doctrine_refs.map((d, i) => <li key={i} className="text-[#8b949e]">• {d}</li>)}
                                    </ul>
                                  </div>
                                ) : null}
                                {isBlocked && rec.block_reason && (
                                  <div className="p-2 bg-[#f85149]/10 border border-[#f85149]/20 rounded text-[#f85149]">
                                    {rec.block_reason}
                                  </div>
                                )}
                              </div>
                            )}

                            {!isBlocked && !decided && (
                              <div className="flex gap-2 px-4 py-3 bg-[#0d1117] border-t border-[#21262d]">
                                <button onClick={() => { setApprovalModal(rec); setApprovalRationale(""); }}
                                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#3fb950]/10 hover:bg-[#3fb950]/20 border border-[#3fb950]/30 text-[#3fb950] text-xs font-bold py-1.5 rounded transition-colors">
                                  <CheckCircle size={12} /> Approve
                                </button>
                                <button onClick={() => { setApprovalModal(rec); setApprovalRationale(""); }}
                                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#f85149]/10 hover:bg-[#f85149]/20 border border-[#f85149]/30 text-[#f85149] text-xs font-bold py-1.5 rounded transition-colors">
                                  <XCircle size={12} /> Reject
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Trace */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden">
                  <button onClick={() => setTraceOpen(!traceOpen)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-xs text-[#8b949e] hover:text-white hover:bg-[#21262d] transition-colors">
                    {traceOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="font-bold uppercase tracking-wider">Audit Trace</span>
                  </button>
                  {traceOpen && (
                    <div className="px-4 pb-4 border-t border-[#21262d]">
                      <pre className="text-[10px] text-[#6e7681] mt-3 overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify({ adaptation_id: adaptation.adaptation_id, status: adaptation.status, approval_required: adaptation.approval_required }, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Approval Modal */}
      {approvalModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-sm font-bold text-white">Instructor Decision</h3>
            <div className="bg-[#0d1117] rounded p-3">
              <p className="text-xs text-white font-semibold">{approvalModal.title}</p>
              <p className="text-xs text-[#8b949e] mt-1">{approvalModal.proposed_inject}</p>
            </div>
            <div>
              <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Rationale (required)</label>
              <textarea value={approvalRationale} onChange={e => setApprovalRationale(e.target.value)} rows={3}
                placeholder="Explain your decision…"
                className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white resize-none focus:outline-none focus:border-[#a371f7] placeholder-[#6e7681]" />
            </div>
            {error && <p className="text-xs text-[#f85149]">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => handleApproval("approved")} disabled={approving || !approvalRationale.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#3fb950]/10 hover:bg-[#3fb950]/20 border border-[#3fb950]/30 text-[#3fb950] text-xs font-bold py-2 rounded disabled:opacity-50 transition-colors">
                {approving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve Inject
              </button>
              <button onClick={() => handleApproval("rejected")} disabled={approving || !approvalRationale.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#f85149]/10 hover:bg-[#f85149]/20 border border-[#f85149]/30 text-[#f85149] text-xs font-bold py-2 rounded disabled:opacity-50 transition-colors">
                <XCircle size={12} /> Reject
              </button>
              <button onClick={() => setApprovalModal(null)}
                className="px-3 bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] text-xs font-bold py-2 rounded transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
