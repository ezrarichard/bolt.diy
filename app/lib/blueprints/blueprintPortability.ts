import { validateBlueprintContent, type BlueprintContentValidationResult } from './blueprintContentValidation';
import type { ProjectBlueprint } from './types';

/**
 * Blueprint Export/Import — Sprint 60 (Blueprint Knowledge Foundation).
 *
 * Pure data-transformation utilities for future backup, migration, and sharing workflows — see
 * the Sprint 60 brief's objective 5 ("No UI required"). Deliberately does not touch BuildersDB
 * or `blueprintRepository.ts` (that file stays read-only this sprint, per Sprint 59/60's
 * "Repository unchanged" success criterion): a caller that wants to export a live Blueprint
 * fetches it however it already does (`blueprintEngine.getBlueprint()`), then hands the result
 * to `exportBlueprint()` here; a caller that wants to persist an imported Blueprint is
 * responsible for writing it somewhere itself (there is intentionally no write path here yet —
 * that's Blueprint Studio's job, explicitly out of scope for this sprint).
 */

export const BLUEPRINT_EXPORT_FORMAT_VERSION = 1;

/** The on-the-wire shape one exported Blueprint round-trips through. */
export interface BlueprintExportEnvelope {
  exportFormatVersion: number;
  exportedAt: string;
  blueprint: ProjectBlueprint;
}

export type BlueprintImportResult =
  | { ok: true; blueprint: ProjectBlueprint; contentValidation: BlueprintContentValidationResult }
  | { ok: false; error: string };

/** Serializes one Blueprint into a versioned, portable JSON string. Never throws. */
export function exportBlueprint(blueprint: ProjectBlueprint): string {
  const envelope: BlueprintExportEnvelope = {
    exportFormatVersion: BLUEPRINT_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    blueprint,
  };

  return JSON.stringify(envelope, null, 2);
}

/** Serializes multiple Blueprints as one JSON array of envelopes — e.g. a full-catalog backup. */
export function exportBlueprints(blueprints: ProjectBlueprint[]): string {
  return JSON.stringify(
    blueprints.map((blueprint) => ({
      exportFormatVersion: BLUEPRINT_EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      blueprint,
    })),
    null,
    2,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural check that an unknown parsed value is at least shaped like a `ProjectBlueprint` —
 * the required fields every existing consumer (`blueprintEngine.*`) depends on. Does not
 * validate `content` here; `importBlueprint()` runs `validateBlueprintContent()` separately so a
 * Blueprint with a missing/incomplete `content` section can still be imported (with a non-`ok`
 * content validation the caller can inspect), rather than the whole import being rejected.
 */
function isProjectBlueprintShape(value: unknown): value is ProjectBlueprint {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.description === 'string' &&
    typeof value.category === 'string' &&
    typeof value.enabled === 'boolean'
  );
}

/**
 * Parses and validates a single exported Blueprint. Never throws — malformed JSON or a
 * malformed envelope both return `{ ok: false, error }`, matching every other parser convention
 * in this codebase (e.g. `draftParsing.ts`, `blueprintContentValidation.ts`).
 */
export function importBlueprint(json: string): BlueprintImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Not valid JSON.' };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Expected a JSON object.' };
  }

  if (typeof parsed.exportFormatVersion !== 'number') {
    return { ok: false, error: 'Missing or invalid "exportFormatVersion".' };
  }

  if (parsed.exportFormatVersion > BLUEPRINT_EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Export format version ${parsed.exportFormatVersion} is newer than this build supports (max ${BLUEPRINT_EXPORT_FORMAT_VERSION}).`,
    };
  }

  const blueprint = parsed.blueprint;

  if (!isProjectBlueprintShape(blueprint)) {
    return {
      ok: false,
      error: 'Missing or malformed "blueprint" — expected id, name, icon, description, category, enabled.',
    };
  }

  return { ok: true, blueprint, contentValidation: validateBlueprintContent(blueprint.content) };
}

/** Parses a JSON array of exported Blueprints (see `exportBlueprints()`). Each entry is validated independently — one bad entry never fails the whole batch. */
export function importBlueprints(json: string): { results: BlueprintImportResult[]; error?: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return { results: [], error: 'Not valid JSON.' };
  }

  if (!Array.isArray(parsed)) {
    return { results: [], error: 'Expected a JSON array.' };
  }

  return { results: parsed.map((entry) => importBlueprint(JSON.stringify(entry))) };
}
