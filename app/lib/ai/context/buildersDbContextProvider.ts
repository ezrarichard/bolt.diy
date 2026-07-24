import { buildersDbRepository, isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import { getLatestRequirementsSession } from '~/lib/builders-db/repositories/requirementsSessionRepository';
import { getBusinessUnderstandingModel } from '~/lib/builders-db/repositories/businessUnderstandingRepository';
import type {
  BuildersDbTaskInput,
  BuildersDbTaskReviewInput,
  ContextTraceSource,
} from '~/lib/builders-db/buildersDbTypes';
import {
  ARTIFACT_TYPES,
  formatArtifactTimestamp,
  parseArtifactContent,
  type ProjectArtifact,
} from '~/lib/projects/artifacts';
import { ROLE_ARTIFACT_CHAIN } from '~/lib/projects/collaborationContext';
import { blueprintEngine } from '~/lib/blueprints';
import { getLatestBlueprintResolution } from '~/lib/projects/blueprintResolutionService';
import {
  resolveEffectiveBlueprintSelection,
  projectBlueprintForBusinessAnalyst,
  describeSuppliedSections,
  hasBusinessAnalystBlueprintContent,
  formatBlueprintGuidanceSection,
} from '~/lib/blueprints/blueprintBusinessAnalystProjection';

/**
 * BuildersDB AI Context Provider — Sprint 35 (AI Role Context Retrieval from
 * BuildersDB).
 *
 * Sprint 34 made role outputs/tasks/reviews persist TO BuildersDB
 * (app/lib/builders-db/repositories/buildersDbRepository.ts); nothing yet read them back
 * FOR an AI role — every engine (businessAnalystEngine.ts, solutionArchitectEngine.ts,
 * ...) still builds its context purely from the in-memory `Project` object, which is
 * empty again after a browser refresh or session restart. This file is the read side:
 * it fetches prior role outputs + task/review state from BuildersDB and formats them
 * into one readable text block a prompt can append, so Builders behaves like a
 * persistent AI engineering team rather than one with amnesia on every reload.
 *
 * Deliberately does NOT replace app/lib/projects/contextEngine.ts or any engine's own
 * `buildXContext`/`buildXPrompt` — those keep gathering from the in-memory `Project`
 * exactly as before (that's still the fast path and the only thing that works with
 * BuildersDB unconfigured). This module is called *in addition*, at the three places an
 * AI role's final prompt string is assembled (app/lib/hooks/useDraftPanel.ts,
 * app/lib/hooks/useAutoEngineeringPipeline.ts, and
 * app/components/sidebar/RequirementsDraftPanel.tsx), and its output is appended as one
 * more section — never a replacement for existing role-specific instructions.
 *
 * Every exported function here is safe to call unconditionally: when BuildersDB isn't
 * configured, or any fetch fails, everything resolves to an empty result (`[]`/`''`)
 * rather than throwing — see `isBuildersDbAvailable()`'s guard at the top of each
 * function and the try/catch in `buildRoleContextBlock`, the one function meant to be
 * called directly from a prompt-assembly call site.
 */

/** Reuses the same 8-role pipeline order collaborationContext.ts's Engineering Notes/AI Decisions chain already walks — role_key here is exactly ARTIFACT_TYPES.*, which is also builders_role_outputs.role_key (see the Sprint 34 migration). */
const ROLE_LABELS_BY_KEY = new Map(ROLE_ARTIFACT_CHAIN.map((entry) => [entry.type, entry.role]));

function roleLabelFor(roleKey: string): string {
  return ROLE_LABELS_BY_KEY.get(roleKey) ?? roleKey;
}

// ── Token / size safety ──────────────────────────────────────────────────

/** How many upstream role outputs to include at most — one per pipeline role today (8), kept as an explicit constant rather than "however many exist" so a future longer pipeline can't silently balloon every prompt. */
const MAX_ROLE_OUTPUTS = 8;

/** Per-role-output character cap — each role's own fields are already limited to a few sentences/short lists by its system prompt (see prompts/*.ts), so this is a safety net against unusually verbose output, not the primary size control. */
const MAX_CHARS_PER_ROLE_OUTPUT = 1500;

/** How many tasks to list at most — a project's full task list can be long-ish but every task line here is short, so this caps count rather than characters. */
const MAX_TASKS = 12;

/** Per-task-note character cap, applied within formatTasksForContext — task notes are free-form and can be long. */
const MAX_CHARS_PER_TASK_NOTE = 200;

/**
 * Truncates `text` to `maxChars`, appending a clear marker (never silently cutting off
 * without saying so) — the "truncation is acceptable if summarization does not already
 * exist" fallback the sprint calls for. Safe to call on already-short text (no-op).
 */
export function truncateForContext(text: string, maxChars: number = MAX_CHARS_PER_ROLE_OUTPUT): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).trimEnd()}\n… [truncated ${text.length - maxChars} more character(s) — see BuildersDB for the full output]`;
}

/** Exported (Sprint 36) so app/lib/ai/context/versionHistory.ts's change-summary diffing can render the same field labels this file already uses for a role output's content. */
export function humanizeFieldKey(key: string): string {
  const withSpaces = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

/**
 * Turns a role output's raw JSON `content` (see ProjectArtifact.content — always
 * `JSON.stringify(draft, null, 2)`) into a readable `Key: value` listing, generically
 * across every role's draft shape (ArchitectureDraft, BackendDraft, ...) rather than
 * needing a per-role field-config import here. Deliberately skips `engineeringNotes`/
 * `aiDecisions` — those are already surfaced as their own dedicated prompt sections via
 * app/lib/projects/collaborationContext.ts, so repeating them here would duplicate
 * exactly the content this sprint's token-budget guidance calls out to avoid.
 */
function formatArtifactContentForContext(content: string): string {
  const parsed = parseArtifactContent<Record<string, unknown>>(content);

  if (!parsed) {
    return truncateForContext(content);
  }

  const lines = Object.entries(parsed)
    .filter(([key]) => key !== 'engineeringNotes' && key !== 'aiDecisions')
    .map(([key, value]) => {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        return undefined;
      }

      const display = Array.isArray(value)
        ? value.join(', ')
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);

      return `${humanizeFieldKey(key)}: ${display}`;
    })
    .filter((line): line is string => Boolean(line));

  return truncateForContext(lines.length > 0 ? lines.join('\n') : 'No content available.');
}

/** Formats one role output for the context block: status, freshness, and its content — the per-role-output building block `buildRoleContextBlock` joins together. */
export function formatRoleOutputForContext(artifact: ProjectArtifact): string {
  const statusLabel = artifact.status === 'approved' ? 'approved' : `latest (${artifact.status})`;

  return [
    `### ${roleLabelFor(artifact.type)} Output`,
    `Status: ${statusLabel}`,
    `Updated: ${formatArtifactTimestamp(artifact.updatedAt)}`,
    formatArtifactContentForContext(artifact.content),
  ].join('\n');
}

