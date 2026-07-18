/**
 * Project Definition — approval + chat types.
 *
 * "Project Definition" is the user-facing name for what the codebase still models
 * internally as the Requirements Draft (see prompts/requirements.ts's `RequirementsDraft`
 * and businessAnalystEngine.ts — deliberately unrenamed to avoid a sweeping, risky rename
 * of an already-working engine/artifact type). This file only adds the two things that
 * didn't exist before: whether the user has approved the definition (gating the AI
 * Engineering Team's automatic pipeline — see autoEngineeringEngine.ts's
 * `isProjectDefinitionApproved`), and the AI Project Manager chat transcript.
 *
 * Both are persisted via BuildersDB's existing `builders_projects.metadata` jsonb
 * convention (see buildersDbTypes.ts's `METADATA_FIELDS`) — the same mechanism
 * `projectKnowledge`/`roadmapStatus` already use for "a Project field not worth its own
 * column yet." No schema migration needed.
 */

export type ProjectDefinitionApprovalStatus = 'pending' | 'approved';

export interface ProjectDefinitionApproval {
  status: ProjectDefinitionApprovalStatus;

  /** ISO timestamp of the approval action. Undefined while status is 'pending'. */
  approvedAt?: string;

  /** Authenticated user id who clicked "Approve Project Definition & Start Engineering". */
  approvedBy?: string;

  /** Display-name snapshot at approval time (an email, same as every other actor snapshot in this codebase — see getCurrentActor() in stores/projects.ts). */
  approvedByName?: string;
}

export interface ProjectDefinitionChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
