import { useState } from 'react';
import { toast } from 'react-toastify';
import { addProjectArtifact, getProjectArtifacts, updateProjectArtifact, type Project } from '~/lib/stores/projects';
import {
  ARTIFACT_STATUS_META,
  getLatestArtifact,
  parseArtifactContent,
  type ProjectArtifact,
} from '~/lib/projects/artifacts';
import type { ParsedDraftResult } from '~/lib/projects/draftParsing';
import { buildRoleContextBlock } from '~/lib/ai/context/buildersDbContextProvider';
import { useGenerateText } from './useGenerateText';

export type DraftPanelPhase = 'idle' | 'confirm' | 'generating' | 'error';

/**
 * Sprint 16 — the generate/approve/discard/regenerate state machine shared
 * by every "*DraftPanel" component whose approval only ever flips its own
 * artifact `status` (Architecture, Database Design, UI/UX, and future AI
 * roles). Extracted out of ArchitectureDraftPanel/DatabaseDraftPanel, which
 * were byte-for-byte copies of this logic differing only in which engine
 * they called and what copy they rendered.
 *
 * RequirementsDraftPanel deliberately does NOT use this hook — approving a
 * Requirements Draft also merges into Project Knowledge
 * (businessAnalystEngine.summarizeRequirements), a side effect none of the
 * other roles have, so it keeps its own bespoke approve handler rather than
 * bending this generic one around a special case.
 */
export interface DraftPanelConfig<TDraft extends object, TContext> {
  project: Project;
  artifactType: string;

  /** Used both for the artifact's title ("${titlePrefix} v1") and the approve/discard toast copy ("${titlePrefix} approved"). */
  titlePrefix: string;
  maxOutputTokens?: number;

  /** Omit when generation has no precondition — defaults to always allowed. */
  canGenerate?: (project: Project) => boolean;
  buildContext: (project: Project) => TContext;
  buildPrompt: (context: TContext) => { system: string; prompt: string };
  parseDraft: (rawText: string) => ParsedDraftResult<TDraft>;
  createDraftArtifact: (draft: TDraft, version: number) => ProjectArtifact;
}

export interface DraftPanelState<TDraft> {
  phase: DraftPanelPhase;
  setPhase: (phase: DraftPanelPhase) => void;
  errorMessage: string;
  isGenerating: boolean;
  canGenerate: boolean;
  latest: ProjectArtifact | undefined;
  latestDraft: TDraft | undefined;

  /**
   * Sprint 31.1 — true whenever there's real parsed draft content to show,
   * regardless of approval status. Previously this only covered `'draft'`
   * (the human-review-pending state), so the moment something auto-approved
   * an artifact (the autonomous AI Engineering Team pipeline), every field
   * this panel renders vanished behind a bare status line even though the
   * real generated content was sitting right there in the artifact. Kept as
   * `isPreviewing` for any caller still checking that name — same value,
   * broadened meaning.
   */
  isPreviewing: boolean;

  /** True only while the latest draft is still awaiting a human decision — gates whether Approve/Discard render; Regenerate and the content itself no longer depend on this. */
  isPendingApproval: boolean;
  statusMeta: (typeof ARTIFACT_STATUS_META)[keyof typeof ARTIFACT_STATUS_META] | undefined;
  runGeneration: (regenerateArtifact?: ProjectArtifact) => Promise<void>;
  handleApprove: () => void;
  handleDiscard: () => void;
}

export function useDraftPanel<TDraft extends object, TContext>(
  config: DraftPanelConfig<TDraft, TContext>,
): DraftPanelState<TDraft> {
  const {
    project,
    artifactType,
    titlePrefix,
    maxOutputTokens,
    canGenerate: canGenerateFn,
    buildContext,
    buildPrompt,
    parseDraft,
    createDraftArtifact,
  } = config;

  const [phase, setPhase] = useState<DraftPanelPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { generate, isGenerating } = useGenerateText();

  const canGenerate = canGenerateFn ? canGenerateFn(project) : true;
  const latest = getLatestArtifact(getProjectArtifacts(project), artifactType);
  const latestDraft = latest ? parseArtifactContent<TDraft>(latest.content) : undefined;
  const isPendingApproval = latest?.status === 'draft';
  const isPreviewing = Boolean(latestDraft && (latest?.status === 'draft' || latest?.status === 'approved'));

  const runGeneration = async (regenerateArtifact?: ProjectArtifact) => {
    setPhase('generating');
    setErrorMessage('');

    const context = buildContext(project);
    const { system, prompt } = buildPrompt(context);

    /**
     * Sprint 35 — appends BuildersDB's persistent context (prior roles' approved/latest
     * outputs, tasks, reviews) as an additional section, never replacing anything
     * `buildPrompt` already produced. Resolves to `''` (see buildRoleContextBlock) when
     * BuildersDB isn't configured or has nothing relevant yet, so this is a no-op for
     * every project until BuildersDB is actually provisioned.
     */
    const buildersDbContext = await buildRoleContextBlock(
      project.id,
      artifactType,
      project.description ?? project.name,
    );
    const fullPrompt = buildersDbContext ? `${prompt}\n\n${buildersDbContext}` : prompt;

    const result = await generate(
      system,
      fullPrompt,
      maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : undefined,
    );

    if (!result.ok) {
      setErrorMessage(result.error);
      setPhase('error');

      return;
    }

    const parsed = parseDraft(result.text);

    if (!parsed.ok) {
      setErrorMessage(parsed.error);
      setPhase('error');

      return;
    }

    if (regenerateArtifact) {
      const nextVersion = (regenerateArtifact.version ?? 1) + 1;
      updateProjectArtifact(project.id, regenerateArtifact.id, {
        title: `${titlePrefix} v${nextVersion}`,
        content: JSON.stringify(parsed.draft, null, 2),
        version: nextVersion,
        status: 'draft',
      });
    } else {
      const nextVersion = (latest?.version ?? 0) + 1;
      addProjectArtifact(project.id, createDraftArtifact(parsed.draft, nextVersion));
    }

    setPhase('idle');
  };

  const handleApprove = () => {
    if (!latest) {
      return;
    }

    updateProjectArtifact(project.id, latest.id, { status: 'approved' });
    toast.success(`${titlePrefix} approved`);
  };

  const handleDiscard = () => {
    if (!latest) {
      return;
    }

    updateProjectArtifact(project.id, latest.id, { status: 'discarded' });
    toast.info(`${titlePrefix} discarded`);
  };

  const statusMeta = latest ? ARTIFACT_STATUS_META[latest.status as keyof typeof ARTIFACT_STATUS_META] : undefined;

  return {
    phase,
    setPhase,
    errorMessage,
    isGenerating,
    canGenerate,
    latest,
    latestDraft,
    isPreviewing,
    isPendingApproval,
    statusMeta,
    runGeneration,
    handleApprove,
    handleDiscard,
  };
}
