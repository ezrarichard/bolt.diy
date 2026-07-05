import type { Project } from '~/lib/stores/projects';
import { getProjectArtifacts } from '~/lib/stores/projects';
import { ARTIFACT_TYPES, getApprovedArtifactContent } from './artifacts';
import type { ArchitectureDraft } from './prompts/architecture';
import type { DatabaseDraft } from './prompts/database';
import type { BackendDraft } from './prompts/backend';
import type { FrontendDraft } from './prompts/frontend';
import type { QADraft } from './prompts/qa';
import type { DevOpsDraft } from './prompts/devops';
import { CONTEXT_ROLES, type ContextBudget, type ContextRole } from './contextEngine';
import { projectManagerEngine } from './projectManagerEngine';

/**
 * Generation Planner Engine — Sprint 25 ("Generation Engine Foundation").
 *
 *   Business Analyst -> Solution Architect -> Database Designer
 *     -> UI/UX Designer -> Backend Engineer -> Frontend Engineer
 *       -> QA Engineer -> DevOps Engineer -> Project Manager
 *         -> Generation Planner Engine (this file) -> Generation Engine (future)
 *
 * This is a compiler PLANNER, not a compiler. It reads the same approved
 * artifacts every engineering role already produces and turns them into a
 * deterministic `GenerationPlan` — phases, modules, estimated file groups,
 * a dependency graph, and a recommended model/context-budget/context-role
 * classification per task. It never writes a filename, never generates a
 * line of code, configuration, SQL, or infrastructure, and never calls an
 * LLM, GitHub, Supabase, or any deployment target.
 *
 * Pure and deterministic: every function here is a plain read over a
 * `Project`. Calling `buildGenerationPlan(project)` twice with no state
 * change in between always returns a structurally identical plan — there is
 * no timestamp, random id, or other non-deterministic field anywhere in the
 * output. No React, no nanostore subscriptions, no AI provider imports, no
 * network access, no filesystem access.
 *
 * Readiness is never recomputed here — `projectManagerEngine.isReadyForGeneration`
 * (Sprint 23) is the single source of truth for "is this project ready for
 * code generation," and this engine only reads its result.
 *
 * `CONTEXT_ROLES`/`ContextRole`/`ContextBudget` are imported from
 * contextEngine.ts as the shared vocabulary this planner classifies against
 * (see `requiredContextRoles`/`contextBudget` below) — this file never calls
 * `buildContextBundle` and never builds a prompt string. That remains the
 * Context Engine's job once real generation exists.
 */

export type GenerationPhaseId = 'foundation' | 'database' | 'backend' | 'frontend' | 'testing' | 'deployment';

export type ModuleOrigin = 'inferred' | 'default';

export type GenerationComplexity = 'low' | 'medium' | 'high';

export type GenerationMode = 'single-file' | 'feature-slice' | 'multi-module' | 'project-wide';

/**
 * Our four primary models (see CLAUDE.md / system model list). Sprint 30.5 —
 * Claude Sonnet 5 is now the platform default for every classification
 * tier, including project-wide/high-complexity work that previously
 * recommended Opus; Haiku is still used for the smallest single-file helper
 * tasks. Fable has no natural trigger in this deterministic engineering
 * pipeline today (there is no creative-copy/marketing phase) — the type
 * still includes Opus and Fable so a future model-selector UI (and a future
 * phase, e.g. marketing copy generation) can classify/select either without
 * widening this union again; see `deriveRecommendedModel` below.
 */
export type RecommendedModel = 'claude-sonnet-5' | 'claude-opus-4-8' | 'claude-fable-5' | 'claude-haiku-4-5-20251001';

export const RECOMMENDED_MODEL_LABELS: Record<RecommendedModel, string> = {
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-fable-5': 'Claude Fable 5',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
};

export type GenerationFileGroup =
  | 'frontend-components'
  | 'frontend-pages'
  | 'backend-apis'
  | 'database-models'
  | 'configuration'
  | 'documentation'
  | 'tests'
  | 'infrastructure';

export const GENERATION_FILE_GROUP_LABELS: Record<GenerationFileGroup, string> = {
  'frontend-components': 'Frontend Components',
  'frontend-pages': 'Frontend Pages',
  'backend-apis': 'Backend APIs',
  'database-models': 'Database Models',
  configuration: 'Configuration',
  documentation: 'Documentation',
  tests: 'Tests',
  infrastructure: 'Infrastructure',
};