export interface TaskContextEntry {
  taskId: string;
  status?: string;
  notes?: string;
  reviewStatus?: string;
  reviewNotes?: string;
}

/** Formats the task list section, capped to MAX_TASKS with a clear "N more omitted" note rather than silently dropping the rest. */
export function formatTasksForContext(tasks: TaskContextEntry[]): string {
  if (tasks.length === 0) {
    return 'No tasks recorded yet.';
  }

  const limited = tasks.slice(0, MAX_TASKS);

  const lines = limited.map((task) => {
    const parts = [`${task.taskId} — ${task.status ?? 'not-started'}`];

    if (task.reviewStatus) {
      parts.push(`review: ${task.reviewStatus}`);
    }

    if (task.notes) {
      parts.push(`notes: ${truncateForContext(task.notes, MAX_CHARS_PER_TASK_NOTE)}`);
    }

    return `- ${parts.join(' | ')}`;
  });

  if (tasks.length > MAX_TASKS) {
    lines.push(`… ${tasks.length - MAX_TASKS} more task(s) omitted.`);
  }

  return lines.join('\n');
}

// ── Role output retrieval, with the sprint's approval-priority rule ──────

interface RoleOutputGroups {
  /** Latest (highest-version) output per role_key, regardless of status. */
  latestAny: Map<string, ProjectArtifact>;

  /** Latest APPROVED output per role_key — absent for a role that has no approved output yet. */
  latestApproved: Map<string, ProjectArtifact>;
}

