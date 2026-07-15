import { atom } from 'nanostores';
import {
  PROJECT_TYPE_REGISTRY,
  looksLikeRawModelPrefixName,
  stripModelProviderPrefix,
  type ProjectTypeId,
  type CreatedFrom,
} from '~/lib/project-types/projectTypeRegistry';
import type { RoadmapItemStatus } from '~/lib/blueprints';
import type { ProjectKnowledge } from '~/lib/projects/knowledge';
import { isRequirementsCaptured } from '~/lib/projects/knowledge';
import type { ProjectTaskStatus } from '~/lib/projects/executionEngine';
import { ARTIFACT_TYPES, getLatestArtifact, type ProjectArtifact } from '~/lib/projects/artifacts';
import { createSyncedRequirementsArtifact, isSyncedRequirementsArtifact } from '~/lib/projects/requirementsSync';
import type {
  ReviewDecision,
  TaskHistoryEvent,
  TaskHistoryEventType,
  TaskReviewRecord,
} from '~/lib/projects/reviewEngine';
import type { GenerationSession } from '~/lib/projects/generationSessionEngine';
import { DEFAULT_WORKSPACE_STATE, type ProjectWorkspaceState } from '~/lib/projects/workspaceState';
import { createProjectRepository } from '~/lib/builders-db/repositories/projectsRepository';
import { buildersDbRepository, isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import { workspaceStateRepository } from '~/lib/builders-db/repositories/workspaceStateRepository';
import { checkBuildersDbConnection } from '~/lib/builders-db/client';
import type { RoleOutputGenerationType } from '~/lib/builders-db/buildersDbTypes';
import { getCurrentSession } from '~/lib/auth/authClient';
import { invalidateProjectHydration, setProjectHydrationState } from '~/lib/projects/hydration';

/**
 * Project data model — Sprint 1 (UI-only).
 *
 * Only `id`, `name`, `icon`, `color`, `description`, and `createdAt` are
 * populated today. Everything else is typed now so future sprints (GitHub
 * repo linking, Supabase project linking, deploy targets, env vars,
 * members, templates, MCP servers, knowledge base) can be filled in
 * without another interface rewrite. None of this is persisted to
 * IndexedDB — projects live in localStorage only, and chats are NOT
 * associated with projects yet (see app/components/sidebar/Menu.client.tsx).
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  icon: string; // emoji, shown in the project's circular avatar
  color: string; // tailwind-ish accent color token, e.g. 'purple' | 'blue' | 'green'
  createdAt: string;

  /**
   * Sprint 3 — id of the ProjectBlueprint (see app/lib/blueprints/) chosen
   * when the project was created. Metadata only: no prompt, template, or
   * repository is generated from this yet. Future sprints will use it to
   * drive starter prompts/templates/integrations per blueprint.
   */
  blueprintId?: string;

  /**
   * Sprint 39.7 — which Builders workflow drives this project (see
   * app/lib/project-types/projectTypeRegistry.ts). Every project has exactly one, set at
   * creation and never inferred elsewhere — read it via getProjectTypeDefinition() rather
   * than branching on the string directly.
   */
  projectType: ProjectTypeId;

  /**
   * Sprint 39.7 — how this project originated, for analytics/reporting only. Distinct from
   * projectType: a project can be createdFrom: 'template' while projectType stays
   * 'guided_engineering'. Set once at creation, never changes.
   */
  createdFrom: CreatedFrom;

  /**
   * Sprint 39.7 — for projectType: 'quick_build' projects, the IndexedDB chat id/urlId
   * (see app/lib/persistence/db.ts) this project's chat lives at. Undefined until the
   * chat's first message is stored (see useChatHistory.ts's storeMessageHistory) or for
   * guided_engineering projects, which have no single associated chat.
   */
  linkedChatId?: string;

  /**
   * Sprint 8 — local-only status per roadmap item, keyed by the blueprint's
   * RoadmapItem.key (see app/lib/blueprints/types.ts and
   * blueprintEngine.getRoadmap()). Not present until a status is explicitly
   * set for at least one item; any key without an entry here is treated as
   * "not-started" by whoever reads it (see getRoadmapItemStatus below).
   * Stored in localStorage only, same as the rest of Project — no backend,
   * no IndexedDB.
   */
  roadmapStatus?: Record<string, RoadmapItemStatus>;

  /**
   * Phase 2 Sprint 9 — structured product knowledge captured before any AI
   * generation happens (see app/lib/projects/knowledge.ts for the shape and
   * the Blueprint -> Requirements -> Project Knowledge -> Roadmap -> ...
   * layering this belongs to). Local-only, same localStorage persistence as
   * the rest of Project — no backend, no IndexedDB. Not present until the
   * user saves the Requirements dialog at least once.
   */
  projectKnowledge?: ProjectKnowledge;

  /**
   * Sprint 11 — manual execution stage per task id (see
   * app/lib/projects/executionEngine.ts for the resolved-status
   * computation and app/lib/projects/taskEngine.ts for what a task id
   * refers to). This is a *different, more granular* signal than
   * `roadmapStatus` above: roadmapStatus tracks coarse per-roadmap-step
   * progress, this tracks exactly where the user is in a single task's
   * Start -> Pause -> Submit for Review -> Completed lifecycle — the two
   * are intentionally not merged. Absent entries default to "not-started";
   * "ready" and "blocked" are normally computed by executionEngine rather
   * than written here. Persisted via the ProjectRepository (see
   * app/lib/builders-db/), same as the rest of Project — no backend API,
   * no IndexedDB.
   */
  taskStatus?: Record<string, ProjectTaskStatus>;

  /**
   * Sprint 11 — free-form markdown notes per task id, authored by the user
   * in the Task Details dialog. Nothing reads these yet; they exist so a
   * future AI Project Manager has task-level context to read. Local-only,
   * same persistence as the rest of Project.
   */
  taskNotes?: Record<string, string>;

  /**
   * Sprint 11 — placeholder output artifacts (see
   * app/lib/projects/artifacts.ts). Nothing generates real artifact
   * content yet; every artifact created this sprint is an empty
   * placeholder. Local-only, same persistence as the rest of Project.
   */
  artifacts?: ProjectArtifact[];

  /**
   * Sprint 12 — the latest review verdict per task id (see
   * app/lib/projects/reviewEngine.ts). Only ever written by
   * applyReviewDecision below (itself only called after
   * reviewEngine.approveTask/rejectTask) — nothing else sets a task's
   * manual stage to "completed". Local-only, no backend.
   */
  taskReview?: Record<string, TaskReviewRecord>;

  /**
   * Sprint 12 — chronological lifecycle history per task id (Started,
   * Paused, Submitted for Review, Approved, Requested Changes), each with
   * a timestamp and optional note. Powers the ReviewTimeline component
   * (app/components/sidebar/ReviewComponents.tsx). Local-only, no backend.
   */
  taskHistory?: Record<string, TaskHistoryEvent[]>;

  /**
   * Sprint 28 — a simulated generation runtime session (see
   * app/lib/projects/generationSessionEngine.ts). Undefined until a session
   * is explicitly created and persisted; nothing calls the setter below
   * yet — there is no Start button this sprint, so this stays unset for
   * every project today. Persisted via the ProjectRepository's generic
   * saveProjects() (see app/lib/builders-db/), same as the rest of
   * Project — no repository changes needed, and no BuildersDB-specific
   * code anywhere in this file. A future sprint that adds real
   * start/pause/resume/cancel actions will read/write this field through
   * getGenerationSession/setGenerationSession below.
   */
  generationSession?: GenerationSession;

  /**
   * Sprint 38.5 — persisted workspace/resume state (see
   * app/lib/projects/workspaceState.ts): whether an application has been generated for
   * this project, whether its preview/files are available, and the last dashboard
   * tab/stage the user was on. Hydrated from BuildersDB's
   * builders_project_workspace_state table when a project opens (see
   * hydrateWorkspaceState below) — undefined until that hydration runs or BuildersDB is
   * unavailable, in which case every reader falls back to today's "nothing generated
   * yet" behavior. Kept as a plain field on `Project` (like `projectKnowledge`/
   * `taskStatus`) rather than a separate store, so projectManagerEngine.ts's
   * `analyzeProject(project)` can stay a pure synchronous function.
   */
  workspaceState?: ProjectWorkspaceState;

  // Future fields — intentionally unset in Sprint 1.
  githubRepo?: string;
  supabaseProjectId?: string;
  deploymentTarget?: 'vercel' | 'netlify' | 'cloudflare';
  environmentVariables?: Record<string, string>;
  members?: string[];
  templates?: string[];
  mcpServers?: string[];
  knowledgeBase?: string[];
}

