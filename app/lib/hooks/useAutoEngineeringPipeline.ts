import { useEffect, useRef, useState } from 'react';
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
import { buildRoleContextBlock } from '~/lib/ai/context/buildersDbContextProvider';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import { useGenerateText } from './useGenerateText';

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

export interface AutoEngineeringPipelineState {
  isRunning: boolean;
  currentRoleId: AutoEngineeringRoleId | undefined;
  failure: { roleId: AutoEngineeringRoleId; message: string } | undefined;
}

export function useAutoEngineeringPipeline(project: Project): AutoEngineeringPipelineState {
  const [isRunning, setIsRunning] = useState(false);
  const [currentRoleId, setCurrentRoleId] = useState<AutoEngineeringRoleId | undefined>(undefined);
  const [failure, setFailure] = useState<{ roleId: AutoEngineeringRoleId; message: string } | undefined>(undefined);

  const { generate } = useGenerateText();
  const generateRef = useRef(generate);
  generateRef.current = generate;

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

          let result: Awaited<ReturnType<typeof generateRef.current>>;

          try {
            const context = role.buildContext(current);
            const { system, prompt } = role.buildPrompt(context);

            // Sprint 35 — same additive BuildersDB context section as useDraftPanel.ts's manual generation path; see that file's comment.
            const buildersDbContext = await buildRoleContextBlock(
              projectId,
              role.artifactType,
              current.description ?? current.name,
            );
            const fullPrompt = buildersDbContext ? `${prompt}\n\n${buildersDbContext}` : prompt;

            // Sprint 39.5 — routes this call through the project's selected Generation Profile, falling back to the user's own model selection if unresolved.
            result = await generateRef.current(system, fullPrompt, {
              maxTokens: role.maxOutputTokens,
              ...getRoleGenerateOptions(current, role.artifactType),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : `${role.label} failed unexpectedly.`;

            if (isMountedRef.current) {
              setFailure({ roleId: role.id, message });
            }

            toast.error(`${role.label} failed to generate: ${message}`);
            break;
          }

          if (!result.ok) {
            if (isMountedRef.current) {
              setFailure({ roleId: role.id, message: result.error });
            }

            toast.error(`${role.label} failed to generate: ${result.error}`);
            break;
          }

          if (!result.text || result.text.trim().length === 0) {
            const message = 'The AI returned an empty response.';

            if (isMountedRef.current) {
              setFailure({ roleId: role.id, message });
            }

            toast.error(`${role.label} failed to generate: ${message}`);
            break;
          }

          const parsed = role.parseDraft(result.text);

          if (!parsed.ok) {
            if (isMountedRef.current) {
              setFailure({ roleId: role.id, message: parsed.error });
            }

            toast.error(`${role.label} failed to generate: ${parsed.error}`);
            break;
          }

          const artifacts = getProjectArtifacts(current);
          const latest = getLatestArtifact(artifacts, role.artifactType);
          const nextVersion = (latest?.version ?? 0) + 1;
          const artifact = role.createDraftArtifact(parsed.draft, nextVersion);

          // Sprint 36 — 'automatic' output metadata, so version history can tell this run apart from a human clicking Generate/Regenerate.
          addProjectArtifact(projectId, artifact, 'automatic');
          updateProjectArtifact(projectId, artifact.id, { status: 'approved' }, 'automatic');
          toast.success(`${role.label} completed`);
        }
      } finally {
        runningProjectIds.delete(projectId);

        if (isMountedRef.current) {
          setIsRunning(false);
          setCurrentRoleId(undefined);
        }
      }
    })();
  }, [project]);

  return { isRunning, currentRoleId, failure };
}
