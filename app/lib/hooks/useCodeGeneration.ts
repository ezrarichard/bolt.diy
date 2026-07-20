import { useCallback, useState } from 'react';
import {
  getProjectArtifacts,
  isProjectDashboardOpenStore,
  updateProjectWorkspaceState,
  type Project,
} from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import { buildProductSummaryMarkdown } from '~/lib/product-assembly/assemblyMarkdown';
import { ARTIFACT_TYPES, getApprovedArtifactContent } from '~/lib/projects/artifacts';
import type { ProductOwnerDraft } from '~/lib/projects/prompts/productOwner';
import { generateProject } from '~/lib/code-generation/projectGenerator';
import {
  installAndStartDevServer,
  readGeneratedFileFromWebContainer,
  writeGeneratedProjectToWebContainer,
} from '~/lib/code-generation/webcontainerWriter';
import type {
  GenerateFn,
  GenerationPlanScope,
  GenerationResult,
  GenerationStage,
} from '~/lib/code-generation/codeGenerationTypes';
import type { FileLifecycleHooks, ResumeHooks } from '~/lib/code-generation/generationPipeline';
import { prepareManifestForGeneration } from '~/lib/application-manifest/resumeOrchestrator';
import { mvpRepository } from '~/lib/mvp/mvpRepository';
import {
  getActiveApplicationManifest,
  listApplicationManifestFiles,
} from '~/lib/application-manifest/applicationManifestRepository';
import type { ApplicationManifestFile } from '~/lib/application-manifest/manifestTypes';
import {
  computeFileChecksum,
  getReusableFileContent,
  listGeneratedFiles,
  markFileFailed,
  markFileGenerating,
  persistGeneratedFile,
  reconcileUnplannedFile,
  reconstructFilesFromManifest,
  updateFileOwnership,
} from '~/lib/generated-files/generatedFilesRepository';
import {
  buildFileConflict,
  detectManualEdit,
  resolveOverwritePolicy,
  resolveOwnershipAfterEditCheck,
} from '~/lib/generated-files/fileOwnership';
import type { FileConflict } from '~/lib/generated-files/generatedFileTypes';
import { runBuildRepairLoop, runStaticReviewLoop } from '~/lib/code-review/repairEngine';
import type { OnRepairLoopEvent } from '~/lib/code-review/codeReviewTypes';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';
import { resetEngineeringTimeline, upsertEngineeringTimelineEvent } from '~/lib/stores/engineeringTimeline';
import { buildersDbRepository } from '~/lib/builders-db/repositories/buildersDbRepository';
import { getWorkspaceSnapshotProvider } from '~/lib/workspace-snapshot';
import { useAuth } from '~/lib/auth/AuthProvider';
import { useGenerateText } from './useGenerateText';

/**
 * Sprint 38 — orchestrates the whole "Generate Application" flow: runs the code
 * generation pipeline (app/lib/code-generation/projectGenerator.ts, in-memory only),
 * then — only once that succeeds — writes the result into the live WebContainer,
 * installs dependencies, starts the dev server, and switches the workbench to the
 * Preview tab. Mirrors every other AI-role hook's shape in this codebase
 * (useDraftPanel.ts, useAutoEngineeringPipeline.ts): a thin React wrapper around
 * pure/testable engine functions, with all the browser/store side effects (and now,
 * new this sprint, the WebContainer writes) living here rather than in the engine
 * layer.
 *
 * Sprint 38.1 (UI handoff fix) — `isProjectDashboardOpenStore.set(false)` is called
 * here, at the start of the `writing-files` stage, rather than reactively (e.g. a
 * `useEffect` in ProductPackagePanel.tsx watching for `stage === 'complete'`, the
 * previous approach). This closes the Dialog (see ProjectDashboard.tsx, which reads
 * this exact store) BEFORE `workbenchStore.showWorkbench`/`currentView` are ever
 * touched later at the `launching-preview` stage — eliminating the race that let the
 * still-open, only-70%-opaque-and-blurred Dialog overlay visually coexist with the
 * Workbench sliding in underneath it. Reused directly rather than plumbed through an
 * `onClose` prop: `isProjectDashboardOpenStore` (app/lib/stores/projects.ts) is the
 * same store Menu.client.tsx already uses to open/close this exact dialog, so this
 * hook closing it directly is not a new mechanism, just the existing one called from
 * one more place.
 */

/** Maps every fine-grained GenerationStage onto the 5 labels the sprint's UI spec calls for (Planning/Generating/Writing Files/Installing/Launching Preview) — the underlying GenerationResult still records which exact stage ran. */
const STAGE_GROUP_LABELS: Record<GenerationStage, string> = {
  planning: 'Planning',
  'generating-types': 'Generating',
  'generating-services': 'Generating',
  'generating-pages': 'Generating',
  'generating-components': 'Generating',
  validating: 'Generating',
  assembling: 'Generating',
  'writing-files': 'Writing Files',
  installing: 'Installing',
  'launching-preview': 'Launching Preview',
  complete: 'Complete',
};

/** Same grouping as STAGE_GROUP_LABELS, but as stable ids for the Engineering Timeline (app/lib/stores/engineeringTimeline.ts) — repeated fine-grained stages within one group update the same timeline entry instead of appending a new one. */
const STAGE_TIMELINE_ID: Record<GenerationStage, string> = {
  planning: 'planning',
  'generating-types': 'generating',
  'generating-services': 'generating',
  'generating-pages': 'generating',
  'generating-components': 'generating',
  validating: 'generating',
  assembling: 'generating',
  'writing-files': 'writing-files',
  installing: 'installing',
  'launching-preview': 'launching-preview',
  complete: 'launching-preview',
};

export interface CodeGenerationState {
  isRunning: boolean;
  stage: GenerationStage | 'idle' | 'failed';
  stageLabel: string;
  detail?: string;
  result?: GenerationResult;
  error?: string;

  /** Sprint 49, Part 8 — files this run could not overwrite automatically and why (see fileOwnership.ts). Minimum UI plumbing per this sprint's own "implement only the minimum UI necessary" instruction — a future review panel reads this rather than the engine inventing a second place to store it. Empty/undefined for a run that found nothing to preserve. */
  conflicts?: FileConflict[];
}