/**
 * Sprint 18 — the Store's only connection to persistence. Everything below
 * that used to read/write `localStorage` directly (the Sprint 9
 * legacy-mock-project cleanup included) now goes through this repository;
 * see app/lib/builders-db/ for the repository interface, the Local
 * provider (today's only active backend, wrapping the exact same
 * localStorage logic that used to live here), and the Supabase provider
 * skeleton for a future cloud backend. Only
 * app/lib/builders-db/repositories/projectsRepository.ts's
 * createProjectRepository() decides which provider backs this — the Store
 * itself has no opinion.
 */
const projectRepository = createProjectRepository();

/**
 * Sprint 39.8 bugfix — a bug in Sprint 39.7's very first version of the Quick Build name
 * derivation (useChatHistory.ts) let the raw "[Model: ...]\n\n[Provider: ...]\n\n" prefix
 * Chat.client.tsx prepends to a chat's first message through as the project's name. Fixed
 * there (stripModelProviderPrefix is now applied before naming), but any project already
 * saved with the buggy raw name needs a one-time cleanup here. `looksLikeRawModelPrefixName`
 * only matches names that couldn't possibly be something a user actually typed, so this
 * never touches a genuine user-edited title.
 */
function sanitizeLegacyQuickBuildName(project: Project): Project {
  if (project.projectType !== 'quick_build' || !looksLikeRawModelPrefixName(project.name)) {
    return project;
  }

  const cleaned = stripModelProviderPrefix(project.name).slice(0, 60);

  return { ...project, name: cleaned || PROJECT_TYPE_REGISTRY.quick_build.displayName };
}

/**
 * Sprint 39.7 — every project persisted before this sprint predates `projectType`/
 * `createdFrom`; both are backfilled to 'guided_engineering' here since Quick Build never
 * persisted a project before now. New projects always pass both explicitly via addProject().
 */
function normalizeProjectType(projects: Project[]): Project[] {
  return projects
    .map((project) =>
      project.projectType
        ? project
        : {
            ...project,
            projectType: 'guided_engineering' as const,
            createdFrom: project.createdFrom ?? 'guided_engineering',
          },
    )
    .map(sanitizeLegacyQuickBuildName);
}

const normalizedInitialProjects = normalizeProjectType(projectRepository.loadProjects());
export const projectsStore = atom<Project[]>(normalizedInitialProjects);

// Persist the one-time cleanup above so it doesn't need to re-run against localStorage on every load.
projectRepository.saveProjects(normalizedInitialProjects);

/**
 * Sprint 34 — BuildersDB write-through.
 *
 * `projectRepository` above stays exactly as Sprint 18 left it: synchronous,
 * localStorage-backed, and the only thing every mutator below awaits/reads
 * back from. Every mutator ALSO fires an async, best-effort mirror to
 * BuildersDB's normalized tables (see
 * app/lib/builders-db/repositories/buildersDbRepository.ts) — deliberately
 * NOT awaited, so a slow/unreachable/misconfigured BuildersDB can never
 * block or fail a local write. When `isBuildersDbAvailable()` is false
 * (no BUILDERS_DB_SUPABASE_URL/BUILDERS_DB_SUPABASE_ANON_KEY set — true for
 * everyone until BuildersDB is actually provisioned), every mirror call is a
 * cheap no-op that logs a warning and returns, so local-only usage is
 * unaffected.
 */
/**
 * Sprint 45 — serialized write-through queue.
 *
 * Every mirror runs in the exact order it was enqueued, one at a time. Before this, mirrors
 * were fired concurrently and unordered, which raced: an artifact's draft INSERT and its own
 * approve UPDATE (enqueued back-to-back by addProjectArtifact then updateProjectArtifact) both
 * do a read-then-upsert on the same (artifact_id, version) row, so the draft write could land
 * AFTER the approve write and silently persist `draft` instead of `approved` (observed live in
 * Sprint 45 for later pipeline roles, breaking refresh/resume). Serializing preserves
 * enqueue order — draft always completes before approve — so the final persisted status is
 * correct. Still best-effort and never awaited by callers; a failed write is logged and the
 * queue continues with the next one.
 */
let mirrorQueue: Promise<unknown> = Promise.resolve();

function mirrorToBuildersDb(work: () => Promise<unknown>): void {
  if (!isBuildersDbAvailable()) {
    return;
  }

  mirrorQueue = mirrorQueue
    .then(() => work())
    .catch((error) => console.error('[BuildersDB] Write-through failed:', error));
}

/**
 * Sprint 42 — resolves the currently authenticated user for ownership/attribution writes
 * (owner_id, created_by, actor_id, generated_by_user — PART 1/8/9). Reads directly from
 * `authClient.ts`'s existing `getCurrentSession()` rather than requiring every caller in this
 * module to accept a userId parameter threaded down from `useAuth()` — this module has no
 * React context to read from, and Sprint 40's AuthProvider already establishes the same
 * pattern (calling authClient functions directly, never `supabase.auth` itself). Returns null
 * when unauthenticated or BuildersDB isn't configured, in which case every caller below simply
 * omits the actor fields it would have set (mirrorToBuildersDb's usual no-op-when-unavailable
 * behavior already covers the "not configured" case).
 */
