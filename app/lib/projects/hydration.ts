import { atom } from 'nanostores';

/**
 * Project Hydration State — Sprint 46 ("BuildersDB Hydration and Reliable Resume").
 *
 * Answers "has this project's BuildersDB data (role outputs, tasks, reviews, knowledge,
 * workspace state) actually been restored into `projectsStore` yet" — see
 * `hydrateProjectData` in app/lib/stores/projects.ts, the only writer of this store.
 *
 * Keyed by `${userId}:${projectId}`, NOT projectId alone: hydration is a property of "this
 * user's view of this project" (RLS-scoped reads), so signing out, switching accounts, or a
 * shared project being opened by a different collaborator must never read a stale/foreign
 * result for the same project id (see invalidateAllProjectHydration, called from
 * AuthProvider on sign-out/user-change).
 */
export type ProjectHydrationStatus = 'not_started' | 'loading' | 'ready' | 'failed';

export interface ProjectHydrationState {
  status: ProjectHydrationStatus;
  userId: string | null;
  hydratedAt: string | null;
  error: string | null;

  /**
   * True once hydration completed 'ready' but BuildersDB legitimately returned zero role
   * outputs while local artifacts already existed, so the local artifacts were kept rather
   * than erased (see hydrateProjectData's merge rules). A reconciliation signal, not a
   * failure — `status` is still 'ready' in this case.
   */
  usedLocalFallback: boolean;
}

const NOT_STARTED_STATE: ProjectHydrationState = {
  status: 'not_started',
  userId: null,
  hydratedAt: null,
  error: null,
  usedLocalFallback: false,
};

function hydrationKey(userId: string | null, projectId: string): string {
  return `${userId ?? 'anonymous'}:${projectId}`;
}

/** Module-level so every reader (the pipeline hook, ProjectDashboard, tests) sees the same map without prop-drilling. */
export const projectHydrationStore = atom<Record<string, ProjectHydrationState>>({});

/** Pure lookup over an already-subscribed map — use this from React (via `useStore(projectHydrationStore)`) so a status change re-renders the caller. */
export function readHydrationState(
  map: Record<string, ProjectHydrationState>,
  userId: string | null,
  projectId: string,
): ProjectHydrationState {
  return map[hydrationKey(userId, projectId)] ?? NOT_STARTED_STATE;
}

/** Non-reactive convenience for imperative callers (hydrateProjectData itself, tests) that don't need to re-render on change. */
export function getProjectHydrationState(userId: string | null, projectId: string): ProjectHydrationState {
  return readHydrationState(projectHydrationStore.get(), userId, projectId);
}

export function setProjectHydrationState(
  userId: string | null,
  projectId: string,
  patch: Partial<ProjectHydrationState>,
): void {
  const key = hydrationKey(userId, projectId);
  const current = projectHydrationStore.get()[key] ?? NOT_STARTED_STATE;

  projectHydrationStore.set({
    ...projectHydrationStore.get(),
    [key]: { ...current, ...patch },
  });
}

/** Sign-out or authenticated-user change — every entry belongs to the session that produced it, so none of it is valid for whoever is signed in next. Called from AuthProvider. */
export function invalidateAllProjectHydration(): void {
  projectHydrationStore.set({});
}

/** Project deletion — its hydration state (under any user key) is meaningless once the project itself is gone. */
export function invalidateProjectHydration(projectId: string): void {
  const next = { ...projectHydrationStore.get() };

  for (const key of Object.keys(next)) {
    if (key.endsWith(`:${projectId}`)) {
      delete next[key];
    }
  }

  projectHydrationStore.set(next);
}

/** Resets a single project back to not_started (e.g. so a manual "Retry Hydration" cleanly re-enters the loading state). */
export function resetProjectHydration(userId: string | null, projectId: string): void {
  setProjectHydrationState(userId, projectId, NOT_STARTED_STATE);
}

/**
 * Sprint 46 — only `guided_engineering` (Builders) projects have role outputs/tasks/reviews to
 * restore before the autonomous pipeline decides which role to resume from; Quick Build has its
 * own, unrelated restore path (see app/lib/quick-build/workspaceResumeOrchestrator.ts) and must
 * stay completely unaffected by this sprint. Extracted as a named predicate (rather than an
 * inline string comparison at the one call site, ProjectDashboard.tsx) so "Quick Build is
 * excluded from BuildersDB artifact hydration" is a direct, testable claim.
 */
export function shouldHydrateProjectData(projectType: string): boolean {
  return projectType === 'guided_engineering';
}
