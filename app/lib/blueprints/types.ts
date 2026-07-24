/**
 * Blueprint Engine — types.
 *
 * All blueprint-related interfaces live here so registry.ts and engine.ts
 * (and anything future) share one definition. Nothing in this file has
 * behavior; it's pure shape.
 */

export type BlueprintCategory = 'General' | 'Website' | 'Commerce' | 'AI' | 'SaaS' | 'Mobile';

export interface ProjectBlueprint {
  id: string;
  name: string;
  icon: string;
  description: string;

  /** Human-readable grouping shown in the UI, e.g. "Website", "Commerce". */
  category: BlueprintCategory;

  /** Short label for what kind of product this is, e.g. "Marketing / Service Website". */
  productType?: string;

  /** Suggested (not applied) technologies for this kind of product. */
  recommendedStack?: string[];

  /** Suggested (not connected) integrations for this kind of product. */
  recommendedIntegrations?: string[];

  /** Suggested first steps once the project exists — display only. */
  recommendedNextSteps?: string[];

  /** Who this blueprint is aimed at, e.g. "Local shop owners", "MSMEs". */
  targetUsers?: string;

  /** Default project status label shown until real status tracking exists. */
  defaultStatus?: string;

  /**
   * Sprint 8 — the structured Project Roadmap shown in the Project
   * Dashboard, replacing the plain-text `recommendedNextSteps` list.
   * `recommendedNextSteps` is kept as-is for backward compatibility (still
   * typed, still populated in the registry) — `roadmap` is the richer,
   * status-aware source of truth going forward. Display only; nothing here
   * generates code, starts a chat, or provisions anything.
   */
  roadmap?: RoadmapItem[];

  enabled: boolean;
  comingSoon?: boolean;

  /*
   * ----------------------------------------------------------------------
   * Sprint 59 — Blueprint Foundation. Extensibility fields for the future
   * Blueprint Engine (Industry Detection, Regional Overlays, Package
   * Levels, Blueprint Studio — see the approved Blueprint Architecture
   * Proposal). All optional, all unpopulated/unread by anything today:
   * every existing call site keeps working unchanged whether or not these
   * are present. Nothing in this sprint injects any of this into an AI
   * role's context or prompt.
   * ----------------------------------------------------------------------
   */

  /** Reserved for Industry Detection (later sprint) — e.g. "Dental Clinic", "Restaurant". */
  industry?: string;

  /** Base -> Industry -> Regional hierarchy (later sprint). The BuildersDB row id of this blueprint's parent, if any. */
  parentBlueprintId?: string;

  /** BuildersDB versioning — see blueprintRepository.ts. Absent for the still-hardcoded registry fallback. */
  version?: number;

  /** BuildersDB lifecycle state. Absent for the still-hardcoded registry fallback, which is always implicitly "active". */
  status?: 'draft' | 'active' | 'deprecated';

  /** Free-form extensibility bag for future blueprint-intelligence fields (package tiers, confidence inputs, ...) — empty/absent and unread today. */
  metadata?: Record<string, unknown>;

  /**
   * Structured Blueprint Content (Standard Workflows, Business Rules, Pages & Screens, QA
   * Scenarios, AI Role Guidance, ...) per the Blueprint Architecture Proposal — empty/absent
   * and unread by any AI role today. Populating and consuming this is later-sprint work.
   */
  content?: Record<string, unknown>;
}

/**
 * Sprint 8 — one step in a blueprint's Project Roadmap.
 *
 * `key` is a stable, blueprint-scoped identifier (e.g. "requirements",
 * "homepage") used to store this step's status on the project itself —
 * see `Project.roadmapStatus` in app/lib/stores/projects.ts. The blueprint
 * only ever supplies the step's static content (title/description); it
 * never carries per-project status.
 */
export interface RoadmapItem {
  key: string;
  title: string;
  description: string;
}

/**
 * Sprint 8 — status of a single roadmap item for a specific project.
 * Stored locally only (project.roadmapStatus), no backend.
 */
export type RoadmapItemStatus = 'not-started' | 'in-progress' | 'completed' | 'blocked';

/**
 * A blueprint's recommendation surface grouped together — used by
 * blueprintEngine when a caller wants stack/integrations/nextSteps as one
 * bundle rather than three separate calls.
 */
export interface BlueprintRecommendation {
  stack: string[];
  integrations: string[];
  nextSteps: string[];
}

/*
 * ------------------------------------------------------------------------
 * Future placeholder types (Sprint 6+).
 *
 * Nothing implements behavior against these yet. They exist only so the
 * placeholder methods in engine.ts have a real contract to type their
 * (currently empty/undefined) return values against, so a future sprint
 * can fill in logic without another type rewrite.
 * ----------------------------------------------------------------------
 */

/** Future: an AI system prompt associated with a blueprint. Not implemented. */
export interface BlueprintSystemPrompt {
  prompt: string;
}

/** Future: a starter template/scaffold reference for a blueprint. Not implemented. */
export interface BlueprintStarterTemplate {
  id: string;
  githubRepo?: string;
}

/** Future: one suggested environment variable for a blueprint. Not implemented. */
export interface BlueprintSuggestedEnvironmentVariable {
  key: string;
  description?: string;
  required?: boolean;
}

/**
 * India-first payment providers a future blueprint recommendation may
 * suggest. Stripe is intentionally excluded from this platform's defaults —
 * see the note above `getSuggestedEnvironmentVariables` in engine.ts.
 */
export type SuggestedPaymentProvider = 'razorpay' | 'upi' | 'phonepe' | 'paytm' | 'cashfree';
