import { appendFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { businessAnalystEngine } from './businessAnalystEngine';
import { AUTO_ENGINEERING_ROLES } from './autoEngineeringEngine';
import { projectManagerEngine } from './projectManagerEngine';
import {
  generateRoleWithRecovery,
  type RecoveryGenerateFn,
  type RoleGenerationAttemptLog,
} from './roleGenerationRecovery';
import { ARTIFACT_TYPES, type ProjectArtifact } from './artifacts';
import type { Project } from '~/lib/stores/projects';

/**
 * Sprint 44 — LIVE real-provider verification harness (opt-in, NOT part of the normal suite).
 *
 * Runs the actual role engines + the real recovery core against the real Anthropic Sonnet 4.5
 * model, building up approved artifacts exactly like useAutoEngineeringPipeline does. Gated
 * behind RUN_LIVE_PIPELINE_CHECK so it never runs (and never spends tokens) in CI or a normal
 * `pnpm test`.
 *
 * Progress is appended line-by-line to PROGRESS_FILE as each call/role completes, so a slow or
 * timed-out run still leaves a full record of per-role finishReason / attempts / token usage.
 */

const ENABLED = process.env.RUN_LIVE_PIPELINE_CHECK === '1' && Boolean(process.env.ANTHROPIC_API_KEY);
const MODEL = 'claude-sonnet-4-5-20250929';
const PROGRESS_FILE = process.env.LIVE_PIPELINE_PROGRESS_FILE ?? '/tmp/builders-live-pipeline.log';

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

let totalApiCalls = 0;
let currentRoleLabel = 'setup';

function log(line: string): void {
  try {
    appendFileSync(PROGRESS_FILE, `${line}\n`);
  } catch {
    // best-effort progress logging only
  }

  console.log(line);
}

/** A real `generate` in the exact shape the recovery core expects — mirrors api.generate-text.ts's generateText call + finishReason pass-through, and records per-call telemetry (model, budget, finishReason, token usage). */
const realGenerate: RecoveryGenerateFn = async (system, prompt, options) => {
  const maxTokens = typeof options?.maxTokens === 'number' && options.maxTokens > 0 ? options.maxTokens : undefined;
  totalApiCalls += 1;

  const callIndex = totalApiCalls;
  const startedAt = Date.now();

  try {
    const res = await generateText({
      model: anthropic(MODEL),
      system,
      prompt,
      ...(maxTokens ? { maxTokens } : {}),
    });

    log(
      `CALL #${callIndex} role=${currentRoleLabel} model=${MODEL} maxTokens=${maxTokens ?? 'default'} ` +
        `finishReason=${res.finishReason} promptTokens=${res.usage?.promptTokens ?? 'n/a'} ` +
        `completionTokens=${res.usage?.completionTokens ?? 'n/a'} ms=${Date.now() - startedAt}`,
    );

    return { ok: true, text: res.text, finishReason: res.finishReason };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`CALL #${callIndex} role=${currentRoleLabel} ERROR ms=${Date.now() - startedAt} -> ${message}`);

    return { ok: false, error: message };
  }
};

const RIVERSIDE_KNOWLEDGE = {
  projectVision:
    'A professional website for Riverside Dental Clinic to attract new patients and let them book appointments online.',
  targetUsers: 'Local residents seeking dental care and existing patients booking routine checkups.',
  industry: 'Healthcare / Dentistry',
  businessModel: 'Local service business',
  coreFeatures: ['Services overview', 'Online appointment booking', 'Contact and location', 'About the dentists'],
  pagesOrScreens: ['Home', 'Services', 'Book Appointment', 'About', 'Contact'],
  integrations: ['Google Maps', 'Email notifications'],
  location: 'Riverside',
  brandTone: 'Trustworthy, clean, and friendly',
};

