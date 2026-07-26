import { blueprintEngine } from '~/lib/blueprints';
import { executionEngine } from './executionEngine';
import { projectKnowledgeEngine } from './projectKnowledgeEngine';
import { isRequirementsCaptured, type ProjectKnowledge } from './knowledge';
import {
  ARTIFACT_TYPES,
  createArtifact,
  getApprovedArtifactContent,
  getLatestApprovedArtifact,
  type ProjectArtifact,
} from './artifacts';
import { extractJsonPayload, looksTruncated, type ParsedDraftResult } from './draftParsing';
import {
  gatherAIDecisions,
  gatherEngineeringNotes,
  type AIDecisionEntry,
  type EngineeringNoteEntry,
} from './collaborationContext';
import {
  getProjectArtifacts,
  getProjectKnowledge,
  getRoadmapItemStatus,
  getTaskNotes,
  type Project,
} from '~/lib/stores/projects';
import {
  buildProductOwnerUserPrompt,
  PRODUCT_OWNER_SYSTEM_PROMPT,
  type CurrentMvpPlan,
  type EngineeringHandoff,
  type HandoffFeatureRef,
  type MoscowPriority,
  type ProductOwnerDraft,
  type ProductOwnerFeature,
  type ProductOwnerRisk,
  type RiskSeverity,
  type RoadmapSkeletonEntry,
} from './prompts/productOwner';
import type { RequirementsDraft } from './prompts/requirements';

/**
 * AI Product Owner Engine — Sprint 46B.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Tasks
 *     -> Execution -> Review -> Approval -> Artifacts
 *       -> Business Analyst -> Product Owner Engine (this file) -> AI Generation
 *
 * Same shape as solutionArchitectEngine.ts: pure orchestration (context gathering, prompt
 * building, parsing), no LLM call, no React, no prompt strings inlined here (those live in
 * prompts/productOwner.ts). Belongs to the PRODUCT PLANNING phase, not Engineering — it is
 * the bridge between Business Analyst (Business Planning) and Solution Architect
 * (Engineering), not a ninth engineering role. See
 * docs/02-Architecture/02-ai-product-owner.md and docs/05-AI-Product-Owner/.
 *
 * Deliberately does NOT auto-approve like the other 8 roles — see
 * app/lib/hooks/useAutoEngineeringPipeline.ts's productowner special case, and
 * docs/05-AI-Product-Owner/05-customer-review-workflow.md's Gate A.
 */

export interface ProductOwnerContext {
  project: { name: string; description?: string; icon: string };
  blueprint: {
    id: string;
    name: string;
    category: string;
    productType?: string;
    recommendedStack: string[];
    recommendedIntegrations: string[];
  };
  knowledge: ProjectKnowledge | undefined;
  knowledgeCompletion: number;

  /** The approved Business Analyst output in full — the Product Owner is the immediately-next role. */
  requirementsDraft: RequirementsDraft | undefined;
  engineeringNotes: EngineeringNoteEntry[];
  aiDecisions: AIDecisionEntry[];
  roadmap: { title: string; description: string; status: string }[];
  tasks: { title: string; category: string; status: string }[];
  existingNotes: string;

  /**
   * Sprint 46B — always 1 in this sprint's scope: MVP generation beyond MVP 1 is explicitly
   * out of scope (see this sprint's implementation report). Once cross-MVP planning exists
   * (Sprint 47+), this should be derived from the project's actual persisted MVP roadmap
   * (app/lib/mvp/mvpRepository.ts) instead of being hardcoded.
   */
  nextMvpSequence: number;
}

export type ParsedProductOwnerDraft = ParsedDraftResult<ProductOwnerDraft>;

const GENERATOR_NAME = 'AI Product Owner';
const ARTIFACT_TYPE = ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT;

/** Same anchor every project-level (non-task-specific) artifact uses — see solutionArchitectEngine.ts's identical comment. */
const ARTIFACT_TASK_ID = 'requirements';

/**
 * Every engineering artifact type that existed BEFORE the Product Owner role (Sprint 46B).
 * Used only for the legacy-project bypass below — never for any other purpose.
 */
const LEGACY_ENGINEERING_ARTIFACT_TYPES = [
  ARTIFACT_TYPES.ARCHITECTURE_DRAFT,
  ARTIFACT_TYPES.DATABASE_DRAFT,
  ARTIFACT_TYPES.UIUX_DRAFT,
  ARTIFACT_TYPES.BACKEND_DRAFT,
  ARTIFACT_TYPES.FRONTEND_DRAFT,
  ARTIFACT_TYPES.QA_DRAFT,
  ARTIFACT_TYPES.DEVOPS_DRAFT,
];

