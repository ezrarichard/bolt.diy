/**
 * Project Workspace State — Sprint 38.5.
 *
 * The persisted answer to "what state was this project last in" — mirrors
 * builders_project_workspace_state (supabase/migrations/20260709030000_project_workspace_state.sql)
 * field-for-field. Read/written only through
 * app/lib/builders-db/repositories/workspaceStateRepository.ts; embedded onto `Project` as
 * `project.workspaceState` (app/lib/stores/projects.ts) the same way `projectKnowledge`/
 * `taskStatus` already are, so projectManagerEngine.ts can stay a synchronous function of
 * `Project` alone rather than needing its own async BuildersDB calls.
 */

export type GenerationStatus = 'not-generated' | 'generating' | 'generated' | 'failed';
export type PreviewStatus = 'not-available' | 'available' | 'stopped' | 'failed';

export interface ProjectWorkspaceState {
  /** Which dashboard tab/section the user last had open (see ProjectDashboard.tsx's tab ids) — resumes them there instead of always Overview. */
  lastOpenedSection?: string;
  lastGenerationStatus: GenerationStatus;
  lastGenerationTime?: string;
  lastPreviewStatus: PreviewStatus;

  /** True once a "Generate Application" run has ever completed successfully — the single flag that decides whether the dashboard shows "Generate Application" or "Continue Development" as the primary action. */
  generatedApplicationExists: boolean;

  /** True once a Product Package has been assembled at least once (see saveProductPackage in assemblyRepository.ts) — lets projectManagerEngine's next-action calculator distinguish "package missing" from "package assembled, app not generated yet" without needing its own async BuildersDB read. */
  productPackageAssembled?: boolean;
  previewAvailable: boolean;
  workbenchFilesCreated: boolean;

  /** Which AI role most recently produced output (e.g. "Frontend Engineer") — for the Overview "Last Activity" line. */
  lastActiveEngineer?: string;
  lastActivity?: string;
  lastSelectedTab?: string;

  /** Free-text label of the furthest lifecycle stage reached (e.g. "launching-preview", "complete") — same vocabulary as GenerationStage/STAGE_GROUP_LABELS in useCodeGeneration.ts. */
  currentStage?: string;
  lastError?: string;

  /** Sprint 39 — how many AI repair attempts the self-healing loop made during the most recent generation (0 if none were needed). */
  repairAttempts?: number;

  /** Sprint 39 — outcome of the self-healing loop's most recent run, for the Workspace tab's repair status line. */
  lastRepairStatus?: 'not-attempted' | 'repairing' | 'succeeded' | 'failed';

  /** Sprint 39.5 — which Generation Profile (app/lib/generation-profiles/) this project uses for every AI Engineering Team role. Undefined means "not chosen yet" — every reader falls back to DEFAULT_GENERATION_PROFILE_ID ('balanced'). */
  selectedGenerationProfileId?: string;

  /** Sprint 44.2 — outcome of the most recent Application Manifest persistence attempt (app/lib/application-manifest/), mirroring lastRepairStatus's shape. 'not-attempted' before the first "Generate Application" run; a failure here is non-blocking in Phase 1 (see manifestPersistenceError) — Phase 3 may make it a hard precondition. */
  manifestStatus?: 'not-attempted' | 'creating' | 'persisted' | 'failed';

  /** The persisted manifest's version number, once persistence has ever succeeded. */
  manifestVersion?: number;

  /** Set only when manifestStatus is 'failed' — the repository error, for the Workspace tab. */
  manifestPersistenceError?: string;
}

export const DEFAULT_WORKSPACE_STATE: ProjectWorkspaceState = {
  lastGenerationStatus: 'not-generated',
  lastPreviewStatus: 'not-available',
  generatedApplicationExists: false,
  previewAvailable: false,
  workbenchFilesCreated: false,
};
