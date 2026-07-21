import type { BusinessUnderstandingModelPatch } from '~/lib/builders-db/requirementsSessionDbTypes';
import type {
  BusinessAssessmentState,
  ProvenanceEntityRef,
  TraceabilityReference,
} from '~/lib/projects/requirementsSession';

/**
 * Business Assessment Engine — Sprint 53.
 *
 * "What kind of business is this?" — deterministic, rule-based classification derived from
 * whatever the Business Understanding Model already holds (Sprint 51's plain form-field
 * mapping). No AI call, no invented data: every rule either matches a concrete, already-typed
 * signal or falls through to an explicit 'Unknown' value with 'low' confidence. Per the Sprint
 * 53 brief, this is deliberately NOT Fact Extraction, NOT Recommendations, NOT Discovery
 * Strategy — it only classifies, it never proposes or asks anything.
 *
 * Pure and synchronous by design: no repository calls, no I/O, trivially unit-testable. The
 * caller (`requirementsSessionOrchestrator.ts`) is responsible for persisting the result
 * alongside the rest of the Business Understanding Model update.
 */

type ConfidenceLevel = 'low' | 'medium' | 'high';

interface AssessmentContext {
  industry: string;
  vision: string;
  businessModel: string;
  functionalRequirementsText: string;
  hasIntegrations: boolean;
  hasPayments: boolean;
  hasTechnicalPreferences: boolean;
}

interface AssessmentRule {
  /** Stable identifier stored verbatim as the evidence's `transformation` — never renamed once shipped, since it's the "why" a customer/support engineer would see in the traceability record. */
  id: string;
  value: string;
  confidence: ConfidenceLevel;
  test: (ctx: AssessmentContext) => boolean;
}

interface RuleResult {
  value: string;
  confidence: ConfidenceLevel;
  ruleId: string;
}

/** Returned whenever no rule in a list matches, so a field is always populated, honestly, rather than left silently undefined. */
const UNKNOWN_RESULT: RuleResult = { value: 'Unknown', confidence: 'low', ruleId: 'fallback:no-signal' };

function buildContext(patch: BusinessUnderstandingModelPatch): AssessmentContext {
  const identity = (patch.businessIdentity ?? {}) as Record<string, unknown>;
  const snapshot = (identity.formSnapshot ?? {}) as Record<string, unknown>;

  const asText = (value: unknown): string => (typeof value === 'string' ? value.toLowerCase() : '');
  const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  return {
    industry: asText(identity.industry),
    vision: asText(identity.vision),
    businessModel: asText(identity.businessModel),
    functionalRequirementsText: (patch.functionalRequirements ?? []).join(' ').toLowerCase(),
    hasIntegrations: (patch.currentSystems ?? []).length > 0,
    hasPayments: asList(snapshot.paymentNeeds).length > 0,
    hasTechnicalPreferences: Boolean(asText(snapshot.technicalPreferences)),
  };
}

/** First matching rule wins — order is the priority (most specific/confident signals first, generic fallbacks last). */
function evaluateRules(rules: AssessmentRule[], ctx: AssessmentContext): RuleResult {
  const match = rules.find((rule) => rule.test(ctx));
  return match ? { value: match.value, confidence: match.confidence, ruleId: match.id } : UNKNOWN_RESULT;
}

/*
 * ── Business Classification ──────────────────────────────────────────────
 * Industry-vertical keywords first (highest confidence — an explicit, unambiguous word the
 * customer typed); business-model/vision-derived signals next (medium — inferred, not stated
 * directly); a generic "some industry was given but it didn't match anything specific" fallback
 * last (low); "nothing at all" always falls through to the shared Unknown result.
 */
