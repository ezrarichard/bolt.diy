import type { Message } from 'ai';
import { WORK_DIR } from '~/utils/constants';
import { workbenchStore } from '~/lib/stores/workbench';
import { updateProjectWorkspaceState, type Project } from '~/lib/stores/projects';
import { buildersDbRepository } from '~/lib/builders-db/repositories/buildersDbRepository';
import { resetEngineeringTimeline, upsertEngineeringTimelineEvent } from '~/lib/stores/engineeringTimeline';
import { getWorkspaceSnapshotProvider } from '~/lib/workspace-snapshot';
import {
  installAndStartDevServer,
  readGeneratedFileFromWebContainer,
  writeGeneratedProjectToWebContainer,
} from '~/lib/code-generation/webcontainerWriter';
import type { GeneratedFile, GeneratedProject, GenerateFn } from '~/lib/code-generation/codeGenerationTypes';
import { normalizeArtifactAliasTags } from '~/lib/runtime/message-parser';
import { runBuildRepairLoop, runStaticReviewLoop } from '~/lib/code-review/repairEngine';
import { findUnrepairedReactRuntimeImports } from '~/lib/code-review/reactImportRepair';
import type { OnRepairLoopEvent } from '~/lib/code-review/codeReviewTypes';
import { verifyRequiredFiles } from './requiredFiles';
import {
  beginQuickBuildTracking,
  failQuickBuildGeneration,
  markQuickBuildFilesWritten,
  quickBuildGenerationStore,
  resetQuickBuildGeneration,
  setQuickBuildStage,
} from './quickBuildGenerationStore';
import { QUICK_BUILD_STAGE_LABEL, type QuickBuildStage } from './quickBuildGenerationTypes';
import { createGenerationLock } from './generationLock';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('QuickBuildOrchestrator');

/**
 * Sprint 43B — audited the "finalizeQuickBuildGeneration fired ~8 times for one send" report.
 * Ruled out (confirmed by reading the code, not assumed): duplicate `<Chat />` mounts (only
 * one route renders it — app/routes/_index.tsx, re-exported as-is by chat.$id.tsx), a
 * form+button double-submit (ChatBox.tsx's send button is a plain onClick, no <form>, no
 * onSubmit; Enter-to-send and click-to-send are mutually exclusive paths), React StrictMode
 * (not enabled anywhere in this app), and a second call site (finalizeQuickBuildGeneration is
 * only ever called from Chat.client.tsx's `onFinish`).
 *
 * The actual mechanism: `useChat({ maxSteps: mcpSettings.maxLLMSteps })` (Chat.client.tsx,
 * default 5) is `@ai-sdk/react`'s own multi-step tool-call continuation — after any response
 * whose last assistant message has completed tool invocations, `shouldResubmitMessages()`
 * (node_modules/@ai-sdk/ui-utils) automatically fires ANOTHER `/api/chat` POST, and
 * `processChatResponse` calls `onFinish` again for THAT step — all before `isLoading` ever
 * goes back to false. That's correct, intentional SDK behavior (needed for real MCP
 * tool-calling), not a bug in Quick Build's send/submit wiring — so it isn't "fixed" by
 * preventing resubmission. What was missing is exactly-once finalization: every one of those
 * legitimate step-completions was treated as "the generation finished" and re-ran the whole
 * install/build/repair pipeline. `finalizeQuickBuildGeneration` below is now keyed by the
 * completed message's own stable `id` (unique per exchange, stable across that exchange's own
 * multi-step onFinish firings, and guaranteed different for an actual new user turn/retry) —
 * see generationLock.ts for the underlying primitive.
 */
const finalizationLock = createGenerationLock<void>();

/**
 * Quick Build Generation Lifecycle — Sprint 43A.
 *
 * The orchestrator that replaces "the LLM stream finished" with real, verified completion
 * criteria (Part 12). Deliberately reuses Guided Engineering's existing, already-verified
 * install/build/repair machinery (app/lib/code-review/repairEngine.ts) rather than
 * reimplementing install/build/preview verification — that machinery is generic (it operates
 * on a plain `GeneratedProject`, with zero knowledge of the 8-role pipeline that normally
 * produces one), so Quick Build gets the same install-exit-code checking, build-validation
 * (including preview-reachability — see repairEngine.ts's use of errorCollector.ts), and
 * self-healing repair loop as Guided Engineering, for a `GeneratedProject` built from
 * whatever the chat's own `<boltAction type="file">` tags actually wrote instead of one built
 * from an assembled Product Package. Nothing in app/lib/code-generation/ or
 * app/lib/code-review/ is modified — this file is purely a new caller.
 */

