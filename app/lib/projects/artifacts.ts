/**
 * Project Artifacts — Sprint 11, extended Sprint 13 (first real AI output).
 *
 * The output-shaped record an AI generation step populates for a task (a
 * generated requirements draft, a database schema, a config file, etc.) —
 * see app/lib/projects/executionEngine.ts and app/lib/projects/taskEngine.ts
 * for the task lifecycle this attaches to.
 *
 * Sprint 11/12 only ever created empty placeholders (`content: ''`,
 * `status: 'placeholder'`) on task approval. Sprint 13 adds the first real
 * content producer (app/lib/projects/businessAnalystEngine.ts) via
 * `createArtifact` below — the same generic shape (`type` is a free-text
 * label, `content` is always a string regardless of whether it holds
 * markdown, JSON, or SQL) is designed to be reused unchanged by every
 * future AI role (Solution Architect, Database Designer, UI Designer,
 * Backend Engineer): only the `type`/`generatedBy` values and the content
 * format differ.
 */

export type ProjectArtifactStatus = 'placeholder' | 'draft' | 'approved' | 'discarded' | 'final';

export interface ProjectArtifact {
  id: string;
  taskId: string;
  title: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectArtifactStatus;
  content: string;

  /** Sprint 13 — which AI role produced this artifact, e.g. "AI Business Analyst". Undefined for the empty placeholders created on task approval. */
  generatedBy?: string;

  /** Sprint 13 — regeneration counter, starting at 1. Undefined for the empty placeholders created on task approval. */
  version?: number;

  /**
   * Sprint 78 Phase 0 — which MVP this artifact belongs to (Sprint 77 recommendation #1). The
   * `builders_role_outputs.mvp_id` column has existed since Sprint 45
   * (supabase/migrations/20260720100000_mvp_foundation.sql) but nothing populated or read it back
   * until now — see `app/lib/stores/projects.ts`'s `addProjectArtifact`/`updateProjectArtifact`
   * (the write side) and `app/lib/builders-db/buildersDbTypes.ts`'s `fromRoleOutputRow` (the read
   * side). Undefined for project-level artifact types (Requirements, Product Vision) and for
   * every artifact created before this field existed — never backfilled, never required.
   */
  mvpId?: string;
}

/** Builds an empty placeholder artifact for a task. Content is always '' — nothing generates real output yet. */
export function createPlaceholderArtifact(taskId: string, title: string, type: string): ProjectArtifact {
  const now = new Date().toISOString();

  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    title,
    type,
    createdAt: now,
    updatedAt: now,
    status: 'placeholder',
    content: '',
  };
}

/**
 * Sprint 13 — builds an artifact that already holds real (AI-generated)
 * content, as opposed to createPlaceholderArtifact's empty stub. Generic
 * over `type`/`generatedBy` so every future AI role can create its own
 * artifacts through this same constructor.
 */
export function createArtifact(input: {
  taskId: string;
  title: string;
  type: string;
  content: string;
  status: ProjectArtifactStatus;
  generatedBy: string;
  version: number;
}): ProjectArtifact {
  const now = new Date().toISOString();

  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId: input.taskId,
    title: input.title,
    type: input.type,
    createdAt: now,
    updatedAt: now,
    status: input.status,
    content: input.content,
    generatedBy: input.generatedBy,
    version: input.version,
  };
}

/**
 * Sprint 14 — canonical artifact `type` values for every AI-role draft, so
 * no engine/component hand-types the string more than once. Add one entry
 * here per future AI role (Database Designer, UI Designer, Backend
 * Engineer, ...).
 */
