import { getBuildersDbClient } from '~/lib/builders-db/client';
import { createRepositoryLogger } from '~/lib/builders-db/repositories/requirementsDiscoveryLogging';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type {
  ChangeArea,
  ChangeCategory,
  ChangeRequest,
  ChangeRequestDraft,
  ChangeRequestPriority,
  ChangeScope,
  ChangeRequestStatus,
} from '~/lib/evolution/changeRequestTypes';
import { validateChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { EvolutionPlan } from '~/lib/evolution/evolutionPlan';
import type { ComplexityLevel, ImpactAnalysis, ImpactConfidence, RiskLevel } from '~/lib/evolution/impactTypes';

/**
 * Product Evolution Repository — Sprint 95.
 *
 * Persists change requests and their impact analyses, and writes the three canonical history
 * events (Part 12) into the existing `builders_deployment_history` — no second history table.
 *
 * Follows the exact defensive convention every other BuildersDB repository uses: check for a
 * configured client up front, wrap each Supabase call in try/catch, return a safe explicit result
 * rather than throwing.
 *
 * NO TRANSACTION HERE, deliberately — unlike Sprints 92/93/94. Those three each combined an
 * artifact write with a LIFECYCLE TRANSITION, where a partial failure produced misleading
 * authoritative state ("Deployment says released" with no release behind it). This sprint changes
 * no lifecycle at all: a change request and an analysis are additive observations, and a failure
 * partway through leaves a request with no analysis — which is self-evident on the next read and is
 * exactly what a retry fixes. Adding a Postgres function for it would be ceremony without a
 * guarantee to buy.
 */

const { unavailable, logError } = createRepositoryLogger('EvolutionRepository');

interface ChangeRequestRow {
  id: string;
  deployment_id: string;
  project_id: string;
  release_id: string | null;
  release_version: string | null;
  request_number: number;
  title: string;
  description: string;
  business_reason: string | null;
  priority: ChangeRequestPriority;
  category: ChangeCategory;
  scope: ChangeScope;
  declared_areas: ChangeArea[] | null;
  status: ChangeRequestStatus;
  requested_by: string | null;
  requested_at: string;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function fromChangeRequestRow(row: ChangeRequestRow): ChangeRequest {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    releaseId: row.release_id ?? undefined,
    releaseVersion: row.release_version ?? undefined,
    requestNumber: row.request_number,
    title: row.title,
    description: row.description,
    businessReason: row.business_reason ?? undefined,
    priority: row.priority,
    category: row.category,
    scope: row.scope,
    declaredAreas: row.declared_areas ?? [],
    status: row.status,
    requestedBy: row.requested_by ?? undefined,
    requestedAt: row.requested_at,
    notes: row.notes ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ImpactAnalysisRow {
  id: string;
  change_request_id: string;
  deployment_id: string;
  project_id: string;
  release_id: string | null;
  release_version: string | null;
  analysis_number: number;
  classification: ChangeCategory;
  risk_level: RiskLevel;
  complexity_level: ComplexityLevel;
  overall_confidence: ImpactConfidence;
  requires_human_review: boolean;
  impact: ImpactAnalysis | Record<string, never> | null;
  evolution_plan: EvolutionPlan | null;
  analysed_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One persisted analysis run, with the plan derived from it when one was generated. */
export interface ChangeImpactRecord {
  id: string;
  changeRequestId: string;
  deploymentId: string;
  projectId: string;
  releaseId?: string;
  releaseVersion?: string;
  analysisNumber: number;
  classification: ChangeCategory;
  riskLevel: RiskLevel;
  complexityLevel: ComplexityLevel;
  overallConfidence: ImpactConfidence;
  requiresHumanReview: boolean;
  impact: ImpactAnalysis;
  evolutionPlan?: EvolutionPlan;
  analysedAt: string;
  createdBy?: string;
  createdAt: string;
}

function fromImpactRow(row: ImpactAnalysisRow): ChangeImpactRecord {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    releaseId: row.release_id ?? undefined,
    releaseVersion: row.release_version ?? undefined,
    analysisNumber: row.analysis_number,
    classification: row.classification,
    riskLevel: row.risk_level,
    complexityLevel: row.complexity_level,
    overallConfidence: row.overall_confidence,
    requiresHumanReview: row.requires_human_review,
    impact: (row.impact ?? {}) as ImpactAnalysis,
    evolutionPlan: row.evolution_plan ?? undefined,
    analysedAt: row.analysed_at,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

export type CreateChangeRequestFailureCode = 'unavailable' | 'invalid' | 'duplicate' | 'error';

export type CreateChangeRequestResult =
  | { ok: true; request: ChangeRequest }
  | { ok: false; code: CreateChangeRequestFailureCode; message: string };

/**
 * Part 2/15 — creates a change request against a release. Refuses a request with no release
 * (there would be no baseline to analyse it against) and a duplicate of an open request with the
 * same title, so the same ask does not accumulate silently.
 *
 * Records the canonical `change_requested` history event.
 */
export async function createChangeRequest(
  draft: ChangeRequestDraft,
  options: { createdBy?: string } = {},
): Promise<CreateChangeRequestResult> {
  const validation = validateChangeRequest(draft);

  if (!validation.ok) {
    return { ok: false, code: 'invalid', message: validation.message };
  }

  const client = getBuildersDbClient();

  if (!client) {
    unavailable('createChangeRequest');
    return { ok: false, code: 'unavailable', message: 'BuildersDB is not configured.' };
  }

  try {
    const { data: existingRows, error: existingError } = await client
      .from('builders_change_requests')
      .select('request_number, title, status')
      .eq('deployment_id', draft.deploymentId)
      .order('request_number', { ascending: false });

    if (existingError) {
      throw existingError;
    }

    const existing = (existingRows ?? []) as Array<{ request_number: number; title: string; status: string }>;

    /*
     * Part 15's "duplicate requests". Only an OPEN request blocks — the same ask raised again after
     * an earlier one was cancelled or planned is a legitimately new request.
     */
    const duplicate = existing.find(
      (row) =>
        row.title.trim().toLowerCase() === draft.title.trim().toLowerCase() &&
        !['cancelled', 'planned'].includes(row.status),
    );

    if (duplicate) {
      return {
        ok: false,
        code: 'duplicate',
        message: `Change request #${duplicate.request_number} with this title is already open for this product.`,
      };
    }

    const requestNumber = (existing[0]?.request_number ?? 0) + 1;

    const { data, error } = await client
      .from('builders_change_requests')
      .insert({
        deployment_id: draft.deploymentId,
        project_id: draft.projectId,
        release_id: draft.releaseId ?? null,
        release_version: draft.releaseVersion ?? null,
        request_number: requestNumber,
        title: draft.title.trim(),
        description: draft.description.trim(),
        business_reason: draft.businessReason?.trim() || null,
        priority: draft.priority,
        category: draft.category,
        scope: draft.scope,
        declared_areas: draft.declaredAreas ?? [],
        status: 'submitted',
        requested_by: draft.requestedBy ?? options.createdBy ?? null,
        notes: draft.notes?.trim() || null,
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    const request = fromChangeRequestRow(data as ChangeRequestRow);

    await deploymentRepository.recordDeploymentEvent({
      deploymentId: draft.deploymentId,
      projectId: draft.projectId,
      eventType: 'change_requested',
      message: `Change request #${requestNumber} raised against release ${draft.releaseVersion ?? '(unversioned)'}: ${request.title}`,
      metadata: {
        changeRequestId: request.id,
        requestNumber,
        releaseId: draft.releaseId,
        priority: draft.priority,
        declaredCategory: draft.category,
      },
      createdBy: options.createdBy,
    });

    return { ok: true, request };
  } catch (error) {
    logError('createChangeRequest', error);
    return { ok: false, code: 'error', message: 'The change request could not be saved.' };
  }
}

/** Part 15 — cancelling a request. Never deletes: the customer's ask and any analysis of it stay readable. */
export async function updateChangeRequestStatus(requestId: string, status: ChangeRequestStatus): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('updateChangeRequestStatus');
    return false;
  }

  try {
    const { error } = await client.from('builders_change_requests').update({ status }).eq('id', requestId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('updateChangeRequestStatus', error);
    return false;
  }
}

export async function listChangeRequests(deploymentId: string): Promise<ChangeRequest[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listChangeRequests');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_change_requests')
      .select('*')
      .eq('deployment_id', deploymentId)
      .order('request_number', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromChangeRequestRow(row as ChangeRequestRow));
  } catch (error) {
    logError('listChangeRequests', error);
    return [];
  }
}

export type RecordImpactResult =
  | { ok: true; record: ChangeImpactRecord }
  | { ok: false; code: 'unavailable' | 'error'; message: string };

/**
 * Part 3/6/12 — persists one analysis run and, when the caller generated one, the Evolution Plan
 * derived from it. Allocates the next `analysis_number`, so re-analysing never overwrites an
 * earlier result.
 *
 * Writes `impact_completed` always, and `evolution_plan_created` only when a plan was produced —
 * one canonical event per thing that actually happened.
 */
export async function recordImpactAnalysis(params: {
  changeRequest: ChangeRequest;
  impact: ImpactAnalysis;
  evolutionPlan?: EvolutionPlan;
  createdBy?: string;
}): Promise<RecordImpactResult> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('recordImpactAnalysis');
    return { ok: false, code: 'unavailable', message: 'BuildersDB is not configured.' };
  }

  const { changeRequest, impact } = params;

  try {
    const { data: latestRows, error: latestError } = await client
      .from('builders_change_impact_analyses')
      .select('analysis_number')
      .eq('change_request_id', changeRequest.id)
      .order('analysis_number', { ascending: false })
      .limit(1);

    if (latestError) {
      throw latestError;
    }

    const analysisNumber = ((latestRows?.[0] as { analysis_number?: number } | undefined)?.analysis_number ?? 0) + 1;

    const { data, error } = await client
      .from('builders_change_impact_analyses')
      .insert({
        change_request_id: changeRequest.id,
        deployment_id: changeRequest.deploymentId,
        project_id: changeRequest.projectId,
        release_id: changeRequest.releaseId ?? null,
        release_version: changeRequest.releaseVersion ?? null,
        analysis_number: analysisNumber,
        classification: impact.classification.category,
        risk_level: impact.risk.level,
        complexity_level: impact.complexity.level,
        overall_confidence: impact.overallConfidence,
        requires_human_review: impact.requiresHumanReview,
        impact,
        evolution_plan: params.evolutionPlan ?? null,
        analysed_at: impact.analysedAt,
        created_by: params.createdBy ?? null,
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    const record = fromImpactRow(data as ImpactAnalysisRow);

    await deploymentRepository.recordDeploymentEvent({
      deploymentId: changeRequest.deploymentId,
      projectId: changeRequest.projectId,
      eventType: 'impact_completed',
      message: `Impact analysis #${analysisNumber} for change request #${changeRequest.requestNumber}: ${impact.classification.category}, ${impact.risk.level} risk, ${impact.complexity.level} complexity.`,
      metadata: {
        changeRequestId: changeRequest.id,
        impactAnalysisId: record.id,
        analysisNumber,
        classification: impact.classification.category,
        riskLevel: impact.risk.level,
        complexityLevel: impact.complexity.level,
        requiresHumanReview: impact.requiresHumanReview,
      },
      createdBy: params.createdBy,
    });

    if (params.evolutionPlan) {
      await deploymentRepository.recordDeploymentEvent({
        deploymentId: changeRequest.deploymentId,
        projectId: changeRequest.projectId,
        eventType: 'evolution_plan_created',
        message: `Evolution plan created for change request #${changeRequest.requestNumber} — ${params.evolutionPlan.suggestedMvp.label}.`,
        metadata: {
          changeRequestId: changeRequest.id,
          impactAnalysisId: record.id,
          suggestedPlacement: params.evolutionPlan.suggestedMvp.placement,
          phases: params.evolutionPlan.estimatedPhases.length,
          roles: params.evolutionPlan.requiredRoles.length,
        },
        createdBy: params.createdBy,
      });
    }

    await updateChangeRequestStatus(changeRequest.id, params.evolutionPlan ? 'planned' : 'analyzed');

    return { ok: true, record };
  } catch (error) {
    logError('recordImpactAnalysis', error);
    return { ok: false, code: 'error', message: 'The impact analysis could not be saved.' };
  }
}

/** The most recent analysis for a change request, or null when it has never been analysed. */
export async function getLatestImpactAnalysis(changeRequestId: string): Promise<ChangeImpactRecord | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getLatestImpactAnalysis');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_change_impact_analyses')
      .select('*')
      .eq('change_request_id', changeRequestId)
      .order('analysis_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromImpactRow(data as ImpactAnalysisRow) : null;
  } catch (error) {
    logError('getLatestImpactAnalysis', error);
    return null;
  }
}

/** Every analysis for a deployment, newest first — used by the dashboard to show each request's latest result. */
export async function listImpactAnalyses(deploymentId: string): Promise<ChangeImpactRecord[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listImpactAnalyses');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_change_impact_analyses')
      .select('*')
      .eq('deployment_id', deploymentId)
      .order('analysis_number', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromImpactRow(row as ImpactAnalysisRow));
  } catch (error) {
    logError('listImpactAnalyses', error);
    return [];
  }
}

export const evolutionRepository = {
  createChangeRequest,
  updateChangeRequestStatus,
  listChangeRequests,
  recordImpactAnalysis,
  getLatestImpactAnalysis,
  listImpactAnalyses,
};