const IDLE_STATE: CodeGenerationState = { isRunning: false, stage: 'idle', stageLabel: 'Idle' };

function logActivity(projectId: string, activityType: string, description: string): void {
  buildersDbRepository
    .addProjectActivity({ projectId, activityType, description })
    .catch((error) => console.error(`[CodeGeneration] ${activityType} activity log failed:`, error));
}

/**
 * Sprint 44.2, Phase 2 — the manifest built/persisted by `createPlanReadyHandler` below,
 * shared (via a mutable ref, populated once planning finishes) with
 * `createFileLifecycleHooks` so it can resolve an AI-returned file's path back to a
 * `manifest_file_id` without either function needing to know about the other's
 * internals — same decoupling generationPipeline.ts's own `FileLifecycleHooks` type
 * comment describes.
 */
interface ManifestGenerationContext {
  manifestId?: string;
  files: ApplicationManifestFile[];
}

/**
 * Sprint 48 — resolves the active MVP (Sprint 47's Gate-A-aware
 * `mvpRepository.resolveActiveMvpId`) plus that MVP's Engineering Handoff scope boundary
 * from the project's own approved Product Owner artifact, in one place, BEFORE either the
 * plan is built (so the plan itself carries the scope — see `GenerationPlanScope`) or the
 * manifest is persisted (so Part 7's staleness guard in resumeOrchestrator.ts has
 * something to re-check against later). Resolves to an all-undefined/empty scope for a
 * legacy project or one with no approved Product Owner artifact yet — the same
 * backward-compatible degrade Sprint 47 already established for every engineering role.
 */
async function resolveMvpScope(project: Project): Promise<GenerationPlanScope> {
  const mvpId = await mvpRepository.resolveActiveMvpId(project.id);
  const productOwnerDraft = getApprovedArtifactContent<ProductOwnerDraft>(
    getProjectArtifacts(project),
    ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT,
  );
  const currentMvp = productOwnerDraft?.currentMvp;

  return {
    mvpId,
    mvpCode: currentMvp?.id,
    inScopeFeatureIds: currentMvp?.engineeringHandoff?.features.map((feature) => feature.id) ?? [],
    outOfScopeFeatureDescriptions: currentMvp?.engineeringHandoff?.outOfScopeFeatures ?? [],
  };
}

/**
 * Sprint 49, Parts 6/7/9 — reads whatever manifest is currently active for this project
 * (the one the LIVE, already-running WebContainer's files were last generated from — see
 * this module's other WebContainer touchpoints), compares each previously-generated
 * file's CURRENT live content against the checksum Builders last generated for it, and
 * reclassifies/persists ownership accordingly (see fileOwnership.ts's
 * `resolveOwnershipAfterEditCheck`). Returns the set of paths this run must NOT overwrite
 * plus the `FileConflict`s worth surfacing for review — both consumed by `runGeneration`
 * (filters the final write) and `createFileLifecycleHooks` (skips persisting content for
 * a protected path even though the AI still generated it — see Part 10's "one
 * conflicting file should not abort the rest").
 *
 * Returns empty results for a project's very FIRST-EVER generation run (no active
 * manifest yet — nothing to compare against) and is a pure no-op read/write pair for
 * BuildersDB-unavailable environments (every call inside degrades safely already).
 *
 * `preservedContent` carries each protected path's CURRENT live content, captured during
 * this same read (no second WebContainer read later) — see `runGeneration`'s own comment
 * on why a protected path must be REWRITTEN with its current content, not simply dropped
 * from the write list: `writeGeneratedProjectToWebContainer`'s stale-file cleanup deletes
 * any previously-written path that's absent from the current write, so silently omitting
 * a protected path would get it DELETED, which is the opposite of "preserve."
 */
async function detectFileOwnershipConflicts(
  project: Project,
  scope: GenerationPlanScope,
): Promise<{ protectedPaths: Set<string>; preservedContent: Map<string, string>; conflicts: FileConflict[] }> {
  const activeManifest = await getActiveApplicationManifest(project.id);

  if (!activeManifest) {
    return { protectedPaths: new Set(), preservedContent: new Map(), conflicts: [] };
  }

  const [manifestFiles, generatedFiles] = await Promise.all([
    listApplicationManifestFiles(activeManifest.id),
    listGeneratedFiles(activeManifest.id),
  ]);
  const manifestFileById = new Map(manifestFiles.map((file) => [file.id, file]));

  const protectedPaths = new Set<string>();
  const preservedContent = new Map<string, string>();
  const conflicts: FileConflict[] = [];

  for (const generatedFile of generatedFiles) {
    const manifestFile = manifestFileById.get(generatedFile.manifestFileId);
    const currentContent = await readGeneratedFileFromWebContainer(generatedFile.path);
    const hasBaseline = Boolean(generatedFile.latestChecksum);
    const edited = detectManualEdit(currentContent, generatedFile.latestChecksum);
    const nextOwnership = resolveOwnershipAfterEditCheck(generatedFile.ownership, edited, hasBaseline);

    if (nextOwnership !== generatedFile.ownership) {
      await updateFileOwnership({
        projectId: project.id,
        manifestId: activeManifest.id,
        manifestFileId: generatedFile.manifestFileId,
        path: generatedFile.path,
        ownership: nextOwnership,
        currentHash: currentContent !== null ? computeFileChecksum(currentContent) : undefined,
        userModifiedAt: nextOwnership === 'user_modified' ? new Date().toISOString() : undefined,
        conflictState: nextOwnership === 'user_modified' || nextOwnership === 'user_owned' ? 'pending_review' : 'none',
      });

      if (nextOwnership === 'user_modified') {
        logActivity(
          project.id,
          'file_marked_user_modified',
          `${generatedFile.path} was manually modified since Builders last generated it`,
        );
      }
    }

    const { allowAutoOverwrite, requiresConflict } = resolveOverwritePolicy(nextOwnership);

    if (!allowAutoOverwrite) {
      protectedPaths.add(generatedFile.path);

      if (currentContent !== null) {
        preservedContent.set(generatedFile.path, currentContent);
      }

      if (nextOwnership === 'protected' || nextOwnership === 'unknown_legacy') {
        logActivity(
          project.id,
          'protected_file_preserved',
          `${generatedFile.path} was preserved (ownership: ${nextOwnership}) — not overwritten by this generation run`,
        );
      }

      if (requiresConflict) {
        const conflict = buildFileConflict({
          path: generatedFile.path,
          mvpId: scope.mvpId,
          featureIds: manifestFile?.featureIds ?? [],
          ownership: nextOwnership,
          existingHash: currentContent !== null ? computeFileChecksum(currentContent) : undefined,
          lastGeneratedHash: generatedFile.latestChecksum,
          proposedOperation: 'modify',
        });
        conflicts.push(conflict);
        logActivity(
          project.id,
          'generation_conflict_detected',
          `Conflict: ${conflict.path} (${nextOwnership}) — ${conflict.reason}`,
        );
      }
    }
  }

  return { protectedPaths, preservedContent, conflicts };
}

