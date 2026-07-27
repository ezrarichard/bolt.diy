/**
 * Semantic Versioning — Sprint 94, Part 3.
 *
 * Part 1 audit: nothing in this codebase parses or compares versions. The closest existing things
 * are `Mvp.targetRelease` (customer-editable free text like "v1.0" — an intention, never an
 * applied version) and `ApplicationManifest.version` (a monotonic integer for manifest revisions,
 * a completely different counter). So this module is genuinely new, and deliberately tiny — no
 * `semver` dependency is installed and a full range/pre-release resolver is not needed to version
 * a release.
 *
 * THE CENTRAL RULE (Part 3): versions are NEVER incremented automatically. `suggestNextVersion`
 * exists only to prefill the operator's form, and it requires an explicit release TYPE to do even
 * that. Nothing anywhere calls it as part of creating a release — `releaseManagementService`
 * requires a version the operator actually supplied, and `validateReleaseVersion` is what stands
 * between that input and a persisted release.
 */

export type ReleaseType = 'major' | 'minor' | 'patch';

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Strict `X.Y.Z`, optionally written with a leading `v`. No pre-release or build metadata — a release that needs those is not something this sprint models. */
const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemanticVersion(raw: string | undefined | null): SemanticVersion | null {
  if (!raw) {
    return null;
  }

  const match = SEMVER_PATTERN.exec(raw.trim());

  if (!match) {
    return null;
  }

  const [major, minor, patch] = match.slice(1, 4).map((part) => Number(part));

  if ([major, minor, patch].some((part) => !Number.isSafeInteger(part) || part < 0)) {
    return null;
  }

  return { major, minor, patch };
}

export function formatSemanticVersion(version: SemanticVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Negative when `a < b`, positive when `a > b`, zero when equal. */
export function compareSemanticVersions(a: SemanticVersion, b: SemanticVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * The version an operator would MOST LIKELY want next — shown as a prefilled default, never
 * applied on its own. `previous` being absent means this is the project's first release, which
 * always suggests `1.0.0` regardless of type: a first release is not a "patch to nothing".
 */
export function suggestNextVersion(previous: string | undefined | null, type: ReleaseType): string {
  const parsed = parseSemanticVersion(previous);

  if (!parsed) {
    return '1.0.0';
  }

  switch (type) {
    case 'major':
      return formatSemanticVersion({ major: parsed.major + 1, minor: 0, patch: 0 });
    case 'minor':
      return formatSemanticVersion({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
    default:
      return formatSemanticVersion({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 });
  }
}

/**
 * Which release type a proposed version actually represents relative to the previous one. Used to
 * warn when the operator's stated intent and their typed version disagree — the version they typed
 * still wins (explicit intent is the rule), they are simply told what it really is.
 */
export function classifyVersionChange(previous: string | undefined | null, next: string): ReleaseType | null {
  const from = parseSemanticVersion(previous);
  const to = parseSemanticVersion(next);

  if (!to) {
    return null;
  }

  if (!from) {
    return 'major';
  }

  if (to.major > from.major) {
    return 'major';
  }

  if (to.major === from.major && to.minor > from.minor) {
    return 'minor';
  }

  if (to.major === from.major && to.minor === from.minor && to.patch > from.patch) {
    return 'patch';
  }

  return null;
}

export type VersionRejectionCode = 'missing' | 'malformed' | 'not_greater' | 'duplicate';

export type VersionValidationResult =
  | { ok: true; version: string; parsed: SemanticVersion; actualType: ReleaseType; matchesIntent: boolean }
  | { ok: false; code: VersionRejectionCode; message: string };

/**
 * Part 3/Part 14 — the one gate every persisted version passes through. Rejects a missing or
 * malformed version, a version that does not move forward from the previous release, and any
 * version already used by an existing release of this deployment (the database's own
 * `unique (deployment_id, semantic_version)` enforces that too; this check exists so the operator
 * gets a sentence instead of a constraint violation).
 */
export function validateReleaseVersion(params: {
  version: string;
  intendedType: ReleaseType;
  previousVersion?: string;
  existingVersions?: string[];
}): VersionValidationResult {
  const raw = params.version?.trim();

  if (!raw) {
    return { ok: false, code: 'missing', message: 'Enter a semantic version for this release (for example 1.0.0).' };
  }

  const parsed = parseSemanticVersion(raw);

  if (!parsed) {
    return {
      ok: false,
      code: 'malformed',
      message: `"${raw}" is not a valid semantic version — use MAJOR.MINOR.PATCH, for example 1.2.0.`,
    };
  }

  const normalised = formatSemanticVersion(parsed);

  if ((params.existingVersions ?? []).some((existing) => existing.trim() === normalised)) {
    return {
      ok: false,
      code: 'duplicate',
      message: `Version ${normalised} has already been released for this deployment.`,
    };
  }

  const actualType = classifyVersionChange(params.previousVersion, normalised);

  if (!actualType) {
    return {
      ok: false,
      code: 'not_greater',
      message: `Version ${normalised} must be greater than the previous release (${params.previousVersion}).`,
    };
  }

  return { ok: true, version: normalised, parsed, actualType, matchesIntent: actualType === params.intendedType };
}
