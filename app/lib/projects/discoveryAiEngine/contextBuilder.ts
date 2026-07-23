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
