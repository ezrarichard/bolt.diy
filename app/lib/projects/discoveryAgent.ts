import type { BusinessUnderstandingModelPatch } from '~/lib/builders-db/requirementsSessionDbTypes';
import type {
  BusinessUnderstandingModel,
  DiscoveryDecision,
  DiscoveryDimension,
} from '~/lib/projects/requirementsSession';

/**
 * Discovery Agent — Sprint 56 (Interview Mode Foundation).
 *
 * Per the Sprint 55 architecture doc §15's naming recommendation ("call the new module
 * discoveryAgent, not interviewMode ... the engine underneath should be named for what it
 * durably is, not for its first UI"). This module owns the two narrow, LLM-eventually-backed
 * jobs Sprint 55 §10 assigns the Discovery Agent — deciding what to ask next, and turning a
 * free-text answer into a `BusinessUnderstandingModelPatch` — but ships here with BOTH still
 * fully deterministic and LLM-free, exactly as Sprint 56/57 of the architecture doc's roadmap
 * (§16) specifies: "no LLM yet ... questions can be simple templates per dimension to prove the
 * loop chooses correctly and stops at READY."
 *
 * `selectNextDimension` is the Sprint 57 "Deterministic Question Planner" concept, implemented
 * early (in the Sprint 56 foundation) in its simplest form — dimension-weight ordering only, no
 * topic-locality override yet (architecture doc §2, point 4) — so the full turn loop (ask ->
 * answer -> advance -> stop at READY) is provably correct end-to-end before any AI phrasing work
 * begins.
 *
 * `buildInterviewPatch` is an explicit MOCK of Fact Extraction (architecture doc §11, Prompt B) —
 * a deterministic, literal mapping from (dimension, raw answer text) to the one
 * `BusinessUnderstandingModel` field that dimension corresponds to. It does not parse, infer, or
 * split multi-topic answers the way a real LLM extraction would (architecture doc §4's
 * "unprompted info" handling is NOT implemented here) — replacing this function's body is the
 * entire scope of the future Sprint 58 ("Discovery Agent — AI Question Phrasing & Fact
 * Extraction"). Everything downstream of it (`runBusinessAssessment`, `runDiscoveryDecision`) is
 * the real, already-shipped Sprint 53/54 deterministic engines, reused unchanged per the
 * architecture doc's core design thesis (§0) — those are not AI and are not mocked.
 */

/**
 * Mirrors `DIMENSION_WEIGHTS` in `discoveryDecisionEngine.ts` (not exported there, so the
 * ordering is duplicated here as a plain priority list) — highest-weight dimensions first, per
 * architecture doc §2 point 3 ("ask about the things that move the completeness score the most,
 * first").
 */
export const DISCOVERY_DIMENSION_ORDER: DiscoveryDimension[] = [
  'businessVision',
  'coreFeatures',
  'targetUsers',
  'industry',
  'businessAssessment',
  'projectType',
  'businessConstraints',
  'currentSystems',
  'integrations',
  'technicalPreferences',
];

/** One canned, conversational question per dimension — Sprint 57-style template, no AI phrasing yet (architecture doc §11 is Sprint 58 scope). */
export const INTERVIEW_QUESTION_TEMPLATES: Record<DiscoveryDimension, string> = {
  businessVision: 'Tell me about your business — what does it do, and who is it for?',
  targetUsers: 'Tell me about who this product is for.',
  coreFeatures: 'What are the core features your customers will need?',
  industry: 'What industry or type of business is this?',
  businessAssessment: 'How would you describe your business model — how do you make money?',
  projectType: 'Is this closer to a website, a marketplace, a CRM, or something else?',
  businessConstraints:
    'Are there any specific requirements — like payments, compliance, or shipping — I should know about?',
  currentSystems: 'Do you currently use any other systems or tools that this should work with?',
  integrations: 'Any integrations you need, like WhatsApp, email, or payment processors?',
  technicalPreferences: 'Do you have any technical preferences or constraints I should keep in mind?',
};

/** The assistant's final message once the Discovery Decision Engine reaches READY (architecture doc §1/§8, UX spec §8). */
export const INTERVIEW_READY_MESSAGE =
  "That's everything I need for now — want me to put together the Project Definition, or is there more you'd like to add?";

/** The greeting shown for a brand-new interview session (UX spec §1). */
export function buildInterviewGreeting(projectName: string | undefined): string {
  const name = projectName && projectName.trim().length > 0 ? projectName.trim() : 'this project';

  return `Hi — I'm here to help you describe ${name}. Just talk to me like you would a consultant. I'll ask what I need to know, and you can pause anytime.`;
}

/**
 * Which `BusinessUnderstandingModelPatch` key a given dimension's answer is written into —
 * shared between `buildInterviewPatch` (write) and the orchestrator's traceability entry (which
 * section a fact was attributed to), so the two can never drift apart.
 */
