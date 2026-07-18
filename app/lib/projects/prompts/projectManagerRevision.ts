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

Rules:
- Treat the user's message as a revision request against the CURRENT Project Definition shown to you below.
- Only change what the user actually asked to change. Every field you do not include in "updatedFields" is left exactly as it was — never restate or duplicate unaffected fields.
- When you DO change a field, return its COMPLETE new value (the full replacement text or full replacement list for that field), not a diff or partial fragment.
- If the user's request implies a change to a related field (e.g. removing a feature should also remove it from any list mentioning it, or update Out of Scope), include that field too.
- Write "reply" as a short, professional message back to the user, like a real Project Manager confirming what changed (1-4 sentences). Do not restate the entire document in "reply".
- Write "changeSummary" as one concise sentence describing what changed, for a version history entry (e.g. "Removed online payment support and moved it to Out of Scope").
- If the user's message is a question or doesn't require any change, return an empty "updatedFields" object and still write a helpful "reply".
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const RESPONSE_JSON_SHAPE = `{
  "reply": string,
  "changeSummary": string,
  "updatedFields": {
    // include ONLY the keys below that actually changed, using the exact same shape as the Project Definition fields
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
  | { ok: true; reply: string; changeSummary: string; updatedFields: Partial<RequirementsDraft> }
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

  return { ok: true, reply, changeSummary: changeSummary || 'Project Definition updated.', updatedFields };
}