async function getCurrentActor(): Promise<{ id: string; displayName: string } | null> {
  try {
    const session = await getCurrentSession();

    if (!session?.user) {
      return null;
    }

    return { id: session.user.id, displayName: session.user.email ?? session.user.id };
  } catch (error) {
    console.error('[BuildersDB] getCurrentActor() failed:', error);
    return null;
  }
}

/**
 * Sprint 34, strengthened Sprint 38.3 — startup hydration from BuildersDB. Fired once at
 * module load (see the bottom of this section) rather than waiting on any particular
 * component to mount, so it runs as close to "application startup" as this module's own
 * import does. Local-first, safe-fallback: `projectsStore` already holds whatever
 * localStorage had (see the atom initializer above) before this ever resolves, so the UI
 * never blocks on network, and any thrown/rejected error here leaves local state exactly
 * as it was — BuildersDB being unreachable never loses local work.
 *
 * Two cases once BuildersDB is confirmed reachable:
 *  - Remote already has projects: it becomes authoritative for every project it knows
 *    about, but any LOCAL project not yet present remotely (Sprint 39.7 — e.g. its
 *    `mirrorToBuildersDb()` write is still failing, such as a Quick Build project created
 *    before a required schema migration has been applied) is kept and merged in rather than
 *    silently dropped, and re-pushed via `buildersDbRepository.createProject()` so it
 *    eventually syncs once possible. `projectsStore`/local cache are updated to this merged
 *    list.
 *  - Remote is reachable but empty (a freshly-provisioned BuildersDB project): whatever
 *    projects already exist locally are pushed up once via `buildersDbRepository.createProject`
 *    (a one-time migration, not an ongoing merge — see docs/buildersdb.md) so a team
 *    sharing this BuildersDB project immediately sees them too. `projectsStore` doesn't
 *    need to change in this branch — it already holds exactly this data.
 */
export async function hydrateProjectsFromBuildersDb(): Promise<void> {
  if (!isBuildersDbAvailable()) {
    return;
  }

  try {
    /*
     * Sprint 42 — every createProject() call below now requires a non-null owner_id (RLS's
     * builders_projects_insert_own policy rejects owner_id is null), so the actor must be
     * resolved before pushing any local-only project up.
     */
    const actor = await getCurrentActor();
    const remoteProjects = await buildersDbRepository.listProjectsForCurrentUser();
    const localProjects = projectRepository.loadProjects();

    if (remoteProjects.length > 0) {
      const remoteIds = new Set(remoteProjects.map((project) => project.id));
      const localOnly = localProjects.filter((project) => !remoteIds.has(project.id));

      /*
       * Sprint 39.8 bugfix — remote rows can still carry a legacy raw "[Model: ...]" name
       * from before sanitizeLegacyQuickBuildName existed (e.g. a project whose mirror write
       * only succeeded after a later, unrelated update, capturing the bad name at that
       * point). Re-sanitizing here means remote being "authoritative" never reintroduces a
       * name local storage already fixed.
       */
      const merged = [...remoteProjects, ...localOnly].map(sanitizeLegacyQuickBuildName);

      projectsStore.set(merged);
      projectRepository.saveProjects(merged);

      if (localOnly.length > 0 && actor) {
        await Promise.all(localOnly.map((project) => buildersDbRepository.createProject(project, actor.id)));
      }

      return;
    }

    if (localProjects.length > 0 && actor) {
      await Promise.all(localProjects.map((project) => buildersDbRepository.createProject(project, actor.id)));
    }
  } catch (error) {
    console.error('[BuildersDB] hydrateProjectsFromBuildersDb() failed, keeping local projects:', error);
  }
}

/*
 * Sprint 40 — no longer auto-fired at module load. An unauthenticated browser must never
 * hydrate the shared BuildersDB project dataset, and this module can be imported well
 * before auth resolves. `AuthProvider` (app/lib/auth/AuthProvider.tsx) now calls
 * `hydrateProjectsFromBuildersDb()` itself, exactly once, only after a session is confirmed.
 */

/**
 * Sprint 38.5 — loads one project's persisted `builders_project_workspace_state` row (see
 * app/lib/projects/workspaceState.ts) and merges it onto that project's in-memory
 * `workspaceState` field. Called by ProjectDashboard.tsx when a project opens (see that
 * file's `useEffect` keyed on `project?.id`/`open`) — deliberately per-project rather than
 * bulk-loaded for every project at module init like `hydrateProjectsFromBuildersDb`, since
 * workspace state is only ever needed for whichever project is actually being viewed.
 * A no-op (leaves `workspaceState` unset) when BuildersDB is unavailable or no row exists
 * yet — every reader of `project.workspaceState` already treats `undefined` as "nothing
 * generated yet", so this never blocks or breaks opening a project.
 */
export async function hydrateWorkspaceState(projectId: string): Promise<void> {
  if (!isBuildersDbAvailable()) {
    return;
  }

  try {
    const state = await workspaceStateRepository.getWorkspaceState(projectId);

    if (!state) {
      return;
    }

    projectsStore.set(
      projectsStore
        .get()
        .map((project) => (project.id === projectId ? { ...project, workspaceState: state } : project)),
    );
  } catch (error) {
    console.error('[BuildersDB] hydrateWorkspaceState() failed:', error);
  }
}

/** Transient in-flight guard (not the reactive hydration state — see hydration.ts) purely to stop two near-simultaneous triggers (ProjectDashboard's open effect and the pipeline hook's own not_started check) from firing duplicate concurrent fetches for the same user+project. */
const inFlightHydrations = new Set<string>();

/**
 * Sprint 46 — atomic per-project hydration from BuildersDB. Unlike `hydrateWorkspaceState`
 * (workspace state only) and `hydrateProjectsFromBuildersDb` (project metadata only, bulk,
 * startup), this restores everything the autonomous pipeline and dashboard need to resume
 * correctly — role output artifacts (+ version history via their distinct ids), requirements/
 * knowledge, task status/notes, task reviews, and workspace state — into ONE
 * `projectsStore.set()` call, so nothing downstream (`getNextAutoRole`, `getProjectArtifacts`,
 * ...) ever observes a partially-hydrated project.
 *
 * Merge rules (Sprint 46 design report):
 *  - BuildersDB role outputs, if any exist, are authoritative and replace local artifacts.
 *  - If BuildersDB legitimately returns zero role outputs but local artifacts already exist,
 *    local is KEPT (never erased) and a reconciliation warning is logged — a project that has
 *    completed work sitting in the browser must never look "new" and restart its pipeline.
 *  - Tasks/reviews/knowledge/workspace state merge remote-wins-per-key onto local, the same
 *    reasoning as every other mirror-then-merge path in this file.
 *  - `checkBuildersDbConnection()` distinguishes "BuildersDB reachable but legitimately empty"
 *    from "BuildersDB unreachable right now" — the two must never be confused, since the
 *    second must never present as a fresh, never-generated project (see
 *    `useAutoEngineeringPipeline.ts`, which blocks automatic generation on a `failed` status
 *    with no local artifacts rather than treating it as "nothing to resume").
 *
 * Hydration state (not_started/loading/ready/failed) is tracked per `${userId}:${projectId}`
 * in app/lib/projects/hydration.ts — read reactively by the pipeline hook, and invalidated on
 * sign-out/user-change (AuthProvider) and project deletion (deleteProject below).
 */
