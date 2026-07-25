import type { PackageProfile, PackageCode } from './packageProfileTypes';

/**
 * Package Profile Registry (Sprint 73, Package Intelligence Foundation).
 *
 * Typed, code-based seed profiles — mirrors `app/lib/regional/regionalProfileRegistry.ts`'s own
 * pattern (a hardcoded, strongly-typed catalog, not a database table): a Package Profile is a
 * small, curated, versioned catalog of reference knowledge that doesn't change per project,
 * doesn't need an admin UI at this foundation stage (PART 9 of the Sprint 73 brief explicitly
 * rules out "Package Studio"), and every generation call should be able to read synchronously
 * without a network round trip — `getPackageProfile` never awaits anything.
 *
 * Every profile's guidance is written per PART 16's "quality floor" and the scope-control
 * discipline of PART 8/15: implementation-depth guidance only, never a feature authorization,
 * never a specific technology mandate (no "use Kubernetes"/"use microservices"/"add SSO"
 * anywhere in any profile). `packageProfileRegistry.spec.ts` enforces this with a banned-phrase
 * scan across every seed profile.
 */

const SOURCE_METADATA = {
  lastReviewed: '2026-07-25',
  disclaimer:
    'Package Guidance controls implementation depth and delivery maturity for already-approved product scope. It does not authorize new features, integrations, roles, or infrastructure — those must already exist in approved upstream scope.',
};

/**
 * PART 16 — the shared minimum-quality baseline every package (including Starter) must meet.
 * Deliberately the SAME array reference on every seed profile below, so "every package includes
 * the minimum quality floor" is a structural guarantee (a reference/deep-equality check in
 * `packageProfileRegistry.spec.ts`), not a per-profile judgment call that could silently drift.
 */
const PACKAGE_QUALITY_FLOOR: string[] = [
  'Basic security controls appropriate to the approved scope (e.g. input validation, safe error handling) — never omitted regardless of package.',
  'Input validation on every user-facing form or API surface already in approved scope.',
  'Graceful error handling — no unhandled crashes on expected failure paths.',
  'Automated tests covering the critical user-facing paths of approved scope, at minimum.',
  'Responsive behavior across common device sizes for any approved user-facing surface.',
  'Accessibility fundamentals (semantic markup, keyboard operability, sufficient contrast) for any approved user-facing surface.',
  'Documented environment configuration sufficient for another engineer to run the approved product.',
  'Clear deployment instructions for the approved scope.',
  'No known critical defects in approved scope at handoff.',
];

const STARTER_PROFILE: PackageProfile = {
  id: 'package-starter',
  code: 'STARTER',
  name: 'Starter',
  deliveryPositioning:
    'A reliable, focused implementation for small businesses, prototypes, and straightforward customer projects — production-conscious for its approved scope, not a reduced-quality tier.',
  version: 1,
  status: 'active',
  architectureGuidance: [
    'Prefer simple, well-organized architecture over speculative complexity — a single well-structured application is usually sufficient for approved scope at this level.',
    'Avoid introducing infrastructure components (queues, caches, secondary services) that approved scope does not currently need.',
  ],
  securityGuidance: [
    'Apply essential security controls: input validation, safe error handling, secure defaults for whatever authentication already exists in approved scope.',
    'Do not add authentication, authorization, or new user roles beyond what is already approved — this guidance describes depth, not new capability.',
  ],
  testingGuidance: [
    'Focus automated testing on the critical user journeys of approved scope.',
    "Broader regression coverage is a Professional/Premium expectation, not a Starter requirement — but the quality floor's critical-path coverage still applies.",
  ],
  performanceGuidance: [
    'Verify approved scope performs acceptably under expected everyday usage — extensive load/capacity planning is not expected at this level.',
  ],
  scalabilityGuidance: [
    'Do not build speculative scalability architecture for demand that has not been approved or justified.',
  ],
  observabilityGuidance: [
    'Include basic logging sufficient to diagnose issues in approved scope — a full monitoring stack is not expected at this level.',
  ],
  deploymentGuidance: [
    'Use straightforward deployment appropriate to approved scope, favoring low operational burden over elaborate release engineering.',
  ],
  backupRecoveryGuidance: [
    'Confirm that whatever data storage already exists in approved scope has a basic, documented backup approach — advanced disaster-recovery planning is not expected at this level.',
  ],
  documentationGuidance: [
    'Keep documentation concise but sufficient for another engineer to run and maintain approved scope.',
  ],
  maintainabilityGuidance: [
    'Prefer low operational burden and straightforward maintainability over premature abstraction.',
  ],
  supportGuidance: [
    'Operational support expectations at this level are lightweight — no specific SLA is implied by this guidance.',
  ],
  integrationGuidance: [
    'Where integrations are already approved, implement essential error handling — exhaustive retry/resilience strategies are a Professional/Premium expectation.',
  ],
  dataGovernanceGuidance: [
    "Where data handling is already approved, apply the quality floor's baseline practices — a formal data-governance program is not expected at this level.",
  ],
  uiQualityGuidance: [
    'Deliver a clean, responsive implementation of approved scope with essential accessibility fundamentals covered.',
  ],
  qaExitCriteria: [
    'Approved critical user journeys work correctly and the quality floor is met before this package is considered complete.',
  ],
  exclusions: [
    'Does not add authentication, authorization, or new user roles.',
    'Does not add payments, analytics dashboards, or audit logs.',
    'Does not add complex monitoring stacks or multi-region infrastructure.',
    'Does not add integrations, mobile apps, or additional workflows beyond approved scope.',
  ],
  qualityFloor: PACKAGE_QUALITY_FLOOR,
  sourceMetadata: SOURCE_METADATA,
};

