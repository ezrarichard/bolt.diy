import type { BusinessUnderstandingModelPatch } from '~/lib/builders-db/requirementsSessionDbTypes';
import type { BusinessAssessmentResult } from '~/lib/projects/businessAssessmentEngine';
import type {
  DiscoveryDecision,
  DiscoveryDimension,
  DiscoveryState,
  ProvenanceEntityRef,
  TraceabilityReference,
} from '~/lib/projects/requirementsSession';

/**
 * Discovery Decision Engine — Sprint 54.
 *
 * "Is there enough business knowledge to continue the software engineering pipeline?" —
 * deterministic, rule-based, running immediately after the Business Assessment Engine (Sprint
 * 53) against the same Business Understanding Model patch. Decision-making only: this module
 * never asks a question, never generates a recommendation, never runs Interview Mode, and never
 * calls an LLM. Every dimension is scored from signals the model already holds (the same 17-field
 * form mapping Sprint 51 built, plus Sprint 53's assessment output) — nothing here invents
 * information the customer never gave.
 *
 * Pure and synchronous, mirroring `businessAssessmentEngine.ts`: no repository calls, no I/O,
 * trivially unit-testable. The caller (`requirementsSessionOrchestrator.ts`) persists the result
 * on `BusinessUnderstandingModel.decision` and merges this module's evidence into the same
 * `traceability` array Sprint 52/53 already write to.
 *
 * ── Completeness scoring ────────────────────────────────────────────────────────────────────
 * Each of the ten dimensions below contributes a weight (summing to 100) to `completenessScore`.
 * A `complete` dimension contributes its full weight; `partial` contributes half; `missing`
 * contributes nothing. Weights live in one place (`DIMENSION_WEIGHTS`) specifically so a later
 * sprint can retune them (or add a dimension) without touching the scoring logic itself.
 *
 * ── Decision thresholds ─────────────────────────────────────────────────────────────────────
 * READY:                     completenessScore >= 70 and no dimension is `missing`.
 * INSUFFICIENT_INFORMATION:  completenessScore < 25 (very little useful information exists).
 * NEEDS_MORE_INFORMATION:    everything else.
 */

type ConfidenceLevel = 'low' | 'medium' | 'high';

/** Full weight if `complete`, half if `partial`, zero if `missing`. Sums to 100 — extend by adding a dimension here and to `evaluateDimensions` together. */
const DIMENSION_WEIGHTS: Record<DiscoveryDimension, number> = {
  businessVision: 15,
  targetUsers: 12,
  coreFeatures: 15,
  industry: 10,
  businessAssessment: 10,
  projectType: 10,
  businessConstraints: 8,
  currentSystems: 8,
  integrations: 6,
  technicalPreferences: 6,
};

const READY_SCORE_THRESHOLD = 70;
const INSUFFICIENT_SCORE_THRESHOLD = 25;

/** Freeform text at or above this length counts as `complete`; any shorter non-empty text is `partial`. */
const TEXT_COMPLETE_LENGTH = 20;

type DimensionStatus = 'complete' | 'partial' | 'missing';

function statusForText(text: string): DimensionStatus {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return 'missing';
  }

  return trimmed.length >= TEXT_COMPLETE_LENGTH ? 'complete' : 'partial';
}

/** `completeAt` items or more is `complete`; any lesser non-zero count is `partial`; zero is `missing`. */
function statusForCount(count: number, completeAt: number): DimensionStatus {
  if (count <= 0) {
    return 'missing';
  }

  return count >= completeAt ? 'complete' : 'partial';
}

/** A classified field (e.g. `assessment.projectType`) is `missing` if the engine never got a signal at all ('Unknown'), `partial` if it only matched a low-confidence fallback rule, and `complete` otherwise. */
function statusForClassifiedField(value: string | undefined, confidence: ConfidenceLevel | undefined): DimensionStatus {
  if (!value || value === 'Unknown') {
    return 'missing';
  }

  return confidence === 'low' ? 'partial' : 'complete';
}

