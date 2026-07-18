import {
  appendProjectDefinitionChatMessage as appendProjectDefinitionChatMessageToMetadata,
  type Project,
} from '~/lib/stores/projects';
import type { ProjectDefinitionChatMessage } from './projectDefinition';

/**
 * Project Definition Chat persistence — kept abstract on purpose.
 *
 * The UI (ProjectDefinitionWorkspace.tsx) and business logic never read
 * `project.projectDefinitionChat` or call stores/projects.ts's
 * `appendProjectDefinitionChatMessage` directly — they only ever go through this
 * repository's `getMessages`/`appendMessage`. Today's only implementation
 * (`metadataProjectDefinitionChatRepository` below) happens to be backed by
 * `builders_projects.metadata` (see buildersDbTypes.ts's `METADATA_FIELDS` and
 * projectDefinition.ts's header comment), but nothing outside this file knows that.
 *
 * Moving persistence to its own BuildersDB table later (e.g. a
 * `builders_project_definition_chat` table, one row per message, for real pagination/
 * indexing instead of one growing JSON array) means writing a new
 * `ProjectDefinitionChatRepository` implementation and swapping the export at the bottom
 * of this file — the UI and businessAnalystEngine.ts never change. The only likely
 * follow-up at that point: `getMessages` would need to become async (a real table read
 * is a network call, unlike today's synchronous in-memory read) and callers would switch
 * from calling it inline to a small fetch-on-open + local state pattern, similar to how
 * `hydrateProjectData` already works for artifacts — but that's a future migration's
 * concern, not something this interface needs to pre-guess today.
 */
export interface ProjectDefinitionChatRepository {
  /** Every message for this project, oldest first. Synchronous today because the current backing store (`project.projectDefinitionChat`) is already in memory. */
  getMessages(project: Project): ProjectDefinitionChatMessage[];

  /** Appends one message and persists it (see appendProjectDefinitionChatMessage in stores/projects.ts for today's concrete behavior: in-memory + BuildersDB mirror). */
  appendMessage(projectId: string, message: ProjectDefinitionChatMessage): void;
}

/** Current implementation — backed by `Project.projectDefinitionChat` (folded into `builders_projects.metadata`). See this file's header comment for why callers should never reach for that field directly. */
export const metadataProjectDefinitionChatRepository: ProjectDefinitionChatRepository = {
  getMessages(project) {
    return project.projectDefinitionChat ?? [];
  },
  appendMessage(projectId, message) {
    appendProjectDefinitionChatMessageToMetadata(projectId, message);
  },
};

/**
 * The repository every caller should import. Swapping the backing implementation later
 * (e.g. to a dedicated table) means changing this one export, not any call site.
 */
export const projectDefinitionChatRepository: ProjectDefinitionChatRepository = metadataProjectDefinitionChatRepository;