/** Single shared fetch + group-by-role-key, so getLatestRoleOutputs/getLatestApprovedRoleOutputs/getContextForRole don't each re-fetch the whole project's role outputs. */
async function fetchAndGroupRoleOutputs(projectId: string): Promise<RoleOutputGroups> {
  const all = await buildersDbRepository.getRoleOutputsForProject(projectId);

  const byRole = new Map<string, ProjectArtifact[]>();

  for (const artifact of all) {
    const list = byRole.get(artifact.type) ?? [];
    list.push(artifact);
    byRole.set(artifact.type, list);
  }

  const latestAny = new Map<string, ProjectArtifact>();
  const latestApproved = new Map<string, ProjectArtifact>();

  for (const [roleKey, versions] of byRole) {
    const sorted = [...versions].sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
    latestAny.set(roleKey, sorted[0]);

    const approved = sorted.find((artifact) => artifact.status === 'approved');

    if (approved) {
      latestApproved.set(roleKey, approved);
    }
  }

  return { latestAny, latestApproved };
}

function sortByPipelineOrder(artifacts: ProjectArtifact[]): ProjectArtifact[] {
  const order = new Map(ROLE_ARTIFACT_CHAIN.map((entry, index) => [entry.type, index]));
  return [...artifacts].sort((a, b) => (order.get(a.type) ?? 999) - (order.get(b.type) ?? 999));
}

/** The latest role output per role_key (any status) — empty array whenever BuildersDB is unavailable or the project has none yet. */
export async function getLatestRoleOutputs(projectId: string): Promise<ProjectArtifact[]> {
  if (!isBuildersDbAvailable()) {
    return [];
  }

  try {
    const { latestAny } = await fetchAndGroupRoleOutputs(projectId);
    return sortByPipelineOrder(Array.from(latestAny.values()));
  } catch (error) {
    console.error('[BuildersDB Context] getLatestRoleOutputs failed:', error);
    return [];
  }
}

/** The latest APPROVED role output per role_key — a role with no approved output yet is simply absent, not included as a draft. */
export async function getLatestApprovedRoleOutputs(projectId: string): Promise<ProjectArtifact[]> {
  if (!isBuildersDbAvailable()) {
    return [];
  }

  try {
    const { latestApproved } = await fetchAndGroupRoleOutputs(projectId);
    return sortByPipelineOrder(Array.from(latestApproved.values()));
  } catch (error) {
    console.error('[BuildersDB Context] getLatestApprovedRoleOutputs failed:', error);
    return [];
  }
}

/**
 * Applies the sprint's context priority rule for role outputs specifically:
 * 1. The latest APPROVED output for a role, if one exists.
 * 2. Otherwise, the latest output regardless of status (so a role isn't invisible to
 *    downstream context just because nothing's been approved yet).
 * (Falling back further to local/in-memory artifacts, and to the original prompt/
 * knowledge, already happens for free: every existing engine's own `buildXContext`
 * keeps reading `project.artifacts` exactly as before — this module only ever adds a
 * section on top, never replaces that.)
 */
async function getPreferredRoleOutputs(projectId: string): Promise<ProjectArtifact[]> {
  const { latestAny, latestApproved } = await fetchAndGroupRoleOutputs(projectId);
  const preferred = Array.from(latestAny.keys()).map(
    (roleKey) => latestApproved.get(roleKey) ?? latestAny.get(roleKey)!,
  );

  return sortByPipelineOrder(preferred);
}

export interface ProjectRoleContext {
  roleOutputs: ProjectArtifact[];
  tasks: TaskContextEntry[];
}

const EMPTY_CONTEXT: ProjectRoleContext = { roleOutputs: [], tasks: [] };

/** Every role output (approval-preferred) + every task (with its review status merged in) for a project — the full picture before any per-role filtering. */
export async function getProjectRoleContext(projectId: string): Promise<ProjectRoleContext> {
  if (!isBuildersDbAvailable()) {
    return EMPTY_CONTEXT;
  }

  try {
    const [roleOutputs, tasks, reviews]: [ProjectArtifact[], BuildersDbTaskInput[], BuildersDbTaskReviewInput[]] =
      await Promise.all([
        getPreferredRoleOutputs(projectId),
        buildersDbRepository.getProjectTasks(projectId),
        buildersDbRepository.getTaskReviews(projectId),
      ]);

    const reviewsByTaskId = new Map(reviews.map((review) => [review.taskId, review]));

    const mergedTasks: TaskContextEntry[] = tasks.map((task) => ({
      taskId: task.taskId,
      status: task.status,
      notes: task.notes,
      reviewStatus: reviewsByTaskId.get(task.taskId)?.reviewStatus,
      reviewNotes: reviewsByTaskId.get(task.taskId)?.reviewNotes,
    }));

    return { roleOutputs, tasks: mergedTasks };
  } catch (error) {
    console.error('[BuildersDB Context] getProjectRoleContext failed:', error);
    return EMPTY_CONTEXT;
  }
}