/**
 * True if this project already has an approved engineering artifact (Architecture-or-later)
 * from BEFORE the Product Owner role existed. Backward compatibility: a project that already
 * progressed past where the Product Owner would have run must never be retroactively blocked
 * on producing one now — mirrors `isProjectDefinitionApproved`'s identical backward-compat
 * pattern in autoEngineeringEngine.ts. Exported so solutionArchitectEngine.ts's own gate can
 * reuse this exact check rather than re-deriving it.
 */
export function hasLegacyEngineeringProgress(project: Project): boolean {
  const artifacts = getProjectArtifacts(project);
  return LEGACY_ENGINEERING_ARTIFACT_TYPES.some((type) => getLatestApprovedArtifact(artifacts, type) !== undefined);
}

/**
 * Requirements/Project Knowledge is the substantive precondition (same check
 * solutionArchitectEngine.canGenerateArchitecture uses) — but a legacy project that already
 * has engineering progress from before this role existed should never be asked to produce a
 * Product Owner draft: it already passed this point in the pipeline under the old flow.
 */
function canGenerateProductOwner(project: Project): boolean {
  return isRequirementsCaptured(getProjectKnowledge(project)) && !hasLegacyEngineeringProgress(project);
}

/** Gathers Project + Blueprint + approved Requirements/Project Knowledge + Roadmap + Tasks + Notes — same pattern as solutionArchitectEngine.buildArchitectureContext. */
function buildProductOwnerContext(project: Project): ProductOwnerContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);
  const artifacts = getProjectArtifacts(project);
  const requirementsDraft = getApprovedArtifactContent<RequirementsDraft>(artifacts, ARTIFACT_TYPES.REQUIREMENTS_DRAFT);

  const roadmap = blueprintEngine.getRoadmap(blueprint.id).map((item) => ({
    title: item.title,
    description: item.description,
    status: getRoadmapItemStatus(project, item.key),
  }));

  const tasks = executionEngine.getExecutionTasks(project).map((task) => ({
    title: task.title,
    category: task.category,
    status: task.status,
  }));

  const existingNotes = [knowledge?.notes, getTaskNotes(project, ARTIFACT_TASK_ID)].filter(Boolean).join('\n\n');

  return {
    project: { name: project.name, description: project.description, icon: project.icon },
    blueprint: {
      id: blueprint.id,
      name: blueprint.name,
      category: blueprint.category,
      productType: blueprint.productType,
      recommendedStack: blueprintEngine.getRecommendedStack(blueprint.id),
      recommendedIntegrations: blueprintEngine.getRecommendedIntegrations(blueprint.id),
    },
    knowledge,
    knowledgeCompletion: projectKnowledgeEngine.getCompletion(knowledge).overall,
    requirementsDraft,
    engineeringNotes: gatherEngineeringNotes(artifacts, 'Product Owner'),
    aiDecisions: gatherAIDecisions(artifacts, 'Product Owner'),
    roadmap,
    tasks,
    existingNotes,
    nextMvpSequence: 1,
  };
}

function buildProductOwnerPrompt(context: ProductOwnerContext): { system: string; prompt: string } {
  return {
    system: PRODUCT_OWNER_SYSTEM_PROMPT,
    prompt: buildProductOwnerUserPrompt(context),
  };
}

// ── Bespoke parsing (see prompts/productOwner.ts's header comment for why) ──

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

const MOSCOW_VALUES: MoscowPriority[] = ['Must Have', 'Should Have', 'Could Have', "Won't Have"];
const SEVERITY_VALUES: RiskSeverity[] = ['Critical', 'High', 'Medium', 'Low'];

function toMoscow(value: unknown): MoscowPriority | undefined {
  return typeof value === 'string' && (MOSCOW_VALUES as string[]).includes(value)
    ? (value as MoscowPriority)
    : undefined;
}

function toSeverity(value: unknown): RiskSeverity | undefined {
  return typeof value === 'string' && (SEVERITY_VALUES as string[]).includes(value)
    ? (value as RiskSeverity)
    : undefined;
}