export interface GenerationFile {
  group: GenerationFileGroup;
  purpose: string;

  /** An estimate, not a plan of actual filenames — see the file-level "Do NOT create filenames yet" constraint. */
  estimatedCount: number;
}

/** One module's place in the dependency graph — see `attachModuleDependencies` below for how these are computed. */
export interface GenerationDependency {
  /** Module ids that must be complete before this module can start. */
  dependsOn: string[];

  /** Phase ids that cannot begin until this module's entire phase is complete (coarse, phase-level gate). */
  requiredBefore: GenerationPhaseId[];

  /** Module ids that become eligible once this module is complete — the reverse of `dependsOn`, computed once. */
  unblocks: string[];
}

export interface GenerationTask {
  id: string;
  moduleId: string;
  title: string;
  description: string;
  complexity: GenerationComplexity;
  generationMode: GenerationMode;
  recommendedModel: RecommendedModel;
  contextBudget: ContextBudget;

  /** Which Context Engine roles' approved context this task would need — never fetched or built here, just classified. */
  requiredContextRoles: ContextRole[];
}

export interface GenerationModule {
  id: string;
  phaseId: GenerationPhaseId;
  title: string;
  description: string;

  /** Whether `title` (and the module's existence) was inferred from an approved artifact field, or is a deterministic default used because that field was empty/unapproved. */
  origin: ModuleOrigin;
  files: GenerationFile[];
  tasks: GenerationTask[];
  dependencies: GenerationDependency;
}

export interface GenerationPhase {
  id: GenerationPhaseId;
  order: number;
  title: string;
  description: string;
  moduleIds: string[];
}

export interface GenerationSummary {
  totalPhases: number;
  totalModules: number;
  totalTasks: number;
  totalEstimatedFiles: number;

  /** Module ids in the order generation would run them — phase order, then module order within each phase. */
  recommendedGenerationOrder: string[];
}

export interface GenerationPlan {
  projectId: string;

  /** Read straight from projectManagerEngine.isReadyForGeneration(project) — never recomputed here. */
  readyForGeneration: boolean;
  readinessBlockers: string[];
  phases: GenerationPhase[];
  modules: GenerationModule[];
  summary: GenerationSummary;
}

/**
 * The six phases, in the fixed order every downstream consumer (the
 * dependency graph, the dashboard's "Recommended Generation Order") relies
 * on. Deliberately static — phase identity/order is never derived from
 * artifacts, only the modules within each phase are.
 */
const PHASE_DEFINITIONS: { id: GenerationPhaseId; title: string; description: string }[] = [
  {
    id: 'foundation',
    title: 'Project Foundation',
    description: 'Base project scaffold, configuration, and environment setup.',
  },
  {
    id: 'database',
    title: 'Database',
    description: 'Schema and data model for the approved entities.',
  },
  {
    id: 'backend',
    title: 'Backend',
    description: 'APIs and business logic for the approved backend design.',
  },
  {
    id: 'frontend',
    title: 'Frontend',
    description: 'Pages and components for the approved UI/UX and frontend design.',
  },
  {
    id: 'testing',
    title: 'Testing',
    description: 'Automated test coverage for the approved QA strategy.',
  },
  {
    id: 'deployment',
    title: 'Deployment',
    description: 'CI/CD, hosting, and operational setup for the approved DevOps strategy.',
  },
];

/** Fixed file-group template per phase — deterministic estimate per module, never an actual filename. */
const PHASE_FILE_TEMPLATES: Record<
  GenerationPhaseId,
  { group: GenerationFileGroup; purpose: string; filesPerModule: number }[]
> = {
  foundation: [
    { group: 'configuration', purpose: 'Project-level configuration and environment setup', filesPerModule: 2 },
    { group: 'documentation', purpose: 'Baseline project documentation', filesPerModule: 1 },
  ],
  database: [
    { group: 'database-models', purpose: "Schema/model definition for this module's entities", filesPerModule: 2 },
  ],
  backend: [{ group: 'backend-apis', purpose: 'API routes and service logic for this module', filesPerModule: 3 }],
  frontend: [
    { group: 'frontend-pages', purpose: 'Pages/routes for this module', filesPerModule: 1 },
    { group: 'frontend-components', purpose: 'Reusable UI components supporting this module', filesPerModule: 2 },
  ],
  testing: [{ group: 'tests', purpose: 'Automated tests covering this module', filesPerModule: 2 }],
  deployment: [
    { group: 'infrastructure', purpose: 'Deployment/infrastructure configuration for this module', filesPerModule: 1 },
  ],
};

