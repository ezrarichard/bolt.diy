import type { DeploymentVerification } from '~/lib/deployment/verificationTypes';
import { classifyChangeRequest } from '~/lib/evolution/changeClassification';
import type { ChangeArea, ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { ProductBaselineSnapshot } from '~/lib/evolution/evolutionBaseline';
import {
  IMPACT_SECTION_LABELS,
  type ComplexityAssessment,
  type ComplexityFactor,
  type ComplexityLevel,
  type EngineeringRole,
  type ImpactAnalysis,
  type ImpactConfidence,
  type ImpactItem,
  type ImpactSection,
  type ImpactSectionId,
  type RiskAssessment,
  type RiskFactor,
  type RiskLevel,
  type RoleInvolvement,
} from '~/lib/evolution/impactTypes';

/**
 * Impact Analysis Service — Sprint 95, Parts 3/4/8/9/10.
 *
 * Answers the three questions this sprint exists for — what changed, what is affected, what can
 * remain untouched — by comparing a Change Request against the RELEASE BASELINE (never the latest
 * deployment; see `evolutionBaseline.ts`).
 *
 * PURE AND DETERMINISTIC. No AI call, no network, no BuildersDB. The same request and the same
 * baseline always produce the same analysis, which is what makes it testable and what makes its
 * limitations inspectable.
 *
 * HOW MATCHING WORKS, AND WHAT IT CANNOT DO. Every finding comes from a baseline IDENTIFIER
 * appearing in the operator's request text (a feature code, a route path, a component name, a table
 * name, an environment variable), or from an area the operator explicitly declared. That is honest
 * grounding — but it is term matching, not comprehension. It cannot tell "add a cancel button to
 * booking" from "remove booking entirely"; both match the booking feature. So:
 *
 *   - every item carries its own confidence and the exact term that produced it;
 *   - the report carries an overall confidence;
 *   - `requiresHumanReview` is set whenever anything rests on less than an exact identifier match;
 *   - an unmatched request returns an EMPTY analysis with a stated reason, never a plausible guess.
 *
 * NOTHING IS GENERATED, MODIFIED OR PLANNED HERE. The Evolution Plan is a separate pure step
 * (`evolutionPlan.ts`), and neither touches a Release, Manifest, Deployment or generated file.
 */

export interface ImpactAnalysisInput {
  request: ChangeRequest;
  baseline: ProductBaselineSnapshot;

  /** The verification report the release attests to — used only to say which live checks cover an affected route. */
  verification: DeploymentVerification | null;
  analysedAt: string;
}

/** Words too common to be evidence of anything. Matching on these would make every request touch everything. */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'has',
  'not',
  'are',
  'was',
  'were',
  'can',
  'should',
  'would',
  'could',
  'will',
  'add',
  'new',
  'page',
  'pages',
  'app',
  'application',
  'user',
  'users',
  'data',
  'system',
  'please',
  'need',
  'needs',
  'want',
  'make',
  'change',
  'update',
  'when',
  'where',
  'what',
  'all',
  'any',
  'our',
  'their',
]);

const MIN_TERM_LENGTH = 4;

function normalise(value: string): string {
  return value.toLowerCase().trim();
}

/** Whole-word containment, so "book" does not match "bookkeeping" and "/about" does not match "/aboutus". */
function containsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/** Splits an identifier into meaningful words: "AppointmentsPage" -> ["appointments","page"], "/book-slot" -> ["book","slot"]. */
function identifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map(normalise)
    .filter((word) => word.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(word));
}

interface MatchResult {
  matched: boolean;
  confidence: ImpactConfidence;
  evidence: string;
}

/**
 * Three tiers, strongest first:
 *   high   — the exact identifier appears verbatim ("FEAT-003", "/appointments", "appointments" table)
 *   medium — the full human label appears ("Book an appointment")
 *   low    — a distinctive word from the identifier appears ("appointments")
 */
