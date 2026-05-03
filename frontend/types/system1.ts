export type System1RunStatus = "accepted" | "processing" | "pending_approval" | "completed" | "failed";
export type System1RecommendationStatus = "pending" | "approved" | "rejected" | "blocked";
export type System1Rating = "GO" | "NOGO" | "UNCERTAIN";
export type System1Phase = "Benning" | "Mountain" | "Florida";
export type CalibrationOutcome = "improved" | "no_change" | "worsened" | "unsafe_abort" | "unclear";
export type CalibrationCueTag =
  | "communication_timing"
  | "security_posture"
  | "fire_control_timing"
  | "fatigue_stress"
  | "terrain_interaction"
  | "team_coordination"
  | "leadership_delegation"
  | "source_uncertainty";

export interface System1Geo {
  lat: number;
  lon: number;
  grid_mgrs: string;
}

export interface System1IngestEnvelope {
  envelope_id?: string;
  instructor_id: string;
  platoon_id: string;
  mission_id: string;
  mission_type?: string;
  phase: System1Phase;
  timestamp_utc?: string;
  frontend_build?: string;
  roster_version?: string;
  geo: System1Geo;
  free_text?: string | null;
  audio_b64?: string | null;
  image_b64?: string[];
}

export interface System1Observation {
  observation_id: string;
  soldier_id?: string;
  task_code?: string;
  note?: string;
  rating: System1Rating;
  timestamp_utc?: string;
  source?: "audio" | "image" | "free_text" | "synthetic" | string;
  source_confidence?: number;
  evidence_refs?: unknown[];
}

export interface System1PolicyDecision {
  allowed: boolean;
  reasons: string[];
  fairness_score?: number;
}

export interface System1ReviewRequirement {
  id?: string;
  requirement_id?: string;
  label?: string;
  description?: string;
  rationale?: string;
  required_for_approval?: boolean;
}

export interface System1ScoreBreakdown {
  learning_delta?: number;
  doctrinal_fit?: number;
  instructor_utility?: number;
  novelty_bonus?: number;
  safety_risk?: number;
  fatigue_overload?: number;
  fairness_penalty?: number;
  repetition_penalty?: number;
  total?: number;
  [key: string]: number | undefined;
}

export interface System1CalibrationSupport {
  calibration_goal?: string;
  cue_tags_to_watch?: CalibrationCueTag[];
  feedback_prompt?: string;
  prior_signal_count?: number;
  outcome_trend?: "insufficient_data" | "improving" | "mixed" | "negative" | string;
  recommended_feedback_window?: string;
  source_refs?: string[];
}

export interface System1DecisionQuality {
  rating?: string;
  rationale?: string;
  reliance_risk?: string;
  value_of_information?: string | number;
  review_requirements?: System1ReviewRequirement[];
  [key: string]: unknown;
}

export interface System1ScenarioRecommendation {
  recommendation_id: string;
  target_soldier_id?: string;
  target_ids?: string[];
  task_code?: string;
  rationale: string;
  development_edge?: string;
  learning_objective?: string;
  intervention_id?: string;
  proposed_modification?: string;
  doctrine_refs?: string[];
  safety_checks?: string[];
  risk_controls?: string[];
  estimated_duration_min?: number;
  requires_resources?: string[];
  risk_level?: "low" | "medium" | "high" | string;
  fairness_score?: number;
  score_breakdown?: System1ScoreBreakdown;
  evidence_refs?: unknown[];
  model_context_refs?: unknown[];
  policy_refs?: string[];
  calibration_support?: System1CalibrationSupport;
  decision_frame?: unknown;
  decision_quality?: System1DecisionQuality;
  value_of_information?: unknown;
  review_requirements?: System1ReviewRequirement[];
  created_by?: string;
  created_at_utc?: string;
}

export interface System1RecommendationRecord {
  recommendation: System1ScenarioRecommendation;
  policy: System1PolicyDecision;
  status: System1RecommendationStatus;
  decision?: string;
  decision_rationale?: string;
  update_refs?: string[];
}

export interface System1RunRecord {
  run_id: string;
  status: System1RunStatus;
  trace_id?: string;
  ingest?: Partial<System1IngestEnvelope>;
  transcript?: string | null;
  ocr_pages?: unknown[];
  observations?: System1Observation[];
  kg_write_summary?: unknown;
  recommendations?: System1RecommendationRecord[];
  errors?: string[];
  update_refs?: string[];
}

export interface System1SoldierSummary {
  soldier_id: string;
  go_count: number;
  nogo_count: number;
  uncertain_count: number;
  go_rate: number;
  readiness_score?: number;
  observation_count?: number;
  active_recommendation_count?: number;
  blocked_recommendation_count?: number;
  strongest_development_edges?: string[];
  calibration_outcome_trend?: string;
}

