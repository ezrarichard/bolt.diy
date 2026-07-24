import { useRef } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { useDocumentImportSession } from '~/lib/hooks/useDocumentImportSession';

/**
 * Sprint 58 — Business Knowledge Completion (Document Discovery).
 *
 * The third Discovery entry point, sibling to `ProjectRequirementsDialog` (Form) and
 * `InterviewChatDialog` (Interview) — same `open`/`onClose`/`onSaved` contract, so
 * `ProjectDashboard`'s wiring stays uniform across all three modes. Unlike the other two, this is
 * a one-shot action (pick a file, extract, done) rather than a multi-field form or a
 * conversation, so its body is a single upload surface instead of either of theirs.
 */

interface ProjectDocumentImportDialogProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  onSwitchToForm?: () => void;
  onSwitchToInterview?: () => void;
}

const ACCEPTED_EXTENSIONS = '.pdf,.docx,.txt,.md';

export function ProjectDocumentImportDialog({
  project,
  open,
  onClose,
  onSaved,
  onSwitchToForm,
  onSwitchToInterview,
}: ProjectDocumentImportDialogProps) {
  const { state, importDocument, reset } = useDocumentImportSession(project);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    await importDocument(file);
    onSaved?.();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void handleFileSelected(event.dataTransfer.files?.[0]);
  };

  const busy = state.status === 'extracting' || state.status === 'analyzing';

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && handleClose()}>
      <RadixDialog.Portal>
        <div className="fixed inset-0 flex items-center justify-center z-[110] modern-scrollbar">
          <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />

          <RadixDialog.Content aria-describedby={undefined} onEscapeKeyDown={handleClose} className="relative z-[111]">
            <div
              className={classNames(
                'w-[640px] max-w-[94vw]',
                'bg-bolt-elements-background-depth-1',
                'rounded-2xl shadow-2xl',
                'border border-bolt-elements-borderColor',
                'flex flex-col overflow-hidden relative',
                'transform transition-all duration-200 ease-out',
                open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
              )}
            >
              {/* Header */}
              <div className="px-8 pt-7 pb-5 border-b border-bolt-elements-borderColor/60">
                <div className="flex items-start justify-between">
                  <div>
                    <RadixDialog.Title className="text-xl font-semibold tracking-tight text-bolt-elements-textPrimary flex items-center gap-2">
                      <span className="i-ph:file-arrow-up-duotone h-5 w-5 text-purple-500" />
                      Import Business Document
                    </RadixDialog.Title>
                    <RadixDialog.Description className="text-sm text-bolt-elements-textTertiary mt-1">
                      Upload a PDF, Word doc, or text file describing your business — I'll pull out what's relevant.
                    </RadixDialog.Description>
                  </div>
                  <button
                    onClick={handleClose}
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-purple-500/10 dark:hover:bg-purple-500/20 group transition-all duration-200 shrink-0"
                  >
                    <div className="i-ph:x w-4 h-4 text-bolt-elements-textTertiary group-hover:text-purple-500 transition-colors" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-8 py-6">
                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => !busy && fileInputRef.current?.click()}
                  className={classNames(
                    'rounded-xl border border-dashed p-10 text-center transition-colors',
                    busy
                      ? 'border-bolt-elements-borderColor/60 cursor-default'
                      : 'border-bolt-elements-borderColor cursor-pointer hover:border-purple-500/50 hover:bg-purple-500/5',
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_EXTENSIONS}
                    className="hidden"
                    disabled={busy}
                    onChange={(event) => void handleFileSelected(event.target.files?.[0])}
                  />

                  {state.status === 'idle' && (
                    <>
                      <span className="i-ph:upload-simple-duotone h-8 w-8 text-bolt-elements-textTertiary mb-3 inline-block" />
                      <div className="text-sm font-medium text-bolt-elements-textSecondary">
                        Drop a file here, or click to browse
                      </div>
                      <div className="text-xs text-bolt-elements-textTertiary mt-1">PDF, DOCX, TXT, or Markdown</div>
                    </>
                  )}

                  {busy && (
                    <>
                      <span className="flex items-center justify-center gap-1 mb-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce" />
                      </span>
                      <div className="text-sm font-medium text-bolt-elements-textSecondary">
                        {state.status === 'extracting' ? `Reading ${state.fileName}...` : 'Analyzing document...'}
                      </div>
                    </>
                  )}

                  {state.status === 'success' && (
                    <>
                      <span className="i-ph:check-circle-fill h-8 w-8 text-green-500 mb-3 inline-block" />
                      <div className="text-sm font-medium text-bolt-elements-textPrimary">
                        Imported {state.fileName}
                      </div>
                      <div className="text-xs text-bolt-elements-textTertiary mt-1">
                        {state.acceptedFactCount > 0
                          ? `Found ${state.acceptedFactCount} business detail${state.acceptedFactCount === 1 ? '' : 's'}.`
                          : "Didn't find anything new — try another document or a different method."}
                      </div>
                    </>
                  )}

                  {state.status === 'error' && (
                    <>
                      <span className="i-ph:warning-circle-duotone h-8 w-8 text-red-500/70 mb-3 inline-block" />
                      <div className="text-sm text-bolt-elements-textSecondary">{state.message}</div>
                      <div className="text-xs text-bolt-elements-textTertiary mt-1">Click to try another file.</div>
                    </>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-8 py-4 border-t border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/40">
                <div className="flex gap-4">
                  {onSwitchToForm && (
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchToForm();
                        handleClose();
                      }}
                      className="flex gap-1.5 items-center text-xs text-bolt-elements-textTertiary hover:text-purple-500 transition-colors"
                    >
                      <span className="i-ph:pencil-simple h-4 w-4" />
                      Switch to Form
                    </button>
                  )}
                  {onSwitchToInterview && (
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchToInterview();
                        handleClose();
                      }}
                      className="flex gap-1.5 items-center text-xs text-bolt-elements-textTertiary hover:text-purple-500 transition-colors"
                    >
                      <span className="i-ph:chat-circle-dots h-4 w-4" />
                      Talk it through instead
                    </button>
                  )}
                </div>
                <button
                  onClick={handleClose}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-purple-500 text-white hover:bg-purple-600"
                >
                  Done
                </button>
              </div>
            </div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