function matchIdentifier(text: string, identifier: string, label?: string): MatchResult {
  const id = normalise(identifier);

  if (id.length >= 2 && containsTerm(text, id)) {
    return { matched: true, confidence: 'high', evidence: `exact match on "${identifier}"` };
  }

  if (label) {
    const normalisedLabel = normalise(label);

    if (normalisedLabel.length >= MIN_TERM_LENGTH && containsTerm(text, normalisedLabel)) {
      return { matched: true, confidence: 'medium', evidence: `matched the name "${label}"` };
    }
  }

  for (const word of [...identifierWords(identifier), ...(label ? identifierWords(label) : [])]) {
    if (containsTerm(text, word)) {
      return { matched: true, confidence: 'low', evidence: `matched the term "${word}"` };
    }
  }

  return { matched: false, confidence: 'low', evidence: '' };
}

function strongestConfidence(items: ImpactItem[]): ImpactConfidence {
  if (items.some((item) => item.confidence === 'high')) {
    return 'high';
  }

  return items.some((item) => item.confidence === 'medium') ? 'medium' : 'low';
}

function section(
  id: ImpactSectionId,
  items: ImpactItem[],
  detailWhenAffected: (items: ImpactItem[]) => string,
  detailWhenClear: string,
  forcedByDeclaration?: string,
): ImpactSection {
  if (items.length === 0 && !forcedByDeclaration) {
    return {
      id,
      label: IMPACT_SECTION_LABELS[id],
      affected: false,
      items: [],
      confidence: 'high',
      detail: detailWhenClear,
    };
  }

  if (items.length === 0 && forcedByDeclaration) {
    return {
      id,
      label: IMPACT_SECTION_LABELS[id],
      affected: true,
      items: [],
      confidence: 'medium',
      detail: forcedByDeclaration,
    };
  }

  return {
    id,
    label: IMPACT_SECTION_LABELS[id],
    affected: true,
    items,
    confidence: strongestConfidence(items),
    detail: detailWhenAffected(items),
  };
}

