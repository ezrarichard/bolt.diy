import { classNames } from '~/utils/classNames';
import { type Project } from '~/lib/stores/projects';
import { ARTIFACT_TYPES, formatArtifactTimestamp } from '~/lib/projects/artifacts';
import { backendEngineerEngine } from '~/lib/projects/backendEngineerEngine';
import { BACKEND_DRAFT_FIELDS, type BackendDraft } from '~/lib/projects/prompts/backend';
import { useDraftPanel } from '~/lib/hooks/useDraftPanel';

interface BackendDraftPanelProps {
  project: Project;
}

const ARTIFACT_TYPE = ARTIFACT_TYPES.BACKEND_DRAFT;

/**
 * The Backend Draft asks for 21 free-text and list fields (backend
 * overview through recommended next steps) — the largest draft shape yet,
 * so it keeps the same larger output budget the Architecture, Database
 * Design, and UI/UX Drafts needed for the same truncation reason.
 * app/routes/api.generate-text.ts fails gracefully (a clear 400 message
 * surfaced via `errorMessage`) if the selected model can't support this
 * many output tokens.
 */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * Sprint 19 — the Backend Draft feature, built on the exact Sprint 16
 * UIUXDraftPanel pattern: a "Generate Backend Draft" button, a confirm
 * step, a loading state, a structured preview with
 * Approve/Discard/Regenerate, and a persistent status line once a draft
 * exists. Approve here only ever changes this artifact's own `status` — it
 * never generates backend code, SQL, Prisma/Drizzle/Supabase schemas,
 * connects to GitHub, or deploys anything, and never mutates Project
 * Knowledge, the Architecture Draft, the Database Design Draft, or the
 * UI/UX Draft. Generation is disabled until the UI/UX Draft has been
 * approved (`backendEngineerEngine.canGenerateBackend`). All context
 * gathering/prompt building/parsing goes through `backendEngineerEngine`;
 * this component only orchestrates calling it and persisting the result —
 * the state machine itself lives in app/lib/hooks/useDraftPanel.ts, shared
 * with every other status-only-approval draft panel.
 */
export function BackendDraftPanel({ project }: BackendDraftPanelProps) {
  const {
    phase,
    setPhase,
    errorMessage,
    isGenerating,
    canGenerate,
    latest,
    latestDraft,
    isPreviewing,
    statusMeta,
    runGeneration,
    handleApprove,
    handleDiscard,
  } = useDraftPanel<BackendDraft, ReturnType<typeof backendEngineerEngine.buildBackendContext>>({
    project,
    artifactType: ARTIFACT_TYPE,
    titlePrefix: 'Backend Draft',
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    canGenerate: backendEngineerEngine.canGenerateBackend,
    buildContext: backendEngineerEngine.buildBackendContext,
    buildPrompt: backendEngineerEngine.buildBackendPrompt,
    parseDraft: backendEngineerEngine.parseDraft,
    createDraftArtifact: backendEngineerEngine.createDraftArtifact,
  });

  if (!canGenerate && !latest) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled
          title="Approve the UI/UX Draft first."
          className="flex gap-2 items-center bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary cursor-not-allowed opacity-60 rounded-lg px-4 py-2"
        >
          <span className="inline-block i-ph:sparkle h-4 w-4" />
          <span className="text-sm font-medium">Generate Backend Draft</span>
        </button>
        <span className="text-xs text-bolt-elements-textTertiary">Approve the UI/UX Draft first.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isPreviewing ? (
        <div
          className={classNames(
            'rounded-xl border border-purple-500/30 p-5',
            'bg-purple-50/70 dark:bg-purple-500/[0.08] backdrop-blur-md',
          )}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300">
              Backend Draft Preview
            </div>
            <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-300">
              v{latest?.version ?? 1}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {BACKEND_DRAFT_FIELDS.map((field) => {
              const value = latestDraft?.[field.key];
              const display = Array.isArray(value) ? value.join(', ') : value;

              if (!display) {
                return null;
              }

              return (
                <div key={field.key}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                    {field.label}
                  </div>
                  <div className="text-sm text-bolt-elements-textSecondary">{display}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t border-purple-500/20 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleApprove}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => runGeneration(latest)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-transparent text-bolt-elements-textSecondary hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-bolt-elements-textPrimary disabled:opacity-50"
            >
              {isGenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        </div>
      ) : phase === 'confirm' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-bolt-elements-borderColor/60 p-3">
          <span className="text-xs text-bolt-elements-textTertiary">
            The AI Backend Engineer will draft a backend design from your approved UI/UX design and current project
            context. Nothing is saved until you approve it.
          </span>
          <div className="flex gap-2 ml-auto shrink-0">
            <button
              type="button"
              onClick={() => setPhase('idle')}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => runGeneration()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-colors"
            >
              Generate Draft
            </button>
          </div>
        </div>
      ) : phase === 'generating' || isGenerating ? (
        <div className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary px-1">
          <span className="i-svg-spinners:90-ring-with-bg w-3.5 h-3.5 text-purple-500" />
          The AI Backend Engineer is drafting the backend design…
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setPhase('confirm')}
            className="flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
          >
            <span className="inline-block i-ph:sparkle h-4 w-4" />
            <span className="text-sm font-medium">Generate Backend Draft</span>
          </button>
          {phase === 'error' && (
            <span className="text-xs text-red-500">{errorMessage || 'Draft generation failed.'}</span>
          )}
        </div>
      )}

      {latest && !isPreviewing && statusMeta && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-bolt-elements-textTertiary px-1">
          <span className="font-medium text-bolt-elements-textSecondary">Backend Draft</span>
          <span
            className={classNames(
              'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0',
              statusMeta.className,
            )}
          >
            {statusMeta.label}
          </span>
          <span>{formatArtifactTimestamp(latest.updatedAt)}</span>
          <span>·</span>
          <span>{latest.generatedBy ?? 'Unknown generator'}</span>
          <span>·</span>
          <span>v{latest.version ?? 1}</span>
        </div>
      )}
    </div>
  );
}