const ARTIFACT_OPEN = '<boltArtifact';
const ARTIFACT_CLOSE = '</boltArtifact>';
const ACTION_OPEN = '<boltAction';
const ACTION_CLOSE = '</boltAction>';

/** Same extraction useMessageParser.ts's `extractTextContent` uses for the identical `Message` type — mirrored rather than imported (that one is a private, unexported local in that file). A naive `typeof message.content === 'string'` would silently treat any array-form `content` (the AI SDK's multi-part message shape) as empty, which here means treating a real generation response as "conversational" and skipping every verification below — exactly the false-negative this sprint exists to prevent. */
function extractMessageText(message: Message): string {
  const raw = Array.isArray(message.content)
    ? ((message.content.find((part) => (part as { type?: string }).type === 'text') as { text?: string })?.text ?? '')
    : message.content;

  /*
   * See message-parser.ts's normalizeArtifactAliasTags — Haiku 4.5's `<artifact>` alias must
   * be normalized here too, since this function's caller counts `<boltArtifact`/`</boltArtifact>`
   * tags directly rather than going through the streaming parser.
   */
  return normalizeArtifactAliasTags(raw);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }

  return count;
}

export interface ArtifactCompletenessResult {
  hasArtifacts: boolean;
  ok: boolean;
  artifactsOpened: number;
  artifactsClosed: number;
  actionsOpened: number;
  actionsClosed: number;
}

/**
 * Part 3 — counts opening vs closing tags in the FINAL, complete message text (not the
 * live-streaming parser's internal state, which is driven by React re-renders and isn't a
 * reliable source to synchronously query after the fact — see this module's header). A
 * mismatch means the LLM's response was truncated (max-tokens, a dropped connection, etc.)
 * mid-artifact or mid-action — exactly the failure mode the sprint is about.
 */
export function validateArtifactCompleteness(finalMessageContent: string): ArtifactCompletenessResult {
  const artifactsOpened = countOccurrences(finalMessageContent, ARTIFACT_OPEN);
  const artifactsClosed = countOccurrences(finalMessageContent, ARTIFACT_CLOSE);
  const actionsOpened = countOccurrences(finalMessageContent, ACTION_OPEN);
  const actionsClosed = countOccurrences(finalMessageContent, ACTION_CLOSE);

  return {
    hasArtifacts: artifactsOpened > 0,
    ok: artifactsOpened === artifactsClosed && actionsOpened === actionsClosed,
    artifactsOpened,
    artifactsClosed,
    actionsOpened,
    actionsClosed,
  };
}

/** Part 4 (data half) — reads whatever is CURRENTLY in the live WebContainer file tree (written by the existing action-runner path as `<boltAction type="file">` tags closed during streaming) and reshapes it into the same `GeneratedProject` shape Guided Engineering's pipeline produces, so it can be handed to the exact same install/build/repair loop. Paths are stripped of the `WORK_DIR` prefix to match `GeneratedFile.path`'s "project-relative, never WORK_DIR" contract (see codeGenerationTypes.ts). */
export function buildGeneratedProjectFromWorkbench(projectId: string): GeneratedProject {
  const fileMap = workbenchStore.files.get();
  const prefix = `${WORK_DIR}/`;
  const files: GeneratedFile[] = [];

  for (const [absolutePath, dirent] of Object.entries(fileMap)) {
    if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
      continue;
    }

    const relativePath = absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : absolutePath;
    files.push({ path: relativePath, content: dirent.content });
  }

  return {
    projectId,
    templateId: 'quick-build',
    files,
    folders: [],
    generatedAt: new Date().toISOString(),
  };
}

function logActivity(projectId: string, activityType: string, description: string): void {
  buildersDbRepository
    .addProjectActivity({ projectId, activityType, description })
    .catch((error) => console.error(`[QuickBuild] ${activityType} activity log failed:`, error));
}

/** Sanitized for BuildersDB storage — Part 10's "stack (sanitized)". Truncated, no attempt to preserve a real stack trace (provider errors rarely include one worth keeping, and this must never leak request/response internals). */
function sanitizeStack(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.message) {
    return undefined;
  }

  return error.message.slice(0, 500);
}

