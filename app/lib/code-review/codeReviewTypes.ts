import type { GeneratedFile, GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';

/**
 * Code Review & Self-Healing Domain — Sprint 39.
 *
 * Types for the layer that sits between "code generated" (app/lib/code-generation/) and
 * "preview shown": an extensible validator registry (codeValidator.ts) plus an AI repair
 * loop (repairEngine.ts) that patches whatever a validator or the WebContainer's own
 * install/dev-server run flags. Mirrors codeGenerationTypes.ts's shape (an issue list, a
 * progress callback, a result that never throws) rather than inventing a new vocabulary.
 *
 * The Code Reviewer, Repair Engineer, and Build Validator are treated as first-class AI
 * Engineering Team roles (see builders_ai_roles rows added by this sprint's migration),
 * same as the 8 content-producing roles (Business Analyst, ...) — they just produce
 * validation/repair activity (builders_validation_runs / builders_code_repair_attempts)
 * rather than a stored draft artifact, and surface in the Engineering Timeline the same way.
 */

export type CodeReviewStage = 'static' | 'build';

/** The role catalog key each validator/the repair engine is attributed to — must match a row in builders_ai_roles. */
export type CodeReviewRoleKey = 'code-reviewer' | 'repair-engineer' | 'build-validator';

/**
 * Structured detail for an imports-exports issue — added Sprint 43A so this specific,
 * mechanically-provable error shape ("a known React runtime export imported from a local
 * file instead of the 'react' package") can be classified without relying on message-text
 * parsing, and so a deterministic repair (see reactImportRepair.ts) can be planned directly
 * off `repairable`/`suggestedAction` instead of re-deriving them from `message`.
 */
export interface CodeReviewIssue {
  /** Which validator raised this — see ValidatorDefinition.id. */
  validatorId: string;
  severity: 'error' | 'warning';
  message: string;
  filePath?: string;

  /** Fine-grained classification within the validator — e.g. 'react-runtime-import' for the StrictMode-from-App.tsx shape; absent for issues that don't have a more specific category than the validatorId itself. */
  category?: string;

  /** The named symbol the offending import statement pulled in (e.g. "StrictMode"). */
  importedSymbol?: string;

  /** The (wrong) module specifier it was imported from (e.g. "./App.tsx"). */
  invalidSource?: string;

  /** Where it should have been imported from instead (e.g. "react"). */
  expectedSource?: string;

  /** Whether a mechanical fix (no LLM call) can resolve this issue. */
  repairable?: boolean;

  /** Human-readable description of the mechanical fix, e.g. "Move StrictMode import to react". */
  suggestedAction?: string;
}

/**
 * One pluggable check in the validator registry (see codeValidator.ts). Sprint 39 registers
 * two static validators; every future validator (Browser, Visual QA, Accessibility,
 * Performance, Security, ...) is just another entry with the same shape — the loop that
 * runs them, persists their result, and reports them to the timeline never changes.
 *
 * `run` is only present on STATIC validators (a pure function over the already-assembled
 * project). A BUILD-stage validator's actual check necessarily talks to the live
 * WebContainer (see errorCollector.ts/repairEngine.ts's runBuildRepairLoop) rather than
 * fitting this synchronous shape — build validators are still declared with this same
 * metadata (id/label/stage/roleKey) purely so their runs persist through the same
 * `ValidationRunRecord` shape as static ones.
 */
export interface ValidatorDefinition {
  id: string;
  label: string;
  stage: CodeReviewStage;
  roleKey: CodeReviewRoleKey;
  run?: (project: GeneratedProject) => CodeReviewIssue[];
}

/** One validator's result for one attempt — the unit persisted to builders_validation_runs. */
export interface ValidatorRunResult {
  validatorId: string;
  validatorLabel: string;
  stage: CodeReviewStage;
  roleKey: CodeReviewRoleKey;
  status: 'passed' | 'failed';
  issueCount: number;
  issues: CodeReviewIssue[];
}

/** What actually went wrong when `npm install`/`npm run dev` (or the immediate post-start observation window) failed — see errorCollector.ts. */
export interface BuildErrorInfo {
  message: string;
  stack?: string;
  filePath?: string;
  line?: number;
  column?: number;

  /** Which part of the pipeline produced this — 'installing' (npm install), 'dev-server' (npm run dev stdout), or 'runtime' (an uncaught exception/preview alert observed right after the server came up). */
  source: 'installing' | 'dev-server' | 'runtime';
  rawLog?: string;
}

/** Everything the AI needs to propose a targeted fix — never the whole app, just what's affected plus enough surrounding context to reason about it. */
export interface RepairContext {
  projectId: string;
  projectName: string;
  templateId: string;
  attemptNumber: number;
  maxAttempts: number;
  stage: CodeReviewStage;

  /** Which validator (or 'npm-install-and-boot' for the build stage) triggered this repair — persisted alongside the attempt. */
  validatorId: string;
  productPackageSummary: string;
  fileTree: string[];
  affectedFiles: GeneratedFile[];
  issues: CodeReviewIssue[];
  buildError?: BuildErrorInfo;
}

export interface RepairPatchFile {
  path: string;
  content: string;
}

/** The strict JSON shape the AI must return — repairPrompt.ts asks for exactly this. */
export interface RepairPatch {
  filesToCreate: RepairPatchFile[];
  filesToUpdate: RepairPatchFile[];
  filesToDelete: string[];
  explanation: string;
  confidence: number;
  remainingRisks: string[];
}

export type RequestRepairResult = { ok: true; patch: RepairPatch } | { ok: false; error: string };

/** Result of applying a `RepairPatch` to a `GeneratedProject` — `rejectedPaths` records any patch entry the safety rules refused (see repairEngine.ts's applyRepairPatch). */
export interface ApplyPatchResult {
  project: GeneratedProject;
  rejectedPaths: string[];
}

export type RepairAttemptStatus = 'applied' | 'rejected' | 'failed';

/**
 * Persisted to builders_code_repair_attempts (see repairHistoryRepository.ts) — never
 * includes file content, only paths/counts, to keep rows small. `patchSignature` is a cheap
 * hash of stage+validatorId+errorMessage, stored now so a future sprint can look up and
 * reuse a previously-successful patch by signature instead of always calling the LLM —
 * the lookup itself is out of scope for Sprint 39 (see the plan's Known Limitations).
 */
export interface RepairAttemptRecord {
  projectId: string;
  attemptNumber: number;
  stage: CodeReviewStage;
  validatorId: string;
  errorType: string;
  errorMessage: string;
  affectedFiles: string[];
  patchSummary: string;
  filesCreated: string[];
  filesUpdated: string[];
  filesDeleted: string[];
  status: RepairAttemptStatus;
  modelUsed?: string;
  patchSignature: string;
  createdAt?: string;
}

/** Reported by both retry loops as they progress — useCodeGeneration.ts translates these into Engineering Timeline events, exactly mirroring how generationPipeline.ts's `OnGenerationProgress` is consumed today. */
export type RepairLoopEvent =
  | { type: 'code-review-started' }
  | { type: 'static-validation-passed' }
  | { type: 'static-validation-failed'; issues: CodeReviewIssue[] }
  | { type: 'repair-attempt-started'; stage: CodeReviewStage; attemptNumber: number; maxAttempts: number }
  | { type: 'repair-patch-applied'; stage: CodeReviewStage; attemptNumber: number; summary: string }
  | { type: 'repair-failed'; stage: CodeReviewStage; attemptNumber: number; reason: string }
  | { type: 'build-validation-started' }
  | { type: 'preview-validation-passed' }
  | { type: 'preview-validation-failed'; error: BuildErrorInfo }
  | { type: 'manual-attention-required'; stage: CodeReviewStage; detail: string };

export type OnRepairLoopEvent = (event: RepairLoopEvent) => void;

export interface StaticReviewLoopResult {
  ok: boolean;
  project: GeneratedProject;
  issues: CodeReviewIssue[];

  /**
   * Sprint 43B.1 — every file path the deterministic react-import repair (reactImportRepair.ts)
   * actually rewrote during this run, regardless of whether the loop as a whole ended `ok`.
   * Callers that write the result to a live WebContainer (quickBuildOrchestrator.ts) use this
   * to know exactly which files are worth re-reading straight off disk and re-verifying right
   * before build validation — the one place a repair that succeeded in-memory can still be lost
   * to a slower, independent write already in flight for the same path (e.g. the chat-streaming
   * action-runner's own original write for that file, queued during the LLM response and not
   * yet settled). Empty when the deterministic pass never ran or found nothing to fix.
   */
  deterministicRepairedFiles: string[];
}

export type BuildRepairLoopResult =
  | { ok: true; project: GeneratedProject }
  | { ok: false; error: string; project: GeneratedProject };
