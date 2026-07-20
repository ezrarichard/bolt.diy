import { ARTIFACT_TYPES, getApprovedArtifactContent, type ProjectArtifact } from './artifacts';
import type { AIDecision } from './draftParsing';

/**
 * Collaboration Context — Sprint 32 (AI Engineering Team Context Chain).
 *
 *   Business Analyst -> Solution Architect -> Database Engineer
 *     -> UX Engineer -> Backend Engineer -> Frontend Engineer
 *       -> QA Engineer -> DevOps Engineer
 *
 * Every role above now leaves two things behind for whoever comes next:
 * "Engineering Notes For Next Engineer" (free text) and "AI Decisions" (a
 * structured decision log — see `AIDecision` in draftParsing.ts). This file
 * is the one place that walks every upstream artifact type in order and
 * pulls those two things out — every `buildXContext` function (Solution
 * Architect onward) calls `gatherEngineeringNotes`/`gatherAIDecisions` once
 * rather than re-implementing "read every approved artifact type that
 * exists so far and extract its notes/decisions".
 *
 * Deliberately gathers from EVERY prior role, not just the immediately
 * preceding one — Engineering Notes and AI Decisions are the distilled,
 * cheap-to-carry knowledge the sprint's context-budget guidance calls out
 * as "always include regardless of budget", unlike full draft content
 * (which each engine's own buildXContext curates to only the directly
 * relevant upstream role(s) — see each engine file's header comment).
 */

export interface EngineeringNoteEntry {
  role: string;
  notes: string;
}

export interface AIDecisionEntry {
  role: string;
  decisions: AIDecision[];
}

interface DraftWithCollaboration {
  engineeringNotes?: string;
  aiDecisions?: AIDecision[];
}

/**
 * Fixed pipeline order — matches AUTO_ENGINEERING_ROLES (autoEngineeringEngine.ts) plus
 * Business Analyst/Requirements at the front.
 *
 * Exported (Sprint 35) so app/lib/ai/context/buildersDbContextProvider.ts can reuse the
 * exact same role order/labels when deciding which upstream BuildersDB role outputs are
 * relevant to a given role, instead of re-declaring this list a second time.
 */
export const ROLE_ARTIFACT_CHAIN: { type: string; role: string }[] = [
  { type: ARTIFACT_TYPES.REQUIREMENTS_DRAFT, role: 'Business Analyst' },

  /** Sprint 46B — Product Planning phase, inserted between Requirements and Engineering. See app/lib/projects/productOwnerEngine.ts. */
  { type: ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT, role: 'Product Owner' },
  { type: ARTIFACT_TYPES.ARCHITECTURE_DRAFT, role: 'Solution Architect' },
  { type: ARTIFACT_TYPES.DATABASE_DRAFT, role: 'Database Engineer' },
  { type: ARTIFACT_TYPES.UIUX_DRAFT, role: 'UX Engineer' },
  { type: ARTIFACT_TYPES.BACKEND_DRAFT, role: 'Backend Engineer' },
  { type: ARTIFACT_TYPES.FRONTEND_DRAFT, role: 'Frontend Engineer' },
  { type: ARTIFACT_TYPES.QA_DRAFT, role: 'QA Engineer' },
  { type: ARTIFACT_TYPES.DEVOPS_DRAFT, role: 'DevOps Engineer' },
];

/**
 * Every approved upstream role's Engineering Notes so far, in pipeline
 * order. `beforeRole` excludes that role and everything after it (a role
 * never reads its own not-yet-written notes, and never reads a later
 * role's — there is no later role approved yet in a sequential pipeline
 * anyway, but this keeps the function correct even if called speculatively).
 */
export function gatherEngineeringNotes(artifacts: ProjectArtifact[], beforeRole?: string): EngineeringNoteEntry[] {
  const cutoff = beforeRole ? ROLE_ARTIFACT_CHAIN.findIndex((entry) => entry.role === beforeRole) : -1;
  const chain = cutoff >= 0 ? ROLE_ARTIFACT_CHAIN.slice(0, cutoff) : ROLE_ARTIFACT_CHAIN;

  const entries: EngineeringNoteEntry[] = [];

  for (const { type, role } of chain) {
    const draft = getApprovedArtifactContent<DraftWithCollaboration>(artifacts, type);

    if (draft?.engineeringNotes) {
      entries.push({ role, notes: draft.engineeringNotes });
    }
  }

  return entries;
}

/** Same traversal as `gatherEngineeringNotes`, for the AI Decisions log instead. */
export function gatherAIDecisions(artifacts: ProjectArtifact[], beforeRole?: string): AIDecisionEntry[] {
  const cutoff = beforeRole ? ROLE_ARTIFACT_CHAIN.findIndex((entry) => entry.role === beforeRole) : -1;
  const chain = cutoff >= 0 ? ROLE_ARTIFACT_CHAIN.slice(0, cutoff) : ROLE_ARTIFACT_CHAIN;

  const entries: AIDecisionEntry[] = [];

  for (const { type, role } of chain) {
    const draft = getApprovedArtifactContent<DraftWithCollaboration>(artifacts, type);

    if (draft?.aiDecisions?.length) {
      entries.push({ role, decisions: draft.aiDecisions });
    }
  }

  return entries;
}

export const collaborationContext = {
  gatherEngineeringNotes,
  gatherAIDecisions,
};
