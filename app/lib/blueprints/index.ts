/**
 * Public entry point for the blueprint module.
 *
 * Import from `~/lib/blueprints` (this file) — never from
 * `~/lib/blueprints/registry` or `~/lib/blueprints/engine` directly.
 * `blueprintEngine` is the only way to read blueprint data; the raw
 * registry array and its default-id constant are intentionally not
 * re-exported here, so the registry's internal storage can change later
 * without touching any consumer.
 */
export { blueprintEngine, hydrateBlueprints } from './engine';
export type {
  ProjectBlueprint,
  BlueprintCategory,
  BlueprintRecommendation,
  BlueprintSystemPrompt,
  BlueprintStarterTemplate,
  BlueprintSuggestedEnvironmentVariable,
  SuggestedPaymentProvider,
  RoadmapItem,
  RoadmapItemStatus,
} from './types';