export const ARTIFACT_TYPES = {
  REQUIREMENTS_DRAFT: 'requirements-draft',

  /** Sprint 46B — the AI Product Owner's output. Product Planning phase, not Engineering — sits between Requirements and Architecture. See app/lib/projects/productOwnerEngine.ts. */
  PRODUCT_OWNER_DRAFT: 'product-owner-draft',
  ARCHITECTURE_DRAFT: 'architecture-draft',

  /**
   * Sprint 100B — the Solution Architect's machine-readable counterpart to
   * ARCHITECTURE_DRAFT above, produced by the same LLM call but persisted as its
   * own first-class artifact (see app/lib/technical-architecture/tasTypes.ts's
   * `TechnicalArchitectureSpecification`) so the Application Generator and the
   * downstream engineering roles never have to re-interpret the narrative
   * draft's prose — or, as today, never receive its decisions at all. Kept in
   * lockstep with ARCHITECTURE_DRAFT by solutionArchitectEngine.ts +
   * useDraftPanel.ts's `pairedArtifactType` — same version number,
   * approved/discarded/resumed together, never independently. Deliberately the
   * exact DATABASE_DRAFT/DATABASE_SCHEMA pattern below.
   *
   * NOTHING CONSUMES THIS YET. Sprint 100B produces and persists it only; wiring
   * it into downstream roles and the generator is Sprint 100C. Its absence is
   * always valid — every project created before Sprint 100B has an
   * ARCHITECTURE_DRAFT and no TAS, and must keep working exactly as it does.
   */
  TECHNICAL_ARCHITECTURE_SPEC: 'technical-architecture',
  DATABASE_DRAFT: 'database-draft',

  /**
   * Sprint 75 — the Database Engineer's machine-readable counterpart to
   * DATABASE_DRAFT above, produced by the same LLM call but persisted as its
   * own first-class artifact (see app/lib/database-activation/schemaTypes.ts's
   * `StructuredDatabaseSchema`) so SQL generation/validation/provisioning
   * never has to re-interpret the narrative draft's prose. Kept in lockstep
   * with DATABASE_DRAFT by databaseDesignerEngine.ts + useDraftPanel.ts's
   * `pairedArtifactType` — same version number, approved/discarded/resumed
   * together, never independently.
   */
  DATABASE_SCHEMA: 'database-schema',
  UIUX_DRAFT: 'uiux-draft',
  BACKEND_DRAFT: 'backend-draft',
  FRONTEND_DRAFT: 'frontend-draft',
  QA_DRAFT: 'qa-draft',
  DEVOPS_DRAFT: 'devops-draft',

  /**
   * Sprint 82 polish — the Business Analyst's Product Review output, persisted as a normal
   * artifact (markdown/JSON viewing, version history, export, AI context reuse, timeline
   * consistency — same infrastructure every other role's draft already gets) in addition to the
   * curated `ProductReview` domain row (`app/lib/product-review/`). The `ProductReview` row is
   * the domain object (status lifecycle, queryable fields); this artifact is the AI-generated
   * document itself, linked back via `ProductReview.artifactId`. See
   * app/lib/projects/productReviewEngine.ts's `completeAnalysis`.
   */
  PRODUCT_REVIEW_ANALYSIS: 'product-review-analysis',

  /**
   * Sprint 83 — the AI Product Owner's Roadmap Review output, persisted as a normal artifact,
   * same reasoning as `PRODUCT_REVIEW_ANALYSIS` above: the curated `RoadmapReview` domain row
   * (`app/lib/roadmap-review/`) is the queryable/lifecycle-tracked object, this artifact is the
   * AI-generated document itself, linked back via `RoadmapReview.artifactId`. See
   * app/lib/projects/roadmapReviewEngine.ts's `completePlanning`.
   */
  ROADMAP_REVIEW_ANALYSIS: 'roadmap-review-analysis',

  /**
   * Sprint 100G — the Architecture Conformance Report, produced after a successful generation by
   * comparing the approved TECHNICAL_ARCHITECTURE_SPEC against the files that were actually
   * generated (see app/lib/architecture-conformance/).
   *
   * A normal artifact, deliberately: it gets version history, JSON/Markdown viewing, export and
   * timeline consistency for free, and Sprint 100G's brief asked for no parallel reporting system
   * where an existing pattern fits. Same engine-written shape as PRODUCT_REVIEW_ANALYSIS and
   * ROADMAP_REVIEW_ANALYSIS above — it has no `canGenerate` gate, no place in
   * AUTO_ENGINEERING_ROLES, and is never produced by an AI call.
   *
   * ADVISORY. Its content never blocks or fails a generation; a run that produces violations still
   * completes. Written at status 'final' because there is nothing for a human to approve — it is a
   * measurement, not a proposal.
   */
  ARCHITECTURE_CONFORMANCE_REPORT: 'architecture-conformance-report',
} as const;

/**
 * Sprint 14 — shared by every "*DraftPanel" component (RequirementsDraftPanel,
 * ArchitectureDraftPanel, and future AI-role panels) so "which artifact of
 * this type is the current one" is answered exactly once. Ties break toward
 * the higher version.
 */
export function getLatestArtifact(artifacts: ProjectArtifact[], type: string): ProjectArtifact | undefined {
  const matching = artifacts.filter((artifact) => artifact.type === type);

  if (matching.length === 0) {
    return undefined;
  }

  return matching.reduce((latest, candidate) =>
    (candidate.version ?? 0) > (latest.version ?? 0) ? candidate : latest,
  );
}

/**
 * Sprint 75 — finds the artifact of `type` at an exact `version`, used to
 * look up a paired artifact (e.g. DATABASE_SCHEMA) that must match the
 * primary artifact's (e.g. DATABASE_DRAFT) version exactly, rather than
 * "whichever is numerically latest" (getLatestArtifact) which could drift if
 * the two ever got out of sync.
 */
