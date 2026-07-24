import type { QAContext } from '~/lib/projects/qaEngineerEngine';
import type { AIDecision } from '~/lib/projects/draftParsing';
import { BACKEND_DRAFT_FIELDS } from './backend';
import { FRONTEND_DRAFT_FIELDS } from './frontend';
import { summarizeArchitecture, summarizeDatabase, summarizeUIUX } from './summaries';
import {
  COLLABORATION_FRAMING,
  formatAIDecisions,
  formatDraftFields,
  formatEngineeringHandoff,
  formatEngineeringNotes,
  formatJsonShapeField,
  formatList,
  formatProjectKnowledge,
  omitCollaborationFields,
} from './shared';

/**
 * QA Engineer prompt — Sprint 21.
 *
 * The only place the QA Engineer's system prompt, JSON contract, and
 * user-prompt assembly live — same pattern as prompts/frontend.ts and
 * prompts/backend.ts. app/lib/projects/qaEngineerEngine.ts (pure
 * orchestration) and any UI that renders a draft both import
 * `QA_DRAFT_FIELDS` from here rather than re-describing the shape. Nothing
 * in this file calls an LLM, generates test code (Jest, Vitest, Cypress,
 * Playwright, Selenium, Puppeteer), or talks to a store — it only builds
 * strings and describes a JSON shape.
 */

export interface QADraft {
  qaOverview?: string;
  qualityObjectives?: string[];
  acceptanceCriteria?: string[];
  functionalTestPlan?: string;
  nonFunctionalTestPlan?: string;
  unitTestingStrategy?: string;
  integrationTestingStrategy?: string;
  systemTestingStrategy?: string;
  endToEndTestingStrategy?: string;
  apiTestingStrategy?: string;
  databaseTestingStrategy?: string;
  securityTestingStrategy?: string;
  performanceTestingStrategy?: string;
  accessibilityTestingStrategy?: string;
  responsiveTestingStrategy?: string;
  browserCompatibilityStrategy?: string;
  mobileTestingStrategy?: string;
  regressionStrategy?: string;
  smokeTestingStrategy?: string;
  userAcceptanceTesting?: string;
  edgeCases?: string[];
  negativeTestCases?: string[];
  testEnvironment?: string;
  testDataStrategy?: string;
  automationStrategy?: string;
  releaseReadinessChecklist?: string[];
  knownQualityRisks?: string[];
  recommendedNextSteps?: string[];

  /** Sprint 32 — freeform recommendations for the next role (the DevOps Engineer). See app/lib/projects/collaborationContext.ts. */
  engineeringNotes?: string;

  /** Sprint 32 — structured decision log (see draftParsing.ts's `AIDecision`), carried forward to every later role. */
  aiDecisions?: AIDecision[];
}