/**
 * The subset of `getProjectRoleContext` relevant to one role: every pipeline role
 * BEFORE `roleKey` (never the role's own not-yet-written output, never a later role's —
 * same cutoff rule app/lib/projects/collaborationContext.ts's `gatherEngineeringNotes`/
 * `gatherAIDecisions` already use for Engineering Notes/AI Decisions), capped to
 * `MAX_ROLE_OUTPUTS`. An unrecognized `roleKey` (not in the pipeline) is treated as "no
 * cutoff" — every known role output is considered relevant, which is the safer default.
 */
export async function getContextForRole(projectId: string, roleKey: string): Promise<ProjectRoleContext> {
  const full = await getProjectRoleContext(projectId);

  const cutoff = ROLE_ARTIFACT_CHAIN.findIndex((entry) => entry.type === roleKey);
  const relevantKeys =
    cutoff >= 0 ? new Set(ROLE_ARTIFACT_CHAIN.slice(0, cutoff).map((entry) => entry.type)) : undefined;

  const roleOutputs = (
    relevantKeys ? full.roleOutputs.filter((artifact) => relevantKeys.has(artifact.type)) : full.roleOutputs
  ).slice(0, MAX_ROLE_OUTPUTS);

  return { roleOutputs, tasks: full.tasks };
}

/** Lightweight, best-effort activity log entry — never awaited by callers, never allowed to fail loudly. */
function logContextRetrievedActivity(
  projectId: string,
  roleKey: string,
  roleOutputCount: number,
  taskCount: number,
): void {
  buildersDbRepository
    .addProjectActivity({
      projectId,
      activityType: 'context_retrieved',
      description: `${roleLabelFor(roleKey)} retrieved persistent context (${roleOutputCount} role output(s), ${taskCount} task(s))`,
      metadata: { roleKey, roleOutputCount, taskCount },
    })
    .catch((error) => console.error('[BuildersDB Context] context_retrieved activity log failed:', error));
}

// ── Context source traceability (Sprint 36) ──────────────────────────────

/**
 * Builds the `sources` list a context trace records for one role's context build —
 * every role output, task, and the original prompt (when present) that
 * `buildRoleContextBlock` actually included. Pure and synchronous: this only describes
 * what was already gathered, it doesn't gather anything itself.
 */
function buildContextTraceSources(
  roleOutputs: ProjectArtifact[],
  tasks: TaskContextEntry[],
  projectPromptText: string | undefined,
): ContextTraceSource[] {
  const sources: ContextTraceSource[] = [];

  if (projectPromptText) {
    sources.push({ type: 'original-prompt', label: 'Original Project Prompt' });
  }

  for (const artifact of roleOutputs) {
    const roleLabel = roleLabelFor(artifact.type);
    sources.push({
      type: 'role-output',
      label: `${roleLabel} v${artifact.version ?? 1}${artifact.status === 'approved' ? ' (approved)' : ''}`,
      roleKey: artifact.type,
      version: artifact.version ?? undefined,
    });
  }

  for (const task of tasks) {
    sources.push({ type: 'task', label: `Task: ${task.taskId}${task.reviewStatus ? ` (${task.reviewStatus})` : ''}` });
  }

  return sources;
}

/**
 * Sprint 52 — the OTHER provenance hop this sprint covers (Business Understanding →
 * RequirementsDraft), recorded via this same context-trace mechanism rather than a second
 * one. Only meaningful for the Requirements role itself: every other role already has real
 * upstream role outputs to trace, and the Business Understanding Model exists specifically to
 * feed the Business Analyst, not later roles. Only sections with actual content generate an
 * entry — an always-empty section (nothing has populated it yet) isn't a real "contribution."
 * Lightweight by design: this points at a section by name, it never copies the section's
 * content into the trace row.
 */