export function analyseChangeImpact(input: ImpactAnalysisInput): ImpactAnalysis {
  const { request, baseline, verification } = input;
  const text = normalise(
    [request.title, request.description, request.businessReason ?? '', request.notes ?? ''].join(' '),
  );
  const declared = new Set<ChangeArea>(request.declaredAreas ?? []);
  const reasoning: string[] = [];

  reasoning.push(
    `Analysed against release ${baseline.semanticVersion ?? '(unversioned)'} — the frozen baseline, not the current deployment.`,
  );

  // ── Match every baseline identifier ───────────────────────────────────────
  const featureItems: ImpactItem[] = [];

  for (const feature of baseline.features) {
    const match = matchIdentifier(text, feature.code, feature.title);

    if (match.matched) {
      featureItems.push({
        kind: 'feature',
        identifier: feature.code,
        label: feature.title,
        confidence: match.confidence,
        evidence: match.evidence,
      });
    }
  }

  const routeItems: ImpactItem[] = [];

  for (const route of baseline.routes) {
    const match = matchIdentifier(text, route.path, route.name);

    if (match.matched) {
      routeItems.push({
        kind: 'route',
        identifier: route.path,
        label: route.name,
        confidence: match.confidence,
        evidence: match.evidence,
      });
    }
  }

  /*
   * A file is affected either because it was matched directly, or because it OWNS a matched
   * feature — the Manifest's own per-file `featureIds`. The second is a structural link, not a
   * textual one, so it carries the feature match's own confidence.
   */
  const matchedFeatureCodes = new Set(featureItems.map((item) => item.identifier));
  const fileItems: ImpactItem[] = [];

  for (const file of baseline.files) {
    const ownsMatchedFeature = file.featureIds.some((id) => matchedFeatureCodes.has(id));

    if (ownsMatchedFeature) {
      fileItems.push({
        kind: file.componentName ? 'component' : 'file',
        identifier: file.path,
        label: file.displayName ?? file.componentName ?? file.path,
        confidence: 'medium',
        evidence: `generated for matched feature(s) ${file.featureIds.filter((id) => matchedFeatureCodes.has(id)).join(', ')}`,
      });
      continue;
    }

    const match = matchIdentifier(text, file.componentName ?? file.path, file.displayName);

    if (match.matched) {
      fileItems.push({
        kind: file.componentName ? 'component' : 'file',
        identifier: file.path,
        label: file.displayName ?? file.componentName ?? file.path,
        confidence: match.confidence,
        evidence: match.evidence,
      });
    }
  }

  const tableItems: ImpactItem[] = [];

  for (const table of baseline.databaseTables) {
    const match = matchIdentifier(text, table);

    if (match.matched) {
      tableItems.push({
        kind: 'database_table',
        identifier: table,
        label: table,
        confidence: match.confidence,
        evidence: match.evidence,
      });
    }
  }

  const environmentItems: ImpactItem[] = [];

  for (const variable of baseline.environmentVariables) {
    const match = matchIdentifier(text, variable);

    if (match.matched) {
      environmentItems.push({
        kind: 'environment_variable',
        identifier: variable,
        label: variable,
        confidence: match.confidence,
        evidence: match.evidence,
      });
    }
  }

  const serviceItems: ImpactItem[] = [];

  for (const service of baseline.requiredServices) {
    const match = matchIdentifier(text, service);

    if (match.matched) {
      serviceItems.push({
        kind: 'service',
        identifier: service,
        label: service,
        confidence: match.confidence,
        evidence: match.evidence,
      });
    }
  }

  const apiItems: ImpactItem[] = [];

  for (const surface of baseline.apiSurfaces) {
    const match = matchIdentifier(text, surface);

    if (match.matched) {
      apiItems.push({
        kind: 'api_surface',
        identifier: surface,
        label: surface,
        confidence: match.confidence,
        evidence: match.evidence,
      });
    }
  }

  // ── Derived groupings ─────────────────────────────────────────────────────
  const uiFiles = fileItems.filter((item) => {
    const file = baseline.files.find((candidate) => candidate.path === item.identifier);
    return file ? ['pages', 'components', 'styles'].includes(file.category) : false;
  });

  const backendFiles = fileItems.filter((item) => {
    const file = baseline.files.find((candidate) => candidate.path === item.identifier);
    return file ? ['backend', 'services'].includes(file.category) : false;
  });

  const authRoutes = routeItems.filter((item) => /login|sign-?in|sign-?up|register|auth/i.test(item.identifier));
  const touchesDatabase = tableItems.length > 0 || declared.has('database');

  /* Which live verification checks cover an affected route — real coverage, never an estimate. */
  const affectedRoutePaths = new Set(routeItems.map((item) => item.identifier));
  const verificationItems: ImpactItem[] = (verification?.checks ?? [])
    .filter((check) => {
      if (check.category === 'route') {
        return [...affectedRoutePaths].some((path) => check.id === `route:${path}`);
      }

      return check.category === 'database' && touchesDatabase;
    })
    .map((check) => ({
      kind: 'verification_check' as const,
      identifier: check.id,
      label: check.name,
      confidence: 'high' as const,
      evidence: `covers an affected area; last result "${check.status}"`,
    }));

  const documentationItems: ImpactItem[] = baseline.documentationSections
    .filter((sectionLabel) => matchIdentifier(text, sectionLabel).matched || declared.has('documentation'))
    .map((sectionLabel) => ({
      kind: 'documentation' as const,
      identifier: sectionLabel,
      label: sectionLabel,
      confidence: declared.has('documentation') ? 'medium' : 'low',
      evidence: declared.has('documentation')
        ? 'documentation declared as an affected area'
        : 'matched the section name',
    }));

  // ── Sections (Part 4) ─────────────────────────────────────────────────────
  const anyCodeImpact = fileItems.length > 0 || routeItems.length > 0 || tableItems.length > 0 || apiItems.length > 0;

  const sections: ImpactSection[] = [
    section(
      'business',
      featureItems,
      (items) => `${items.length} released feature(s) are referenced by this request.`,
      'No released feature was referenced by name or code in this request.',
    ),
    section(
      'technical',
      fileItems,
      (items) => `${items.length} generated file(s) are implicated, by direct reference or by feature ownership.`,
      'No generated file could be linked to this request from the release baseline.',
    ),
    section(
      'ui',
      uiFiles.concat(routeItems),
      (items) => `${items.length} page(s), component(s) or route(s) are implicated.`,
      'No page, component or route was referenced.',
      declared.has('ui') ? 'The operator declared the user interface as an affected area.' : undefined,
    ),
    section(
      'backend',
      backendFiles.concat(apiItems),
      (items) => `${items.length} backend module file(s) or API surface(s) are implicated.`,
      'No backend module or API surface was referenced.',
      declared.has('backend') || declared.has('api')
        ? 'The operator declared backend/API as an affected area.'
        : undefined,
    ),
    section(
      'database',
      tableItems,
      (items) =>
        `${items.length} released table(s) are referenced: ${items.map((item) => item.identifier).join(', ')}.`,
      'No released database table was referenced by name.',
      declared.has('database') ? 'The operator declared the database as an affected area.' : undefined,
    ),
    section(
      'security',
      authRoutes,
      (items) => `${items.length} authentication route(s) are implicated.`,
      'No authentication route or security-sensitive area was referenced.',
      declared.has('authentication') ? 'The operator declared authentication as an affected area.' : undefined,
    ),
    section(
      'infrastructure',
      environmentItems.concat(serviceItems),
      (items) => `${items.length} environment variable(s) or required service(s) are implicated.`,
      'No environment variable or required service was referenced.',
      declared.has('infrastructure') || declared.has('environment')
        ? 'The operator declared infrastructure/environment as an affected area.'
        : undefined,
    ),
    section(
      'testing',
      verificationItems,
      (items) =>
        `${items.length} live verification check(s) currently cover the affected areas and will need to be re-run.`,
      anyCodeImpact
        ? 'No existing verification check covers the affected areas — new coverage will be needed.'
        : 'Nothing in the released product was matched, so no verification coverage is implicated.',
      declared.has('testing') ? 'The operator declared testing as an affected area.' : undefined,
    ),
    section(
      'deployment',
      [],
      () => '',
      anyCodeImpact
        ? 'Any code change requires a redeploy and re-verification before it reaches the customer.'
        : 'No code change was identified, so no redeploy is implied by this analysis.',
      anyCodeImpact ? 'A redeploy and re-verification will be required once this change is implemented.' : undefined,
    ),
    section(
      'documentation',
      documentationItems,
      (items) => `${items.length} delivered document section(s) will need revisiting.`,
      'No delivered documentation section was referenced.',
    ),
  ];

  const affectedSections = sections.filter((entry) => entry.affected);
  const allItems = sections.flatMap((entry) => entry.items);

  for (const entry of affectedSections) {
    reasoning.push(`${entry.label}: ${entry.detail}`);
  }

  if (allItems.length === 0) {
    reasoning.push(
      'No baseline identifier from the released product appeared in this request. The analysis is empty by design rather than guessed — describe the change using the names of released features, pages or tables, or declare the affected areas explicitly.',
    );
  }

  // ── Classification (Part 5) ───────────────────────────────────────────────
  const classification = classifyChangeRequest({
    request,
    matchedFeatureCount: featureItems.length,
    affectedSectionCount: affectedSections.length,
    touchesDatabase,
  });
  reasoning.push(`Classification: ${classification.reasoning}`);

  // ── Risk (Part 8) & complexity (Part 9) ───────────────────────────────────
  const risk = assessRisk({
    tableItems,
    authRoutes,
    featureItems,
    affectedSectionCount: affectedSections.length,
    classification: classification.category,
    verification,
    declared,
  });
  reasoning.push(`Risk: ${risk.reasoning}`);

  const complexity = assessComplexity({
    featureItems,
    fileItems,
    tableItems,
    affectedSectionCount: affectedSections.length,
    classification: classification.category,
  });
  reasoning.push(`Complexity: ${complexity.reasoning}`);

  // ── Roles (Part 10) ───────────────────────────────────────────────────────
  const roles = resolveRoles({
    sections,
    classification: classification.category,
    tableItems,
    authRoutes,
    anyCodeImpact,
  });

  // ── Unaffected areas ──────────────────────────────────────────────────────
  const unaffectedAreas = resolveUnaffectedAreas(sections, baseline);

  // ── Confidence ────────────────────────────────────────────────────────────
  const highConfidenceFindings = allItems.filter((item) => item.confidence === 'high').length;
  const overallConfidence: ImpactConfidence =
    allItems.length === 0 ? 'low' : highConfidenceFindings > 0 ? 'high' : strongestConfidence(allItems);

  const requiresHumanReview = overallConfidence !== 'high' || classification.source === 'inferred';

  if (requiresHumanReview) {
    reasoning.push(
      'This analysis is deterministic term matching against the released baseline, not an understanding of intent. Review the affected areas with an engineer before planning work.',
    );
  }

  return {
    releaseId: baseline.releaseId,
    releaseVersion: baseline.semanticVersion,
    baselineCapturedAt: baseline.capturedAt,
    analysedAt: input.analysedAt,
    classification,
    sections,
    unaffectedAreas,
    risk,
    complexity,
    roles,
    dependencies: resolveDependencies({ tableItems, environmentItems, anyCodeImpact, authRoutes }),
    recommendations: resolveRecommendations({
      allItems,
      classification: classification.category,
      complexity: complexity.level,
      risk: risk.level,
      requiresHumanReview,
    }),
    overallConfidence,
    requiresHumanReview,
    reasoning,
    summary: {
      affectedSections: affectedSections.length,
      totalFindings: allItems.length,
      highConfidenceFindings,
      affectedFeatures: featureItems.length,
      affectedFiles: fileItems.length,
      affectedTables: tableItems.length,
    },
  };
}

