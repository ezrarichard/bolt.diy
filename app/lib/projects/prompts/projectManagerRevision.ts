import { extractJsonPayload } from '~/lib/projects/draftParsing';
import { formatDraftFields } from './shared';
import { REQUIREMENTS_DRAFT_FIELDS, type RequirementsDraft } from './requirements';

/**
 * AI Project Manager Chat — Project Definition revision prompt.
 *
 * Powers the Project Definition workspace's chat: the user asks for a change ("Remove
 * online payment", "Move Inventory to Phase 2"), and the AI Project Manager returns a
 * conversational reply plus ONLY the Project Definition fields that actually changed —
 * every other field is left untouched by the caller (businessAnalystEngine.ts's
 * `createRevisedDraftArtifact` merges `updatedFields` onto the previous version rather than
 * replacing it), so unaffected sections survive a revision unchanged without a second full
 * regeneration call.
 *
 * Deliberately reuses `RequirementsDraft`/`REQUIREMENTS_DRAFT_FIELDS` from
 * prompts/requirements.ts rather than introducing a second schema — "Project Definition" is
 * this same shape's user-facing name (see projectDefinition.ts's header comment).
 */

export interface ProjectManagerChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const PROJECT_MANAGER_CHAT_SYSTEM_PROMPT = `You are the AI Project Manager inside Builders, an AI Software Factory. You work with the customer to collaboratively refine their Project Definition (a structured product requirements document) through conversation.

Your ONLY responsibility is maintaining the Project Definition. You must NEVER:
- Design or describe a software architecture, database schema, API, or file structure.
- Write or suggest code in any language or framework.
- Produce UI/UX designs, backend/frontend implementation details, QA test plans, DevOps configuration, or a Product Package.
If the user asks for any of the above, politely explain that the Engineering Team will handle that once the Project Definition is approved, and redirect the conversation back to defining requirements.

How to make a revision — analyze the WHOLE document, not just the literal request:
1. Read the ENTIRE current Project Definition below before answering, not just the section the user's message obviously refers to.
2. Determine every section that would become INCONSISTENT if you only changed the literal, directly-requested field. A change rarely stays contained to one field — e.g. removing a feature can also require updates to Functional Requirements, Modules, Pages, User Flows, Acceptance Criteria, Business Goals, and Out of Scope wherever that feature is mentioned or assumed. List every such section's key in "affectedSections".
3. For every key in "affectedSections", regenerate that field's COMPLETE value in "updatedFields" (the full replacement text or full replacement list for that field, never a diff or partial fragment) so the resulting document is internally consistent end to end. Do not perform a narrow, isolated single-field edit that leaves another section contradicting it.
4. Every field NOT in "affectedSections" is left exactly as it was — never restate or duplicate unaffected fields in "updatedFields".
5. Write "reply" as a short, professional message back to the user, like a real Project Manager confirming what changed (1-4 sentences). Do not restate the entire document in "reply".
6. Write "changeSummary" as one concise sentence describing the net change, for a version history entry (e.g. "Removed online payment support and moved it to Out of Scope").
7. If the user's message is a question or doesn't require any change, return empty "affectedSections"/"updatedFields" and still write a helpful "reply".
8. Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const RESPONSE_JSON_SHAPE = `{
  "reply": string,
  "changeSummary": string,
  "affectedSections": string[], // every field key (see below) you determined needed to change to stay consistent
  "updatedFields": {
    // include ONLY the keys listed in "affectedSections", using the exact same shape as the Project Definition fields
${REQUIREMENTS_DRAFT_FIELDS.filter((field) => field.kind !== 'decisions')
  .map((field) => `    // "${field.key}": ${field.kind === 'list' ? 'string[]' : 'string'}`)
  .join('\n')}
  }
}`;

function formatChatHistory(history: ProjectManagerChatTurn[]): string {
  if (history.length === 0) {
    return 'No prior conversation.';
  }

  return history
    .map((turn) => `${turn.role === 'user' ? 'Customer' : 'AI Project Manager'}: ${turn.content}`)
    .join('\n');
}

export function buildProjectManagerRevisionPrompt(
  currentDraft: RequirementsDraft,
  chatHistory: ProjectManagerChatTurn[],
  userMessage: string,
): { system: string; prompt: string } {
  const prompt = `Current Project Definition:
${formatDraftFields(currentDraft, REQUIREMENTS_DRAFT_FIELDS)}

Recent conversation (most recent last, may be truncated):
${formatChatHistory(chatHistory.slice(-10))}

Customer's new message: ${userMessage}

Respond with ONLY a JSON object with exactly this shape (comments are for your reference only, do not include them in the response):

${RESPONSE_JSON_SHAPE}`;

  return { system: PROJECT_MANAGER_CHAT_SYSTEM_PROMPT, prompt };
}

export type ParsedRevisionResponse =
  | {
      ok: true;
      reply: string;
      changeSummary: string;

      /** Field keys the AI Project Manager determined needed to change to keep the document internally consistent — see the system prompt's "How to make a revision" steps. Purely for traceability (shown in Version History / the Summary panel); `updatedFields` is what's actually merged. */
      affectedSections: string[];
      updatedFields: Partial<RequirementsDraft>;
    }
  | { ok: false; error: string };

const REVISABLE_FIELDS = REQUIREMENTS_DRAFT_FIELDS.filter((field) => field.kind !== 'decisions');

/** Parses the AI Project Manager's raw chat response, validating `updatedFields` field-by-field the same way parseStructuredDraft does for a full draft (silently drops anything malformed rather than failing the whole response). */
export function parseProjectManagerRevisionResponse(rawText: string): ParsedRevisionResponse {
  const payload = extractJsonPayload(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, error: 'The AI Project Manager response was not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The AI Project Manager response was not a JSON object.' };
  }

  const source = parsed as Record<string, unknown>;
  const reply = typeof source.reply === 'string' ? source.reply.trim() : '';

  if (!reply) {
    return { ok: false, error: 'The AI Project Manager response was missing a reply.' };
  }

  const changeSummary = typeof source.changeSummary === 'string' ? source.changeSummary.trim() : '';
  const validKeys = new Set<string>(REVISABLE_FIELDS.map((field) => field.key));
  const affectedSections = Array.isArray(source.affectedSections)
    ? source.affectedSections.filter((key): key is string => typeof key === 'string' && validKeys.has(key))
    : [];

  const rawUpdatedFields =
    source.updatedFields && typeof source.updatedFields === 'object' && !Array.isArray(source.updatedFields)
      ? (source.updatedFields as Record<string, unknown>)
      : {};

  const updatedFields: Partial<RequirementsDraft> = {};

  for (const field of REVISABLE_FIELDS) {
    const value = rawUpdatedFields[field.key];

    if (field.kind === 'list') {
      if (Array.isArray(value)) {
        const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

        if (items.length > 0) {
          (updatedFields as Record<string, string[]>)[field.key] = items;
        }
      }
    } else if (typeof value === 'string' && value.trim().length > 0) {
      (updatedFields as Record<string, string>)[field.key] = value.trim();
    }
  }

  /*
   * The AI's own "affectedSections" list is advisory (used for traceability in Version
   * History/the Summary panel) — the actual merge is always driven by whatever keys really
   * came back in "updatedFields" (validated above), so a field the AI forgot to list here but
   * still sent a real value for is never silently dropped.
   */
  const effectiveAffectedSections = Array.from(new Set([...affectedSections, ...Object.keys(updatedFields)]));

  return {
    ok: true,
    reply,
    changeSummary: changeSummary || 'Project Definition updated.',
    affectedSections: effectiveAffectedSections,
    updatedFields,
  };
}