async function buildBusinessUnderstandingSources(projectId: string): Promise<ContextTraceSource[]> {
  const session = await getLatestRequirementsSession(projectId);

  if (!session) {
    return [];
  }

  const model = await getBusinessUnderstandingModel(session.id);

  if (!model) {
    return [];
  }

  const sectionEntries: Array<[string, unknown]> = [
    ['businessIdentity', model.businessIdentity],
    ['businessGoals', model.businessGoals],
    ['processes', model.processes],
    ['targetUsers', model.targetUsers],
    ['painPoints', model.painPoints],
    ['businessConstraints', model.businessConstraints],
    ['currentSystems', model.currentSystems],
    ['functionalRequirements', model.functionalRequirements],
    ['nonFunctionalRequirements', model.nonFunctionalRequirements],
    ['recommendations', model.recommendations],
    ['assumptions', model.assumptions],
    ['risks', model.risks],
    ['openQuestions', model.openQuestions],
  ];

  return sectionEntries
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Object.keys(value ?? {}).length > 0))
    .map(([sectionKey]) => ({
      type: 'business-understanding-section' as const,
      label: `Business Understanding: ${humanizeFieldKey(sectionKey)}`,
      sectionKey,
      sessionId: session.id,
    }));
}

/**
 * Sprint 63 (Blueprint-Aware Business Analysis) — the effective (selected, per
 * `resolveEffectiveBlueprintSelection`) Blueprint's Business-Analyst-focused guidance text plus
 * its own traceability source, or `null` when there's nothing to add: no resolution has ever
 * been recorded for this project (Sprint 61/62 haven't run yet, or the project predates them),
 * or the effective Blueprint id no longer resolves via `blueprintEngine.getBlueprint()` (it was
 * hydrated from a BuildersDB row that's since been deprecated/removed, or hydration itself
 * hasn't completed — see engine.ts's own `activeBlueprints` fallback). Either case is a normal,
 * safe "nothing to add" outcome, not an error — this function never throws, so a Blueprint
 * lookup failure can never take down the rest of `buildRoleContextBlock`'s context assembly.
 *
 * Deliberately only ever called for `ARTIFACT_TYPES.REQUIREMENTS_DRAFT` (the Business Analyst) —
 * see this file's only caller, `buildRoleContextBlock` — per the Sprint 63 brief's "update only
 * the Business Analyst generation path."
 */
async function buildBlueprintGuidance(projectId: string): Promise<{ text: string; source: ContextTraceSource } | null> {
  try {
    const resolution = await getLatestBlueprintResolution(projectId);
    const effective = resolveEffectiveBlueprintSelection(resolution);

    if (!effective) {
      return null;
    }

    const blueprint = blueprintEngine.getBlueprint(effective.blueprintId);

    if (!blueprint) {
      return null;
    }

    const projection = projectBlueprintForBusinessAnalyst(blueprint.content);
    const text = formatBlueprintGuidanceSection(blueprint.name, effective.selectionSource, projection);

    const source: ContextTraceSource = {
      type: 'blueprint-resolution',
      label: `Blueprint: ${blueprint.name} (${effective.selectionSource === 'manual_override' ? 'manual override' : 'recommended'})`,
      blueprintId: blueprint.id,
      blueprintVersion: blueprint.version,
      resolutionId: resolution!.id,
      selectionSource: effective.selectionSource,
      sectionsSupplied: describeSuppliedSections(projection),
      contentAvailable: hasBusinessAnalystBlueprintContent(projection),
    };

    return { text, source };
  } catch (error) {
    console.error('[BuildersDB Context] buildBlueprintGuidance failed, continuing without Blueprint context:', error);
    return null;
  }
}

/**
 * Best-effort, fire-and-forget: records WHY a role's context looked the way it did (see
 * requirement #3/#4, "Context Source Traceability"/"Context Explanation"). Never awaited
 * by `buildRoleContextBlock` — a failure here must never affect the AI generation it's
 * merely describing.
 */
async function recordContextTrace(
  projectId: string,
  roleKey: string,
  roleOutputs: ProjectArtifact[],
  tasks: TaskContextEntry[],
  projectPromptText: string | undefined,
  blueprintSource?: ContextTraceSource,
): Promise<void> {
  const sources = buildContextTraceSources(roleOutputs, tasks, projectPromptText);

  if (blueprintSource) {
    sources.push(blueprintSource);
  }

  if (roleKey === ARTIFACT_TYPES.REQUIREMENTS_DRAFT) {
    sources.push(...(await buildBusinessUnderstandingSources(projectId)));
  }

  if (sources.length === 0) {
    return;
  }

  await buildersDbRepository.saveContextTrace({ projectId, roleKey, sources });
}

/**
 * Answers "why did this AI generate this response?" (requirement #4) by reading back
 * the most recent context trace stored for `roleKey` and formatting it as a "Sources
 * Used" list. Returns a clear fallback string rather than `''` — this is meant for
 * direct human/debugging consumption, not prompt injection, so an empty string would
 * read as a bug rather than "nothing to show yet".
 */
