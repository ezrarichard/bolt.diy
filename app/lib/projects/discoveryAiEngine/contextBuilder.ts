import { INTERVIEW_QUESTION_TEMPLATES } from '~/lib/projects/discoveryAgent';
import type { BusinessUnderstandingModel, DiscoveryDimension } from '~/lib/projects/requirementsSession';
import type { DiscoveryContext } from './types';

/**
 * Context Builder — Sprint 57, Part 2.
 *
 * One function per Discovery source, each producing the same `DiscoveryContext` shape
 * (`types.ts`) so `discoveryAiEngine.ts` never needs to know or care which source produced it.
 * Only `buildInterviewDiscoveryContext` is implemented in this sprint — it's the only source
 * with a real caller (`requirementsSessionOrchestrator.ts`). Document/Website/Voice/Meeting/CRM
 * adapters (Builders Discovery Experience master spec §2/§12) each get their own sibling builder
 * function here when their sprint arrives; per Part 11, none of them require touching this
 * file's existing exports, `discoveryAiEngine.ts`, or any pipeline stage — only adding a new
 * function that fills in the same `DiscoveryContext` fields from a different raw input.
 */

export interface InterviewContextInput {
  projectId: string;
  sessionId: string;
  model: BusinessUnderstandingModel;
  dimension: DiscoveryDimension;
  answerMessageId: string;
  answerText: string;
}

export function buildInterviewDiscoveryContext(input: InterviewContextInput): DiscoveryContext {
  return {
    sourceType: 'interview',
    sourceRef: { type: 'session_message', id: input.answerMessageId },
    projectId: input.projectId,
    sessionId: input.sessionId,
    currentModel: input.model,
    rawText: input.answerText,
    askedDimension: input.dimension,
    questionText: INTERVIEW_QUESTION_TEMPLATES[input.dimension],
  };
}

/**
 * Sprint 58 — Business Knowledge Completion (Document Discovery). Sibling to
 * `buildInterviewDiscoveryContext`, per this file's own Part 11 extensibility note: no other
 * pipeline stage needs to change for a new source, only a new function here that fills in the
 * same `DiscoveryContext` fields from a different raw input. Not conversational, so
 * `askedDimension`/`questionText` are left unset — `buildDiscoveryFactExtractionPrompt` already
 * treats both as optional.
 */
export interface DocumentContextInput {
  projectId: string;
  sessionId: string;
  model: BusinessUnderstandingModel;
  documentMessageId: string;
  documentText: string;
}

export function buildDocumentDiscoveryContext(input: DocumentContextInput): DiscoveryContext {
  return {
    sourceType: 'document',
    sourceRef: { type: 'document_paragraph', id: input.documentMessageId },
    projectId: input.projectId,
    sessionId: input.sessionId,
    currentModel: input.model,
    rawText: input.documentText,
  };
}
