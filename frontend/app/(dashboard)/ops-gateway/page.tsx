"use client";
import { useState } from "react";
import {
  Network, Send, CheckCircle, XCircle, AlertTriangle, Loader2,
  ChevronDown, ChevronRight, Shield, BookOpen, Map, MessageSquare, Flag,
} from "lucide-react";
import { system3Api } from "@/lib/system3";

const S3_API_LABEL = "/api/v1/system3";

type ClassificationMarking = "UNCLASSIFIED" | "CUI" | "FOUO";
type ApprovalDecision = "Approve" | "Reject";
type ScenarioInjectState = "Proposed" | "Approved" | "Rejected" | "Deferred";

interface SourceRef { sourceSystem: string; objectType: string; objectId: string; locator: string; }
interface PolicyCheck { name: string; passed: boolean; detail: string; }
interface StateMetric {
  dimension: string; score: number; confidence: number; rationale: string; sourceRefs: SourceRef[];
}
interface MissionStateEstimate {
  stateEstimateId: string; missionId: string; producedAt: string;
  metrics: StateMetric[]; sourceRefs: SourceRef[]; classificationMarking: ClassificationMarking;
}
interface Observation {
  observationId: string; missionId: string; observationType: string;
  summary: string; confidence: number; sourceRefs: SourceRef[]; classificationMarking: ClassificationMarking;
}
interface EvidenceBundle {
  observationIds: string[]; stateEstimateId: string; sourceRefs: SourceRef[];
  uncertainty: number; policyChecks: PolicyCheck[];
}
interface ScenarioInjectRecommendation {
  recommendationId: string; missionId: string; title: string; scenarioFamily: string;
  recommendationKind: "RecommendedChange" | "SaferFallback" | "HoldCurrentState";
  trainingObjective: string; summary: string; expectedLearningValue: number;
  safetyRisk: number; confidence: number; state: ScenarioInjectState;
  evidenceBundle: EvidenceBundle; sourceRefs: SourceRef[]; classificationMarking: ClassificationMarking;
}
interface EvidenceIngestResponse {
  evidenceId: string; missionId: string; observations: Observation[];
  stateEstimate: MissionStateEstimate; recommendations: ScenarioInjectRecommendation[];
}
interface MissionContext {
  missionId?: string; missionName?: string; objective?: string; phase?: string;
  assignedSoldiers?: { soldierId: string; role?: string; rank?: string }[];
  classificationMarking?: ClassificationMarking;
}
interface COAProposal {
  runId: string; missionId: string; producedAt: string;
  coas?: { coaId: string; title: string; summary: string; roeStatus?: string; confidence?: number }[];
  rehearsalScenarios?: { title: string; summary: string }[];
  sourceRefs?: SourceRef[];
}
interface LessonLearned {
  lessonId: string; missionId: string; category?: string; severity?: string;
  observation?: string; recommendation?: string; classificationMarking?: ClassificationMarking;
}

type Tab = "mission" | "evidence" | "coa" | "lessons";

const METRIC_LABELS: Record<string, string> = {
  FatigueLoad: "Fatigue Load", CommunicationDegradation: "Comm Degradation",
  SituationalConfusion: "Situational Confusion", LeadershipStress: "Leadership Stress",
  TempoLoss: "Tempo Loss", SafetyMarginRisk: "Safety Margin Risk",
};
const KIND_COLOR: Record<string, string> = {
  RecommendedChange: "bg-[#3fb950]/10 text-[#3fb950] border-[#3fb950]/30",
  SaferFallback: "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30",
  HoldCurrentState: "bg-[#8b949e]/10 text-[#8b949e] border-[#8b949e]/30",
};
const SOURCE_TYPES = ["VoiceNote","SITREP","AARNote","Checklist","Telemetry","Weather","InstructorObservation"] as const;

