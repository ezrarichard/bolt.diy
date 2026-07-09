import { blueprintEngine } from '~/lib/blueprints';
import { executionEngine, type BlockingTask, type ExecutionProgress } from './executionEngine';
import { reviewEngine, type ReviewSummary } from './reviewEngine';
import { isRequirementsCaptured } from './knowledge';
import { ARTIFACT_TYPES, formatArtifactTimestamp, getLatestArtifact, type ProjectArtifact } from './artifacts';
import { getProjectArtifacts, getProjectKnowledge, getRoadmapItemStatus, type Project } from '~/lib/stores/projects';

/**
 * AI Project Manager — Sprint 23.
 *
 *   Business Analyst -> Solution Architect -> Database Designer
 *     -> UI/UX Designer -> Backend Engineer -> Frontend Engineer
 *       -> QA Engineer -> DevOps Engineer -> AI Project Manager (this file)
 *         -> Generation Engine
 *
 * Every previous AI role produces one artifact and moves the project one
 * step forward. This role does not produce an artifact and does not move
 * the project forward — it looks at everything every other role, the Task
 * Engine, the Review Engine, and the Roadmap have produced so far and
 * decides whether the project is actually ready for code generation.
 *
 * Deterministic analysis only: every function here is a pure read over a
 * `Project`. No AI call, no prompt file, no LLM, no code generation, no
 * GitHub write, no file creation, no scaffolding, no deployment. Approving
 * or discarding an engineering draft, changing a task's status, and
 * reviewing a task all continue to happen exactly where they already do
 * (reviewEngine.ts / executionEngine.ts / the "*Panel" components) — this
 * file only reads the results of those decisions.
 */

export type EngineeringStageId =
  | 'requirements'
  | 'architecture'
  | 'database'
  | 'uiux'
  | 'backend'
  | 'frontend'
  | 'qa'
  | 'devops';

/**
 * The four states an engineering draft artifact can be in from the Project
 * Manager's point of view. `not-generated` covers "no artifact exists yet";
 * `discarded` is called out separately from `not-generated` because it
 * means work already happened and was rejected, not simply "not started".
 */
export type ArtifactReadinessStatus = 'not-generated' | 'draft' | 'discarded' | 'approved';

export interface EngineeringStageStatus {
  id: EngineeringStageId;
  label: string;
  artifactType: string;
  status: ArtifactReadinessStatus;
  detail: string;
}

export interface MissingArtifact {
  id: EngineeringStageId;
  label: string;
  reason: string;
}

export interface MissingApproval {
  id: EngineeringStageId;
  label: string;
  reason: string;
}

export interface BlockedTaskInfo {
  id: string;
  title: string;
  blockedBy: BlockingTask[];
}

export interface RoadmapHealth {
  total: number;
  completed: number;
  percentComplete: number;
}

export interface NextRecommendedAction {
  message: string;
  stageId?: EngineeringStageId;
}

export interface ReadinessResult {
  ready: boolean;
  reasons: string[];
}

export interface ProjectHealth {
  overallScore: number;
  requirementsStatus: EngineeringStageStatus;
  architectureStatus: EngineeringStageStatus;
  databaseStatus: EngineeringStageStatus;
  uiuxStatus: EngineeringStageStatus;
  backendStatus: EngineeringStageStatus;
  frontendStatus: EngineeringStageStatus;
  qaStatus: EngineeringStageStatus;
  devopsStatus: EngineeringStageStatus;
  reviewStatus: ReviewSummary;
  taskStatus: ExecutionProgress;
  roadmapStatus: RoadmapHealth;
  missingArtifacts: MissingArtifact[];
  missingApprovals: MissingApproval[];
  blockedTasks: BlockedTaskInfo[];
  warnings: string[];
  recommendations: string[];
  readyForGeneration: boolean;
  readinessBlockers: string[];
  nextRecommendedAction: NextRecommendedAction;
}

/**
 * The eight engineering roles in pipeline order — same order every engine's
 * `canGenerateX` gate already enforces (each one requires the previous
 * stage's draft to be approved; see solutionArchitectEngine.ts through
 * devopsEngineerEngine.ts). Defined once here so every function below
 * derives from the same ordering rather than re-typing it.
 */
