import type { Project } from '~/lib/stores/projects';
import { extractJsonPayload } from './draftParsing';
import { buildContextBundle, formatContextBundleForPrompt } from './contextEngine';
import { generationPlannerEngine, RECOMMENDED_MODEL_LABELS, type RecommendedModel } from './generationPlannerEngine';
import { generationExecutionEngine } from './generationExecutionEngine';
import { generationSessionEngine, type GenerationSession, type GenerationSessionStep } from './generationSessionEngine';

/**
 * Generation Runner — Sprint 29 ("Prototype Generation Engine — Flow 1,
 * Foundation Only").
 *
 *   ... -> Generation Session (Sprint 28)
 *     -> Execution Step (generationExecutionEngine.ts — model/context already classified)
 *       -> Context Engine (contextEngine.ts — buildContextBundle for the step's contextRole/contextBudget)
 *         -> Prompt Builder (this file — formats the context bundle + module intent into an actual prompt)
 *           -> Claude (the step's selectedModel — invoked through a caller-supplied `generate` function)
 *             -> Generated Files (returned to the caller — this file's job stops here)
 *
 * This is the first file in the whole engine chain that actually produces
 * generation output. It is deliberately narrow: given a session and its
 * current ready step, it builds context, builds a prompt, calls Claude
 * exactly once, and returns structured `GeneratedFile[]`. It does NOT run
 * validation, does NOT touch git, does NOT refresh Preview, does NOT advance
 * the session (`completeStep`/`failStep` remain the caller's decision), and
 * DOES NOT write anything to disk — every generated file lives only in the
 * returned result.
 *
 * Same "engine never calls the LLM provider directly" convention every other
 * AI role in this codebase already follows (see businessAnalystEngine.ts's
 * file header): this file has zero knowledge of fetch, cookies, or which
 * provider is selected. The caller (a component, a test, or a future
 * generation orchestrator) supplies a `GenerateFn` — in the browser that's
 * `useGenerateText().generate` unchanged; in a test it's any stub returning
 * the same `{ ok: true, text }` / `{ ok: false, error }` shape.
 *
 * FLOW 1 ONLY (Prototype Mode). This file only ever generates the
 * `foundation` phase — project scaffold, README, project overview,
 * configuration files, shared constants, high-level architecture notes,
 * folder explanations, a basic package manifest. It refuses (with a
 * structured error, never a crash) to run a step from any other phase.
 * Prototype Mode always uses realistic dummy/mock data — no real database,
 * no Supabase, no Postgres/MySQL, no placeholder environment variables, no
 * fake API keys. Flow 2 (Production Mode, real database connection) is out
 * of scope for this file entirely and is a future sprint.
 */

export interface GeneratedFile {
  id: string;
  path: string;
  purpose: string;
  language: string;
  content: string;

  /** Human-readable model label (e.g. "Claude Sonnet 5") — see RECOMMENDED_MODEL_LABELS. */
  generatedBy: string;
  generatedAt: string;

  /** The phase this file was generated for — always 'foundation' this sprint. */
  sourceStep: GenerationSessionStep['phase'];

  /** The module id this file was generated for — same id as the session/execution step's moduleId. */
  sourceModule: string;

  /** Regeneration counter for this step, derived from the session step's own `attempts` (never a new counter invented here) — 1 on a step's first run. */
  version: number;
}

export type GenerationRunErrorCode =
  | 'no-current-step'
  | 'step-not-ready'
  | 'unsupported-phase'
  | 'model-call-failed'
  | 'empty-response'
  | 'invalid-response-shape'
  | 'no-valid-files'
  | 'unexpected-error';

export interface GenerationRunError {
  code: GenerationRunErrorCode;
  message: string;
}

export interface GenerationRunResult {
  success: boolean;

  /** Undefined only when no step could be resolved at all (e.g. no current step) — never a guessed/hardcoded model. */
  modelUsed: RecommendedModel | undefined;
  tokens: number;
  duration: number;
  warnings: string[];
  files: GeneratedFile[];

  /** Empty on success. Structured, never a thrown exception — see file header. */
  errors: GenerationRunError[];

  /**
   * TEMP DIAGNOSTIC FIELD — added to help design the Sprint 31 parser after
   * Claude returned a response `invalid-response-shape` couldn't parse.
   * Holds Claude's exact raw response text whenever one was received (i.e.
   * every case except `model-call-failed`, where there is no text, and the
   * pre-generate errors, where Claude was never called). Not present on the
   * `GENERATED FILE` spec — remove once the real parser is confirmed
   * correct and this is no longer needed for inspection.
   */
  rawResponseText?: string;
}

export type GenerateTextOutcome = { ok: true; text: string } | { ok: false; error: string };

/**
 * Matches `useGenerateText().generate`'s signature exactly so a component can
 * pass that function straight through without an adapter. Never called or
 * imported by this file's own logic — purely a type contract for whatever
 * the caller injects.
 */
export type GenerateFn = (
  system: string | undefined,
  prompt: string,
  options?: { maxTokens?: number },
) => Promise<GenerateTextOutcome>;