export async function getContextExplanation(projectId: string, roleKey: string): Promise<string> {
  if (!isBuildersDbAvailable()) {
    return 'BuildersDB is not configured — no context trace available.';
  }

  try {
    const traces = await buildersDbRepository.getContextTrace(projectId, roleKey, 1);
    const latest = traces[0];

    if (!latest || latest.sources.length === 0) {
      return `No context trace recorded yet for ${roleLabelFor(roleKey)}.`;
    }

    const lines = latest.sources.map((source) => `- ${source.label}`);

    return `Sources Used (${roleLabelFor(roleKey)}, recorded ${formatArtifactTimestamp(latest.createdAt)}):\n${lines.join('\n')}`;
  } catch (error) {
    console.error('[BuildersDB Context] getContextExplanation failed:', error);
    return 'Context trace unavailable (BuildersDB read failed).';
  }
}

let warnedOnceUnavailable = false;

/**
 * The single function prompt-assembly call sites should use: builds the full
 * "## Persistent Project Context from BuildersDB" text block for `roleKey`, ready to
 * append to that role's existing prompt string. Returns `''` (never throws) whenever
 * BuildersDB is unconfigured, unreachable, or has nothing relevant yet — callers should
 * simply skip appending anything in that case, exactly reproducing today's local-only
 * behavior.
 *
 * `projectPromptText` is an optional, already-in-memory value (a call site's own
 * `project.name`/`project.description`) included as the block's "Original Project
 * Prompt" section — cheap to pass in, and it means the block reads as self-contained
 * persistent memory even if BuildersDB is the only surviving source after a refresh.
 */
export async function buildRoleContextBlock(
  projectId: string,
  roleKey: string,
  projectPromptText?: string,
): Promise<string> {
  if (!isBuildersDbAvailable()) {
    if (!warnedOnceUnavailable) {
      warnedOnceUnavailable = true;
      console.warn(
        '[BuildersDB Context] BuildersDB is not configured — AI roles will use local/in-memory context only.',
      );
    }

    return '';
  }

  try {
    const { roleOutputs, tasks } = await getContextForRole(projectId, roleKey);

    /*
     * Sprint 63 — Blueprint guidance is Business-Analyst-only, per the brief's "update only the
     * Business Analyst generation path"; every other role's call to this function is unaffected.
     */
    const blueprintGuidance =
      roleKey === ARTIFACT_TYPES.REQUIREMENTS_DRAFT ? await buildBlueprintGuidance(projectId) : null;

    if (roleOutputs.length === 0 && tasks.length === 0 && !projectPromptText && !blueprintGuidance) {
      return '';
    }

    const sections: string[] = ['## Persistent Project Context from BuildersDB'];

    if (projectPromptText) {
      sections.push(`### Original Project Prompt\n${truncateForContext(projectPromptText, MAX_CHARS_PER_ROLE_OUTPUT)}`);
    }

    sections.push(
      roleOutputs.length > 0
        ? roleOutputs.map(formatRoleOutputForContext).join('\n\n')
        : '### Prior Role Outputs\nNone recorded yet.',
    );

    sections.push(`### Relevant Tasks\n${formatTasksForContext(tasks)}`);

    if (blueprintGuidance) {
      sections.push(blueprintGuidance.text);
    }

    sections.push(
      '### Important Instruction\nUse this context as the source of truth. Do not contradict approved outputs unless clearly explaining why.',
    );

    logContextRetrievedActivity(projectId, roleKey, roleOutputs.length, tasks.length);
    recordContextTrace(projectId, roleKey, roleOutputs, tasks, projectPromptText, blueprintGuidance?.source).catch(
      (error) => console.error('[BuildersDB Context] recordContextTrace failed:', error),
    );

    return sections.join('\n\n');
  } catch (error) {
    console.error('[BuildersDB Context] buildRoleContextBlock failed, continuing without persistent context:', error);
    return '';
  }
}

export const buildersDbContextProvider = {
  getProjectRoleContext,
  getContextForRole,
  buildRoleContextBlock,
  getLatestApprovedRoleOutputs,
  getLatestRoleOutputs,
  getContextExplanation,
  truncateForContext,
  formatRoleOutputForContext,
  formatTasksForContext,
  humanizeFieldKey,
};
