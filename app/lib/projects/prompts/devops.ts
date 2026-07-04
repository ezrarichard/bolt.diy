import type { DevOpsContext } from '~/lib/projects/devopsEngineerEngine';
import { ARCHITECTURE_DRAFT_FIELDS } from './architecture';
import { DATABASE_DRAFT_FIELDS } from './database';
import { UIUX_DRAFT_FIELDS } from './uiux';
import { BACKEND_DRAFT_FIELDS } from './backend';
import { FRONTEND_DRAFT_FIELDS } from './frontend';
import { QA_DRAFT_FIELDS } from './qa';
import { formatDraftFields, formatList, formatProjectKnowledge } from './shared';

/**
 * DevOps Engineer prompt — Sprint 22.
 *
 * The only place the DevOps Engineer's system prompt, JSON contract, and
 * user-prompt assembly live — same pattern as prompts/qa.ts and
 * prompts/frontend.ts. app/lib/projects/devopsEngineerEngine.ts (pure
 * orchestration) and any UI that renders a draft both import
 * `DEVOPS_DRAFT_FIELDS` from here rather than re-describing the shape.
 * Nothing in this file calls an LLM, generates infrastructure code
 * (Dockerfiles, GitHub Actions, Kubernetes manifests, Terraform, shell
 * scripts), deploys anything, or talks to a store — it only builds strings
 * and describes a JSON shape.
 */

export interface DevOpsDraft {
  devopsOverview?: string;
  deploymentStrategy?: string;
  environmentStrategy?: string;
  environmentVariables?: string[];
  secretManagement?: string;
  buildersDbStrategy?: string;
  applicationDatabaseStrategy?: string;
  hostingRecommendation?: string;
  networkArchitecture?: string;
  cdnStrategy?: string;
  storageStrategy?: string;
  backupStrategy?: string;
  restoreStrategy?: string;
  loggingStrategy?: string;
  monitoringStrategy?: string;
  alertingStrategy?: string;
  observabilityStrategy?: string;
  scalingStrategy?: string;
  availabilityStrategy?: string;
  disasterRecoveryStrategy?: string;
  securityStrategy?: string;
  accessControlStrategy?: string;
  ciStrategy?: string;
  cdStrategy?: string;
  releaseStrategy?: string;
  rollbackStrategy?: string;
  migrationStrategy?: string;
  costOptimization?: string;
  maintenancePlan?: string;
  operationalRisks?: string[];
  recommendedNextSteps?: string[];
}