/**
 * Sprint 46C — permanent MVP identifier, derived from `sequence` (a stable, semantically
 * meaningful field the Product Owner assigns deliberately) rather than array position.
 * Deterministic and needs no prior state: the SAME sequence always produces the SAME id, so
 * `roadmapSkeleton` entries and `currentMvp` never disagree with each other, even across
 * regenerations. See docs/05-AI-Product-Owner/08-identity-and-traceability.md for why this
 * differs from feature IDs (which DO need carry-forward state — see assignFeatureIds below).
 */
function formatMvpId(sequence: number): string {
  return `MVP-${String(sequence).padStart(3, '0')}`;
}

function formatFeatureId(counter: number): string {
  return `FEAT-${String(counter).padStart(3, '0')}`;
}

function parseFeatureIdCounter(id: string): number {
  const match = /^FEAT-(\d+)$/.exec(id);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Sprint 81 (Cross-MVP Foundation) — a committed, project-wide Feature identity `assignFeatureIds`
 * can carry forward against, sourced from `featureRepository.listFeaturesForProject` (real,
 * persisted `Feature` rows spanning every MVP), not just the current MVP's own previous draft.
 * Deliberately just `{ id, name }` — the two fields `assignFeatureIds`' name-matching/counter-seed
 * logic actually needs — rather than the full `Feature` shape, so this engine (which has no
 * BuildersDB access of its own, see this file's header) stays decoupled from the repository
 * layer's row shape; the caller adapts real `Feature` rows (`code` -> `id`, `title` -> `name`)
 * before passing them in.
 */
export interface CommittedFeatureIdentity {
  id: string;
  name: string;
}

/**
 * Sprint 46C — assigns permanent feature IDs. NOT derived from array position (a reorder
 * would reassign every ID) or from `name` (a rename would orphan every downstream reference)
 * — see prompts/productOwner.ts's `ProductOwnerFeature.id` comment. Instead: a feature whose
 * `name` exactly matches (case-insensitively) a feature from the PREVIOUS draft carries that
 * feature's id forward; anything unmatched (a genuinely new feature) gets the next unused
 * counter value. A rename therefore does get treated as "new" — a deliberate, documented
 * limitation (see docs/05-AI-Product-Owner/08-identity-and-traceability.md) rather than a
 * silent bug: without title-based matching there is no other signal available, and this
 * codebase's own instructions for this sprint explicitly reject deriving the ID itself from
 * title or position, not the (separate) question of using title as a carry-forward heuristic.
 *
 * Sprint 81 (Cross-MVP Foundation) — `committedProjectFeatures` (optional, default `[]`) extends
 * both the name-matching pool AND the counter seed with every Feature ALREADY COMMITTED anywhere
 * in the project (not just this MVP's own prior draft — see
 * docs/product-management/Product-Management-Architecture.md Part 0/1's finding that the
 * previous behavior would let two different MVPs each mint their own unrelated "FEAT-001").
 * Listed FIRST in the merged pool so a name match against an already-committed, real Feature
 * always wins over a same-named match still sitting only in a draft (a committed identity is
 * more authoritative than an uncommitted one). This is what makes retrying/regenerating a NEW
 * MVP's plan deterministic: the next available code is always computed from the same
 * project-wide history, never from an empty "no previous draft" state that would otherwise
 * restart the counter at `FEAT-001` for every new MVP.
 */
function assignFeatureIds(
  features: Omit<ProductOwnerFeature, 'id'>[],
  previousFeatures: ProductOwnerFeature[] | undefined,
  committedProjectFeatures: CommittedFeatureIdentity[] = [],
): ProductOwnerFeature[] {
  const previous = previousFeatures ?? [];
  const known: CommittedFeatureIdentity[] = [
    ...committedProjectFeatures,
    ...previous.map((feature) => ({ id: feature.id, name: feature.name })),
  ];

  const byName = new Map<string, string>();

  for (const entry of known) {
    const key = entry.name.trim().toLowerCase();

    /*
     * First-wins: committedProjectFeatures is listed first, so an already-committed identity is
     * never overridden by a same-named match from an uncommitted draft.
     */
    if (!byName.has(key)) {
      byName.set(key, entry.id);
    }
  }

  let nextCounter = 1 + known.reduce((max, entry) => Math.max(max, parseFeatureIdCounter(entry.id)), 0);

  return features.map((feature) => {
    const matchedId = byName.get(feature.name.trim().toLowerCase());

    if (matchedId) {
      return { ...feature, id: matchedId };
    }

    const id = formatFeatureId(nextCounter);
    nextCounter += 1;

    return { ...feature, id };
  });
}

function toRoadmapEntry(entry: unknown): RoadmapSkeletonEntry | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const sequence = typeof record.sequence === 'number' ? record.sequence : undefined;
  const theme = typeof record.theme === 'string' ? record.theme.trim() : '';

  if (sequence === undefined || !theme) {
    return undefined;
  }

  const targetRelease =
    typeof record.targetRelease === 'string' && record.targetRelease.trim() ? record.targetRelease.trim() : undefined;
  const estimatedEffort =
    typeof record.estimatedEffort === 'string' && ['small', 'medium', 'large'].includes(record.estimatedEffort)
      ? (record.estimatedEffort as RoadmapSkeletonEntry['estimatedEffort'])
      : undefined;

  return { id: formatMvpId(sequence), sequence, theme, targetRelease, estimatedEffort };
}

/** Builds a feature WITHOUT its `id` yet — ID assignment happens once, across the whole feature list, in assignFeatureIds (needs to see every feature and the previous draft together, not one at a time). */
function toFeatureDraft(entry: unknown): Omit<ProductOwnerFeature, 'id'> | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const priority = toMoscow(record.priority);

  if (!name || !priority) {
    return undefined;
  }

  return {
    name,
    description: typeof record.description === 'string' ? record.description.trim() : '',
    priority,
    dependsOn: toStringArray(record.dependsOn),
    customerValue: typeof record.customerValue === 'string' ? record.customerValue.trim() : '',
  };
}

