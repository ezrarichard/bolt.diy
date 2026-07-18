import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { ARTIFACT_TYPES, getLatestApprovedArtifact, type ProjectArtifact } from './artifacts';
import type { ParsedDraftResult } from './draftParsing';
import { solutionArchitectEngine } from './solutionArchitectEngine';
import { databaseDesignerEngine } from './databaseDesignerEngine';
import { uiuxDesignerEngine } from './uiuxDesignerEngine';
import { backendEngineerEngine } from './backendEngineerEngine';
import { frontendEngineerEngine } from './frontendEngineerEngine';
import { qaEngineerEngine } from './qaEngineerEngine';
import { devopsEngineerEngine } from './devopsEngineerEngine';

/**
 * Autonomous AI Engineering pipeline — Sprint 31 ("Autonomous AI Engineering
 * Pipeline").
 *
 *   Requirements (human-approved, unchanged)
 *     -> Solution Architect -> Database Engineer -> UI/UX Engineer
 *       -> Backend Engineer -> Frontend Engineer -> QA Engineer
 *         -> DevOps Engineer
 *
 * The human is only ever responsible for Requirements & Knowledge — every
 * role listed above already existed as its own engine
 * (solutionArchitectEngine.ts, databaseDesignerEngine.ts, ...), each
 * exposing the exact same five-function shape (`canGenerateX`,
 * `buildXContext`, `buildXPrompt`, `parseDraft`, `createDraftArtifact`) —
 * see app/lib/hooks/useDraftPanel.ts, the hook every "*DraftPanel" component
 * already builds on. This file does not reimplement any of that; it only
 * adds a single ordered registry over the existing per-role functions so
 * app/lib/hooks/useAutoEngineeringPipeline.ts can walk "generate the next
 * not-yet-approved, gate-satisfied stage" in a loop instead of a human
 * clicking Generate/Approve for each of the seven roles in turn. Nothing
 * here calls an LLM, touches the project store, or knows about React —
 * exactly the same boundary every other engine in this codebase keeps.
 */

export type AutoEngineeringRoleId = 'architecture' | 'database' | 'uiux' | 'backend' | 'frontend' | 'qa' | 'devops';

export interface AutoEngineeringRole {
  id: AutoEngineeringRoleId;
  label: string;
  artifactType: string;
  maxOutputTokens: number;
  canGenerate: (project: Project) => boolean;
  buildContext: (project: Project) => any;
  buildPrompt: (context: any) => { system: string; prompt: string };
  parseDraft: (rawText: string) => ParsedDraftResult<any>;
  createDraftArtifact: (draft: any, version: number) => ProjectArtifact;
}

/** Matches every "*DraftPanel" component's MAX_OUTPUT_TOKENS today (Architecture, Database, UI/UX, Backend, Frontend, QA, DevOps all use 8192) — the autonomous pipeline asks for exactly the same budget a human-driven generation would have. */
const AUTO_ENGINEERING_MAX_OUTPUT_TOKENS = 8192;

/** Rough, presentation-only estimate shown next to the currently-generating role in the AI Engineering Team panel — not a real measurement, just a "this takes a moment" hint sized to the shared 8192-token budget above. */
export const AUTO_ENGINEERING_ESTIMATED_SECONDS = 20;

/**
 * Fixed order, one entry per non-Requirements engineering role. Each role's
 * `canGenerate` already encodes "the previous role's artifact is approved"
 * (see each engine's own file header) — this registry doesn't duplicate
 * that gating, it only walks the list in this order.
 */
