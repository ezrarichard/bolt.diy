import type { Message } from 'ai';
import { useCallback, useState } from 'react';
import { EnhancedStreamingMessageParser } from '~/lib/runtime/enhanced-message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';
import { quickBuildGenerationStore } from '~/lib/quick-build/quickBuildGenerationStore';
import { workspaceResumeStore } from '~/lib/quick-build/workspaceResumeStore';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('useMessageParser');

/**
 * Sprint 43A, fixed in the 43A audit pass — must exclude the terminal `ready`/`failed`
 * stages, not just `idle`. `quickBuildGenerationStore` is a single global store (one
 * generation tracked at a time, see that file), and its terminal states are NOT reset back
 * to `idle` when they're reached — they persist until the next generation begins. Checking
 * only `!== 'idle'` meant that once ANY Quick Build generation finished (success or
 * failure), every subsequent chat's non-file actions — including a completely unrelated
 * Guided Engineering chat opened afterward in the same tab — would be silently suppressed
 * until another Quick Build generation happened to start and reset the store. Listing the
 * actual in-progress stages closes that leak: only a generation that is CURRENTLY running
 * suppresses anything, regardless of what any earlier or later generation's terminal state
 * happens to be.
 */
const QUICK_BUILD_IN_PROGRESS_STAGES: ReadonlySet<string> = new Set([
  'preparing',
  'streaming',
  'writingFiles',
  'installingDependencies',
  'building',
  'startingPreview',
  'savingSnapshot',
]);

function isQuickBuildGenerationActive(): boolean {
  return QUICK_BUILD_IN_PROGRESS_STAGES.has(quickBuildGenerationStore.get().stage);
}

/**
 * Sprint 44.1 — defense-in-depth companion to isQuickBuildGenerationActive(). When a
 * workspace resume (workspaceResumeOrchestrator.ts) is in flight for ANY project, that
 * orchestrator is the sole owner of dependency install + dev-server start. A restore
 * artifact replayed on load must not run its own competing `npm install`/`npm run dev`
 * (the resume install-hang root cause). useChatHistory.ts already strips those actions
 * from the synthetic restore message for the resume path; this guard is the belt-and-braces
 * so no other action-carrying message can spawn a second installer mid-resume either.
 */
function isWorkspaceResumeInFlight(): boolean {
  return Object.values(workspaceResumeStore.get()).some(
    (resume) => resume.stage !== 'idle' && resume.stage !== 'ready' && resume.stage !== 'failed',
  );
}

const messageParser = new EnhancedStreamingMessageParser({
  callbacks: {
    onArtifactOpen: (data) => {
      logger.trace('onArtifactOpen', data);

      /*
       * Sprint 43 — only reveal the Workbench once the Hero has actually finished hiding
       * (chatStore.started). Chat.client.tsx's sendMessage() already awaits the Hero's
       * fade-out before the LLM request can fire (see that file), so this is normally
       * already true the instant an artifact could exist; this is defensive, not the
       * primary fix — see that file's comment for the actual race this closes.
       */
      if (chatStore.get().started) {
        workbenchStore.showWorkbench.set(true);
      }

      workbenchStore.addArtifact(data);
    },
    onArtifactClose: (data) => {
      logger.trace('onArtifactClose');

      workbenchStore.updateArtifact(data, { closed: true });
    },
    onActionOpen: (data) => {
      logger.trace('onActionOpen', data.action);

      /*
       * File actions are streamed, so we add them immediately to show progress
       * Shell actions are complete when created by enhanced parser, so we wait for close
       */
      if (data.action.type === 'file') {
        workbenchStore.addAction(data);
      }
    },
    onActionClose: (data) => {
      logger.trace('onActionClose', data.action);

      const isFileAction = data.action.type === 'file';
      const willRunHere = isFileAction || (!isQuickBuildGenerationActive() && !isWorkspaceResumeInFlight());

      /*
       * Add non-file actions (shell, build, start, etc.) when they close
       * Enhanced parser creates complete shell actions, so they're ready to execute
       *
       * Urgent fix — ActionRunner.addAction() alone (app/lib/runtime/action-runner.ts)
       * flips the action's status pending -> running as soon as its own internal
       * execution-queue promise resolves; only ActionRunner.runAction() can ever move it out
       * of `running` again. Calling addAction() here for an action we've already decided
       * (below) not to run left it permanently stuck at `running` — a spinner that could
       * never complete, since nothing was ever going to call runAction() for it. Only add it
       * when it's actually going to run.
       */
      if (!isFileAction && willRunHere) {
        workbenchStore.addAction(data);
      }

      /*
       * Sprint 43A — Quick Build's own deterministic orchestrator
       * (app/lib/quick-build/quickBuildOrchestrator.ts) owns install/build/dev-server for a
       * Quick Build generation, running AFTER the stream finishes with real exit-code/build/
       * preview verification (see that file). Letting the LLM's own emitted shell/start/build
       * actions ALSO run here — as they always have for every other chat — would start a
       * second, unverified `npm install`/`npm run dev` racing the orchestrator's own, which
       * can fail with a port already in use and get misread as a real build failure. File
       * actions are unaffected: those are Quick Build's actual generated output and must
       * still write exactly as before. Guided Engineering never sets
       * quickBuildGenerationStore away from `idle`, so this only ever changes behavior for a
       * Quick Build chat.
       */
      if (willRunHere) {
        workbenchStore.runAction(data);
      }
    },
    onActionStream: (data) => {
      logger.trace('onActionStream', data.action);
      workbenchStore.runAction(data, true);
    },
  },
});
const extractTextContent = (message: Message) =>
  Array.isArray(message.content)
    ? (message.content.find((item) => item.type === 'text')?.text as string) || ''
    : message.content;

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});

  const parseMessages = useCallback((messages: Message[], isLoading: boolean) => {
    let reset = false;

    if (import.meta.env.DEV && !isLoading) {
      reset = true;
      messageParser.reset();
    }

    for (const [index, message] of messages.entries()) {
      if (message.role === 'assistant' || message.role === 'user') {
        const newParsedContent = messageParser.parse(message.id, extractTextContent(message));
        setParsedMessages((prevParsed) => ({
          ...prevParsed,
          [index]: !reset ? (prevParsed[index] || '') + newParsedContent : newParsedContent,
        }));
      }
    }
  }, []);

  return { parsedMessages, parseMessages };
}