function makeProject(): Project {
  return {
    id: 'live-riverside-dental',
    name: 'Riverside Dental Clinic',
    description: 'Build a website for Riverside Dental Clinic.',
    icon: '🦷',
    color: 'purple',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    createdAt: new Date().toISOString(),
    projectKnowledge: RIVERSIDE_KNOWLEDGE,
    artifacts: [],
  } as unknown as Project;
}

function pushApproved(project: Project, artifact: ProjectArtifact): void {
  (project.artifacts as ProjectArtifact[]).push({ ...artifact, status: 'approved' });
}

interface RoleRunReport {
  role: string;
  ok: boolean;
  attempts: number;
  finishReasons: (string | undefined)[];
  fieldCount: number;
  kind?: string;
}

async function runRole(args: {
  label: string;
  roleKey: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  parseDraft: (raw: string) => ReturnType<typeof businessAnalystEngine.parseDraft>;
}): Promise<RoleRunReport & { draft?: object }> {
  currentRoleLabel = args.label;
  log(`\n--- ROLE ${args.label} START (maxTokens=${args.maxOutputTokens}) ---`);

  const attemptLog: RoleGenerationAttemptLog[] = [];
  const outcome = await generateRoleWithRecovery({
    projectId: 'live-riverside-dental',
    roleKey: args.roleKey,
    system: args.system,
    prompt: args.prompt,
    contextBlock: '',
    maxOutputTokens: args.maxOutputTokens,
    parseDraft: args.parseDraft,
    generate: realGenerate,
    baseOptions: { model: MODEL, provider: 'Anthropic' },
    onAttempt: (entry) => attemptLog.push(entry),
  });

  const report: RoleRunReport & { draft?: object } = {
    role: args.label,
    ok: outcome.ok,
    attempts: outcome.attempts,
    finishReasons: attemptLog.map((a) => a.finishReason),
    fieldCount: outcome.ok ? Object.keys(outcome.draft).length : 0,
    kind: outcome.ok ? undefined : outcome.kind,
    draft: outcome.ok ? (outcome.draft as object) : undefined,
  };

  log(
    `--- ROLE ${args.label} DONE ok=${report.ok} attempts=${report.attempts} ` +
      `finishReasons=[${report.finishReasons.join(',')}] fields=${report.fieldCount}${report.kind ? ` kind=${report.kind}` : ''} ---`,
  );

  return report;
}

