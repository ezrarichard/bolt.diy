import { extractJsonPayload } from '~/lib/projects/draftParsing';
import type { GenerateFn, GeneratedFile, GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import type { InstallAndStartResult } from '~/lib/code-generation/webcontainerWriter';
import { buildRepairPrompt } from './repairPrompt';
import { runStaticValidators, NPM_INSTALL_AND_BOOT_VALIDATOR } from './codeValidator';
import { runBuildValidation } from './errorCollector';
import { computePatchSignature, recordRepairAttempt, recordValidationRun } from './repairHistoryRepository';
import type {
  ApplyPatchResult,
  BuildRepairLoopResult,
  OnRepairLoopEvent,
  RepairAttemptStatus,
  RepairContext,
  RepairPatch,
  RequestRepairResult,
  StaticReviewLoopResult,
} from './codeReviewTypes';

/**
 * Repair Engine — Sprint 39 (Repair Engineer role).
 *
 * `requestRepair`/`applyRepairPatch` are the pure, testable core (one AI call → a validated,
 * safely-applied patch). `runStaticReviewLoop`/`runBuildRepairLoop` are the two retry loops
 * useCodeGeneration.ts calls into — they own the "validate → repair → re-validate, up to
 * maxAttempts" flow and every BuildersDB/timeline side effect that goes with it, mirroring
 * generationPipeline.ts's own "reports progress via callback, never throws" shape.
 */

const MAX_REPAIR_ATTEMPTS = 3;
const REPAIR_MAX_OUTPUT_TOKENS = 8192;

const ALLOWED_ROOT_FILES = new Set([
  'package.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'index.html',
]);

function isPathSafe(path: string): boolean {
  if (path.includes('..') || path.startsWith('/')) {
    return false;
  }

  return path.startsWith('src/') || ALLOWED_ROOT_FILES.has(path);
}

function toRepairPatch(parsed: unknown): RepairPatch | undefined {
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const toFiles = (value: unknown): { path: string; content: string }[] =>
    Array.isArray(value)
      ? value
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => ({
            path: typeof entry.path === 'string' ? entry.path.trim() : '',
            content: typeof entry.content === 'string' ? entry.content : '',
          }))
          .filter((file) => file.path.length > 0)
      : [];

  return {
    filesToCreate: toFiles(record.filesToCreate),
    filesToUpdate: toFiles(record.filesToUpdate),
    filesToDelete: Array.isArray(record.filesToDelete)
      ? record.filesToDelete.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      : [],
    explanation: typeof record.explanation === 'string' ? record.explanation : 'No explanation provided.',
    confidence: typeof record.confidence === 'number' ? record.confidence : 0,
    remainingRisks: Array.isArray(record.remainingRisks)
      ? record.remainingRisks.filter((risk): risk is string => typeof risk === 'string')
      : [],
  };
}

/** One AI call → a parsed `RepairPatch`, or a structured error. Never throws. */
export async function requestRepair(context: RepairContext, generate: GenerateFn): Promise<RequestRepairResult> {
  const { system, prompt } = buildRepairPrompt(context);
  const result = await generate(system, prompt, { maxTokens: REPAIR_MAX_OUTPUT_TOKENS });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJsonPayload(result.text));
  } catch {
    return { ok: false, error: 'The repair response was not valid JSON.' };
  }

  const patch = toRepairPatch(parsed);

  if (!patch) {
    return { ok: false, error: 'The repair response was missing the expected patch shape.' };
  }

  if (patch.filesToCreate.length === 0 && patch.filesToUpdate.length === 0 && patch.filesToDelete.length === 0) {
    return { ok: false, error: 'The repair response contained no file changes.' };
  }

  return { ok: true, patch };
}

/**
 * Applies a `RepairPatch` to `project`, enforcing the sprint's safety rules: no escaping
 * `src/`/the known root config files, never deleting package.json, never deleting every
 * remaining `src/` file. Any patch entry that would violate a rule is skipped and reported
 * in `rejectedPaths` rather than applied partially-unsafely or failing the whole patch.
 */
export function applyRepairPatch(project: GeneratedProject, patch: RepairPatch): ApplyPatchResult {
  const rejectedPaths: string[] = [];
  const filesByPath = new Map<string, GeneratedFile>(project.files.map((file) => [file.path, file]));

  for (const file of [...patch.filesToCreate, ...patch.filesToUpdate]) {
    if (!isPathSafe(file.path)) {
      rejectedPaths.push(file.path);
      continue;
    }

    filesByPath.set(file.path, { path: file.path, content: file.content });
  }

  const remainingSrcCount = Array.from(filesByPath.keys()).filter((path) => path.startsWith('src/')).length;
  const srcDeletesRequested = patch.filesToDelete.filter((path) => path.startsWith('src/'));
  const wouldEmptySrc = srcDeletesRequested.length > 0 && srcDeletesRequested.length >= remainingSrcCount;

  for (const path of patch.filesToDelete) {
    if (path === 'package.json' || !isPathSafe(path) || (path.startsWith('src/') && wouldEmptySrc)) {
      rejectedPaths.push(path);
      continue;
    }

    filesByPath.delete(path);
  }

  return {
    project: { ...project, files: Array.from(filesByPath.values()) },
    rejectedPaths,
  };
}

