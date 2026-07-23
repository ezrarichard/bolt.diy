import { useCallback, useEffect, useState } from 'react';
import { isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import { startOrResumeInterview, recordInterviewAnswer } from '~/lib/projects/requirementsSessionOrchestrator';
import { useGenerateText } from '~/lib/hooks/useGenerateText';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import type { GenerateTextFn } from '~/lib/projects/discoveryAiEngine';
import type {
  BusinessUnderstandingModel,
  DiscoveryDimension,
  RequirementsSession,
  RequirementsSessionMessage,
} from '~/lib/projects/requirementsSession';
import type { Project } from '~/lib/stores/projects';

/**
 * Sprint 56 — Interview Mode Foundation. Sprint 57 — Discovery AI Engine.
 *
 * The write-capable counterpart to `useDiscoveryIntelligence` (which stays read-only and
 * unmodified — Interview Mode's live side panel is still that same hook, just fed a bumped
 * refresh key after each turn, per architecture doc §9). This hook owns the chat surface's own
 * state: starting/resuming the interview when `InterviewChatDialog` opens, and submitting each
 * answer as one turn.
 *
 * Same two-layer BuildersDB-availability convention as `useDiscoveryIntelligence`: an
 * `'unavailable'` status here means "hidden/disabled," never a customer-facing error, and every
 * write goes through the orchestrator's own best-effort/never-throw contract.
 *
 * Sprint 57 — this is the ONE place Interview Mode touches `useGenerateText` (the same generic,
 * provider-agnostic client plumbing `RequirementsDraftPanel`/`businessAnalystEngine.ts` already
 * use — see that hook's own header comment). `recordInterviewAnswer` and everything inside the
 * Discovery AI Engine only ever see the injected `generateText` function, never this hook, never
 * cookies, never a provider name — the LLM call boundary Part 3 requires.
 *
 * Sprint 57.1 — also resolves `getRoleGenerateOptions(project, DISCOVERY_AGENT_ROLE_KEY)`
 * (`app/lib/generation-profiles/generationProfileRepository.ts`), the SAME Generation Profile
 * model-resolution every other AI role call site already uses (see `RequirementsDraftPanel.tsx`).
 * Live verification found that without this, a browser session with no `selectedModel`/
 * `selectedProvider` cookie set falls back to `useGenerateText`'s naked
 * `DEFAULT_MODEL`/`DEFAULT_PROVIDER` — an Anthropic model id paired with whichever provider
 * happens to register first in `LLMManager` (not reliably Anthropic) — which fails with
 * "Invalid or missing API key" (`app/routes/api.generate-text.ts`'s `isApiKeyError` 401
 * classification). This was NOT a session/authentication bug: `X-Builders-Auth` (the interceptor
 * in `app/lib/auth/authClient.ts`) and `requireAuthenticatedUser` both worked correctly in every
 * reproduction — see the Sprint 57.1 root-cause note in
 * docs/06-Requirements-Discovery/02-sprint-55-interview-mode-architecture.md. Registering
 * `discovery-agent` in `defaultProfiles.ts` (mirroring the identical Sprint 46D
 * `product-owner-draft` fix) closes the gap the same way every other pipeline role already
 * closed it.
 */

/** Matches the `roleKey` registered in every `DEFAULT_GENERATION_PROFILES` tier (`defaultProfiles.ts`) and used for AI usage-ledger attribution. */
const DISCOVERY_AGENT_ROLE_KEY = 'discovery-agent';
export type InterviewSessionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      session: RequirementsSession;
      messages: RequirementsSessionMessage[];
      model: BusinessUnderstandingModel;
      pendingDimension: DiscoveryDimension | null;

      /** True only for the load that started this dialog-open — an existing session with more than the greeting+first question already in it (UX spec §9: show a "welcome back" cue on resume). Never recomputed after that initial load, so continuing to chat doesn't re-trigger it. */
      isResume: boolean;

      /** True while an answer is being recorded — drives the chat's "thinking" bubble (UX spec §3). */
      submitting: boolean;
    };

export interface UseInterviewSessionResult {
  state: InterviewSessionState;

  /**
   * `dimensionOverride` lets the UI keep the conversation going after READY (UX spec §8:
   * "'Keep talking' always offered — READY is a floor, not a ceiling") — normally the answer is
   * attributed to `state.pendingDimension`, but once that's `null` (nothing left the Question
   * Planner wants to ask), the caller can still direct extra free text somewhere (see
   * `InterviewChatDialog`'s "Keep talking" affordance, which targets `businessVision` as a
   * general-purpose "anything else?" bucket).
   */
  submitAnswer: (answerText: string, dimensionOverride?: DiscoveryDimension) => Promise<void>;
}

export function useInterviewSession(project: Project | null, open: boolean): UseInterviewSessionResult {
  const [state, setState] = useState<InterviewSessionState>({ status: 'idle' });
  const { generate } = useGenerateText();

  const generateTextForDiscovery: GenerateTextFn = useCallback(
    (system, prompt, options) => {
      const roleOptions = project ? getRoleGenerateOptions(project, DISCOVERY_AGENT_ROLE_KEY) : {};

      return generate(system, prompt, {
        ...options,
        ...roleOptions,
        projectId: project?.id,
        roleKey: DISCOVERY_AGENT_ROLE_KEY,
        requestType: 'interview_fact_extraction',
      });
    },
    [generate, project],
  );

  useEffect(() => {
    if (!open || !project) {
      setState({ status: 'idle' });
      return undefined;
    }

    if (!isBuildersDbAvailable()) {
      setState({ status: 'unavailable' });
      return undefined;
    }

    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      const result = await startOrResumeInterview(project.id, project.name);

      if (cancelled) {
        return;
      }

      if (!result) {
        setState({ status: 'error', message: 'Could not start the interview.' });
        return;
      }

      setState({
        status: 'ready',
        session: result.session,
        messages: result.messages,
        model: result.model,
        pendingDimension: result.pendingDimension,
        isResume: result.messages.length > 2,
        submitting: false,
      });
    })();

    return () => {
      cancelled = true;
    };

    // Re-runs only when the dialog opens/closes or the project changes — not on every state update.
  }, [open, project?.id]);

  const submitAnswer = useCallback(
    async (answerText: string, dimensionOverride?: DiscoveryDimension) => {
      const trimmed = answerText.trim();
      const dimension = dimensionOverride ?? (state.status === 'ready' ? state.pendingDimension : null);

      if (!trimmed || !project || state.status !== 'ready' || state.submitting || !dimension) {
        return;
      }

      const sessionId = state.session.id;

      setState((prev) => (prev.status === 'ready' ? { ...prev, submitting: true } : prev));

      const result = await recordInterviewAnswer(project.id, sessionId, dimension, trimmed, {
        generateText: generateTextForDiscovery,
      });

      setState((prev) => {
        if (prev.status !== 'ready') {
          return prev;
        }

        if (!result) {
          return { ...prev, submitting: false };
        }

        return {
          status: 'ready',
          session: result.session,
          messages: result.messages,
          model: result.model,
          pendingDimension: result.pendingDimension,
          isResume: prev.isResume,
          submitting: false,
        };
      });
    },
    [project, state, generateTextForDiscovery],
  );

  return { state, submitAnswer };
}