const STAGE_CONFIGS: { id: EngineeringStageId; label: string; artifactType: string }[] = [
  { id: 'requirements', label: 'Requirements', artifactType: ARTIFACT_TYPES.REQUIREMENTS_DRAFT },
  { id: 'architecture', label: 'Architecture', artifactType: ARTIFACT_TYPES.ARCHITECTURE_DRAFT },
  { id: 'database', label: 'Database Design', artifactType: ARTIFACT_TYPES.DATABASE_DRAFT },
  { id: 'uiux', label: 'UI/UX Design', artifactType: ARTIFACT_TYPES.UIUX_DRAFT },
  { id: 'backend', label: 'Backend', artifactType: ARTIFACT_TYPES.BACKEND_DRAFT },
  { id: 'frontend', label: 'Frontend', artifactType: ARTIFACT_TYPES.FRONTEND_DRAFT },
  { id: 'qa', label: 'QA Strategy', artifactType: ARTIFACT_TYPES.QA_DRAFT },
  { id: 'devops', label: 'DevOps Strategy', artifactType: ARTIFACT_TYPES.DEVOPS_DRAFT },
];

function resolveStageStatus(
  artifacts: ProjectArtifact[],
  config: (typeof STAGE_CONFIGS)[number],
): EngineeringStageStatus {
  const latest = getLatestArtifact(artifacts, config.artifactType);

  if (!latest) {
    return {
      id: config.id,
      label: config.label,
      artifactType: config.artifactType,
      status: 'not-generated',
      detail: 'Not generated yet.',
    };
  }

  if (latest.status === 'approved') {
    return {
      id: config.id,
      label: config.label,
      artifactType: config.artifactType,
      status: 'approved',
      detail: `Approved v${latest.version ?? 1} · ${formatArtifactTimestamp(latest.updatedAt)}`,
    };
  }

  if (latest.status === 'discarded') {
    return {
      id: config.id,
      label: config.label,
      artifactType: config.artifactType,
      status: 'discarded',
      detail: `v${latest.version ?? 1} discarded — needs regeneration.`,
    };
  }

  /*
   * 'draft' (the normal pending case), plus the legacy 'placeholder'/'final'
   * statuses — neither is ever produced by these eight draft artifacts, but
   * folding them into 'draft' keeps this exhaustive without a throw.
   */
  return {
    id: config.id,
    label: config.label,
    artifactType: config.artifactType,
    status: 'draft',
    detail: `Awaiting approval (v${latest.version ?? 1}).`,
  };
}

function getStageStatuses(project: Project): EngineeringStageStatus[] {
  const artifacts = getProjectArtifacts(project);
  return STAGE_CONFIGS.map((config) => resolveStageStatus(artifacts, config));
}

function getRoadmapHealth(project: Project): RoadmapHealth {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const roadmap = blueprintEngine.getRoadmap(blueprint.id);
  const completed = roadmap.filter((item) => getRoadmapItemStatus(project, item.key) === 'completed').length;
  const total = roadmap.length;

  return { total, completed, percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0 };
}

/**
 * Every stage whose draft either doesn't exist yet or was discarded and
 * needs regenerating. Distinguishes "blocked by an earlier unapproved
 * stage" from "simply hasn't been generated yet" so the reason is always
 * actionable.
 */
function getMissingArtifacts(project: Project): MissingArtifact[] {
  const stages = getStageStatuses(project);

  return stages.reduce<MissingArtifact[]>((missing, stage, index) => {
    if (stage.status !== 'not-generated' && stage.status !== 'discarded') {
      return missing;
    }

    const previousStage = index > 0 ? stages[index - 1] : undefined;
    const reason =
      previousStage && previousStage.status !== 'approved'
        ? `Blocked — ${previousStage.label} must be approved first.`
        : stage.status === 'discarded'
          ? `${stage.label} Draft was discarded and needs to be regenerated.`
          : `${stage.label} Draft has not been generated yet.`;

    return [...missing, { id: stage.id, label: stage.label, reason }];
  }, []);
}

/** Every stage whose draft exists but is still awaiting a human approval decision. */
function getMissingApprovals(project: Project): MissingApproval[] {
  return getStageStatuses(project)
    .filter((stage) => stage.status === 'draft')
    .map((stage) => ({
      id: stage.id,
      label: stage.label,
      reason: `${stage.label} Draft is generated but not yet approved.`,
    }));
}

/** Every currently-blocked execution task, with the still-incomplete dependencies holding it back. */
function getBlockedItems(project: Project): BlockedTaskInfo[] {
  return executionEngine
    .getExecutionTasks(project)
    .filter((task) => task.status === 'blocked')
    .map((task) => ({ id: task.id, title: task.title, blockedBy: executionEngine.getBlockedReason(project, task.id) }));
}

