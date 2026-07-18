import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import {
  addProjectArtifact,
  getProjectArtifacts,
  getProjectKnowledge,
  hydrateProjectData,
  projectsStore,
  updateProjectArtifact,
  type Project,
} from '~/lib/stores/projects';
import { getLatestArtifact } from '~/lib/projects/artifacts';
import { isRequirementsCaptured } from '~/lib/projects/knowledge';
import {
  getNextAutoRole,
  isProjectDefinitionApproved,
  type AutoEngineeringRoleId,
} from '~/lib/projects/autoEngineeringEngine';
import { generateRoleWithRecovery, type RoleGenerationFailureKind } from '~/lib/projects/roleGenerationRecovery';
import { buildRoleContextBlock } from '~/lib/ai/context/buildersDbContextProvider';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import { createScopedLogger } from '~/utils/logger';
import { projectHydrationStore, readHydrationState } from '~/lib/projects/hydration';
import { resolvePipelineHydrationGate } from '~/lib/projects/pipelineHydrationGate';
import { useAuth } from '~/lib/auth/AuthProvider';
import { useGenerateText } from './useGenerateText';

const logger = createScopedLogger('autoEngineeringPipeline');

/**
 * Sprint 31 — Autonomous AI Engineering Pipeline. Gated by the Project Definition
 * workflow: Requirements & Knowledge (RequirementsDraftPanel/ProjectRequirementsDialog,
 * unchanged) still produces the initial Project Definition draft, but this hook no longer
 * starts the moment that draft exists — it waits for `isProjectDefinitionApproved(project)`,
 * set only by the user's explicit "Approve Project Definition & Start Engineering" click in
 * ProjectDefinitionWorkspace.tsx. Once approved, this hook chains every remaining role
 * (Solution Architect -> ... -> DevOps Engineer) automatically: generate, parse, persist the
 * artifact, and immediately approve it — no human click between stages. Mirrors
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
  /** Undefined for a 'hydration' failure — it happens before any role has been picked. */
  roleId?: AutoEngineeringRoleId;

  /**
   * Sprint 44 — distinguishes a truncated/interrupted response from a genuinely bad one, so
   * the UI can show the right business-friendly message. Sprint 46 adds 'hydration': BuildersDB
   * hydration failed AND this project has no local artifacts to fall back on, so automatic
   * generation is blocked rather than risking a full restart of a project that may already have
   * completed work sitting in BuildersDB.
   */
  kind: RoleGenerationFailureKind | 'hydration';
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

  const { user } = useAuth();
  const userId = user?.id ?? null;

  /** Sprint 46 — subscribed so a hydration status change (loading -> ready/failed) re-enters the effect below even when `project`/`retryNonce` haven't changed themselves (a 'failed' hydration never touches `projectsStore`, only this map). */
  const hydrationMap = useStore(projectHydrationStore);

  const failureRef = useRef(failure);
  failureRef.current = failure;

  const retry = useCallback(() => {
    if (failureRef.current?.kind === 'hydration') {
      // Re-attempt the BuildersDB fetch itself; the effect below re-enters once the store updates.
      hydrateProjectData(project.id);
    }

    setRetryNonce((nonce) => nonce + 1);
  }, [project.id]);

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

    /*
     * Project Definition workflow — the pipeline must never start automatically anymore.
     * Requirements being captured only means a Project Definition draft exists to review;
     * Architecture (and everything after it) waits for the user's explicit "Approve Project
     * Definition & Start Engineering" click (see autoEngineeringEngine.ts's
     * `isProjectDefinitionApproved` for the backward-compatibility rule covering projects
     * that predate this gate).
     */
    if (!isProjectDefinitionApproved(project)) {
      return;
    }

    if (runningProjectIds.has(projectId)) {
      return;
    }

    /*
     * Sprint 46 — never decide "which role to run next" from a project whose BuildersDB data
     * (role outputs in particular) hasn't been restored into `projectsStore` yet. `getNextAutoRole`
     * is a pure function of `project.artifacts`, so reading it before hydration finishes would
     * see every role as unapproved and restart the whole pipeline from Solution Architect —
     * exactly the Sprint 46 resume bug. See pipelineHydrationGate.ts for the decision table.
     */
    const hydrationState = readHydrationState(hydrationMap, userId, projectId);
    const freshAtStart = projectsStore.get().find((candidate) => candidate.id === projectId) ?? project;
    const gate = resolvePipelineHydrationGate(hydrationState, getProjectArtifacts(freshAtStart).length);

    if (gate.action === 'trigger-hydration') {
      // Safety net — normally ProjectDashboard's own open effect already triggered this.
      hydrateProjectData(projectId);
      return;
    }

    if (gate.action === 'wait') {
      return;
    }

    if (gate.action === 'block') {
      if (isMountedRef.current) {
        setFailure({ kind: 'hydration', message: gate.message });
      }

      return;
    }

    // gate.action === 'proceed': hydration is 'ready', or 'failed' with local artifacts to fall back on.
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

    /*
     * Sprint 44 — `retryNonce` re-enters the effect after a manual "Retry" click even though
     * `project` itself hasn't changed; getNextAutoRole below re-derives the failed (still-
     * unapproved) role from the store, so a retry re-runs only that stage.
     * Sprint 46 — `hydrationMap`/`userId` re-enter the effect the moment hydration finishes
     * (loading -> ready/failed), which a 'failed' result alone wouldn't otherwise do (it never
     * touches `projectsStore`, only the hydration map).
     */
  }, [project, retryNonce, hydrationMap, userId]);

  return { isRunning, currentRoleId, failure, retry };
}