const CLASSIFICATION_RULES: AssessmentRule[] = [
  {
    id: 'industry-keyword:church',
    value: 'Church',
    confidence: 'high',
    test: (c) => /church|parish|ministry/.test(c.industry),
  },
  {
    id: 'industry-keyword:school',
    value: 'School',
    confidence: 'high',
    test: (c) => /school|college|university|education/.test(c.industry),
  },
  {
    id: 'industry-keyword:hospital',
    value: 'Hospital',
    confidence: 'high',
    test: (c) => /hospital|clinic|health|medical|dental/.test(c.industry),
  },
  {
    id: 'industry-keyword:manufacturing',
    value: 'Manufacturing',
    confidence: 'high',
    test: (c) => /manufactur/.test(c.industry),
  },
  {
    id: 'industry-keyword:restaurant',
    value: 'Restaurant',
    confidence: 'high',
    test: (c) => /restaurant|cafe|café|food|dining/.test(c.industry),
  },
  {
    id: 'industry-keyword:retail',
    value: 'Retail',
    confidence: 'high',
    test: (c) => /retail|shop|store|clothing|fashion|boutique/.test(c.industry),
  },
  {
    id: 'industry-keyword:ngo',
    value: 'NGO',
    confidence: 'high',
    test: (c) => /ngo|non-?profit|charity/.test(c.industry),
  },
  {
    id: 'industry-keyword:government',
    value: 'Government',
    confidence: 'high',
    test: (c) => /government|municipal|public sector/.test(c.industry),
  },
  {
    id: 'industry-keyword:marketplace',
    value: 'Marketplace',
    confidence: 'medium',
    test: (c) => /marketplace/.test(c.industry) || /marketplace/.test(c.vision),
  },
  {
    id: 'industry-keyword:agency',
    value: 'Agency',
    confidence: 'medium',
    test: (c) => /agency|consult/.test(c.industry),
  },
  {
    id: 'industry-keyword:saas',
    value: 'SaaS',
    confidence: 'medium',
    test: (c) => /saas|software/.test(c.industry) || /subscription/.test(c.businessModel),
  },
  {
    id: 'signal:internal-tool',
    value: 'Internal Tool',
    confidence: 'medium',
    test: (c) => /internal|employee|staff[- ]only/.test(c.vision),
  },
  { id: 'fallback:industry-present', value: 'Small Business', confidence: 'low', test: (c) => c.industry.length > 0 },
];

/*
 * ── Business Maturity ─────────────────────────────────────────────────────
 * Deliberately never guesses "Offline" for a blank technical picture — a blank field means the
 * customer didn't answer this yet, not that they have no technology. Absence of signal always
 * resolves to Unknown, per the sprint's explicit anti-hallucination instruction.
 */
const MATURITY_RULES: AssessmentRule[] = [
  {
    id: 'maturity-signal:integrations-and-payments',
    value: 'Growing Digital',
    confidence: 'medium',
    test: (c) => c.hasIntegrations && c.hasPayments,
  },
  {
    id: 'maturity-signal:integrations-present',
    value: 'Basic Digital',
    confidence: 'medium',
    test: (c) => c.hasIntegrations || c.hasPayments,
  },
  {
    id: 'maturity-signal:technical-preferences-only',
    value: 'Basic Digital',
    confidence: 'low',
    test: (c) => c.hasTechnicalPreferences,
  },
];

