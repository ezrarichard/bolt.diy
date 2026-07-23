import type {
  Assumption,
  BusinessAssessmentState,
  BusinessUnderstandingCompleteness,
  BusinessUnderstandingModel,
  DiscoveryDecision,
  OpenQuestion,
  Recommendation,
  RequirementsSession,
  RequirementsSessionMessage,
  RequirementsSessionMessageRole,
  RequirementsSessionMessageType,
  RequirementsSessionMode,
  RequirementsSessionStatus,
  Risk,
  TraceabilityReference,
} from '~/lib/projects/requirementsSession';

/**
 * BuildersDB row/frontend shape mapping for the Requirements Discovery Foundation —
 * Sprint 50. Mirrors the convention `buildersDbTypes.ts` already established (see its own
 * header comment): each `*Row` interface below is the literal shape of a row in the table
 * named in its comment (see
 * supabase/migrations/20260727100000_requirements_discovery_foundation.sql for the DDL), and
 * the `to*Row`/`from*Row` functions are the only place a frontend shape is translated to/from
 * its table row.
 *
 * Kept in a separate file from `buildersDbTypes.ts` rather than appended to it — Sprint 50 is
 * new, self-contained surface area, and keeping it separate means the existing, already-large
 * file's diff stays untouched (lower review risk, zero chance of an unrelated merge conflict
 * with concurrent work on the existing tables).
 */

// ── builders_requirements_sessions ─────────────────────────────────────────

export interface BuildersDbRequirementsSessionRow {
  id: string;
  project_id: string;
  mode: string;
  status: string;
  selected_discovery_strategy: string | null;
  assessment_confidence: string | null;
  started_at: string | null;
  completed_at: string | null;
  approved_at: string | null;
  abandoned_at: string | null;
  created_at: string;
  updated_at: string;
}