describe.skipIf(!ENABLED)('LIVE Software Factory pipeline (real Anthropic Sonnet 4.5)', () => {
  it('runs Business Analyst → DevOps end to end, records finishReason/usage, then verifies forced-truncation recovery', async () => {
    writeFileSync(PROGRESS_FILE, `LIVE RUN START ${new Date().toISOString()} model=${MODEL}\n`);

    const project = makeProject();
    const reports: RoleRunReport[] = [];

    // ── Business Analyst (produces the Requirements draft the pipeline builds on) ──
    {
      const context = businessAnalystEngine.buildRequirementsContext(project);
      const { system, prompt } = businessAnalystEngine.buildBusinessPrompt(context);
      const report = await runRole({
        label: 'Business Analyst',
        roleKey: ARTIFACT_TYPES.REQUIREMENTS_DRAFT,
        system,
        prompt,
        maxOutputTokens: 8192,
        parseDraft: businessAnalystEngine.parseDraft,
      });
      reports.push(report);
      expect(report.ok).toBe(true);

      if (report.draft) {
        pushApproved(project, businessAnalystEngine.createDraftArtifact(report.draft as never, 1));
      }
    }

    // ── The 7 autonomous roles: Architecture → Database → UI/UX → Backend → Frontend → QA → DevOps ──
    for (const role of AUTO_ENGINEERING_ROLES) {
      expect(role.canGenerate(project)).toBe(true);

      const context = role.buildContext(project);
      const { system, prompt } = role.buildPrompt(context);
      const report = await runRole({
        label: role.label,
        roleKey: role.artifactType,
        system,
        prompt,
        maxOutputTokens: role.maxOutputTokens,
        parseDraft: role.parseDraft,
      });
      reports.push(report);
      expect(report.ok).toBe(true);

      if (report.draft) {
        const next = (project.artifacts as ProjectArtifact[]).filter((a) => a.type === role.artifactType).length + 1;
        pushApproved(project, role.createDraftArtifact(report.draft as never, next));
      }
    }

    // ── Project Manager readiness (pure analysis, no LLM) ──
    const health = projectManagerEngine.analyzeProject(project);
    log(
      `\nPROJECT MANAGER readiness: overallScore=${health.overallScore} readyForGeneration=${health.readyForGeneration}`,
    );

    const summary = {
      model: MODEL,
      totalApiCalls,
      roles: reports.map((r) => ({
        role: r.role,
        ok: r.ok,
        attempts: r.attempts,
        finishReasons: r.finishReasons,
        fields: r.fieldCount,
        kind: r.kind,
      })),
      anyTruncationInNormalRun: reports.some((r) => r.finishReasons.includes('length')),
      anyRecoveryTriggeredInNormalRun: reports.some((r) => r.attempts > 1),
      allRolesApproved: reports.every((r) => r.ok),
      readiness: { overallScore: health.overallScore, readyForGeneration: health.readyForGeneration },
    };

    log(
      '\n===== LIVE PIPELINE REPORT =====\n' + JSON.stringify(summary, null, 2) + '\n================================',
    );

    /*
     * Every role must reach a clean, fully-parsed, approved draft. NOTE: we assert
     * allRolesApproved, NOT health.readyForGeneration — this fixture only creates the role
     * artifacts, not the blueprint's task/roadmap completions, so readyForGeneration stays
     * false by design (it also gates on tasks/reviews). That's a fixture limitation, not a
     * generation failure.
     */
    expect(summary.allRolesApproved).toBe(true);
  }, 1500000);

  it('forced truncation triggers exactly one retry and the retry succeeds', async () => {
    // Minimal project — Architecture only needs captured requirements, no upstream artifacts.
    const project = makeProject();
    const architectureRole = AUTO_ENGINEERING_ROLES[0];
    const { system, prompt } = architectureRole.buildPrompt(architectureRole.buildContext(project));

    currentRoleLabel = 'FORCED-TRUNCATION';
    log(`\n--- FORCED TRUNCATION TEST START (base maxTokens=2000) ${new Date().toISOString()} ---`);

    /*
     * base 2000 forces attempt 0 to truncate (Architecture normally emits ~4.5k tokens),
     * while the retry — dropping redundant context, adding the be-concise instruction, and
     * doubling the budget to 4000 — has room to finish. So we expect exactly ONE retry
     * (attempts === 2) that succeeds.
     */
    const forcedLog: RoleGenerationAttemptLog[] = [];
    const forced = await generateRoleWithRecovery({
      projectId: 'live-riverside-dental',
      roleKey: architectureRole.artifactType,
      system,
      prompt,
      contextBlock: '',
      maxOutputTokens: 2000,
      parseDraft: architectureRole.parseDraft,
      generate: realGenerate,
      baseOptions: { model: MODEL, provider: 'Anthropic' },
      onAttempt: (entry) => forcedLog.push(entry),
    });

    log(
      `--- FORCED TRUNCATION DONE recovered=${forced.ok} attempts=${forced.attempts} ` +
        `finishReasons=[${forcedLog.map((a) => a.finishReason).join(',')}]${forced.ok ? '' : ` kind=${forced.kind}`} ---`,
    );

    // attempt 0 was genuinely cut off …
    expect(forcedLog[0]?.finishReason).toBe('length');

    // … the recovery retried exactly once and that retry succeeded with a valid parsed draft.
    expect(forced.ok).toBe(true);
    expect(forced.attempts).toBe(2);

    if (forced.ok) {
      expect(Object.keys(forced.draft).length).toBeGreaterThan(0);
    }
  }, 600000);
});