/**
 * Deterministic, prioritized punch list — capturing requirements first
 * (nothing downstream is trustworthy without it), then approvals, then
 * ungenerated stages, then the task/review queue. Never AI-written; every
 * line is templated from state this file already computed.
 */
function getRecommendations(project: Project): string[] {
  const recommendations: string[] = [];
  const missingApprovals = getMissingApprovals(project);
  const missingArtifacts = getMissingArtifacts(project);
  const blockedTasks = getBlockedItems(project);
  const reviewSummary = reviewEngine.getReviewSummary(project);

  if (!isRequirementsCaptured(getProjectKnowledge(project))) {
    recommendations.push('Capture Project Knowledge (Requirements) before relying on any generated draft.');
  }

  if (missingApprovals.length > 0) {
    recommendations.push(`Review and approve: ${missingApprovals.map((entry) => entry.label).join(', ')}.`);
  }

  const nextUngenerated = missingArtifacts.find((entry) => !entry.reason.startsWith('Blocked'));

  if (nextUngenerated) {
    recommendations.push(`Generate the ${nextUngenerated.label} Draft next.`);
  }

  if (reviewSummary.pending > 0) {
    recommendations.push(`${reviewSummary.pending} task review(s) are pending — clear the review queue.`);
  }

  if (blockedTasks.length > 0) {
    recommendations.push(`${blockedTasks.length} task(s) are blocked on unresolved dependencies.`);
  }

  if (recommendations.length === 0) {
    recommendations.push('Project looks healthy — ready for code generation.');
  }

  return recommendations;
}

/**
 * Weighted 0-100 score: engineering-stage approval carries the most weight
 * (50%), since an unapproved draft means downstream work is standing on an
 * unreviewed foundation; task completion (30%) and roadmap completion (10%)
 * follow; the review queue (10%) penalizes an accumulating backlog. Purely
 * arithmetic — no AI judgment call.
 */
function calculateReadiness(project: Project): number {
  const stages = getStageStatuses(project);
  const approvedCount = stages.filter((stage) => stage.status === 'approved').length;
  const stageScore = (approvedCount / STAGE_CONFIGS.length) * 100;

  const taskProgress = executionEngine.getExecutionProgress(project);
  const roadmap = getRoadmapHealth(project);
  const reviewSummary = reviewEngine.getReviewSummary(project);
  const reviewScore =
    taskProgress.total > 0 ? Math.max(0, 100 - (reviewSummary.pending / taskProgress.total) * 100) : 100;

  const weighted =
    stageScore * 0.5 + taskProgress.percentComplete * 0.3 + roadmap.percentComplete * 0.1 + reviewScore * 0.1;

  return Math.round(weighted);
}

/**
 * The hard gate: ready for code generation only if every engineering
 * artifact is approved, every task is complete, no review is pending, and
 * no task is blocked. Any failing condition is reported back as a plain-
 * text reason rather than just a boolean.
 */
function isReadyForGeneration(project: Project): ReadinessResult {
  const reasons: string[] = [];
  const stages = getStageStatuses(project);
  const notApproved = stages.filter((stage) => stage.status !== 'approved');

  if (notApproved.length > 0) {
    reasons.push(
      `${notApproved.length} of ${STAGE_CONFIGS.length} engineering artifact(s) not yet approved: ${notApproved
        .map((stage) => stage.label)
        .join(', ')}.`,
    );
  }

  const taskProgress = executionEngine.getExecutionProgress(project);

  if (taskProgress.total > 0 && taskProgress.completed < taskProgress.total) {
    reasons.push(`${taskProgress.total - taskProgress.completed} of ${taskProgress.total} task(s) not yet complete.`);
  }

  const reviewSummary = reviewEngine.getReviewSummary(project);

  if (reviewSummary.pending > 0) {
    reasons.push(`${reviewSummary.pending} task review(s) still pending.`);
  }

  if (taskProgress.blocked > 0) {
    reasons.push(`${taskProgress.blocked} task(s) are blocked.`);
  }

  return { ready: reasons.length === 0, reasons };
}

