import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  addProjectArtifact,
  getProjectArtifacts,
  getProjectKnowledge,
  projectsStore,
  updateProjectArtifact,
  type Project,
} from '~/lib/stores/projects';
import { getLatestArtifact } from '~/lib/projects/artifacts';
import { isRequirementsCaptured } from '~/lib/projects/knowledge';
import { getNextAutoRole, type AutoEngineeringRoleId } from '~/lib/projects/autoEngineeringEngine';
import { generateRoleWithRecovery, type RoleGenerationFailureKind } from '~/lib/projects/roleGenerationRecovery';
import { buildRoleContextBlock } from '~/lib/ai/context/buildersDbContextProvider';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import { createScopedLogger } from '~/utils/logger';
import { useGenerateText } from './useGenerateText';

const logger = createScopedLogger('autoEngineeringPipeline');

/**
 * Sprint 31 — Autonomous AI Engineering Pipeline.
 *
 * Requirements & Knowledge stays the only manual stage (unchanged —
 * RequirementsDraftPanel/ProjectRequirementsDialog still do exactly what
 * they did before). The moment Requirements is captured, this hook chains
 * every remaining role (Solution Architect -> ... -> DevOps Engineer)
 * automatically: generate, parse, persist the artifact, and immediately
 * approve it — no human click between stages. Mirrors
 * app/lib/hooks/useDraftPanel.ts's own generate/parse/persist sequence for
 * a single stage, just looped across app/lib/projects/autoEngineeringEngine.ts's
 * ordered role registry instead of one engine at a time.
 *
 * Never touches Quick Build, the Generation Runner/Foundation Generation,
 * Workspace, GitHub, Supabase, or model selection — this only drives the
 * same seven engine functions (`buildXContext`/`buildXPrompt`/`parseDraft`/
 * `createDraftArtifact`) every "*DraftPanel" component already called
 * manually, through the same `useGenerateText`/`/api/generate-text` bridge.
 */

/**
 * Module-level (not per-component) so remounting the dashboard, or React
 * re-rendering this hook's owner multiple times, never starts a second
 * concurrent chain against the same project — the loop below already
 * re-reads the project fresh from the store on every iteration, so at most
 * one in-flight run per project id is enough to stay correct.
 */
const runningProjectIds = new Set<string>();

export interface AutoEngineeringPipelineFailure {
  roleId: AutoEngineeringRoleId;

  /** Sprint 44 — distinguishes a truncated/interrupted response from a genuinely bad one, so the UI can show the right business-friendly message. */
  kind: RoleGenerationFailureKind;
  message: string;
}

export interface AutoEngineeringPipelineState {
  isRunning: boolean;
  currentRoleId: AutoEngineeringRoleId | undefined;
  failure: AutoEngineeringPipelineFailure | undefined;

  /** Sprint 44 — manually re-run the failed stage (and, on success, resume the rest of the pipeline). No-op while a run is already in flight. */
  retry: () => void;
}

