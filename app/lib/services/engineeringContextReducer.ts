import { ROLE_ARTIFACT_CHAIN } from '~/lib/projects/collaborationContext';
import type { ProductBaselineSnapshot } from '~/lib/evolution/evolutionBaseline';
import {
  INCREMENTAL_ROLE_LABELS,
  type EngineeringScope,
  type IncrementalRoleId,
  type ReducedRoleContext,
  type ReviewRequirement,
  type ReviewStage,
} from '~/lib/evolution/engineeringScopeTypes';
import { PIPELINE_ORDER } from '~/lib/evolution/roleSelection';

/**
 * Engineering Context Reducer — Sprint 96, Part 4.
 *
 * Produces, for each SELECTED role, an explicit statement of what it should receive and what it
 * should not. The reduction is the point of incremental engineering: today a role's
 * `buildContext(project)` (see each engine in `app/lib/projects/`) assembles the WHOLE project —
 * every approved upstream draft via `collaborationContext.gatherEngineeringNotes`, the full page
 * list, the full schema. For a one-line change to one page that is almost entirely irrelevant
 * context.
 *
 * WHAT THIS SPRINT ACTUALLY DOES, STATED PLAINLY. It produces a DESCRIPTOR, not a prompt, and it
 * does not modify any existing engine. Sprint 96 does not execute AI roles (explicitly out of
 * scope), so nothing here narrows a live prompt yet — `ReducedRoleContext` is persisted alongside
 * the plan so the reduction is auditable BEFORE it is applied, and Sprint 97's execution reads it
 * instead of calling `buildContext(project)` wholesale. Claiming context is already reduced would
 * be claiming an optimisation that is not yet in the execution path.
 *
 * WHAT EACH ROLE LEGITIMATELY NEEDS. Two grounded sources, never more:
 *  - the affected identifiers from the Engineering Scope (features, files, tables, APIs, env vars);
 *  - the upstream artifacts `ROLE_ARTIFACT_CHAIN` already says this role reads — the existing
 *    review-chain traversal, read from that constant rather than re-derived here.
 */

/** Which scope slices each role has any legitimate use for. Anything absent is explicitly excluded. */
const ROLE_CONTEXT_NEEDS: Record<
  IncrementalRoleId,
  {
    features: boolean;
    files: boolean;
    database: boolean;
    apis: boolean;
    environment: boolean;
    fileCategories?: string[];
  }
> = {
  requirements: { features: true, files: false, database: false, apis: false, environment: false },
  productowner: { features: true, files: false, database: false, apis: false, environment: false },
  architecture: { features: true, files: true, database: true, apis: true, environment: true },
  database: { features: true, files: false, database: true, apis: false, environment: false },
  uiux: {
    features: true,
    files: true,
    database: false,
    apis: false,
    environment: false,
    fileCategories: ['pages', 'components', 'styles'],
  },
  backend: {
    features: true,
    files: true,
    database: true,
    apis: true,
    environment: false,
    fileCategories: ['backend', 'services'],
  },
  frontend: {
    features: true,
    files: true,
    database: false,
    apis: true,
    environment: false,
    fileCategories: ['pages', 'components', 'styles', 'types'],
  },
  qa: { features: true, files: true, database: true, apis: true, environment: false },
  devops: { features: false, files: false, database: false, apis: false, environment: true },
};

/** The pipeline role each `ROLE_ARTIFACT_CHAIN` entry's human label corresponds to — the one place the two vocabularies meet. */
const CHAIN_LABEL_TO_ROLE: Record<string, IncrementalRoleId> = {
  'Business Analyst': 'requirements',
  'Product Owner': 'productowner',
  'Solution Architect': 'architecture',
  'Database Engineer': 'database',
  'UX Engineer': 'uiux',
  'Backend Engineer': 'backend',
  'Frontend Engineer': 'frontend',
  'QA Engineer': 'qa',
  'DevOps Engineer': 'devops',
};

/**
 * The upstream artifacts this role reads — exactly the traversal `gatherEngineeringNotes` already
 * performs (`ROLE_ARTIFACT_CHAIN` up to but excluding this role), so the reduction never withholds
 * something the existing pipeline depends on.
 */