/**
 * The single next thing the project needs — walks the pipeline in order and
 * stops at the first stage that isn't approved yet (mirrors how each
 * engine's own `canGenerateX` gate reads the pipeline), then falls back to
 * the review queue, then blocked tasks, then remaining task work.
 *
 * Sprint 38.5 — extended past the original "ready for code generation" stopping point to
 * cover the rest of the lifecycle (Product Package, code generation, resume), reading
 * `project.workspaceState` (see app/lib/projects/workspaceState.ts) for the signals no
 * earlier sprint tracked. `generatedApplicationExists` deliberately short-circuits ahead
 * of the task/review/roadmap checks below it: once an application exists, "keep building
 * on what you have" is always the more useful next step than "go finish unrelated
 * planning tasks" — matches the Task 3 UI spec's "Continue Development" primary action.
 */
function getNextRecommendedAction(project: Project): NextRecommendedAction {
  if (!isRequirementsCaptured(getProjectKnowledge(project))) {
    return { message: 'Capture Project Knowledge (Requirements) to get started.', stageId: 'requirements' };
  }

  const firstUnapproved = getStageStatuses(project).find((stage) => stage.status !== 'approved');

  if (firstUnapproved) {
    const message =
      firstUnapproved.status === 'draft'
        ? `Review and approve the ${firstUnapproved.label} Draft.`
        : `Generate the ${firstUnapproved.label} Draft.`;

    return { message, stageId: firstUnapproved.id };
  }

  if (project.workspaceState?.generatedApplicationExists) {
    return { message: 'Continue Development — your generated application is ready to keep building on.' };
  }

  const reviewSummary = reviewEngine.getReviewSummary(project);

  if (reviewSummary.pending > 0) {
    return { message: `${reviewSummary.pending} task review(s) pending — clear the review queue.` };
  }

  const blockedTasks = getBlockedItems(project);

  if (blockedTasks.length > 0) {
    return { message: `${blockedTasks.length} task(s) are blocked — resolve their dependencies.` };
  }

  const taskProgress = executionEngine.getExecutionProgress(project);

  if (taskProgress.completed < taskProgress.total) {
    return { message: 'Continue working through the remaining tasks in the Task Execution Plan.' };
  }

  if (!project.workspaceState?.productPackageAssembled) {
    return { message: 'Assemble the Product Package to prepare for code generation.' };
  }

  return { message: 'Generate the application from your assembled Product Package.' };
}

/** The single entry point the Dashboard (and any future consumer) should call — everything else above is exported for reuse/testing. */
function analyzeProject(project: Project): ProjectHealth {
  const [
    requirementsStatus,
    architectureStatus,
    databaseStatus,
    uiuxStatus,
    backendStatus,
    frontendStatus,
    qaStatus,
    devopsStatus,
  ] = getStageStatuses(project);

  const reviewStatus = reviewEngine.getReviewSummary(project);
  const taskStatus = executionEngine.getExecutionProgress(project);
  const roadmapStatus = getRoadmapHealth(project);
  const missingArtifacts = getMissingArtifacts(project);
  const missingApprovals = getMissingApprovals(project);
  const blockedTasks = getBlockedItems(project);
  const readiness = isReadyForGeneration(project);

  const warnings: string[] = [];

  if (!isRequirementsCaptured(getProjectKnowledge(project))) {
    warnings.push('Project Knowledge (Requirements) has not been captured yet.');
  }

  for (const entry of missingArtifacts) {
    warnings.push(entry.reason);
  }

  for (const entry of missingApprovals) {
    warnings.push(entry.reason);
  }

  if (taskStatus.blocked > 0) {
    warnings.push(`${taskStatus.blocked} task(s) are blocked.`);
  }

  if (reviewStatus.pending > 0) {
    warnings.push(`${reviewStatus.pending} task review(s) are pending.`);
  }

  return {
    overallScore: calculateReadiness(project),
    requirementsStatus,
    architectureStatus,
    databaseStatus,
    uiuxStatus,
    backendStatus,
    frontendStatus,
    qaStatus,
    devopsStatus,
    reviewStatus,
    taskStatus,
    roadmapStatus,
    missingArtifacts,
    missingApprovals,
    blockedTasks,
    warnings,
    recommendations: getRecommendations(project),
    readyForGeneration: readiness.ready,
    readinessBlockers: readiness.reasons,
    nextRecommendedAction: getNextRecommendedAction(project),
  };
}

export const projectManagerEngine = {
  analyzeProject,
  calculateReadiness,
  getMissingArtifacts,
  getMissingApprovals,
  getBlockedItems,
  getRecommendations,
  isReadyForGeneration,
  getNextRecommendedAction,
};
