import type { Project } from '~/lib/stores/projects';
import type { ProjectKnowledge } from '~/lib/projects/knowledge';
import type { ProjectArtifact } from '~/lib/projects/artifacts';
import type { ProjectTaskStatus } from '~/lib/projects/executionEngine';
import type { TaskHistoryEvent, TaskReviewRecord } from '~/lib/projects/reviewEngine';
import type { ContextBundle } from '~/lib/projects/contextEngine';

/**
 * BuildersDB shared types — Sprint 18.
 *
 * "BuildersDB" is the name of the future Supabase project that will back
 * the Builders PLATFORM's own control-plane data (this project's Projects,
 * Knowledge, Artifacts, Tasks, Reviews). It is never the generated
 * application's database — that's an entirely separate, already-existing
 * concern (app/lib/stores/supabase.ts, app/lib/hooks/useSupabaseConnection.ts,
 * app/routes/api.supabase*.ts) that lets a user connect the product THEY are
 * building to ITS OWN Supabase project. Nothing in app/lib/builders-db/
 * talks to that system, and nothing in that system talks to this one.
 *
 * Every type below is a re-export of an existing model (Project,
 * ProjectKnowledge, ProjectArtifact, ProjectTaskStatus, TaskReviewRecord,
 * TaskHistoryEvent, ContextBundle) — nothing here redesigns them. The
 * persistence layer's job is to move the SAME data between the same shapes
 * and different storage backends, not to introduce a new schema.
 */
export type {
  Project,
  ProjectKnowledge,
  ProjectArtifact,
  ProjectTaskStatus,
  TaskHistoryEvent,
  TaskReviewRecord,
  ContextBundle,
};

/**
 * The repository interface every storage provider implements
 * (providers/localProvider.ts today; providers/supabaseProvider.ts as a
 * structural skeleton). Deliberately expresses only Builder concepts
 * ("save this project", "these are its updated tasks") — never a table
 * name, a SQL statement, or a Supabase-specific type. The Store
 * (app/lib/stores/projects.ts) is the only caller; nothing else should
 * import a provider directly.
 *
 * Every method is synchronous today because the only active provider
 * (Local) wraps a synchronous API (localStorage) and the Store's own public
 * functions (addProject, updateProjectKnowledge, ...) are relied on
 * throughout the app to update `projectsStore` synchronously before
 * returning. See docs/buildersdb.md's "Future migration plan" for why
 * converting this to an async (Promise-returning) interface — required
 * before the Supabase provider can do real network I/O — is deliberately
 * deferred to a later sprint rather than done here.
 *
 * `updateKnowledge`/`updateArtifacts`/`updateTasks`/`updateReviews` all take
 * the full, already-updated `Project[]` list (exactly what the Store's
 * existing `.map()`-based mutations already produce) rather than a partial
 * delta — for the Local provider this is a full overwrite either way, and a
 * future Supabase provider can still choose to update only the relevant
 * column(s) of the affected row(s) using whichever fields actually changed
 * on each `Project`. The distinct method names exist so a future backend
 * (or logging/auditing) can tell these operations apart; they are not
 * required to behave differently today.
 */
export interface ProjectRepository {
  loadProjects(): Project[];
  loadProject(projectId: string): Project | undefined;
  saveProject(project: Project): void;
  saveProjects(projects: Project[]): void;
  deleteProject(projectId: string): void;
  updateKnowledge(projects: Project[]): void;
  updateArtifacts(projects: Project[]): void;
  updateTasks(projects: Project[]): void;
  updateReviews(projects: Project[]): void;
}

/** Which storage backend is currently selected — see repositories/projectsRepository.ts's createProjectRepository(), the only place that decides. */
export type StorageProviderKind = 'local' | 'supabase';