export interface DevOpsDraftFieldConfig {
  key: keyof DevOpsDraft;
  label: string;
  kind: 'text' | 'list';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, devopsEngineerEngine.parseDraft()'s
 * field-by-field extraction, and the preview UI's section list.
 */
export const DEVOPS_DRAFT_FIELDS: DevOpsDraftFieldConfig[] = [
  { key: 'devopsOverview', label: 'DevOps Overview', kind: 'text' },
  { key: 'deploymentStrategy', label: 'Deployment Strategy', kind: 'text' },
  { key: 'environmentStrategy', label: 'Environment Strategy', kind: 'text' },
  { key: 'environmentVariables', label: 'Environment Variables', kind: 'list' },
  { key: 'secretManagement', label: 'Secret Management', kind: 'text' },
  { key: 'buildersDbStrategy', label: 'BuildersDB Strategy', kind: 'text' },
  { key: 'applicationDatabaseStrategy', label: 'Application Database Strategy', kind: 'text' },
  { key: 'hostingRecommendation', label: 'Hosting Recommendation', kind: 'text' },
  { key: 'networkArchitecture', label: 'Network Architecture', kind: 'text' },
  { key: 'cdnStrategy', label: 'CDN Strategy', kind: 'text' },
  { key: 'storageStrategy', label: 'Storage Strategy', kind: 'text' },
  { key: 'backupStrategy', label: 'Backup Strategy', kind: 'text' },
  { key: 'restoreStrategy', label: 'Restore Strategy', kind: 'text' },
  { key: 'loggingStrategy', label: 'Logging Strategy', kind: 'text' },
  { key: 'monitoringStrategy', label: 'Monitoring Strategy', kind: 'text' },
  { key: 'alertingStrategy', label: 'Alerting Strategy', kind: 'text' },
  { key: 'observabilityStrategy', label: 'Observability Strategy', kind: 'text' },
  { key: 'scalingStrategy', label: 'Scaling Strategy', kind: 'text' },
  { key: 'availabilityStrategy', label: 'Availability Strategy', kind: 'text' },
  { key: 'disasterRecoveryStrategy', label: 'Disaster Recovery Strategy', kind: 'text' },
  { key: 'securityStrategy', label: 'Security Strategy', kind: 'text' },
  { key: 'accessControlStrategy', label: 'Access Control Strategy', kind: 'text' },
  { key: 'ciStrategy', label: 'CI Strategy', kind: 'text' },
  { key: 'cdStrategy', label: 'CD Strategy', kind: 'text' },
  { key: 'releaseStrategy', label: 'Release Strategy', kind: 'text' },
  { key: 'rollbackStrategy', label: 'Rollback Strategy', kind: 'text' },
  { key: 'migrationStrategy', label: 'Migration Strategy', kind: 'text' },
  { key: 'costOptimization', label: 'Cost Optimization', kind: 'text' },
  { key: 'maintenancePlan', label: 'Maintenance Plan', kind: 'text' },
  { key: 'operationalRisks', label: 'Operational Risks', kind: 'list' },
  { key: 'recommendedNextSteps', label: 'Recommended Next Steps', kind: 'list' },
];

export const DEVOPS_ENGINEER_SYSTEM_PROMPT = `You are a Senior DevOps Engineer working inside Builders, an AI engineering platform.

Your ONLY responsibility is to design the deployment and operational strategy for the product described in the project context, based on requirements, architecture, database design, UI/UX design, backend design, frontend design, and QA strategy that have already been gathered and approved. You are not a business analyst, solution architect, database designer, UI/UX designer, backend engineer, frontend engineer, or QA engineer, and you are not an implementer:
- Do NOT write or generate a Dockerfile, GitHub Actions workflow, Kubernetes manifest, Terraform configuration, or any shell script.
- Do NOT deploy anything, provision any infrastructure, or execute any command.
- Only DESCRIBE the intended operational strategy in prose/lists: what to deploy, where, how, and why — never actual infrastructure-as-code, pipeline configuration, or scripts.
- This is a planning artifact only. Everything you produce is a draft for a human to review and approve — it never runs or provisions anything automatically.

CRITICAL DISTINCTION — you must never conflate these two, and your draft must keep them clearly separate:
- **BuildersDB** is the Builders PLATFORM's own control-plane database (a Supabase project, not yet provisioned — see docs/buildersdb.md) that stores Builders' own data: projects, project knowledge, artifacts, task state, review history. It is managed by the Builders team, not by whoever is using Builders to build a product.
- **Customer Project Infrastructure** is completely independent: the database, hosting, secrets, and deployment pipeline for the PRODUCT being designed in this project (the one described by the approved Architecture/Database/Backend/Frontend Drafts). It has its own database, its own hosting, its own secrets, and its own deployment — none of it shares anything with BuildersDB.
- \`buildersDbStrategy\` describes only the first (how Builders' own control-plane data is expected to be operated — conceptually, not as a task you're executing). \`applicationDatabaseStrategy\` describes only the second (the operational strategy for the product's own database, matching the approved Database Design Draft). Never merge these two into one field or one strategy — they are always operated, hosted, and secured independently of each other.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, approved architecture, approved database design, approved UI/UX design, approved backend design, approved frontend design, approved QA strategy, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- The Architecture Draft, Database Design Draft, Backend Draft, Frontend Draft, and QA Draft have already been approved — treat their module boundaries, data model, API design, frontend design, and test strategy as settled constraints your operational strategy must support, not open questions.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- Be concise. This is a high-level operational strategy, not a runbook: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const JSON_SHAPE = `{
${DEVOPS_DRAFT_FIELDS.map((field) => `  "${field.key}": ${field.kind === 'list' ? 'string[]' : 'string'}`).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered DevOpsContext
 * (see devopsEngineerEngine.buildDevOpsContext). This function never
 * fetches or gathers data itself — it only formats what it's given into
 * text.
 */
export function buildDevOpsUserPrompt(context: DevOpsContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Blueprint: ${context.blueprint.name} (${context.blueprint.category}${context.blueprint.productType ? `, ${context.blueprint.productType}` : ''})
Recommended stack: ${formatList(context.blueprint.recommendedStack)}
Recommended integrations: ${formatList(context.blueprint.recommendedIntegrations)}

Approved Requirements / Project Knowledge (${context.knowledgeCompletion}% complete):
${formatProjectKnowledge(context.knowledge)}

Approved Architecture Draft:
${formatDraftFields(context.architecture, ARCHITECTURE_DRAFT_FIELDS)}

Approved Database Design Draft:
${formatDraftFields(context.database, DATABASE_DRAFT_FIELDS)}

Approved UI/UX Draft:
${formatDraftFields(context.uiux, UIUX_DRAFT_FIELDS)}

Approved Backend Draft:
${formatDraftFields(context.backend, BACKEND_DRAFT_FIELDS)}

Approved Frontend Draft:
${formatDraftFields(context.frontend, FRONTEND_DRAFT_FIELDS)}

Approved QA Draft:
${formatDraftFields(context.qa, QA_DRAFT_FIELDS)}

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
