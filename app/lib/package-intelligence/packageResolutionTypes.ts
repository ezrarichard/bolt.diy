import type { PackageCode } from './packageProfileTypes';

/**
 * Package Selection & Resolution types (Sprint 73, Package Intelligence Foundation).
 *
 * Mirrors the discipline of Regional Resolution (`app/lib/regional/regionalResolutionTypes.ts`)
 * without copying its append-only-history table design — see `packageResolutionService.ts`'s own
 * header comment for why a `Project`-level field is sufficient here.
 */

/**
 * The persisted shape of `Project.packageSelection` — a manual choice only. There is no
 * "recommended vs selected" pair to store the way Blueprint Resolution has, because this
 * foundation sprint has no automatic recommendation engine (PART "Out of Scope" explicitly rules
 * out an "AI package recommendation engine") — the only thing ever persisted is an explicit
 * choice.
 */
export interface PackageSelection {
  packageCode: PackageCode;

  /** ISO timestamp — when this manual selection was made or last changed. */
  selectedAt: string;
}

/**
 * Every source `resolveEffectivePackageSelection` could in principle report, matching PART 5 of
 * the Sprint 73 brief's suggested list exactly. **Only `'manual_override'` and `'none'` are
 * actually reachable in this foundation sprint** — the other sources are reserved for real
 * future signals that don't exist yet in this codebase:
 *
 * - `'manual_override'` — `Project.packageSelection` is set. Reachable today.
 * - `'project_selection'` — would mean a package was chosen at project-creation time through a
 *   dedicated creation-flow control. Reserved: no such creation-time control exists yet — see
 *   docs/package-intelligence/Package-Intelligence.md's "Known Limitations".
 * - `'business_discovery'` — would mean Business Discovery captured a structured package/tier
 *   field. Reserved: no such field exists on `ProjectKnowledge` (this sprint deliberately does
 *   not add one — see PART 4's "do not infer package from... package name found in free-text
 *   requirements").
 * - `'project_metadata'` — would mean a package was present in project metadata but NOT through
 *   the manual-override write path (e.g. a future bulk-import/programmatic set). Reserved: today
 *   the only writer of `Project.packageSelection` IS the manual-override path, so this value is
 *   never produced — kept in the union so a future writer doesn't need a type change.
 * - `'workspace_default'` — would mean an organization/workspace-level default package existed.
 *   Reserved: no workspace/organization concept exists in this codebase at all yet.
 * - `'system_default'` — would mean Builders assumed a package when none was selected. Reserved:
 *   current product behavior does not assume any package by default (PART 4: "Default package,
 *   only if current product behaviour already assumes one" — it does not).
 * - `'none'` — nothing resolved. Reachable today (the common case until a project sets one).
 */
export type PackageSelectionSource =
  | 'manual_override'
  | 'project_selection'
  | 'business_discovery'
  | 'project_metadata'
  | 'workspace_default'
  | 'system_default'
  | 'none';

/**
 * The result of resolving a project's effective Package Profile — always returned (never
 * `undefined`), matching `RegionalResolutionResult`'s own discipline. When nothing resolves,
 * `selectionSource` is `'none'` and every profile-identifying field is `null`.
 */
export interface PackageResolutionResult {
  packageProfileId: string | null;
  packageProfileCode: PackageCode | null;
  packageProfileVersion: number | null;
  selectionSource: PackageSelectionSource;

  /** The raw value the resolver read before mapping to a profile — e.g. the stored `packageCode` string. Null when nothing was found. */
  sourceValue: string | null;

  /** Set only when `selectionSource` is `'none'` — a short, human-readable reason. */
  unresolvedReason?: string;

  /** ISO timestamp — when this resolution ran. */
  resolvedAt: string;

  /** True only when the resolved profile actually has content to project. Always false when `selectionSource === 'none'`. */
  contentAvailable: boolean;
}
