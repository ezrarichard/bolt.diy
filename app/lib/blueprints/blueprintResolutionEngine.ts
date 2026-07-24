import type { BusinessUnderstandingModel } from '~/lib/projects/requirementsSession';
import type { ProjectBlueprint } from './types';

/**
 * Blueprint Resolution Engine — Sprint 61.
 *
 * "Given what Discovery already knows about this business, which Blueprint fits best?" —
 * deterministic, rule-based matching in the same spirit as `businessAssessmentEngine.ts`: no AI
 * call, no invented data, every score traceable back to a concrete signal. This is the ONLY new
 * piece of intelligence this sprint adds — it deliberately reuses the Business Understanding
 * Model (Sprint 50), the Business Assessment Engine's output already stored on it (Sprint 53),
 * and the Blueprint repository's existing `ProjectBlueprint`/`BlueprintContent` shape (Sprints
 * 59-60) rather than re-deriving or duplicating any of that classification logic.
 *
 * Pure and synchronous: no repository calls, no I/O, trivially unit-testable. The caller
 * (`blueprintResolutionService.ts`) is responsible for persisting the result.
 */

type MatchDimension =
  | 'industry'
  | 'projectType'
  | 'businessGoals'
  | 'coreFeatures'
  | 'targetUsers'
  | 'businessModel'
  | 'keywords';

/** Relative importance of each signal — sums to 100 so a perfect match across every dimension yields ~100% confidence. */
const DIMENSION_WEIGHTS: Record<MatchDimension, number> = {
  industry: 25,
  projectType: 20,
  businessGoals: 15,
  coreFeatures: 15,
  targetUsers: 15,
  businessModel: 5,
  keywords: 5,
};

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'will',
  'your',
  'their',
  'about',
  'into',
  'able',
  'need',
  'needs',
  'want',
  'wants',
  'business',
  'website',
  'project',
]);

