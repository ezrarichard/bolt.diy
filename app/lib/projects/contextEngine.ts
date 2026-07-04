import { blueprintEngine } from '~/lib/blueprints';
import { executionEngine, type ProjectTaskExecution } from './executionEngine';
import { projectKnowledgeEngine } from './projectKnowledgeEngine';
import type { ProjectKnowledge } from './knowledge';
import { ARTIFACT_TYPES, getApprovedArtifactContent, getLatestArtifact } from './artifacts';
import {
  getProjectArtifacts,
  getProjectKnowledge,
  getRoadmapItemStatus,
  getTaskNotes,
  type Project,
} from '~/lib/stores/projects';
import { ARCHITECTURE_DRAFT_FIELDS, type ArchitectureDraft } from './prompts/architecture';
import { DATABASE_DRAFT_FIELDS, type DatabaseDraft } from './prompts/database';
import { UIUX_DRAFT_FIELDS, type UIUXDraft } from './prompts/uiux';
import { formatDraftFields, formatList, formatProjectKnowledge } from './prompts/shared';

/**
 * Context Engine — Sprint 17.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Tasks
 *     -> Execution -> Review -> Approval -> Artifacts
 *       -> Business Analyst -> Solution Architect -> Database Designer
 *         -> UI/UX Designer -> Context Engine (this file)
 *           -> Backend/Frontend/QA/DevOps Engineers (future)
 *
 * Every AI role built so far (businessAnalystEngine.ts,
 * solutionArchitectEngine.ts, databaseDesignerEngine.ts,
 * uiuxDesignerEngine.ts) hand-assembles its own full context object and
 * hands the whole thing to the prompt builder — fine when there are four
 * roles reading a handful of small drafts, but future roles (Backend,
 * Frontend, QA, DevOps) would otherwise receive full
 * requirements+architecture+database+UI/UX+roadmap+tasks+notes on every
 * call, which is both expensive and dilutes the prompt with irrelevant
 * detail (a Backend Engineer doesn't need animation timing; a Frontend
 * Engineer doesn't need index/constraint detail).
 *
 * This engine decides, per role, WHICH sections of project context are
 * relevant, summarizes approved artifacts deterministically (no AI), and
 * trims to a token budget — producing a structured `ContextBundle`, never a
 * prompt string. No LLM call happens here, and nothing here writes to any
 * store, artifact, GitHub, Supabase, or deployment target. See
 * `formatContextBundleForPrompt` at the bottom for the adapter path future
 * engines can use to turn a bundle into prompt text — no existing engine
 * calls it yet, so this sprint changes no generation behavior.
 */

export type ContextRole =
  | 'business-analyst'
  | 'solution-architect'
  | 'database-designer'
  | 'uiux-designer'
  | 'backend-engineer'
  | 'frontend-engineer'
  | 'qa-engineer'
  | 'devops-engineer';

export const CONTEXT_ROLES: ContextRole[] = [
  'business-analyst',
  'solution-architect',
  'database-designer',
  'uiux-designer',
  'backend-engineer',
  'frontend-engineer',
  'qa-engineer',
  'devops-engineer',
];

export const CONTEXT_ROLE_LABELS: Record<ContextRole, string> = {
  'business-analyst': 'Business Analyst',
  'solution-architect': 'Solution Architect',
  'database-designer': 'Database Designer',
  'uiux-designer': 'UI/UX Designer',
  'backend-engineer': 'Backend Engineer',
  'frontend-engineer': 'Frontend Engineer',
  'qa-engineer': 'QA Engineer',
  'devops-engineer': 'DevOps Engineer',
};

export type ContextBudget = 'small' | 'medium' | 'large' | 'full';

export const CONTEXT_BUDGETS: ContextBudget[] = ['small', 'medium', 'large', 'full'];

/** No real tokenizer yet — see estimateTokens() below for the approximation these presets are measured against. */
export const CONTEXT_BUDGET_LIMITS: Record<ContextBudget, number> = {
  small: 4000,
  medium: 8000,
  large: 16000,
  full: 32000,
};