const PROFESSIONAL_PROFILE: PackageProfile = {
  id: 'package-professional',
  code: 'PROFESSIONAL',
  name: 'Professional',
  deliveryPositioning:
    'A more complete implementation for established businesses and products expected to support regular day-to-day operations.',
  version: 1,
  status: 'active',
  architectureGuidance: [
    'Prefer modular, maintainable architecture that separates concerns cleanly within approved scope.',
    'Introduce additional infrastructure components only where approved scope and expected usage genuinely justify them.',
  ],
  securityGuidance: [
    'Strengthen authorization depth where user roles already exist in approved scope — do not introduce new roles that are not already approved.',
    'Apply defense-in-depth practices (e.g. consistent input validation, least-privilege access) to whatever surfaces already exist.',
  ],
  testingGuidance: [
    'Broaden functional and integration test coverage across approved scope, beyond just the critical path.',
    'Verify accessibility and basic performance as part of the test strategy.',
  ],
  performanceGuidance: [
    'Verify approved scope performs acceptably under realistic day-to-day operational load, with attention to obvious bottlenecks.',
  ],
  scalabilityGuidance: [
    "Design for moderate, foreseeable growth in approved scope's usage — still proportional, never speculative infrastructure for unapproved scale.",
  ],
  observabilityGuidance: [
    'Add structured monitoring and error reporting so operational issues in approved scope are visible and diagnosable.',
  ],
  deploymentGuidance: [
    'Use a more resilient deployment process with clear environment separation (e.g. development/staging/production) for approved scope.',
  ],
  backupRecoveryGuidance: [
    'Define and document a backup/recovery expectation appropriate to the data already handled in approved scope.',
  ],
  documentationGuidance: [
    'Provide clear operational documentation covering how to run, deploy, and troubleshoot approved scope.',
  ],
  maintainabilityGuidance: [
    'Favor code organization and conventions that keep approved scope maintainable as it grows.',
  ],
  supportGuidance: [
    'Operational support expectations are more structured than Starter — still no specific SLA is implied unless already approved.',
  ],
  integrationGuidance: [
    'Where integrations are already approved, add stronger failure handling (retries, clear error surfaces) than the Starter baseline.',
  ],
  dataGovernanceGuidance: [
    'Where data handling is already approved, add auditability appropriate to that approved scope — never introduce new data collection to enable it.',
  ],
  uiQualityGuidance: [
    "Verify responsive and accessibility coverage more thoroughly than the Starter baseline across approved scope's surfaces.",
  ],
  qaExitCriteria: [
    'Wider functional, integration, and accessibility coverage of approved scope is verified, with structured monitoring confirmed operational before this package is considered complete.',
  ],
  exclusions: [
    'Does not add analytics unless analytics is already approved in scope.',
    'Does not add authentication, SSO, or new user roles beyond what is already approved.',
    'Does not add multi-tenancy or new infrastructure components speculatively.',
    'Does not add payments, mobile apps, or integrations beyond approved scope.',
  ],
  qualityFloor: PACKAGE_QUALITY_FLOOR,
  sourceMetadata: SOURCE_METADATA,
};