export function getArtifactByVersion(
  artifacts: ProjectArtifact[],
  type: string,
  version: number,
): ProjectArtifact | undefined {
  return artifacts.find((artifact) => artifact.type === type && artifact.version === version);
}

/** Sprint 14 — parses an artifact's JSON `content` back into its draft shape. Returns undefined rather than throwing on malformed content. */
export function parseArtifactContent<T>(content: string): T | undefined {
  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

/**
 * Sprint 46.1 — live-verified hydration bugfix. `getLatestArtifact` above answers "which
 * version is numerically newest," not "which version is actually approved" — those used to be
 * the same question because the pre-hydration local array only ever held ONE entry per role
 * (`updateProjectArtifact` always overwrote the same array slot in place, so a role's entry was
 * always whatever the most recent operation left it as). BuildersDB-hydrated arrays (see
 * `hydrateProjectData` in app/lib/stores/projects.ts) can legitimately contain several rows for
 * one role — a version once approved, later manually regenerated (useDraftPanel.ts's
 * `runGeneration`, which reuses the SAME artifact id across versions) and left as a pending
 * draft or discarded — and `getLatestArtifact`'s version-only comparison has no way to tell
 * that apart from a genuinely newer approved version. This is approval-aware instead: it never
 * returns a draft/discarded/placeholder entry, no matter how high its version number is, and
 * is what `getNextAutoRole`/`isAutoEngineeringComplete`
 * (app/lib/projects/autoEngineeringEngine.ts) use to decide whether a role is actually done.
 */
export function getLatestApprovedArtifact(artifacts: ProjectArtifact[], type: string): ProjectArtifact | undefined {
  const approved = artifacts.filter((artifact) => artifact.type === type && artifact.status === 'approved');

  if (approved.length === 0) {
    return undefined;
  }

  return approved.reduce((latest, candidate) => {
    const latestVersion = latest.version ?? 0;
    const candidateVersion = candidate.version ?? 0;

    if (candidateVersion !== latestVersion) {
      return candidateVersion > latestVersion ? candidate : latest;
    }

    return new Date(candidate.updatedAt).getTime() > new Date(latest.updatedAt).getTime() ? candidate : latest;
  });
}

/**
 * Sprint 46.1 — the artifact a "*DraftPanel" should treat as "current": the true latest
 * version, UNLESS it was discarded, in which case this falls back to the latest APPROVED
 * version instead of dead-ending on "nothing here, generate from scratch." An abandoned
 * regenerate-then-discard on a role that was previously approved must not make that earlier
 * approved output disappear from the UI — see useDraftPanel.ts and AIEngineeringTeamPanel.tsx,
 * the only callers. A genuinely pending (not yet discarded) draft is left untouched here —
 * that's still real, unfinished human review work, not something to paper over.
 */
export function getResumableArtifact(artifacts: ProjectArtifact[], type: string): ProjectArtifact | undefined {
  const latest = getLatestArtifact(artifacts, type);

  if (latest && latest.status !== 'discarded') {
    return latest;
  }

  return getLatestApprovedArtifact(artifacts, type) ?? latest;
}

/**
 * Sprint 16 — "read the latest artifact of `type`, but only if it's been
 * approved" — the exact check every gated AI role needs before it can run
 * (Database Designer gating on an approved Architecture Draft, UI/UX
 * Designer gating on an approved Database Design Draft, and future roles
 * gating on whichever draft precedes them). Extracted out of
 * databaseDesignerEngine.ts so it's defined once rather than re-implemented
 * per engine. Returns undefined for "doesn't exist yet", "still a draft",
 * and "discarded" alike — callers only care about the approved case.
 *
 * Sprint 46.1 — now backed by `getLatestApprovedArtifact` rather than
 * `getLatestArtifact` + a status check, so a role that's genuinely approved doesn't lose its
 * gating content just because a newer, still-pending or discarded regenerate attempt also
 * exists for the same role (see that function's comment for why the two used to differ).
 */
export function getApprovedArtifactContent<T>(artifacts: ProjectArtifact[], type: string): T | undefined {
  const approved = getLatestApprovedArtifact(artifacts, type);

  if (!approved) {
    return undefined;
  }

  return parseArtifactContent<T>(approved.content);
}

/** Sprint 14 — shared timestamp formatting for artifact status lines. */
export function formatArtifactTimestamp(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString();
}

/** Sprint 14 — shared badge styling for an AI draft artifact's review status, used by every "*DraftPanel" component. */
export const ARTIFACT_STATUS_META: Record<'draft' | 'approved' | 'discarded', { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'text-purple-600 dark:text-purple-400 border-purple-500/30 bg-purple-500/10' },
  approved: {
    label: 'Approved',
    className: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10',
  },
  discarded: {
    label: 'Discarded',
    className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
  },
};
