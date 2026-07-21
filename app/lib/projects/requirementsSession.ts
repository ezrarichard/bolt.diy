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
export type ProvenanceEntityType = 'session_message' | 'business_understanding_section' | 'requirements_draft_section';

export interface ProvenanceEntityRef {
  type: ProvenanceEntityType;
  id: string;
}

/** One traceable transformation: Source Entity → Target Entity → Transformation → Timestamp → Version (the frozen architecture's provenance principle, Part 8). */
export interface TraceabilityReference {
  source: ProvenanceEntityRef;
  target: ProvenanceEntityRef;

  /** What kind of transformation produced the target from the source, e.g. 'form_field_mapping'. Free text, not an enum — a new transformation kind must never require a schema/type change. */
  transformation: string;

  recordedAt: string;

  /** The target entity's version, when the target is itself versioned (e.g. a RequirementsDraft artifact version). Absent for current-state targets (e.g. a Business Understanding Model section, which isn't versioned). */
  version?: number;
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

/** Business Assessment section — populated by a later sprint's Business Assessment Engine. */
export interface BusinessAssessmentState {
  classification?: string;
  classificationConfidence?: 'low' | 'medium' | 'high';
  maturity?: string;
  digitalMaturity?: string;
  complexity?: string;
  discoveryStrategy?: string;
  notes?: string;
}

/** Per-category completion percentage plus an overall readiness signal — mirrors the frozen Requirements Completeness Engine's scoring shape. Computed/cached, never authoritative on its own (recomputed from the model's other sections when in doubt). */
export interface BusinessUnderstandingCompleteness {
  categories: Record<string, number>;
  overallReady: boolean;
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
