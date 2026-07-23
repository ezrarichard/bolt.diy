import { useEffect, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { useInterviewSession } from '~/lib/hooks/useInterviewSession';
import { useDiscoveryIntelligence } from '~/lib/hooks/useDiscoveryIntelligence';
import { BusinessDiscoveryCard } from './BusinessDiscoveryCard';
import type { DiscoveryDimension, RequirementsSessionMessage } from '~/lib/projects/requirementsSession';

/**
 * Sprint 56 — Interview Mode Foundation.
 *
 * The Interview Mode chat surface, built directly to the Sprint 55.1 UX specification's §2
 * desktop layout (chat + Business Discovery panel, ~60/40) and §3 chat-experience rules —
 * `ProjectRequirementsDialog`'s sibling entry point, not a redesign of it. Reuses
 * `BusinessDiscoveryCard`/`useDiscoveryIntelligence` unchanged for the live panel (architecture
 * doc §9: "the panel should literally be the same card, just re-fetched with a shorter refresh
 * cadence"), and follows the same `open`/`onClose`/`onSaved` prop contract as
 * `ProjectRequirementsDialog` so `ProjectDashboard`'s wiring stays uniform between the two modes.
 *
 * Question types (UX spec §5), the Question Queue (§6), full responsive tablet/mobile layouts
 * (§2/§13), and accessibility polish (§12) are explicitly NOT built in this foundation sprint —
 * plain open-ended text is the only interaction, per the sprint brief's "no polish" scope. See
 * the Sprint 56 implementation status note in docs/06-Requirements-Discovery/00-index.md for the
 * full list of what's deferred to later milestones.
 */

interface InterviewChatDialogProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  onSwitchToForm?: () => void;
}

function isCompletion(message: RequirementsSessionMessage): boolean {
  return message.metadata?.kind === 'completion';
}

/** Sprint 57.1, Task 8 — a genuine extraction failure (network/auth/provider error), never a legitimate empty turn. See `requirementsSessionOrchestrator.ts`'s `recordInterviewAnswer`. */
function isExtractionError(message: RequirementsSessionMessage): boolean {
  return message.metadata?.kind === 'extraction_error';
}

function ChatBubble({
  message,
  onRetry,
  canRetry,
}: {
  message: RequirementsSessionMessage;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const isUser = message.role === 'user';
  const completion = isCompletion(message);
  const failed = isExtractionError(message);

  return (
    <div className={classNames('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={classNames(
          'max-w-[80%] px-3.5 py-2.5 rounded-lg text-sm whitespace-pre-wrap backdrop-blur-sm border',
          isUser
            ? 'bg-purple-500/10 border-purple-500/20 text-bolt-elements-textPrimary'
            : completion
              ? 'bg-green-500/10 border-green-500/30 text-bolt-elements-textPrimary'
              : failed
                ? 'bg-red-500/5 border-red-500/30 text-bolt-elements-textPrimary'
                : 'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor text-bolt-elements-textPrimary',
        )}
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1 text-[11px] font-medium text-bolt-elements-textTertiary">
            <span
              className={classNames(
                completion
                  ? 'i-ph:check-circle-fill text-green-500'
                  : failed
                    ? 'i-ph:warning-circle-fill text-red-500'
                    : 'i-ph:sparkle',
                'h-3 w-3',
              )}
            />
            {completion ? "You're ready" : 'Discovery Agent'}
          </div>
        )}
        {message.content}
        {failed && canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <span className="i-ph:arrow-clockwise h-3.5 w-3.5" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] px-3.5 py-2.5 rounded-lg bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-bolt-elements-textTertiary animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-bolt-elements-textTertiary animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-bolt-elements-textTertiary animate-bounce" />
        </span>
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="space-y-3 px-1 py-2 animate-pulse">
      <div className="h-14 w-2/3 rounded-lg bg-bolt-elements-background-depth-2" />
      <div className="h-10 w-1/2 ml-auto rounded-lg bg-bolt-elements-background-depth-2" />
      <div className="h-14 w-3/4 rounded-lg bg-bolt-elements-background-depth-2" />
    </div>
  );
}