export function useAutoEngineeringPipeline(project: Project): AutoEngineeringPipelineState {
  const [isRunning, setIsRunning] = useState(false);
  const [currentRoleId, setCurrentRoleId] = useState<AutoEngineeringRoleId | undefined>(undefined);
  const [failure, setFailure] = useState<AutoEngineeringPipelineFailure | undefined>(undefined);
  const [retryNonce, setRetryNonce] = useState(0);

  const { generate } = useGenerateText();
  const generateRef = useRef(generate);
  generateRef.current = generate;

  const retry = useCallback(() => setRetryNonce((nonce) => nonce + 1), []);

  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    const projectId = project.id;
    const knowledge = getProjectKnowledge(project);

    if (!isRequirementsCaptured(knowledge)) {
      return;
    }

    if (runningProjectIds.has(projectId)) {
      return;
    }

    const freshAtStart = projectsStore.get().find((candidate) => candidate.id === projectId) ?? project;

    if (!getNextAutoRole(freshAtStart)) {
      return;
    }

    runningProjectIds.add(projectId);

    if (isMountedRef.current) {
      setIsRunning(true);
      setFailure(undefined);
    }

    (async () => {
      try {
        for (;;) {
          const current = projectsStore.get().find((candidate) => candidate.id === projectId);

          if (!current) {
            break;
          }

          const role = getNextAutoRole(current);

          if (!role) {
            break;
          }

          if (isMountedRef.current) {
            setCurrentRoleId(role.id);
          }

          try {
            const context = role.buildContext(current);
            const { system, prompt } = role.buildPrompt(context);

            // Sprint 35 — same additive BuildersDB context section as useDraftPanel.ts's manual generation path; see that file's comment.
            const buildersDbContext = await buildRoleContextBlock(
              projectId,
              role.artifactType,
              current.description ?? current.name,
            );

            /*
             * Sprint 44 — bounded, finish-reason-aware recovery. A first attempt exactly
             * reproduces the old call (base prompt + BuildersDB context + 8192 budget +
             * profile model); on a truncated/empty/invalid response it retries with the
             * redundant context dropped, a JSON-only + be-concise instruction, and a raised
             * output budget. Only a fully-parsed, non-truncated draft is ever returned ok —
             * so nothing below can persist or approve an incomplete response.
             */
            const outcome = await generateRoleWithRecovery({
              projectId,
              roleKey: role.artifactType,
              system,
              prompt,
              contextBlock: buildersDbContext,
              maxOutputTokens: role.maxOutputTokens,
              parseDraft: role.parseDraft,
              generate: generateRef.current,
              baseOptions: {
                ...getRoleGenerateOptions(current, role.artifactType),
                projectId,
                roleKey: role.artifactType,
                requestType: 'auto_role_generation',
              },
              onAttempt: (log) =>
                logger.debug(
                  `role=${log.roleKey} project=${log.projectId} attempt=${log.attempt} retry=${log.isRetry} ` +
                    `provider=${log.provider ?? 'default'} model=${log.model ?? 'default'} ` +
                    `maxOutputTokens=${log.maxOutputTokens} finishReason=${log.finishReason ?? 'n/a'} ` +
                    `outcome=${log.outcome}`,
                ),
            });

            if (!outcome.ok) {
              if (isMountedRef.current) {
                setFailure({ roleId: role.id, kind: outcome.kind, message: outcome.message });
              }

              toast.error(`${role.label} could not be completed: ${outcome.message}`);
              break;
            }

            const artifacts = getProjectArtifacts(current);
            const latest = getLatestArtifact(artifacts, role.artifactType);
            const nextVersion = (latest?.version ?? 0) + 1;
            const artifact = role.createDraftArtifact(outcome.draft, nextVersion);

            // Sprint 36 — 'automatic' output metadata, so version history can tell this run apart from a human clicking Generate/Regenerate.
            addProjectArtifact(projectId, artifact, 'automatic');
            updateProjectArtifact(projectId, artifact.id, { status: 'approved' }, 'automatic');
            toast.success(`${role.label} completed`);
          } catch (error) {
            const message = error instanceof Error ? error.message : `${role.label} failed unexpectedly.`;

            if (isMountedRef.current) {
              setFailure({ roleId: role.id, kind: 'error', message });
            }

            toast.error(`${role.label} could not be completed: ${message}`);
            break;
          }
        }
      } finally {
        runningProjectIds.delete(projectId);

        if (isMountedRef.current) {
          setIsRunning(false);
          setCurrentRoleId(undefined);
        }
      }
    })();

    // Sprint 44 — `retryNonce` re-enters the effect after a manual "Retry" click even though `project` itself hasn't changed; getNextAutoRole below re-derives the failed (still-unapproved) role from the store, so a retry re-runs only that stage.
  }, [project, retryNonce]);

  return { isRunning, currentRoleId, failure, retry };
}