export function fromRequirementsSessionRow(row: BuildersDbRequirementsSessionRow): RequirementsSession {
  return {
    id: row.id,
    projectId: row.project_id,
    mode: row.mode as RequirementsSessionMode,
    status: row.status as RequirementsSessionStatus,
    selectedDiscoveryStrategy: row.selected_discovery_strategy ?? undefined,
    assessmentConfidence: row.assessment_confidence ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    abandonedAt: row.abandoned_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Insert payload for a brand-new session — `id`/timestamps are left to column defaults. */
export function toRequirementsSessionInsert(
  projectId: string,
  mode: RequirementsSessionMode,
): Omit<BuildersDbRequirementsSessionRow, 'id' | 'created_at' | 'updated_at'> {
  return {
    project_id: projectId,
    mode,
    status: 'created',
    selected_discovery_strategy: null,
    assessment_confidence: null,
    started_at: null,
    completed_at: null,
    approved_at: null,
    abandoned_at: null,
  };
}

// ── builders_requirements_session_messages ─────────────────────────────────

export interface BuildersDbRequirementsSessionMessageRow {
  id: string;
  session_id: string;
  project_id: string;
  role: string;
  message_type: string;
  content: string;
  sequence_number: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function fromRequirementsSessionMessageRow(
  row: BuildersDbRequirementsSessionMessageRow,
): RequirementsSessionMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as RequirementsSessionMessageRole,
    messageType: row.message_type as RequirementsSessionMessageType,
    content: row.content,
    sequenceNumber: row.sequence_number,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export function toRequirementsSessionMessageInsert(
  sessionId: string,
  projectId: string,
  message: Pick<RequirementsSessionMessage, 'role' | 'messageType' | 'content' | 'metadata'>,
  sequenceNumber: number,
): Omit<BuildersDbRequirementsSessionMessageRow, 'id' | 'created_at'> {
  return {
    session_id: sessionId,
    project_id: projectId,
    role: message.role,
    message_type: message.messageType,
    content: message.content,
    sequence_number: sequenceNumber,
    metadata: message.metadata ?? {},
  };
}

// ── builders_business_understanding_models ─────────────────────────────────

export interface BuildersDbBusinessUnderstandingModelRow {
  id: string;
  session_id: string;
  project_id: string;
  schema_version: number;
  assessment: BusinessAssessmentState;
  decision: DiscoveryDecision;
  business_identity: Record<string, unknown>;
  business_goals: string[];
  processes: string[];
  target_users: string[];
  pain_points: string[];
  business_constraints: string[];
  current_systems: string[];
  functional_requirements: string[];
  non_functional_requirements: string[];
  recommendations: Recommendation[];
  assumptions: Assumption[];
  risks: Risk[];
  open_questions: OpenQuestion[];
  traceability: TraceabilityReference[];
  completeness: BusinessUnderstandingCompleteness;
  created_at: string;
  updated_at: string;
}

export function fromBusinessUnderstandingModelRow(
  row: BuildersDbBusinessUnderstandingModelRow,
): BusinessUnderstandingModel {
  return {
    id: row.id,
    sessionId: row.session_id,
    schemaVersion: row.schema_version,
    assessment: row.assessment ?? {},
    decision: row.decision ?? {},
    businessIdentity: row.business_identity ?? {},
    businessGoals: row.business_goals ?? [],
    processes: row.processes ?? [],
    targetUsers: row.target_users ?? [],
    painPoints: row.pain_points ?? [],
    businessConstraints: row.business_constraints ?? [],
    currentSystems: row.current_systems ?? [],
    functionalRequirements: row.functional_requirements ?? [],
    nonFunctionalRequirements: row.non_functional_requirements ?? [],
    recommendations: row.recommendations ?? [],
    assumptions: row.assumptions ?? [],
    risks: row.risks ?? [],
    openQuestions: row.open_questions ?? [],
    traceability: row.traceability ?? [],
    completeness: row.completeness ?? { categories: {}, overallReady: false },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Insert payload for a freshly-initialized model — always the empty shape; sections are populated by later sprints' Fact Extraction/Assessment engines via `updateBusinessUnderstandingModel`. */
export function toBusinessUnderstandingModelInsert(
  sessionId: string,
  projectId: string,
): Omit<BuildersDbBusinessUnderstandingModelRow, 'id' | 'created_at' | 'updated_at'> {
  return {
    session_id: sessionId,
    project_id: projectId,
    schema_version: 1,
    assessment: {},
    decision: {},
    business_identity: {},
    business_goals: [],
    processes: [],
    target_users: [],
    pain_points: [],
    business_constraints: [],
    current_systems: [],
    functional_requirements: [],
    non_functional_requirements: [],
    recommendations: [],
    assumptions: [],
    risks: [],
    open_questions: [],
    traceability: [],
    completeness: { categories: {}, overallReady: false },
  };
}

/**
 * A partial update payload — only the sections a caller actually passes are included, so
 * `upsertBusinessUnderstandingModel`/`updateBusinessUnderstandingModel` never overwrite an
 * unrelated section back to its default. Mirrors the same "only include provided keys"
 * discipline `upsertProjectTask` already uses in `buildersDbRepository.ts`.
 */
export type BusinessUnderstandingModelPatch = Partial<
  Omit<BusinessUnderstandingModel, 'id' | 'sessionId' | 'createdAt' | 'updatedAt'>
>;

export function toBusinessUnderstandingModelUpdate(
  patch: BusinessUnderstandingModelPatch,
): Partial<Omit<BuildersDbBusinessUnderstandingModelRow, 'id' | 'session_id' | 'project_id' | 'created_at'>> {
  const row: Partial<Omit<BuildersDbBusinessUnderstandingModelRow, 'id' | 'session_id' | 'project_id' | 'created_at'>> =
    {};

  if (patch.schemaVersion !== undefined) {
    row.schema_version = patch.schemaVersion;
  }

  if (patch.assessment !== undefined) {
    row.assessment = patch.assessment;
  }

  if (patch.decision !== undefined) {
    row.decision = patch.decision;
  }

  if (patch.businessIdentity !== undefined) {
    row.business_identity = patch.businessIdentity;
  }

  if (patch.businessGoals !== undefined) {
    row.business_goals = patch.businessGoals;
  }

  if (patch.processes !== undefined) {
    row.processes = patch.processes;
  }

  if (patch.targetUsers !== undefined) {
    row.target_users = patch.targetUsers;
  }

  if (patch.painPoints !== undefined) {
    row.pain_points = patch.painPoints;
  }

  if (patch.businessConstraints !== undefined) {
    row.business_constraints = patch.businessConstraints;
  }

  if (patch.currentSystems !== undefined) {
    row.current_systems = patch.currentSystems;
  }

  if (patch.functionalRequirements !== undefined) {
    row.functional_requirements = patch.functionalRequirements;
  }

  if (patch.nonFunctionalRequirements !== undefined) {
    row.non_functional_requirements = patch.nonFunctionalRequirements;
  }

  if (patch.recommendations !== undefined) {
    row.recommendations = patch.recommendations;
  }

  if (patch.assumptions !== undefined) {
    row.assumptions = patch.assumptions;
  }

  if (patch.risks !== undefined) {
    row.risks = patch.risks;
  }

  if (patch.openQuestions !== undefined) {
    row.open_questions = patch.openQuestions;
  }

  if (patch.traceability !== undefined) {
    row.traceability = patch.traceability;
  }

  if (patch.completeness !== undefined) {
    row.completeness = patch.completeness;
  }

  return row;
}
