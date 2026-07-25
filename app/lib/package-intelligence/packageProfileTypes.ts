/**
 * Package Intelligence — Package Profile model (Sprint 73, Package Intelligence Foundation).
 *
 * A `PackageProfile` answers "how deeply and robustly should already-approved product scope be
 * implemented?" — it never answers "what additional product features should be added?" (see
 * this file's own `PackageProfile.sourceMetadata.disclaimer`, every guidance array's own wording
 * discipline, and `exclusions` below, all enforced by `packageProfileRegistry.spec.ts`).
 * Deliberately a SEPARATE system from Blueprint Intelligence (`app/lib/blueprints/`) and Regional
 * Intelligence (`app/lib/regional/`) — a Blueprint answers "what does this kind of product
 * typically need," a Regional Profile answers "how does this market expect that product to
 * behave," and a Package Profile answers "how mature and robust should the implementation be."
 * All three are combined at the context-provider layer
 * (`app/lib/ai/context/buildersDbContextProvider.ts`) as clearly separate sections, never merged.
 *
 * Also unrelated to `ProductPackage` (`app/lib/product-assembly/assemblyTypes.ts`, Sprint 37) —
 * that "package" is a generated deliverable bundle (every approved role output assembled into
 * files); this "package" is a delivery-maturity tier (Starter/Professional/Premium). Two
 * different, pre-existing uses of the word "package" in this codebase; no relationship between
 * them, no shared code, no renaming of either (see docs/package-intelligence/Package-Intelligence.md's
 * "Known Limitations" for this naming note).
 *
 * Modeled on `RegionalProfile`'s own design principles (`regionalProfileTypes.ts`): every
 * guidance field is optional except the small identity core, so a sparse or future profile never
 * breaks. Deliberately a SMALL, coherent model — fields were added only where the Sprint 73
 * brief's three seed packages (Starter, Professional, Premium) actually needed them.
 */

/** The initial supported package codes (Sprint 73). Adding a new package means adding a code here and a matching profile in `packageProfileRegistry.ts`; no other file needs to change. */
export type PackageCode = 'STARTER' | 'PROFESSIONAL' | 'PREMIUM';

export type PackageProfileStatus = 'active' | 'deprecated';

/**
 * `sourceMetadata` is provenance/safety metadata about the PROFILE CONTENT itself — when it was
 * last reviewed and the standing scope-control disclaimer every consumer of this profile must
 * carry forward. Never commercial pricing metadata (see PART "Out of Scope" — no pricing claims
 * belong in a Package Profile).
 */
export interface PackageProfileSourceMetadata {
  /** ISO date string — when this profile's guidance text was last reviewed for accuracy. */
  lastReviewed: string;

  /**
   * The standing disclaimer every formatted guidance section must include verbatim or in
   * substance — Package Guidance adapts implementation depth, never authorizes new features,
   * integrations, roles, or infrastructure beyond approved upstream scope.
   */
  disclaimer: string;
}

/**
 * The full structured content shape for one Package Profile. Every guidance field beyond the
 * identity core is optional — a profile is never required to fill guidance it doesn't yet have
 * well-reviewed content for (same "never invent missing content" discipline `RegionalProfile`
 * and `BlueprintContent` both document).
 */
export interface PackageProfile {
  /** Stable id, e.g. "package-starter" — never reused even if a profile is later deprecated. */
  id: string;

  code: PackageCode;
  name: string;

  /** One sentence describing who/what this package is positioned for — read by the Business/Product family. */
  deliveryPositioning: string;

  /** Content version — bump when this profile's guidance text meaningfully changes. */
  version: number;

  status: PackageProfileStatus;

  /** Structural guidance on architecture depth/modularity expected at this package level — never a specific technology mandate (e.g. never "use microservices"). */
  architectureGuidance?: string[];

  /** Security-depth guidance — always proportional to approved scope, never an instruction to add authentication/authorization/roles that aren't already approved. */
  securityGuidance?: string[];

  /** Testing-depth guidance (unit/integration/critical-path/regression coverage expectations). */
  testingGuidance?: string[];

  /** Performance-expectation guidance — proportional, never speculative capacity planning for unapproved scale. */
  performanceGuidance?: string[];

  /** Scalability guidance — explicitly proportional to justified/approved demand, never automatic (e.g. never "use Kubernetes"). */
  scalabilityGuidance?: string[];

  /** Observability/monitoring/error-reporting depth guidance. */
  observabilityGuidance?: string[];

  /** Deployment-maturity guidance (environment separation, release process) — never a specific infrastructure mandate. */
  deploymentGuidance?: string[];

  /** Backup/recovery-planning depth guidance. */
  backupRecoveryGuidance?: string[];

  /** Documentation-depth guidance. */
  documentationGuidance?: string[];

  /** Maintainability guidance (code organization, technical-debt discipline). */
  maintainabilityGuidance?: string[];

  /** Operational-support-expectation guidance — never a commitment to a specific SLA/response time. */
  supportGuidance?: string[];

  /** Integration-resilience guidance (retry/error-handling depth) — only relevant where integrations are already approved. */
  integrationGuidance?: string[];

  /** Data-governance/lifecycle guidance — only relevant where data handling is already approved. */
  dataGovernanceGuidance?: string[];

  /** UI-polish/accessibility/responsive-coverage depth guidance — read by the Design/Quality family. */
  uiQualityGuidance?: string[];

  /** QA exit-criteria depth guidance — read by the Design/Quality family. */
  qaExitCriteria?: string[];

  /**
   * Explicit list of capabilities this package's guidance must NOT be read as authorizing (e.g.
   * "does not add authentication," "does not add multi-tenancy") — enforced by every format
   * function's scope-control paragraph and scanned by `packageProfileRegistry.spec.ts`.
   */
  exclusions: string[];

  /**
   * The shared minimum-quality baseline every package — including Starter — must meet (PART 16
   * of the Sprint 73 brief). Identical across all three seed profiles by design (see
   * `PACKAGE_QUALITY_FLOOR` in `packageProfileRegistry.ts`) so "every package includes the
   * minimum quality floor" is a structural guarantee, not a per-profile judgment call.
   */
  qualityFloor: string[];

  sourceMetadata: PackageProfileSourceMetadata;
}

/**
 * Every section key a role-family projection may draw from, excluding the identity core
 * (`id`/`code`/`name`/`deliveryPositioning`/`version`/`status`/`exclusions`/`qualityFloor`/
 * `sourceMetadata`) which every projection always carries as context, not as a "supplied
 * section." Mirrors `REGIONAL_PROFILE_GUIDANCE_SECTION_KEYS`'s role as the one place new
 * guidance sections get added.
 */
export const PACKAGE_PROFILE_GUIDANCE_SECTION_KEYS = [
  'architectureGuidance',
  'securityGuidance',
  'testingGuidance',
  'performanceGuidance',
  'scalabilityGuidance',
  'observabilityGuidance',
  'deploymentGuidance',
  'backupRecoveryGuidance',
  'documentationGuidance',
  'maintainabilityGuidance',
  'supportGuidance',
  'integrationGuidance',
  'dataGovernanceGuidance',
  'uiQualityGuidance',
  'qaExitCriteria',
] as const satisfies readonly (keyof Omit<
  PackageProfile,
  | 'id'
  | 'code'
  | 'name'
  | 'deliveryPositioning'
  | 'version'
  | 'status'
  | 'exclusions'
  | 'qualityFloor'
  | 'sourceMetadata'
>)[];

export type PackageProfileGuidanceSectionKey = (typeof PACKAGE_PROFILE_GUIDANCE_SECTION_KEYS)[number];
