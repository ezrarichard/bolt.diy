/**
 * Requirements Session — domain types. Sprint 50 (Durable Foundation).
 *
 * The container entity beneath the Business Analyst's future discovery modes (Form,
 * Interview, Document — see the frozen Requirements Session Architecture and Business
 * Analyst Technical Implementation Plan). This sprint introduces the durable shapes and
 * storage only: no Fact Extraction, Business Assessment, Discovery Strategy, Recommendation/
 * Assumption engines, or Completeness scoring runs yet. Those are later-sprint concerns that
 * populate these same shapes — the fields below intentionally mirror the frozen
 * architecture's own vocabulary so nothing needs renaming when that logic lands.
 *
 * `RequirementsDraft` (see prompts/requirements.ts) is unaffected: it remains the sole
 * terminal artifact handed to Requirements Approval, unchanged by anything in this file.
 */

export type RequirementsSessionMode = 'form' | 'interview' | 'document';

export type RequirementsSessionStatus = 'created' | 'active' | 'complete' | 'approved' | 'archived' | 'abandoned';

export interface RequirementsSession {
  id: string;
  projectId: string;
  mode: RequirementsSessionMode;
  status: RequirementsSessionStatus;

  /** Reserved for the Discovery Strategy Engine (later sprint) — e.g. 'minimal' | 'standard' | 'deep' | 'enterprise'. Deliberately unconstrained until that logic exists. */
  selectedDiscoveryStrategy?: string;

  /** Reserved for the Business Assessment Engine (later sprint) — a qualitative confidence label, not a score. */
  assessmentConfidence?: string;

  startedAt?: string;
  completedAt?: string;
  approvedAt?: string;
  abandonedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type RequirementsSessionMessageRole = 'user' | 'assistant' | 'system';

export type RequirementsSessionMessageType =
  | 'text'
  | 'form_submission'
  | 'document_input'
  | 'recommendation'
  | 'clarification'
  | 'confirmation';

export interface RequirementsSessionMessage {
  id: string;
  sessionId: string;
  role: RequirementsSessionMessageRole;
  messageType: RequirementsSessionMessageType;
  content: string;

  /** Deterministic ordering within the session — independent of `createdAt` clock resolution. */
  sequenceNumber: number;

  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** How confident the Business Analyst is in a given fact — reused verbatim from the frozen Business Analyst Intelligence Architecture's tiering (Working Memory / Business Understanding Model, Part 2/3). */
export type FactConfidence = 'inferred' | 'stated' | 'confirmed';

/**
 * Sprint 52 — Requirements Traceability & Provenance.
 *
 * A lightweight reference, never a copy of the referenced content — the whole point of
 * provenance is to answer "where did this come from?" without duplicating payloads that
 * already live in `builders_requirements_session_messages`/`builders_business_understanding_models`.
 * `id` on each entity is whatever that entity is already keyed by: a session message's row
 * id, or a `BusinessUnderstandingModel` section name (e.g. 'targetUsers', 'businessGoals').
 */
/**
 * Sprint 57 — Discovery AI Engine. Extended (additively, no migration — this is a plain
 * string-backed union, never a DB CHECK constraint, per Sprint 52's own design note) with the
 * source kinds a future Discovery Input Adapter produces, per the Sprint 55 architecture doc
 * §15/Builders Discovery Experience master spec §6: a document paragraph, a crawled website
 * section, and a transcribed voice/meeting turn are all just different evidence sources
 * pointing at the same `business_understanding_section` targets `session_message` already
 * does for conversational sources (Interview, and — once built — Voice/Meeting, which reuse
 * the Chat Adapter's turn-by-turn shape and so also produce `session_message` evidence; only
 * genuinely non-conversational adapters need their own source kind here).
 */
export type ProvenanceEntityType =
  | 'session_message'
  | 'business_understanding_section'
  | 'requirements_draft_section'
  | 'document_paragraph'
  | 'website_section';

export interface ProvenanceEntityRef {
  type: ProvenanceEntityType;
  id: string;
}

/** One traceable transformation: Source Entity → Target Entity → Transformation → Timestamp → Version (the frozen architecture's provenance principle, Part 8). */
export interface TraceabilityReference {
  source: ProvenanceEntityRef;
  target: ProvenanceEntityRef;

  /**
   * What kind of transformation produced the target from the source, e.g. 'form_field_mapping'
   * or (Sprint 53) a Business Assessment rule identifier such as 'industry-keyword:church'. Free
   * text, not an enum — a new transformation/rule must never require a schema/type change.
   */
  transformation: string;

  recordedAt: string;

  /** The target entity's version, when the target is itself versioned (e.g. a RequirementsDraft artifact version). Absent for current-state targets (e.g. a Business Understanding Model section, which isn't versioned). */
  version?: number;

