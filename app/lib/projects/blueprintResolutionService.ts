import { blueprintEngine, resolveBlueprintCandidates, type BlueprintResolutionResult } from '~/lib/blueprints';
import {
  blueprintResolutionRepository,
  type BlueprintResolution,
} from '~/lib/builders-db/repositories/blueprintResolutionRepository';
import type { BusinessUnderstandingModel } from '~/lib/projects/requirementsSession';

/**
 * Blueprint Resolution Service — Sprint 61.
 *
 * The one public entry point that wires the pure `blueprintResolutionEngine` (scoring only, no
 * I/O) to the Blueprint catalog (`blueprintEngine.getAllBlueprints()`, Sprints 59-60) and to
 * persistence (`blueprintResolutionRepository`, this sprint). Nothing else in the codebase
 * should call the engine or the repository directly for a real resolution — this keeps "resolve
 * and persist" as a single, consistent operation.
 *
 * Per the Sprint 61 brief this sprint ends with a recommendation only: nothing here injects a
 * Blueprint into an AI role's context, changes `project.blueprintId`, or alters the existing
 * Builders workflow. Every function below either reads or produces a resolution — it never
 * mutates a project.
 */

/**
 * Runs the resolution engine against the current Blueprint catalog and persists the result as a
 * new history row (never overwriting a previous run). Returns `null` only when persistence
 * itself failed (e.g. BuildersDB unconfigured) — the computed `BlueprintResolutionResult` is
 * still available to the caller via a thrown-away resolve in that case, but callers that need
 * the in-memory result even when persistence is unavailable should call `resolveBlueprints`
 * directly instead.
 */
export async function resolveAndRecordBlueprint(params: {
  projectId: string;
  sessionId: string | null;
  model: BusinessUnderstandingModel;
}): Promise<{ result: BlueprintResolutionResult; persisted: BlueprintResolution | null }> {
  const result = resolveBlueprints(params.model);

  if (!result.recommendedBlueprintId) {
    return { result, persisted: null };
  }

  const top = result.candidates[0];
  const persisted = await blueprintResolutionRepository.recordBlueprintResolution({
    projectId: params.projectId,
    sessionId: params.sessionId,
    recommendedBlueprintId: top.blueprintId,
    confidence: top.confidence,
    explanation: top.reasons,
    candidates: result.candidates,
  });

  return { result, persisted };
}

/** Pure resolution — no persistence. Useful for previewing a recommendation before committing to it. */
export function resolveBlueprints(model: BusinessUnderstandingModel): BlueprintResolutionResult {
  return resolveBlueprintCandidates(model, blueprintEngine.getAllBlueprints());
}

/** The most recent persisted resolution for a project, or `null` if none has been recorded / BuildersDB is unavailable. */
export async function getLatestBlueprintResolution(projectId: string): Promise<BlueprintResolution | null> {
  return blueprintResolutionRepository.getLatestBlueprintResolution(projectId);
}

/** Complete resolution history for a project, most-recent first. */
export async function getBlueprintResolutionHistory(projectId: string): Promise<BlueprintResolution[]> {
  return blueprintResolutionRepository.listBlueprintResolutionHistory(projectId);
}

/**
 * Manual override — records a user's own Blueprint choice against an existing resolution
 * without discarding what the engine recommended. Per the brief, the recommendation must never
 * force the user; `resolutionId` identifies which resolution run is being overridden (typically
 * the latest one).
 */
export async function selectBlueprint(resolutionId: string, selectedBlueprintId: string): Promise<boolean> {
  return blueprintResolutionRepository.selectBlueprint(resolutionId, selectedBlueprintId);
}

export const blueprintResolutionService = {
  resolveAndRecordBlueprint,
  resolveBlueprints,
  getLatestBlueprintResolution,
  getBlueprintResolutionHistory,
  selectBlueprint,
};