type ContextSectionId =
  | 'current-task'
  | 'project-summary'
  | 'requirements-summary'
  | 'architecture-summary'
  | 'database-summary'
  | 'uiux-summary'
  | 'auth-strategy'
  | 'entities'
  | 'compliance-payments-security'
  | 'user-flows'
  | 'pages-screens'
  | 'user-roles'
  | 'brand-design-preferences'
  | 'component-guidance'
  | 'page-layouts'
  | 'animations-motion'
  | 'approved-backend-draft'
  | 'roadmap'
  | 'tasks'
  | 'notes';

export interface ContextSection {
  id: ContextSectionId;
  label: string;
  content: string;
  estimatedTokens: number;
}

export interface ExcludedContextSection {
  id: ContextSectionId;
  label: string;
  reason: string;
}

export interface ContextBundle {
  role: ContextRole;
  budget: ContextBudget;
  includedSections: ContextSection[];
  excludedSections: ExcludedContextSection[];
  estimatedTokens: number;
  warnings: string[];
  summary: string;
}

/** No real tokenizer yet — a rough, provider-agnostic approximation (~4 chars/token) good enough for budgeting decisions, not billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function bulletList(items: string[] | undefined): string | undefined {
  return items && items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : undefined;
}

/** Accepts `x?.length && \`text\`` expressions directly — that pattern types as `string | number`, not `string | false`, since `.length` is a number. */
function joinTruthy(lines: (string | number | false | undefined)[]): string | undefined {
  const filtered = lines.filter((line): line is string => typeof line === 'string' && line.length > 0);
  return filtered.length > 0 ? filtered.join('\n') : undefined;
}

/**
 * Deterministic, AI-free summarizers — Sprint 17. Each picks a handful of
 * the most decision-relevant fields from an approved draft rather than
 * dumping every field (that's what `formatDraftFields` from
 * prompts/shared.ts already does, reused below for the `includeFullArtifacts`
 * escape hatch). "Requirements" in this codebase means Project Knowledge —
 * the Requirements Draft artifact only ever folds into Project Knowledge on
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

/** Everything a section builder needs, gathered once per buildContextBundle() call so no builder re-reads the store. */
interface SectionContext {
  project: Project;
  blueprint: { name: string; category: string; productType?: string };
  knowledge: ProjectKnowledge | undefined;
  knowledgeCompletion: number;
  architecture: ArchitectureDraft | undefined;
  database: DatabaseDraft | undefined;
  uiux: UIUXDraft | undefined;
  roadmap: { title: string; description: string; status: string }[];
  tasks: ProjectTaskExecution[];
  notesText: string;
  currentTask: ProjectTaskExecution | undefined;
  includeFullArtifacts: boolean;
}

interface RoleConfig {
  label: string;

  /** Section ids in priority order (most important first) — included up to the token budget, lowest-priority trimmed first. */
  sectionIds: ContextSectionId[];

  /** Sections never relevant to this role regardless of budget, each with a human-readable reason shown in the preview. */
  hardExcludedIds: { id: ContextSectionId; reason: string }[];

  /** Empty array = every task category (no filtering). */
  taskCategories: ProjectTaskExecution['category'][];

  /** Checks run against the gathered context to warn when an upstream draft this role depends on isn't approved yet. */
  requiredUpstream: { check: (ctx: SectionContext) => boolean; message: string }[];
}

function buildTasksSection(ctx: SectionContext, categories: ProjectTaskExecution['category'][]): string | undefined {
  const filtered = categories.length > 0 ? ctx.tasks.filter((task) => categories.includes(task.category)) : ctx.tasks;
  return bulletList(filtered.map((task) => `${task.title} [${task.category}] — ${task.status}`));
}

const NOT_YET_IMPLEMENTED_REASON =
  'Backend Engineer role is not implemented yet — no approved backend draft to include.';
const NOT_AVAILABLE_REASON = 'Not available yet — no approved data to include.';

const SECTION_DEFS: Record<
  ContextSectionId,
  { label: string; build: (ctx: SectionContext, role: RoleConfig) => string | undefined }