/**
 * Sprint 44.2 — builds the Application Manifest from the pipeline's own deterministic
 * plan (see generationPipeline.ts's `OnPlanReady`) and persists it BEFORE any AI
 * file-generation call runs. Phase 1 is purely observational: a persistence failure is
 * recorded on workspace state (`manifestStatus`/`manifestPersistenceError`) and logged as
 * activity, but never blocks or fails the generation the user is watching — see
 * applicationManifestRepository.ts's own header comment on why Phase 3, not this one, is
 * where that becomes a hard precondition.
 */
function createPlanReadyHandler(
  project: Project,
  productPackage: ProductPackage,
  createdBy: string | null,
  context: ManifestGenerationContext,
  options: { forceRestart?: boolean } = {},
) {
  return async (plan: Parameters<typeof prepareManifestForGeneration>[0]['plan']) => {
    updateProjectWorkspaceState(project.id, { manifestStatus: 'creating' });

    /*
     * Sprint 48 — re-resolved here (rather than reusing `plan.scope` as-is) because this is
     * the actual persistence moment resumeOrchestrator.ts's Part 7 guard re-checks against —
     * see `resolveMvpScope`'s own comment on why planning and persistence can't share one
     * stale snapshot. `plan.scope.mvpId` (set when the plan was built, moments earlier) and
     * this resolution will normally agree; when they don't, resumeOrchestrator.ts's guard
     * (not this function) is what actually blocks the stale write.
     */
    const scope = await resolveMvpScope(project);

    const result = await prepareManifestForGeneration({
      projectId: project.id,
      plan,
      sourcePackageAssembledAt: productPackage.assembledAt,
      createdBy: createdBy ?? undefined,
      forceRestart: options.forceRestart,
      mvpId: scope.mvpId,
      mvpCode: scope.mvpCode,
      featureScope: {
        inScopeFeatureIds: scope.inScopeFeatureIds,
        outOfScopeFeatureDescriptions: scope.outOfScopeFeatureDescriptions,
      },
    });

    if (!result.ok || !result.manifest || !result.files) {
      updateProjectWorkspaceState(project.id, {
        manifestStatus: 'failed',
        manifestPersistenceError: result.error ?? 'Unknown persistence error',
      });
      logActivity(
        project.id,
        'manifest_persistence_failed',
        `Application Manifest could not be prepared: ${result.error}`,
      );

      return;
    }

    // Every file-lifecycle/resume hook below resolves a generated path against these entries.
    context.manifestId = result.manifest.id;
    context.files = result.files;

    updateProjectWorkspaceState(project.id, {
      manifestStatus: 'persisted',
      manifestVersion: result.manifest.version,
      manifestPersistenceError: undefined,
    });

    if (result.resumed) {
      logActivity(
        project.id,
        'manifest_resumed',
        `Resuming Application Manifest v${result.manifest.version} — reusing already-generated files by status`,
      );
    } else if (result.versionCreated) {
      /*
       * Sprint 44.2, Phase 3 — a new manifest version means the Product Package changed
       * (structurally, content-wise, or both) since the previous version — the previous
       * version was just flipped to 'superseded' by saveApplicationManifest(). Grouped
       * into ONE activity entry (not one per carried-forward file) per this phase's own
       * "avoid flooding timeline" instruction.
       */
      logActivity(
        project.id,
        'manifest_superseded',
        `Application Manifest v${result.manifest.version - 1} superseded by v${result.manifest.version}` +
          (result.crossMvpTransition ? ` (extending ${scope.mvpCode ?? 'a prior MVP'}'s manifest)` : '') +
          ` — ${result.carriedForwardCount} file(s) carried forward, ${result.manifest.totalFiles - result.carriedForwardCount} to (re)generate`,
      );
    } else {
      logActivity(
        project.id,
        'manifest_created',
        `Application Manifest v${result.manifest.version} persisted (${result.manifest.totalFiles} planned file(s))`,
      );
    }
  };
}

/**
 * Sprint 44.2, Phase 3 — implements generationPipeline.ts's `ResumeHooks`: for a planned
 * path already in `context.files`, returns its content ONLY when its current status is
 * one resume trusts (`isReusableGeneratedStatus` — 'generated'/'validated'/'complete'),
 * skipping the AI call entirely. Returns `undefined` for anything else (pending, failed,
 * interrupted mid-generation/repair, or no manifest at all), which the pipeline treats
 * as "generate it."
 */
function createResumeHooks(context: ManifestGenerationContext): ResumeHooks {
  return {
    async getReusableContent(path) {
      if (!context.manifestId) {
        return undefined;
      }

      const planned = context.files.find((file) => file.path === path);

      if (!planned) {
        return undefined;
      }

      return getReusableFileContent(planned.id);
    },
  };
}

