import { blueprintEngine } from '~/lib/blueprints';
import { getProjectKnowledge, getRoadmapItemStatus, type Project } from '~/lib/stores/projects';
import type { ProjectKnowledge } from './knowledge';

/**
 * Project Knowledge Engine — Phase 2 Sprint 10 ("AI Project Manager /
 * Requirements Intelligence").
 *
 * This is the architecture layer that lets Builders "think like a Product
 * Manager" about a project's Requirements without calling an LLM: grouped
 * sections, completion tracking, blueprint-aware recommended fields, a
 * derived Requirement Summary, and overall Project Readiness. Everything
 * here is plain data + arithmetic over whatever the user has already typed
 * into the Requirements dialog — no AI call, no code generation, no
 * network request.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> ...
 *
 * UI components (ProjectRequirementsDialog, ProjectDashboard) should read
 * everything through `projectKnowledgeEngine` below rather than hardcoding
 * section/field/recommendation lists inline — same convention as
 * `blueprintEngine` for blueprint data.
 */

export type KnowledgeFieldKind = 'text' | 'textarea' | 'list';

/** Every ProjectKnowledge field the Requirements dialog can edit. */
export type KnowledgeFieldKey = keyof ProjectKnowledge;

export interface KnowledgeFieldConfig {
  key: KnowledgeFieldKey;
  label: string;
  kind: KnowledgeFieldKind;
  placeholder?: string;
}

export type KnowledgeSectionId = 'business' | 'product' | 'technical' | 'businessOperations' | 'brand' | 'notes';

export interface KnowledgeSectionConfig {
  id: KnowledgeSectionId;
  label: string;

  /** Whether this section starts expanded the first time a project opens the Requirements dialog — Task 2. */
  defaultExpanded: boolean;
  fields: KnowledgeFieldConfig[];
}

/**
 * Task 1 — grouped Requirements sections. This is the single source of
 * truth for both the form layout and the completion math below; nothing
 * about section/field grouping should be duplicated in the UI.
 */
export const KNOWLEDGE_SECTIONS: KnowledgeSectionConfig[] = [
  {
    id: 'business',
    label: 'Business',
    defaultExpanded: true,
    fields: [
      {
        key: 'projectVision',
        label: 'Project Vision',
        kind: 'textarea',
        placeholder: 'What is this product, in a sentence or two?',
      },
      { key: 'industry', label: 'Industry', kind: 'text', placeholder: 'e.g. Construction, Retail, Healthcare' },
      {
        key: 'businessModel',
        label: 'Business Model',
        kind: 'text',
        placeholder: 'e.g. One-time projects, subscriptions',
      },
      { key: 'targetUsers', label: 'Target Users', kind: 'text', placeholder: 'Who is this for?' },
      { key: 'languages', label: 'Languages', kind: 'list', placeholder: 'e.g. English, Hindi, Tamil, Malayalam' },
      { key: 'location', label: 'Region', kind: 'text', placeholder: 'e.g. India, Tamil Nadu, Global' },
    ],
  },
  {
    id: 'product',
    label: 'Product',
    defaultExpanded: false,
    fields: [
      { key: 'coreFeatures', label: 'Core Features', kind: 'list', placeholder: 'e.g. Login, Search, Checkout' },
      { key: 'pagesOrScreens', label: 'Pages / Screens', kind: 'list', placeholder: 'e.g. Home, Dashboard, Settings' },
      { key: 'userRoles', label: 'User Roles', kind: 'list', placeholder: 'e.g. Admin, Member' },
    ],
  },
  {
    id: 'technical',
    label: 'Technical',
    defaultExpanded: false,
    fields: [
      { key: 'integrations', label: 'Integrations', kind: 'list', placeholder: 'e.g. WhatsApp, Google Maps' },
      {
        key: 'technicalPreferences',
        label: 'Technical Preferences',
        kind: 'textarea',
        placeholder: 'e.g. preferred stack, hosting, constraints',
      },
    ],
  },
  {
    id: 'businessOperations',
    label: 'Business Operations',
    defaultExpanded: false,
    fields: [
      {
        key: 'paymentNeeds',
        label: 'Payments',
        kind: 'list',
        placeholder: 'e.g. Razorpay, UPI, PhonePe, Paytm, Cashfree',
      },
      { key: 'complianceNeeds', label: 'GST / Compliance', kind: 'list', placeholder: 'e.g. GST, Invoice generation' },
      { key: 'shippingNeeds', label: 'Shipping', kind: 'list', placeholder: 'e.g. Shiprocket, Delhivery' },
    ],
  },
  {
    id: 'brand',
    label: 'Brand',
    defaultExpanded: false,
    fields: [
      { key: 'brandTone', label: 'Tone', kind: 'text', placeholder: 'e.g. friendly, professional, premium' },
      {
        key: 'designPreferences',
        label: 'Design Preferences',
        kind: 'textarea',
        placeholder: 'e.g. colors, style references',
      },
    ],
  },
  {
    id: 'notes',
    label: 'Notes',
    defaultExpanded: false,
    fields: [{ key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'Anything else worth capturing.' }],
  },
];