const ONLY_SUPPORTED_PHASE: GenerationSessionStep['phase'] = 'foundation';

const FOUNDATION_SYSTEM_PROMPT = `You are a Principal Engineer inside Builders, an AI engineering platform, generating the FOUNDATION scaffold for a brand-new project.

This project is being built in PROTOTYPE MODE (Flow 1) — the first and always-first flow in Builders. The objective is customer validation: the customer opens a URL, uses the product with realistic dummy/mock data, and gives feedback. There is no real backend behind it yet.

Prototype Mode rules — follow these strictly:
- Use realistic dummy/mock data conventions only. Never a real database, never Supabase, never PostgreSQL, never MySQL.
- Never write placeholder environment variables or fake API keys "to fill in later".
- Never block or hedge your output because a database or credentials are unavailable — that is expected and correct for this mode.

Your ONLY responsibility right now is the FOUNDATION phase. Generate ONLY:
- Project folder structure (described as a file, e.g. a tree/outline document)
- README
- Project overview
- Configuration files (e.g. package manifest, tsconfig, editor/lint config)
- Shared constants
- High-level architecture notes
- Folder explanations
- A basic package manifest

Do NOT generate, under any circumstances:
- Business logic
- React pages or components
- API routes
- SQL or migrations
- Authentication code

Respond with a single JSON object and nothing else, in this exact shape:
{
  "files": [
    { "path": "relative/file/path.ext", "purpose": "One sentence on why this file exists.", "language": "markdown | json | typescript | ...", "content": "The full file content as a string." }
  ]
}

Every file's "content" must be the complete, real content for that file — not a placeholder or a description of what it would contain.`;

function buildFoundationUserPrompt(module: { title: string; description: string }, contextText: string): string {
  return `Generate the Foundation-phase files for the module "${module.title}".

Module intent: ${module.description}

Project context:
${contextText}

Return only the JSON object described in your instructions — no surrounding prose, no markdown fences.`;
}

/**
 * The current step, only if it is actually runnable right now — status must
 * be 'ready' (mirrors generationQueueEngine.canRunQueueItem's "true only for
 * the single current ready item" rule). Returns a structured reason instead
 * of throwing when it isn't.
 */
function getRunnableStep(session: GenerationSession): { step: GenerationSessionStep } | { error: GenerationRunError } {
  const step = generationSessionEngine.getCurrentStep(session);

  if (!step) {
    return { error: { code: 'no-current-step', message: 'This session has no current step to generate.' } };
  }

  if (step.status !== 'ready') {
    return {
      error: {
        code: 'step-not-ready',
        message: `"${step.moduleName}" is not ready to run (status: ${step.status}).`,
      },
    };
  }

  if (step.phase !== ONLY_SUPPORTED_PHASE) {
    return {
      error: {
        code: 'unsupported-phase',
        message: `This Generation Runner only generates the Foundation phase this sprint — "${step.moduleName}" is a ${step.phase} step.`,
      },
    };
  }

  return { step };
}

function emptyResult(modelUsed: RecommendedModel | undefined, errors: GenerationRunError[]): GenerationRunResult {
  return { success: false, modelUsed, tokens: 0, duration: 0, warnings: [], files: [], errors };
}

interface ParsedGeneratedFile {
  path: string;
  purpose: string;
  language: string;
  content: string;
}

/** Validates one raw parsed entry — non-string/empty fields are dropped rather than thrown on, so one malformed entry never crashes the whole parse. */
function toValidFile(entry: unknown): ParsedGeneratedFile | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path.trim() : '';
  const purpose = typeof record.purpose === 'string' ? record.purpose.trim() : '';
  const language = typeof record.language === 'string' ? record.language.trim() : '';
  const content = typeof record.content === 'string' ? record.content : '';

  if (!path || !content) {
    return undefined;
  }

  return { path, purpose: purpose || 'No purpose provided.', language: language || 'text', content };
}

/**
 * Parses Claude's raw text response into validated files. Reuses
 * `extractJsonPayload` from draftParsing.ts unchanged (this file asks for a
 * `{"files": [...]}` object specifically so that existing `{`/`}`-based
 * extractor works without modification). Never throws — every failure mode
 * returns a discriminated result.
 */
function parseGeneratedFiles(
  rawText: string,
): { ok: true; files: ParsedGeneratedFile[]; droppedCount: number } | { ok: false; error: GenerationRunError } {
  const payload = extractJsonPayload(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, error: { code: 'invalid-response-shape', message: 'The AI response was not valid JSON.' } };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray((parsed as any).files)) {
    return {
      ok: false,
      error: { code: 'invalid-response-shape', message: 'The AI response was not a JSON object with a "files" array.' },
    };
  }

  const rawFiles = (parsed as { files: unknown[] }).files;
  const files = rawFiles.map(toValidFile).filter((file): file is ParsedGeneratedFile => Boolean(file));

  return { ok: true, files, droppedCount: rawFiles.length - files.length };
}

export interface RunFoundationGenerationInput {
  project: Project;
  session: GenerationSession;
  generate: GenerateFn;
}

