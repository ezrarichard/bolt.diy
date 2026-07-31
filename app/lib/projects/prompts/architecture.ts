import type { ArchitectureContext } from '~/lib/projects/solutionArchitectEngine';
import type { AIDecision } from '~/lib/projects/draftParsing';
import type { TechnicalArchitectureSpecification } from '~/lib/technical-architecture/tasTypes';
import { REQUIREMENTS_DRAFT_FIELDS } from './requirements';
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
 * Solution Architect prompt — Sprint 14.
 *
 * The only place the Solution Architect's system prompt, JSON contract, and
 * user-prompt assembly live — same pattern as prompts/requirements.ts.
 * app/lib/projects/solutionArchitectEngine.ts (pure orchestration) and any
 * UI that renders a draft both import `ARCHITECTURE_DRAFT_FIELDS` from here
 * rather than re-describing the shape. Nothing in this file calls an LLM,
 * generates code, or talks to a store — it only builds strings and
 * describes a JSON shape.
 */

export interface ArchitectureDraft {
  architectureSummary?: string;
  applicationModules?: string[];
  frontendArchitecture?: string;
  backendArchitecture?: string;
  databaseArchitecture?: string;
  authenticationStrategy?: string;
  authorizationRoles?: string[];
  integrations?: string[];
  paymentArchitecture?: string;
  complianceArchitecture?: string;
  deploymentArchitecture?: string;
  securityConsiderations?: string[];
  scalabilityPlan?: string;
  risks?: string[];
  openQuestions?: string[];
  recommendedNextSteps?: string[];

  /** Sprint 32 — freeform recommendations for the next role (the Database Engineer). See app/lib/projects/collaborationContext.ts. */
  engineeringNotes?: string;

  /** Sprint 32 — structured decision log (see draftParsing.ts's `AIDecision`), carried forward to every later role. */
  aiDecisions?: AIDecision[];

  /**
   * Sprint 100B — the machine-readable counterpart to every narrative field
   * above, produced by this SAME LLM call. Parsed and validated separately (see
   * app/lib/technical-architecture/tasTypes.ts's `parseTechnicalArchitectureSpec`)
   * and persisted as its own first-class artifact
   * (`ARTIFACT_TYPES.TECHNICAL_ARCHITECTURE_SPEC`) rather than a field of the
   * narrative draft artifact — kept here only as the in-memory carrier between
   * parseDraft() and solutionArchitectEngine.createTechnicalArchitectureArtifact().
   *
   * Deliberately NOT added to ARCHITECTURE_DRAFT_FIELDS below: that list drives
   * the narrative artifact's shape, its JSON contract, and the preview UI's
   * section list, and Sprint 100B must leave all three unchanged.
   */
  technicalArchitecture?: TechnicalArchitectureSpecification;
}