const ALL_FIELDS: KnowledgeFieldConfig[] = KNOWLEDGE_SECTIONS.flatMap((section) => section.fields);

function getFieldConfig(key: KnowledgeFieldKey): KnowledgeFieldConfig | undefined {
  return ALL_FIELDS.find((field) => field.key === key);
}

/**
 * Phase 3 (Task Engine) — a `ProjectKnowledge` field's display label, e.g.
 * "projectVision" -> "Project Vision". Added so the Task Execution Plan's
 * "Knowledge Required" badges (ProjectDashboard) can render human-readable
 * labels for `ProjectTask.requiredKnowledge` entries without re-deriving the
 * section/field list that already lives here. Falls back to the raw key for
 * anything not found in KNOWLEDGE_SECTIONS (should not happen in practice).
 */
function getFieldLabel(key: KnowledgeFieldKey): string {
  return getFieldConfig(key)?.label ?? key;
}

/**
 * Task 4 — recommended (not required) fields per blueprint. `ProjectKnowledge`
 * intentionally stays one generic shape across every blueprint (see
 * knowledge.ts), so "recommended fields" maps the sprint spec's example
 * concepts (e.g. AI Agent's "Tools / Memory / Workflows") onto the closest
 * existing generic field rather than inventing per-blueprint knowledge
 * variants. This never blocks saving — it only drives "missing" hints.
 */
const RECOMMENDED_FIELDS_BY_BLUEPRINT: Record<string, KnowledgeFieldKey[]> = {
  'business-website': ['projectVision', 'pagesOrScreens', 'location', 'languages', 'coreFeatures'],
  'localshop-india': ['complianceNeeds', 'paymentNeeds', 'shippingNeeds', 'userRoles', 'coreFeatures'],
  'shopify-app': ['projectVision', 'integrations', 'technicalPreferences'],
  'ai-agent': ['projectVision', 'coreFeatures', 'integrations', 'notes'],
  'saas-starter': ['projectVision', 'targetUsers', 'paymentNeeds', 'userRoles'],
  'nextjs-saas': ['projectVision', 'targetUsers', 'paymentNeeds'],
  'mobile-app': ['projectVision', 'targetUsers', 'coreFeatures'],
  'marketing-website': ['projectVision', 'pagesOrScreens', 'targetUsers'],
  'blank-project': ['projectVision'],
};

const DEFAULT_RECOMMENDED_FIELDS: KnowledgeFieldKey[] = ['projectVision', 'targetUsers', 'coreFeatures'];

function getRecommendedFields(blueprintId: string | undefined): KnowledgeFieldKey[] {
  if (!blueprintId) {
    return DEFAULT_RECOMMENDED_FIELDS;
  }

  return RECOMMENDED_FIELDS_BY_BLUEPRINT[blueprintId] ?? DEFAULT_RECOMMENDED_FIELDS;
}

function isFieldFilled(knowledge: ProjectKnowledge | undefined, key: KnowledgeFieldKey): boolean {
  const value = knowledge?.[key];

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return typeof value === 'string' && value.trim().length > 0;
}

export type SectionCompletionStatus = 'not-started' | 'in-progress' | 'completed';

export interface SectionCompletion {
  id: KnowledgeSectionId;
  label: string;
  percent: number;
  status: SectionCompletionStatus;
}

export interface KnowledgeCompletion {
  overall: number;
  sections: SectionCompletion[];
}

function statusForPercent(percent: number): SectionCompletionStatus {
  if (percent >= 100) {
    return 'completed';
  }

  if (percent <= 0) {
    return 'not-started';
  }

  return 'in-progress';
}