/** role (e.g. "code-gen-page:HomePage", "code-gen-components", "scaffold") -> the manifest file category an UNPLANNED file returned under that role most likely belongs to — only used by the reconciliation path (requirement G), never for matching an already-planned file (that's a straight path lookup). */
function categoryForRole(role: string): string {
  if (role.startsWith('code-gen-page')) {
    return 'pages';
  }

  if (role === 'code-gen-components') {
    return 'components';
  }

  if (role === 'code-gen-types') {
    return 'types';
  }

  if (role === 'code-gen-services') {
    return 'services';
  }

  return 'other';
}

/**
 * Sprint 44.2, Phase 2 — implements generationPipeline.ts's `FileLifecycleHooks` against
 * the manifest `createPlanReadyHandler` just persisted: marks a file 'generating' right
 * before its AI call, persists its content (as a new version only if the checksum
 * changed) immediately after, and marks it 'failed' with its error otherwise — never
 * waiting for the whole run to finish (requirement D). A file the AI returned that isn't
 * in `context.files` is reconciled into the manifest rather than silently dropped
 * (requirement G). Every step here is best-effort/non-blocking, matching
 * generatedFilesRepository.ts's own non-blocking-in-Phase-2 contract — a persistence
 * failure is recorded (workspace state + activity) but never stops generation.
 */
function createFileLifecycleHooks(
  project: Project,
  createdBy: string | null,
  context: ManifestGenerationContext,

  /** Sprint 49 — paths `detectFileOwnershipConflicts` determined Builders may not overwrite this run (see fileOwnership.ts's `resolveOverwritePolicy`). `onFileReady` still lets the AI generate content for these (cheaper to keep the pipeline itself ownership-unaware, per this sprint's own "do not redesign the engineering pipeline" instruction — see docs/05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md) but discards it here instead of persisting/writing it. */
  protectedPaths: Set<string>,
): FileLifecycleHooks {
  function findPlannedFile(path: string): ApplicationManifestFile | undefined {
    return context.files.find((file) => file.path === path);
  }

  return {
    async onFilesStarting(role, path) {
      if (!context.manifestId) {
        return;
      }

      const targets = path
        ? [findPlannedFile(path)].filter((file): file is ApplicationManifestFile => Boolean(file))
        : context.files.filter((file) => file.category === categoryForRole(role) && file.status !== 'complete');

      for (const target of targets) {
        await markFileGenerating({
          projectId: project.id,
          manifestId: context.manifestId,
          manifestFileId: target.id,
          path: target.path,
          role,
        });
      }
    },

    async onFileReady(file, role) {
      if (!context.manifestId) {
        return;
      }

      /*
       * Sprint 49, Part 7/10 — this path was found to require a decision Builders can't
       * make automatically (see `detectFileOwnershipConflicts`). The AI already spent a
       * call generating `file.content` — discarding it here (rather than short-circuiting
       * earlier) keeps generationPipeline.ts itself completely unaware of ownership,
       * which is the deliberate boundary this sprint draws (see this function's own
       * header). The rest of this run's files are unaffected (Part 10).
       */
      if (protectedPaths.has(file.path)) {
        return;
      }

      let planned = findPlannedFile(file.path);

      if (!planned) {
        const reconciled = await reconcileUnplannedFile({
          projectId: project.id,
          manifestId: context.manifestId,
          path: file.path,
          sourceKind: role === 'scaffold' ? 'derived' : 'ai_generated',
          category: categoryForRole(role),
        });

        if (!reconciled.ok || !reconciled.manifestFileId) {
          logActivity(
            project.id,
            'unplanned_file_rejected',
            `Generated file at an unsafe/unplanned path was not persisted: ${file.path}`,
          );

          return;
        }

        planned = {
          id: reconciled.manifestFileId,
          manifestId: context.manifestId,
          projectId: project.id,
          path: file.path,
          fileType: file.path.split('.').pop() ?? 'unknown',
          category: categoryForRole(role) as ApplicationManifestFile['category'],
          generationOrder: context.files.length,
          dependencies: [],
          required: false,
          sourceKind: role === 'scaffold' ? 'derived' : 'ai_generated',
          status: 'pending',
          generationAttempts: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          featureIds: [],
        };
        context.files = [...context.files, planned];
      }

      /*
       * Sprint 44.2, Phase 3 — a "-reused" role means generationPipeline.ts's
       * `resumeHooks.getReusableContent` supplied this exact content instead of calling
       * the AI (see generationPipeline.ts's `getReusable` helper) — the file's row is
       * already correctly stated (that's precisely WHY it was reusable). Re-running
       * `persistGeneratedFile` here would be redundant at best and, at worst, would
       * overwrite a 'complete'/'validated' status back down to 'generated' (that
       * function always sets 'generated' on success) — regressing a file resume is
       * supposed to leave untouched. Only the identical-checksum branch of
       * `persistGeneratedFile` would apply here anyway, so skipping it changes no
       * content, just avoids that status regression.
       */
      if (role.endsWith('-reused')) {
        logActivity(project.id, 'generated_file_reused', `${file.path} reused from a previous generation (unchanged)`);
        return;
      }

      const result = await persistGeneratedFile({
        projectId: project.id,
        manifestId: context.manifestId,
        manifestFileId: planned.id,
        path: file.path,
        content: file.content,
        generationSource: role,
        changeReason: `Generated by ${role}`,
        createdBy: createdBy ?? undefined,
      });

      if (!result.ok) {
        updateProjectWorkspaceState(project.id, {
          manifestPersistenceError: `Failed to persist ${file.path}: ${result.error}`,
        });
      }
    },

    async onStageFailed(role, error, path) {
      if (!context.manifestId) {
        return;
      }

      const targets = path
        ? [findPlannedFile(path)].filter((file): file is ApplicationManifestFile => Boolean(file))
        : context.files.filter((file) => file.category === categoryForRole(role));

      for (const target of targets) {
        await markFileFailed({
          projectId: project.id,
          manifestId: context.manifestId,
          manifestFileId: target.id,
          path: target.path,
          error,
        });
      }
    },
  };
}