export async function hydrateProjectData(projectId: string): Promise<void> {
  const actor = await getCurrentActor();
  const userId = actor?.id ?? null;
  const inFlightKey = `${userId ?? 'anonymous'}:${projectId}`;

  if (inFlightHydrations.has(inFlightKey)) {
    return;
  }

  if (!isBuildersDbAvailable()) {
    const localOnly = projectsStore.get().find((project) => project.id === projectId);

    if (localOnly) {
      syncRequirementsArtifact(projectId, localOnly);
    }

    setProjectHydrationState(userId, projectId, {
      status: 'ready',
      userId,
      hydratedAt: new Date().toISOString(),
      error: null,
      usedLocalFallback: true,
    });

    return;
  }

  inFlightHydrations.add(inFlightKey);
  setProjectHydrationState(userId, projectId, { status: 'loading', userId, error: null });

  try {
    const reachable = await checkBuildersDbConnection();

    if (!reachable) {
      throw new Error('BuildersDB is configured but not reachable right now.');
    }

    const [remoteArtifacts, remoteProject, remoteTasks, remoteReviews, remoteWorkspaceState] = await Promise.all([
      buildersDbRepository.getRoleOutputsForProject(projectId),
      buildersDbRepository.getProjectById(projectId),
      buildersDbRepository.getProjectTasks(projectId),
      buildersDbRepository.getTaskReviews(projectId),
      workspaceStateRepository.getWorkspaceState(projectId),
    ]);

    const local = projectsStore.get().find((project) => project.id === projectId);

    if (!local) {
      // Project was removed from the store mid-fetch (e.g. deleteProject) — nothing to merge into.
      setProjectHydrationState(userId, projectId, {
        status: 'ready',
        userId,
        hydratedAt: new Date().toISOString(),
        error: null,
        usedLocalFallback: false,
      });
      return;
    }

    /*
     * Sprint 46.1 — live-verified bugfix: dedupe by the COMPOUND (artifact_id, version) key,
     * matching BuildersDB's own upsert conflict target — NOT by artifact_id alone. The manual
     * "Regenerate" flow (useDraftPanel.ts's runGeneration) intentionally reuses the SAME
     * artifact_id across versions, bumping only `version` — exactly BuildersDB's "one row per
     * version" model (see buildersDbTypes.ts). Deduping by artifact_id alone treated every
     * version sharing an id as a duplicate write to collapse, silently discarding an earlier
     * APPROVED version whenever a later regenerate attempt (draft or discarded) for the same
     * artifact_id had a newer `updatedAt` — exactly the live-reproduced QA/DevOps resume bug.
     * A genuine duplicate-write race for the IDENTICAL (artifact_id, version) pair is still
     * collapsed here (last write, by updatedAt, wins); distinct versions never are.
     */
    const byArtifactVersion = new Map<string, ProjectArtifact>();

    for (const artifact of remoteArtifacts) {
      const key = `${artifact.id}:${artifact.version ?? 0}`;
      const existing = byArtifactVersion.get(key);

      if (!existing || new Date(artifact.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
        byArtifactVersion.set(key, artifact);
      }
    }

    const dedupedRemoteArtifacts = Array.from(byArtifactVersion.values());
    const localArtifacts = local.artifacts ?? [];

    let mergedArtifacts: ProjectArtifact[];
    let usedLocalFallback = false;

    if (dedupedRemoteArtifacts.length > 0) {
      mergedArtifacts = dedupedRemoteArtifacts;
    } else if (localArtifacts.length > 0) {
      mergedArtifacts = localArtifacts;
      usedLocalFallback = true;
      console.warn(
        `[BuildersDB] hydrateProjectData(${projectId}): BuildersDB returned no role outputs but ${localArtifacts.length} local artifact(s) exist — keeping local artifacts rather than erasing completed work. This may mean this project's mirror write hasn't landed in BuildersDB yet.`,
      );
    } else {
      mergedArtifacts = [];
    }

    const taskStatus = { ...local.taskStatus };
    const taskNotes = { ...local.taskNotes };

    for (const task of remoteTasks) {
      if (task.status !== undefined) {
        taskStatus[task.taskId] = task.status;
      }

      if (task.notes !== undefined) {
        taskNotes[task.taskId] = task.notes;
      }
    }

    const taskReview = { ...local.taskReview };

    for (const review of remoteReviews) {
      taskReview[review.taskId] = review;
    }

    const merged: Project = {
      ...local,
      artifacts: mergedArtifacts,
      taskStatus,
      taskNotes,
      taskReview,
      projectKnowledge: remoteProject?.projectKnowledge ?? local.projectKnowledge,
      roadmapStatus: remoteProject?.roadmapStatus ?? local.roadmapStatus,
      workspaceState: remoteWorkspaceState ?? local.workspaceState,
    };

    const nextProjects = projectsStore.get().map((project) => (project.id === projectId ? merged : project));
    projectsStore.set(nextProjects);
    projectRepository.saveProjects(nextProjects);

    /*
     * Sprint 46.2 — self-heal: a project hydrated from BuildersDB may have captured
     * projectKnowledge but no requirements-draft artifact at all (see requirementsSync.ts's
     * comment) if Requirements was only ever captured through the manual dialog. Runs AFTER
     * the merge above so it sees the final, authoritative artifact list — deterministic id
     * means this never creates a duplicate on repeated reopens.
     */
    syncRequirementsArtifact(projectId, merged);

    setProjectHydrationState(userId, projectId, {
      status: 'ready',
      userId,
      hydratedAt: new Date().toISOString(),
      error: null,
      usedLocalFallback,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BuildersDB hydration failed.';
    console.error(`[BuildersDB] hydrateProjectData(${projectId}) failed:`, error);
    setProjectHydrationState(userId, projectId, {
      status: 'failed',
      userId,
      hydratedAt: null,
      error: message,
      usedLocalFallback: false,
    });
  } finally {
    inFlightHydrations.delete(inFlightKey);
  }
}

/**
 * Sprint 38.5 — updates one project's workspace state, both in-memory (instant, so the UI
 * reacts immediately — e.g. flipping "Generate Application" to "Continue Development" the
 * moment a generation completes) and mirrored to BuildersDB (fire-and-forget, same
 * `mirrorToBuildersDb` pattern every other mutator in this file already uses). `patch` is
 * merged onto the project's current `workspaceState` (or `DEFAULT_WORKSPACE_STATE` if
 * unset) — callers only need to pass the fields that actually changed.
 */
export function updateProjectWorkspaceState(projectId: string, patch: Partial<ProjectWorkspaceState>): void {
  const projects = projectsStore.get();
  const target = projects.find((project) => project.id === projectId);

  if (!target) {
    return;
  }

  const next: ProjectWorkspaceState = { ...(target.workspaceState ?? DEFAULT_WORKSPACE_STATE), ...patch };

  projectsStore.set(
    projects.map((project) => (project.id === projectId ? { ...project, workspaceState: next } : project)),
  );

  mirrorToBuildersDb(() => workspaceStateRepository.upsertWorkspaceState(projectId, patch));
}

/**
 * The "Current Project" — Sprint 2 concept. Set when a project is opened
 * from the sidebar (opens the Project Dashboard modal); null when no
 * project is active. Pure UI state, not persisted, not yet consumed by
 * chat creation/persistence. Future sprints can read this when creating a
 * chat so it's associated with the active project.
 */
export const currentProjectIdStore = atom<string | null>(null);

/**
 * Sprint 6 — whether the Project Dashboard modal is open. Lifted out of
 * Menu.client.tsx's local component state so other components (e.g. the
 * Current Project badge near the chat input) can reopen the dashboard for
 * the active project without prop-drilling through BaseChat/Menu.
 */
export const isProjectDashboardOpenStore = atom(false);

/**
 * Sprint 6 — a monotonically increasing counter. Bump it via
 * requestChatInputFocus() to ask the chat prompt textarea to focus itself
 * (e.g. after closing the Project Dashboard from "Start Chat"). This is a
 * signal, not a value: components that care watch it change in a
 * useEffect and imperatively call textareaRef.current?.focus() — the
 * number itself has no meaning beyond "this changed since last time."
 */
export const focusChatInputRequestStore = atom(0);

export function requestChatInputFocus() {
  focusChatInputRequestStore.set(focusChatInputRequestStore.get() + 1);
}

/**
 * Sprint 24 — same signal pattern as focusChatInputRequestStore above. Bump
 * it via requestNewProjectDialog() to ask the sidebar's New Project dialog
 * (ProjectList.tsx, local state) to open itself — e.g. from the "Guided
 * Engineering" card on the home screen — without lifting that dialog's open
 * state out of ProjectList.tsx or prop-drilling through Menu/BaseChat.
 */
export const requestNewProjectDialogStore = atom(0);

export function requestNewProjectDialog() {
  requestNewProjectDialogStore.set(requestNewProjectDialogStore.get() + 1);
}

interface NewProjectInput {
  name: string;
  icon: string;
  color: string;
  projectType: ProjectTypeId;
  createdFrom: CreatedFrom;
  description?: string;
  blueprintId?: string;
}

/**
 * Urgent fix — the synchronous, local-only half of what `addProject()` below always did in
 * one step. Split out so Quick Build's first-message flow (Chat.client.tsx's `sendMessage`)
 * can create the local project once, then separately (and repeatedly, on retry) await
 * `persistQuickBuildProject()` against the SAME project rather than minting a new id/row
 * every time the BuildersDB write is retried.
 */
function createLocalProject(input: NewProjectInput): Project {
  const project: Project = {
    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    description: input.description,
    icon: input.icon,
    color: input.color,
    blueprintId: input.blueprintId,
    projectType: input.projectType,
    createdFrom: input.createdFrom,
    createdAt: new Date().toISOString(),
  };

  projectsStore.set([...projectsStore.get(), project]);
  projectRepository.saveProject(project);

  return project;
}

export function addProject(input: NewProjectInput): Project {
  const project = createLocalProject(input);

  mirrorToBuildersDb(async () => {
    const actor = await getCurrentActor();
    await buildersDbRepository.createProject(project, actor?.id ?? null);
    await buildersDbRepository.addProjectActivity({
      projectId: project.id,
      activityType: 'project_created',
      description: `Project "${project.name}" created`,
      actorId: actor?.id ?? null,
      actorDisplayName: actor?.displayName ?? null,
    });
  });

  return project;
}

export interface QuickBuildProjectResult {
  project: Project;
  ok: boolean;
  error: string | null;
}

/**
 * Urgent fix — Quick Build's first-message project creation. Unlike `addProject()`'s
 * fire-and-forget `mirrorToBuildersDb()`, this AWAITS the BuildersDB insert and returns
 * whether it actually succeeded, with the real (safe) reason if not — Chat.client.tsx's
 * `sendMessage` uses this to block generation from starting until the project row exists (or
 * BuildersDB isn't configured at all, in which case local-only is an accepted fallback, not a
 * silently-swallowed failure).
 *
 * Takes an existing local `Project` (created once via `createLocalProject`, e.g. on the first
 * attempt) rather than creating one itself, so a retry after a failed insert re-attempts the
 * BuildersDB write for the SAME project — never a second local project, never a second id.
 */
export async function persistQuickBuildProject(project: Project): Promise<QuickBuildProjectResult> {
  if (!isBuildersDbAvailable()) {
    return { project, ok: true, error: null };
  }

  const actor = await getCurrentActor();

  if (!actor) {
    return { project, ok: false, error: 'You must be signed in to start a Quick Build.' };
  }

  const created = await buildersDbRepository.createProjectWithResult(project, actor.id);

  if (!created.ok) {
    return { project, ok: false, error: created.error ?? 'Could not save this project to BuildersDB.' };
  }

  buildersDbRepository
    .addProjectActivity({
      projectId: project.id,
      activityType: 'project_created',
      description: `Project "${project.name}" created`,
      actorId: actor.id,
      actorDisplayName: actor.displayName,
    })
    .catch((error) => console.warn('[BuildersDB] project_created activity log failed:', error));

  return { project, ok: true, error: null };
}

/**
 * Urgent fix — Quick Build's first-message local project creation (see
 * `persistQuickBuildProject` above). A thin, typed wrapper over `createLocalProject` so
 * Chat.client.tsx doesn't need its own copy of the id-generation/store-write logic.
 */
export function createQuickBuildLocalProject(input: { name: string; icon: string; color: string }): Project {
  return createLocalProject({
    ...input,
    projectType: 'quick_build',
    createdFrom: 'quick_build',
  });
}

/**
 * Sprint 9 — remove a project from the local project store only.
 *
 * This never touches chat history/persistence, GitHub, Supabase, or any
 * deployment — it only filters projectsStore and tells the repository to
 * delete the project, exactly like every other write in this file. If the
 * deleted project was the active one, the active-project selection (and
 * the Project Dashboard, if it happened to be open for this project) is
 * cleared so the UI doesn't end up pointing at a project that no longer
 * exists.
 */
export function deleteProject(projectId: string): void {
  const project = projectsStore.get().find((candidate) => candidate.id === projectId);

  projectsStore.set(projectsStore.get().filter((candidate) => candidate.id !== projectId));
  projectRepository.deleteProject(projectId);
  invalidateProjectHydration(projectId);

  mirrorToBuildersDb(async () => {
    const actor = await getCurrentActor();

    /*
     * Logged before the delete below (not after): builders_project_activity's
     * project_id column requires a still-existing row unless it's null, and we want
     * this entry to record the real project_id, not null (see the migration's
     * "on delete set null" comment for why the row survives the delete anyway).
     */
    await buildersDbRepository.addProjectActivity({
      projectId,
      activityType: 'project_deleted',
      description: `Project "${project?.name ?? projectId}" deleted`,
      actorId: actor?.id ?? null,
      actorDisplayName: actor?.displayName ?? null,
    });

    /*
     * Sprint 42 (PART 10) — Owner-only. Passing the actor id lets deleteProject() refuse
     * (and log a clear warning) instead of silently deleting 0 rows the way a bare RLS
     * rejection would. Local removal above already happened regardless — this function's own
     * doc comment has always described it as "remove a project from the local project store
     * only" — so an Editor/Viewer's local sidebar still updates; only the shared BuildersDB
     * row (and everyone else's view of it) survives.
     */
    await buildersDbRepository.deleteProject(projectId, actor?.id ?? null);
  });

  if (currentProjectIdStore.get() === projectId) {
    currentProjectIdStore.set(null);
    isProjectDashboardOpenStore.set(false);
  }
}

/**
 * Sprint 8 — read a roadmap item's status for a project. Defaults to
 * "not-started" when nothing has been stored for that key yet, matching
 * the roadmap item's implicit default before any interaction.
 */
export function getRoadmapItemStatus(project: Project, itemKey: string): RoadmapItemStatus {
  return project.roadmapStatus?.[itemKey] ?? 'not-started';
}

/**
 * Sprint 8 — set a roadmap item's status for a project. Persisted via the
 * ProjectRepository (see app/lib/builders-db/), no backend, no IndexedDB.
 * Not wired to any UI control yet — this sprint only needs the roadmap to
 * be readable and its progress calculable; this setter exists so a future
 * sprint can let users change status without another store change.
 */
export function setRoadmapItemStatus(projectId: string, itemKey: string, status: RoadmapItemStatus): void {
  const next = projectsStore
    .get()
    .map((project) =>
      project.id === projectId
        ? { ...project, roadmapStatus: { ...project.roadmapStatus, [itemKey]: status } }
        : project,
    );
  projectsStore.set(next);
  projectRepository.saveProjects(next);

  const updated = next.find((project) => project.id === projectId);

  if (updated) {
    mirrorToBuildersDb(() => buildersDbRepository.updateProject(updated));
  }
}

/**
 * Sprint 11 — read a task's raw manual execution stage. Returns undefined
 * when nothing has been recorded yet (see executionEngine.ts, which treats
 * a missing entry as "not-started" and resolves the task's actual display
 * status from there).
 */
export function getStoredTaskStatus(project: Project, taskId: string): ProjectTaskStatus | undefined {
  return project.taskStatus?.[taskId];
}

/**
 * Sprint 12 — which lifecycle history event (if any) a plain setTaskStatus
 * transition represents. 'completed' is deliberately absent: that stage is
 * only ever reached via applyReviewDecision (approveTask), which logs its
 * own 'approved' history event.
 */
const HISTORY_EVENT_FOR_STATUS: Partial<Record<ProjectTaskStatus, TaskHistoryEventType>> = {
  'in-progress': 'started',
  'not-started': 'paused',
  'needs-review': 'submitted-for-review',
};

/**
 * Sprint 11 — set a task's manual execution stage. Persisted via the
 * ProjectRepository (see app/lib/builders-db/), same pattern as
 * setRoadmapItemStatus. Called with 'in-progress' | 'not-started' |
 * 'needs-review' for the Start/Pause/Submit for Review actions — 'ready'
 * and 'blocked' are left for executionEngine to compute, and 'completed' is
 * only ever reached via applyReviewDecision (Sprint 12's Approve action),
 * never through this setter. Each transition here also appends a Sprint 12
 * history event (see taskHistory above) so the ReviewTimeline component has
 * a full Started/Paused/Submitted record.
 */
export function setTaskStatus(projectId: string, taskId: string, status: ProjectTaskStatus): void {
  const historyEvent = HISTORY_EVENT_FOR_STATUS[status];

  const next = projectsStore.get().map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const updated: Project = { ...project, taskStatus: { ...project.taskStatus, [taskId]: status } };

    if (historyEvent) {
      updated.taskHistory = {
        ...project.taskHistory,
        [taskId]: [...(project.taskHistory?.[taskId] ?? []), { event: historyEvent, at: new Date().toISOString() }],
      };
    }

    return updated;
  });

  projectsStore.set(next);
  projectRepository.updateTasks(next);

  mirrorToBuildersDb(async () => {
    await buildersDbRepository.updateProjectTask(projectId, { taskId, status });

    if (historyEvent) {
      await buildersDbRepository.createExecutionLog(projectId, { taskId, eventType: historyEvent });
    }
  });
}

/** Sprint 11 — read a task's notes. Defaults to '' when nothing has been saved yet. */
export function getTaskNotes(project: Project, taskId: string): string {
  return project.taskNotes?.[taskId] ?? '';
}

/**
 * Sprint 11 — save a task's notes. Persisted via the ProjectRepository (see
 * app/lib/builders-db/), same pattern as updateProjectKnowledge. Plain
 * markdown text, not parsed or sent anywhere — a future AI Project Manager
 * is the intended reader.
 */
export function setTaskNotes(projectId: string, taskId: string, notes: string): void {
  const next = projectsStore
    .get()
    .map((project) =>
      project.id === projectId ? { ...project, taskNotes: { ...project.taskNotes, [taskId]: notes } } : project,
    );
  projectsStore.set(next);
  projectRepository.updateTasks(next);

  mirrorToBuildersDb(() => buildersDbRepository.updateProjectTask(projectId, { taskId, notes }));
}

/** Sprint 11 — a project's artifacts (see app/lib/projects/artifacts.ts). Empty array when none exist yet. */
export function getProjectArtifacts(project: Project): ProjectArtifact[] {
  return project.artifacts ?? [];
}

/**
 * Sprint 11 — append an artifact to a project. Persisted via the
 * ProjectRepository (see app/lib/builders-db/). Nothing calls this yet —
 * the architecture is ready for a future AI generation sprint to create
 * real artifacts via the same setter, with no data-model change (see
 * createPlaceholderArtifact in app/lib/projects/artifacts.ts for building
 * the placeholder shape).
 */
/**
 * `generationType` ('manual' by default — every *DraftPanel's manual Generate/
 * Regenerate flow; useAutoEngineeringPipeline.ts passes 'automatic' explicitly) is
 * Sprint 36 output metadata, mirrored into builders_role_outputs so a version's history
 * records which workflow produced it. Purely additive: no existing caller (all 7
 * *DraftPanel components, RequirementsDraftPanel) needs to change since the parameter
 * defaults to today's only actual case.
 */
export function addProjectArtifact(
  projectId: string,
  artifact: ProjectArtifact,
  generationType: RoleOutputGenerationType = 'manual',
): void {
  const next = projectsStore
    .get()
    .map((project) =>
      project.id === projectId ? { ...project, artifacts: [...(project.artifacts ?? []), artifact] } : project,
    );
  projectsStore.set(next);
  projectRepository.updateArtifacts(next);

  mirrorToBuildersDb(async () => {
    const actor = await getCurrentActor();
    await buildersDbRepository.createOrUpdateRoleOutput(projectId, artifact, generationType, actor?.id ?? null);
    await buildersDbRepository.addProjectActivity({
      projectId,
      activityType: 'role_output_saved',
      description: `${artifact.generatedBy ?? artifact.type} output saved (${artifact.status})`,
      actorId: actor?.id ?? null,
      actorDisplayName: actor?.displayName ?? null,
    });
  });

  updateProjectWorkspaceState(projectId, {
    lastActiveEngineer: artifact.generatedBy ?? artifact.type,
    lastActivity: `${artifact.generatedBy ?? artifact.type} output saved (${artifact.status})`,
  });
}

/**
 * Sprint 13 — update fields on an existing artifact by id (status, content,
 * version, etc.), e.g. moving a Requirements Draft from 'draft' to
 * 'approved'/'discarded', or bumping its content+version on regenerate.
 * `updatedAt` is always refreshed. Persisted via the ProjectRepository (see
 * app/lib/builders-db/). `generationType` — see addProjectArtifact's comment; only
 * meaningful when this call is bumping `version` (a regenerate), not a plain
 * approve/discard status flip, but harmless to pass either way.
 */
export function updateProjectArtifact(
  projectId: string,
  artifactId: string,
  partial: Partial<ProjectArtifact>,
  generationType: RoleOutputGenerationType = 'manual',
): void {
  const next = projectsStore.get().map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    return {
      ...project,
      artifacts: (project.artifacts ?? []).map((artifact) =>
        artifact.id === artifactId ? { ...artifact, ...partial, updatedAt: new Date().toISOString() } : artifact,
      ),
    };
  });
  projectsStore.set(next);
  projectRepository.updateArtifacts(next);

  const updatedArtifact = next
    .find((project) => project.id === projectId)
    ?.artifacts?.find((artifact) => artifact.id === artifactId);

  if (updatedArtifact) {
    mirrorToBuildersDb(async () => {
      const actor = await getCurrentActor();
      await buildersDbRepository.createOrUpdateRoleOutput(
        projectId,
        updatedArtifact,
        generationType,
        actor?.id ?? null,
      );
      await buildersDbRepository.addProjectActivity({
        projectId,
        activityType: 'role_output_saved',
        description: `${updatedArtifact.generatedBy ?? updatedArtifact.type} output ${updatedArtifact.status}`,
        actorId: actor?.id ?? null,
        actorDisplayName: actor?.displayName ?? null,
      });
    });

    updateProjectWorkspaceState(projectId, {
      lastActiveEngineer: updatedArtifact.generatedBy ?? updatedArtifact.type,
      lastActivity: `${updatedArtifact.generatedBy ?? updatedArtifact.type} output ${updatedArtifact.status}`,
    });
  }
}

