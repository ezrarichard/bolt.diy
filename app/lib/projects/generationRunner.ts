import type { Project } from '~/lib/stores/projects';
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

  /** Human-readable model label (e.g. "Claude Sonnet 4.5") — see RECOMMENDED_MODEL_LABELS. */
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
  | 'truncated-response'
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

/**
 * Sprint 32 — kept deliberately short and bounded. The previous, longer
 * version of this prompt (8 file categories, an explicit "folder structure
 * as a tree/outline document" ask, no file-count or length ceiling) reliably
 * produced enough output — long folder trees, verbose markdown — to run
 * past whatever token budget was in effect before the closing `]}` arrived,
 * which the Sprint 31 parser correctly reports as `truncated-response`
 * rather than silently accepting a broken file. The fix here is to stop
 * asking Claude for that much output in the first place: a hard 3-5 file
 * ceiling, an explicit "be concise" instruction, and a folder layout as a
 * short bullet list instead of a full tree. Prototype Mode's actual rules
 * (mock data only, no real backend, never hedge) are unchanged from before —
 * only the surrounding scope/length instructions were tightened.
 */
const FOUNDATION_SYSTEM_PROMPT = `You are a Principal Engineer inside Builders, an AI engineering platform, generating a CONCISE Foundation scaffold for a brand-new project.

PROTOTYPE MODE (Flow 1) — customer validation only, no real backend yet:
- Realistic dummy/mock data only. Never a real database, Supabase, PostgreSQL, or MySQL.
- Never write placeholder environment variables or fake API keys "to fill in later".
- Never hedge or block your output because a database or credentials are unavailable — that is expected and correct for this mode.

Generate EXACTLY 3 to 5 files — no more:
- README.md
- PROJECT_OVERVIEW.md (brief architecture notes; list the top-level folders as a short bullet list, NOT a full folder tree)
- The base package manifest (e.g. package.json) for this stack
- Up to 2 more files ONLY if clearly necessary for this module (e.g. one config file, one shared constants file)

Do NOT generate, under any circumstances:
- Business logic, React pages or components, API routes, SQL or migrations, authentication code

Be concise. Every file's "content" must be complete and real, but short: a few short paragraphs or a short list per file, never exhaustive documentation.

Respond with a single JSON object and nothing else, in this exact shape:
{
  "files": [
    { "path": "relative/file/path.ext", "purpose": "One sentence on why this file exists.", "language": "markdown | json | typescript | ...", "content": "The complete, concise content for this file." }
  ]
}`;

function buildFoundationUserPrompt(module: { title: string; description: string }, contextText: string): string {
  return `Generate the Foundation-phase files for the module "${module.title}" — 3 to 5 concise files only, per your instructions.

Module intent: ${module.description}

Project context:
${contextText}

Return only the JSON object described in your instructions — no surrounding prose, no markdown fences.`;
}

/**
 * Sprint 32 — 3-5 short files (a README, an overview, a manifest, at most
 * two more) fit comfortably in a few thousand output tokens; this ceiling
 * exists so the model call itself can never run long enough to be cut off
 * mid-JSON regardless of what the prompt asks for.
 */
const FOUNDATION_MAX_OUTPUT_TOKENS = 4000;

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

/**
 * Sprint 31 — a file path is rejected (not just discarded silently) when it
 * could write outside the project root: absolute paths (`/etc/...`,
 * `C:\...`), any `..` path segment, or an empty path after trimming.
 * Path-only check — this file never writes anything to disk regardless;
 * this exists so a malicious/careless AI response can't even produce a
 * `GeneratedFile` that some future writer would blindly trust.
 */
function validateFilePath(path: string): { ok: true } | { ok: false; reason: string } {
  if (!path) {
    return { ok: false, reason: 'path is empty' };
  }

  const normalized = path.replace(/\\/g, '/');

  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return { ok: false, reason: 'absolute paths are not allowed' };
  }

  if (normalized.split('/').some((segment) => segment === '..')) {
    return { ok: false, reason: 'paths may not contain ".."' };
  }

  return { ok: true };
}

const REQUIRED_TEXT_FIELDS = ['path', 'purpose', 'language'] as const;

/**
 * Validates one raw parsed entry — every failure discards only this entry
 * (never throws, never fails the whole parse) and returns a human-readable
 * warning explaining exactly what was wrong, so `parseGeneratedFiles` can
 * surface *why* a file was dropped instead of a silent count.
 */