/**
 * Which Context Engine roles' approved output a phase's generation tasks
 * would need — the same pipeline order every engine's own context-gathering
 * function already reads (e.g. backendEngineerEngine.buildBackendContext
 * reads architecture+database+uiux). Each phase's cutoff role names the
 * last role whose context is required; `requiredContextRoles` is simply
 * every role up to and including that one, sliced from the Context Engine's
 * own `CONTEXT_ROLES` order — never a hand-maintained, possibly-divergent
 * list.
 */
const PHASE_CONTEXT_ROLE_CUTOFF: Record<GenerationPhaseId, ContextRole> = {
  foundation: 'solution-architect',
  database: 'database-designer',
  backend: 'backend-engineer',
  frontend: 'frontend-engineer',
  testing: 'qa-engineer',
  deployment: 'devops-engineer',
};

function getRequiredContextRoles(phaseId: GenerationPhaseId): ContextRole[] {
  const cutoff = PHASE_CONTEXT_ROLE_CUTOFF[phaseId];
  return CONTEXT_ROLES.slice(0, CONTEXT_ROLES.indexOf(cutoff) + 1);
}

/** QA Draft strategy fields used to infer Testing-phase modules — present ones become modules, matching "infer from approved artifacts where possible." */
const QA_STRATEGY_MODULE_FIELDS: { key: keyof QADraft; title: string }[] = [
  { key: 'unitTestingStrategy', title: 'Unit Testing' },
  { key: 'integrationTestingStrategy', title: 'Integration Testing' },
  { key: 'endToEndTestingStrategy', title: 'End-to-End Testing' },
  { key: 'apiTestingStrategy', title: 'API Testing' },
  { key: 'securityTestingStrategy', title: 'Security Testing' },
  { key: 'performanceTestingStrategy', title: 'Performance Testing' },
  { key: 'accessibilityTestingStrategy', title: 'Accessibility Testing' },
];

/** DevOps Draft strategy fields used to infer Deployment-phase modules, same idea as QA above. */
const DEVOPS_STRATEGY_MODULE_FIELDS: { key: keyof DevOpsDraft; title: string }[] = [
  { key: 'ciStrategy', title: 'CI Pipeline' },
  { key: 'cdStrategy', title: 'CD Pipeline' },
  { key: 'monitoringStrategy', title: 'Monitoring & Observability' },
  { key: 'hostingRecommendation', title: 'Hosting & Infrastructure' },
  { key: 'backupStrategy', title: 'Backup & Restore' },
];

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '') || 'module'
  );
}

interface ModuleSeeds {
  seeds: string[];
  origin: ModuleOrigin;
}

/** "Use the artifact's list if it has anything, otherwise fall back to deterministic defaults" — the one inference rule every phase below is built from. */
function resolveModuleSeeds(list: string[] | undefined, defaults: string[]): ModuleSeeds {
  return list && list.length > 0 ? { seeds: list, origin: 'inferred' } : { seeds: defaults, origin: 'default' };
}

function resolveStrategyFieldSeeds<T>(draft: T | undefined, fields: { key: keyof T; title: string }[]): ModuleSeeds {
  const present = fields.filter((field) => Boolean(draft?.[field.key])).map((field) => field.title);
  return present.length > 0 ? { seeds: present, origin: 'inferred' } : { seeds: [], origin: 'default' };
}

/**
 * One module's seed titles per phase. Database/Backend/Frontend infer
 * directly from the corresponding draft's own list fields (entities,
 * businessServices, pageHierarchy); Backend additionally falls back to the
 * Architecture Draft's `applicationModules` before its own deterministic
 * default, since that's the next-most-specific already-approved signal.
 * Foundation has no artifact field that naturally maps to "scaffold
 * structure," so it is always the same two deterministic modules.
 */