/** Sprint 12 — a task's latest review verdict. Returns undefined when it has never been reviewed. */
export function getTaskReview(project: Project, taskId: string): TaskReviewRecord | undefined {
  return project.taskReview?.[taskId];
}

/** Sprint 12 — a task's chronological lifecycle history. Empty array when nothing has happened yet. */
export function getTaskHistory(project: Project, taskId: string): TaskHistoryEvent[] {
  return project.taskHistory?.[taskId] ?? [];
}

/**
 * Sprint 12 — applies a `ReviewDecision` already computed by
 * reviewEngine.approveTask/rejectTask (app/lib/projects/reviewEngine.ts).
 * This is the only place `taskStatus` is ever set to 'completed', the only
 * place `taskReview` is written, and the only place an approval's roadmap
 * completion / artifact placeholder are applied — all in one atomic
 * update. Persisted via the ProjectRepository (see app/lib/builders-db/);
 * does not touch GitHub, Supabase, or IndexedDB. The caller
 * (TaskDetailsDialog) computes the decision via reviewEngine, then hands it
 * here — keeping reviewEngine itself free of any store/persistence
 * dependency.
 */
export function applyReviewDecision(projectId: string, decision: ReviewDecision): void {
  const next = projectsStore.get().map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const updated: Project = {
      ...project,
      taskStatus: { ...project.taskStatus, [decision.taskId]: decision.taskStatus },
      taskReview: { ...project.taskReview, [decision.taskId]: decision.review },
      taskHistory: {
        ...project.taskHistory,
        [decision.taskId]: [...(project.taskHistory?.[decision.taskId] ?? []), decision.historyEvent],
      },
    };

    if (decision.roadmapKey) {
      updated.roadmapStatus = { ...project.roadmapStatus, [decision.roadmapKey]: 'completed' };
    }

    if (decision.artifact) {
      updated.artifacts = [...(project.artifacts ?? []), decision.artifact];
    }

    return updated;
  });

  projectsStore.set(next);
  projectRepository.updateReviews(next);

  mirrorToBuildersDb(async () => {
    const actor = await getCurrentActor();

    await buildersDbRepository.updateProjectTask(projectId, { taskId: decision.taskId, status: decision.taskStatus });
    await buildersDbRepository.createTaskReview(projectId, {
      taskId: decision.review.taskId,
      reviewStatus: decision.review.reviewStatus,
      reviewedBy: decision.review.reviewedBy,
      reviewedAt: decision.review.reviewedAt,
      reviewNotes: decision.review.reviewNotes,
    });
    await buildersDbRepository.createExecutionLog(projectId, {
      taskId: decision.taskId,
      eventType: decision.historyEvent.event,
      note: decision.historyEvent.note,
    });

    if (decision.artifact) {
      await buildersDbRepository.createOrUpdateRoleOutput(projectId, decision.artifact, 'manual', actor?.id ?? null);
    }

    const updatedProject = next.find((project) => project.id === projectId);

    if (updatedProject && decision.roadmapKey) {
      await buildersDbRepository.updateProject(updatedProject, actor?.id ?? null);
    }

    await buildersDbRepository.addProjectActivity({
      projectId,
      activityType: decision.review.reviewStatus === 'approved' ? 'task_approved' : 'task_changes_requested',
      description: `Task ${decision.taskId} ${decision.review.reviewStatus}`,
      actorId: actor?.id ?? null,
      actorDisplayName: actor?.displayName ?? null,
    });
  });
}