/** Same event → Engineering Timeline / BuildersDB activity mapping useCodeGeneration.ts's createRepairEventHandler uses (Part 8 — "log exactly like Guided Engineering") — a separate copy because it's a small, self-contained closure, not because the logic differs; both read from the same generic repairEngine.ts event union and write to the same generic engineeringTimelineStore. */
function createQuickBuildRepairEventHandler(projectId: string): OnRepairLoopEvent {
  return (event) => {
    switch (event.type) {
      case 'code-review-started':
        upsertEngineeringTimelineEvent('code-review', {
          label: 'Code Reviewer: reviewing generated code',
          status: 'active',
        });
        logActivity(projectId, 'code_review_started', 'Code Reviewer started reviewing generated code');
        break;
      case 'static-validation-passed':
        upsertEngineeringTimelineEvent('code-review', { label: 'Code Reviewer: validation passed', status: 'done' });
        break;
      case 'static-validation-failed':
        upsertEngineeringTimelineEvent('code-review', {
          label: 'Code Reviewer: issues found',
          status: 'failed',
          detail: `${event.issues.length} issue(s) found`,
        });
        break;
      case 'repair-attempt-started':
        upsertEngineeringTimelineEvent('repair-attempt', {
          label: `Repair Engineer: attempting fix (${event.attemptNumber}/${event.maxAttempts})`,
          status: 'active',
          detail: event.stage === 'static' ? 'Fixing code review issues' : 'Fixing build/runtime error',
        });
        updateProjectWorkspaceState(projectId, { lastRepairStatus: 'repairing', repairAttempts: event.attemptNumber });
        logActivity(
          projectId,
          'repair_attempt_started',
          `Repair Engineer attempt ${event.attemptNumber}/${event.maxAttempts} (${event.stage})`,
        );
        break;
      case 'repair-patch-applied':
        upsertEngineeringTimelineEvent('repair-attempt', {
          label: 'Repair Engineer: patch applied',
          status: 'done',
          detail: event.summary,
        });
        logActivity(projectId, 'repair_patch_applied', `Repair Engineer applied a patch: ${event.summary}`);
        break;
      case 'repair-failed':
        upsertEngineeringTimelineEvent('repair-attempt', {
          label: 'Repair Engineer: repair failed',
          status: 'failed',
          detail: event.reason,
        });
        logActivity(
          projectId,
          'repair_failed',
          `Repair Engineer's attempt ${event.attemptNumber} failed: ${event.reason}`,
        );
        break;
      case 'build-validation-started':
        upsertEngineeringTimelineEvent('build-validation', {
          label: 'Build Validator: installing & starting dev server',
          status: 'active',
        });
        break;
      case 'preview-validation-passed':
        upsertEngineeringTimelineEvent('build-validation', {
          label: 'Build Validator: preview stable',
          status: 'done',
        });
        break;
      case 'preview-validation-failed':
        upsertEngineeringTimelineEvent('build-validation', {
          label: 'Build Validator: build/runtime error detected',
          status: 'failed',
          detail: event.error.message,
        });
        break;
      case 'manual-attention-required':
        upsertEngineeringTimelineEvent('manual-attention', {
          label: 'Manual attention required',
          status: 'failed',
          detail: event.detail,
        });
        logActivity(
          projectId,
          'manual_attention_required',
          `Manual attention required (${event.stage}): ${event.detail}`,
        );
        break;
    }
  };
}

function timelineForStage(stage: QuickBuildStage, status: 'active' | 'done' | 'failed', detail?: string): void {
  upsertEngineeringTimelineEvent(stage, { label: QUICK_BUILD_STAGE_LABEL[stage], status, detail });
}

/**
 * Part 1/9 — called synchronously when a Quick Build prompt is sent (before the LLM request
 * fires), so the Engineering Timeline shows "Preparing…"/"Generating Files…" for the whole
 * duration of the LLM stream, not just after it finishes. This is also what flips
 * `quickBuildGenerationStore` away from `idle`, which useMessageParser.ts checks before
 * deciding whether to let a chat-emitted shell/start/build action run (see that file's
 * comment) — Quick Build generations own their own install/build, never the LLM's own
 * emitted shell commands, to avoid two independent processes racing to bind the dev server
 * port (see this sprint's Known Limitations).
 */