const PREMIUM_PROFILE: PackageProfile = {
  id: 'package-premium',
  code: 'PREMIUM',
  name: 'Premium',
  deliveryPositioning:
    'A high-assurance implementation for larger businesses, more demanding operations, or higher-value delivery — proportional rigor, not automatic enterprise technology.',
  version: 1,
  status: 'active',
  architectureGuidance: [
    'Prefer scalable architecture only where expected demand already justifies it in approved scope — this never means microservices or a specific architecture style by default.',
    'Favor clear separation of concerns and strong modularity within approved scope.',
  ],
  securityGuidance: [
    "Apply strong security hardening appropriate to approved scope's sensitivity (e.g. thorough input validation, careful secrets handling, least-privilege access).",
    'Advanced authorization depth applies only where identity and roles are already approved — this never authorizes adding authentication, SSO, or roles that are not already approved.',
  ],
  testingGuidance: [
    'Apply a comprehensive testing strategy across approved scope: functional, integration, accessibility, and regression coverage.',
    "Include performance and resilience testing proportional to approved scope's expected demand.",
  ],
  performanceGuidance: [
    "Apply performance and capacity planning proportional to approved scope's expected demand — never a blanket assumption of high scale.",
  ],
  scalabilityGuidance: [
    'Consider scalability only where expected demand is already justified by approved scope — this never automatically means Kubernetes, multi-region deployment, or a message-queue-based architecture.',
  ],
  observabilityGuidance: [
    "Apply strong observability: structured logging, metrics, and alerting appropriate to approved scope's operational needs.",
  ],
  deploymentGuidance: [
    'Apply strong deployment governance (e.g. clear release process, environment separation, rollback readiness) for approved scope — this never automatically means a specific infrastructure platform.',
  ],
  backupRecoveryGuidance: [
    "Apply resilience and recovery planning proportional to approved scope, including high-availability considerations only where already justified by approved scope's requirements.",
  ],
  documentationGuidance: [
    'Provide detailed documentation covering architecture, operations, and recovery procedures for approved scope.',
  ],
  maintainabilityGuidance: [
    'Apply strong maintainability discipline appropriate to a long-lived, higher-value product.',
  ],
  supportGuidance: [
    'Operational readiness expectations are higher than Professional — a specific support SLA (e.g. 24/7) is never implied unless already approved.',
  ],
  integrationGuidance: [
    'Where integrations are already approved, apply strong integration resilience (retries, circuit-breaking patterns, clear failure surfaces).',
  ],
  dataGovernanceGuidance: [
    'Where data handling is already approved, apply data lifecycle and governance considerations, including auditability where relevant — never introduce new data collection to enable it.',
  ],
  uiQualityGuidance: [
    "Apply the strongest accessibility, responsive, and polish expectations across approved scope's surfaces.",
  ],
  qaExitCriteria: [
    'Comprehensive functional, integration, regression, and accessibility coverage of approved scope is verified, with observability and recovery readiness confirmed before this package is considered complete.',
  ],
  exclusions: [
    'Does not automatically require microservices, Kubernetes, or multi-region deployment.',
    'Does not automatically add SSO, multi-tenancy, or event-driven/message-queue architecture.',
    'Does not automatically require a data warehouse, SOC 2 certification, or penetration testing.',
    'Does not automatically commit to 24/7 support.',
    'Does not add authentication, roles, payments, or integrations beyond what is already approved.',
  ],
  qualityFloor: PACKAGE_QUALITY_FLOOR,
  sourceMetadata: SOURCE_METADATA,
};

/** Every seed profile, keyed by `PackageCode` — the one place a new package gets added (plus `PackageCode` itself in `packageProfileTypes.ts`). */
const PACKAGE_PROFILES: Record<PackageCode, PackageProfile> = {
  STARTER: STARTER_PROFILE,
  PROFESSIONAL: PROFESSIONAL_PROFILE,
  PREMIUM: PREMIUM_PROFILE,
};

/** Returns the profile for `code`, or `undefined` for an unsupported/unknown code — never throws, never guesses. */
function getPackageProfile(code: string): PackageProfile | undefined {
  return PACKAGE_PROFILES[code as PackageCode];
}

function getAllPackageProfiles(): PackageProfile[] {
  return Object.values(PACKAGE_PROFILES);
}

export const packageEngine = {
  getPackageProfile,
  getAllPackageProfiles,
};