function getPhaseModuleSeeds(
  phaseId: GenerationPhaseId,
  artifacts: ReturnType<typeof getProjectArtifacts>,
): ModuleSeeds {
  switch (phaseId) {
    case 'foundation':
      return { seeds: ['Project Scaffold', 'Environment & Configuration'], origin: 'default' };

    case 'database': {
      const database = getApprovedArtifactContent<DatabaseDraft>(artifacts, ARTIFACT_TYPES.DATABASE_DRAFT);
      return resolveModuleSeeds(database?.entities, ['Core Schema']);
    }

    case 'backend': {
      const backend = getApprovedArtifactContent<BackendDraft>(artifacts, ARTIFACT_TYPES.BACKEND_DRAFT);

      if (backend?.businessServices?.length) {
        return { seeds: backend.businessServices, origin: 'inferred' };
      }

      const architecture = getApprovedArtifactContent<ArchitectureDraft>(artifacts, ARTIFACT_TYPES.ARCHITECTURE_DRAFT);

      return resolveModuleSeeds(architecture?.applicationModules, ['Core API']);
    }

    case 'frontend': {
      const frontend = getApprovedArtifactContent<FrontendDraft>(artifacts, ARTIFACT_TYPES.FRONTEND_DRAFT);
      return resolveModuleSeeds(frontend?.pageHierarchy, ['Core UI']);
    }

    case 'testing': {
      const qa = getApprovedArtifactContent<QADraft>(artifacts, ARTIFACT_TYPES.QA_DRAFT);
      const inferred = resolveStrategyFieldSeeds(qa, QA_STRATEGY_MODULE_FIELDS);

      return inferred.seeds.length > 0 ? inferred : { seeds: ['Core Test Suite'], origin: 'default' };
    }

    case 'deployment': {
      const devops = getApprovedArtifactContent<DevOpsDraft>(artifacts, ARTIFACT_TYPES.DEVOPS_DRAFT);
      const inferred = resolveStrategyFieldSeeds(devops, DEVOPS_STRATEGY_MODULE_FIELDS);

      return inferred.seeds.length > 0 ? inferred : { seeds: ['Deployment Configuration'], origin: 'default' };
    }

    default: {
      const exhaustiveCheck: never = phaseId;
      return exhaustiveCheck;
    }
  }
}

/**
 * Complexity is a deterministic function of estimated file count, with a
 * small bump for Database/Backend — core logic phases are rarely "low"
 * effort even when a module only touches a couple of files.
 */
function deriveComplexity(phaseId: GenerationPhaseId, totalFiles: number): GenerationComplexity {
  const base: GenerationComplexity = totalFiles <= 2 ? 'low' : totalFiles <= 5 ? 'medium' : 'high';

  if (base === 'low' && (phaseId === 'backend' || phaseId === 'database')) {
    return 'medium';
  }

  return base;
}

/** Foundation and Deployment touch the whole project rather than one feature, so they're always project-wide regardless of file count. */
function deriveGenerationMode(phaseId: GenerationPhaseId, totalFiles: number): GenerationMode {
  if (phaseId === 'foundation' || phaseId === 'deployment') {
    return 'project-wide';
  }

  if (totalFiles <= 1) {
    return 'single-file';
  }

  if (totalFiles <= 6) {
    return 'feature-slice';
  }

  return 'multi-module';
}

/**
 * Classification only — never invokes a model. Sprint 30.5 — the
 * project-wide/high-complexity tier is kept as its own branch (rather than
 * folded into the final default) so a future model-selector UI still has a
 * distinct classification to map to a non-default model; today it resolves
 * to the same platform default (Sonnet 5) as everything else except the
 * single-file/low-complexity tier below. See the model-strategy note on
 * `RecommendedModel` above for why Fable never appears here.
 */
function deriveRecommendedModel(complexity: GenerationComplexity, generationMode: GenerationMode): RecommendedModel {
  if (generationMode === 'project-wide' || (complexity === 'high' && generationMode === 'multi-module')) {
    return 'claude-sonnet-5';
  }

  if (complexity === 'low' && generationMode === 'single-file') {
    return 'claude-haiku-4-5-20251001';
  }

  return 'claude-sonnet-5';
}

function deriveContextBudget(complexity: GenerationComplexity, generationMode: GenerationMode): ContextBudget {
  if (generationMode === 'project-wide' || complexity === 'high') {
    return 'large';
  }

  if (complexity === 'medium') {
    return 'medium';
  }

  return 'small';
}