/**
 * Runs Foundation generation for a session's current ready step. Pure
 * orchestration end to end:
 *   1. Confirm there is a runnable ('ready', 'foundation') current step.
 *   2. Reuse the Execution Engine's already-computed `contextRole`/
 *      `contextBudget` for that step (never rebuilt here) to build one
 *      Context Engine bundle.
 *   3. Build the Foundation system+user prompt from that bundle.
 *   4. Call Claude exactly once via the caller-supplied `generate`.
 *   5. Parse the response into `GeneratedFile[]` and return them.
 *
 * Never throws and never writes to disk, git, or any store — the caller
 * decides what to do with the result (e.g. call
 * `generationSessionEngine.completeStep`/`failStep`, or render the files in
 * the Preview panel).
 */
async function runFoundationGeneration(input: RunFoundationGenerationInput): Promise<GenerationRunResult> {
  const { project, session, generate } = input;

  try {
    const runnable = getRunnableStep(session);

    if ('error' in runnable) {
      return emptyResult(undefined, [runnable.error]);
    }

    const { step } = runnable;
    const modelUsed = step.selectedModel;

    const plan = generationPlannerEngine.buildGenerationPlan(project);
    const module = plan.modules.find((candidate) => candidate.id === step.moduleId);

    const executionPlan = generationExecutionEngine.buildGenerationExecutionPlan(project);
    const executionStep = executionPlan.steps.find((candidate) => candidate.stepId === step.stepId);

    if (!module || !executionStep) {
      return emptyResult(modelUsed, [
        {
          code: 'unexpected-error',
          message: `Could not find plan/execution data for step "${step.moduleName}" — the plan may have changed since this session was created.`,
        },
      ]);
    }

    const contextBundle = buildContextBundle(project, executionStep.contextRole, {
      budget: executionStep.contextBudget,
    });
    const contextText = formatContextBundleForPrompt(contextBundle);
    const prompt = buildFoundationUserPrompt(module, contextText);

    const startedAt = Date.now();
    const outcome = await generate(FOUNDATION_SYSTEM_PROMPT, prompt);
    const duration = Date.now() - startedAt;

    if (!outcome.ok) {
      return {
        success: false,
        modelUsed,
        tokens: 0,
        duration,
        warnings: contextBundle.warnings,
        files: [],
        errors: [{ code: 'model-call-failed', message: outcome.error }],
      };
    }

    if (!outcome.text || outcome.text.trim().length === 0) {
      return {
        success: false,
        modelUsed,
        tokens: 0,
        duration,
        warnings: contextBundle.warnings,
        files: [],
        errors: [{ code: 'empty-response', message: 'The AI returned an empty response.' }],
      };
    }

    // TEMP DIAGNOSTIC — see `rawResponseText`'s doc comment. Remove once the Sprint 31 parser is confirmed correct.
    console.log(
      `[generationRunner] raw Claude response for step "${step.stepId}" (before JSON parsing):`,
      outcome.text,
    );

    const parsedResult = parseGeneratedFiles(outcome.text);

    if (!parsedResult.ok) {
      return {
        success: false,
        modelUsed,
        tokens: 0,
        duration,
        warnings: contextBundle.warnings,
        files: [],
        errors: [parsedResult.error],
        rawResponseText: outcome.text,
      };
    }

    if (parsedResult.files.length === 0) {
      return {
        success: false,
        modelUsed,
        tokens: 0,
        duration,
        warnings: contextBundle.warnings,
        files: [],
        errors: [{ code: 'no-valid-files', message: 'The AI response contained no valid files.' }],
        rawResponseText: outcome.text,
      };
    }

    const generatedAt = new Date().toISOString();
    const modelLabel = RECOMMENDED_MODEL_LABELS[modelUsed];
    const version = step.attempts + 1;

    const files: GeneratedFile[] = parsedResult.files.map((file, index) => ({
      id: `${step.stepId}-file-${index}-${Date.now()}`,
      path: file.path,
      purpose: file.purpose,
      language: file.language,
      content: file.content,
      generatedBy: modelLabel,
      generatedAt,
      sourceStep: step.phase,
      sourceModule: step.moduleId,
      version,
    }));

    const warnings = [...contextBundle.warnings];

    if (parsedResult.droppedCount > 0) {
      warnings.push(`${parsedResult.droppedCount} file(s) in the AI response were malformed and dropped.`);
    }

    return {
      success: true,
      modelUsed,
      tokens: estimateResponseTokens(prompt, outcome.text),
      duration,
      warnings,
      files,
      errors: [],
      rawResponseText: outcome.text,
    };
  } catch (error) {
    return emptyResult(undefined, [
      {
        code: 'unexpected-error',
        message: error instanceof Error ? error.message : 'Foundation generation failed unexpectedly.',
      },
    ]);
  }
}

function estimateResponseTokens(prompt: string, responseText: string): number {
  return Math.ceil((prompt.length + responseText.length) / 4);
}

export const generationRunner = {
  runFoundationGeneration,
  getRunnableStep,
};
