import { useState } from 'react';
import { resolveOperationId } from '~/lib/observability/aiOperationScope';
import { toast } from 'react-toastify';
import { addProjectArtifact, getProjectArtifacts, updateProjectArtifact, type Project } from '~/lib/stores/projects';
import {
  ARTIFACT_STATUS_META,
  getArtifactByVersion,
  getResumableArtifact,
  parseArtifactContent,
  type ProjectArtifact,
} from '~/lib/projects/artifacts';
import type { ParsedDraftResult } from '~/lib/projects/draftParsing';
import { buildRoleContextBlock } from '~/lib/ai/context/buildersDbContextProvider';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
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

  /**
   * Sprint 75 — optional lockstep-paired artifact type (e.g. Database
   * Engineer's DATABASE_SCHEMA alongside its primary DATABASE_DRAFT).
   * Omitted by every role except Database Design, so every other
   * "*DraftPanel" caller is entirely unaffected: generate/approve/discard
   * only ever touch `artifactType` when these two fields are undefined.
   * When provided, the paired artifact is created/updated at the exact same
   * version as the primary artifact on every generation, and approved/
   * discarded/resumed in the same action as the primary artifact — there is
   * no separate entry point that can move one without the other.
   */
  pairedArtifactType?: string;
  createPairedArtifact?: (draft: TDraft, version: number) => ProjectArtifact;
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
    pairedArtifactType,
    createPairedArtifact,
  } = config;

  const [phase, setPhase] = useState<DraftPanelPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { generate, isGenerating } = useGenerateText();

  const canGenerate = canGenerateFn ? canGenerateFn(project) : true;

  /*
   * Sprint 46.1 — live-verified bugfix: falls back to the latest APPROVED version when the
   * true-latest version was discarded, instead of dead-ending on "Generate Draft" as if this
   * role had never produced anything. See getResumableArtifact's comment in artifacts.ts.
   */
  const latest = getResumableArtifact(getProjectArtifacts(project), artifactType);
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

    // Sprint 39.5 — routes this call through the project's selected Generation Profile (artifactType matches builders_ai_roles.role_key exactly), falling back to the user's own model selection if unresolved.
    const result = await generate(system, fullPrompt, {
      ...(maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : {}),
      ...getRoleGenerateOptions(project, artifactType),

      // Sprint 42.1 — AI usage-ledger attribution (see app/lib/ai-usage/).
      projectId: project.id,
      roleKey: artifactType,
      requestType: artifactType,

      /*
       * Observability — joins the pipeline's generation when one is running for this project,
       * and otherwise mints a standalone id so a hand-regenerated role is still a (one-request)
       * generation rather than an ungrouped orphan. See aiOperationScope.ts.
       */
      operationId: resolveOperationId(project.id),
    });

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

    let nextVersion: number;

    if (regenerateArtifact) {
      nextVersion = (regenerateArtifact.version ?? 1) + 1;
      updateProjectArtifact(project.id, regenerateArtifact.id, {
        title: `${titlePrefix} v${nextVersion}`,
        content: JSON.stringify(parsed.draft, null, 2),
        version: nextVersion,
        status: 'draft',
      });
    } else {
      nextVersion = (latest?.version ?? 0) + 1;
      addProjectArtifact(project.id, createDraftArtifact(parsed.draft, nextVersion));
    }

    /*
     * Sprint 75 — keeps a paired artifact (e.g. DATABASE_SCHEMA) at the exact same version as
     * the primary artifact just written above. No-op for every role that doesn't configure pairing.
     */
    if (pairedArtifactType && createPairedArtifact) {
      const existingPaired = getResumableArtifact(getProjectArtifacts(project), pairedArtifactType);
      const pairedArtifact = createPairedArtifact(parsed.draft, nextVersion);

      if (existingPaired && existingPaired.status !== 'discarded') {
        updateProjectArtifact(project.id, existingPaired.id, {
          title: pairedArtifact.title,
          content: pairedArtifact.content,
          version: nextVersion,
          status: 'draft',
        });
      } else {
        addProjectArtifact(project.id, { ...pairedArtifact, version: nextVersion });
      }
    }

    setPhase('idle');
  };

  const handleApprove = () => {
    if (!latest) {
      return;
    }

    updateProjectArtifact(project.id, latest.id, { status: 'approved' });

    if (pairedArtifactType && latest.version !== undefined) {
      const paired = getArtifactByVersion(getProjectArtifacts(project), pairedArtifactType, latest.version);

      if (paired) {
        updateProjectArtifact(project.id, paired.id, { status: 'approved' });
      }
    }

    toast.success(`${titlePrefix} approved`);
  };

  const handleDiscard = () => {
    if (!latest) {
      return;
    }

    updateProjectArtifact(project.id, latest.id, { status: 'discarded' });

    if (pairedArtifactType && latest.version !== undefined) {
      const paired = getArtifactByVersion(getProjectArtifacts(project), pairedArtifactType, latest.version);

      if (paired) {
        updateProjectArtifact(project.id, paired.id, { status: 'discarded' });
      }
    }

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
