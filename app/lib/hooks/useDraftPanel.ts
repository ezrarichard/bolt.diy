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
  isPreviewing: boolean;
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
  const isPreviewing = Boolean(latest?.status === 'draft' && latestDraft);

  const runGeneration = async (regenerateArtifact?: ProjectArtifact) => {
    setPhase('generating');
    setErrorMessage('');

    const context = buildContext(project);
    const { system, prompt } = buildPrompt(context);
    const result = await generate(
      system,
      prompt,
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
    statusMeta,
    runGeneration,
    handleApprove,
    handleDiscard,
  };
}
