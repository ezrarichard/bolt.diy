/**
 * Discovery AI Engine — Sprint 57. Barrel export; see `discoveryAiEngine.ts` for the module's
 * architecture/design rationale.
 */
export { runDiscoveryAiEngine } from './discoveryAiEngine';
export { buildInterviewDiscoveryContext, type InterviewContextInput } from './contextBuilder';
export type {
  CandidateFact,
  Contradiction,
  DiscoveryAiEngineResult,
  DiscoveryContext,
  DiscoverySourceType,
  ExtractedFact,
  GenerateTextFn,
  GenerateTextResult,
  RejectedFact,
} from './types';
