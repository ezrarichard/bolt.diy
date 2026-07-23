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
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import { generateRoleWithRecovery } from '~/lib/projects/roleGenerationRecovery';
import { useGenerateText } from '~/lib/hooks/useGenerateText';
import type { DiscoveryState } from '~/lib/projects/requirementsSession';

interface RequirementsDraftPanelProps {
  project: Project;

  /**
   * Sprint 54.1 — the Sprint 54 Discovery Decision Engine's latest state for this project, if
   * one has been computed (`undefined` for a legacy project or one whose Requirements form
   * hasn't been saved since Sprints 50-54 landed — this panel then behaves exactly as it did
   * before this sprint, generation always allowed with no extra step). Display-only gating:
   * READY changes nothing; NEEDS_MORE_INFORMATION adds a non-blocking recommendation; only
   * INSUFFICIENT_INFORMATION requires an explicit acknowledgement before "Generate Draft" is
   * clickable. No deeper pipeline logic (businessAnalystEngine, generation itself) is touched.
   */
  discoveryDecisionState?: DiscoveryState;
}

type Phase = 'idle' | 'confirm' | 'generating' | 'error';

const ARTIFACT_TYPE = ARTIFACT_TYPES.REQUIREMENTS_DRAFT;

/**
 * Base output-token budget for the FIRST attempt — matches every other "*DraftPanel"'s
 * MAX_OUTPUT_TOKENS (see ArchitectureDraftPanel.tsx/useDraftPanel.ts). This panel predates
 * that shared hook (Sprint 13) and never set an explicit budget or used the Sprint 44
 * truncation-recovery mechanism, relying on the provider's own default and a single attempt.
 * That was fine while `RequirementsDraft` was small, but the Project Definition workflow's
 * expanded schema (Business Goals, User Flows, Technical Constraints, Assumptions, Out of
 * Scope — see prompts/requirements.ts) is now this codebase's single largest per-role JSON
 * contract (20+ fields) and reliably exceeds even 8192 tokens on the first attempt.
 * Acceptance-test-verified: wiring in `generateRoleWithRecovery` (same mechanism
 * useAutoEngineeringPipeline.ts already uses) rather than only raising this constant, since a
 * bigger static number just moves the same failure mode further out — the recovery retry
 * raises the budget further (up to 16000) AND asks the model to be more concise.
 */
const MAX_OUTPUT_TOKENS = 8192;

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
export function RequirementsDraftPanel({ project, discoveryDecisionState }: RequirementsDraftPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [insufficientAcknowledged, setInsufficientAcknowledged] = useState(false);
  const { generate, isGenerating } = useGenerateText();

  const requiresAcknowledgement = discoveryDecisionState === 'INSUFFICIENT_INFORMATION';

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

    // Sprint 39.5 — routes this call through the project's selected Generation Profile (falls back to the user's own model selection if unresolved). Sprint 44 recovery — bounded retries with a raised budget + JSON-only reinforcement on truncation (see roleGenerationRecovery.ts); only a fully-parsed, non-truncated draft is ever returned ok.
    const outcome = await generateRoleWithRecovery({
      projectId: project.id,
      roleKey: ARTIFACT_TYPE,
      system,
      prompt,
      contextBlock: buildersDbContext,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      parseDraft: businessAnalystEngine.parseDraft,
      generate,
      baseOptions: {
        ...getRoleGenerateOptions(project, ARTIFACT_TYPE),
        projectId: project.id,
        roleKey: ARTIFACT_TYPE,
        requestType: 'manual_role_generation',
      },
    });

    if (!outcome.ok) {
      setErrorMessage(outcome.message);
      setPhase('error');

      return;
    }

    if (regenerateArtifact) {
      const nextVersion = (regenerateArtifact.version ?? 1) + 1;
      updateProjectArtifact(project.id, regenerateArtifact.id, {
        title: `Requirements Draft v${nextVersion}`,
        content: JSON.stringify(outcome.draft, null, 2),
        version: nextVersion,
        status: 'draft',
      });
    } else {
      const nextVersion = (latest?.version ?? 0) + 1;
      addProjectArtifact(project.id, businessAnalystEngine.createDraftArtifact(outcome.draft, nextVersion));
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
    toast.success('Project Definition saved — continue refining it with the AI Project Manager below');
  };

  const handleDiscard = () => {
    if (!latest) {
      return;
    }

    updateProjectArtifact(project.id, latest.id, { status: 'discarded' });
    toast.info('Project Definition draft discarded — Project Knowledge unchanged');
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
              Project Definition Draft
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
              Save
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
        <div className="rounded-lg border border-dashed border-bolt-elements-borderColor/60 p-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-bolt-elements-textTertiary">
              The AI Project Manager will draft the Project Definition from your current project context. Nothing is
              saved until you save it.
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
                disabled={requiresAcknowledgement && !insufficientAcknowledged}
                onClick={() => runGeneration()}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate Draft
              </button>
            </div>
          </div>

          {discoveryDecisionState === 'NEEDS_MORE_INFORMATION' && (
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              <span className="i-ph:warning-duotone w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Discovery indicates more information is recommended before generating — see Business Discovery above for
                missing/partial areas. You can still generate now if you prefer.
              </span>
            </div>
          )}

          {requiresAcknowledgement && (
            <label className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={insufficientAcknowledged}
                onChange={(event) => setInsufficientAcknowledged(event.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>
                Discovery indicates very little business information has been captured yet (Insufficient Information). I
                understand the generated draft may be low quality and want to proceed anyway.
              </span>
            </label>
          )}
        </div>
      ) : phase === 'generating' || isGenerating ? (
        <div className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary px-1">
          <span className="i-svg-spinners:90-ring-with-bg w-3.5 h-3.5 text-purple-500" />
          The AI Project Manager is drafting the Project Definition…
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setInsufficientAcknowledged(false);
              setPhase('confirm');
            }}
            className="flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
          >
            <span className="inline-block i-ph:sparkle h-4 w-4" />
            <span className="text-sm font-medium">Generate Project Definition</span>
          </button>
          {phase === 'error' && (
            <span className="text-xs text-red-500">{errorMessage || 'Draft generation failed.'}</span>
          )}
        </div>
      )}

      {latest && !isPreviewing && statusMeta && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-bolt-elements-textTertiary px-1">
          <span className="font-medium text-bolt-elements-textSecondary">Project Definition</span>
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