/** Part 8 — every factor names the grounded signal that produced it, and the weights are visible rather than hidden in a score. */
function assessRisk(params: {
  tableItems: ImpactItem[];
  authRoutes: ImpactItem[];
  featureItems: ImpactItem[];
  affectedSectionCount: number;
  classification: string;
  verification: DeploymentVerification | null;
  declared: Set<ChangeArea>;
}): RiskAssessment {
  const factors: RiskFactor[] = [];

  if (params.tableItems.length > 0 || params.declared.has('database')) {
    factors.push({
      id: 'database_change',
      label: 'Database change',
      detail: `Released tables are implicated (${params.tableItems.map((item) => item.identifier).join(', ') || 'declared by the operator'}). Schema changes on a live product carry migration and data-loss risk.`,
      weight: 3,
    });
  }

  if (params.authRoutes.length > 0 || params.declared.has('authentication')) {
    factors.push({
      id: 'security_surface',
      label: 'Authentication surface',
      detail: 'The change touches authentication, where a regression exposes data rather than merely breaking a page.',
      weight: 3,
    });
  }

  if (params.classification === 'security' || params.classification === 'compliance') {
    factors.push({
      id: 'security_classification',
      label: 'Security or compliance change',
      detail: `Classified as "${params.classification}", where correctness is not optional.`,
      weight: 2,
    });
  }

  if (params.featureItems.length >= 3) {
    factors.push({
      id: 'breadth',
      label: 'Breadth of change',
      detail: `${params.featureItems.length} released features are implicated, so a regression has a wide blast radius.`,
      weight: 2,
    });
  }

  if (params.affectedSectionCount >= 5) {
    factors.push({
      id: 'cross_cutting',
      label: 'Cross-cutting change',
      detail: `${params.affectedSectionCount} impact areas are affected at once.`,
      weight: 2,
    });
  }

  if (!params.verification) {
    factors.push({
      id: 'no_verification',
      label: 'No live verification baseline',
      detail:
        'The released product has no verification report, so there is no evidence of what currently works to regress against.',
      weight: 2,
    });
  } else if (params.verification.status !== 'passed') {
    factors.push({
      id: 'imperfect_verification',
      label: 'Released product has open verification findings',
      detail: `The release's own verification finished as "${params.verification.status}" — changing it adds to existing findings.`,
      weight: 1,
    });
  }

  const score = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const level: RiskLevel = score >= 7 ? 'critical' : score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low';

  return {
    level,
    score,
    factors,
    reasoning:
      factors.length === 0
        ? 'No elevated risk factor was found — the change does not implicate the database, authentication, or a broad set of features.'
        : `${level} (score ${score}) from ${factors.length} factor(s): ${factors.map((factor) => factor.label).join(', ')}.`,
  };
}