function recordAttempt(params: {
  projectId: string;
  attemptNumber: number;
  stage: 'static' | 'build';
  validatorId: string;
  errorMessage: string;
  affectedFiles: string[];
  status: RepairAttemptStatus;
  patch?: RepairPatch;
}): void {
  recordRepairAttempt({
    projectId: params.projectId,
    attemptNumber: params.attemptNumber,
    stage: params.stage,
    validatorId: params.validatorId,
    errorType: params.stage === 'static' ? 'validation' : 'build',
    errorMessage: params.errorMessage,
    affectedFiles: params.affectedFiles,
    patchSummary: params.patch?.explanation ?? '',
    filesCreated: params.patch?.filesToCreate.map((file) => file.path) ?? [],
    filesUpdated: params.patch?.filesToUpdate.map((file) => file.path) ?? [],
    filesDeleted: params.patch?.filesToDelete ?? [],
    status: params.status,
    patchSignature: computePatchSignature(params.stage, params.validatorId, params.errorMessage),
  }).catch((error) => console.error('[CodeReview] Failed to record repair attempt:', error));
}

export interface StaticReviewLoopParams {
  project: GeneratedProject;
  projectId: string;
  projectName: string;
  productPackageSummary: string;
  generate: GenerateFn;
  onEvent: OnRepairLoopEvent;
  maxAttempts?: number;
}

/**
 * Validate → (if issues) repair → re-validate, up to `maxAttempts`. Runs entirely in memory
 * against the not-yet-written `GeneratedProject` — a failure here never touches the
 * WebContainer/whatever project was already running, same guarantee generationPipeline.ts's
 * own validation stage already gives.
 */
export async function runStaticReviewLoop(params: StaticReviewLoopParams): Promise<StaticReviewLoopResult> {
  const maxAttempts = params.maxAttempts ?? MAX_REPAIR_ATTEMPTS;
  let project = params.project;
  let attempt = 0;

  params.onEvent({ type: 'code-review-started' });

  while (true) {
    const { issues, runs } = runStaticValidators(project);

    for (const run of runs) {
      recordValidationRun(params.projectId, attempt, run).catch((error) =>
        console.error('[CodeReview] Failed to record validation run:', error),
      );
    }

    if (issues.length === 0) {
      params.onEvent({ type: 'static-validation-passed' });
      return { ok: true, project, issues: [] };
    }

    params.onEvent({ type: 'static-validation-failed', issues });

    if (attempt >= maxAttempts) {
      params.onEvent({
        type: 'manual-attention-required',
        stage: 'static',
        detail: issues.map((issue) => issue.message).join('; '),
      });

      return { ok: false, project, issues };
    }

    attempt += 1;
    params.onEvent({ type: 'repair-attempt-started', stage: 'static', attemptNumber: attempt, maxAttempts });

    const failingValidatorId = runs.find((run) => run.status === 'failed')?.validatorId ?? 'unknown';
    const affectedPaths = new Set(
      issues.map((issue) => issue.filePath).filter((path): path is string => Boolean(path)),
    );
    const affectedFiles = project.files.filter((file) => affectedPaths.has(file.path));

    const context: RepairContext = {
      projectId: params.projectId,
      projectName: params.projectName,
      templateId: project.templateId,
      attemptNumber: attempt,
      maxAttempts,
      stage: 'static',
      validatorId: failingValidatorId,
      productPackageSummary: params.productPackageSummary,
      fileTree: project.files.map((file) => file.path),
      affectedFiles,
      issues,
    };

    const result = await requestRepair(context, params.generate);

    if (!result.ok) {
      params.onEvent({ type: 'repair-failed', stage: 'static', attemptNumber: attempt, reason: result.error });
      recordAttempt({
        projectId: params.projectId,
        attemptNumber: attempt,
        stage: 'static',
        validatorId: failingValidatorId,
        errorMessage: issues.map((issue) => issue.message).join('; '),
        affectedFiles: Array.from(affectedPaths),
        status: 'failed',
      });
      continue;
    }

    const { project: patchedProject, rejectedPaths } = applyRepairPatch(project, result.patch);
    project = patchedProject;

    const touchedCount =
      result.patch.filesToCreate.length + result.patch.filesToUpdate.length + result.patch.filesToDelete.length;
    const status: RepairAttemptStatus = rejectedPaths.length >= touchedCount ? 'rejected' : 'applied';

    recordAttempt({
      projectId: params.projectId,
      attemptNumber: attempt,
      stage: 'static',
      validatorId: failingValidatorId,
      errorMessage: issues.map((issue) => issue.message).join('; '),
      affectedFiles: Array.from(affectedPaths),
      status,
      patch: result.patch,
    });

    params.onEvent({
      type: 'repair-patch-applied',
      stage: 'static',
      attemptNumber: attempt,
      summary: result.patch.explanation,
    });
  }
}