export const DIMENSION_TARGET_SECTION: Record<DiscoveryDimension, keyof BusinessUnderstandingModelPatch> = {
  businessVision: 'businessIdentity',
  targetUsers: 'targetUsers',
  coreFeatures: 'functionalRequirements',
  industry: 'businessIdentity',
  businessAssessment: 'businessIdentity',
  projectType: 'businessIdentity',
  businessConstraints: 'businessConstraints',
  currentSystems: 'currentSystems',
  integrations: 'currentSystems',
  technicalPreferences: 'businessIdentity',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
}

/**
 * Deterministic Question Planner — architecture doc §2's algorithm, simplified to its core
 * (weight-ordered dimension selection, dedupe against already-asked dimensions) without the
 * topic-locality override (§2 point 4), which is later-sprint refinement, not foundation scope.
 *
 * `decision` may be `{}` (a brand-new session that has never had a patch run against it yet) —
 * in that case every dimension is a candidate, since nothing has been assessed. Once
 * `decision.state === 'READY'`, this always returns `null` regardless of `partialAreas`
 * (architecture doc §1: "the moment a turn's recomputed decision flips to READY, the Question
 * Planner returns 'no next question' instead of picking one").
 */
export function selectNextDimension(
  decision: DiscoveryDecision,
  askedDimensions: DiscoveryDimension[],
): DiscoveryDimension | null {
  if (decision.state === 'READY') {
    return null;
  }

  const missing =
    decision.missingAreas && decision.missingAreas.length > 0
      ? decision.missingAreas
      : decision.state
        ? []
        : DISCOVERY_DIMENSION_ORDER;

  const partial = decision.partialAreas ?? [];

  const orderedFrom = (list: DiscoveryDimension[]) =>
    DISCOVERY_DIMENSION_ORDER.filter((dimension) => list.includes(dimension));

  const pool = missing.length > 0 ? orderedFrom(missing) : orderedFrom(partial);

  if (pool.length === 0) {
    return null;
  }

  const unasked = pool.find((dimension) => !askedDimensions.includes(dimension));

  return unasked ?? pool[0];
}

/**
 * Mock Fact Extraction — see this module's header comment. Merges the current model's
 * relevant sections with the one dimension the answer targets, so `runBusinessAssessment`/
 * `runDiscoveryDecision` (which read a full snapshot, not a delta — see
 * `buildInitialUnderstandingPatch`'s equivalent role for the Form) see the whole accumulated
 * picture, not just this turn's answer in isolation.
 */
export function buildInterviewPatch(
  model: BusinessUnderstandingModel,
  dimension: DiscoveryDimension,
  answerText: string,
): BusinessUnderstandingModelPatch {
  const trimmed = answerText.trim();
  const businessIdentity = asRecord(model.businessIdentity);
  const formSnapshot = asRecord(businessIdentity.formSnapshot);

  const patch: BusinessUnderstandingModelPatch = {
    businessIdentity,
    targetUsers: [...model.targetUsers],
    functionalRequirements: [...model.functionalRequirements],
    currentSystems: [...model.currentSystems],
    businessConstraints: [...model.businessConstraints],
  };

  switch (dimension) {
    case 'businessVision':
      businessIdentity.vision = trimmed;
      break;
    case 'targetUsers':
      patch.targetUsers = [...model.targetUsers, trimmed];
      break;
    case 'coreFeatures':
      patch.functionalRequirements = [...model.functionalRequirements, trimmed];
      break;
    case 'industry':
      businessIdentity.industry = trimmed;
      break;
    case 'businessAssessment':
      businessIdentity.businessModel = trimmed;
      break;
    case 'projectType':
      /*
       * No dedicated BusinessUnderstandingModel field for a raw "project type" statement
       * (assessment.projectType is *derived*, not stored input) — folded into vision text so the
       * deterministic Business Assessment Engine's keyword rules (which read `vision`) get the
       * signal, same as how a founder would naturally mention it while describing their vision.
       */
      businessIdentity.vision = businessIdentity.vision ? `${businessIdentity.vision as string} ${trimmed}` : trimmed;
      break;
    case 'businessConstraints':
      patch.businessConstraints = [...model.businessConstraints, trimmed];
      break;
    case 'currentSystems':
    case 'integrations':
      patch.currentSystems = [...model.currentSystems, trimmed];
      break;
    case 'technicalPreferences':
      formSnapshot.technicalPreferences = trimmed;
      businessIdentity.formSnapshot = formSnapshot;
      break;
    default:
      break;
  }

  patch.businessIdentity = businessIdentity;

  return patch;
}

export const discoveryAgent = {
  selectNextDimension,
  buildInterviewPatch,
  buildInterviewGreeting,
};