/** Part 9 — sized from what was actually matched, with the counts stated so a human can disagree with the arithmetic. */
function assessComplexity(params: {
  featureItems: ImpactItem[];
  fileItems: ImpactItem[];
  tableItems: ImpactItem[];
  affectedSectionCount: number;
  classification: string;
}): ComplexityAssessment {
  const factors: ComplexityFactor[] = [];

  if (params.fileItems.length > 0) {
    factors.push({
      id: 'files',
      label: 'Generated files implicated',
      detail: `${params.fileItems.length} file(s) from the released manifest.`,
      weight: params.fileItems.length >= 10 ? 3 : params.fileItems.length >= 4 ? 2 : 1,
    });
  }

  if (params.featureItems.length > 0) {
    factors.push({
      id: 'features',
      label: 'Released features implicated',
      detail: `${params.featureItems.length} feature(s).`,
      weight: params.featureItems.length >= 4 ? 3 : params.featureItems.length >= 2 ? 2 : 1,
    });
  }

  if (params.tableItems.length > 0) {
    factors.push({
      id: 'schema',
      label: 'Schema work',
      detail: `${params.tableItems.length} table(s) implicated, which adds migration work on a live database.`,
      weight: 2,
    });
  }

  if (params.affectedSectionCount >= 5) {
    factors.push({
      id: 'coordination',
      label: 'Cross-area coordination',
      detail: `${params.affectedSectionCount} impact areas require coordinating more than one discipline.`,
      weight: 2,
    });
  }

  if (params.classification === 'major_expansion') {
    factors.push({
      id: 'expansion',
      label: 'Product expansion',
      detail: 'Classified as a major product expansion, which is new scope rather than a modification.',
      weight: 3,
    });
  }

  const score = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const level: ComplexityLevel =
    score >= 9 ? 'very_large' : score >= 6 ? 'large' : score >= 4 ? 'medium' : score >= 2 ? 'small' : 'very_small';

  return {
    level,
    score,
    factors,
    reasoning:
      factors.length === 0
        ? 'Nothing in the released product was matched, so no complexity could be estimated. Treat this as unsized rather than small.'
        : `${level} (score ${score}) from ${factors.map((factor) => `${factor.label} (${factor.detail})`).join('; ')}.`,
  };
}

