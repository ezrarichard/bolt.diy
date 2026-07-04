import { useState } from 'react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { addProjectArtifact, getProjectArtifacts, updateProjectArtifact, type Project } from '~/lib/stores/projects';
import {
  ARTIFACT_STATUS_META,
  ARTIFACT_TYPES,
  formatArtifactTimestamp,
  getLatestArtifact,
  parseArtifactContent,
  type ProjectArtifact,
} from '~/lib/projects/artifacts';
import { databaseDesignerEngine } from '~/lib/projects/databaseDesignerEngine';
import { DATABASE_DRAFT_FIELDS, type DatabaseDraft } from '~/lib/projects/prompts/database';
import { useGenerateText } from '~/lib/hooks/useGenerateText';

interface DatabaseDraftPanelProps {
  project: Project;
}

type Phase = 'idle' | 'confirm' | 'generating' | 'error';

const ARTIFACT_TYPE = ARTIFACT_TYPES.DATABASE_DRAFT;

/**
 * The Database Design Draft asks for many free-text and list fields
 * (entities, relationships, keys, indexes, constraints, security model,
 * migration strategy, ...) — same truncation risk the Architecture Draft
 * hit in Sprint 14, so it gets the same larger output budget up front.
 * app/routes/api.generate-text.ts fails gracefully (a clear 400 message
 * surfaced via `errorMessage`) if the selected model can't support this many
 * output tokens.
 */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * Sprint 15 — the Database Design Draft feature, built on the exact Sprint
 * 14 ArchitectureDraftPanel pattern: a "Generate Database Design Draft"
 * button, a confirm step, a loading state, a structured preview with
 * Approve/Discard/Regenerate, and a persistent status line once a draft
 * exists. Approve here only ever changes this artifact's own `status` — it
 * never generates SQL, never connects to Supabase, and never mutates
 * Project Knowledge or the Architecture Draft. Generation is disabled until
 * the Architecture Draft has been approved
 * (`databaseDesignerEngine.canGenerateDatabase`). All context
 * gathering/prompt building/parsing goes through `databaseDesignerEngine`;
 * this component only orchestrates calling it and persisting the result.
 */
export function DatabaseDraftPanel({ project }: DatabaseDraftPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { generate, isGenerating } = useGenerateText();

  const canGenerate = databaseDesignerEngine.canGenerateDatabase(project);
  const latest = getLatestArtifact(getProjectArtifacts(project), ARTIFACT_TYPE);
  const latestDraft = latest ? parseArtifactContent<DatabaseDraft>(latest.content) : undefined;
  const isPreviewing = latest?.status === 'draft' && latestDraft;

  const runGeneration = async (regenerateArtifact?: ProjectArtifact) => {
    setPhase('generating');
    setErrorMessage('');

    const context = databaseDesignerEngine.buildDatabaseContext(project);
    const { system, prompt } = databaseDesignerEngine.buildDatabasePrompt(context);
    const result = await generate(system, prompt, { maxTokens: MAX_OUTPUT_TOKENS });

    if (!result.ok) {
      setErrorMessage(result.error);
      setPhase('error');

      return;
    }

    const parsed = databaseDesignerEngine.parseDraft(result.text);

    if (!parsed.ok) {
      setErrorMessage(parsed.error);
      setPhase('error');

      return;
    }

    if (regenerateArtifact) {
      const nextVersion = (regenerateArtifact.version ?? 1) + 1;
      updateProjectArtifact(project.id, regenerateArtifact.id, {
        title: `Database Design Draft v${nextVersion}`,
        content: JSON.stringify(parsed.draft, null, 2),
        version: nextVersion,
        status: 'draft',
      });
    } else {
      const nextVersion = (latest?.version ?? 0) + 1;
      addProjectArtifact(project.id, databaseDesignerEngine.createDraftArtifact(parsed.draft, nextVersion));
    }

    setPhase('idle');
  };

  const handleApprove = () => {
    if (!latest) {
      return;
    }

    updateProjectArtifact(project.id, latest.id, { status: 'approved' });
    toast.success('Database Design Draft approved');
  };

  const handleDiscard = () => {
    if (!latest) {
      return;
    }

    updateProjectArtifact(project.id, latest.id, { status: 'discarded' });
    toast.info('Database Design Draft discarded');
  };

  const statusMeta = latest ? ARTIFACT_STATUS_META[latest.status as keyof typeof ARTIFACT_STATUS_META] : undefined;

  if (!canGenerate && !latest) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled
          title="Approve the Architecture Draft first."
          className="flex gap-2 items-center bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary cursor-not-allowed opacity-60 rounded-lg px-4 py-2"
        >
          <span className="inline-block i-ph:sparkle h-4 w-4" />
          <span className="text-sm font-medium">Generate Database Design Draft</span>
        </button>
        <span className="text-xs text-bolt-elements-textTertiary">Approve the Architecture Draft first.</span>
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
              Database Design Draft Preview
            </div>
            <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-300">
              v{latest?.version ?? 1}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DATABASE_DRAFT_FIELDS.map((field) => {
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
            The AI Database Designer will draft a conceptual database design from your approved architecture and current
            project context. Nothing is saved until you approve it.
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
          The AI Database Designer is drafting the database design…
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setPhase('confirm')}
            className="flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
          >
            <span className="inline-block i-ph:sparkle h-4 w-4" />
            <span className="text-sm font-medium">Generate Database Design Draft</span>
          </button>
          {phase === 'error' && (
            <span className="text-xs text-red-500">{errorMessage || 'Draft generation failed.'}</span>
          )}
        </div>
      )}

      {latest && !isPreviewing && statusMeta && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-bolt-elements-textTertiary px-1">
          <span className="font-medium text-bolt-elements-textSecondary">Database Design Draft</span>
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
