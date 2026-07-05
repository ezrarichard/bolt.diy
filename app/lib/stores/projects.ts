import { atom } from 'nanostores';
import type { RoadmapItemStatus } from '~/lib/blueprints';
import type { ProjectKnowledge } from '~/lib/projects/knowledge';
import type { ProjectTaskStatus } from '~/lib/projects/executionEngine';
import type { ProjectArtifact } from '~/lib/projects/artifacts';
import type {
  ReviewDecision,
  TaskHistoryEvent,
  TaskHistoryEventType,
  TaskReviewRecord,
} from '~/lib/projects/reviewEngine';
import type { GenerationSession } from '~/lib/projects/generationSessionEngine';
import { createProjectRepository } from '~/lib/builders-db/repositories/projectsRepository';

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

export const projectsStore = atom<Project[]>(projectRepository.loadProjects());

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

export function addProject(input: {
  name: string;
  icon: string;
  color: string;
  description?: string;
  blueprintId?: string;
}): Project {
  const project: Project = {
    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    description: input.description,
    icon: input.icon,
    color: input.color,
    blueprintId: input.blueprintId,
    createdAt: new Date().toISOString(),
  };

  projectsStore.set([...projectsStore.get(), project]);
  projectRepository.saveProject(project);

  return project;
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
  projectsStore.set(projectsStore.get().filter((project) => project.id !== projectId));
  projectRepository.deleteProject(projectId);

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
export function addProjectArtifact(projectId: string, artifact: ProjectArtifact): void {
  const next = projectsStore
    .get()
    .map((project) =>
      project.id === projectId ? { ...project, artifacts: [...(project.artifacts ?? []), artifact] } : project,
    );
  projectsStore.set(next);
  projectRepository.updateArtifacts(next);
}

/**
 * Sprint 13 — update fields on an existing artifact by id (status, content,
 * version, etc.), e.g. moving a Requirements Draft from 'draft' to
 * 'approved'/'discarded', or bumping its content+version on regenerate.
 * `updatedAt` is always refreshed. Persisted via the ProjectRepository (see
 * app/lib/builders-db/).
 */
export function updateProjectArtifact(projectId: string, artifactId: string, partial: Partial<ProjectArtifact>): void {
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
}

/**
 * Phase 2 Sprint 9 — read a project's Project Knowledge. Returns undefined
 * when nothing has been saved yet (see ProjectDashboard's empty state).
 */
export function getProjectKnowledge(project: Project): ProjectKnowledge | undefined {
  return project.projectKnowledge;
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
}

export const PROJECT_COLOR_OPTIONS = ['purple', 'blue', 'green', 'orange', 'pink', 'teal'] as const;
export const PROJECT_ICON_OPTIONS = ['🚀', '🏪', '🤖', '🌐', '📱', '💼', '🧪', '⚙️', '📊', '🎨'] as const;
