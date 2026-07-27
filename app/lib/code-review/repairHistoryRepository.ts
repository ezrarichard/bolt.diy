import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import type { RepairAttemptRecord, ValidatorRunResult } from './codeReviewTypes';
import { formatError, toStructuredError } from '~/lib/builders-db/repositories/structuredError';

/**
 * Repair History Repository — Sprint 39.
 *
 * BuildersDB persistence for the Code Reviewer / Repair Engineer / Build Validator roles'
 * activity: `builders_validation_runs` (one row per validator execution, pass or fail —
 * every generation's validation history, not just the ones that needed a repair) and
 * `builders_code_repair_attempts` (one row per AI repair attempt). Same defensive contract
 * as every other builders-db-backed module in this codebase (buildersDbRepository.ts,
 * workspaceStateRepository.ts): guarded on BuildersDB being configured, every Supabase call
 * wrapped in try/catch, every failure path logs and returns a safe fallback — a repair loop
 * NEVER fails or blocks because BuildersDB is unavailable, it just doesn't get a history.
 */

function unavailable(method: string): void {
  console.warn(`[BuildersDB] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[BuildersDB] ${method}() failed: ${formatError(error)}`, toStructuredError(error));
}

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

/** Cheap, non-cryptographic string hash (DJB2) — good enough to group "the same error shape" for a future patch-reuse lookup; collisions are acceptable since this is only ever a hint, never a security boundary. */
export function computePatchSignature(stage: string, validatorId: string, errorMessage: string): string {
  const input = `${stage}:${validatorId}:${errorMessage.slice(0, 300)}`;
  let hash = 5381;

  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }

  return (hash >>> 0).toString(16);
}

export async function recordValidationRun(
  projectId: string,
  attemptNumber: number,
  run: ValidatorRunResult,
): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('recordValidationRun');
    return false;
  }

  try {
    const { error } = await client.from('builders_validation_runs').insert({
      project_id: projectId,
      attempt_number: attemptNumber,
      validator_id: run.validatorId,
      validator_label: run.validatorLabel,
      stage: run.stage,
      role_key: run.roleKey,
      status: run.status,
      issue_count: run.issueCount,
      issues: run.issues,
    });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('recordValidationRun', error);
    return false;
  }
}

export async function getValidationRuns(projectId: string): Promise<ValidatorRunResult[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getValidationRuns');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_validation_runs')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      validatorId: row.validator_id,
      validatorLabel: row.validator_label,
      stage: row.stage,
      roleKey: row.role_key,
      status: row.status,
      issueCount: row.issue_count,
      issues: row.issues ?? [],
    }));
  } catch (error) {
    logError('getValidationRuns', error);
    return [];
  }
}

export async function recordRepairAttempt(record: RepairAttemptRecord): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('recordRepairAttempt');
    return false;
  }

  try {
    const { error } = await client.from('builders_code_repair_attempts').insert({
      project_id: record.projectId,
      attempt_number: record.attemptNumber,
      stage: record.stage,
      validator_id: record.validatorId,
      error_type: record.errorType,
      error_message: record.errorMessage,
      affected_files: record.affectedFiles,
      patch_summary: record.patchSummary,
      files_created: record.filesCreated,
      files_updated: record.filesUpdated,
      files_deleted: record.filesDeleted,
      status: record.status,
      model_used: record.modelUsed ?? null,
      patch_signature: record.patchSignature,
      role_key: 'repair-engineer',
    });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('recordRepairAttempt', error);
    return false;
  }
}

export async function getRepairAttempts(projectId: string): Promise<(RepairAttemptRecord & { createdAt: string })[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getRepairAttempts');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_code_repair_attempts')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      projectId: row.project_id,
      attemptNumber: row.attempt_number,
      stage: row.stage,
      validatorId: row.validator_id,
      errorType: row.error_type,
      errorMessage: row.error_message,
      affectedFiles: row.affected_files ?? [],
      patchSummary: row.patch_summary,
      filesCreated: row.files_created ?? [],
      filesUpdated: row.files_updated ?? [],
      filesDeleted: row.files_deleted ?? [],
      status: row.status,
      modelUsed: row.model_used ?? undefined,
      patchSignature: row.patch_signature,
      createdAt: row.created_at,
    }));
  } catch (error) {
    logError('getRepairAttempts', error);
    return [];
  }
}

export const repairHistoryRepository = {
  recordValidationRun,
  getValidationRuns,
  recordRepairAttempt,
  getRepairAttempts,
  computePatchSignature,
};