/**
 * Phase 2 Sprint 9 — read a project's Project Knowledge. Returns undefined
 * when nothing has been saved yet (see ProjectDashboard's empty state).
 */
export function getProjectKnowledge(project: Project): ProjectKnowledge | undefined {
  return project.projectKnowledge;
}

/**
 * Sprint 46.2 — keeps a locally-synthesized, always-approved Requirements Draft artifact in
 * sync with captured Project Knowledge, entirely without an LLM call. See
 * app/lib/projects/requirementsSync.ts for the derivation.
 *
 * `projectManagerEngine.ts` (Overview/Project Details/readiness %/next action) treats
 * Requirements exactly like every other engineering stage — "done" means an approved
 * `requirements-draft` artifact exists — but the manual Requirements & Knowledge dialog
 * (ProjectRequirementsDialog.tsx) only ever writes `project.projectKnowledge`, never an
 * artifact. This keeps the artifact-based view honest without touching any of those
 * consumers: whenever knowledge is captured and no artifact exists yet, one is synthesized
 * from it; if a REAL AI-generated Requirements Draft already exists (a different, independently
 * minted id, from RequirementsDraftPanel's "Generate Requirements Draft" flow), it is left
 * completely alone and remains authoritative.
 *
 * Always the same deterministic artifact id for a given project (see
 * syncedRequirementsArtifactId), so calling this on every knowledge save AND once during
 * hydration's self-heal (see hydrateProjectData) never creates a duplicate artifact or a new
 * version — it's the same (artifact_id, version 1) upsert target every time. Guarded to
 * guided_engineering projects; Quick Build never calls `updateProjectKnowledge` at all, but
 * this is a cheap, explicit second safety net.
 */