> = {
  'current-task': {
    label: 'Current Task',
    build: (ctx) => {
      const task = ctx.currentTask;
      return task
        ? joinTruthy([
            `${task.title} [${task.category}] — ${task.status}`,
            task.description,
            `Output: ${task.outputType}`,
          ])
        : undefined;
    },
  },
  'project-summary': {
    label: 'Project Summary',
    build: (ctx) =>
      joinTruthy([
        `${ctx.project.name}${ctx.project.description ? ` — ${ctx.project.description}` : ''}`,
        `Blueprint: ${ctx.blueprint.name} (${ctx.blueprint.category}${ctx.blueprint.productType ? `, ${ctx.blueprint.productType}` : ''})`,
        `Requirements completion: ${ctx.knowledgeCompletion}%`,
      ]),
  },
  'requirements-summary': {
    label: 'Requirements Summary',
    build: (ctx) => (ctx.knowledge ? summarizeRequirements(ctx.knowledge) : undefined),
  },
  'architecture-summary': {
    label: 'Architecture Summary',
    build: (ctx) =>
      ctx.architecture
        ? ctx.includeFullArtifacts
          ? formatDraftFields(ctx.architecture, ARCHITECTURE_DRAFT_FIELDS)
          : summarizeArchitecture(ctx.architecture)
        : undefined,
  },
  'database-summary': {
    label: 'Database Summary',
    build: (ctx) =>
      ctx.database
        ? ctx.includeFullArtifacts
          ? formatDraftFields(ctx.database, DATABASE_DRAFT_FIELDS)
          : summarizeDatabase(ctx.database)
        : undefined,
  },
  'uiux-summary': {
    label: 'UI/UX Summary',
    build: (ctx) =>
      ctx.uiux
        ? ctx.includeFullArtifacts
          ? formatDraftFields(ctx.uiux, UIUX_DRAFT_FIELDS)
          : summarizeUIUX(ctx.uiux)
        : undefined,
  },
  'auth-strategy': {
    label: 'Auth Strategy',
    build: (ctx) =>
      joinTruthy([
        ctx.architecture?.authenticationStrategy && `Authentication: ${ctx.architecture.authenticationStrategy}`,
        ctx.architecture?.authorizationRoles?.length && `Roles: ${formatList(ctx.architecture.authorizationRoles)}`,
        ctx.database?.securityModel && `Security model: ${ctx.database.securityModel}`,
      ]),
  },
  entities: {
    label: 'Entities',
    build: (ctx) =>
      joinTruthy([
        ctx.database?.entities?.length && `Entities: ${formatList(ctx.database.entities)}`,
        ctx.database?.relationships?.length && `Relationships: ${formatList(ctx.database.relationships)}`,
        ctx.database?.primaryKeys?.length && `Primary keys: ${formatList(ctx.database.primaryKeys)}`,
        ctx.database?.foreignKeys?.length && `Foreign keys: ${formatList(ctx.database.foreignKeys)}`,
      ]),
  },
  'compliance-payments-security': {
    label: 'Compliance / Payments / Security',
    build: (ctx) =>
      joinTruthy([
        ctx.knowledge?.complianceNeeds?.length && `Compliance: ${formatList(ctx.knowledge.complianceNeeds)}`,
        ctx.knowledge?.paymentNeeds?.length && `Payments: ${formatList(ctx.knowledge.paymentNeeds)}`,
        ctx.database?.securityModel && `Security model: ${ctx.database.securityModel}`,
        ctx.database?.dataRetention && `Data retention: ${ctx.database.dataRetention}`,
      ]),
  },
  'user-flows': {
    label: 'User Flows',
    build: (ctx) => bulletList(ctx.uiux?.userFlows),
  },
  'pages-screens': {
    label: 'Pages / Screens',
    build: (ctx) =>
      bulletList(Array.from(new Set([...(ctx.knowledge?.pagesOrScreens ?? []), ...(ctx.uiux?.screenHierarchy ?? [])]))),
  },
  'user-roles': {
    label: 'User Roles',
    build: (ctx) => {
      const roles = Array.from(
        new Set([...(ctx.knowledge?.userRoles ?? []), ...(ctx.architecture?.authorizationRoles ?? [])]),
      );
      return roles.length > 0 ? formatList(roles) : undefined;
    },
  },
  'brand-design-preferences': {
    label: 'Brand / Design Preferences',
    build: (ctx) =>
      joinTruthy([
        ctx.knowledge?.brandTone && `Brand tone: ${ctx.knowledge.brandTone}`,
        ctx.knowledge?.designPreferences && `Design preferences: ${ctx.knowledge.designPreferences}`,
        ctx.uiux?.colorStrategy && `Color strategy: ${ctx.uiux.colorStrategy}`,
        ctx.uiux?.typographyStrategy && `Typography strategy: ${ctx.uiux.typographyStrategy}`,
      ]),
  },
  'component-guidance': {
    label: 'Component Guidance',
    build: (ctx) =>
      joinTruthy([
        ctx.uiux?.componentLibrary?.length && `Components: ${formatList(ctx.uiux.componentLibrary)}`,
        ctx.uiux?.designTokens?.length && `Design tokens: ${formatList(ctx.uiux.designTokens)}`,
        ctx.uiux?.spacingSystem && `Spacing system: ${ctx.uiux.spacingSystem}`,
        ctx.uiux?.iconography && `Iconography: ${ctx.uiux.iconography}`,
      ]),
  },
  'page-layouts': {
    label: 'Page Layouts',
    build: (ctx) =>
      joinTruthy([
        ctx.uiux?.pageLayouts?.length && `Layouts: ${formatList(ctx.uiux.pageLayouts)}`,
        ctx.uiux?.dashboardLayout && `Dashboard layout: ${ctx.uiux.dashboardLayout}`,
        ctx.uiux?.mobileExperience && `Mobile: ${ctx.uiux.mobileExperience}`,
        ctx.uiux?.tabletExperience && `Tablet: ${ctx.uiux.tabletExperience}`,
        ctx.uiux?.desktopExperience && `Desktop: ${ctx.uiux.desktopExperience}`,
      ]),
  },
  'animations-motion': {
    label: 'Animations / Motion / States',
    build: (ctx) =>
      joinTruthy([
        ctx.uiux?.animations?.length && `Animations: ${formatList(ctx.uiux.animations)}`,
        ctx.uiux?.loadingStates?.length && `Loading states: ${formatList(ctx.uiux.loadingStates)}`,
        ctx.uiux?.emptyStates?.length && `Empty states: ${formatList(ctx.uiux.emptyStates)}`,
        ctx.uiux?.errorStates?.length && `Error states: ${formatList(ctx.uiux.errorStates)}`,
      ]),
  },
  'approved-backend-draft': {
    label: 'Approved Backend Draft',
    build: (ctx) => {
      const latest = getLatestArtifact(getProjectArtifacts(ctx.project), 'backend-draft');
      return latest && latest.status === 'approved'
        ? `Approved Backend Draft v${latest.version ?? 1}, generated by ${latest.generatedBy ?? 'unknown'}.`
        : undefined;
    },
  },
  roadmap: {
    label: 'Roadmap',
    build: (ctx) => bulletList(ctx.roadmap.map((item) => `${item.title} (${item.status}): ${item.description}`)),
  },
  tasks: {
    label: 'Relevant Tasks',
    build: (ctx, role) => buildTasksSection(ctx, role.taskCategories),
  },
  notes: {
    label: 'Notes',
    build: (ctx) => (ctx.notesText.trim().length > 0 ? ctx.notesText : undefined),
  },
};