/**
 * Sprint 39 — translates the Code Reviewer/Repair Engineer/Build Validator loops'
 * `RepairLoopEvent`s into Engineering Timeline entries (labeled with the role name, so
 * repair activity reads as engineering-team work, not background plumbing) plus the same
 * activity-log/workspace-state side effects every other stage already gets. Mirrors exactly
 * how `runGenerationPipeline`'s `onProgress` is consumed above — the loop functions
 * themselves (repairEngine.ts) stay pure/testable, this hook owns every store write.
 */
function createRepairEventHandler(projectId: string, onAttempt: (attemptNumber: number) => void): OnRepairLoopEvent {
  return (event) => {
    switch (event.type) {
      case 'code-review-started':
        upsertEngineeringTimelineEvent('code-review', {
          label: 'Code Reviewer: reviewing generated code',
          status: 'active',
        });
        logActivity(projectId, 'code_review_started', 'Code Reviewer started reviewing generated code');
        break;
      case 'static-validation-passed':
        upsertEngineeringTimelineEvent('code-review', { label: 'Code Reviewer: validation passed', status: 'done' });
        break;
      case 'static-validation-failed':
        upsertEngineeringTimelineEvent('code-review', {
          label: 'Code Reviewer: issues found',
          status: 'failed',
          detail:
            event.issues.length > 0
              ? `${event.issues.length} issue(s) found — e.g. ${event.issues[0].message}`
              : `${event.issues.length} issue(s) found`,
        });
        break;
      case 'repair-attempt-started':
        onAttempt(event.attemptNumber);
        upsertEngineeringTimelineEvent('repair-attempt', {
          label: `Repair Engineer: attempting fix (${event.attemptNumber}/${event.maxAttempts})`,
          status: 'active',
          detail: event.stage === 'static' ? 'Fixing code review issues' : 'Fixing build/runtime error',
        });
        updateProjectWorkspaceState(projectId, { lastRepairStatus: 'repairing', repairAttempts: event.attemptNumber });
        logActivity(
          projectId,
          'repair_attempt_started',
          `Repair Engineer attempt ${event.attemptNumber}/${event.maxAttempts} (${event.stage})`,
        );
        break;
      case 'repair-patch-applied':
        upsertEngineeringTimelineEvent('repair-attempt', {
          label: 'Repair Engineer: patch applied',
          status: 'done',
          detail: event.summary,
        });
        logActivity(projectId, 'repair_patch_applied', `Repair Engineer applied a patch: ${event.summary}`);
        break;
      case 'repair-failed':
        upsertEngineeringTimelineEvent('repair-attempt', {
          label: 'Repair Engineer: repair failed',
          status: 'failed',
          detail: event.reason,
        });
        logActivity(
          projectId,
          'repair_failed',
          `Repair Engineer's attempt ${event.attemptNumber} failed: ${event.reason}`,
        );
        break;
      case 'build-validation-started':
        upsertEngineeringTimelineEvent('build-validation', {
          label: 'Build Validator: installing & starting dev server',
          status: 'active',
        });
        break;
      case 'preview-validation-passed':
        upsertEngineeringTimelineEvent('build-validation', {
          label: 'Build Validator: preview stable',
          status: 'done',
        });
        break;
      case 'preview-validation-failed':
        upsertEngineeringTimelineEvent('build-validation', {
          label: 'Build Validator: build/runtime error detected',
          status: 'failed',
          detail: event.error.message,
        });
        break;
      case 'manual-attention-required':
        upsertEngineeringTimelineEvent('manual-attention', {
          label: 'Manual attention required',
          status: 'failed',
          detail: event.detail,
        });
        logActivity(
          projectId,
          'manual_attention_required',
          `Manual attention required (${event.stage}): ${event.detail}`,
        );
        break;
    }
  };
}

