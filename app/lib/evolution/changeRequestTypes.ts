/**
 * Change Request Model — Sprint 95, Part 2 (Product Evolution Engine).
 *
 * A Change Request is a CUSTOMER'S ASK against an already-released product. It is deliberately not
 * an engineering artifact: nothing here plans, generates or modifies anything, and creating one
 * never touches a Release, a Manifest, a Deployment or any generated file. It is the input to
 * impact analysis, and analysis is the input to an Evolution Plan — which is where this sprint
 * stops (no code generation, no MVP2).
 *
 * Part 1 audit — what a request is measured AGAINST is already fully described elsewhere and is
 * never copied into this model:
 *
 *   `ReleaseBaseline` (Sprint 94)   The immutable frozen references — manifest version + plan
 *                                   checksum, delivery package, verification, blueprint, MVP,
 *                                   repo/commit, database ref + schema version, deployment URL.
 *                                   THE baseline. A request carries only `releaseId`.
 *   Delivery Package (Sprint 93)    Feature inventory, known limitations, routes, environment
 *                                   variables, required services, documentation index.
 *   Application Manifest            The planned/generated file set, categories, component names,
 *                                   per-file feature ownership.
 *   Database Activation             Generated schema SQL, from which table names are read.
 *   Verification report (Sprint 92) Which live checks cover which routes/assets.
 *
 * `evolutionBaseline.ts` assembles exactly those into one snapshot; this file holds only what the
 * CUSTOMER supplied.
 */

/**
 * A request's own lifecycle. `analyzed` means an impact analysis exists; `planned` means an
 * Evolution Plan exists. Neither implies any engineering has started — that is Sprint 96's work.
 */
export type ChangeRequestStatus = 'draft' | 'submitted' | 'analyzed' | 'planned' | 'cancelled';

export type ChangeRequestPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Part 5's classification vocabulary. A request carries whichever category the operator DECLARED
 * (often `unknown`); `changeClassification.ts` infers one when they didn't, and always records
 * which of the two happened.
 */
export type ChangeCategory =
  | 'bug_fix'
  | 'small_enhancement'
  | 'feature_addition'
  | 'workflow_change'
  | 'ui_improvement'
  | 'performance'
  | 'security'
  | 'compliance'
  | 'infrastructure'
  | 'major_expansion'
  | 'unknown';

/** Part 2's "Affected Areas" — the operator's own declaration, which always outranks inference. */
export type ChangeArea =
  | 'ui'
  | 'backend'
  | 'database'
  | 'api'
  | 'authentication'
  | 'environment'
  | 'infrastructure'
  | 'documentation'
  | 'testing'
  | 'content';

/** Part 2's "Scope" — how broad the customer believes this is. Never inferred into; analysis reports its own breadth separately. */
export type ChangeScope = 'unknown' | 'single_feature' | 'multi_feature' | 'cross_cutting';

export interface ChangeRequestDraft {
  projectId: string;
  deploymentId: string;

  /** The release this request is raised against. Absent only when the project has never released. */
  releaseId?: string;
  releaseVersion?: string;

  title: string;
  description: string;
  businessReason?: string;
  priority: ChangeRequestPriority;

  /** `unknown` is the honest default — the operator is not forced to classify. */
  category: ChangeCategory;
  scope: ChangeScope;
  declaredAreas: ChangeArea[];
  requestedBy?: string;
  notes?: string;
}

export interface ChangeRequest extends ChangeRequestDraft {
  id: string;

  /** 1-based per deployment, in creation order. */
  requestNumber: number;
  status: ChangeRequestStatus;
  requestedAt: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export const CHANGE_CATEGORY_LABELS: Record<ChangeCategory, string> = {
  bug_fix: 'Bug Fix',
  small_enhancement: 'Small Enhancement',
  feature_addition: 'Feature Addition',
  workflow_change: 'Workflow Change',
  ui_improvement: 'UI Improvement',
  performance: 'Performance',
  security: 'Security',
  compliance: 'Compliance',
  infrastructure: 'Infrastructure',
  major_expansion: 'Major Product Expansion',
  unknown: 'Unclassified',
};

export const CHANGE_AREA_LABELS: Record<ChangeArea, string> = {
  ui: 'User interface',
  backend: 'Backend',
  database: 'Database',
  api: 'API',
  authentication: 'Authentication',
  environment: 'Environment configuration',
  infrastructure: 'Infrastructure',
  documentation: 'Documentation',
  testing: 'Testing',
  content: 'Content',
};

export const CHANGE_PRIORITY_LABELS: Record<ChangeRequestPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const CHANGE_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  analyzed: 'Analyzed',
  planned: 'Planned',
  cancelled: 'Cancelled',
};

export type ChangeRequestValidationCode = 'missing_title' | 'missing_description' | 'no_release';

export type ChangeRequestValidation = { ok: true } | { ok: false; code: ChangeRequestValidationCode; message: string };

/**
 * Part 15 — the one gate a request passes before persistence. A request against a product that was
 * never released is refused outright: there is no baseline to analyse it against, and an analysis
 * with nothing to compare to would be a guess dressed as a finding.
 */
export function validateChangeRequest(draft: Partial<ChangeRequestDraft>): ChangeRequestValidation {
  if (!draft.title?.trim()) {
    return { ok: false, code: 'missing_title', message: 'Give this change request a title.' };
  }

  if (!draft.description?.trim()) {
    return {
      ok: false,
      code: 'missing_description',
      message: 'Describe the change — impact analysis reads this text against the released baseline.',
    };
  }

  if (!draft.releaseId) {
    return {
      ok: false,
      code: 'no_release',
      message: 'This product has not been released yet, so there is no baseline to evolve from.',
    };
  }

  return { ok: true };
}