export function upstreamArtifactsFor(role: IncrementalRoleId): string[] {
  const cutoff = ROLE_ARTIFACT_CHAIN.findIndex((entry) => CHAIN_LABEL_TO_ROLE[entry.role] === role);
  const chain = cutoff >= 0 ? ROLE_ARTIFACT_CHAIN.slice(0, cutoff) : ROLE_ARTIFACT_CHAIN;

  return chain.map((entry) => entry.type);
}

function reviewsFor(role: IncrementalRoleId, reviews: ReviewRequirement[]): ReviewStage[] {
  const required = new Set(reviews.filter((review) => review.required).map((review) => review.stage));
  const relevant: ReviewStage[] = [];

  if (required.has('product_review') && ['requirements', 'productowner', 'architecture'].includes(role)) {
    relevant.push('product_review');
  }

  if (required.has('roadmap_review') && ['productowner', 'architecture'].includes(role)) {
    relevant.push('roadmap_review');
  }

  if (required.has('code_review') && ['database', 'backend', 'frontend', 'uiux', 'qa'].includes(role)) {
    relevant.push('code_review');
  }

  return relevant;
}

export interface ReduceContextInput {
  scope: EngineeringScope;
  baseline: ProductBaselineSnapshot;
  selectedRoles: IncrementalRoleId[];
  reviews: ReviewRequirement[];
}

/** Pure and total. One descriptor per selected role; unselected roles get nothing, because they do not run. */
export function reduceEngineeringContext(input: ReduceContextInput): ReducedRoleContext[] {
  const { scope, baseline } = input;
  const totalFiles = baseline.files.length;

  const scopedFilePaths = [...scope.affectedPages, ...scope.affectedComponents].map((entry) => entry.identifier);

  return input.selectedRoles
    .slice()
    .sort((a, b) => PIPELINE_ORDER.indexOf(a) - PIPELINE_ORDER.indexOf(b))
    .map((role) => {
      const needs = ROLE_CONTEXT_NEEDS[role];
      const excluded: string[] = [];

      const includedFeatures = needs.features ? scope.affectedFeatures.map((entry) => entry.identifier) : [];

      if (!needs.features) {
        excluded.push('released feature list');
      }

      let includedFiles: string[] = [];

      if (needs.files) {
        includedFiles = needs.fileCategories
          ? scopedFilePaths.filter((path) => {
              const file = baseline.files.find((candidate) => candidate.path === path);
              return file ? needs.fileCategories!.includes(file.category) : false;
            })
          : scopedFilePaths;

        if (needs.fileCategories) {
          excluded.push(`generated files outside ${needs.fileCategories.join('/')}`);
        }
      } else {
        excluded.push('generated file set');
      }

      const includedDatabaseObjects = needs.database
        ? scope.affectedDatabaseObjects.map((entry) => entry.identifier)
        : [];

      if (!needs.database) {
        excluded.push('database schema');
      }

      const includedApis = needs.apis ? scope.affectedApis.map((entry) => entry.identifier) : [];

      if (!needs.apis) {
        excluded.push('API surfaces');
      }

      const includedEnvironment = needs.environment ? scope.affectedEnvironment.map((entry) => entry.identifier) : [];

      if (!needs.environment) {
        excluded.push('environment configuration');
      }

      /*
       * The headline number: how much of the released file set this role would see. 0 for a role
       * that needs no files at all — which is a real, valuable reduction, not a missing value.
       */
      const contextReductionRatio = totalFiles === 0 ? 0 : includedFiles.length / totalFiles;

      excluded.push(
        `every released feature, page, table and variable the impact analysis found unaffected (${scope.unaffectedAreas.length} area(s))`,
      );

      return {
        role,
        label: INCREMENTAL_ROLE_LABELS[role],
        includedFeatures,
        includedFiles,
        includedDatabaseObjects,
        includedApis,
        includedEnvironment,
        includedUpstreamArtifacts: upstreamArtifactsFor(role),
        includedReviews: reviewsFor(role, input.reviews),
        excluded,
        contextReductionRatio: Number(contextReductionRatio.toFixed(3)),
      };
    });
}