export interface ArchitectureDraftFieldConfig {
  key: keyof ArchitectureDraft;
  label: string;
  kind: 'text' | 'list' | 'decisions';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, solutionArchitectEngine.parseDraft()'s
 * field-by-field extraction, and the preview UI's section list.
 */
export const ARCHITECTURE_DRAFT_FIELDS: ArchitectureDraftFieldConfig[] = [
  { key: 'architectureSummary', label: 'Architecture Summary', kind: 'text' },
  { key: 'applicationModules', label: 'Application Modules', kind: 'list' },
  { key: 'frontendArchitecture', label: 'Frontend Architecture', kind: 'text' },
  { key: 'backendArchitecture', label: 'Backend Architecture', kind: 'text' },
  { key: 'databaseArchitecture', label: 'Database Architecture', kind: 'text' },
  { key: 'authenticationStrategy', label: 'Authentication Strategy', kind: 'text' },
  { key: 'authorizationRoles', label: 'Authorization Roles', kind: 'list' },
  { key: 'integrations', label: 'Integrations', kind: 'list' },
  { key: 'paymentArchitecture', label: 'Payment Architecture', kind: 'text' },
  { key: 'complianceArchitecture', label: 'Compliance Architecture', kind: 'text' },
  { key: 'deploymentArchitecture', label: 'Deployment Architecture', kind: 'text' },
  { key: 'securityConsiderations', label: 'Security Considerations', kind: 'list' },
  { key: 'scalabilityPlan', label: 'Scalability Plan', kind: 'text' },
  { key: 'risks', label: 'Risks', kind: 'list' },
  { key: 'openQuestions', label: 'Open Questions', kind: 'list' },
  { key: 'recommendedNextSteps', label: 'Recommended Next Steps', kind: 'list' },
  { key: 'engineeringNotes', label: 'Engineering Notes For Next Engineer', kind: 'text' },
  { key: 'aiDecisions', label: 'AI Decisions', kind: 'decisions' },
];

export const SOLUTION_ARCHITECT_SYSTEM_PROMPT = `You are a Senior Solution Architect working inside Builders, an AI engineering platform.

Your ONLY responsibility is to design the technical architecture for the product described in the project context, based on requirements that have already been gathered and approved, AND to express that same architecture as a structured, machine-readable Technical Architecture Specification. You are not a business analyst and not an implementer:
- Do NOT write or generate code, file contents, or configuration files.
- Do NOT create, modify, or scaffold a database, backend, or frontend yourself — only DESCRIBE the intended architecture in prose/lists.
- Do NOT propose specific GitHub repository actions, Supabase project actions, or deployment steps to execute — "Deployment Architecture" should describe a strategy/target conceptually (e.g. "static frontend on a CDN, serverless API functions"), never an action to run.

India-specific expectations — use these as sensible defaults for India-focused products (infer from the project's blueprint/knowledge; do not force them onto a product that is clearly not India-focused):
- Payments: Razorpay and UPI. Never recommend Stripe as the default payment architecture for an India-focused product.
- Compliance: GST and invoice generation wherever the product involves commerce or billing.
- Notifications: WhatsApp notifications where relevant to the product's user communication needs.
- Shipping/logistics: Shiprocket or Delhivery where the product ships physical goods.
- Languages: consider Tamil, Malayalam, Hindi, and English support where relevant to the product's audience.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, the Business Analyst's approved draft, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- If an Engineering Handoff from the AI Product Owner is present, it is the primary boundary for this design: design ONLY for the features it lists as in scope, and treat its "OUT OF SCOPE" list as a hard constraint — do not design for out-of-scope or future-MVP features even if the wider Requirements draft mentions them. Where a module/architecture decision maps clearly to one or more specific features, cite their Feature ID(s) (e.g. "applicationModules: ['Booking module (FEAT-006, FEAT-007)']") so this design stays traceable back to the Product Owner's scope. If no handoff is present (a legacy project), design for the full product as before.
- If your context includes a "Blueprint Guidance for Solution Architecture" section, use it to architect better, never to architect bigger: it tells you typical module boundaries, integrations, security/performance expectations, and deployment patterns for this kind of product — use that to sharpen module decomposition, service boundaries, integration planning, and your security/performance/deployment recommendations. It never expands what you design for; the approved Business Analysis and the Engineering Handoff's in-scope/out-of-scope lists still govern that. If Blueprint guidance conflicts with either, note the conflict in "openQuestions" rather than resolving it silently.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty — but list genuine uncertainties under "openQuestions" instead of guessing wildly.
- Be concise IN THE NARRATIVE FIELDS. Every field except "technicalArchitecture" is a high-level overview for a human reader, not a design document: each narrative text field must be at most 2-4 sentences (a short paragraph), and each narrative list field must contain at most 5-8 of the most important items — pick the ones that matter most rather than trying to be exhaustive. This brevity rule does NOT apply to "technicalArchitecture", which is consumed by machines and must be complete rather than short.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.

TECHNICAL ARCHITECTURE SPECIFICATION ("technicalArchitecture")

This is the machine-readable expression of the SAME architecture your narrative fields describe. It exists so that later stages never have to guess a technical decision that could have been made here.

- The narrative fields and "technicalArchitecture" must describe the SAME architecture — never decide something in one that the other contradicts or omits. If your narrative says payments use a particular provider, that provider must be the current binding in "technicalArchitecture", and vice versa.
- Decide anything a builder would otherwise have to invent: provider choices, configuration surfaces, secrets, environment variables, tenancy enforcement, background and scheduled work, caching, audit, logging, storage, security boundaries, deployment assumptions.
- MVP DISCIPLINE IS THE POINT. Every provider binding, setting, bucket, flag, job, cache layer, audit event and tenancy level carries "lifecycle": "current" means it is part of THIS MVP and will be built; "future" means it is planned for a named later MVP and must NOT be built now; "deferred" means it is acknowledged but not planned and must NOT be built now. At most ONE binding per capability may be "current" — zero is also valid and means the capability is declared but nothing is built for it yet (for example, AI in an MVP that ships no AI).
- A "future" binding earns a seam and therefore MUST declare: "targetMvpSequence", "v1Cost" (zero | low | deferred), "v1CostJustification", and "invariants". Invariants are things the CURRENT build must never do so the future change stays cheap — they are NOT structures to build now. Only claim v1Cost "zero" when everything the seam needs is already required by this MVP for its own reasons.
- Never prepare for the future at the current MVP's expense. If preparing would make this MVP materially more expensive, record it in "evolution" with an honest "migrationSketch" and let the later MVP pay for it. A "deferred" binding owes no invariants at all.
- "doNotBuild" is the explicit negative instruction to whatever builds this product. Every "future" and "deferred" binding must be covered by a "doNotBuild" entry, and each entry needs a "verifiable" — a concrete check someone could run to confirm it was obeyed.
- Every entry in "directives" must have a "verifiable" for the same reason: a directive nobody can check is prose, not a directive.
- Secrets are always "clientExposed": false. Tenant identity always comes from the authenticated session, never from a request parameter, header, or body field. When the tenancy model is not single-tenant, cache keys and storage paths must include the tenant prefix.

"technicalArchitecture" must follow this exact shape:
{ tasVersion: "1.0", projectId, projectName, mvpSequence: number, changeClass: "additive"|"binding"|"structural",
  systemOverview: { summary, productType, topology, modules: [{ id, name, responsibility, dependsOn: string[], featureRefs?: string[] }], systemBoundaries: string[] },
  decisions: [{ id, title, decision, rationale, alternativesRejected: [{ option, reason }], satisfies?: string[], consequences?: string[] }],
  capabilities: [{ id, kind: "payment"|"notification"|"storage"|"ai"|"auth"|"search"|"analytics"|"external", name, purpose, port, portSurface: string[], bindings: [{ id, provider, providerType: "hosted-api"|"self-hosted"|"sdk"|"webhook"|"manual"|"none", lifecycle, targetMvpSequence?, v1Cost?, v1CostJustification?, invariants?: string[], doNotBuild?: string[], sdkPackage?, sandboxAvailable?, notes? }], runtimeConfigurable: boolean, configScreenRequired: boolean, configScreenRef?, connectionTest?: { description, trigger: "admin-screen"|"cli"|"startup-check", successCriteria }, secretRefs: string[], fallback: { kind: "none"|"queue"|"degrade"|"manual"|"secondary-provider", description }, failureMode: "blocking"|"degraded"|"queued"|"silent", decisionRefs: string[] }],
  runtime: { target, framework, language, buildOutput, packageManager?, bootSettings: string[] },
  configuration: { settings: [{ key, description, scope: "build"|"deployment"|"system"|"tenant"|"user", mutability: "immutable"|"deploy-time"|"runtime-admin"|"runtime-user", valueType: "string"|"number"|"boolean"|"enum"|"json", allowedValues?, defaultValue?, changeableBy?, screenRef?, envVarRef?, lifecycle }], environmentVariables: [{ name, description, owner: "devops"|"backend"|"frontend", scope: "build"|"server"|"client", requiredAt: "build"|"boot"|"first-use", hasSafeDefault: boolean, defaultValue?, isSecret: boolean, exampleValue? }], secrets: [{ id, name, description, capabilityRef?, storage: "env-var"|"platform-secret-store"|"encrypted-at-rest-in-db"|"external-vault", clientExposed: false, rotationExpectation?, scope: "deployment"|"tenant" }], screens: [{ id, name, accessRole, settingKeys: string[], hasConnectionTest: boolean, location }] },
  security: { authentication: { method, identityField, sessionMechanism, sessionExpiry, revocation, credentialStorage, rateLimiting, mfa? }, authorization: { model: "rbac"|"abac"|"acl"|"ownership", enforcementPoint, roles: string[], permissionSource, serverSideEnforced: true }, boundaries: [{ id, name, zone: "public"|"authenticated"|"privileged"|"internal", entryPoints: string[], doesNotTrust: string[], validation }], publicSurfaces: [{ id, description, exposes: string[], mustNotExpose: string[], protection }] },
  tenancy: { model: "single-tenant"|"shared-schema-row-scoped"|"schema-per-tenant"|"database-per-tenant", scopeColumn?, identitySource, enforcementLayers: [{ layer: "application"|"database"|"gateway", mechanism, guaranteeIfOthersFail }], cacheKeyConvention, storagePathConvention, levels: [{ name, description, lifecycle, targetMvpSequence?, v1Cost?, v1CostJustification?, invariants?: string[], dataShapeChange?, migrationSketch? }], tenantStates?: [{ state, access: "full"|"read-only"|"none", description }] },
  crossCutting: { storage: { provider, buckets: [{ name, purpose, publicRead: boolean, retention?, lifecycle }], pathConvention, accessModel: "signed-url"|"proxied"|"public", maxFileSizeBytes?, allowedMimeTypes?: string[], virusScanning: boolean }, featureToggles: { evaluationPoint, source: "env-var"|"tenant-config"|"remote-service"|"build-constant", flags: [{ key, description, defaultState: boolean, scope, removalCondition, lifecycle }] }, backgroundProcessing: { mechanism, jobs: [{ id, name, trigger, idempotencyKey, retryPolicy, maxAttempts: number, timeoutSeconds?, userVisibleFailure, lifecycle }], deadLetterHandling }, scheduledJobs: { scheduler, jobs: [{ id, name, schedule, timezone, overlapPolicy: "skip"|"queue"|"allow", failureAlerting, lifecycle }] }, caching: { layers: [{ name, location: "client"|"cdn"|"server-memory"|"shared-store", cachedData: string[], ttlSeconds: number, invalidationTrigger, lifecycle }], keyConvention, tenantPrefixed: boolean }, audit: { events: [{ event, entityTypes: string[], capturesFieldChanges: boolean, reasonRequired: boolean, lifecycle }], sink, immutabilityMechanism, retentionPeriod, requiredFields: string[] }, logging: { levels: string[], sink, format: "structured-json"|"plain-text", requiredContext: string[], prohibitedContent: string[], retentionPeriod }, monitoring: { signals: [{ name, type: "uptime"|"latency"|"error-rate"|"business-metric"|"resource", threshold?, severity: "critical"|"warning"|"info", lifecycle }], alertRouting, uptimeTarget? } },
  deployment: { hostingModel, region, regionRationale?, environments: [{ name, purpose, dataPolicy }], migrationStrategy, zeroDowntimeRequired: boolean, rollbackStrategy, cicdGates: string[], scalability: { envelope: [{ dimension, expected, designHeadroom }], statelessTier: boolean, horizontalScaling, peakProfile?, reviewTrigger? } },
  evolution: { entries: [{ sourceRef, capability, currentState, futureState, lifecycle: "future"|"deferred", targetMvpSequence?, seamKind: "interface"|"data-shape"|"config"|"none", v1Cost, v1CostJustification, invariants: string[], migrationSketch }], deliberatelyUnprepared: string[] },
  nonGoals: [{ id, statement, reason, revisitAtMvpSequence? }],
  doNotBuild: [{ id, statement, origin: "derived"|"explicit", sourceRef?, verifiable }],
  directives: [{ id, appliesTo: ("database"|"uiux"|"backend"|"frontend"|"qa"|"devops"|"generator")[], kind: "structure"|"boundary"|"binding"|"invariant"|"prohibition"|"configuration", directive, mustNot?, verifiable, sourceSection, decisionRefs?, mvpSequence: number, severity: "must"|"should" }] }

${COLLABORATION_FRAMING}`;

const JSON_SHAPE = `{
${ARCHITECTURE_DRAFT_FIELDS.map(formatJsonShapeField).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered
 * ArchitectureContext (see solutionArchitectEngine.buildArchitectureContext).
 * This function never fetches or gathers data itself — it only formats
 * what it's given into text.
 */
export function buildArchitectureUserPrompt(context: ArchitectureContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Blueprint: ${context.blueprint.name} (${context.blueprint.category}${context.blueprint.productType ? `, ${context.blueprint.productType}` : ''})
Recommended stack: ${formatList(context.blueprint.recommendedStack)}
Recommended integrations: ${formatList(context.blueprint.recommendedIntegrations)}

Approved Requirements / Project Knowledge (${context.knowledgeCompletion}% complete):
${formatProjectKnowledge(context.knowledge)}

Approved Business Analyst Output (full — you are the next role in the chain):
${formatDraftFields(context.requirementsDraft, omitCollaborationFields(REQUIREMENTS_DRAFT_FIELDS))}

Engineering Handoff from the AI Product Owner (Sprint 46B — this is the MVP-scoped boundary for what you design; treat outOfScopeFeatures as a hard constraint, not a suggestion. Absent for legacy projects that progressed before this role existed):
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

Return ONLY a JSON object with exactly these keys (use empty arrays/strings where genuinely unknown, do not omit any key), PLUS a "technicalArchitecture" key holding the Technical Architecture Specification described in your instructions. Keep every narrative text field below to 2-4 sentences and every narrative list to at most 5-8 items — that limit applies to these keys only, never to "technicalArchitecture":

${JSON_SHAPE}`;
}
