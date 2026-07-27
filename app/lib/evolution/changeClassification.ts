import type { ChangeArea, ChangeCategory, ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { ChangeClassification, ImpactConfidence } from '~/lib/evolution/impactTypes';

/**
 * Change Classification — Sprint 95, Part 5.
 *
 * Two rules, in order:
 *
 *  1. **A declared category always wins.** If the operator classified the request themselves, that
 *     is the answer, recorded as `source: 'declared'` with high confidence. Inference never
 *     overrides a human.
 *  2. Otherwise, infer from the REQUEST TEXT the customer actually wrote, plus the breadth of what
 *     the baseline matching found. This is keyword analysis over operator-supplied prose — a
 *     legitimate input — not an inference about the product from its name.
 *
 * Inference is a heuristic and says so: the result carries `confidence` and `alternatives`, and a
 * weak signal produces `unknown` rather than a confident-sounding guess. No AI call is involved.
 */

interface CategorySignal {
  category: ChangeCategory;

  /** Whole-word patterns over the lower-cased request text. Deliberately small and readable. */
  patterns: RegExp[];

  /** Base score per matched pattern. Categories that are riskier to get wrong score conservatively. */
  weight: number;
}

const CATEGORY_SIGNALS: CategorySignal[] = [
  {
    category: 'bug_fix',
    patterns: [
      /\bbugs?\b/,
      /\bbroken\b/,
      /\bnot working\b/,
      /\bfails?\b/,
      /\berrors?\b/,
      /\bfix(es|ed)?\b/,
      /\bcrash(es|ing)?\b/,
      /\bincorrect\b/,
      /\bwrong\b/,
    ],
    weight: 2,
  },
  {
    category: 'security',
    patterns: [
      /\bsecurity\b/,
      /\bvulnerab\w*/,
      /\bauth(entication|orisation|orization)?\b/,
      /\bpermissions?\b/,
      /\brole[- ]based\b/,
      /\bencrypt\w*/,
      /\bpasswords?\b/,
      /\bunauthorised\b/,
      /\bunauthorized\b/,
    ],
    weight: 3,
  },
  {
    category: 'compliance',
    patterns: [
      /\bcompliance\b/,
      /\bgdpr\b/,
      /\bregulat\w*/,
      /\baudit\b/,
      /\blegal\b/,
      /\bconsent\b/,
      /\bretention polic\w*/,
      /\bdata protection\b/,
    ],
    weight: 3,
  },
  {
    category: 'performance',
    patterns: [
      /\bperformance\b/,
      /\bslow(er|ly)?\b/,
      /\bspeed\b/,
      /\bfaster\b/,
      /\blatency\b/,
      /\btimeouts?\b/,
      /\boptimi[sz]\w*/,
      /\bcach\w*/,
    ],
    weight: 2,
  },
  {
    category: 'ui_improvement',
    patterns: [
      /\bui\b/,
      /\bux\b/,
      /\blayouts?\b/,
      /\bstyl\w*/,
      /\bcolou?rs?\b/,
      /\bfonts?\b/,
      /\bdesign\b/,
      /\bresponsive\b/,
      /\bmobile view\b/,
      /\blooks?\b/,
      /\bwording\b/,
      /\blabels?\b/,
    ],
    weight: 1,
  },
  {
    category: 'workflow_change',
    patterns: [
      /\bworkflows?\b/,
      /\bprocess(es)?\b/,
      /\bsteps?\b/,
      /\bapprovals?\b/,
      /\bstages?\b/,
      /\bre-?order\b/,
      /\brules?\b/,
      /\bpolic(y|ies)\b/,
    ],
    weight: 2,
  },
  {
    category: 'infrastructure',
    patterns: [
      /\binfrastructure\b/,
      /\bhosting\b/,
      /\bdomains?\b/,
      /\bdeploy\w*/,
      /\benvironment variables?\b/,
      /\bscal\w*/,
      /\bbackups?\b/,
      /\bmonitoring\b/,
    ],
    weight: 2,
  },
  {
    category: 'feature_addition',
    patterns: [
      /\badd\b/,
      /\bnew\b/,
      /\bintroduce\b/,
      /\bsupport for\b/,
      /\bability to\b/,
      /\ballow (users|customers|staff)\b/,
      /\bcreate a\b/,
      /\benable\b/,
    ],
    weight: 2,
  },
  {
    category: 'major_expansion',
    patterns: [
      /\bmodules?\b/,
      /\bportals?\b/,
      /\bmulti[- ]tenan\w*/,
      /\bmarketplace\b/,
      /\bmobile app\b/,
      /\bentire\b/,
      /\brebuild\b/,
      /\bwhole new\b/,
      /\bsecond product\b/,
    ],
    weight: 3,
  },
];

/** Areas that, when DECLARED by the operator, strongly imply a category regardless of wording. */
const AREA_CATEGORY_HINTS: Partial<Record<ChangeArea, ChangeCategory>> = {
  authentication: 'security',
  infrastructure: 'infrastructure',
  environment: 'infrastructure',
  documentation: 'small_enhancement',
  testing: 'small_enhancement',
};

export interface ClassificationInput {
  request: Pick<ChangeRequest, 'title' | 'description' | 'businessReason' | 'category' | 'declaredAreas' | 'scope'>;

  /** How many distinct baseline features the matcher found — breadth is a real signal of expansion. */
  matchedFeatureCount: number;

  /** How many impact sections came back affected. */
  affectedSectionCount: number;

  /** True when the request touches database tables — a structural signal, not a wording one. */
  touchesDatabase: boolean;
}

export function classifyChangeRequest(input: ClassificationInput): ChangeClassification {
  const { request } = input;

  if (request.category && request.category !== 'unknown') {
    return {
      category: request.category,
      source: 'declared',
      confidence: 'high',
      reasoning: `Classified as "${request.category}" by the operator when the request was raised.`,
      alternatives: [],
    };
  }

  const text = [request.title, request.description, request.businessReason ?? ''].join(' ').toLowerCase();
  const scores = new Map<ChangeCategory, number>();
  const matchedTerms = new Map<ChangeCategory, string[]>();

  for (const signal of CATEGORY_SIGNALS) {
    for (const pattern of signal.patterns) {
      const match = pattern.exec(text);

      if (match) {
        scores.set(signal.category, (scores.get(signal.category) ?? 0) + signal.weight);
        matchedTerms.set(signal.category, [...(matchedTerms.get(signal.category) ?? []), match[0]]);
      }
    }
  }

  for (const area of request.declaredAreas ?? []) {
    const hinted = AREA_CATEGORY_HINTS[area];

    if (hinted) {
      scores.set(hinted, (scores.get(hinted) ?? 0) + 2);
      matchedTerms.set(hinted, [...(matchedTerms.get(hinted) ?? []), `declared area "${area}"`]);
    }
  }

  /*
   * Structural signals, independent of wording: a change spanning many features or explicitly
   * declared cross-cutting is an expansion whatever words were used to describe it.
   */
  if (input.matchedFeatureCount >= 4 || request.scope === 'cross_cutting') {
    scores.set('major_expansion', (scores.get('major_expansion') ?? 0) + 3);
    matchedTerms.set('major_expansion', [
      ...(matchedTerms.get('major_expansion') ?? []),
      request.scope === 'cross_cutting'
        ? 'declared cross-cutting scope'
        : `${input.matchedFeatureCount} features matched`,
    ]);
  }

  if (input.touchesDatabase) {
    scores.set('feature_addition', (scores.get('feature_addition') ?? 0) + 1);
    matchedTerms.set('feature_addition', [...(matchedTerms.get('feature_addition') ?? []), 'database tables matched']);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return {
      category: 'unknown',
      source: 'inferred',
      confidence: 'low',
      reasoning:
        'No classification signal was found in the request text, and the operator did not declare a category. Classify it manually before planning.',
      alternatives: [],
    };
  }

  const [topCategory, topScore] = ranked[0];
  const runnerUpScore = ranked[1]?.[1] ?? 0;

  /*
   * Confidence reflects how DECISIVE the winner was, not how many patterns fired: two categories
   * scoring equally means the text genuinely reads both ways, and saying so is more useful than
   * picking one.
   */
  const confidence: ImpactConfidence =
    topScore >= 4 && topScore > runnerUpScore + 1 ? 'medium' : topScore > runnerUpScore ? 'low' : 'low';

  const terms = [...new Set(matchedTerms.get(topCategory) ?? [])];

  return {
    category: topCategory,
    source: 'inferred',
    confidence,
    reasoning: `Inferred from the request text (${terms.map((term) => `"${term}"`).join(', ')}). Keyword classification is a heuristic — confirm it before planning engineering work.`,
    alternatives: ranked
      .slice(1)
      .filter(([, score]) => score >= topScore - 1)
      .map(([category]) => category),
  };
}