export const AUTO_ENGINEERING_ROLES: AutoEngineeringRole[] = [
  {
    id: 'architecture',
    label: 'Solution Architect',
    artifactType: ARTIFACT_TYPES.ARCHITECTURE_DRAFT,
    maxOutputTokens: AUTO_ENGINEERING_MAX_OUTPUT_TOKENS,
    canGenerate: solutionArchitectEngine.canGenerateArchitecture,
    buildContext: solutionArchitectEngine.buildArchitectureContext,
    buildPrompt: solutionArchitectEngine.buildArchitecturePrompt,
    parseDraft: solutionArchitectEngine.parseDraft,
    createDraftArtifact: solutionArchitectEngine.createDraftArtifact,
  },
  {
    id: 'database',
    label: 'Database Engineer',
    artifactType: ARTIFACT_TYPES.DATABASE_DRAFT,
    maxOutputTokens: AUTO_ENGINEERING_MAX_OUTPUT_TOKENS,
    canGenerate: databaseDesignerEngine.canGenerateDatabase,
    buildContext: databaseDesignerEngine.buildDatabaseContext,
    buildPrompt: databaseDesignerEngine.buildDatabasePrompt,
    parseDraft: databaseDesignerEngine.parseDraft,
    createDraftArtifact: databaseDesignerEngine.createDraftArtifact,
  },
  {
    id: 'uiux',
    label: 'UI/UX Engineer',
    artifactType: ARTIFACT_TYPES.UIUX_DRAFT,
    maxOutputTokens: AUTO_ENGINEERING_MAX_OUTPUT_TOKENS,
    canGenerate: uiuxDesignerEngine.canGenerateUIUX,
    buildContext: uiuxDesignerEngine.buildUIUXContext,
    buildPrompt: uiuxDesignerEngine.buildUIUXPrompt,
    parseDraft: uiuxDesignerEngine.parseDraft,
    createDraftArtifact: uiuxDesignerEngine.createDraftArtifact,
  },
  {
    id: 'backend',
    label: 'Backend Engineer',
    artifactType: ARTIFACT_TYPES.BACKEND_DRAFT,
    maxOutputTokens: AUTO_ENGINEERING_MAX_OUTPUT_TOKENS,
    canGenerate: backendEngineerEngine.canGenerateBackend,
    buildContext: backendEngineerEngine.buildBackendContext,
    buildPrompt: backendEngineerEngine.buildBackendPrompt,
    parseDraft: backendEngineerEngine.parseDraft,
    createDraftArtifact: backendEngineerEngine.createDraftArtifact,
  },
  {
    id: 'frontend',
    label: 'Frontend Engineer',
    artifactType: ARTIFACT_TYPES.FRONTEND_DRAFT,
    maxOutputTokens: AUTO_ENGINEERING_MAX_OUTPUT_TOKENS,
    canGenerate: frontendEngineerEngine.canGenerateFrontend,
    buildContext: frontendEngineerEngine.buildFrontendContext,
    buildPrompt: frontendEngineerEngine.buildFrontendPrompt,
    parseDraft: frontendEngineerEngine.parseDraft,
    createDraftArtifact: frontendEngineerEngine.createDraftArtifact,
  },
  {
    id: 'qa',
    label: 'QA Engineer',
    artifactType: ARTIFACT_TYPES.QA_DRAFT,
    maxOutputTokens: AUTO_ENGINEERING_MAX_OUTPUT_TOKENS,
    canGenerate: qaEngineerEngine.canGenerateQA,
    buildContext: qaEngineerEngine.buildQAContext,
    buildPrompt: qaEngineerEngine.buildQAPrompt,
    parseDraft: qaEngineerEngine.parseDraft,
    createDraftArtifact: qaEngineerEngine.createDraftArtifact,
  },
  {
    id: 'devops',
    label: 'DevOps Engineer',
    artifactType: ARTIFACT_TYPES.DEVOPS_DRAFT,
    maxOutputTokens: AUTO_ENGINEERING_MAX_OUTPUT_TOKENS,
    canGenerate: devopsEngineerEngine.canGenerateDevOps,
    buildContext: devopsEngineerEngine.buildDevOpsContext,
    buildPrompt: devopsEngineerEngine.buildDevOpsPrompt,
    parseDraft: devopsEngineerEngine.parseDraft,
    createDraftArtifact: devopsEngineerEngine.createDraftArtifact,
  },
];

