import type { BlueprintCandidate } from '~/lib/blueprints';

/**
 * BuildersDB row/frontend shape mapping for the Blueprint Resolution Foundation — Sprint 61.
 * Mirrors the convention `blueprintDbTypes.ts` established (see its own header comment):
 * `BuildersDbBlueprintResolutionRow` is the literal shape of a row in
 * `builders_blueprint_resolutions` (see
 * supabase/migrations/20260731100000_blueprint_resolution_foundation.sql for the DDL), and this
 * file is the only place a row is translated into the application's `BlueprintResolution` shape.
 */

export interface BuildersDbBlueprintResolutionRow {
  id: string;
  project_id: string;
  session_id: string | null;
  recommended_blueprint_id: string;
  selected_blueprint_id: string;
  confidence: number;
  explanation: string[];
  candidates: BlueprintCandidate[];
  resolved_at: string;
  created_at: string;
}

/**
 * One persisted Blueprint Resolution — a single row of the append-only history described in the
 * migration's header comment. `recommendedBlueprintId` and `selectedBlueprintId` are tracked
 * separately (per the Sprint 61 brief: "these may differ") — a caller never needs to guess
 * whether a stored `selectedBlueprintId` reflects the engine's own suggestion or a human's
 * manual override.
 */
export interface BlueprintResolution {
  id: string;
  projectId: string;
  sessionId: string | null;
  recommendedBlueprintId: string;
  selectedBlueprintId: string;
  confidence: number;
  explanation: string[];
  candidates: BlueprintCandidate[];
  resolvedAt: string;
  createdAt: string;
}

export function fromBlueprintResolutionRow(row: BuildersDbBlueprintResolutionRow): BlueprintResolution {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    recommendedBlueprintId: row.recommended_blueprint_id,
    selectedBlueprintId: row.selected_blueprint_id,
    confidence: row.confidence,
    explanation: row.explanation ?? [],
    candidates: row.candidates ?? [],
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

/**
 * Insert payload for a brand-new resolution run. `selectedBlueprintId` always starts equal to
 * `recommendedBlueprintId` — the row only diverges later if a human explicitly overrides it via
 * `selectBlueprint` (see `blueprintResolutionRepository.ts`).
 */
export function toBlueprintResolutionInsert(params: {
  projectId: string;
  sessionId: string | null;
  recommendedBlueprintId: string;
  confidence: number;
  explanation: string[];
  candidates: BlueprintCandidate[];
}): Record<string, unknown> {
  return {
    project_id: params.projectId,
    session_id: params.sessionId,
    recommended_blueprint_id: params.recommendedBlueprintId,
    selected_blueprint_id: params.recommendedBlueprintId,
    confidence: params.confidence,
    explanation: params.explanation,
    candidates: params.candidates,
  };
}
