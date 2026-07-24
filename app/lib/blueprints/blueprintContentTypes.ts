/**
 * Blueprint Content — Sprint 60 (Blueprint Knowledge Foundation).
 *
 * The structured business-knowledge schema stored in `ProjectBlueprint.content` /
 * `builders_blueprints.content` (see supabase/migrations/20260729100000_blueprint_foundation.sql
 * for that column, added in Sprint 59 as an empty, unread placeholder — this file is what
 * finally gives it a real shape). Nothing in this file is read by any AI role, prompt, or the
 * existing Builders workflow yet — populating and validating this data is this sprint's entire
 * scope; consuming it (Business Analyst context, Product Owner, Blueprint Resolution) is later
 * sprints' work, per the Sprint 60 brief.
 *
 * Design principles:
 *  - Every section is optional except `schemaVersion` — a Blueprint is never required to have
 *    every section filled, and a future sprint adding a new section must never break an
 *    existing Blueprint's stored content (no migration needed to keep old rows valid).
 *  - `schemaVersion` is independent of `builders_blueprints.version` (the row-level Blueprint
 *    version from Sprint 59) — this is the CONTENT shape's own version, so the shape can evolve
 *    (e.g. a section's fields change) without needing a new Blueprint version for every row.
 *  - Sections are grouped, not flattened, so a consumer that only cares about one area (e.g. QA
 *    reading `testingScenarios`) can destructure just that key.
 */

export const BLUEPRINT_CONTENT_SCHEMA_VERSION = 1;

export interface BlueprintExecutiveSummary {
  /** One or two sentences: what this kind of product is and who it's for. */
  summary: string;

  /** The core value proposition — why a customer would choose to build this. */
  valueProposition: string;
}

export interface BlueprintBusinessDomain {
  /** e.g. "Food & Beverage", "Retail", "Professional Services". */
  industry: string;

  /** e.g. "Local Service Business", "E-commerce", "AI Product". */
  category: string;
  description: string;
}

export interface BlueprintCustomerPersona {
  name: string;
  role: string;
  description: string;
  goals: string[];
  painPoints: string[];
}

export interface BlueprintBusinessGoal {
  goal: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface BlueprintBusinessProcess {
  name: string;
  description: string;
  steps: string[];
}

export interface BlueprintFunctionalModule {
  name: string;
  description: string;
  features: string[];
}

export interface BlueprintFeature {
  name: string;
  description: string;
}

export interface BlueprintUserRole {
  name: string;
  description: string;
  permissions: string[];
}

export interface BlueprintBusinessRule {
  rule: string;
  rationale: string;
}

export interface BlueprintDataEntity {
  name: string;
  description: string;
  keyFields: string[];
  relationships: string[];
}

export interface BlueprintIntegration {
  name: string;
  purpose: string;
  required: boolean;
}

export interface BlueprintComplianceItem {
  name: string;
  description: string;

  /** e.g. "India", "Global" — absent when not region-specific. */
  region?: string;
}

export interface BlueprintUiPattern {
  name: string;
  description: string;
}

export interface BlueprintNavigationItem {
  label: string;
  description: string;
  children?: string[];
}

export interface BlueprintDashboardSuggestion {
  name: string;
  description: string;
  metrics: string[];
}

export interface BlueprintReportSuggestion {
  name: string;
  description: string;

  /** Who this report is for, e.g. "Store Owner", "Operations Manager". */
  audience: string;
}

export interface BlueprintNotificationType {
  name: string;
  trigger: string;

  /** e.g. "Email", "WhatsApp", "In-app", "SMS". */
  channel: string;
}

export interface BlueprintSecurityConsideration {
  concern: string;
  mitigation: string;
}

export interface BlueprintPerformanceExpectation {
  metric: string;
  target: string;
}

export interface BlueprintTestingScenario {
  scenario: string;
  expectedOutcome: string;
}

export interface BlueprintDeploymentConsideration {
  consideration: string;
  detail: string;
}

export interface BlueprintFutureEnhancement {
  idea: string;
  description: string;
}

/**
 * The full structured content shape for one Blueprint. Every section beyond `schemaVersion` is
 * optional by design — see this file's header comment.
 */
export interface BlueprintContent {
  schemaVersion: number;

  executiveSummary?: BlueprintExecutiveSummary;
  businessDomain?: BlueprintBusinessDomain;
  typicalCustomers?: string[];
  customerPersonas?: BlueprintCustomerPersona[];
  businessGoals?: BlueprintBusinessGoal[];
  coreBusinessProcesses?: BlueprintBusinessProcess[];
  functionalModules?: BlueprintFunctionalModule[];
  standardFeatures?: BlueprintFeature[];
  optionalFeatures?: BlueprintFeature[];
  userRoles?: BlueprintUserRole[];
  businessRules?: BlueprintBusinessRule[];
  dataEntities?: BlueprintDataEntity[];
  integrations?: BlueprintIntegration[];
  compliance?: BlueprintComplianceItem[];
  uiPatterns?: BlueprintUiPattern[];
  navigation?: BlueprintNavigationItem[];
  dashboardSuggestions?: BlueprintDashboardSuggestion[];
  reports?: BlueprintReportSuggestion[];
  notifications?: BlueprintNotificationType[];
  security?: BlueprintSecurityConsideration[];
  performanceExpectations?: BlueprintPerformanceExpectation[];
  testingScenarios?: BlueprintTestingScenario[];
  deploymentConsiderations?: BlueprintDeploymentConsideration[];
  futureEnhancements?: BlueprintFutureEnhancement[];
}

/**
 * Every section key `BlueprintContent` currently defines, in the same order the Sprint 60 brief
 * lists them. Adding a new section later means adding it here too — this is the one place
 * `blueprintContentValidation.ts`'s completeness scoring and `blueprintPortability.ts`'s shape
 * checks read from, so the two never drift out of sync with the type above.
 */
export const BLUEPRINT_CONTENT_SECTION_KEYS = [
  'executiveSummary',
  'businessDomain',
  'typicalCustomers',
  'customerPersonas',
  'businessGoals',
  'coreBusinessProcesses',
  'functionalModules',
  'standardFeatures',
  'optionalFeatures',
  'userRoles',
  'businessRules',
  'dataEntities',
  'integrations',
  'compliance',
  'uiPatterns',
  'navigation',
  'dashboardSuggestions',
  'reports',
  'notifications',
  'security',
  'performanceExpectations',
  'testingScenarios',
  'deploymentConsiderations',
  'futureEnhancements',
] as const satisfies readonly (keyof Omit<BlueprintContent, 'schemaVersion'>)[];

export type BlueprintContentSectionKey = (typeof BLUEPRINT_CONTENT_SECTION_KEYS)[number];

/** Content schema versions this codebase currently knows how to read/validate. */
export const SUPPORTED_BLUEPRINT_CONTENT_SCHEMA_VERSIONS: readonly number[] = [BLUEPRINT_CONTENT_SCHEMA_VERSION];