/**
 * Task 3 — Requirements Completion, local only. Per-section percent is
 * (# filled fields) / (# fields in that section); overall is the average
 * of all fields across every section (not just recommended ones).
 */
function getCompletion(knowledge: ProjectKnowledge | undefined): KnowledgeCompletion {
  const sections = KNOWLEDGE_SECTIONS.map((section) => {
    const filledCount = section.fields.filter((field) => isFieldFilled(knowledge, field.key)).length;
    const percent = section.fields.length > 0 ? Math.round((filledCount / section.fields.length) * 100) : 0;

    return {
      id: section.id,
      label: section.label,
      percent,
      status: statusForPercent(percent),
    };
  });

  const totalFields = ALL_FIELDS.length;
  const totalFilled = ALL_FIELDS.filter((field) => isFieldFilled(knowledge, field.key)).length;
  const overall = totalFields > 0 ? Math.round((totalFilled / totalFields) * 100) : 0;

  return { overall, sections };
}

/**
 * Task 4/7 — recommended fields for this project's blueprint that are still
 * empty. Used to show gentle "recommended" hints, never a hard validation
 * gate (saving is always allowed with zero fields filled).
 */
function getMissingFields(
  knowledge: ProjectKnowledge | undefined,
  blueprintId: string | undefined,
): KnowledgeFieldConfig[] {
  return getRecommendedFields(blueprintId)
    .filter((key) => !isFieldFilled(knowledge, key))
    .map((key) => getFieldConfig(key))
    .filter((field): field is KnowledgeFieldConfig => Boolean(field));
}

export type ReadinessStageStatus = 'not-started' | 'in-progress' | 'completed';

export interface ReadinessStage {
  id: string;
  label: string;
  status: ReadinessStageStatus;
  percent?: number;
}

/**
 * Task 5 — Project Readiness, the high-level progress indicator for the
 * whole project lifecycle. Requirements and Roadmap are computed from real
 * local data; Design/Database/Frontend/Backend/Deployment have no data
 * source yet (no such systems exist in this sprint) so they always read
 * "Not Started" — future sprints can wire real signals into those stages
 * without changing this function's shape.
 */
function getReadiness(project: Project): ReadinessStage[] {
  const requirementsCompletion = getCompletion(getProjectKnowledge(project));

  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const roadmap = blueprintEngine.getRoadmap(blueprint.id);
  const completedRoadmapCount = roadmap.filter(
    (item) => getRoadmapItemStatus(project, item.key) === 'completed',
  ).length;
  const roadmapPercent = roadmap.length > 0 ? Math.round((completedRoadmapCount / roadmap.length) * 100) : 0;

  return [
    {
      id: 'requirements',
      label: 'Requirements',
      status: statusForPercent(requirementsCompletion.overall),
      percent: requirementsCompletion.overall,
    },
    {
      id: 'roadmap',
      label: 'Roadmap',
      status: statusForPercent(roadmapPercent),
      percent: roadmapPercent,
    },
    { id: 'design', label: 'Design', status: 'not-started' },
    { id: 'database', label: 'Database', status: 'not-started' },
    { id: 'frontend', label: 'Frontend', status: 'not-started' },
    { id: 'backend', label: 'Backend', status: 'not-started' },
    { id: 'deployment', label: 'Deployment', status: 'not-started' },
  ];
}

export interface RequirementSummary {
  productType?: string;
  target?: string;
  audience?: string;
  languages: string[];
  pages: string[];
  payments: string[];
}

/**
 * Task 6 — automatically generated (no AI) live summary of captured
 * knowledge. Pure projection over whatever is currently filled in — safe to
 * call on every keystroke from in-progress form state, not just saved data.
 */
function getSummary(knowledge: ProjectKnowledge | undefined, blueprintName: string | undefined): RequirementSummary {
  return {
    productType: blueprintName,
    target: knowledge?.targetUsers,
    audience: knowledge?.location,
    languages: knowledge?.languages ?? [],
    pages: knowledge?.pagesOrScreens ?? [],
    payments: knowledge?.paymentNeeds ?? [],
  };
}

export const projectKnowledgeEngine = {
  getSections: () => KNOWLEDGE_SECTIONS,
  getRecommendedFields,
  getCompletion,
  getMissingFields,
  getReadiness,
  getSummary,
  getFieldLabel,
};