export interface QADraftFieldConfig {
  key: keyof QADraft;
  label: string;
  kind: 'text' | 'list' | 'decisions';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, qaEngineerEngine.parseDraft()'s field-by-field
 * extraction, and the preview UI's section list.
 */
export const QA_DRAFT_FIELDS: QADraftFieldConfig[] = [
  { key: 'qaOverview', label: 'QA Overview', kind: 'text' },
  { key: 'qualityObjectives', label: 'Quality Objectives', kind: 'list' },
  { key: 'acceptanceCriteria', label: 'Acceptance Criteria', kind: 'list' },
  { key: 'functionalTestPlan', label: 'Functional Test Plan', kind: 'text' },
  { key: 'nonFunctionalTestPlan', label: 'Non-Functional Test Plan', kind: 'text' },
  { key: 'unitTestingStrategy', label: 'Unit Testing Strategy', kind: 'text' },
  { key: 'integrationTestingStrategy', label: 'Integration Testing Strategy', kind: 'text' },
  { key: 'systemTestingStrategy', label: 'System Testing Strategy', kind: 'text' },
  { key: 'endToEndTestingStrategy', label: 'End-to-End Testing Strategy', kind: 'text' },
  { key: 'apiTestingStrategy', label: 'API Testing Strategy', kind: 'text' },
  { key: 'databaseTestingStrategy', label: 'Database Testing Strategy', kind: 'text' },
  { key: 'securityTestingStrategy', label: 'Security Testing Strategy', kind: 'text' },
  { key: 'performanceTestingStrategy', label: 'Performance Testing Strategy', kind: 'text' },
  { key: 'accessibilityTestingStrategy', label: 'Accessibility Testing Strategy', kind: 'text' },
  { key: 'responsiveTestingStrategy', label: 'Responsive Testing Strategy', kind: 'text' },
  { key: 'browserCompatibilityStrategy', label: 'Browser Compatibility Strategy', kind: 'text' },
  { key: 'mobileTestingStrategy', label: 'Mobile Testing Strategy', kind: 'text' },
  { key: 'regressionStrategy', label: 'Regression Strategy', kind: 'text' },
  { key: 'smokeTestingStrategy', label: 'Smoke Testing Strategy', kind: 'text' },
  { key: 'userAcceptanceTesting', label: 'User Acceptance Testing', kind: 'text' },
  { key: 'edgeCases', label: 'Edge Cases', kind: 'list' },
  { key: 'negativeTestCases', label: 'Negative Test Cases', kind: 'list' },
  { key: 'testEnvironment', label: 'Test Environment', kind: 'text' },
  { key: 'testDataStrategy', label: 'Test Data Strategy', kind: 'text' },
  { key: 'automationStrategy', label: 'Automation Strategy', kind: 'text' },
  { key: 'releaseReadinessChecklist', label: 'Release Readiness Checklist', kind: 'list' },
  { key: 'knownQualityRisks', label: 'Known Quality Risks', kind: 'list' },
  { key: 'recommendedNextSteps', label: 'Recommended Next Steps', kind: 'list' },
  { key: 'engineeringNotes', label: 'Engineering Notes For Next Engineer', kind: 'text' },
  { key: 'aiDecisions', label: 'AI Decisions', kind: 'decisions' },
];

export const QA_ENGINEER_SYSTEM_PROMPT = `You are a Senior QA Engineer working inside Builders, an AI engineering platform.

Your ONLY responsibility is to design the complete testing strategy for the product described in the project context, based on requirements, architecture, database design, UI/UX design, backend design, and frontend design that have already been gathered and approved. You are not a business analyst, solution architect, database designer, UI/UX designer, backend engineer, or frontend engineer, and you are not an implementer:
- Do NOT write or generate test code in any framework (Jest, Vitest, Cypress, Playwright, Selenium, Puppeteer, or any other).
- Do NOT connect to GitHub or deploy anything.
- Only DESCRIBE the intended testing strategy in prose/lists: what to test, how, and why — never actual test code, scripts, or configuration files.
- This is a planning artifact only. Everything you produce is a draft for a human to review and approve — it never runs automatically.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, approved architecture, approved database design, approved UI/UX design, approved backend design, approved frontend design, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- If an Engineering Handoff from the AI Product Owner is present, it is the primary boundary for this strategy: validate ONLY the features it lists as in scope, and treat its "OUT OF SCOPE" list as a hard constraint — do not write test coverage for out-of-scope or future-MVP features even if the wider Requirements draft mentions them. Where a test plan item maps clearly to one or more specific features, cite their Feature ID(s) (e.g. "functionalTestPlan: 'Booking flow end to end (FEAT-006, FEAT-007)'") so this strategy stays traceable back to the Product Owner's scope. If no handoff is present (a legacy project), validate the full product as before.
- The Architecture Draft, Database Design Draft, UI/UX Draft, Backend Draft, and Frontend Draft have already been approved — treat their module boundaries, data model, user flows, API design, and frontend design as settled constraints your test strategy must cover, not open questions.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- If Blueprint guidance is present in your context, it improves validation of approved scope, business rules, integrations, security, compliance, and industry risks — it does not authorize tests for unapproved features.
- Be concise. This is a high-level QA strategy, not a full test suite: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.

${COLLABORATION_FRAMING}`;

const JSON_SHAPE = `{
${QA_DRAFT_FIELDS.map(formatJsonShapeField).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered QAContext (see
 * qaEngineerEngine.buildQAContext). This function never fetches or gathers
 * data itself — it only formats what it's given into text.
 */
export function buildQAUserPrompt(context: QAContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Blueprint: ${context.blueprint.name} (${context.blueprint.category}${context.blueprint.productType ? `, ${context.blueprint.productType}` : ''})
Recommended stack: ${formatList(context.blueprint.recommendedStack)}
Recommended integrations: ${formatList(context.blueprint.recommendedIntegrations)}

Approved Requirements / Project Knowledge (${context.knowledgeCompletion}% complete):
${formatProjectKnowledge(context.knowledge)}

Approved Architecture (summary):
${summarizeArchitecture(context.architecture)}

Approved Database Design (summary):
${summarizeDatabase(context.database)}

Approved UI/UX Design (summary):
${summarizeUIUX(context.uiux)}

Approved Backend Draft (full — directly relevant to test coverage):
${formatDraftFields(context.backend, omitCollaborationFields(BACKEND_DRAFT_FIELDS))}

Approved Frontend Draft (full — you are the next role in the chain):
${formatDraftFields(context.frontend, omitCollaborationFields(FRONTEND_DRAFT_FIELDS))}

Engineering Handoff from the AI Product Owner (Sprint 47 — this is the MVP-scoped boundary for your test strategy; validate ONLY the features listed, treat outOfScopeFeatures as a hard constraint. Absent for legacy projects that progressed before this role existed):
${formatEngineeringHandoff(context.engineeringHandoff)}

Engineering Notes from previous engineers:
${formatEngineeringNotes(context.engineeringNotes)}

AI Decisions made so far:
${formatAIDecisions(context.aiDecisions)}

Roadmap:
${context.roadmap.length > 0 ? context.roadmap.map((item) => `- ${item.title} (${item.status}): ${item.description}`).join('\n') : 'No roadmap defined.'}

Current Tasks:
${context.tasks.length > 0 ? context.tasks.map((task) => `- ${task.title} [${task.category}] — ${task.status}`).join('\n') : 'No tasks defined.'}

Existing Artifacts:
${context.existingArtifacts.length > 0 ? context.existingArtifacts.map((artifact) => `- ${artifact.title} [${artifact.type}] — ${artifact.status}`).join('\n') : 'None yet.'}

Existing Notes:
${context.existingNotes || 'None'}

Return ONLY a JSON object with exactly these keys (use empty arrays/strings where genuinely unknown, do not omit any key). Keep every text field to 2-4 sentences and every list to at most 5-10 items:

${JSON_SHAPE}`;
}