export interface System1DashboardRunSummary {
  run_id: string;
  mission_id?: string;
  platoon_id?: string;
  phase?: System1Phase | string;
  status: System1RunStatus;
  total_observations: number;
  pending_recommendations: number;
  blocked_recommendations: number;
  approved_recommendations: number;
  platoon_readiness_score?: number;
  soldiers?: System1SoldierSummary[];
  active_recommendations?: System1RecommendationRecord[];
}

export interface System1MissionStateSummary {
  mission_id: string;
  platoon_id?: string;
  run_count?: number;
  recommendation_counts?: Record<string, number>;
  observed_soldier_ids?: string[];
  latest_run_id?: string;
  total_observations?: number;
  team_calibration_profile?: System1TeamCalibrationProfile;
  source_refs?: string[];
  update_refs?: string[];
  [key: string]: unknown;
}

export interface System1ProfileBucket {
  cue_tag?: string;
  intervention_id?: string;
  development_edge?: string;
  signal_count?: number;
  outcome_counts?: Record<string, number>;
  outcome_trend?: string;
  source_refs?: string[];
  [key: string]: unknown;
}

export interface System1TeamCalibrationProfile {
  mission_id?: string;
  platoon_id?: string;
  run_count?: number;
  soldier_count?: number;
  signal_count?: number;
  outcome_counts?: Record<string, number>;
  outcome_trend?: string;
  cue_profiles?: System1ProfileBucket[];
  development_edge_profiles?: System1ProfileBucket[];
  member_summaries?: System1ProfileBucket[];
  source_refs?: string[];
  update_refs?: string[];
}

export interface System1SoldierCalibrationProfile {
  soldier_id: string;
  signal_count?: number;
  outcome_counts?: Record<string, number>;
  outcome_trend?: string;
  cue_profiles?: System1ProfileBucket[];
  intervention_profiles?: System1ProfileBucket[];
  source_refs?: string[];
  update_refs?: string[];
}

export interface System1TrainingTrajectory {
  soldier_id: string;
  run_count?: number;
  observation_count?: number;
  approved_recommendation_count?: number;
  go_rate?: number;
  readiness_score?: number;
  task_summaries?: System1ProfileBucket[];
  development_edges?: System1ProfileBucket[];
  calibration_profile?: Partial<System1SoldierCalibrationProfile>;
  recent_points?: unknown[];
  source_refs?: string[];
  update_refs?: string[];
}

export interface System1AuditEvent {
  event_id?: string;
  event_type?: string;
  action?: string;
  recommendation_id?: string;
  run_id?: string;
  actor_id?: string;
  trace_id?: string;
  created_at?: string;
  created_at_utc?: string;
  details?: unknown;
  [key: string]: unknown;
}

export interface System1GraphSubgraph {
  nodes?: unknown[];
  edges?: unknown[];
  source_refs?: string[];
  [key: string]: unknown;
}

export interface System1UpdateLedgerEntry {
  entry_id?: string;
  entity_type?: string;
  entity_id?: string;
  run_id?: string;
  trace_id?: string;
  created_at?: string;
  created_at_utc?: string;
  update_refs?: string[];
  [key: string]: unknown;
}

export interface System1OutboxEvent {
  event_id: string;
  event_type?: string;
  status?: string;
  created_at?: string;
  created_at_utc?: string;
  payload?: unknown;
  [key: string]: unknown;
}

export interface System1ApprovalResponse {
  run_id: string;
  recommendation_id: string;
  status: System1RecommendationStatus;
}

export interface System1RecommendationDecision {
  decision: "approve" | "reject";
  decision_rationale?: string;
  acknowledged_review_requirements?: string[];
  edited_recommendation?: System1ScenarioRecommendation;
}

export interface System1CalibrationSignal {
  signal_id?: string;
  recommendation_id: string;
  run_id: string;
  instructor_id: string;
  outcome: CalibrationOutcome;
  cue_tags: CalibrationCueTag[];
  observed_learning_signal: string;
  target_soldier_id?: string;
  task_code?: string;
  development_edge?: string;
  intervention_id?: string;
  confidence?: number;
  notes?: string;
  evidence_refs?: unknown[];
  occurred_at_utc?: string;
}

export interface System1CalibrationReceipt {
  signal_id: string;
  status: "accepted" | "duplicate";
  source_refs?: string[];
}

export interface System1HealthReport {
  ok?: boolean;
  langgraph_importable?: boolean;
  falkordb?: string | boolean;
  dependencies_available?: Record<string, boolean>;
  providers_configured?: Record<string, boolean>;
  openai_models?: Record<string, string>;
  environment_providers?: Record<string, string>;
  infrastructure_configured?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface System1ReadyReport {
  ok?: boolean;
  ready?: boolean;
  critical_dependencies_ready?: boolean;
  [key: string]: unknown;
}

export interface System1ProxyResponse<T> {
  data: T;
  traceId?: string | null;
}
