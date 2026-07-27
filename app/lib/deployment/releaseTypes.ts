import type { ReleaseType } from '~/lib/deployment/semanticVersion';

/**
 * Release Model — Sprint 94 (Release Management & Customer Acceptance).
 *
 * A Release is the IMMUTABLE BASELINE a delivered application is measured from. Every future
 * change request, bug fix, enhancement and MVP2 feature compares against the latest Release, never
 * against the latest Deployment (Part 9) — which is exactly why this model is references-plus-
 * frozen-facts rather than a second copy of the delivery story.
 *
 * Part 1 audit — what already represents release information, and how each is treated here:
 *
 *   `Mvp.status = 'released'` / `releaseMvp()`  A PRODUCT-scope lifecycle: which MVP's scope is
 *                                              the live product. Deliberately NOT written by this
 *                                              domain — see `ReleaseBaseline.mvpId`'s comment.
 *   `Mvp.targetRelease`                         Free-text customer intent ("v1.0"). Used only to
 *                                              PREFILL the operator's version field; never
 *                                              authoritative, never persisted as the version.
 *   `Deployment.releasedAt`                     An existing, previously-unused column. Populated
 *                                              by the release transaction — no new column needed.
 *   Delivery Package (Sprint 93)                The full handover story. REFERENCED by id and used
 *                                              to derive release notes; never re-collected and
 *                                              never copied wholesale.
 *   Verification report (Sprint 92)             REFERENCED by id; its summary is frozen into the
 *                                              baseline so the release stays interpretable even if
 *                                              the deployment is later re-verified.
 *   Application Manifest / Blueprint / GitHub /
 *   Supabase / Vercel                           Frozen as identity + version references in
 *                                              `ReleaseBaseline`, which is the whole point of the
 *                                              baseline: those artifacts keep moving, the release
 *                                              must not.
 *
 * NO DUPLICATED INFORMATION (Part 2): where a fact lives in another domain and is still mutable,
 * this model stores the REFERENCE. Where a fact must survive that domain changing (a manifest
 * version, a commit, a verification outcome), it is FROZEN here on purpose, and the field's comment
 * says which of the two it is.
 */

export const RELEASE_MODEL_VERSION = '1.0.0';

/** `superseded` is set automatically when a newer release is created for the same deployment — the same "at most one live release" rule `releaseMvp` applies to MVPs. */
export type ReleaseStatus = 'released' | 'superseded';

/**
 * Part 5. Two axes deliberately kept in one field: whether the customer has responded, and what
 * they said. `accepted_with_conditions` is an acceptance (the release stands, with recorded
 * caveats); `needs_revision` is a rejection that expects another release rather than abandonment.
 *
 * Acceptance NEVER modifies an engineering artifact — no manifest, no feature, no deployment
 * status changes. It only moves this field and appends one history event.
 */
export type CustomerAcceptanceState =
  | 'pending'
  | 'accepted'
  | 'accepted_with_conditions'
  | 'needs_revision'
  | 'rejected';

export interface CustomerAcceptance {
  state: CustomerAcceptanceState;

  /** Who recorded the decision inside Builders — the operator acting on the customer's word, not a customer identity Builders holds. */
  recordedBy?: string;
  recordedAt?: string;

  /** The customer's own reason/conditions, as entered. Free text, never interpreted by any rule. */
  notes?: string;

  /** Conditions attached to an `accepted_with_conditions` decision. Empty for every other state. */
  conditions: string[];
}

// ── Release notes ───────────────────────────────────────────────────────────

/** Part 4 — every note category the generator can produce. Nothing is emitted without a real source. */
export type ReleaseNoteCategory =
  | 'new_features'
  | 'improvements'
  | 'bug_fixes'
  | 'infrastructure'
  | 'known_limitations'
  | 'future_scope';

export interface ReleaseNoteEntry {
  /** Stable within a release, so two releases' notes can be diffed. */
  id: string;
  title: string;
  detail?: string;

  /** Which artifact produced this line — shown so nothing in the notes looks like marketing copy. */
  source: string;
}

export interface ReleaseNotes {
  /** One or two sentences stating what this release is, built from counts, never adjectives. */
  summary: string;
  categories: Array<{ category: ReleaseNoteCategory; entries: ReleaseNoteEntry[] }>;

  /**
   * Part 2's "Breaking Changes". Always empty in this sprint and deliberately so: a breaking
   * change can only be derived by comparing this release against the previous BASELINE, which is
   * Sprint 95's change-management work. Emitting a guess here would be inventing an improvement,
   * which Part 4 forbids.
   */
  breakingChanges: ReleaseNoteEntry[];

  /**
   * Part 2's "Known Issues", distinct from Known Limitations: an issue is something that failed or
   * warned during verification; a limitation is something intentionally not delivered.
   */
  knownIssues: ReleaseNoteEntry[];
}

// ── Baseline ────────────────────────────────────────────────────────────────

/**
 * Parts 8/9 — the frozen references future work compares against. Every field is captured at
 * release time and never updated afterwards; that immutability is the entire value of a release.
 *
 * PREPARED, NOT IMPLEMENTED: nothing in this sprint consumes a baseline for comparison. Sprint 95
 * will read `getReleaseBaseline` and diff a new manifest/feature set against it — which is why the
 * checksums and version numbers are captured now, while they are still true.
 */