  /** Sprint 53 — how confident the transformation is in its result, e.g. a Business Assessment rule that matched on a specific, unambiguous keyword vs. a generic fallback. Absent for transformations that aren't inherently uncertain (e.g. a lossless form-field copy). */
  confidence?: 'low' | 'medium' | 'high';
}

export interface Recommendation {
  id: string;
  field: string;
  value: string;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  industryStandard: boolean;
  mandatory: boolean;
  customerImpact: string;
  traceability?: TraceabilityReference;
}

export interface Assumption {
  id: string;
  field: string;
  value: string;
  reason: string;
  traceability?: TraceabilityReference;
}

export interface Risk {
  id: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  mitigation?: string;
  traceability?: TraceabilityReference;
}

export interface OpenQuestion {
  id: string;
  field: string;
  question: string;
  reason: string;
  answeredAt?: string;
  answer?: string;
}

/**
 * Business Assessment section — Sprint 53. "What kind of business is this?", deterministically
 * derived from the rest of the Business Understanding Model — never AI, never invented.
 * Per-field confidence deliberately lives in the model's `traceability` array (one
 * `TraceabilityReference` per assessed field, each with its own `confidence` and rule-id
 * `transformation`), not duplicated here — this object holds only the resulting values.
 * `industry` is a plain mirror of `businessIdentity.industry` (never independently
 * re-derived), kept here purely for a reader's convenience so the whole assessment picture is
 * in one place.
 */
export interface BusinessAssessmentState {
  classification?: string;
  maturity?: string;
  projectType?: string;
  industry?: string;
  notes?: string;
}

/** Per-category completion percentage plus an overall readiness signal — mirrors the frozen Requirements Completeness Engine's scoring shape. Computed/cached, never authoritative on its own (recomputed from the model's other sections when in doubt). */
export interface BusinessUnderstandingCompleteness {
  categories: Record<string, number>;
  overallReady: boolean;
}

/**
 * Discovery Decision Engine — Sprint 54. Whether enough business knowledge exists to continue
 * the software engineering pipeline. Purely a decision, never a question or a recommendation
 * (see `discoveryDecisionEngine.ts`'s header comment for the full scope boundary).
 */
export type DiscoveryState = 'READY' | 'NEEDS_MORE_INFORMATION' | 'INSUFFICIENT_INFORMATION';

/** The ten assessment dimensions the Sprint 54 brief requires every decision to evaluate. */
export type DiscoveryDimension =
  | 'businessVision'
  | 'targetUsers'
  | 'coreFeatures'
  | 'industry'
  | 'businessAssessment'
  | 'projectType'
  | 'businessConstraints'
  | 'currentSystems'
  | 'integrations'
  | 'technicalPreferences';

/**
 * Result of the Discovery Decision Engine — one per Business Understanding Model, recomputed
 * (never incrementally patched) on every form submission. Fields are optional, mirroring
 * `BusinessAssessmentState`'s convention, so a legacy model with no decision computed yet
 * (`decision: {}`) remains a valid value of this type — no backward-compatibility shim needed.
 */
export interface DiscoveryDecision {
  state?: DiscoveryState;
  overallConfidence?: 'low' | 'medium' | 'high';

  /** 0-100, weighted across the ten dimensions above — see `discoveryDecisionEngine.ts` for the documented weights. */
  completenessScore?: number;

  missingAreas?: DiscoveryDimension[];
  partialAreas?: DiscoveryDimension[];
  readyForRequirementsDraft?: boolean;
}

/**
 * The Business Understanding Model — one per Requirements Session, current-state (not
 * versioned). See the frozen Requirements Session Architecture Part 3 / Business Analyst
 * Intelligence Architecture Part 2 for what each section means and why it exists.
 *
 * Every list-shaped section is intentionally untyped-content-agnostic beyond its own record
 * shape in this sprint (e.g. `businessGoals: string[]`) — the richer per-item provenance
 * tagging (Customer Requirement / AI Recommendation / Assumption / Optional Enhancement)
 * described in the Business Analyst Intelligence Architecture is a later sprint's concern
 * (Fact Extraction + Requirements Generation), not something Sprint 50's storage foundation
 * needs to model precisely yet — this shape is deliberately permissive so it doesn't need a
 * migration when that logic lands.
 */
export interface BusinessUnderstandingModel {
  id: string;
  sessionId: string;
  schemaVersion: number;

  assessment: BusinessAssessmentState;
  decision: DiscoveryDecision;
  businessIdentity: Record<string, unknown>;
  businessGoals: string[];
  processes: string[];
  targetUsers: string[];
  painPoints: string[];
  businessConstraints: string[];
  currentSystems: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  recommendations: Recommendation[];
  assumptions: Assumption[];
  risks: Risk[];
  openQuestions: OpenQuestion[];
  traceability: TraceabilityReference[];
  completeness: BusinessUnderstandingCompleteness;

  createdAt: string;
  updatedAt: string;
}