/** Part 10 — only affected roles appear, each with the section that pulled it in. */
function resolveRoles(params: {
  sections: ImpactSection[];
  classification: string;
  tableItems: ImpactItem[];
  authRoutes: ImpactItem[];
  anyCodeImpact: boolean;
}): RoleInvolvement[] {
  const affected = new Set(params.sections.filter((entry) => entry.affected).map((entry) => entry.id));
  const roles: RoleInvolvement[] = [];

  const add = (role: EngineeringRole, reason: string) => {
    if (!roles.some((entry) => entry.role === role)) {
      roles.push({ role, reason });
    }
  };

  if (affected.has('database')) {
    add('database_engineer', 'Released database tables are implicated and will need a schema change and migration.');
    add('solution_architect', 'A schema change on a live product needs an architectural decision before it is made.');
  }

  if (affected.has('backend')) {
    add('backend_engineer', 'Backend modules or API surfaces are implicated.');
  }

  if (affected.has('ui')) {
    add('frontend_engineer', 'Pages, components or routes are implicated.');
    add('ui_ux', 'A user-facing change needs a design decision before it is built.');
  }

  if (affected.has('security')) {
    add('solution_architect', 'The change touches the authentication surface.');
  }

  if (affected.has('infrastructure')) {
    add('devops', 'Environment configuration or a required service is implicated.');
  }

  if (params.anyCodeImpact) {
    add('qa', 'Any change to released code needs re-verification against the live application.');
  }

  if (['feature_addition', 'major_expansion', 'workflow_change'].includes(params.classification)) {
    add(
      'business_analyst',
      `Classified as "${params.classification}", which changes requirements rather than only code.`,
    );
    add('product_owner', 'New or changed scope needs to be placed in the roadmap before engineering starts.');
  }

  return roles;
}

