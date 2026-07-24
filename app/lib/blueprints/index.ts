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

// Sprint 60 — Blueprint Knowledge Foundation. See each module's own header comment.
export {
  BLUEPRINT_CONTENT_SCHEMA_VERSION,
  BLUEPRINT_CONTENT_SECTION_KEYS,
  SUPPORTED_BLUEPRINT_CONTENT_SCHEMA_VERSIONS,
} from './blueprintContentTypes';
export type { BlueprintContent, BlueprintContentSectionKey } from './blueprintContentTypes';
export {
  REQUIRED_BLUEPRINT_CONTENT_SECTIONS,
  isSupportedBlueprintContentSchemaVersion,
  validateBlueprintContent,
} from './blueprintContentValidation';
export type { BlueprintContentValidationResult } from './blueprintContentValidation';
export {
  BLUEPRINT_EXPORT_FORMAT_VERSION,
  exportBlueprint,
  exportBlueprints,
  importBlueprint,
  importBlueprints,
} from './blueprintPortability';
export type { BlueprintExportEnvelope, BlueprintImportResult } from './blueprintPortability';