function toRisk(entry: unknown): ProductOwnerRisk | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  const severity = toSeverity(record.severity);

  if (!description || !severity) {
    return undefined;
  }

  const mitigation =
    typeof record.mitigation === 'string' && record.mitigation.trim() ? record.mitigation.trim() : undefined;

  return { description, severity, mitigation };
}

/**
 * Sprint 46C — parses only the free-text sections of the engineering handoff. `features` is
 * deliberately NOT parsed here: it's mechanically derived from `currentMvp.features` (which
 * already carries its own priority and, after assignFeatureIds runs, a stable id) rather than
 * trusting the model to restate feature/priority pairs a second time under a different key —
 * see toCurrentMvp below, the only caller.
 */
function toEngineeringHandoffDraft(value: unknown): Omit<EngineeringHandoff, 'features'> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  return {
    scope: toStringArray(record.scope),
    constraints: toStringArray(record.constraints),
    architectureGoals: toStringArray(record.architectureGoals),
    successCriteria: toStringArray(record.successCriteria),
    acceptanceCriteria: toStringArray(record.acceptanceCriteria),
    outOfScopeFeatures: toStringArray(record.outOfScopeFeatures),
    dependencies: toStringArray(record.dependencies),
  };
}

function toCurrentMvp(
  value: unknown,
  previousMvp: CurrentMvpPlan | undefined,
  committedProjectFeatures: CommittedFeatureIdentity[] = [],
): CurrentMvpPlan | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const sequence = typeof record.sequence === 'number' ? record.sequence : undefined;
  const draftFeatures = Array.isArray(record.features)
    ? record.features.map(toFeatureDraft).filter((item): item is Omit<ProductOwnerFeature, 'id'> => Boolean(item))
    : [];
  const engineeringHandoffDraft = toEngineeringHandoffDraft(record.engineeringHandoff);

  // A valid current-MVP plan must have a sequence, at least one feature, and an engineering handoff — anything less isn't usable by downstream roles.
  if (sequence === undefined || draftFeatures.length === 0 || !engineeringHandoffDraft) {
    return undefined;
  }

  // Sprint 46C — assigns permanent feature IDs, carrying forward matches from the previous MVP plan (if this is a regeneration) AND every already-committed Feature project-wide (Sprint 81) — see assignFeatureIds's own comment.
  const features = assignFeatureIds(draftFeatures, previousMvp?.features, committedProjectFeatures);

  const handoffFeatures: HandoffFeatureRef[] = features
    .filter((feature) => feature.priority !== "Won't Have")
    .map((feature) => ({ id: feature.id, name: feature.name, priority: feature.priority }));

  return {
    id: formatMvpId(sequence),
    sequence,
    features,
    acceptanceCriteria: toStringArray(record.acceptanceCriteria),
    risks: Array.isArray(record.risks)
      ? record.risks.map(toRisk).filter((item): item is ProductOwnerRisk => Boolean(item))
      : [],
    assumptions: toStringArray(record.assumptions),
    openQuestions: toStringArray(record.openQuestions),
    technicalConstraints: toStringArray(record.technicalConstraints),
    businessConstraints: toStringArray(record.businessConstraints),
    successMetrics: toStringArray(record.successMetrics),
    exitCriteria: toStringArray(record.exitCriteria),
    engineeringHandoff: { ...engineeringHandoffDraft, features: handoffFeatures },
  };
}