function syncRequirementsArtifact(projectId: string, project: Project): void {
  if (project.projectType !== 'guided_engineering') {
    return;
  }

  const knowledge = project.projectKnowledge;

  if (!isRequirementsCaptured(knowledge)) {
    return;
  }

  const artifacts = getProjectArtifacts(project);
  const existing = getLatestArtifact(artifacts, ARTIFACT_TYPES.REQUIREMENTS_DRAFT);

  if (existing && !isSyncedRequirementsArtifact(existing, projectId)) {
    // A real AI-generated Requirements Draft already exists — it stays authoritative.
    return;
  }

  const synced = createSyncedRequirementsArtifact(projectId, knowledge!);

  if (!existing) {
    addProjectArtifact(projectId, synced, 'automatic');
    return;
  }

  if (existing.content === synced.content && existing.status === 'approved') {
    return; // nothing actually changed — avoid a needless write/activity entry on every save or reopen
  }

  updateProjectArtifact(projectId, existing.id, { content: synced.content, status: 'approved' }, 'automatic');
}

/**
 * Phase 2 Sprint 9 — merge partial Project Knowledge into a project and
 * persist it via the ProjectRepository (see app/lib/builders-db/), same
 * pattern as setRoadmapItemStatus/addProject. A shallow merge is
 * intentional: array fields (coreFeatures, pagesOrScreens, etc.) are
 * replaced wholesale by whatever the Requirements dialog submits, not
 * appended to — the dialog always sends the full current field list.
 */