/**
 * The single next role the autonomous pipeline should run: the first one
 * (in fixed order) that has no approved artifact yet and whose own
 * gate (`canGenerate`) is currently satisfied. Returns undefined once every
 * role is approved, or when the next unapproved role's gate isn't satisfied
 * yet (which in practice only happens transiently, one store write behind
 * the previous role's approval).
 *
 * Sprint 46.1 — live-verified bugfix: checks `getLatestApprovedArtifact` (does an approved
 * version exist at all), not "is the numerically-latest version approved." A hydrated
 * project's artifact array can contain a role's approved version alongside a newer, abandoned
 * draft/discarded regenerate attempt (see artifacts.ts's getLatestApprovedArtifact comment) —
 * the old "latest version's status" check saw that newer non-approved row and concluded the
 * role needed regenerating, even though a perfectly good approved output already existed.
 */
export function getNextAutoRole(project: Project): AutoEngineeringRole | undefined {
  const artifacts = getProjectArtifacts(project);

  return AUTO_ENGINEERING_ROLES.find(
    (role) => !getLatestApprovedArtifact(artifacts, role.artifactType) && role.canGenerate(project),
  );
}

/** True once every role in the pipeline has an approved artifact. See getNextAutoRole's comment for why this checks `getLatestApprovedArtifact`, not the numerically-latest version's status. */
export function isAutoEngineeringComplete(project: Project): boolean {
  const artifacts = getProjectArtifacts(project);
  return AUTO_ENGINEERING_ROLES.every((role) => getLatestApprovedArtifact(artifacts, role.artifactType) !== undefined);
}

/**
 * Project Definition approval gate — the pipeline's real starting condition (checked
 * alongside `isRequirementsCaptured` in useAutoEngineeringPipeline.ts). True once the user
 * has explicitly clicked "Approve Project Definition & Start Engineering" in the Project
 * Definition workspace (`project.projectDefinitionApproval.status === 'approved'`).
 *
 * Backward compatibility: a project that already has at least one downstream engineering
 * artifact predates this gate entirely (it was created and progressed under the old
 * "Requirements approved -> pipeline starts immediately" flow) — treated as already
 * approved so this change never retroactively blocks or re-freezes an existing customer
 * project. This is a derived read, not a stored backfill: no migration/script needed, and a
 * project that later regenerates every stage from scratch would still correctly read as
 * approved the moment any one stage is approved again.
 */
export function isProjectDefinitionApproved(project: Project): boolean {
  if (project.projectDefinitionApproval?.status === 'approved') {
    return true;
  }

  const artifacts = getProjectArtifacts(project);

  return AUTO_ENGINEERING_ROLES.some((role) => getLatestApprovedArtifact(artifacts, role.artifactType) !== undefined);
}

/**
 * Sprint 44 — the stage the pipeline should resume from after a role failed and was retried
 * (manually or automatically). Deliberately derived ONLY from which artifacts are actually
 * approved in the store (via getNextAutoRole), never from a UI-held "current role" — so once
 * a failed role (e.g. QA) is successfully retried and approved, this returns the NEXT
 * unapproved role (DevOps), and it can never skip or re-run an already-approved earlier role
 * (Business Analyst … Frontend) no matter what the UI thought was happening.
 *
 * `failedRoleId` is accepted for logging/clarity only and never influences the result.
 */
export function resumePipelineFromRole(
  project: Project,
  failedRoleId?: AutoEngineeringRoleId,
): AutoEngineeringRole | undefined {
  void failedRoleId;
  return getNextAutoRole(project);
}

export const autoEngineeringEngine = {
  roles: AUTO_ENGINEERING_ROLES,
  getNextAutoRole,
  isAutoEngineeringComplete,
  isProjectDefinitionApproved,
  resumePipelineFromRole,
};