/**
 * Sprint 17 role rules. `sectionIds` order is the include priority (trimmed
 * from the end first when a budget can't fit everything); `hardExcludedIds`
 * are always shown as excluded regardless of budget, each with the reason a
 * human reviewing the Context Preview would want to see. A role that
 * produces a given artifact (e.g. Database Designer producing `entities`,
 * Solution Architect producing `architecture-summary`/`auth-strategy`, UI/UX
 * Designer producing `uiux-summary`/`user-flows`/etc.) still lists that
 * section as *included* — on regenerate, seeing its own prior approved
 * output is exactly the context it needs, the same way every existing
 * engine already reads `existingArtifacts` for this purpose.
 */
const ROLE_CONFIGS: Record<ContextRole, RoleConfig> = {
  'business-analyst': {
    label: CONTEXT_ROLE_LABELS['business-analyst'],
    sectionIds: ['project-summary', 'requirements-summary', 'roadmap', 'tasks', 'user-roles', 'pages-screens', 'notes'],
    hardExcludedIds: [
      { id: 'architecture-summary', reason: 'Architecture is designed after requirements — not yet relevant.' },
      { id: 'database-summary', reason: 'Database design comes later in the pipeline.' },
      { id: 'uiux-summary', reason: 'UI/UX design comes later in the pipeline.' },
      { id: 'user-flows', reason: 'UI/UX design comes later in the pipeline.' },
      { id: 'entities', reason: 'Database internals are not relevant to gathering requirements.' },
      {
        id: 'auth-strategy',
        reason: 'Technical auth strategy is decided by the Solution Architect, not the Business Analyst.',
      },
      { id: 'component-guidance', reason: 'Component-level UI detail is not relevant to requirements gathering.' },
      { id: 'page-layouts', reason: 'Layout detail is not relevant to requirements gathering.' },
      { id: 'animations-motion', reason: 'Motion/animation detail is not relevant to requirements gathering.' },
      { id: 'compliance-payments-security', reason: 'Covered at a business level via Requirements Summary already.' },
      { id: 'brand-design-preferences', reason: 'Visual brand detail is not relevant to requirements gathering.' },
      { id: 'approved-backend-draft', reason: 'Backend Engineer role is not implemented yet.' },
    ],
    taskCategories: ['planning'],
    requiredUpstream: [],
  },
  'solution-architect': {
    label: CONTEXT_ROLE_LABELS['solution-architect'],
    sectionIds: [
      'project-summary',
      'requirements-summary',
      'architecture-summary',
      'auth-strategy',
      'roadmap',
      'tasks',
      'user-roles',
      'notes',
    ],
    hardExcludedIds: [
      { id: 'database-summary', reason: 'Database design has not happened yet.' },
      { id: 'uiux-summary', reason: 'UI/UX design has not happened yet.' },
      { id: 'user-flows', reason: 'UI/UX design has not happened yet.' },
      { id: 'pages-screens', reason: 'UI/UX design has not happened yet.' },
      { id: 'entities', reason: 'Database internals have not been designed yet.' },
      { id: 'compliance-payments-security', reason: 'Covered at a business level via Requirements Summary already.' },
      { id: 'brand-design-preferences', reason: 'Visual brand detail is not relevant to architecture.' },
      { id: 'component-guidance', reason: 'Component-level UI detail is not relevant to architecture.' },
      { id: 'page-layouts', reason: 'Layout detail is not relevant to architecture.' },
      { id: 'animations-motion', reason: 'Motion/animation detail is not relevant to architecture.' },
      { id: 'approved-backend-draft', reason: 'Backend Engineer role is not implemented yet.' },
    ],
    taskCategories: ['planning', 'design'],
    requiredUpstream: [],
  },
  'database-designer': {
    label: CONTEXT_ROLE_LABELS['database-designer'],
    sectionIds: [
      'project-summary',
      'requirements-summary',
      'architecture-summary',
      'database-summary',
      'auth-strategy',
      'entities',
      'compliance-payments-security',
      'user-roles',
      'roadmap',
      'tasks',
      'notes',
    ],
    hardExcludedIds: [
      { id: 'uiux-summary', reason: 'UI/UX design is not relevant to database design.' },
      { id: 'user-flows', reason: 'UI/UX design is not relevant to database design.' },
      { id: 'pages-screens', reason: 'UI/UX design is not relevant to database design.' },
      { id: 'brand-design-preferences', reason: 'Visual brand detail is not relevant to database design.' },
      { id: 'component-guidance', reason: 'Component-level UI detail is not relevant to database design.' },
      { id: 'page-layouts', reason: 'Layout detail is not relevant to database design.' },
      { id: 'animations-motion', reason: 'Motion/animation detail is not relevant to database design.' },
      { id: 'approved-backend-draft', reason: 'Backend Engineer role is not implemented yet.' },
    ],
    taskCategories: ['database'],
    requiredUpstream: [
      {
        check: (ctx) => Boolean(ctx.architecture),
        message: 'Architecture Draft is not approved yet — Database Designer context will be incomplete.',
      },
    ],
  },
  'uiux-designer': {
    label: CONTEXT_ROLE_LABELS['uiux-designer'],
    sectionIds: [
      'project-summary',
      'requirements-summary',
      'architecture-summary',
      'uiux-summary',
      'user-flows',
      'pages-screens',
      'user-roles',
      'brand-design-preferences',
      'component-guidance',
      'page-layouts',
      'animations-motion',
      'roadmap',
      'tasks',
      'notes',
    ],
    hardExcludedIds: [
      { id: 'database-summary', reason: 'Database internals are not relevant to UI/UX design.' },
      { id: 'entities', reason: 'Database internals are not relevant to UI/UX design.' },
      { id: 'compliance-payments-security', reason: 'Not relevant to UI/UX design.' },
      { id: 'auth-strategy', reason: 'Technical auth implementation is not relevant to UI/UX design.' },
      { id: 'approved-backend-draft', reason: 'Backend Engineer role is not implemented yet.' },
    ],
    taskCategories: ['design'],
    requiredUpstream: [
      {
        check: (ctx) => Boolean(ctx.database),
        message: 'Database Design Draft is not approved yet — UI/UX Designer context will be incomplete.',
      },
    ],
  },
  'backend-engineer': {
    label: CONTEXT_ROLE_LABELS['backend-engineer'],
    sectionIds: [
      'project-summary',
      'requirements-summary',
      'architecture-summary',
      'database-summary',
      'entities',
      'auth-strategy',
      'compliance-payments-security',
      'user-roles',
      'approved-backend-draft',
      'roadmap',
      'tasks',
      'notes',
    ],
    hardExcludedIds: [
      { id: 'uiux-summary', reason: 'Not relevant to Backend Engineer.' },
      { id: 'user-flows', reason: 'Not relevant to Backend Engineer.' },
      { id: 'pages-screens', reason: 'Not relevant to Backend Engineer.' },
      { id: 'brand-design-preferences', reason: 'Marketing/brand copy is not relevant to Backend Engineer.' },
      { id: 'component-guidance', reason: 'UI component detail is not relevant to Backend Engineer.' },
      { id: 'page-layouts', reason: 'Frontend layout detail is not relevant to Backend Engineer.' },
      { id: 'animations-motion', reason: 'UI animations are not relevant to Backend Engineer.' },
    ],
    taskCategories: ['backend', 'integration'],
    requiredUpstream: [
      {
        check: (ctx) => Boolean(ctx.database),
        message: 'Database Design Draft is not approved yet — Backend Engineer context will be incomplete.',
      },
    ],
  },
  'frontend-engineer': {
    label: CONTEXT_ROLE_LABELS['frontend-engineer'],
    sectionIds: [
      'project-summary',
      'uiux-summary',
      'architecture-summary',
      'approved-backend-draft',
      'pages-screens',
      'component-guidance',
      'page-layouts',
      'animations-motion',
      'brand-design-preferences',
      'user-flows',
      'user-roles',
      'auth-strategy',
      'roadmap',
      'tasks',
      'notes',
    ],
    hardExcludedIds: [
      {
        id: 'database-summary',
        reason:
          "Database internals are not needed unless explicitly required (see the 'include full artifacts' option).",
      },
      {
        id: 'entities',
        reason:
          "Database internals are not needed unless explicitly required (see the 'include full artifacts' option).",
      },
      {
        id: 'compliance-payments-security',
        reason: 'Backend/database concern, not relevant to frontend implementation.',
      },
      { id: 'requirements-summary', reason: 'Already reflected in the approved UI/UX Draft and Architecture Summary.' },
    ],
    taskCategories: ['frontend', 'design'],
    requiredUpstream: [
      {
        check: (ctx) => Boolean(ctx.uiux),
        message: 'UI/UX Draft is not approved yet — Frontend Engineer context will be incomplete.',
      },
    ],
  },
  'qa-engineer': {
    label: CONTEXT_ROLE_LABELS['qa-engineer'],
    sectionIds: [
      'project-summary',
      'requirements-summary',
      'architecture-summary',
      'database-summary',
      'uiux-summary',
      'user-flows',
      'pages-screens',
      'user-roles',
      'auth-strategy',
      'compliance-payments-security',
      'roadmap',
      'tasks',
      'notes',
    ],
    hardExcludedIds: [
      { id: 'entities', reason: 'Low-level schema detail is not needed for test planning; see Database Summary.' },
      { id: 'brand-design-preferences', reason: 'Visual brand detail is not relevant to test planning.' },
      { id: 'component-guidance', reason: 'Component implementation detail is not relevant to test planning.' },
      { id: 'page-layouts', reason: 'Layout detail is not relevant to test planning.' },
      { id: 'animations-motion', reason: 'Motion/animation detail is not relevant to test planning.' },
      { id: 'approved-backend-draft', reason: 'Backend Engineer role is not implemented yet.' },
    ],
    taskCategories: [],
    requiredUpstream: [],
  },
  'devops-engineer': {
    label: CONTEXT_ROLE_LABELS['devops-engineer'],
    sectionIds: [
      'project-summary',
      'architecture-summary',
      'database-summary',
      'auth-strategy',
      'roadmap',
      'tasks',
      'notes',
    ],
    hardExcludedIds: [
      { id: 'requirements-summary', reason: 'Already reflected in Architecture/Database Summary.' },
      { id: 'uiux-summary', reason: 'Not relevant to deployment/infrastructure.' },
      { id: 'user-flows', reason: 'Not relevant to deployment/infrastructure.' },
      { id: 'pages-screens', reason: 'Not relevant to deployment/infrastructure.' },
      { id: 'user-roles', reason: 'Not relevant to deployment/infrastructure.' },
      { id: 'brand-design-preferences', reason: 'Not relevant to deployment/infrastructure.' },
      { id: 'component-guidance', reason: 'Not relevant to deployment/infrastructure.' },
      { id: 'page-layouts', reason: 'Not relevant to deployment/infrastructure.' },
      { id: 'animations-motion', reason: 'Not relevant to deployment/infrastructure.' },
      { id: 'entities', reason: 'Full schema detail is covered by Database Summary already.' },
      { id: 'compliance-payments-security', reason: 'Covered by Architecture/Database Summary already.' },
      { id: 'approved-backend-draft', reason: 'Backend Engineer role is not implemented yet.' },
    ],
    taskCategories: ['deployment'],
    requiredUpstream: [
      {
        check: (ctx) => Boolean(ctx.architecture),
        message: 'Architecture Draft is not approved yet — DevOps Engineer context will be incomplete.',
      },
    ],
  },
};

