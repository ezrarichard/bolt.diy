import type { RegionCode } from './regionalProfileTypes';

/**
 * Regional Selection & Resolution types (Sprint 71, Regional Intelligence Foundation).
 *
 * Mirrors the discipline of Blueprint Resolution (`app/lib/projects/blueprintResolutionService.ts`)
 * without copying its append-only-history table design — see `regionalResolutionService.ts`'s
 * own header comment for why a `Project`-level field is sufficient here.
 */

/**
 * The persisted shape of `Project.regionalSelection` — a manual choice only. There is no
 * "recommended vs selected" pair to store the way Blueprint Resolution has, because this
 * foundation sprint has no automatic recommendation engine (see PART 4/5 of the Sprint 71
 * brief and this module's `RegionalSelectionSource` doc below) — the only thing ever persisted
 * is an explicit choice.
 */
export interface RegionalSelection {
  regionCode: RegionCode;

  /** ISO timestamp — when this manual selection was made or last changed. */
  selectedAt: string;
}

/**
 * Every source `resolveEffectiveRegionalSelection` could in principle report, matching PART 5
 * of the Sprint 71 brief's suggested list exactly. **Only `'manual_override'` and `'none'` are
 * actually reachable in this foundation sprint** — the other three are reserved for real
 * future signals that don't exist yet in this codebase (confirmed during Sprint 71's own
 * architecture research: no structured country/region field exists anywhere in Business
 * Discovery, and no workspace/organization-default concept exists at all):
 *
 * - `'manual_override'` — `Project.regionalSelection` is set. Reachable today.
 * - `'business_discovery'` — would mean Business Discovery captured a structured country/market
 *   field and this resolver read it. Reserved: `BusinessUnderstandingModel` has no such field
 *   yet (see `docs/regional-intelligence/Regional-Intelligence.md`'s "Known limitations").
 * - `'project_metadata'` — would mean a region was present in project metadata but NOT through
 *   the manual-override write path (e.g. a future bulk-import/programmatic set). Reserved:
 *   today the only writer of `Project.regionalSelection` IS the manual-override path, so this
 *   value is never produced — kept in the union so a future writer doesn't need a type change.
 * - `'workspace_default'` — would mean an organization/workspace-level default region existed.
 *   Reserved: no workspace/organization concept exists in this codebase at all yet.
 * - `'none'` — nothing resolved. Reachable today (the common case until a project sets one).
 */
export type RegionalSelectionSource =
  | 'manual_override'
  | 'business_discovery'
  | 'project_metadata'
  | 'workspace_default'
  | 'none';

/**
 * The result of resolving a project's effective Regional Profile — always returned (never
 * `undefined`), unlike Blueprint's `EffectiveBlueprintSelection | undefined`. When nothing
 * resolves, `selectionSource` is `'none'` and every profile-identifying field is `null` — this
 * shape lets a caller check `contentAvailable`/`selectionSource` without an extra existence
 * check first, per PART 5's explicit field list.
 */
export interface RegionalResolutionResult {
  regionalProfileId: string | null;
  regionalProfileCode: RegionCode | null;
  regionalProfileVersion: number | null;
  selectionSource: RegionalSelectionSource;

  /** The raw value the resolver read before mapping to a profile — e.g. the stored `regionCode` string. Null when nothing was found. */
  sourceValue: string | null;

  /** The human-readable country/market name actually matched, or null. Never inferred from IP/browser/locale — see regionalResolutionService.ts. */
  matchedCountry: string | null;

  /** Set only when `selectionSource` is `'none'` — a short, human-readable reason (e.g. "no manual regional selection has been made for this project"). */
  unresolvedReason?: string;

  /** ISO timestamp — when this resolution ran (not when the underlying selection was made — see RegionalSelection.selectedAt for that). */
  resolvedAt: string;

  /** True only when the resolved profile actually has content to project — mirrors Blueprint's `contentAvailable` discipline. Always false when `selectionSource === 'none'`. */
  contentAvailable: boolean;
}