export interface ReleaseBaseline {
  capturedAt: string;

  deploymentId: string;
  projectId: string;

  /** The Application Manifest this release was built from. `planChecksum` is what a future diff compares against. */
  manifestId?: string;
  manifestVersion?: number;
  manifestPlanChecksum?: string;
  manifestSourceContentChecksum?: string;

  deliveryPackageId?: string;
  deliveryPackageNumber?: number;
  deliveryPackageVersion?: string;

  verificationId?: string;
  verificationNumber?: number;
  verificationStatus?: string;
  verificationPolicyVersion?: string;

  blueprintId?: string;

  /** `ProjectBlueprint.version` — absent for the still-hardcoded registry blueprints, which have no version. */
  blueprintVersion?: number;

  /**
   * The MVP whose scope this release delivers. RECORDED ONLY — this domain never writes
   * `builders_mvps`. Moving an MVP to `released` is `mvpRepository.releaseMvp`'s job (it also
   * auto-supersedes sibling MVPs), a Product-scope lifecycle decision that is deliberately not
   * bundled into a Deployment-scope transaction. See this sprint's report for the open question.
   */
  mvpId?: string;
  mvpCode?: string;

  repositoryFullName?: string;
  repositoryUrl?: string;
  branch?: string;

  /** The commit the released build came from, when Deployment History recorded one. */
  gitCommit?: string;

  /**
   * Part 2's "Git Tag (future)" — always undefined. Tagging is explicitly out of scope; the field
   * exists so a later sprint can populate it without a schema or model change.
   */
  gitTag?: string;

  supabaseProjectRef?: string;
  supabaseProjectUrl?: string;
  schemaVersion?: number;

  vercelProjectName?: string;
  vercelDeploymentId?: string;
  deploymentUrl?: string;
}

// ── Integrity ───────────────────────────────────────────────────────────────

export interface ReleaseIntegrityCheck {
  id: string;
  label: string;
  satisfied: boolean;
  detail: string;

  /** A required check that is unsatisfied blocks release creation outright (Part 14: never a partial Release). */
  required: boolean;
}

export interface ReleaseIntegrity {
  /** True only when every REQUIRED check is satisfied. */
  complete: boolean;
  checks: ReleaseIntegrityCheck[];

  /** A deterministic fingerprint of the frozen baseline, so tampering with a stored release is detectable. */
  checksum: string;
}

// ── The release ─────────────────────────────────────────────────────────────

/** One assembled release. Immutable once built — the service returns a frozen value. */
export interface Release {
  releaseNumber: number;
  semanticVersion: string;
  releaseName: string;
  releaseType: ReleaseType;
  releaseDate: string;
  releaseStatus: ReleaseStatus;

  baseline: ReleaseBaseline;
  releaseNotes: ReleaseNotes;
  customerAcceptance: CustomerAcceptance;
  integrity: ReleaseIntegrity;

  metadata: {
    modelVersion: string;
    createdBy?: string;

    /** The operator's stated intent, and whether the version they supplied actually matches it. */
    intendedType: ReleaseType;
    intentMatchesVersion: boolean;
    previousVersion?: string;
  };
}

/** A persisted release — a `builders_releases` row in application shape. */
export interface ReleaseRecord extends Release {
  id: string;
  deploymentId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  major: 'Major',
  minor: 'Minor',
  patch: 'Patch',
};

export const CUSTOMER_ACCEPTANCE_LABELS: Record<CustomerAcceptanceState, string> = {
  pending: 'Awaiting customer',
  accepted: 'Accepted',
  accepted_with_conditions: 'Accepted with conditions',
  needs_revision: 'Needs revision',
  rejected: 'Rejected',
};

export const RELEASE_NOTE_CATEGORY_LABELS: Record<ReleaseNoteCategory, string> = {
  new_features: 'New Features',
  improvements: 'Improvements',
  bug_fixes: 'Bug Fixes',
  infrastructure: 'Infrastructure',
  known_limitations: 'Known Limitations',
  future_scope: 'Future Scope',
};

/**
 * Part 11 — the canonical history event an acceptance decision produces. Five states map onto the
 * two events the brief defines: an acceptance (with or without conditions) is `customer_accepted`;
 * a rejection and a revision request are both `customer_rejected`, since both mean the customer
 * did not accept this release as delivered. The precise state is always recorded on the release
 * itself and in the event metadata, so nothing is lost by the narrower event vocabulary.
 */
export function acceptanceHistoryEvent(
  state: CustomerAcceptanceState,
): 'customer_accepted' | 'customer_rejected' | null {
  switch (state) {
    case 'accepted':
    case 'accepted_with_conditions':
      return 'customer_accepted';
    case 'rejected':
    case 'needs_revision':
      return 'customer_rejected';
    default:
      return null;
  }
}

export function isAcceptedState(state: CustomerAcceptanceState): boolean {
  return state === 'accepted' || state === 'accepted_with_conditions';
}