export function beginQuickBuildGeneration(projectId: string): void {
  /*
   * Sprint 43B — this generation's own identity, independent of the message-id-keyed
   * finalization lock above: it's what lets a still-in-flight finalize from an OLDER
   * generation recognize a NEWER one has since taken over this store (see
   * `isStillActiveGeneration()` inside `finalizeQuickBuildGeneration`) and stop writing
   * stage/failure state, rather than stomping the newer run's progress.
   */
  const generationId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `qb_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  beginQuickBuildTracking(projectId, generationId);
  resetEngineeringTimeline();
  setQuickBuildStage('preparing');
  timelineForStage('preparing', 'active');
  logActivity(projectId, 'generation_started', 'Quick Build generation started');
  updateProjectWorkspaceState(projectId, {
    lastGenerationStatus: 'generating',
    currentStage: 'preparing',
    lastError: undefined,
  });

  setQuickBuildStage('streaming');
  timelineForStage('preparing', 'done');
  timelineForStage('streaming', 'active', 'Waiting for the model to finish responding');
  logActivity(projectId, 'llm_stream_started', 'Quick Build LLM stream started');
}

/**
 * Urgent regression-fix follow-up — if `/api/chat` itself fails outright (network error,
 * auth failure, provider error) for a project whose generation `beginQuickBuildGeneration()`
 * already moved to an in-progress stage, `finalizeQuickBuildGeneration()` never runs at all
 * (there's no finished message to validate). Without this, the state machine would be left
 * stuck at `preparing`/`streaming` indefinitely — the same class of dangling-state issue
 * fixed for the "conversational, no artifacts" case, but for the "request never completed"
 * case instead. A no-op if this project isn't the one currently being tracked, or if
 * tracking already reached a terminal state.
 */
export function failQuickBuildGenerationOnRequestError(projectId: string, reason: string): void {
  const current = quickBuildGenerationStore.get();

  if (
    current.projectId !== projectId ||
    current.stage === 'idle' ||
    current.stage === 'ready' ||
    current.stage === 'failed'
  ) {
    return;
  }

  timelineForStage(current.stage, 'failed', reason);
  failQuickBuildGeneration(current.stage, reason);
  logActivity(projectId, 'generation_failed', `Generation failed: ${reason}`);
  updateProjectWorkspaceState(projectId, { lastGenerationStatus: 'failed', lastError: reason });
}

export interface FinalizeQuickBuildGenerationParams {
  project: Project;
  message: Message;
  generate: GenerateFn;
}

/**
 * Sprint 43B — Part 3-12 may be entered more than once for the SAME logical generation (the
 * live audit measured `onFinish` firing roughly 8 times for a single `/api/chat` request —
 * confirmed by network inspection to be exactly ONE HTTP request, so this is `onFinish` itself
 * re-invoking, not repeat requests; see this file's header comment). The public entry point
 * below is a thin idempotency wrapper.
 *
 * Deliberately keyed by `quickBuildGenerationStore`'s own `generationId` — read fresh at call
 * time — rather than `message.id`: an earlier version of this fix used `message.id`, on the
 * assumption it would be stable across every `onFinish` firing for one exchange (per
 * `@ai-sdk/ui-utils`'s `processChatResponse`, which reuses the prior message's id via
 * `replaceLastMessage` during step continuation). Live verification disproved that — the
 * message id was NOT stable across those ~8 firings for a single send in practice, so keying
 * on it failed to collapse them. `generationId` doesn't have that problem: it's minted exactly
 * once per real user-initiated send by `beginQuickBuildGeneration()` (guarded by
 * Chat.client.tsx's `quickBuildTrackingStarted` ref, which only resets once `isLoading` goes
 * back to false), so it stays constant across every `onFinish` call that happens while
 * `isLoading` never dropped in between — exactly the "same logical generation" boundary this
 * needs — while a genuine retry (a new `isLoading` cycle) always gets a fresh one.
 */
export async function finalizeQuickBuildGeneration(params: FinalizeQuickBuildGenerationParams): Promise<void> {
  const generationId = quickBuildGenerationStore.get().generationId ?? `${params.project.id}:${params.message.id}`;

  if (finalizationLock.has(generationId)) {
    logger.debug('finalizeQuickBuildGeneration: duplicate call for this generation ignored', {
      projectId: params.project.id,
      generationId,
    });
  }

  return finalizationLock.run(generationId, () => runQuickBuildFinalization(params));
}

/**
 * Part 3–12 — called once the chat stream finishes (Chat.client.tsx's `onFinish`). Does
 * nothing (leaves the store as-is) if this turn produced no `<boltArtifact>` at all — an
 * ordinary conversational reply is not a generation attempt, and forcing every chat message
 * through install/build would be both wrong and slow.
 */
async function runQuickBuildFinalization({
  project,
  message,
  generate,
}: FinalizeQuickBuildGenerationParams): Promise<void> {
  /*
   * Sprint 43B — the generation `beginQuickBuildGeneration()` minted for this project when
   * THIS request started. If a NEWER generation has since taken over `quickBuildGenerationStore`
   * (e.g. this run's own install/build was still in flight when the user retried, and the new
   * attempt's `beginQuickBuildGeneration()` already reset the store) by the time an `await`
   * below returns, `isStillActiveGeneration()` goes false and every remaining stage/failure
   * write is skipped — an old, superseded run can never stomp a newer one's progress.
   */
  const trackedGenerationId = quickBuildGenerationStore.get().generationId;

  const isStillActiveGeneration = (): boolean => {
    const current = quickBuildGenerationStore.get();
    return current.projectId === project.id && current.generationId === trackedGenerationId;
  };

  const content = extractMessageText(message);
  const completeness = validateArtifactCompleteness(content);

  logger.debug('finalizeQuickBuildGeneration entered', {
    projectId: project.id,
    messageId: message.id,
    contentLength: content.length,
    completeness,
  });

  if (!completeness.hasArtifacts) {
    /*
     * Conversational turn — not a generation attempt. beginQuickBuildGeneration() already
     * moved the state machine to `streaming` before the response was known to be
     * conversational (it can't know in advance), so this settles that back to `idle` rather
     * than leaving it stuck at `streaming` indefinitely — an inert non-idle stage would
     * otherwise persist until the NEXT message happens to reset it (see
     * beginQuickBuildTracking()), and would incorrectly read as "a generation is in
     * progress" to useMessageParser.ts's isQuickBuildGenerationActive() in the meantime.
     */
    timelineForStage('streaming', 'done', 'No files generated this turn');
    resetQuickBuildGeneration();

    return;
  }

  logActivity(
    project.id,
    'artifact_received',
    `${completeness.artifactsClosed}/${completeness.artifactsOpened} artifact(s), ${completeness.actionsClosed}/${completeness.actionsOpened} action(s) closed`,
  );

  try {
    // ── Part 3 — artifact/action completeness ────────────────────────────────
    if (!completeness.ok) {
      timelineForStage('streaming', 'failed', 'Response ended before every file/artifact was finished');
      failQuickBuildGeneration(
        'streaming',
        `The model's response was truncated: ${completeness.artifactsClosed}/${completeness.artifactsOpened} artifact(s) and ${completeness.actionsClosed}/${completeness.actionsOpened} action(s) closed.`,
      );
      logActivity(project.id, 'generation_failed', 'Generation failed: response truncated mid-artifact/action');
      updateProjectWorkspaceState(project.id, {
        lastGenerationStatus: 'failed',
        currentStage: 'streaming',
        lastError: 'Response truncated',
      });

      return;
    }

    timelineForStage('streaming', 'done');
    setQuickBuildStage('writingFiles');
    timelineForStage('writingFiles', 'active');

    // ── Part 4 — file verification ───────────────────────────────────────────
    let generatedProject = buildGeneratedProjectFromWorkbench(project.id);
    const requiredFiles = verifyRequiredFiles(generatedProject.files.map((file) => file.path));

    logger.debug('file verification', { fileCount: generatedProject.files.length, requiredFiles });

    if (!requiredFiles.ok) {
      timelineForStage('writingFiles', 'failed', `Missing: ${requiredFiles.missing.join(', ')}`);
      failQuickBuildGeneration('writingFiles', `Required file(s) missing: ${requiredFiles.missing.join(', ')}.`);
      logActivity(
        project.id,
        'generation_failed',
        `Generation failed: missing required file(s) — ${requiredFiles.missing.join(', ')}`,
      );
      updateProjectWorkspaceState(project.id, {
        lastGenerationStatus: 'failed',
        currentStage: 'writingFiles',
        lastError: `Missing required file(s): ${requiredFiles.missing.join(', ')}`,
      });

      return;
    }

    logActivity(project.id, 'files_written', `${generatedProject.files.length} file(s) verified in the workspace`);
    updateProjectWorkspaceState(project.id, { workbenchFilesCreated: true, currentStage: 'writingFiles' });
    markQuickBuildFilesWritten();
    timelineForStage('writingFiles', 'done');

    // ── Parts 5–7 — install / build / preview verification (reused, not reimplemented) ──
    setQuickBuildStage('installingDependencies');
    timelineForStage('installingDependencies', 'active');
    logActivity(project.id, 'install_started', 'Installing dependencies');

    const handleRepairEvent = createQuickBuildRepairEventHandler(project.id);
    const productPackageSummary = `Quick Build project "${project.name}". Original request:\n\n${project.description ?? project.name}`;

    const reviewResult = await runStaticReviewLoop({
      project: generatedProject,
      projectId: project.id,
      projectName: project.name,
      productPackageSummary,
      generate,
      onEvent: handleRepairEvent,
    });

    logger.debug('runStaticReviewLoop returned', { ok: reviewResult.ok, issueCount: reviewResult.issues.length });

    if (!isStillActiveGeneration()) {
      logger.debug('finalizeQuickBuildGeneration: superseded by a newer generation, stopping', {
        projectId: project.id,
      });

      return;
    }

    if (!reviewResult.ok) {
      const reason =
        reviewResult.issues.find((issue) => issue.severity === 'error')?.message ??
        'Code review found unresolved issues.';
      timelineForStage('installingDependencies', 'failed', reason);
      failQuickBuildGeneration('installingDependencies', reason);
      logActivity(project.id, 'generation_failed', `Generation failed during code review: ${reason}`);
      updateProjectWorkspaceState(project.id, {
        lastGenerationStatus: 'failed',
        currentStage: 'installing',
        lastError: reason,
        lastRepairStatus: 'failed',
      });

      return;
    }

    generatedProject = reviewResult.project;

    /*
     * Mirrors useCodeGeneration.ts's exact sequence: any patch runStaticReviewLoop applied
     * exists only in this in-memory `generatedProject` until written — without this,
     * runBuildRepairLoop's first runBuildValidation() attempt would install/build against
     * the stale, unrepaired files still on disk (see the Sprint 43A verification audit).
     */
    await writeGeneratedProjectToWebContainer(generatedProject);

    /*
     * Sprint 43B.1 — the live audit found the deterministic react-import repair sometimes
     * "worked" (runStaticReviewLoop returned `ok: true`, no react-runtime-import issues left
     * in-memory) yet the build still failed with the exact same StrictMode-from-App.tsx error.
     * Root cause: the chat-streaming action-runner's OWN original write for the same file
     * (queued during the LLM response, independent of this function) can still be in flight
     * when the write above happens, and can settle AFTER it — silently reverting the repair on
     * disk while every in-memory object still looks correct. This re-reads each file the
     * deterministic repair touched DIRECTLY from the WebContainer filesystem (bypassing the
     * in-memory workbenchStore mirror, which can't distinguish the two writes either) and
     * refuses to proceed to build if the fix didn't actually stick — a precise internal
     * consistency error instead of silently building against stale files. Deliberately does
     * NOT spend another LLM repair attempt here: this is a mechanical write-ordering problem,
     * not a code problem the model could fix, so failing fast is correct instead of retrying.
     */
    for (const repairedPath of reviewResult.deterministicRepairedFiles ?? []) {
      const diskContent = await readGeneratedFileFromWebContainer(repairedPath);

      if (diskContent === null) {
        continue;
      }

      const stillBroken = findUnrepairedReactRuntimeImports(diskContent);

      if (stillBroken.length > 0) {
        const { symbol, specifier } = stillBroken[0];
        const reason = `Internal consistency error: ${repairedPath} still imports "${symbol}" from "${specifier}" on disk after the deterministic repair applied — a stale write reverted the fix before build validation. Not retrying automatically.`;

        timelineForStage('installingDependencies', 'failed', reason);
        failQuickBuildGeneration('installingDependencies', reason);
        logActivity(project.id, 'generation_failed', `Generation failed: ${reason}`);
        updateProjectWorkspaceState(project.id, {
          lastGenerationStatus: 'failed',
          currentStage: 'installing',
          lastError: reason,
          lastRepairStatus: 'failed',
        });

        return;
      }
    }

    setQuickBuildStage('building');
    timelineForStage('building', 'active');
    logActivity(project.id, 'build_started', 'Build validation started');

    const saveSnapshot = (files: GeneratedFile[]) => {
      getWorkspaceSnapshotProvider()
        .saveSnapshot(project.id, files)
        .catch((error) => console.error('[QuickBuild] Failed to persist snapshot:', error));
    };

    const buildResult = await runBuildRepairLoop({
      project: generatedProject,
      projectId: project.id,
      projectName: project.name,
      productPackageSummary,
      generate,
      onEvent: handleRepairEvent,
      installAndStartDevServer,
      writeProjectToWebContainer: writeGeneratedProjectToWebContainer,
      saveSnapshot,
    });

    logger.debug('runBuildRepairLoop returned', {
      ok: buildResult.ok,
      error: buildResult.ok ? undefined : buildResult.error,
    });

    generatedProject = buildResult.project;

    if (!isStillActiveGeneration()) {
      logger.debug('finalizeQuickBuildGeneration: superseded by a newer generation, stopping', {
        projectId: project.id,
      });

      return;
    }

    if (!buildResult.ok) {
      timelineForStage('building', 'failed', buildResult.error);
      failQuickBuildGeneration('building', buildResult.error, sanitizeStack(buildResult.error));
      logActivity(project.id, 'build_failed', `Build failed: ${buildResult.error.slice(0, 500)}`);
      updateProjectWorkspaceState(project.id, {
        lastGenerationStatus: 'failed',
        currentStage: 'installing',
        lastError: buildResult.error,
        lastRepairStatus: 'failed',
      });

      return;
    }

    logActivity(project.id, 'install_completed', 'Dependencies installed successfully');
    logActivity(project.id, 'build_completed', 'Build validated successfully');
    timelineForStage('building', 'done');

    /*
     * ── Preview is live once buildResult.ok — repairEngine.ts's build-validation step
     * already confirmed the dev server started AND stayed stable (see errorCollector.ts) ──
     */
    setQuickBuildStage('startingPreview');
    timelineForStage('startingPreview', 'active');
    workbenchStore.showWorkbench.set(true);
    workbenchStore.currentView.set('preview');
    logActivity(project.id, 'preview_started', 'Preview launched for the generated application');
    timelineForStage('startingPreview', 'done');

    /*
     * ── Part 11 — snapshot (already saved during the repair loop's own successful
     * iterations via `saveSnapshot` above; one final save guarantees the LAST-written
     * state is captured even if no repair iteration ran at all) ──
     */
    setQuickBuildStage('savingSnapshot');
    timelineForStage('savingSnapshot', 'active');
    saveSnapshot(generatedProject.files);
    logActivity(project.id, 'snapshot_saved', 'Workspace snapshot saved');
    timelineForStage('savingSnapshot', 'done');

    // ── Part 12 — every criterion above passed; only now is this "Ready" ──
    setQuickBuildStage('ready');
    timelineForStage('ready', 'done');
    logActivity(project.id, 'generation_completed', 'Quick Build generation completed successfully');
    updateProjectWorkspaceState(project.id, {
      lastGenerationStatus: 'generated',
      generatedApplicationExists: true,
      previewAvailable: true,
      lastPreviewStatus: 'available',
      workbenchFilesCreated: true,
      currentStage: 'complete',
      lastGenerationTime: new Date().toISOString(),
      lastActivity: 'Application generated and preview launched',
      lastError: undefined,
    });

    logger.debug('finalizeQuickBuildGeneration reached READY', { projectId: project.id });
  } catch (error) {
    /*
     * Part 10 — never silently fail. Any unexpected throw from the reused install/build/
     * repair machinery still produces a `failed` state with a reason and sanitized stack —
     * unless (Sprint 43B) a newer generation has since superseded this one, in which case its
     * OWN failure/success is what should be visible, not this stale run's.
     */
    if (!isStillActiveGeneration()) {
      logger.debug('finalizeQuickBuildGeneration: exception from a superseded generation ignored', {
        projectId: project.id,
      });

      return;
    }

    const currentStage = quickBuildGenerationStore.get().stage;
    const reason = error instanceof Error ? error.message : 'Unexpected error during generation.';

    logger.error('finalizeQuickBuildGeneration caught exception', { currentStage, reason, error });

    timelineForStage(currentStage === 'idle' ? 'streaming' : currentStage, 'failed', reason);
    failQuickBuildGeneration(currentStage, reason, sanitizeStack(error));
    logActivity(project.id, 'generation_failed', `Generation failed unexpectedly: ${reason}`);
    updateProjectWorkspaceState(project.id, { lastGenerationStatus: 'failed', lastError: reason });
  }
}

