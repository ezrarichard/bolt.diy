import { atom } from 'nanostores';
import type { RoadmapItemStatus } from '~/lib/blueprints';
import type { ProjectKnowledge } from '~/lib/projects/knowledge';
import type { ProjectTaskStatus } from '~/lib/projects/executionEngine';
import type { ProjectArtifact } from '~/lib/projects/artifacts';

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
   * than written here. Local-only (localStorage via persist()), same as
   * the rest of Project — no backend, no IndexedDB.
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

const STORAGE_KEY = 'builder_projects';

/**
 * Sprint 9 — ids of the Sprint 1-era mock/demo projects (Builders Platform,
 * LocalShop India, AI Advertising, Company Website, Mobile App). They used
 * to be the in-memory fallback returned by loadProjects() whenever
 * localStorage was empty; because addProject() built new arrays off of
 * whatever loadProjects() returned, creating your very first real project
 * would silently persist these mock entries alongside it, making them look
 * like real user projects forever after. They are stripped out below (both
 * from the fallback and from anything already persisted) — this does not
 * touch blueprint definitions (app/lib/blueprints/registry.ts), which are
 * unrelated and still power the New Project blueprint picker.
 */
const LEGACY_MOCK_PROJECT_IDS = new Set([
  'proj-builders-platform',
  'proj-localshop-india',
  'proj-ai-advertising',
  'proj-company-website',
  'proj-mobile-app',
]);

function loadProjects(): Project[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored) {
      const parsed = JSON.parse(stored);

      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (project) => project && typeof project.id === 'string' && !LEGACY_MOCK_PROJECT_IDS.has(project.id),
        );

        if (cleaned.length !== parsed.length) {
          /*
           * One-time cleanup — re-persist without the legacy mock entries so
           * they don't reappear on the next load.
           */
          persist(cleaned);
        }

        return cleaned;
      }
    }
  } catch (error) {
    console.error('Failed to load projects from localStorage:', error);
  }

  return [];
}

export const projectsStore = atom<Project[]>(loadProjects());

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

function persist(projects: Project[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }
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

  const next = [...projectsStore.get(), project];
  projectsStore.set(next);
  persist(next);

  return project;
}

/**
 * Sprint 9 — remove a project from the local project store only.
 *
 * This never touches chat history/persistence, GitHub, Supabase, or any
 * deployment — it only filters projectsStore and re-persists to
 * localStorage, exactly like every other write in this file. If the
 * deleted project was the active one, the active-project selection (and
 * the Project Dashboard, if it happened to be open for this project) is
 * cleared so the UI doesn't end up pointing at a project that no longer
 * exists.
 */
export function deleteProject(projectId: string): void {
  const next = projectsStore.get().filter((project) => project.id !== projectId);
  projectsStore.set(next);
  persist(next);

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
 * Sprint 8 — set a roadmap item's status for a project. Local-only
 * (localStorage via the existing persist()), no backend, no IndexedDB.
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
  persist(next);
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
 * Sprint 11 — set a task's manual execution stage. Local-only (localStorage
 * via persist()), same pattern as setRoadmapItemStatus. Typically only
 * called with 'not-started' | 'in-progress' | 'needs-review' | 'completed'
 * (Start/Pause/Submit for Review/a future review-approval step) — 'ready'
 * and 'blocked' are normally left for executionEngine to compute.
 */
export function setTaskStatus(projectId: string, taskId: string, status: ProjectTaskStatus): void {
  const next = projectsStore
    .get()
    .map((project) =>
      project.id === projectId ? { ...project, taskStatus: { ...project.taskStatus, [taskId]: status } } : project,
    );
  projectsStore.set(next);
  persist(next);
}

/** Sprint 11 — read a task's notes. Defaults to '' when nothing has been saved yet. */
export function getTaskNotes(project: Project, taskId: string): string {
  return project.taskNotes?.[taskId] ?? '';
}

/**
 * Sprint 11 — save a task's notes. Local-only (localStorage via persist()),
 * same pattern as updateProjectKnowledge. Plain markdown text, not parsed
 * or sent anywhere — a future AI Project Manager is the intended reader.
 */
export function setTaskNotes(projectId: string, taskId: string, notes: string): void {
  const next = projectsStore
    .get()
    .map((project) =>
      project.id === projectId ? { ...project, taskNotes: { ...project.taskNotes, [taskId]: notes } } : project,
    );
  projectsStore.set(next);
  persist(next);
}

/** Sprint 11 — a project's artifacts (see app/lib/projects/artifacts.ts). Empty array when none exist yet. */
export function getProjectArtifacts(project: Project): ProjectArtifact[] {
  return project.artifacts ?? [];
}

/**
 * Sprint 11 — append an artifact to a project. Local-only (localStorage via
 * persist()). Nothing calls this yet — the architecture is ready for a
 * future AI generation sprint to create real artifacts via the same setter,
 * with no data-model change (see createPlaceholderArtifact in
 * app/lib/projects/artifacts.ts for building the placeholder shape).
 */
export function addProjectArtifact(projectId: string, artifact: ProjectArtifact): void {
  const next = projectsStore
    .get()
    .map((project) =>
      project.id === projectId ? { ...project, artifacts: [...(project.artifacts ?? []), artifact] } : project,
    );
  projectsStore.set(next);
  persist(next);
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
 * persist it. Local-only (localStorage via the existing persist()), same
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
  persist(next);
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
  persist(next);
}

export const PROJECT_COLOR_OPTIONS = ['purple', 'blue', 'green', 'orange', 'pink', 'teal'] as const;
export const PROJECT_ICON_OPTIONS = ['🚀', '🏪', '🤖', '🌐', '📱', '💼', '🧪', '⚙️', '📊', '🎨'] as const;
