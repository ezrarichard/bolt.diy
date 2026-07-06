import { useState } from 'react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import {
  addProjectArtifact,
  getProjectArtifacts,
  getProjectKnowledge,
  updateProjectArtifact,
  updateProjectKnowledge,
  type Project,
} from '~/lib/stores/projects';
import {
  ARTIFACT_STATUS_META,
  ARTIFACT_TYPES,
  formatArtifactTimestamp,
  getLatestArtifact,
  parseArtifactContent,
  type ProjectArtifact,
} from '~/lib/projects/artifacts';
import { businessAnalystEngine } from '~/lib/projects/businessAnalystEngine';
import { REQUIREMENTS_DRAFT_FIELDS, type RequirementsDraft } from '~/lib/projects/prompts/requirements';
import type { AIDecision } from '~/lib/projects/draftParsing';
import { buildRoleContextBlock } from '~/lib/ai/context/buildersDbContextProvider';
import { useGenerateText } from '~/lib/hooks/useGenerateText';

interface RequirementsDraftPanelProps {
  project: Project;
}

type Phase = 'idle' | 'confirm' | 'generating' | 'error';

const ARTIFACT_TYPE = ARTIFACT_TYPES.REQUIREMENTS_DRAFT;

/**
 * Sprint 13 — the Requirements Draft feature end to end: a "Generate Draft
 * Requirements" button (replacing the old disabled placeholder), a
 * confirm step, a loading state, a structured preview with
 * Approve/Discard/Regenerate, and a persistent status line once a draft
 * exists (Task: Dashboard). Project Knowledge is only ever updated from
 * Approve — Discard and a fresh Generate never touch it. All context
 * gathering/prompt building/parsing goes through `businessAnalystEngine`;
 * this component only orchestrates calling it and persisting the result.
 */
export function RequirementsDraftPanel({ project }: RequirementsDraftPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { generate, isGenerating } = useGenerateText();

  const latest = getLatestArtifact(getProjectArtifacts(project), ARTIFACT_TYPE);
  const latestDraft = latest ? parseArtifactContent<RequirementsDraft>(latest.content) : undefined;
  const isPreviewing = latest?.status === 'draft' && latestDraft;

  const runGeneration = async (regenerateArtifact?: ProjectArtifact) => {
    setPhase('generating');
    setErrorMessage('');

    const context = businessAnalystEngine.buildRequirementsContext(project);
    const { system, prompt } = businessAnalystEngine.buildBusinessPrompt(context);

    // Sprint 35 — same additive BuildersDB context section as useDraftPanel.ts; see that file's comment. Requirements is the first pipeline role, so this contributes tasks/original-prompt continuity but no upstream role outputs (there are none before it).
    const buildersDbContext = await buildRoleContextBlock(
      project.id,
      ARTIFACT_TYPE,
      project.description ?? project.name,
    );
    const fullPrompt = buildersDbContext ? `${prompt}\n\n${buildersDbContext}` : prompt;

    const result = await generate(system, fullPrompt);

    if (!result.ok) {
      setErrorMessage(result.error);
      setPhase('error');

      return;
    }

    const parsed = businessAnalystEngine.parseDraft(result.text);

    if (!parsed.ok) {
      setErrorMessage(parsed.error);
      setPhase('error');

      return;
    }

    if (regenerateArtifact) {
      const nextVersion = (regenerateArtifact.version ?? 1) + 1;
      updateProjectArtifact(project.id, regenerateArtifact.id, {
        title: `Requirements Draft v${nextVersion}`,
        content: JSON.stringify(parsed.draft, null, 2),
        version: nextVersion,
        status: 'draft',
      });
    } else {
      const nextVersion = (latest?.version ?? 0) + 1;
      addProjectArtifact(project.id, businessAnalystEngine.createDraftArtifact(parsed.draft, nextVersion));
    }

    setPhase('idle');
  };

  const handleApprove = () => {
    if (!latest || !latestDraft) {
      return;
    }

    const knowledgeUpdate = businessAnalystEngine.summarizeRequirements(latestDraft, getProjectKnowledge(project));
    updateProjectKnowledge(project.id, knowledgeUpdate);
    updateProjectArtifact(project.id, latest.id, { status: 'approved' });
    toast.success('Requirements Draft approved — Project Knowledge updated');
  };

  const handleDiscard = () => {
    if (!latest) {
      return;
    }

    updateProjectArtifact(project.id, latest.id, { status: 'discarded' });
    toast.info('Requirements Draft discarded — Project Knowledge unchanged');
  };

  const statusMeta = latest ? ARTIFACT_STATUS_META[latest.status as keyof typeof ARTIFACT_STATUS_META] : undefined;

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
              Requirements Draft Preview
            </div>
            <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-300">
              v{latest?.version ?? 1}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {REQUIREMENTS_DRAFT_FIELDS.map((field) => {
              const value = latestDraft?.[field.key];

              if (field.kind === 'decisions') {
                const decisions = value as AIDecision[] | undefined;

                if (!decisions || decisions.length === 0) {
                  return null;
                }

                return (
                  <div key={field.key} className="md:col-span-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                      {field.label}
                    </div>
                    <ul className="space-y-2">
                      {decisions.map((entry, index) => (
                        <li
                          key={index}
                          className="text-sm text-bolt-elements-textSecondary rounded-lg border border-bolt-elements-borderColor/30 p-2.5"
                        >
                          <div className="font-medium text-bolt-elements-textPrimary">{entry.decision}</div>
                          <div>{entry.reason}</div>
                          {entry.alternativeConsidered && (
                            <div className="text-xs text-bolt-elements-textTertiary mt-1">
                              Alternative considered: {entry.alternativeConsidered}
                              {entry.whyRejected ? ` — rejected: ${entry.whyRejected}` : ''}
                            </div>
                          )}
                          {entry.recommendation && (
                            <div className="text-xs text-bolt-elements-textTertiary mt-1">
                              Recommendation: {entry.recommendation}
                            </div>
                          )}
                          {entry.futureImprovements && (
                            <div className="text-xs text-bolt-elements-textTertiary mt-1">
                              Future improvements: {entry.futureImprovements}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }

              const display = Array.isArray(value) ? (value as string[]).join(', ') : (value as string | undefined);

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
            The AI Business Analyst will draft a requirements document from your current project context. Nothing is
            saved until you approve it.
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
          The AI Business Analyst is drafting requirements…
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setPhase('confirm')}
            className="flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
          >
            <span className="inline-block i-ph:sparkle h-4 w-4" />
            <span className="text-sm font-medium">Generate Draft Requirements</span>
          </button>
          {phase === 'error' && (
            <span className="text-xs text-red-500">{errorMessage || 'Draft generation failed.'}</span>
          )}
        </div>
      )}

      {latest && !isPreviewing && statusMeta && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-bolt-elements-textTertiary px-1">
          <span className="font-medium text-bolt-elements-textSecondary">Requirements Draft</span>
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