export function InterviewChatDialog({ project, open, onClose, onSaved, onSwitchToForm }: InterviewChatDialogProps) {
  const { state, submitAnswer } = useInterviewSession(project, open);
  const [inputValue, setInputValue] = useState('');
  const [dismissedCompletion, setDismissedCompletion] = useState(false);
  const [discoveryRefreshKey, setDiscoveryRefreshKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wroteAnyAnswerRef = useRef(false);

  /** Sprint 57.1, Task 8 — the last (text, dimension) pair submitted, so a failed turn's Retry chip can resend exactly what the user said without asking them to retype it. */
  const lastAnswerRef = useRef<{ text: string; dimension: DiscoveryDimension | undefined } | null>(null);

  const discoveryIntelligence = useDiscoveryIntelligence(open ? project?.id : undefined, discoveryRefreshKey);

  const messages = state.status === 'ready' ? state.messages : [];
  const submitting = state.status === 'ready' && state.submitting;
  const isReady = state.status === 'ready' && state.pendingDimension === null;

  // Reset per-open UI-only state whenever the dialog is closed.
  useEffect(() => {
    if (!open) {
      setInputValue('');
      setDismissedCompletion(false);
      wroteAnyAnswerRef.current = false;
      lastAnswerRef.current = null;
    }
  }, [open]);

  // Re-fetch the live Business Discovery panel after every turn (architecture doc §9).
  const readyMessageCount = state.status === 'ready' ? state.messages.length : 0;
  useEffect(() => {
    if (state.status === 'ready' && wroteAnyAnswerRef.current) {
      setDiscoveryRefreshKey((key) => key + 1);
    }
  }, [readyMessageCount]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, submitting]);

  const handleClose = () => {
    onSaved?.();
    onClose();
  };

  const handleSend = () => {
    if (!inputValue.trim() || submitting) {
      return;
    }

    const dimension = state.status === 'ready' ? (state.pendingDimension ?? undefined) : undefined;
    lastAnswerRef.current = { text: inputValue, dimension };
    wroteAnyAnswerRef.current = true;
    submitAnswer(inputValue, dimension);
    setInputValue('');
  };

  const handleRetry = () => {
    if (!lastAnswerRef.current || submitting) {
      return;
    }

    submitAnswer(lastAnswerRef.current.text, lastAnswerRef.current.dimension);
  };

  const handleKeepTalking = () => {
    setDismissedCompletion(true);
  };

  const handleKeepTalkingSend = () => {
    if (!inputValue.trim() || submitting) {
      return;
    }

    lastAnswerRef.current = { text: inputValue, dimension: 'businessVision' };
    wroteAnyAnswerRef.current = true;
    submitAnswer(inputValue, 'businessVision');
    setInputValue('');
  };

  const handleGenerate = () => {
    toast.success('Ready! Head to Requirements & Knowledge below to generate your Project Definition.');
    handleClose();
  };

  const showCompletionBanner = isReady && !dismissedCompletion;

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && handleClose()}>
      <RadixDialog.Portal>
        <div className="fixed inset-0 flex items-center justify-center z-[110] modern-scrollbar">
          <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />

          <RadixDialog.Content aria-describedby={undefined} onEscapeKeyDown={handleClose} className="relative z-[111]">
            <div
              className={classNames(
                'w-[1100px] max-w-[96vw] h-[80vh] max-h-[820px]',
                'bg-bolt-elements-background-depth-1',
                'rounded-2xl shadow-2xl',
                'border border-bolt-elements-borderColor',
                'flex flex-col overflow-hidden relative',
                'transform transition-all duration-200 ease-out',
                open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
              )}
            >
              {/* Header */}
              <div className="px-8 pt-6 pb-4 border-b border-bolt-elements-borderColor/60 flex items-start justify-between shrink-0">
                <div>
                  <RadixDialog.Title className="text-xl font-semibold tracking-tight text-bolt-elements-textPrimary flex items-center gap-2">
                    <span className="i-ph:chat-circle-dots-duotone h-5 w-5 text-purple-500" />
                    Interview with Discovery Agent
                  </RadixDialog.Title>
                  <RadixDialog.Description className="text-sm text-bolt-elements-textTertiary mt-1">
                    Talk it through like you would with a consultant — I'll ask what I need to know.
                  </RadixDialog.Description>
                </div>
                <button
                  onClick={handleClose}
                  className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-purple-500/10 dark:hover:bg-purple-500/20 group transition-all duration-200 shrink-0"
                >
                  <div className="i-ph:x w-4 h-4 text-bolt-elements-textTertiary group-hover:text-purple-500 transition-colors" />
                </button>
              </div>

              {/* Body — chat (~60%) + Business Discovery panel (~40%), UX spec §2 */}
              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 basis-[60%] flex flex-col overflow-hidden border-r border-bolt-elements-borderColor/40">
                  <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-3 modern-scrollbar">
                    {state.status === 'loading' || state.status === 'idle' ? (
                      <ChatSkeleton />
                    ) : state.status === 'unavailable' ? (
                      <div className="flex flex-col items-center justify-center text-center py-12 px-4 text-bolt-elements-textTertiary text-sm">
                        Interview Mode isn't available right now.
                      </div>
                    ) : state.status === 'error' ? (
                      <div className="flex flex-col items-center justify-center text-center py-12 px-4">
                        <span className="i-ph:warning-circle-duotone h-8 w-8 text-red-500/70 mb-2" />
                        <div className="text-sm text-bolt-elements-textSecondary">{state.message}</div>
                      </div>
                    ) : (
                      <>
                        {state.isResume && (
                          <div className="text-center">
                            <span className="text-[11px] font-medium px-3 py-1 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary bg-bolt-elements-background-depth-2/60">
                              Welcome back — here's where we left off
                            </span>
                          </div>
                        )}
                        {messages.map((message, index) => (
                          <ChatBubble
                            key={message.id}
                            message={message}
                            onRetry={handleRetry}
                            canRetry={index === messages.length - 1 && !submitting && lastAnswerRef.current !== null}
                          />
                        ))}
                        {submitting && <ThinkingBubble />}
                        {showCompletionBanner && (
                          <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 space-y-3">
                            <div className="flex gap-3">
                              <button
                                type="button"
                                onClick={handleGenerate}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-purple-500 text-white hover:bg-purple-600"
                              >
                                Generate Project Definition
                              </button>
                              <button
                                type="button"
                                onClick={handleKeepTalking}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-transparent text-bolt-elements-textSecondary hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                Keep talking
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Input + action bar */}
                  <div className="px-6 py-4 border-t border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/40 shrink-0 space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={inputValue}
                        onChange={(event) => setInputValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') {
                            return;
                          }

                          if (isReady && !showCompletionBanner) {
                            handleKeepTalkingSend();
                          } else if (!isReady) {
                            handleSend();
                          }
                        }}
                        disabled={state.status !== 'ready' || submitting || showCompletionBanner}
                        placeholder="Type your answer..."
                        className={classNames(
                          'flex-1 bg-gray-50 dark:bg-bolt-elements-background-depth-2 px-3.5 py-2.5 rounded-lg',
                          'focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-sm',
                          'text-gray-900 dark:text-bolt-elements-textPrimary placeholder-gray-500 dark:placeholder-bolt-elements-textTertiary',
                          'border border-gray-200 dark:border-bolt-elements-borderColor',
                          'disabled:opacity-50',
                        )}
                      />
                      <button
                        type="button"
                        onClick={isReady ? handleKeepTalkingSend : handleSend}
                        disabled={state.status !== 'ready' || submitting || !inputValue.trim() || showCompletionBanner}
                        className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                      >
                        <span className="i-ph:arrow-right w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={handleClose}
                        className="flex gap-1.5 items-center text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors"
                      >
                        <span className="i-ph:pause-circle h-4 w-4" />
                        Pause
                      </button>
                      {onSwitchToForm && (
                        <button
                          type="button"
                          onClick={() => {
                            onSwitchToForm();
                            onClose();
                          }}
                          className="flex gap-1.5 items-center text-xs text-bolt-elements-textTertiary hover:text-purple-500 transition-colors"
                        >
                          <span className="i-ph:pencil-simple h-4 w-4" />
                          Switch to Form
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Business Discovery panel — same component as the Form's, just live (UX spec §4) */}
                <div className="basis-[40%] overflow-y-auto px-5 py-5 modern-scrollbar">
                  <BusinessDiscoveryCard state={discoveryIntelligence} />
                </div>
              </div>
            </div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