function confidenceForTarget(evidence: TraceabilityReference[], targetId: string): ConfidenceLevel | undefined {
  return evidence.find((entry) => entry.target.id === targetId)?.confidence;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface DimensionResult {
  status: DimensionStatus;
}

/**
 * Evaluates all ten dimensions against the same patch the Business Assessment Engine just ran
 * against, plus its result (for the `industry`/`projectType`/`businessAssessment` dimensions,
 * which reuse the assessment's own confidence rather than re-deriving one).
 *
 * `currentSystems` and `integrations` deliberately read the same underlying signal
 * (`patch.currentSystems`, itself a lossless copy of the form's `integrations` field — see
 * `buildInitialUnderstandingPatch` in `requirementsSessionOrchestrator.ts`): the current form
 * mapping doesn't yet distinguish "existing IT systems" from "third-party integrations needed"
 * (that distinction is Fact Extraction's job, a later sprint), so scoring them independently
 * from data that doesn't yet exist separately would invent a distinction the model can't back up.
 */
function evaluateDimensions(
  patch: BusinessUnderstandingModelPatch,
  assessmentResult: BusinessAssessmentResult,
): Record<DiscoveryDimension, DimensionResult> {
  const identity = asRecord(patch.businessIdentity);
  const snapshot = asRecord(identity.formSnapshot);

  const vision = asText(identity.vision);
  const targetUsersText = (patch.targetUsers ?? []).join(' ');
  const coreFeaturesCount = (patch.functionalRequirements ?? []).length;
  const businessConstraintsCount = (patch.businessConstraints ?? []).length;
  const currentSystemsCount = (patch.currentSystems ?? []).length;
  const technicalPreferencesText = asText(snapshot.technicalPreferences);

  const { assessment, evidence } = assessmentResult;
  const unknownAssessmentFieldCount = [assessment.classification, assessment.maturity, assessment.projectType].filter(
    (value) => !value || value === 'Unknown',
  ).length;

  return {
    businessVision: { status: statusForText(vision) },
    targetUsers: { status: statusForText(targetUsersText) },
    coreFeatures: { status: statusForCount(coreFeaturesCount, 2) },
    industry: {
      status: statusForClassifiedField(assessment.industry, confidenceForTarget(evidence, 'assessment.classification')),
    },
    businessAssessment: {
      status: unknownAssessmentFieldCount === 0 ? 'complete' : unknownAssessmentFieldCount >= 3 ? 'missing' : 'partial',
    },
    projectType: {
      status: statusForClassifiedField(assessment.projectType, confidenceForTarget(evidence, 'assessment.projectType')),
    },
    businessConstraints: { status: statusForCount(businessConstraintsCount, 2) },
    currentSystems: { status: statusForCount(currentSystemsCount, 2) },
    integrations: { status: statusForCount(currentSystemsCount, 2) },
    technicalPreferences: { status: statusForText(technicalPreferencesText) },
  };
}

function scoreFor(status: DimensionStatus, weight: number): number {
  if (status === 'complete') {
    return weight;
  }

  if (status === 'partial') {
    return weight / 2;
  }

  return 0;
}

function stateFor(completenessScore: number, missingAreas: DiscoveryDimension[]): DiscoveryState {
  if (completenessScore >= READY_SCORE_THRESHOLD && missingAreas.length === 0) {
    return 'READY';
  }

  if (completenessScore < INSUFFICIENT_SCORE_THRESHOLD) {
    return 'INSUFFICIENT_INFORMATION';
  }

  return 'NEEDS_MORE_INFORMATION';
}

function confidenceFor(completenessScore: number): ConfidenceLevel {
  if (completenessScore >= 75) {
    return 'high';
  }

  return completenessScore >= 45 ? 'medium' : 'low';
}

function makeEvidence(source: ProvenanceEntityRef, targetFieldId: string, recordedAt: string): TraceabilityReference {
  return {
    source,
    target: { type: 'business_understanding_section', id: `decision.${targetFieldId}` },
    transformation: 'discovery-decision:weighted-dimension-scoring',
    recordedAt,
  };
}

export interface DiscoveryDecisionResult {
  decision: DiscoveryDecision;
  evidence: TraceabilityReference[];
}

/**
 * Runs the Discovery Decision Engine against the same patch/assessment the caller just produced.
 * Never mutates its inputs; returns the decision plus lightweight provenance for its four
 * headline outputs (`decision.state`, `decision.completenessScore`, `decision.missingAreas`,
 * `decision.partialAreas`), reusing the exact `TraceabilityReference` shape Sprint 52 introduced
 * and Sprint 53 already reuses — never duplicating customer content, only ids and rule names.
 */
export function runDiscoveryDecision(
  patch: BusinessUnderstandingModelPatch,
  assessmentResult: BusinessAssessmentResult,
): DiscoveryDecisionResult {
  const dimensions = evaluateDimensions(patch, assessmentResult);
  const recordedAt = new Date().toISOString();

  const missingAreas: DiscoveryDimension[] = [];
  const partialAreas: DiscoveryDimension[] = [];
  let completenessScore = 0;

  for (const [dimension, weight] of Object.entries(DIMENSION_WEIGHTS) as [DiscoveryDimension, number][]) {
    const { status } = dimensions[dimension];
    completenessScore += scoreFor(status, weight);

    if (status === 'missing') {
      missingAreas.push(dimension);
    } else if (status === 'partial') {
      partialAreas.push(dimension);
    }
  }

  completenessScore = Math.round(completenessScore);

  const state = stateFor(completenessScore, missingAreas);
  const overallConfidence = confidenceFor(completenessScore);

  const decision: DiscoveryDecision = {
    state,
    overallConfidence,
    completenessScore,
    missingAreas,
    partialAreas,
    readyForRequirementsDraft: state === 'READY',
  };

  const source: ProvenanceEntityRef = { type: 'business_understanding_section', id: 'businessUnderstandingModel' };

  const evidence: TraceabilityReference[] = [
    makeEvidence(source, 'state', recordedAt),
    makeEvidence(source, 'completenessScore', recordedAt),
    makeEvidence(source, 'missingAreas', recordedAt),
    makeEvidence(source, 'partialAreas', recordedAt),
  ];

  return { decision, evidence };
}

export const discoveryDecisionEngine = {
  runDiscoveryDecision,
};