/** `unblocks` is the reverse of `dependsOn`, computed once — same pattern as taskEngine.ts's `nextTasks` (the reverse of `dependsOn`), so it's never hand-maintained per module. */
function attachUnblocks(modules: GenerationModule[]): GenerationModule[] {
  const unblocksById = new Map<string, string[]>(modules.map((module) => [module.id, []]));

  for (const module of modules) {
    for (const dependencyId of module.dependencies.dependsOn) {
      unblocksById.get(dependencyId)?.push(module.id);
    }
  }

  return modules.map((module) => ({
    ...module,
    dependencies: { ...module.dependencies, unblocks: unblocksById.get(module.id) ?? [] },
  }));
}

/**
 * Builds the deterministic generation plan for a project. Never generates
 * code, never creates a file, never calls an LLM/GitHub/Supabase/deployment
 * target, and never mutates the project or any store — every value here is
 * derived purely from already-approved artifacts (read via
 * getApprovedArtifactContent, same accessor every engineering role's own
 * context builder already uses) plus the six static phase/file/context-role
 * tables above.
 */
function buildGenerationPlan(project: Project): GenerationPlan {
  const artifacts = getProjectArtifacts(project);

  const phases: GenerationPhase[] = PHASE_DEFINITIONS.map((definition, index) => ({
    id: definition.id,
    order: index + 1,
    title: definition.title,
    description: definition.description,
    moduleIds: [],
  }));

  const modules: GenerationModule[] = [];
  let previousPhaseModuleIds: string[] = [];

  PHASE_DEFINITIONS.forEach((definition, index) => {
    const { seeds, origin } = getPhaseModuleSeeds(definition.id, artifacts);
    const nextPhaseId = PHASE_DEFINITIONS[index + 1]?.id;
    const fileTemplates = PHASE_FILE_TEMPLATES[definition.id];
    const requiredContextRoles = getRequiredContextRoles(definition.id);

    const phaseModules: GenerationModule[] = seeds.map((seed) => {
      const id = `${definition.id}-${slugify(seed)}`;

      const files: GenerationFile[] = fileTemplates.map((template) => ({
        group: template.group,
        purpose: template.purpose,
        estimatedCount: template.filesPerModule,
      }));

      const totalFiles = files.reduce((sum, file) => sum + file.estimatedCount, 0);
      const complexity = deriveComplexity(definition.id, totalFiles);
      const generationMode = deriveGenerationMode(definition.id, totalFiles);
      const recommendedModel = deriveRecommendedModel(complexity, generationMode);
      const contextBudget = deriveContextBudget(complexity, generationMode);

      const task: GenerationTask = {
        id: `${id}-task`,
        moduleId: id,
        title: `Generate ${seed}`,
        description: `${definition.title} work for the "${seed}" module.`,
        complexity,
        generationMode,
        recommendedModel,
        contextBudget,
        requiredContextRoles,
      };

      return {
        id,
        phaseId: definition.id,
        title: seed,
        description: `${seed} — part of the ${definition.title} phase.`,
        origin,
        files,
        tasks: [task],
        dependencies: {
          dependsOn: previousPhaseModuleIds,
          requiredBefore: nextPhaseId ? [nextPhaseId] : [],
          unblocks: [],
        },
      };
    });

    phases[index].moduleIds = phaseModules.map((module) => module.id);
    modules.push(...phaseModules);
    previousPhaseModuleIds = phaseModules.map((module) => module.id);
  });

  const modulesWithUnblocks = attachUnblocks(modules);

  const totalTasks = modulesWithUnblocks.reduce((sum, module) => sum + module.tasks.length, 0);
  const totalEstimatedFiles = modulesWithUnblocks.reduce(
    (sum, module) => sum + module.files.reduce((fileSum, file) => fileSum + file.estimatedCount, 0),
    0,
  );

  const summary: GenerationSummary = {
    totalPhases: phases.length,
    totalModules: modulesWithUnblocks.length,
    totalTasks,
    totalEstimatedFiles,
    recommendedGenerationOrder: modulesWithUnblocks.map((module) => module.id),
  };

  const readiness = projectManagerEngine.isReadyForGeneration(project);

  return {
    projectId: project.id,
    readyForGeneration: readiness.ready,
    readinessBlockers: readiness.reasons,
    phases,
    modules: modulesWithUnblocks,
    summary,
  };
}

export const generationPlannerEngine = {
  buildGenerationPlan,
};