function toValidFile(entry: unknown, index: number): { file: ParsedGeneratedFile } | { warning: string } {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { warning: `Discarded file at index ${index}: expected an object.` };
  }

  const record = entry as Record<string, unknown>;
  const rawPath = record.path;
  const label = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : `file at index ${index}`;

  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = record[field];

    if (typeof value !== 'string' || value.trim().length === 0) {
      return { warning: `Discarded "${label}": missing or invalid "${field}".` };
    }
  }

  if (typeof record.content !== 'string' || record.content.length === 0) {
    return { warning: `Discarded "${label}": missing or invalid "content".` };
  }

  const path = (record.path as string).trim();
  const pathCheck = validateFilePath(path);

  if (!pathCheck.ok) {
    return { warning: `Discarded "${label}": unsafe file path (${pathCheck.reason}).` };
  }

  return {
    file: {
      path,
      purpose: (record.purpose as string).trim(),
      language: (record.language as string).trim(),
      content: record.content,
    },
  };
}

/**
 * Sprint 31 — scans raw text for every top-level `{...}` JSON object,
 * tracking string/escape state so braces that appear *inside* a string
 * value (most commonly a generated file's own markdown content containing
 * a ``` code fence, or literal `{`/`}` text) never confuse the brace count.
 * Markdown fences, leading/trailing prose, and anything else outside a
 * `{`/`}` pair are simply skipped over rather than matched against — so
 * this works identically whether the JSON arrived raw, fenced with
 * ```json, fenced with plain ```, or surrounded by a short explanation.
 *
 * This replaces the previous regex-based `extractJsonPayload` (still used
 * unchanged by other engines via draftParsing.ts) specifically because that
 * regex's lazy `[\s\S]*?` match stops at the *first* ``` it finds — which
 * is wrong the moment a generated file's content itself contains a code
 * fence, truncating the JSON and producing exactly the
 * `invalid-response-shape` failure this sprint fixes.
 *
 * `truncated` is true only when a `{` was opened but never balanced by a
 * matching `}` before the text ran out — the strongest signal available
 * that generation was cut off mid-response (hit an output token limit)
 * rather than genuinely malformed.
 */
function extractJsonObjectCandidates(rawText: string): { candidates: string[]; truncated: boolean } {
  const candidates: string[] = [];
  let index = 0;
  let truncated = false;

  while (index < rawText.length) {
    const start = rawText.indexOf('{', index);

    if (start === -1) {
      break;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let cursor = start; cursor < rawText.length; cursor += 1) {
      const char = rawText[cursor];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;

        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }

    if (end === -1) {
      truncated = true;
      break;
    }

    candidates.push(rawText.slice(start, end + 1));
    index = end + 1;
  }

  return { candidates, truncated };
}

/**
 * Parses Claude's raw text response into validated files. Tolerates a raw
 * JSON object, ```json/``` fences, and small explanations before/after —
 * see `extractJsonObjectCandidates` above. When more than one balanced
 * `{...}` candidate is found (e.g. stray braces in surrounding prose), the
 * first one that parses as an object with a top-level `"files"` array wins;
 * candidates that parse but aren't shaped that way, and candidates that
 * fail to parse at all, are skipped in favor of that one. Never throws —
 * every failure mode returns a discriminated result.
 */
/** Not part of this file's public orchestration API — exported only so generationRunner.spec.ts can unit-test the parser directly without building a full session/project fixture. */
export function parseGeneratedFiles(
  rawText: string,
): { ok: true; files: ParsedGeneratedFile[]; warnings: string[] } | { ok: false; error: GenerationRunError } {
  const { candidates, truncated } = extractJsonObjectCandidates(rawText);

  const truncatedError: GenerationRunError = {
    code: 'truncated-response',
    message: 'The AI response appears to be incomplete. Please regenerate.',
  };
  const notJsonError: GenerationRunError = {
    code: 'invalid-response-shape',
    message: 'The AI response was not valid JSON.',
  };

  if (candidates.length === 0) {
    return { ok: false, error: truncated ? truncatedError : notJsonError };
  }

  let filesPayload: { files: unknown[] } | undefined;
  let sawAnyValidJson = false;

  for (const candidate of candidates) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    sawAnyValidJson = true;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as any).files)) {
      filesPayload = parsed as { files: unknown[] };
      break;
    }
  }

  if (!filesPayload) {
    if (!sawAnyValidJson) {
      return { ok: false, error: truncated ? truncatedError : notJsonError };
    }

    return {
      ok: false,
      error: { code: 'invalid-response-shape', message: 'The AI response was not a JSON object with a "files" array.' },
    };
  }

  const warnings: string[] = [];
  const files: ParsedGeneratedFile[] = [];

  filesPayload.files.forEach((entry, index) => {
    const result = toValidFile(entry, index);

    if ('file' in result) {
      files.push(result.file);
    } else {
      warnings.push(result.warning);
    }
  });

  return { ok: true, files, warnings };
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
    const outcome = await generate(FOUNDATION_SYSTEM_PROMPT, prompt, { maxTokens: FOUNDATION_MAX_OUTPUT_TOKENS });
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
        warnings: [...contextBundle.warnings, ...parsedResult.warnings],
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

    const warnings = [...contextBundle.warnings, ...parsedResult.warnings];

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