/** The other half of the primary question: what can remain untouched. */
function resolveUnaffectedAreas(
  sections: ImpactSection[],
  baseline: ProductBaselineSnapshot,
): ImpactAnalysis['unaffectedAreas'] {
  const bySection = new Map(sections.map((entry) => [entry.id, entry]));
  const unaffected: ImpactAnalysis['unaffectedAreas'] = [];

  const consider = (area: ChangeArea, sectionId: ImpactSectionId, detail: string) => {
    if (!bySection.get(sectionId)?.affected) {
      unaffected.push({ area, detail });
    }
  };

  consider('ui', 'ui', `${baseline.routes.length} released route(s) and their pages appear untouched by this request.`);
  consider('backend', 'backend', 'No released backend module or API surface appears implicated.');
  consider(
    'database',
    'database',
    baseline.databaseTables.length > 0
      ? `${baseline.databaseTables.length} released table(s) appear untouched.`
      : 'This product has no released database schema.',
  );
  consider('authentication', 'security', 'The authentication surface appears untouched.');
  consider('infrastructure', 'infrastructure', 'Environment configuration and required services appear untouched.');
  consider('documentation', 'documentation', 'No delivered documentation section appears to need revisiting.');

  return unaffected;
}

function resolveDependencies(params: {
  tableItems: ImpactItem[];
  environmentItems: ImpactItem[];
  anyCodeImpact: boolean;
  authRoutes: ImpactItem[];
}): string[] {
  const dependencies: string[] = [];

  if (params.tableItems.length > 0) {
    dependencies.push(
      'A schema change must be applied to the released Supabase project before the updated application is deployed.',
    );
  }

  if (params.environmentItems.length > 0) {
    dependencies.push('Environment variables must be updated on the deployment provider before redeploying.');
  }

  if (params.anyCodeImpact) {
    dependencies.push('The change must be regenerated, redeployed and re-verified before it reaches the customer.');
  }

  if (params.authRoutes.length > 0) {
    dependencies.push('Authentication changes need verification against the live application before handover.');
  }

  return dependencies;
}

function resolveRecommendations(params: {
  allItems: ImpactItem[];
  classification: string;
  complexity: ComplexityLevel;
  risk: RiskLevel;
  requiresHumanReview: boolean;
}): string[] {
  const recommendations: string[] = [];

  if (params.allItems.length === 0) {
    recommendations.push(
      'Rewrite the request naming the released features, pages or tables it concerns, or declare the affected areas — nothing in the baseline could be matched.',
    );
  }

  if (params.requiresHumanReview) {
    recommendations.push('Have an engineer confirm the affected areas before this becomes an Evolution Plan.');
  }

  if (params.risk === 'high' || params.risk === 'critical') {
    recommendations.push('Review the risk factors with the customer before committing to a delivery date.');
  }

  if (
    params.complexity === 'large' ||
    params.complexity === 'very_large' ||
    params.classification === 'major_expansion'
  ) {
    recommendations.push(
      'Consider scoping this into its own MVP rather than treating it as maintenance of the current one.',
    );
  }

  return recommendations;
}
