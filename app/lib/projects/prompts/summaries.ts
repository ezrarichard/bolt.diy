import type { ProjectKnowledge } from '~/lib/projects/knowledge';
import type { ArchitectureDraft } from './architecture';
import type { DatabaseDraft } from './database';
import type { UIUXDraft } from './uiux';
import type { BackendDraft } from './backend';
import type { FrontendDraft } from './frontend';
import type { QADraft } from './qa';
import type { DevOpsDraft } from './devops';
import { formatList, formatProjectKnowledge } from './shared';

/**
 * Deterministic, AI-free draft summarizers — originally Sprint 17
 * (app/lib/projects/contextEngine.ts), relocated here in Sprint 32 so every
 * `prompts/*.ts` file can use them directly without an import cycle
 * (contextEngine.ts already imports each prompt file's `*_DRAFT_FIELDS`/
 * Draft type; a prompt file importing a summarizer back from contextEngine.ts
 * would cycle). contextEngine.ts re-exports everything below unchanged so
 * its existing public shape doesn't move.
 *
 * Each picks a handful of the most decision-relevant fields from an
 * approved draft rather than dumping every field (that's what
 * `formatDraftFields` in shared.ts does, for the roles that need a given
 * upstream draft in full). Used by later-stage prompt builders (backend.ts,
 * frontend.ts, qa.ts, devops.ts) to describe an upstream role that isn't
 * the *immediately* preceding one — see each prompt file's own comments for
 * which upstream roles get full content vs. a summary, and the Sprint 32
 * "Context Chain" anti-duplication guidance this exists to serve.
 */

/** Accepts `x?.length && \`text\`` expressions directly — that pattern types as `string | number`, not `string | false`, since `.length` is a number. */
function joinTruthy(lines: (string | number | false | undefined)[]): string | undefined {
  const filtered = lines.filter((line): line is string => typeof line === 'string' && line.length > 0);
  return filtered.length > 0 ? filtered.join('\n') : undefined;
}

/**
 * "Requirements" in this codebase means Project Knowledge — the
 * Requirements Draft artifact only ever folds into Project Knowledge on
 * approval (see businessAnalystEngine.summarizeRequirements), so this
 * summarizer wraps the same `formatProjectKnowledge` helper every other
 * engine already uses to describe it.
 */
export function summarizeRequirements(knowledge: ProjectKnowledge | undefined): string {
  return formatProjectKnowledge(knowledge);
}

export function summarizeArchitecture(draft: ArchitectureDraft | undefined): string {
  if (!draft) {
    return 'No approved Architecture Draft yet.';
  }

  return (
    joinTruthy([
      draft.architectureSummary && `Summary: ${draft.architectureSummary}`,
      draft.applicationModules?.length && `Modules: ${formatList(draft.applicationModules)}`,
      draft.backendArchitecture && `Backend: ${draft.backendArchitecture}`,
      draft.databaseArchitecture && `Database: ${draft.databaseArchitecture}`,
      draft.integrations?.length && `Integrations: ${formatList(draft.integrations)}`,
      draft.deploymentArchitecture && `Deployment: ${draft.deploymentArchitecture}`,
    ]) ?? 'No approved Architecture Draft yet.'
  );
}

export function summarizeDatabase(draft: DatabaseDraft | undefined): string {
  if (!draft) {
    return 'No approved Database Design Draft yet.';
  }

  return (
    joinTruthy([
      draft.databaseOverview && `Overview: ${draft.databaseOverview}`,
      draft.entities?.length && `Entities: ${formatList(draft.entities)}`,
      draft.relationships?.length && `Relationships: ${formatList(draft.relationships)}`,
      draft.multiTenantStrategy && `Multi-tenant: ${draft.multiTenantStrategy}`,
      draft.securityModel && `Security: ${draft.securityModel}`,
    ]) ?? 'No approved Database Design Draft yet.'
  );
}

export function summarizeUIUX(draft: UIUXDraft | undefined): string {
  if (!draft) {
    return 'No approved UI/UX Draft yet.';
  }

  return (
    joinTruthy([
      draft.designVision && `Vision: ${draft.designVision}`,
      draft.userFlows?.length && `User flows: ${formatList(draft.userFlows)}`,
      draft.screenHierarchy?.length && `Screens: ${formatList(draft.screenHierarchy)}`,
      draft.navigationStructure && `Navigation: ${draft.navigationStructure}`,
      draft.componentLibrary?.length && `Components: ${formatList(draft.componentLibrary)}`,
    ]) ?? 'No approved UI/UX Draft yet.'
  );
}

export function summarizeBackend(draft: BackendDraft | undefined): string {
  if (!draft) {
    return 'No approved Backend Draft yet.';
  }

  return (
    joinTruthy([
      draft.backendOverview && `Overview: ${draft.backendOverview}`,
      draft.apiArchitecture && `API architecture: ${draft.apiArchitecture}`,
      draft.apiEndpoints?.length && `Endpoints: ${formatList(draft.apiEndpoints)}`,
      draft.authenticationFlow && `Authentication: ${draft.authenticationFlow}`,
      draft.externalIntegrations?.length && `Integrations: ${formatList(draft.externalIntegrations)}`,
    ]) ?? 'No approved Backend Draft yet.'
  );
}

export function summarizeFrontend(draft: FrontendDraft | undefined): string {
  if (!draft) {
    return 'No approved Frontend Draft yet.';
  }

  return (
    joinTruthy([
      draft.frontendOverview && `Overview: ${draft.frontendOverview}`,
      draft.pageHierarchy?.length && `Pages: ${formatList(draft.pageHierarchy)}`,
      draft.apiIntegrationStrategy && `API integration: ${draft.apiIntegrationStrategy}`,
      draft.stateManagement && `State management: ${draft.stateManagement}`,
      draft.authenticationUX && `Authentication UX: ${draft.authenticationUX}`,
    ]) ?? 'No approved Frontend Draft yet.'
  );
}

export function summarizeQA(draft: QADraft | undefined): string {
  if (!draft) {
    return 'No approved QA Draft yet.';
  }

  return (
    joinTruthy([
      draft.qaOverview && `Overview: ${draft.qaOverview}`,
      draft.qualityObjectives?.length && `Quality objectives: ${formatList(draft.qualityObjectives)}`,
      draft.acceptanceCriteria?.length && `Acceptance criteria: ${formatList(draft.acceptanceCriteria)}`,
      draft.knownQualityRisks?.length && `Known risks: ${formatList(draft.knownQualityRisks)}`,
    ]) ?? 'No approved QA Draft yet.'
  );
}

export function summarizeDevOps(draft: DevOpsDraft | undefined): string {
  if (!draft) {
    return 'No approved DevOps Draft yet.';
  }

  return (
    joinTruthy([
      draft.devopsOverview && `Overview: ${draft.devopsOverview}`,
      draft.deploymentStrategy && `Deployment: ${draft.deploymentStrategy}`,
      draft.hostingRecommendation && `Hosting: ${draft.hostingRecommendation}`,
      draft.buildersDbStrategy && `BuildersDB: ${draft.buildersDbStrategy}`,
      draft.applicationDatabaseStrategy && `Application database: ${draft.applicationDatabaseStrategy}`,
    ]) ?? 'No approved DevOps Draft yet.'
  );
}