export function useCodeGeneration() {
  const { generate } = useGenerateText();
  const { user } = useAuth();
  const [state, setState] = useState<CodeGenerationState>(IDLE_STATE);

  const runGeneration = useCallback(
    async (project: Project, productPackage: ProductPackage, options: { forceRestart?: boolean } = {}) => {
      setState({ isRunning: true, stage: 'planning', stageLabel: STAGE_GROUP_LABELS.planning });
      logActivity(project.id, 'generation_started', `Code generation started for "${project.name}"`);
      updateProjectWorkspaceState(project.id, {
        lastGenerationStatus: 'generating',
        currentStage: 'planning',
        lastActivity: `Generation started for "${project.name}"`,
        lastError: undefined,
      });

      // Reveal the Engineering Timeline / conversation area in place of the landing hero (see Chat.client.tsx's sync of this flag onto local `chatStarted` state).
      resetEngineeringTimeline();
      chatStore.setKey('started', true);
      upsertEngineeringTimelineEvent('generation-started', {
        label: 'Generation started',
        status: 'done',
        detail: `Generating "${project.name}"`,
      });
      upsertEngineeringTimelineEvent('planning', { label: 'Planning', status: 'active' });

      /*
       * Sprint 39.5 — the code-generation pipeline's types/services/pages/components
       * stages are treated as one unit driven by the Frontend Engineer's model this
       * sprint (not split per fine-grained stage — see the plan's Known Limitations).
       * Falls back to the user's own dropdown selection when the profile/role doesn't
       * resolve, exactly like every other Generation Profile-routed call site.
       */
      const codeGenGenerate: GenerateFn = (system, prompt, opts) =>
        generate(system, prompt, { ...opts, ...getRoleGenerateOptions(project, 'frontend-draft') });

      const manifestContext: ManifestGenerationContext = { files: [] };
      const currentUserId = user?.id ?? null;

      // Sprint 48 — resolved once here so the plan itself carries MVP scope (see GenerationPlanScope); createPlanReadyHandler re-resolves it independently at persistence time for Part 7's staleness guard.
      const mvpScope = await resolveMvpScope(project);

      /*
       * Sprint 49, Parts 6/7/9 — resolved BEFORE generation starts (not after) so
       * `createFileLifecycleHooks` already knows which paths to preserve the moment the
       * AI returns content for them, and so the final WebContainer write (below) can be
       * filtered without a second pass over the whole project. Empty for a project's
       * first-ever generation run — nothing to compare against yet.
       */
      const { protectedPaths, preservedContent, conflicts } = await detectFileOwnershipConflicts(project, mvpScope);

      if (conflicts.length > 0) {
        setState((prev) => ({ ...prev, conflicts }));
      }

      const result = await generateProject(
        project,
        productPackage,
        codeGenGenerate,
        (progress) => {
          setState((prev) => ({
            ...prev,
            stage: progress.stage,
            stageLabel: STAGE_GROUP_LABELS[progress.stage],
            detail: progress.detail,
          }));
          logActivity(
            project.id,
            'generation_stage_completed',
            `${STAGE_GROUP_LABELS[progress.stage]}${progress.detail ? ` — ${progress.detail}` : ''}`,
          );
          upsertEngineeringTimelineEvent(STAGE_TIMELINE_ID[progress.stage], {
            label: STAGE_GROUP_LABELS[progress.stage],
            status: 'active',
            detail: progress.detail,
          });
        },
        createPlanReadyHandler(project, productPackage, currentUserId, manifestContext, {
          forceRestart: options.forceRestart,
        }),
        createFileLifecycleHooks(project, currentUserId, manifestContext, protectedPaths),
        createResumeHooks(manifestContext),
        mvpScope,
      );

      if (!result.ok || !result.project) {
        const message = result.issues.find((issue) => issue.severity === 'error')?.message ?? 'Generation failed.';
        setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', result, error: message });
        logActivity(
          project.id,
          'generation_failed',
          `Generation failed at ${result.failedStage ?? 'unknown stage'}: ${message}`,
        );
        upsertEngineeringTimelineEvent(STAGE_TIMELINE_ID[result.failedStage ?? 'planning'], {
          label: `${STAGE_GROUP_LABELS[result.failedStage ?? 'planning']} failed`,
          status: 'failed',
          detail: message,
        });
        updateProjectWorkspaceState(project.id, {
          lastGenerationStatus: 'failed',
          currentStage: result.failedStage ?? 'planning',
          lastError: message,
        });

        return;
      }

      let generatedProject = result.project;
      let totalRepairAttempts = 0;
      const handleRepairEvent = createRepairEventHandler(project.id, (attemptNumber) => {
        totalRepairAttempts = Math.max(totalRepairAttempts, attemptNumber);
      });
      const productPackageSummary = buildProductSummaryMarkdown(
        project,
        productPackage.sections,
        productPackage.missingSections,
        productPackage.assembledAt,
      );

      /*
       * Sprint 39.5 — the Repair Engineer's own AI call (repairEngine.ts's requestRepair)
       * is routed through the project's selected Generation Profile the same way every
       * other role is — falls back to the user's own dropdown selection when unresolved.
       */
      const repairGenerate: GenerateFn = (system, prompt, opts) =>
        generate(system, prompt, { ...opts, ...getRoleGenerateOptions(project, 'repair-engineer') });

      try {
        /*
         * Sprint 39 — the Code Reviewer runs (and, if needed, the Repair Engineer patches)
         * entirely in memory BEFORE anything is written to the WebContainer — a failure
         * here never touches whatever project was already running, same guarantee
         * generationPipeline.ts's own validation stage already gives (see
         * runStaticReviewLoop's header comment in repairEngine.ts).
         */
        const reviewResult = await runStaticReviewLoop({
          project: generatedProject,
          projectId: project.id,
          projectName: project.name,
          productPackageSummary,
          generate: repairGenerate,
          onEvent: handleRepairEvent,
        });

        if (!reviewResult.ok) {
          /*
           * Assembly Auto-Repair — ERROR REPORTING spec: the customer-facing message on final
           * failure names the remaining issue(s), which files they're in, and how many repair
           * attempts were made — never a raw stack trace. The "previous application ... left
           * untouched" confirmation is appended separately by ProductPackagePanel.tsx's own
           * fixed footer (so it isn't duplicated here) — true unconditionally on this path,
           * since nothing is written to the WebContainer until AFTER this loop returns ok.
           */
          const blockingIssues = reviewResult.issues.filter((issue) => issue.severity === 'error');
          const affectedFiles = Array.from(
            new Set(blockingIssues.map((issue) => issue.filePath).filter((path): path is string => Boolean(path))),
          );
          const message =
            blockingIssues.length > 0
              ? [
                  `${blockingIssues.length} issue(s) remained after ${totalRepairAttempts} repair attempt(s):`,
                  ...blockingIssues.slice(0, 5).map((issue) => `- ${issue.message}`),
                  ...(blockingIssues.length > 5 ? [`- (${blockingIssues.length - 5} more not shown)`] : []),
                  '',
                  `Affected file(s): ${affectedFiles.join(', ') || 'none identified'}`,
                ].join('\n')
              : 'Code review found issues that could not be automatically repaired.';
          setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', result, error: message });
          logActivity(project.id, 'generation_failed', `Code review failed after repair attempts: ${message}`);
          updateProjectWorkspaceState(project.id, {
            lastGenerationStatus: 'failed',
            lastError: message,
            lastRepairStatus: 'failed',
            repairAttempts: totalRepairAttempts,
          });

          return;
        }

        generatedProject = reviewResult.project;

        /*
         * Sprint 49, Part 7/9 — the actual enforcement point: `protectedPaths` (resolved
         * before generation even started) is applied to the WHOLE remaining pipeline from
         * here on — this same filtered `generatedProject` is what gets written below, what
         * the repair loop re-writes on retry, and what the workspace snapshot persists —
         * so a protected/user-modified file can never be reintroduced later in this run
         * either. Each protected path is REWRITTEN with its own current content (captured
         * moments earlier by `detectFileOwnershipConflicts`), not simply omitted — omitting
         * it would make `writeGeneratedProjectToWebContainer`'s stale-file cleanup delete
         * it (a path absent from the current write, present in the previous one, reads as
         * "no longer needed" — see that function's own header comment), which is the exact
         * opposite of "preserve." A path with no live content to preserve (deleted from the
         * workspace since it was last generated) has no entry in `preservedContent` and is
         * genuinely dropped — there is nothing to protect.
         */
        if (protectedPaths.size > 0) {
          generatedProject = {
            ...generatedProject,
            files: generatedProject.files
              .filter((file) => !protectedPaths.has(file.path) || preservedContent.has(file.path))
              .map((file) =>
                protectedPaths.has(file.path) ? { ...file, content: preservedContent.get(file.path)! } : file,
              ),
          };
        }

        setState((prev) => ({ ...prev, stage: 'writing-files', stageLabel: STAGE_GROUP_LABELS['writing-files'] }));

        /*
         * Close the Project Dashboard now — before the workspace is touched and well
         * before `showWorkbench`/`currentView` reveal the Workbench below — so there is
         * no window where both are visible at once (see this file's header comment).
         */
        isProjectDashboardOpenStore.set(false);
        upsertEngineeringTimelineEvent('writing-files', { label: 'Writing files', status: 'active' });

        await writeGeneratedProjectToWebContainer(generatedProject);
        logActivity(
          project.id,
          'filesystem_written',
          `${generatedProject.files.length} file(s) written to the workspace`,
        );

        /*
         * Sprint 38.5 — durably persist the generated app's file CONTENT (not just paths,
         * which webcontainerWriter.ts already caches locally for stale-file cleanup) as a
         * single workspace snapshot (see app/lib/workspace-snapshot/) so a later "Continue
         * Development" can re-materialize it into a freshly-booted WebContainer without
         * calling the LLM again. Fire-and-forget, like every other BuildersDB mirror in
         * this codebase — a failure here never fails the generation the user is actively
         * watching. Goes through the pluggable provider selector, not a BuildersDB
         * repository directly, so a future GitHub-backed snapshot provider is a
         * zero-call-site-change swap.
         */
        const saveSnapshot = (files: typeof generatedProject.files) => {
          getWorkspaceSnapshotProvider()
            .saveSnapshot(project.id, files)
            .catch((error) => console.error('[CodeGeneration] Failed to persist generated files for resume:', error));
        };

        saveSnapshot(generatedProject.files);
        updateProjectWorkspaceState(project.id, { workbenchFilesCreated: true, currentStage: 'writing-files' });

        setState((prev) => ({ ...prev, stage: 'installing', stageLabel: STAGE_GROUP_LABELS.installing }));
        upsertEngineeringTimelineEvent('installing', { label: 'Installing dependencies', status: 'active' });

        /*
         * Sprint 39 — the Build Validator installs dependencies, starts the dev server, and
         * watches a short bounded window for a Vite/runtime failure (see errorCollector.ts).
         * On failure the Repair Engineer patches the ALREADY-WRITTEN files, re-writes them,
         * and retries — up to a fixed attempt limit — before this is reported as failed.
         */
        const buildResult = await runBuildRepairLoop({
          project: generatedProject,
          projectId: project.id,
          projectName: project.name,
          productPackageSummary,
          generate: repairGenerate,
          onEvent: handleRepairEvent,
          installAndStartDevServer,
          writeProjectToWebContainer: writeGeneratedProjectToWebContainer,
          saveSnapshot,
        });

        generatedProject = buildResult.project;

        if (!buildResult.ok) {
          setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', result, error: buildResult.error });
          logActivity(project.id, 'generation_failed', `Generation failed while installing: ${buildResult.error}`);
          updateProjectWorkspaceState(project.id, {
            lastGenerationStatus: 'failed',
            currentStage: 'installing',
            lastError: buildResult.error,
            lastRepairStatus: 'failed',
            repairAttempts: totalRepairAttempts,
          });

          return;
        }

        setState((prev) => ({
          ...prev,
          stage: 'launching-preview',
          stageLabel: STAGE_GROUP_LABELS['launching-preview'],
        }));
        upsertEngineeringTimelineEvent('launching-preview', { label: 'Launching preview', status: 'active' });
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('preview');
        logActivity(project.id, 'preview_started', 'Preview launched for the generated application');
        upsertEngineeringTimelineEvent('preview-ready', { label: 'Preview ready', status: 'done' });

        setState({ isRunning: false, stage: 'complete', stageLabel: STAGE_GROUP_LABELS.complete, result });
        updateProjectWorkspaceState(project.id, {
          lastGenerationStatus: 'generated',
          generatedApplicationExists: true,
          previewAvailable: true,
          lastPreviewStatus: 'available',
          workbenchFilesCreated: true,
          currentStage: 'complete',
          lastGenerationTime: new Date().toISOString(),
          lastActivity: 'Application generated and preview launched',
          lastError: undefined,
          repairAttempts: totalRepairAttempts,
          lastRepairStatus: totalRepairAttempts > 0 ? 'succeeded' : 'not-attempted',
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error while writing files or launching the preview.';
        setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', result, error: message });
        logActivity(
          project.id,
          'generation_failed',
          `Generation failed while writing files/launching preview: ${message}`,
        );
        upsertEngineeringTimelineEvent('launching-preview', {
          label: 'Generation failed',
          status: 'failed',
          detail: message,
        });
        updateProjectWorkspaceState(project.id, {
          lastGenerationStatus: 'failed',
          lastError: message,
        });
      }
    },
    [generate],
  );

  /**
   * Sprint 38.5 — "Continue Development": re-materializes a PREVIOUSLY generated
   * application into a freshly-booted WebContainer, without calling the LLM again. This
   * is what "resume, don't regenerate" concretely means — a page reload always boots an
   * empty WebContainer (see webcontainerWriter.ts's header comment), so there is no
   * "resume a suspended container" operation to perform; the fastest equivalent is
   * re-writing the exact same files the last successful generation produced, which are
   * durably stored in `builders_generated_files` (see generatedFilesRepository.ts) for
   * exactly this purpose. Reuses the same `state`/stage machinery as `runGeneration` so
   * the Engineering Timeline shows consistent progress feedback, just skipping straight
   * to `writing-files` — no `planning`/`generating-*` stages, since nothing is being
   * generated.
   */
  const resumeApplication = useCallback(async (project: Project) => {
    setState({ isRunning: true, stage: 'writing-files', stageLabel: STAGE_GROUP_LABELS['writing-files'] });
    logActivity(project.id, 'generation_started', `Resuming development on "${project.name}"`);

    resetEngineeringTimeline();
    chatStore.setKey('started', true);
    upsertEngineeringTimelineEvent('generation-started', {
      label: 'Resuming development',
      status: 'done',
      detail: `Restoring "${project.name}" from the last build`,
    });
    updateProjectWorkspaceState(project.id, { currentStage: 'writing-files', lastError: undefined });

    try {
      /*
       * Sprint 44.2, Phase 3 — "WebContainer Restart"/"Workspace Restore" requirement:
       * reconstruct from the Application Manifest's own per-file COMPLETE/validated/
       * generated versions when one exists — more granular and source-of-truth-accurate
       * than the Phase 38.5 whole-project snapshot below, which stays the fallback for
       * projects that predate the manifest (backward compatibility: "old projects with
       * no manifest behave exactly as today").
       */
      const activeManifest = await getActiveApplicationManifest(project.id);
      const reconstructed = activeManifest ? await reconstructFilesFromManifest(activeManifest.id) : [];

      /*
       * Sprint 49, Part 9 — "resume must not bypass ownership checks": a fresh
       * WebContainer boot has no live content to compare against (see
       * fileOwnership.ts's own header on why edit-DETECTION only applies within a live
       * session), but ownership already ON RECORD from before the reboot still applies.
       * `user_owned`/`protected` files are never Builders' to (re)materialize
       * automatically, on resume or otherwise — omitted here entirely, same "never
       * overwrite automatically" rule `resolveOverwritePolicy` already enforces for a
       * live "Generate MVP N" run. `user_modified`/`unknown_legacy` files ARE still
       * written — there is no better content to reconstruct a working app from after a
       * full reboot, since a browser-only edit that was never persisted to BuildersDB is
       * genuinely unrecoverable (a known, separate WebContainer-lifecycle limitation, not
       * something this sprint's ownership model can solve — see this sprint's own
       * documentation) — but this is disclosed via activity log, not silently presented
       * as "your edit was preserved."
       */
      const generatedFiles = activeManifest ? await listGeneratedFiles(activeManifest.id) : [];
      const ownershipByPath = new Map(generatedFiles.map((file) => [file.path, file.ownership]));
      const neverAutoMaterialize = new Set(['user_owned', 'protected']);
      const manifestFiles = reconstructed.filter(
        (file) => !neverAutoMaterialize.has(ownershipByPath.get(file.path) ?? ''),
      );

      if (manifestFiles.length < reconstructed.length) {
        logActivity(
          project.id,
          'protected_file_preserved',
          `${reconstructed.length - manifestFiles.length} customer-owned/protected file(s) were not reconstructed on resume`,
        );
      }

      const usingManifest = manifestFiles.length > 0;
      const files = usingManifest ? manifestFiles : await getWorkspaceSnapshotProvider().getSnapshot(project.id);

      if (files.length === 0) {
        const message = 'No previously generated files were found for this project.';
        setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', error: message });
        upsertEngineeringTimelineEvent('writing-files', { label: 'Resume failed', status: 'failed', detail: message });
        updateProjectWorkspaceState(project.id, { lastGenerationStatus: 'failed', lastError: message });

        return;
      }

      if (usingManifest) {
        // Sprint 48, Part 6 — "resume within the current MVP, not the whole product": the manifest reconstructed from here is always the project's own `active` one, which is always the most recently generated MVP's — resuming therefore already resumes within whatever MVP that was, never restarting an earlier one. Named here for traceability only (Part 8), not as a behavior change.
        const mvpLabel = activeManifest?.mvpCode ? ` (${activeManifest.mvpCode})` : '';
        logActivity(
          project.id,
          'workspace_reconstructed',
          `Workspace reconstructed from Application Manifest v${activeManifest?.version}${mvpLabel} (${files.length} file(s), no AI call)`,
        );
      }

      isProjectDashboardOpenStore.set(false);
      upsertEngineeringTimelineEvent('writing-files', { label: 'Restoring files', status: 'active' });

      await writeGeneratedProjectToWebContainer({
        projectId: project.id,
        templateId: 'resumed',
        files,
        folders: [],
        generatedAt: new Date().toISOString(),
      });

      setState((prev) => ({ ...prev, stage: 'installing', stageLabel: STAGE_GROUP_LABELS.installing }));
      upsertEngineeringTimelineEvent('installing', { label: 'Installing dependencies', status: 'active' });

      const installResult = await installAndStartDevServer();

      if (!installResult.ok) {
        setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', error: installResult.error });
        upsertEngineeringTimelineEvent('installing', {
          label: 'Installing dependencies failed',
          status: 'failed',
          detail: installResult.error,
        });
        updateProjectWorkspaceState(project.id, { lastGenerationStatus: 'failed', lastError: installResult.error });

        return;
      }

      setState((prev) => ({
        ...prev,
        stage: 'launching-preview',
        stageLabel: STAGE_GROUP_LABELS['launching-preview'],
      }));
      upsertEngineeringTimelineEvent('launching-preview', { label: 'Launching preview', status: 'active' });
      workbenchStore.showWorkbench.set(true);
      workbenchStore.currentView.set('preview');
      logActivity(project.id, 'preview_started', 'Preview relaunched while resuming development');
      upsertEngineeringTimelineEvent('preview-ready', { label: 'Preview ready', status: 'done' });

      setState({ isRunning: false, stage: 'complete', stageLabel: STAGE_GROUP_LABELS.complete });
      updateProjectWorkspaceState(project.id, {
        previewAvailable: true,
        lastPreviewStatus: 'available',
        currentStage: 'complete',
        lastActivity: 'Resumed development',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error while resuming development.';
      setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', error: message });
      upsertEngineeringTimelineEvent('launching-preview', {
        label: 'Resume failed',
        status: 'failed',
        detail: message,
      });
      updateProjectWorkspaceState(project.id, { lastGenerationStatus: 'failed', lastError: message });
    }
  }, []);

  const reset = useCallback(() => setState(IDLE_STATE), []);

  return { ...state, runGeneration, resumeApplication, reset };
}