export interface BuildRepairLoopParams {
  project: GeneratedProject;
  projectId: string;
  projectName: string;
  productPackageSummary: string;
  generate: GenerateFn;
  onEvent: OnRepairLoopEvent;
  installAndStartDevServer: (onOutput?: (chunk: string) => void) => Promise<InstallAndStartResult>;
  writeProjectToWebContainer: (project: GeneratedProject) => Promise<void>;
  saveSnapshot: (files: GeneratedFile[]) => void;
  maxAttempts?: number;
}

/**
 * Install → (bounded) boot-error observation → (if failed) repair → re-write → retry, up to
 * `maxAttempts`. Unlike the static loop, a failure here HAS already written files to the
 * live WebContainer (that's the point — this loop only starts after writeGeneratedProjectToWebContainer
 * has run once), so every repair here also re-writes the patched files and re-saves the
 * workspace snapshot before retrying the install.
 */
export async function runBuildRepairLoop(params: BuildRepairLoopParams): Promise<BuildRepairLoopResult> {
  const maxAttempts = params.maxAttempts ?? MAX_REPAIR_ATTEMPTS;
  let project = params.project;
  let attempt = 0;

  while (true) {
    params.onEvent({ type: 'build-validation-started' });

    const buildError = await runBuildValidation(params.installAndStartDevServer);

    recordValidationRun(params.projectId, attempt, {
      validatorId: NPM_INSTALL_AND_BOOT_VALIDATOR.id,
      validatorLabel: NPM_INSTALL_AND_BOOT_VALIDATOR.label,
      stage: 'build',
      roleKey: 'build-validator',
      status: buildError ? 'failed' : 'passed',
      issueCount: buildError ? 1 : 0,
      issues: buildError
        ? [
            {
              validatorId: NPM_INSTALL_AND_BOOT_VALIDATOR.id,
              severity: 'error',
              message: buildError.message,
              filePath: buildError.filePath,
            },
          ]
        : [],
    }).catch((error) => console.error('[CodeReview] Failed to record validation run:', error));

    if (!buildError) {
      params.onEvent({ type: 'preview-validation-passed' });
      return { ok: true, project };
    }

    params.onEvent({ type: 'preview-validation-failed', error: buildError });

    if (attempt >= maxAttempts) {
      params.onEvent({ type: 'manual-attention-required', stage: 'build', detail: buildError.message });
      return { ok: false, error: buildError.message, project };
    }

    attempt += 1;
    params.onEvent({ type: 'repair-attempt-started', stage: 'build', attemptNumber: attempt, maxAttempts });

    const affectedFiles = buildError.filePath ? project.files.filter((file) => file.path === buildError.filePath) : [];

    const context: RepairContext = {
      projectId: params.projectId,
      projectName: params.projectName,
      templateId: project.templateId,
      attemptNumber: attempt,
      maxAttempts,
      stage: 'build',
      validatorId: NPM_INSTALL_AND_BOOT_VALIDATOR.id,
      productPackageSummary: params.productPackageSummary,
      fileTree: project.files.map((file) => file.path),
      affectedFiles,
      issues: [],
      buildError,
    };

    const result = await requestRepair(context, params.generate);

    if (!result.ok) {
      params.onEvent({ type: 'repair-failed', stage: 'build', attemptNumber: attempt, reason: result.error });
      recordAttempt({
        projectId: params.projectId,
        attemptNumber: attempt,
        stage: 'build',
        validatorId: NPM_INSTALL_AND_BOOT_VALIDATOR.id,
        errorMessage: buildError.message,
        affectedFiles: affectedFiles.map((file) => file.path),
        status: 'failed',
      });
      continue;
    }

    const { project: patchedProject, rejectedPaths } = applyRepairPatch(project, result.patch);
    project = patchedProject;

    const touchedCount =
      result.patch.filesToCreate.length + result.patch.filesToUpdate.length + result.patch.filesToDelete.length;
    const status: RepairAttemptStatus = rejectedPaths.length >= touchedCount ? 'rejected' : 'applied';

    recordAttempt({
      projectId: params.projectId,
      attemptNumber: attempt,
      stage: 'build',
      validatorId: NPM_INSTALL_AND_BOOT_VALIDATOR.id,
      errorMessage: buildError.message,
      affectedFiles: affectedFiles.map((file) => file.path),
      status,
      patch: result.patch,
    });

    params.onEvent({
      type: 'repair-patch-applied',
      stage: 'build',
      attemptNumber: attempt,
      summary: result.patch.explanation,
    });

    await params.writeProjectToWebContainer(project);
    params.saveSnapshot(project.files);
  }
}