function ScoreBar({ value, color = "#58a6ff" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 bg-[#30363d] rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.min(value * 100, 100)}%`, backgroundColor: color }} />
    </div>
  );
}

function ClassBadge({ marking }: { marking?: ClassificationMarking }) {
  if (!marking) return null;
  const c = marking === "UNCLASSIFIED" ? "text-[#3fb950]" : marking === "CUI" ? "text-[#f59e0b]" : "text-[#f85149]";
  return <span className={`text-[9px] font-bold uppercase ${c}`}>{marking}</span>;
}

export default function OpsGatewayPage() {
  const [missionId, setMissionId]   = useState("mission-compound-iron");
  const [activeTab, setActiveTab]   = useState<Tab>("mission");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [missionContext, setMissionContext]   = useState<MissionContext | null>(null);
  const [missionState, setMissionState]       = useState<MissionStateEstimate | null>(null);
  const [noState, setNoState]                 = useState(false);

  const [reportedBy, setReportedBy]   = useState("instructor.viper");
  const [sourceType, setSourceType]   = useState<typeof SOURCE_TYPES[number]>("InstructorObservation");
  const [evidenceText, setEvidenceText] = useState("");
  const [classification, setClassification] = useState<ClassificationMarking>("UNCLASSIFIED");
  const [ingestResponse, setIngestResponse] = useState<EvidenceIngestResponse | null>(null);
  const [approvalState, setApprovalState]   = useState<Record<string, ScenarioInjectState>>({});
  const [approvingId, setApprovingId]       = useState<string | null>(null);
  const [justification, setJustification]   = useState("");
  const [approvalModal, setApprovalModal]   = useState<ScenarioInjectRecommendation | null>(null);

  const [coaProposal, setCoaProposal]   = useState<COAProposal | null>(null);
  const [coaApproving, setCoaApproving] = useState<string | null>(null);
  const [coaDecisions, setCoaDecisions] = useState<Record<string, ApprovalDecision>>({});
  const [coaJust, setCoaJust]           = useState("");
  const [coaModal, setCoaModal]         = useState<string | null>(null);

  const [aarNote, setAarNote]           = useState("");
  const [lesson, setLesson]             = useState<LessonLearned | null>(null);
  const [captureId, setCaptureId]       = useState("");

  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

  async function loadMission() {
    setLoading(true); setError(null); setNoState(false);
    setMissionContext(null); setMissionState(null);
    try {
      const ctx = await system3Api.getMissionContext<MissionContext>(missionId);
      setMissionContext(ctx);
      try {
        const st = await system3Api.getMissionState<MissionStateEstimate>(missionId);
        setMissionState(st);
      } catch {
        setNoState(true);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load mission");
    } finally {
      setLoading(false);
    }
  }

  async function handleIngest() {
    if (!evidenceText.trim()) { setError("Evidence text is required."); return; }
    setLoading(true); setError(null);
    try {
      const res = await system3Api.ingestEvidence<EvidenceIngestResponse>({
        missionId,
        reportedBy,
        sourceType,
        evidenceText,
        classificationMarking: classification,
        sourceRefs: [],
      });
      setIngestResponse(res);
      setMissionState(res.stateEstimate);
      setNoState(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleInjectApproval(rec: ScenarioInjectRecommendation, decision: ApprovalDecision) {
    if (!justification.trim()) { setError("Justification is required."); return; }
    setApprovingId(rec.recommendationId);
    try {
      await system3Api.approveScenarioInject(rec.recommendationId, {
        recommendationId: rec.recommendationId,
        reviewedBy: reportedBy,
        decision,
        justification,
      });
      setApprovalState(prev => ({ ...prev, [rec.recommendationId]: decision === "Approve" ? "Approved" : "Rejected" }));
      if (decision === "Approve") setCaptureId(rec.recommendationId);
      setApprovalModal(null); setJustification("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setApprovingId(null);
    }
  }

  async function handleProposeCOA() {
    setLoading(true); setError(null);
    try {
      const res = await system3Api.proposeCoas<COAProposal>({
        missionId,
        requestedBy: reportedBy,
        includeRehearsalScenarios: true,
        sourceRefs: [],
      });
      setCoaProposal(res); setCoaDecisions({});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "COA proposal failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleCOAApproval(coaId: string, decision: ApprovalDecision) {
    if (!coaJust.trim()) { setError("Justification required."); return; }
    if (!coaProposal) return;
    setCoaApproving(coaId);
    try {
      await system3Api.approveCoa(coaProposal.runId, { coaId, reviewedBy: reportedBy, decision, justification: coaJust });
      setCoaDecisions(prev => ({ ...prev, [coaId]: decision }));
      setCoaModal(null); setCoaJust("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "COA approval failed");
    } finally {
      setCoaApproving(null);
    }
  }

  async function handleLessonCapture() {
    if (!aarNote.trim()) { setError("AAR note is required."); return; }
    if (!captureId) { setError("Approve a scenario inject first to capture a lesson."); return; }
    setLoading(true); setError(null);
    try {
      const res = await system3Api.captureLesson<{ lesson: LessonLearned }>({
        missionId,
        approvedInjectId: captureId,
        recordedBy: reportedBy,
        aarNote,
        classificationMarking: classification,
      });
      setLesson(res.lesson);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Lesson capture failed");
    } finally {
      setLoading(false);
    }
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "mission", label: "Mission", icon: Map },
    { id: "evidence", label: "Evidence", icon: MessageSquare },
    { id: "coa", label: "COA", icon: BookOpen },
    { id: "lessons", label: "Lessons", icon: Flag },
  ];

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Network size={24} className="text-[#f59e0b]" />
          <div>
            <h1 className="text-xl font-bold text-white">Ops Gateway</h1>
            <p className="text-xs text-[#8b949e]">Operations Console — System 3 · {S3_API_LABEL}</p>
          </div>
        </div>

        {/* Config bar */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 mb-6 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-36">
            <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Mission ID</label>
            <input value={missionId} onChange={e => setMissionId(e.target.value)}
              className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]" />
          </div>
          <div className="flex-1 min-w-48">
            <div className="text-[10px] text-[#8b949e] uppercase tracking-wider">Auth Path</div>
            <div className="mt-1 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-xs text-[#8b949e]">
              API key injected server-side
            </div>
          </div>
          <button onClick={loadMission} disabled={loading}
            className="bg-[#f59e0b] hover:bg-[#f59e0b]/80 disabled:opacity-50 text-[#0d1117] font-bold text-xs px-4 py-1.5 rounded transition-colors flex items-center gap-2">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Network size={12} />} Load Mission
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[#f85149]/10 border border-[#f85149]/30 rounded-lg text-sm text-[#f85149] flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
            <button onClick={() => setError(null)} className="ml-auto text-[#f85149] hover:text-white"><XCircle size={14} /></button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-[#161b22] border border-[#30363d] rounded-lg p-1 w-fit">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                activeTab === id ? "bg-[#f59e0b] text-[#0d1117]" : "text-[#8b949e] hover:text-white"
              }`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {/* Mission Tab */}
        {activeTab === "mission" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Map size={14} className="text-[#f59e0b]" /> Mission Context
              </h2>
              {!missionContext ? (
                <p className="text-xs text-[#8b949e]">Load a mission to see context.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {missionContext.missionName && <div className="flex gap-2"><span className="text-[#8b949e]">Name:</span><span className="text-white">{missionContext.missionName}</span></div>}
                  {missionContext.objective && <div className="flex gap-2"><span className="text-[#8b949e] shrink-0">Objective:</span><span className="text-white">{missionContext.objective}</span></div>}
                  {missionContext.phase && <div className="flex gap-2"><span className="text-[#8b949e]">Phase:</span><span className="text-white">{missionContext.phase}</span></div>}
                  {missionContext.classificationMarking && <ClassBadge marking={missionContext.classificationMarking} />}
                  {(missionContext.assignedSoldiers?.length ?? 0) > 0 && (
                    <div className="pt-2 border-t border-[#21262d]">
                      <div className="text-[#8b949e] mb-1">Assigned Soldiers</div>
                      {missionContext.assignedSoldiers!.map(s => (
                        <div key={s.soldierId} className="flex gap-2 py-0.5">
                          <span className="text-[#58a6ff]">{s.soldierId}</span>
                          {s.rank && <span className="text-[#8b949e]">{s.rank}</span>}
                          {s.role && <span className="text-[#f59e0b]">{s.role}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {Object.keys(missionContext).length === 0 && <p className="text-[#8b949e]">No context data returned.</p>}
                </div>
              )}
            </div>

            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Shield size={14} className="text-[#f59e0b]" /> Mission State
              </h2>
              {noState && <p className="text-xs text-[#8b949e]">No state yet — ingest evidence first.</p>}
              {!missionState && !noState && <p className="text-xs text-[#8b949e]">Load a mission to see state estimates.</p>}
              {missionState && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[10px] text-[#8b949e]">
                    <ClassBadge marking={missionState.classificationMarking} />
                    <span>{new Date(missionState.producedAt).toLocaleTimeString()}</span>
                  </div>
                  {missionState.metrics.map(m => {
                    const open = expandedMetric === m.dimension;
                    return (
                      <div key={m.dimension} className="space-y-1">
                        <button onClick={() => setExpandedMetric(open ? null : m.dimension)}
                          className="w-full flex items-center gap-2 text-xs hover:text-white transition-colors">
                          <span className="flex-1 text-left text-[#c9d1d9]">{METRIC_LABELS[m.dimension] ?? m.dimension}</span>
                          <span className="text-[#8b949e] w-8 text-right">{(m.score * 100).toFixed(0)}%</span>
                          {open ? <ChevronDown size={10} className="text-[#8b949e]" /> : <ChevronRight size={10} className="text-[#8b949e]" />}
                        </button>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                          <div>
                            <div className="text-[9px] text-[#6e7681] mb-0.5">Risk/Burden</div>
                            <ScoreBar value={m.score} color={m.score > 0.6 ? "#f85149" : m.score > 0.3 ? "#f59e0b" : "#3fb950"} />
                          </div>
                          <div>
                            <div className="text-[9px] text-[#6e7681] mb-0.5">Confidence</div>
                            <ScoreBar value={m.confidence} color="#58a6ff" />
                          </div>
                        </div>
                        {open && <p className="text-[10px] text-[#8b949e] pl-1">{m.rationale}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Evidence Tab */}
        {activeTab === "evidence" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 bg-[#161b22] border border-[#30363d] rounded-lg p-4 space-y-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <MessageSquare size={14} className="text-[#f59e0b]" /> Ingest Field Evidence
              </h2>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Reported By</label>
                <input value={reportedBy} onChange={e => setReportedBy(e.target.value)}
                  className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]" />
              </div>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Source Type</label>
                <select value={sourceType} onChange={e => setSourceType(e.target.value as typeof SOURCE_TYPES[number])}
                  className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]">
                  {SOURCE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Evidence Text</label>
                <textarea value={evidenceText} onChange={e => setEvidenceText(e.target.value)} rows={4}
                  placeholder="Describe the field observation…"
                  className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white resize-none focus:outline-none focus:border-[#f59e0b] placeholder-[#6e7681]" />
              </div>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Classification</label>
                <select value={classification} onChange={e => setClassification(e.target.value as ClassificationMarking)}
                  className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]">
                  <option>UNCLASSIFIED</option><option>CUI</option><option>FOUO</option>
                </select>
              </div>
              <button onClick={handleIngest} disabled={loading}
                className="w-full bg-[#f59e0b] hover:bg-[#f59e0b]/80 disabled:opacity-50 text-[#0d1117] font-bold text-xs py-2 rounded transition-colors flex items-center justify-center gap-2">
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Ingest Evidence
              </button>
            </div>

            <div className="lg:col-span-3 space-y-4">
              {!ingestResponse ? (
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-8 text-center">
                  <MessageSquare size={36} className="text-[#30363d] mx-auto mb-3" />
                  <p className="text-sm text-[#8b949e]">Ingest evidence to see observations and recommendations</p>
                </div>
              ) : (
                <>
                  {/* Observations */}
                  {ingestResponse.observations.length > 0 && (
                    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
                      <h3 className="text-xs font-bold text-white mb-2">Observations ({ingestResponse.observations.length})</h3>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {ingestResponse.observations.map(o => (
                          <div key={o.observationId} className="flex items-start gap-2 text-xs py-1.5 border-b border-[#21262d] last:border-0">
                            <span className="text-[10px] font-bold bg-[#58a6ff]/10 text-[#58a6ff] px-1.5 py-0.5 rounded shrink-0">{o.observationType}</span>
                            <span className="text-[#8b949e] flex-1">{o.summary}</span>
                            <span className="text-[#6e7681] shrink-0">{(o.confidence * 100).toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommendations */}
                  {ingestResponse.recommendations.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-[#f59e0b] uppercase tracking-wider mb-2">Scenario Recommendations</h3>
                      <div className="space-y-3">
                        {ingestResponse.recommendations.map(rec => {
                          const decided = approvalState[rec.recommendationId];
                          return (
                            <div key={rec.recommendationId} className={`bg-[#161b22] border rounded-lg overflow-hidden ${decided === "Approved" ? "border-[#3fb950]/30" : decided === "Rejected" ? "border-[#f85149]/20 opacity-60" : "border-[#30363d]"}`}>
                              <div className="p-4">
                                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${KIND_COLOR[rec.recommendationKind]}`}>
                                    {rec.recommendationKind.replace(/([A-Z])/g, " $1").trim()}
                                  </span>
                                  <span className="text-[10px] bg-[#21262d] text-[#8b949e] px-1.5 py-0.5 rounded">{rec.scenarioFamily}</span>
                                  <ClassBadge marking={rec.classificationMarking} />
                                  {decided && (
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${decided === "Approved" ? "bg-[#3fb950]/10 text-[#3fb950]" : "bg-[#f85149]/10 text-[#f85149]"}`}>
                                      {decided.toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-semibold text-white">{rec.title}</p>
                                <p className="text-xs text-[#8b949e] mt-1">{rec.summary}</p>
                                <p className="text-xs text-[#58a6ff] mt-1">Objective: {rec.trainingObjective}</p>
                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <div>
                                    <div className="text-[9px] text-[#6e7681] mb-0.5">Learning Value</div>
                                    <ScoreBar value={rec.expectedLearningValue} color="#3fb950" />
                                  </div>
                                  <div>
                                    <div className="text-[9px] text-[#6e7681] mb-0.5">Safety Risk</div>
                                    <ScoreBar value={rec.safetyRisk} color="#f85149" />
                                  </div>
                                </div>
                                {rec.evidenceBundle.policyChecks.some(p => !p.passed) && (
                                  <div className="mt-2 space-y-1">
                                    {rec.evidenceBundle.policyChecks.filter(p => !p.passed).map((p, i) => (
                                      <div key={i} className="flex items-center gap-1 text-[10px] text-[#f85149]">
                                        <XCircle size={10} /> {p.name}: {p.detail}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {!decided && (
                                <div className="flex gap-2 px-4 py-3 bg-[#0d1117] border-t border-[#21262d]">
                                  <button onClick={() => { setApprovalModal(rec); setJustification(""); }}
                                    disabled={!!approvingId || rec.evidenceBundle.policyChecks.some(p => !p.passed)}
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-[#3fb950]/10 hover:bg-[#3fb950]/20 border border-[#3fb950]/30 text-[#3fb950] text-xs font-bold py-1.5 rounded disabled:opacity-40 transition-colors">
                                    <CheckCircle size={12} /> Approve
                                  </button>
                                  <button onClick={() => { setApprovalModal(rec); setJustification(""); }}
                                    disabled={!!approvingId}
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-[#f85149]/10 hover:bg-[#f85149]/20 border border-[#f85149]/30 text-[#f85149] text-xs font-bold py-1.5 rounded disabled:opacity-40 transition-colors">
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
                </>
              )}
            </div>
          </div>
        )}

        {/* COA Tab */}
        {activeTab === "coa" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={handleProposeCOA} disabled={loading}
                className="bg-[#f59e0b] hover:bg-[#f59e0b]/80 disabled:opacity-50 text-[#0d1117] font-bold text-xs px-4 py-2 rounded transition-colors flex items-center gap-2">
                {loading ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />} Propose COA
              </button>
              {coaProposal && <span className="text-xs text-[#8b949e]">Run: <span className="font-mono text-[#f59e0b]">{coaProposal.runId.slice(0,20)}…</span></span>}
            </div>

            {!coaProposal ? (
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-8 text-center">
                <BookOpen size={36} className="text-[#30363d] mx-auto mb-3" />
                <p className="text-sm text-[#8b949e]">Generate a COA proposal for this mission</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {coaProposal.coas?.map(coa => {
                  const decided = coaDecisions[coa.coaId];
                  const roeBlocked = coa.roeStatus === "Violation";
                  return (
                    <div key={coa.coaId} className={`bg-[#161b22] border rounded-lg overflow-hidden ${roeBlocked ? "border-[#f85149]/30" : decided === "Approve" ? "border-[#3fb950]/30" : "border-[#30363d]"}`}>
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-white flex-1">{coa.title}</span>
                          {roeBlocked && <span className="text-[10px] font-bold bg-[#f85149]/10 text-[#f85149] px-1.5 py-0.5 rounded">ROE VIOLATION</span>}
                          {decided && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${decided === "Approve" ? "bg-[#3fb950]/10 text-[#3fb950]" : "bg-[#f85149]/10 text-[#f85149]"}`}>{decided.toUpperCase()}D</span>}
                        </div>
                        <p className="text-xs text-[#8b949e]">{coa.summary}</p>
                        {coa.confidence != null && (
                          <div className="mt-2">
                            <div className="text-[9px] text-[#6e7681] mb-0.5">Confidence</div>
                            <ScoreBar value={coa.confidence} color="#f59e0b" />
                          </div>
                        )}
                      </div>
                      {!decided && !roeBlocked && (
                        <div className="flex gap-2 px-4 py-3 bg-[#0d1117] border-t border-[#21262d]">
                          <button onClick={() => { setCoaModal(coa.coaId); setCoaJust(""); }}
                            className="flex-1 flex items-center justify-center gap-1.5 bg-[#3fb950]/10 hover:bg-[#3fb950]/20 border border-[#3fb950]/30 text-[#3fb950] text-xs font-bold py-1.5 rounded transition-colors">
                            <CheckCircle size={12} /> Approve
                          </button>
                          <button onClick={() => { setCoaModal(coa.coaId); setCoaJust(""); }}
                            className="flex-1 flex items-center justify-center gap-1.5 bg-[#f85149]/10 hover:bg-[#f85149]/20 border border-[#f85149]/30 text-[#f85149] text-xs font-bold py-1.5 rounded transition-colors">
                            <XCircle size={12} /> Reject
                          </button>
                        </div>
                      )}
                      {roeBlocked && (
                        <div className="px-4 py-2 bg-[#f85149]/5 border-t border-[#f85149]/20 text-[10px] text-[#f85149]">
                          Cannot approve — ROE violation detected.
                        </div>
                      )}
                    </div>
                  );
                })}
                {coaProposal.rehearsalScenarios?.length ? (
                  <div className="lg:col-span-2 bg-[#161b22] border border-[#30363d] rounded-lg p-4">
                    <h3 className="text-xs font-bold text-white mb-2">Rehearsal Scenarios</h3>
                    <div className="space-y-2">
                      {coaProposal.rehearsalScenarios.map((s, i) => (
                        <div key={i} className="text-xs">
                          <span className="text-[#f59e0b] font-semibold">{s.title}</span>
                          <span className="text-[#8b949e] ml-2">{s.summary}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* Lessons Tab */}
        {activeTab === "lessons" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 space-y-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Flag size={14} className="text-[#f59e0b]" /> Capture Lesson Learned
              </h2>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Approved Inject ID</label>
                <input value={captureId} onChange={e => setCaptureId(e.target.value)}
                  placeholder="Auto-filled after inject approval"
                  className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b] placeholder-[#6e7681]" />
              </div>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Recorded By</label>
                <input value={reportedBy} onChange={e => setReportedBy(e.target.value)}
                  className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]" />
              </div>
              <div>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">AAR Note</label>
                <textarea value={aarNote} onChange={e => setAarNote(e.target.value)} rows={4}
                  placeholder="Describe what happened and what was learned…"
                  className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white resize-none focus:outline-none focus:border-[#f59e0b] placeholder-[#6e7681]" />
              </div>
              <button onClick={handleLessonCapture} disabled={loading}
                className="w-full bg-[#f59e0b] hover:bg-[#f59e0b]/80 disabled:opacity-50 text-[#0d1117] font-bold text-xs py-2 rounded transition-colors flex items-center justify-center gap-2">
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Flag size={12} />} Capture Lesson
              </button>
            </div>

            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <h2 className="text-sm font-bold text-white mb-3">Captured Lesson</h2>
              {!lesson ? (
                <p className="text-xs text-[#8b949e]">No lesson captured yet. Approve an inject and submit an AAR note.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  <div className="flex gap-2"><span className="text-[#8b949e]">ID:</span><span className="font-mono text-[#f59e0b]">{lesson.lessonId}</span></div>
                  {lesson.category && <div className="flex gap-2"><span className="text-[#8b949e]">Category:</span><span className="text-white">{lesson.category}</span></div>}
                  {lesson.severity && <div className="flex gap-2"><span className="text-[#8b949e]">Severity:</span><span className={lesson.severity === "High" ? "text-[#f85149]" : lesson.severity === "Medium" ? "text-[#f59e0b]" : "text-[#3fb950]"}>{lesson.severity}</span></div>}
                  {lesson.observation && (
                    <div className="pt-2 border-t border-[#21262d]">
                      <div className="text-[#8b949e] mb-1">Observation</div>
                      <p className="text-[#c9d1d9]">{lesson.observation}</p>
                    </div>
                  )}
                  {lesson.recommendation && (
                    <div className="pt-2 border-t border-[#21262d]">
                      <div className="text-[#8b949e] mb-1">Recommendation</div>
                      <p className="text-[#c9d1d9]">{lesson.recommendation}</p>
                    </div>
                  )}
                  {lesson.classificationMarking && (
                    <div className="pt-2"><ClassBadge marking={lesson.classificationMarking} /></div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Inject Approval Modal */}
      {approvalModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-sm font-bold text-white">Scenario Inject Decision</h3>
            <div className="bg-[#0d1117] rounded p-3">
              <p className="text-xs font-semibold text-white">{approvalModal.title}</p>
              <p className="text-xs text-[#8b949e] mt-1">{approvalModal.summary}</p>
            </div>
            <div>
              <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Justification (required)</label>
              <textarea value={justification} onChange={e => setJustification(e.target.value)} rows={3}
                className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white resize-none focus:outline-none focus:border-[#f59e0b] placeholder-[#6e7681]"
                placeholder="Explain your decision…" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleInjectApproval(approvalModal, "Approve")} disabled={!!approvingId || !justification.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#3fb950]/10 hover:bg-[#3fb950]/20 border border-[#3fb950]/30 text-[#3fb950] text-xs font-bold py-2 rounded disabled:opacity-50">
                {approvingId ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve
              </button>
              <button onClick={() => handleInjectApproval(approvalModal, "Reject")} disabled={!!approvingId || !justification.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#f85149]/10 hover:bg-[#f85149]/20 border border-[#f85149]/30 text-[#f85149] text-xs font-bold py-2 rounded disabled:opacity-50">
                <XCircle size={12} /> Reject
              </button>
              <button onClick={() => setApprovalModal(null)} className="px-3 bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] text-xs font-bold py-2 rounded">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COA Approval Modal */}
      {coaModal && coaProposal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-sm font-bold text-white">COA Decision</h3>
            <div>
              <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Justification (required)</label>
              <textarea value={coaJust} onChange={e => setCoaJust(e.target.value)} rows={3}
                className="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-xs text-white resize-none focus:outline-none focus:border-[#f59e0b] placeholder-[#6e7681]"
                placeholder="Explain your COA decision…" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleCOAApproval(coaModal, "Approve")} disabled={!!coaApproving || !coaJust.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#3fb950]/10 hover:bg-[#3fb950]/20 border border-[#3fb950]/30 text-[#3fb950] text-xs font-bold py-2 rounded disabled:opacity-50">
                {coaApproving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve
              </button>
              <button onClick={() => handleCOAApproval(coaModal, "Reject")} disabled={!!coaApproving || !coaJust.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#f85149]/10 hover:bg-[#f85149]/20 border border-[#f85149]/30 text-[#f85149] text-xs font-bold py-2 rounded disabled:opacity-50">
                <XCircle size={12} /> Reject
              </button>
              <button onClick={() => setCoaModal(null)} className="px-3 bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] text-xs font-bold py-2 rounded">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