function tokenize(text: string | undefined): string[] {
  if (!text) {
    return [];
  }

  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

  return Array.from(new Set(tokens));
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Signals extracted from a Business Understanding Model, in the shape the resolution engine
 * matches against a Blueprint. Reuses `model.assessment` (the Business Assessment Engine's
 * already-computed output) rather than re-classifying industry/project type from scratch.
 */
export interface BlueprintMatchSignals {
  industry: string;
  projectType: string;
  businessModel: string;
  businessGoals: string[];
  coreFeatures: string[];
  targetUsers: string[];
  keywords: string[];
}

/**
 * Projects a `BusinessUnderstandingModel` onto the signals this engine scores blueprints
 * against. Every field degrades gracefully to an empty string/array when Discovery hasn't
 * captured it yet — an incomplete model simply contributes less to the eventual confidence
 * score rather than throwing or fabricating a value.
 */
export function buildBlueprintMatchSignals(model: BusinessUnderstandingModel): BlueprintMatchSignals {
  const identity = (model.businessIdentity ?? {}) as Record<string, unknown>;
  const industry = [model.assessment.industry, asText(identity.industry)].filter(Boolean).join(' ');
  const projectType = [model.assessment.projectType, model.assessment.classification].filter(Boolean).join(' ');
  const businessModel = asText(identity.businessModel);
  const vision = asText(identity.vision);
  const businessGoals = model.businessGoals ?? [];
  const coreFeatures = model.functionalRequirements ?? [];
  const targetUsers = model.targetUsers ?? [];

  const keywords = tokenize(
    [vision, industry, businessModel, ...businessGoals, ...coreFeatures, ...targetUsers].join(' '),
  );

  return { industry, projectType, businessModel, businessGoals, coreFeatures, targetUsers, keywords };
}

/** Fraction (0..1) of `signalTokens` that also appear in `poolTokens` — 0 when there's nothing to compare. */
function tokenOverlapRatio(signalTokens: string[], poolTokens: string[]): number {
  if (signalTokens.length === 0) {
    return 0;
  }

  const pool = new Set(poolTokens);
  const matches = signalTokens.filter((token) => pool.has(token));

  return matches.length / signalTokens.length;
}

/** Scores one free-text signal (e.g. industry) against a blueprint's corresponding text pool. */
function scoreText(signal: string, poolTexts: (string | undefined)[]): number {
  return tokenOverlapRatio(tokenize(signal), tokenize(poolTexts.filter(Boolean).join(' ')));
}

/**
 * Scores a list signal (e.g. business goals) against a list of blueprint text items, returning
 * both the match ratio and which signal items actually matched (for the human-readable reason).
 */
function scoreList(signalItems: string[], poolItems: string[]): { ratio: number; matched: string[] } {
  if (signalItems.length === 0 || poolItems.length === 0) {
    return { ratio: 0, matched: [] };
  }

  const poolTokens = tokenize(poolItems.join(' '));
  const matched = signalItems.filter((item) => tokenOverlapRatio(tokenize(item), poolTokens) > 0);

  return { ratio: matched.length / signalItems.length, matched };
}

function blueprintIndustryPool(blueprint: ProjectBlueprint): (string | undefined)[] {
  return [
    blueprint.industry,
    blueprint.content?.businessDomain?.industry,
    blueprint.content?.businessDomain?.category,
    blueprint.category,
  ];
}

function blueprintProjectTypePool(blueprint: ProjectBlueprint): (string | undefined)[] {
  return [blueprint.productType, blueprint.category, blueprint.content?.businessDomain?.category];
}

function blueprintBusinessModelPool(blueprint: ProjectBlueprint): (string | undefined)[] {
  return [
    blueprint.content?.executiveSummary?.summary,
    blueprint.content?.executiveSummary?.valueProposition,
    blueprint.description,
  ];
}

function blueprintBusinessGoalItems(blueprint: ProjectBlueprint): string[] {
  return (blueprint.content?.businessGoals ?? []).map((goal) => `${goal.goal} ${goal.description}`);
}

function blueprintFeatureItems(blueprint: ProjectBlueprint): string[] {
  const standard = (blueprint.content?.standardFeatures ?? []).map((f) => `${f.name} ${f.description}`);
  const optional = (blueprint.content?.optionalFeatures ?? []).map((f) => `${f.name} ${f.description}`);
  const modules = (blueprint.content?.functionalModules ?? []).map(
    (m) => `${m.name} ${m.description} ${m.features.join(' ')}`,
  );

  return [...standard, ...optional, ...modules];
}

function blueprintCustomerItems(blueprint: ProjectBlueprint): string[] {
  const personas = (blueprint.content?.customerPersonas ?? []).map((p) => `${p.role} ${p.description}`);
  return [blueprint.targetUsers ?? '', ...(blueprint.content?.typicalCustomers ?? []), ...personas].filter(
    (item) => item.length > 0,
  );
}

function blueprintKeywordPool(blueprint: ProjectBlueprint): (string | undefined)[] {
  return [
    blueprint.name,
    blueprint.description,
    blueprint.productType,
    blueprint.category,
    ...(blueprint.content?.typicalCustomers ?? []),
  ];
}

/** One dimension's contribution to a candidate's score, kept around only to build `reasons`. */
interface DimensionOutcome {
  dimension: MatchDimension;
  ratio: number;
  reason?: string;
}

function truncate(text: string, maxLength = 60): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function evaluateDimensions(blueprint: ProjectBlueprint, signals: BlueprintMatchSignals): DimensionOutcome[] {
  const industryRatio = scoreText(signals.industry, blueprintIndustryPool(blueprint));
  const projectTypeRatio = scoreText(signals.projectType, blueprintProjectTypePool(blueprint));
  const businessModelRatio = scoreText(signals.businessModel, blueprintBusinessModelPool(blueprint));
  const keywordsRatio = tokenOverlapRatio(
    signals.keywords,
    tokenize(blueprintKeywordPool(blueprint).filter(Boolean).join(' ')),
  );

  const goals = scoreList(signals.businessGoals, blueprintBusinessGoalItems(blueprint));
  const features = scoreList(signals.coreFeatures, blueprintFeatureItems(blueprint));
  const customers = scoreList(signals.targetUsers, blueprintCustomerItems(blueprint));

  return [
    {
      dimension: 'industry',
      ratio: industryRatio,
      reason: industryRatio > 0 ? `Industry matches "${truncate(signals.industry)}"` : undefined,
    },
    {
      dimension: 'projectType',
      ratio: projectTypeRatio,
      reason:
        projectTypeRatio > 0 ? `Project type aligns with "${blueprint.productType ?? blueprint.category}"` : undefined,
    },
    {
      dimension: 'businessGoals',
      ratio: goals.ratio,
      reason: goals.matched[0] ? `Matches business goal: ${truncate(goals.matched[0])}` : undefined,
    },
    {
      dimension: 'coreFeatures',
      ratio: features.ratio,
      reason: features.matched[0] ? `Matches core feature: ${truncate(features.matched[0])}` : undefined,
    },
    {
      dimension: 'targetUsers',
      ratio: customers.ratio,
      reason: customers.matched[0] ? `Matches target customer type: ${truncate(customers.matched[0])}` : undefined,
    },
    {
      dimension: 'businessModel',
      ratio: businessModelRatio,
      reason: businessModelRatio > 0 ? `Business model fits "${blueprint.name}"` : undefined,
    },
    {
      dimension: 'keywords',
      ratio: keywordsRatio,
      reason: keywordsRatio > 0 ? `Shared keywords with "${blueprint.name}"` : undefined,
    },
  ];
}

/** One blueprint's resolved match against the current Business Understanding Model. */
export interface BlueprintCandidate {
  blueprintId: string;
  blueprintName: string;

  /** 0-100, rounded — see `DIMENSION_WEIGHTS` for how each dimension contributes. */
  confidence: number;

  /** Human-readable, most-relevant-first — never more than 5, per the Sprint 61 example format. */
  reasons: string[];
}

/** The full ranked result of one resolution run — never mutated after creation, always recomputed from scratch. */
export interface BlueprintResolutionResult {
  candidates: BlueprintCandidate[];
  recommendedBlueprintId: string | undefined;
  resolvedAt: string;
}

const MAX_REASONS = 5;

function scoreBlueprint(blueprint: ProjectBlueprint, signals: BlueprintMatchSignals): BlueprintCandidate {
  const outcomes = evaluateDimensions(blueprint, signals);

  const weightedScore = outcomes.reduce(
    (total, outcome) => total + outcome.ratio * DIMENSION_WEIGHTS[outcome.dimension],
    0,
  );

  const reasons = outcomes
    .filter((outcome): outcome is DimensionOutcome & { reason: string } => Boolean(outcome.reason))
    .sort((a, b) => b.ratio * DIMENSION_WEIGHTS[b.dimension] - a.ratio * DIMENSION_WEIGHTS[a.dimension])
    .slice(0, MAX_REASONS)
    .map((outcome) => outcome.reason);

  return {
    blueprintId: blueprint.id,
    blueprintName: blueprint.name,
    confidence: Math.round(weightedScore),
    reasons,
  };
}

/**
 * Resolves the best-fit Blueprint(s) for a Business Understanding Model against the given
 * candidate Blueprint set (call site passes `blueprintEngine.getAllBlueprints()` — this engine
 * never fetches blueprints itself). Returns every enabled blueprint, ranked by confidence
 * descending, so a caller/UI can show alternates, not just the top pick — nothing here forces a
 * choice; `recommendedBlueprintId` is only ever a suggestion.
 */
export function resolveBlueprintCandidates(
  model: BusinessUnderstandingModel,
  blueprints: ProjectBlueprint[],
): BlueprintResolutionResult {
  const signals = buildBlueprintMatchSignals(model);

  const candidates = blueprints
    .filter((blueprint) => blueprint.enabled)
    .map((blueprint) => scoreBlueprint(blueprint, signals))
    .sort((a, b) => b.confidence - a.confidence);

  return {
    candidates,
    recommendedBlueprintId: candidates[0]?.blueprintId,
    resolvedAt: new Date().toISOString(),
  };
}

export const blueprintResolutionEngine = {
  resolveBlueprintCandidates,
  buildBlueprintMatchSignals,
};