// ── Project Type ──────────────────────────────────────────────────────────
const PROJECT_TYPE_RULES: AssessmentRule[] = [
  {
    id: 'project-type-keyword:marketplace',
    value: 'Marketplace',
    confidence: 'high',
    test: (c) => /marketplace/.test(c.vision) || /marketplace/.test(c.functionalRequirementsText),
  },
  {
    id: 'project-type-keyword:erp',
    value: 'ERP',
    confidence: 'high',
    test: (c) => /\berp\b/.test(c.vision) || /\berp\b/.test(c.functionalRequirementsText),
  },
  {
    id: 'project-type-keyword:crm',
    value: 'CRM',
    confidence: 'high',
    test: (c) => /\bcrm\b/.test(c.vision) || /\bcrm\b/.test(c.functionalRequirementsText),
  },
  {
    id: 'project-type-keyword:ai-platform',
    value: 'AI Platform',
    confidence: 'high',
    test: (c) => /\bai\b|agent|chatbot/.test(c.vision),
  },
  {
    id: 'project-type-keyword:mobile-app',
    value: 'Mobile App',
    confidence: 'high',
    test: (c) => /mobile app|ios app|android app/.test(c.vision),
  },
  {
    id: 'project-type-keyword:saas',
    value: 'SaaS',
    confidence: 'medium',
    test: (c) => /saas/.test(c.vision) || /subscription/.test(c.businessModel),
  },
  { id: 'project-type-keyword:portal', value: 'Portal', confidence: 'medium', test: (c) => /portal/.test(c.vision) },
  {
    id: 'project-type-keyword:internal-tool',
    value: 'Internal Tool',
    confidence: 'medium',
    test: (c) => /internal|employee|staff[- ]only|admin dashboard/.test(c.vision),
  },
  {
    id: 'project-type-keyword:website',
    value: 'Website',
    confidence: 'low',
    test: (c) => /website|site/.test(c.vision),
  },
  { id: 'fallback:vision-present', value: 'Website', confidence: 'low', test: (c) => c.vision.length > 0 },
];

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

/** The weakest of the given confidences — the assessment's overall confidence is only as strong as its least-confident individual finding. */
function weakestConfidence(levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce((weakest, level) => (CONFIDENCE_RANK[level] < CONFIDENCE_RANK[weakest] ? level : weakest));
}

function makeEvidence(
  source: ProvenanceEntityRef,
  targetFieldId: string,
  result: RuleResult,
  recordedAt: string,
): TraceabilityReference {
  return {
    source,
    target: { type: 'business_understanding_section', id: `assessment.${targetFieldId}` },
    transformation: result.ruleId,
    confidence: result.confidence,
    recordedAt,
  };
}

export interface BusinessAssessmentResult {
  assessment: BusinessAssessmentState;
  evidence: TraceabilityReference[];
  overallConfidence: ConfidenceLevel;
}

/**
 * Runs all three assessment rules against the Business Understanding Model patch about to be
 * persisted, and returns both the resulting `assessment` section and its provenance (one
 * `TraceabilityReference` per assessed field, reusing the exact mechanism Sprint 52
 * introduced — see `requirementsSessionOrchestrator.ts`, the only caller).
 */
export function runBusinessAssessment(patch: BusinessUnderstandingModelPatch): BusinessAssessmentResult {
  const ctx = buildContext(patch);
  const recordedAt = new Date().toISOString();

  const classification = evaluateRules(CLASSIFICATION_RULES, ctx);
  const maturity = evaluateRules(MATURITY_RULES, ctx);
  const projectType = evaluateRules(PROJECT_TYPE_RULES, ctx);

  const identitySource: ProvenanceEntityRef = { type: 'business_understanding_section', id: 'businessIdentity' };
  const currentSystemsSource: ProvenanceEntityRef = { type: 'business_understanding_section', id: 'currentSystems' };

  const identity = (patch.businessIdentity ?? {}) as Record<string, unknown>;
  const industry = typeof identity.industry === 'string' ? identity.industry : undefined;

  const assessment: BusinessAssessmentState = {
    classification: classification.value,
    maturity: maturity.value,
    projectType: projectType.value,
    ...(industry ? { industry } : {}),
  };

  const evidence: TraceabilityReference[] = [
    makeEvidence(identitySource, 'classification', classification, recordedAt),
    makeEvidence(currentSystemsSource, 'maturity', maturity, recordedAt),
    makeEvidence(identitySource, 'projectType', projectType, recordedAt),
  ];

  return {
    assessment,
    evidence,
    overallConfidence: weakestConfidence([classification.confidence, maturity.confidence, projectType.confidence]),
  };
}

export const businessAssessmentEngine = {
  runBusinessAssessment,
};