export function updateProjectKnowledge(projectId: string, partialKnowledge: Partial<ProjectKnowledge>): void {
  const next = projectsStore.get().map((project) =>
    project.id === projectId
      ? {
          ...project,
          projectKnowledge: {
            ...project.projectKnowledge,
            ...partialKnowledge,
          },
        }
      : project,
  );
  projectsStore.set(next);
  projectRepository.updateKnowledge(next);

  const updated = next.find((project) => project.id === projectId);

  if (updated) {
    mirrorToBuildersDb(() => buildersDbRepository.updateProject(updated));
    syncRequirementsArtifact(projectId, updated);
  }
}

/**
 * Phase 2 Sprint 9 — remove all captured Project Knowledge from a project,
 * reverting it to the empty-state ("No requirements captured yet."). Local
 * store only, does not touch chats, GitHub, Supabase, or IndexedDB.
 */
export function clearProjectKnowledge(projectId: string): void {
  const next = projectsStore.get().map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const { projectKnowledge: _removed, ...rest } = project;

    return rest;
  });
  projectsStore.set(next);
  projectRepository.updateKnowledge(next);

  const updated = next.find((project) => project.id === projectId);

  if (updated) {
    mirrorToBuildersDb(() => buildersDbRepository.updateProject(updated));
  }
}

/** Sprint 28 — a project's generation session (see app/lib/projects/generationSessionEngine.ts). Undefined until one is explicitly created and persisted. */
export function getGenerationSession(project: Project): GenerationSession | undefined {
  return project.generationSession;
}

/**
 * Sprint 28 — persists a generation session snapshot. Uses the
 * ProjectRepository's generic saveProjects() (see app/lib/builders-db/) —
 * every other "update" / "save" method on that interface is already an
 * alias for the same "write the whole project list" operation, so this
 * adds no new repository surface. Nothing calls this yet; it exists so a
 * future sprint's Start/Pause/Resume/Cancel actions have a setter ready to
 * call.
 */
export function setGenerationSession(projectId: string, session: GenerationSession | undefined): void {
  const next = projectsStore
    .get()
    .map((project) => (project.id === projectId ? { ...project, generationSession: session } : project));
  projectsStore.set(next);
  projectRepository.saveProjects(next);

  const updated = next.find((project) => project.id === projectId);

  if (updated) {
    mirrorToBuildersDb(() => buildersDbRepository.updateProject(updated));
  }
}

/**
 * Sprint 39.7 — links a quick_build project to its IndexedDB chat (see
 * app/lib/persistence/useChatHistory.ts's storeMessageHistory, which calls this once when
 * the chat's raw id is minted and again once its urlId resolves). Persisted the same way
 * as every other Project field — local write-through instantly, BuildersDB mirror
 * best-effort (folded into the metadata jsonb via toProjectRow's METADATA_FIELDS).
 */
export function linkProjectChat(projectId: string, chatMixedId: string): void {
  const next = projectsStore
    .get()
    .map((project) => (project.id === projectId ? { ...project, linkedChatId: chatMixedId } : project));
  projectsStore.set(next);
  projectRepository.saveProjects(next);

  const updated = next.find((project) => project.id === projectId);

  if (updated) {
    mirrorToBuildersDb(() => buildersDbRepository.updateProject(updated));
  }
}

/**
 * Sprint 42 (PART 1 — `last_opened_at`). Fire-and-forget, BuildersDB-only (no local field, no
 * UI reads this yet) — called from HomeDashboardSections.tsx's openProject() when a project is
 * opened from Home Dashboard's "Continue Working"/"Recent Projects" sections.
 */
export function touchProjectLastOpened(projectId: string): void {
  mirrorToBuildersDb(() => buildersDbRepository.touchLastOpened(projectId));
}

export const PROJECT_COLOR_OPTIONS = ['purple', 'blue', 'green', 'orange', 'pink', 'teal', 'amber'] as const;
export const PROJECT_ICON_OPTIONS = ['🚀', '🏪', '🤖', '🌐', '📱', '💼', '🧪', '⚙️', '📊', '🎨'] as const;