/**
 * Part 11 — "Continue From Last Successful Step". Reuses the exact same
 * workspace-snapshot system Guided Engineering's `resumeApplication()` (useCodeGeneration.ts)
 * already uses — fetch the last saved snapshot, re-write it, reinstall, restart the dev
 * server — rather than a new recovery mechanism. Does not re-run code review/build-repair:
 * the snapshot being restored was only ever saved (see finalizeQuickBuildGeneration's
 * `saveSnapshot` calls) from a state that had already passed those checks at least once.
 */
export async function continueQuickBuildFromSnapshot(project: Project): Promise<void> {
  setQuickBuildStage('preparing');
  timelineForStage('preparing', 'active', 'Resuming from last saved snapshot');
  logActivity(project.id, 'generation_started', 'Quick Build resume from snapshot started');

  try {
    const files = await getWorkspaceSnapshotProvider().getSnapshot(project.id);

    if (files.length === 0) {
      throw new Error('No saved snapshot to resume from.');
    }

    setQuickBuildStage('streaming');
    timelineForStage('streaming', 'done', 'No new generation needed — restoring saved files');
    setQuickBuildStage('writingFiles');
    timelineForStage('writingFiles', 'active');

    const restoredProject: GeneratedProject = {
      projectId: project.id,
      templateId: 'quick-build',
      files,
      folders: [],
      generatedAt: new Date().toISOString(),
    };

    await writeGeneratedProjectToWebContainer(restoredProject);
    logActivity(project.id, 'files_written', `${files.length} file(s) restored from snapshot`);
    markQuickBuildFilesWritten();
    timelineForStage('writingFiles', 'done');

    setQuickBuildStage('installingDependencies');
    timelineForStage('installingDependencies', 'active');
    logActivity(project.id, 'install_started', 'Installing dependencies');

    const installResult = await installAndStartDevServer();

    if (!installResult.ok) {
      timelineForStage('installingDependencies', 'failed', installResult.error);
      failQuickBuildGeneration('installingDependencies', installResult.error);
      logActivity(project.id, 'generation_failed', `Resume failed: ${installResult.error.slice(0, 500)}`);
      updateProjectWorkspaceState(project.id, { lastGenerationStatus: 'failed', lastError: installResult.error });

      return;
    }

    logActivity(project.id, 'install_completed', 'Dependencies installed successfully');
    timelineForStage('installingDependencies', 'done');

    setQuickBuildStage('building');
    timelineForStage('building', 'done', 'Skipped — restoring a previously-validated snapshot');

    setQuickBuildStage('startingPreview');
    timelineForStage('startingPreview', 'active');
    workbenchStore.showWorkbench.set(true);
    workbenchStore.currentView.set('preview');
    logActivity(project.id, 'preview_started', 'Preview relaunched from snapshot');
    timelineForStage('startingPreview', 'done');

    setQuickBuildStage('savingSnapshot');
    timelineForStage('savingSnapshot', 'done', 'Snapshot unchanged');

    setQuickBuildStage('ready');
    timelineForStage('ready', 'done');
    logActivity(project.id, 'generation_completed', 'Quick Build resumed from snapshot successfully');
    updateProjectWorkspaceState(project.id, {
      lastGenerationStatus: 'generated',
      generatedApplicationExists: true,
      previewAvailable: true,
      lastPreviewStatus: 'available',
      currentStage: 'complete',
      lastGenerationTime: new Date().toISOString(),
      lastActivity: 'Application resumed from snapshot',
      lastError: undefined,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unexpected error resuming from snapshot.';
    failQuickBuildGeneration('writingFiles', reason, sanitizeStack(error));
    logActivity(project.id, 'generation_failed', `Resume failed unexpectedly: ${reason}`);
    updateProjectWorkspaceState(project.id, { lastGenerationStatus: 'failed', lastError: reason });
  }
}