/**
 * Bespoke parser for the Product Owner's nested draft shape — see prompts/productOwner.ts's
 * header comment for why this doesn't go through the shared `parseStructuredDraft`. Reuses
 * `extractJsonPayload`/`looksTruncated` (the genuinely generic pieces of draftParsing.ts) for
 * JSON extraction and truncation detection, then validates field-by-field, silently dropping
 * invalid entries rather than failing the whole draft — same philosophy as the shared parser.
 *
 * Sprint 46C — `previousDraft` is optional and, if given, its `currentMvp.features` are used
 * to carry forward matching features' permanent IDs (see assignFeatureIds). This param is
 * NOT part of the shared `AutoEngineeringRole.parseDraft` / `DraftPanelConfig.parseDraft`
 * signature (both call with one argument only) — `ProductOwnerDraftPanel.tsx` supplies it by
 * wrapping this function in a closure over its own `latestDraft` before handing it to
 * `useDraftPanel`, rather than this file (or any shared hook) needing to change its contract.
 * Omitting it (the automatic pipeline's first-ever generation, or any caller that doesn't have
 * prior state) is always safe: every feature is simply treated as new and gets the next
 * available id starting from FEAT-001.
 *
 * Sprint 81 (Cross-MVP Foundation) — `committedProjectFeatures` (optional, third argument) is the
 * project-wide carry-forward source `assignFeatureIds` now also draws on (see that function's own
 * comment). Same "supplied by the caller, not read here" discipline as `previousDraft`: this
 * engine has no BuildersDB access of its own, so a caller planning a NEW MVP is expected to fetch
 * `featureRepository.listFeaturesForProject(project.id)` and adapt it (`code` -> `id`, `title` ->
 * `name`) before calling this. Omitted (defaults to `[]`) for every existing call site — behavior
 * is byte-for-byte unchanged from before this sprint when this argument isn't supplied.
 */
function parseDraft(
  rawText: string,
  previousDraft?: ProductOwnerDraft,
  committedProjectFeatures: CommittedFeatureIdentity[] = [],
): ParsedProductOwnerDraft {
  const payload = extractJsonPayload(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    if (looksTruncated(payload)) {
      return { ok: false, error: 'The AI response was cut off before completing valid JSON. Please regenerate.' };
    }

    return { ok: false, error: 'The AI response was not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The AI response was not a JSON object.' };
  }

  const source = parsed as Record<string, unknown>;
  const currentMvp = toCurrentMvp(source.currentMvp, previousDraft?.currentMvp, committedProjectFeatures);

  if (!currentMvp) {
    return {
      ok: false,
      error:
        'The AI response was missing a valid currentMvp plan (needs a sequence, at least one feature, and an engineering handoff). Please regenerate.',
    };
  }

  const draft: ProductOwnerDraft = {
    productVision: typeof source.productVision === 'string' ? source.productVision.trim() : undefined,
    businessObjectives: toStringArray(source.businessObjectives),
    productScope:
      source.productScope && typeof source.productScope === 'object'
        ? {
            inScope: toStringArray((source.productScope as Record<string, unknown>).inScope),
            outOfScope: toStringArray((source.productScope as Record<string, unknown>).outOfScope),
          }
        : undefined,
    roadmapSkeleton: Array.isArray(source.roadmapSkeleton)
      ? source.roadmapSkeleton.map(toRoadmapEntry).filter((item): item is RoadmapSkeletonEntry => Boolean(item))
      : [],
    currentMvp,
    futureEnhancements: toStringArray(source.futureEnhancements),
    engineeringNotes: typeof source.engineeringNotes === 'string' ? source.engineeringNotes.trim() : undefined,
  };

  return { ok: true, draft };
}

/** Builds a Product Owner Draft artifact holding the parsed draft as JSON. Never auto-approved — see this engine's header comment. */
function createDraftArtifact(draft: ProductOwnerDraft, version: number): ProjectArtifact {
  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Product Owner Draft v${version}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(draft, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

export const productOwnerEngine = {
  canGenerateProductOwner,
  hasLegacyEngineeringProgress,
  buildProductOwnerContext,
  buildProductOwnerPrompt,
  parseDraft,
  createDraftArtifact,
};