export interface BuildContextBundleOptions {
  budget?: ContextBudget;
  taskId?: string;
  includeFullArtifacts?: boolean;
}

/**
 * Builds a structured, token-budgeted context bundle for a given AI role —
 * never a prompt string. Deterministic and AI-free: every section is
 * derived from already-approved artifacts and stored project data via the
 * summarizers above. Sections are considered in the role's priority order;
 * once adding the next section would exceed the budget, it and everything
 * after it are excluded as budget-trimmed rather than included.
 */
export function buildContextBundle(
  project: Project,
  role: ContextRole,
  options: BuildContextBundleOptions = {},
): ContextBundle {
  const budget = options.budget ?? 'medium';
  const budgetLimit = CONTEXT_BUDGET_LIMITS[budget];
  const roleConfig = ROLE_CONFIGS[role];
  const includeFullArtifacts = options.includeFullArtifacts ?? false;

  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);
  const artifacts = getProjectArtifacts(project);
  const architecture = getApprovedArtifactContent<ArchitectureDraft>(artifacts, ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
  const database = getApprovedArtifactContent<DatabaseDraft>(artifacts, ARTIFACT_TYPES.DATABASE_DRAFT);
  const uiux = getApprovedArtifactContent<UIUXDraft>(artifacts, ARTIFACT_TYPES.UIUX_DRAFT);

  const roadmap = blueprintEngine.getRoadmap(blueprint.id).map((item) => ({
    title: item.title,
    description: item.description,
    status: getRoadmapItemStatus(project, item.key),
  }));

  const tasks = executionEngine.getExecutionTasks(project);
  const currentTask = options.taskId ? tasks.find((task) => task.id === options.taskId) : undefined;
  const notesText = [knowledge?.notes, getTaskNotes(project, options.taskId ?? 'requirements')]
    .filter(Boolean)
    .join('\n\n');

  const ctx: SectionContext = {
    project,
    blueprint: { name: blueprint.name, category: blueprint.category, productType: blueprint.productType },
    knowledge,
    knowledgeCompletion: projectKnowledgeEngine.getCompletion(knowledge).overall,
    architecture,
    database,
    uiux,
    roadmap,
    tasks,
    notesText,
    currentTask,
    includeFullArtifacts,
  };

  /*
   * Frontend Engineer's "database internals unless required" rule — the
   * only place a caller-supplied option (rather than the role alone)
   * changes which sections apply. Promoting these two out of
   * hardExcludedIds and into the priority list is the deterministic
   * reading of "required" for this sprint.
   */
  let sectionIds = [...roleConfig.sectionIds];
  let hardExcludedIds = roleConfig.hardExcludedIds;

  if (role === 'frontend-engineer' && includeFullArtifacts) {
    const promoted = new Set<ContextSectionId>(['database-summary', 'entities']);
    sectionIds = [...sectionIds, ...hardExcludedIds.filter((entry) => promoted.has(entry.id)).map((entry) => entry.id)];
    hardExcludedIds = hardExcludedIds.filter((entry) => !promoted.has(entry.id));
  }

  const priorityIds: ContextSectionId[] = currentTask ? ['current-task', ...sectionIds] : sectionIds;

  const candidates: ContextSection[] = [];
  const missing: { id: ContextSectionId; label: string }[] = [];

  for (const id of priorityIds) {
    const definition = SECTION_DEFS[id];
    const content = definition.build(ctx, roleConfig);

    if (content && content.trim().length > 0) {
      candidates.push({ id, label: definition.label, content, estimatedTokens: estimateTokens(content) });
    } else {
      missing.push({ id, label: definition.label });
    }
  }

  const includedSections: ContextSection[] = [];
  const excludedSections: ExcludedContextSection[] = [];
  let runningTotal = 0;

  for (const candidate of candidates) {
    if (runningTotal + candidate.estimatedTokens <= budgetLimit) {
      includedSections.push(candidate);
      runningTotal += candidate.estimatedTokens;
    } else {
      excludedSections.push({
        id: candidate.id,
        label: candidate.label,
        reason: `Excluded to stay within the ${budget} token budget (${budgetLimit} tokens).`,
      });
    }
  }

  for (const entry of missing) {
    excludedSections.push({
      id: entry.id,
      label: entry.label,
      reason: entry.id === 'approved-backend-draft' ? NOT_YET_IMPLEMENTED_REASON : NOT_AVAILABLE_REASON,
    });
  }

  for (const entry of hardExcludedIds) {
    excludedSections.push({ id: entry.id, label: SECTION_DEFS[entry.id].label, reason: entry.reason });
  }

  const warnings: string[] = [];
  const trimmedCount = candidates.length - includedSections.length;

  if (trimmedCount > 0) {
    warnings.push(
      `${trimmedCount} section(s) were trimmed to stay within the ${budget} budget (${budgetLimit} tokens). Consider a larger budget for more complete context.`,
    );
  }

  for (const upstream of roleConfig.requiredUpstream) {
    if (!upstream.check(ctx)) {
      warnings.push(upstream.message);
    }
  }

  const estimatedTokens = includedSections.reduce((sum, section) => sum + section.estimatedTokens, 0);
  const summary = `${roleConfig.label} context: ${includedSections.length} section(s) included (~${estimatedTokens} of ${budgetLimit} token ${budget} budget), ${excludedSections.length} section(s) excluded.`;

  return { role, budget, includedSections, excludedSections, estimatedTokens, warnings, summary };
}

/**
 * Sprint 17 adapter path — TODO for a future sprint: once Backend Engineer /
 * Frontend Engineer / QA Engineer / DevOps Engineer are implemented, their
 * `prompts/*.ts` user-prompt builders should call buildContextBundle() and
 * feed `includedSections` through this formatter instead of hand-assembling
 * full context the way businessAnalystEngine.ts, solutionArchitectEngine.ts,
 * databaseDesignerEngine.ts, and uiuxDesignerEngine.ts do today. None of
 * those four existing engines call this yet — adopting the Context Engine
 * is deliberately deferred so this sprint changes no existing generation
 * behavior.
 */
export function formatContextBundleForPrompt(bundle: ContextBundle): string {
  const sections = bundle.includedSections.map((section) => `### ${section.label}\n${section.content}`).join('\n\n');
  return sections.length > 0 ? sections : 'No context sections included.';
}

export const contextEngine = {
  buildContextBundle,
  formatContextBundleForPrompt,
  estimateTokens,
  summarizeRequirements,
  summarizeArchitecture,
  summarizeDatabase,
  summarizeUIUX,
};
