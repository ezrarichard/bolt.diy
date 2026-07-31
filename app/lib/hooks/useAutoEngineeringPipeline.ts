import { useCallback, useEffect, useRef, useState } from 'react';
import { beginAiOperationScope, endAiOperationScope } from '~/lib/observability/aiOperationScope';
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
  autonomousPairedArtifactFactoryFor,
  describePipelineBlock,
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

/** Sprint 98A, BUG-007 — see the retry block in the loop below for why these are small. */
const MAX_GATE_RETRIES = 3;
const GATE_RETRY_DELAY_MS = 400;

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

    /*
     * Observability — one pipeline run is one application generation. Opening the scope here,
     * beside the existing run marker, means every role below reports the same `operation_id`
     * and Generation Analytics can group them exactly instead of inferring the boundary.
     * Purely additive: the id is only ever attached to a usage row.
     */
    const operationId = beginAiOperationScope(projectId);

    if (isMountedRef.current) {
      setIsRunning(true);
      setFailure(undefined);
    }

    (async () => {
      /*
       * Sprint 98A, BUG-007 — bounded retries for a gate that is satisfied in the store but not yet
       * visible to this iteration. Deliberately small: this covers a write-ordering race of
       * milliseconds, not a genuinely unsatisfied dependency, which must surface as a failure
       * rather than be retried into a hang.
       */
      let gateRetries = 0;

      try {
        for (;;) {
          const current = projectsStore.get().find((candidate) => candidate.id === projectId);

          if (!current) {
            break;
          }

          const role = getNextAutoRole(current);

          if (!role) {
            /*
             * Sprint 98A, BUG-007 — this `break` used to be silent and ambiguous. It fires both
             * when every role is approved (success) and when the next role's gate is momentarily
             * unsatisfied (blocked). Acceptance Test Round 1 hit the second case: the pipeline
             * stopped after Frontend with QA and DevOps stuck on "Waiting…" and no error anywhere.
             *
             * The two are now told apart. A transient gate miss — the "one store write behind" race
             * this file's own comments predicted — is retried a bounded number of times; a
             * persistent one stops the run with the exact reason, so the UI can never sit in
             * "Waiting…" indefinitely with nothing to explain it.
             */
            const block = describePipelineBlock(current);

            if (!block) {
              logger.debug(`pipeline project=${projectId} complete — every role approved`);
              break;
            }

            if (gateRetries < MAX_GATE_RETRIES) {
              gateRetries += 1;
              logger.debug(
                `pipeline project=${projectId} gate not satisfied (attempt ${gateRetries}/${MAX_GATE_RETRIES}): ${block.reason}`,
              );

              // Yield so pending store writes land before re-reading, then re-enter the loop.
              await new Promise((resolve) => setTimeout(resolve, GATE_RETRY_DELAY_MS));

              continue;
            }

            logger.error(`pipeline project=${projectId} stalled: ${block.reason}`);

            if (isMountedRef.current) {
              setFailure({ roleId: block.role.id, kind: 'error', message: block.reason });
            }

            toast.error(block.reason);
            break;
          }

          /* A role was found — the gate cleared, so the transient-retry budget resets. */
          gateRetries = 0;

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
                operationId,
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

            /*
             * Sprint 100C — the role's lockstep-paired artifact, if it declares one in
             * AUTO_ENGINEERING_ROLES. Closes Sprint 100B's L1: this path produced only the
             * primary artifact, so an autonomously-generated project had an Architecture Draft
             * and no Technical Architecture Specification, while the manual path produced both.
             *
             * Deliberately mirrors useDraftPanel.ts's semantics exactly — same `nextVersion` as
             * the primary (computed above from the PRIMARY artifact type, so the pair can never
             * drift), written immediately after it, and approved in the same action below. This
             * is a no-op for every role that declares no pair.
             *
             * The paired artifact is created BEFORE the Product Owner early-break below so that
             * ordering holds for any future gated role that has a pair: both rows land as
             * 'draft' together and are approved together, never one without the other.
             */
            const createPaired = autonomousPairedArtifactFactoryFor(role);
            const pairedArtifact = createPaired ? createPaired(outcome.draft, nextVersion) : undefined;

            if (pairedArtifact) {
              addProjectArtifact(projectId, { ...pairedArtifact, version: nextVersion }, 'automatic');
            }

            /*
             * Sprint 46B — Gate A (Roadmap/Scope Approval). Unlike every other role, the
             * Product Owner's draft must never auto-approve: it's a business decision (what
             * ships first, what the customer waits for), not a technical execution of
             * already-approved intent. Persist the draft and stop the loop here — Solution
             * Architect's own gate (canGenerateArchitecture) already requires this artifact to
             * be approved, so the loop naturally has nothing else it could do until a human
             * approves it via ProductOwnerDraftPanel. See docs/03-Development/
             * 01-human-approval-philosophy.md and docs/05-AI-Product-Owner/
             * 05-customer-review-workflow.md.
             */
            if (role.id === 'productowner') {
              toast.success(`${role.label} draft ready for your review`);
              break;
            }

            updateProjectArtifact(projectId, artifact.id, { status: 'approved' }, 'automatic');

            /* Sprint 100C — the pair is approved in the SAME action as the primary, never independently. */
            if (pairedArtifact) {
              updateProjectArtifact(projectId, pairedArtifact.id, { status: 'approved' }, 'automatic');
            }

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
        endAiOperationScope(projectId);

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
