import {
  ARTIFACT_TYPES,
  getApprovedArtifactContent,
  getLatestArtifact,
  parseArtifactContent,
} from '~/lib/projects/artifacts';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { formatDraftFields } from '~/lib/projects/prompts/shared';
import { REQUIREMENTS_DRAFT_FIELDS, type RequirementsDraft } from '~/lib/projects/prompts/requirements';
import { ARCHITECTURE_DRAFT_FIELDS, type ArchitectureDraft } from '~/lib/projects/prompts/architecture';
import { DATABASE_DRAFT_FIELDS, type DatabaseDraft } from '~/lib/projects/prompts/database';
import { UIUX_DRAFT_FIELDS, type UIUXDraft } from '~/lib/projects/prompts/uiux';
import { BACKEND_DRAFT_FIELDS, type BackendDraft } from '~/lib/projects/prompts/backend';
import { FRONTEND_DRAFT_FIELDS, type FrontendDraft } from '~/lib/projects/prompts/frontend';
import { QA_DRAFT_FIELDS, type QADraft } from '~/lib/projects/prompts/qa';
import { DEVOPS_DRAFT_FIELDS, type DevOpsDraft } from '~/lib/projects/prompts/devops';
import { buildProductSummaryMarkdown } from './assemblyMarkdown';
import { renderValidationReportMarkdown } from '~/lib/database-activation/schemaValidator';
import type {
  MissingSection,
  ProductAssemblySection,
  ProductAssemblyStatus,
  ProductPackage,
  ProductPackageDeploymentInfo,
  ProductPackageFile,
  ProductPackageSection,
} from './assemblyTypes';

/**
 * Product Assembler — Sprint 37.
 *
 * Reads the same in-memory `Project` object every existing engine already reads from
 * (see app/lib/projects/solutionArchitectEngine.ts etc.'s `buildXContext` functions) —
 * deliberately NOT an async BuildersDB read: the project passed in by the dashboard is
 * always the freshest state for the session, so assembly works identically whether or
 * not BuildersDB is configured (requirement: "If Supabase is not configured, still
 * allow in-memory/local assembly"). Persisting the result to BuildersDB is a separate,
 * best-effort step — see assemblyRepository.ts — never a precondition for assembling.
 *
 * This sprint does NOT generate runnable code, a file tree, or a live preview — every
 * assembled file is a readable Markdown *plan/spec document* built from an AI role's
 * already-approved (or, failing that, latest draft) structured output, reusing each
 * role's own `*_DRAFT_FIELDS` config and `formatDraftFields` (app/lib/projects/prompts/
 * shared.ts) exactly as the existing draft-preview UI already does — no new formatting
 * logic invented per role. Turning this package into actual source files is Sprint 38's
 * job (see docs/buildersdb.md-style sprint notes).
 */

interface RoleFileConfig<T extends object> {
  section: ProductAssemblySection;
  sectionLabel: string;
  roleKey: string;
  roleLabel: string;
  filename: string;
  title: string;
  fields: { key: keyof T; label: string; kind: 'text' | 'list' | 'decisions' }[];
}

/** Reads one role's latest usable (approved or draft) artifact and renders it via the same `formatDraftFields` the panels already use — undefined when the role hasn't produced anything usable yet (discarded/placeholder/never generated), which the caller reports as a missing section rather than failing the whole assembly. */
function buildRoleFile<T extends object>(project: Project, config: RoleFileConfig<T>): ProductPackageFile | undefined {
  const artifacts = getProjectArtifacts(project);
  const latest = getLatestArtifact(artifacts, config.roleKey);

  if (!latest || (latest.status !== 'approved' && latest.status !== 'draft')) {
    return undefined;
  }

  const draft =
    latest.status === 'approved'
      ? getApprovedArtifactContent<T>(artifacts, config.roleKey)
      : parseArtifactContent<T>(latest.content);

  if (!draft) {
    return undefined;
  }

  const now = new Date().toISOString();
  const status: ProductAssemblyStatus = latest.status === 'approved' ? 'approved' : 'draft';

  return {
    id: `pkg-file-${project.id}-${config.section}`,
    projectId: project.id,
    path: `${config.sectionLabel}/${config.filename}`,
    filename: config.filename,
    section: config.section,
    title: config.title,
    content: `# ${config.title}\n\n${formatDraftFields(draft, config.fields)}`,
    sourceRole: config.roleLabel,
    sourceArtifactId: latest.id,
    sourceVersion: latest.version,
    sourceStatus: status,
    createdAt: now,
    updatedAt: now,
    metadata: { roleKey: config.roleKey },
  };
}

/** Only the API-relevant subset of BACKEND_DRAFT_FIELDS — see assemblyTypes.ts's header comment for why "API" is derived from Backend rather than its own AI role. */
const API_SPEC_FIELD_KEYS: (keyof BackendDraft)[] = [
  'apiArchitecture',
  'apiEndpoints',
  'authenticationFlow',
  'authorizationStrategy',
  'rateLimiting',
  'errorHandling',
  'externalIntegrations',
];

function buildApiFile(project: Project): ProductPackageFile | undefined {
  const file = buildRoleFile<BackendDraft>(project, {
    section: 'api',
    sectionLabel: 'API',
    roleKey: ARTIFACT_TYPES.BACKEND_DRAFT,
    roleLabel: 'Backend Engineer',
    filename: 'api-spec.md',
    title: 'API Specification',
    fields: BACKEND_DRAFT_FIELDS.filter((field) => API_SPEC_FIELD_KEYS.includes(field.key)),
  });

  return file ? { ...file, id: `pkg-file-${project.id}-api` } : undefined;
}

/** One entry per assembled section (Documentation excluded — always generated separately, never "missing"). Order here is the pipeline order and the order sections appear in the assembled package. */
function getSectionBuilders(
  project: Project,
): { section: ProductAssemblySection; label: string; build: () => ProductPackageFile | undefined }[] {
  return [
    {
      section: 'requirements',
      label: 'Requirements',
      build: () =>
        buildRoleFile<RequirementsDraft>(project, {
          section: 'requirements',
          sectionLabel: 'Requirements',
          roleKey: ARTIFACT_TYPES.REQUIREMENTS_DRAFT,
          roleLabel: 'Business Analyst',
          filename: 'BRD.md',
          title: 'Business Requirements Document',
          fields: REQUIREMENTS_DRAFT_FIELDS,
        }),
    },
    {
      section: 'architecture',
      label: 'Architecture',
      build: () =>
        buildRoleFile<ArchitectureDraft>(project, {
          section: 'architecture',
          sectionLabel: 'Architecture',
          roleKey: ARTIFACT_TYPES.ARCHITECTURE_DRAFT,
          roleLabel: 'Solution Architect',
          filename: 'architecture.md',
          title: 'Architecture Overview',
          fields: ARCHITECTURE_DRAFT_FIELDS,
        }),
    },
    {
      section: 'database',
      label: 'Database',
      build: () =>
        buildRoleFile<DatabaseDraft>(project, {
          section: 'database',
          sectionLabel: 'Database',
          roleKey: ARTIFACT_TYPES.DATABASE_DRAFT,
          roleLabel: 'Database Engineer',
          filename: 'schema-plan.md',
          title: 'Database Schema Plan',
          fields: DATABASE_DRAFT_FIELDS,
        }),
    },
    {
      section: 'uiux',
      label: 'UIUX',
      build: () =>
        buildRoleFile<UIUXDraft>(project, {
          section: 'uiux',
          sectionLabel: 'UIUX',
          roleKey: ARTIFACT_TYPES.UIUX_DRAFT,
          roleLabel: 'UX Engineer',
          filename: 'ui-spec.md',
          title: 'UI/UX Specification',
          fields: UIUX_DRAFT_FIELDS,
        }),
    },
    { section: 'api', label: 'API', build: () => buildApiFile(project) },
    {
      section: 'backend',
      label: 'Backend',
      build: () =>
        buildRoleFile<BackendDraft>(project, {
          section: 'backend',
          sectionLabel: 'Backend',
          roleKey: ARTIFACT_TYPES.BACKEND_DRAFT,
          roleLabel: 'Backend Engineer',
          filename: 'backend-plan.md',
          title: 'Backend Plan',
          fields: BACKEND_DRAFT_FIELDS,
        }),
    },
    {
      section: 'frontend',
      label: 'Frontend',
      build: () =>
        buildRoleFile<FrontendDraft>(project, {
          section: 'frontend',
          sectionLabel: 'Frontend',
          roleKey: ARTIFACT_TYPES.FRONTEND_DRAFT,
          roleLabel: 'Frontend Engineer',
          filename: 'frontend-plan.md',
          title: 'Frontend Plan',
          fields: FRONTEND_DRAFT_FIELDS,
        }),
    },
    {
      section: 'qa',
      label: 'QA',
      build: () =>
        buildRoleFile<QADraft>(project, {
          section: 'qa',
          sectionLabel: 'QA',
          roleKey: ARTIFACT_TYPES.QA_DRAFT,
          roleLabel: 'QA Engineer',
          filename: 'test-plan.md',
          title: 'QA Test Plan',
          fields: QA_DRAFT_FIELDS,
        }),
    },
    {
      section: 'devops',
      label: 'DevOps',
      build: () =>
        buildRoleFile<DevOpsDraft>(project, {
          section: 'devops',
          sectionLabel: 'DevOps',
          roleKey: ARTIFACT_TYPES.DEVOPS_DRAFT,
          roleLabel: 'DevOps Engineer',
          filename: 'deployment-plan.md',
          title: 'Deployment Plan',
          fields: DEVOPS_DRAFT_FIELDS,
        }),
    },
  ];
}

/**
 * Sprint 75 — the Database section's additional generated files, built from
 * `project.databaseActivation` (see app/lib/database-activation/databaseActivationService.ts,
 * the only writer of that state) rather than another AI role artifact. Zero files when nothing
 * has been generated yet — this never turns "database" into a non-missing section on its own;
 * the narrative Database Schema Plan (schema-plan.md, via buildRoleFile above) still governs
 * that, and schema generation itself requires the same approved artifact, so these two can never
 * disagree about whether the Database section has content.
 */
function buildDatabaseActivationFiles(project: Project): ProductPackageFile[] {
  const activation = project.databaseActivation;

  if (!activation?.schema) {
    return [];
  }

  const now = new Date().toISOString();
  const files: ProductPackageFile[] = [
    {
      id: `pkg-file-${project.id}-database-schema-sql`,
      projectId: project.id,
      path: 'Database/schema.sql',
      filename: 'schema.sql',
      section: 'database',
      title: 'Database Schema (SQL)',
      content: activation.schema.schemaSql,
      sourceStatus: 'approved',
      createdAt: now,
      updatedAt: now,
      metadata: { generated: 'deterministic', generatedAt: activation.schema.generatedAt },
    },
    {
      id: `pkg-file-${project.id}-database-migration-sql`,
      projectId: project.id,
      path: 'Database/migration.sql',
      filename: 'migration.sql',
      section: 'database',
      title: 'Database Migration (SQL)',
      content: activation.schema.migrationSql,
      sourceStatus: 'approved',
      createdAt: now,
      updatedAt: now,
      metadata: { generated: 'deterministic', generatedAt: activation.schema.generatedAt },
    },
  ];

  if (activation.validation) {
    files.push({
      id: `pkg-file-${project.id}-database-validation-report`,
      projectId: project.id,
      path: 'Database/validation-report.md',
      filename: 'validation-report.md',
      section: 'database',
      title: 'Database Schema Validation Report',
      content: renderValidationReportMarkdown(activation.validation.report),
      sourceStatus: 'approved',
      createdAt: now,
      updatedAt: now,
      metadata: { generated: 'deterministic', validatedAt: activation.validation.validatedAt },
    });
  }

  const summaryLines = [
    '# Database Activation Summary',
    '',
    `- Schema generated: ${activation.schema.tableCount} table(s) at ${activation.schema.generatedAt}`,
    `- Validation: ${activation.validation ? (activation.validation.report.passed ? 'PASSED' : 'FAILED') : 'not run yet'}`,
    `- Provisioning: ${activation.provisioning ? `${activation.provisioning.status} (${activation.provisioning.provider})` : 'not started'}`,
    `- Connection: ${activation.connection ? (activation.connection.verified ? 'verified' : 'not verified') : 'not checked'}`,
  ];

  files.push({
    id: `pkg-file-${project.id}-database-summary`,
    projectId: project.id,
    path: 'Database/database-summary.md',
    filename: 'database-summary.md',
    section: 'database',
    title: 'Database Activation Summary',
    content: summaryLines.join('\n'),
    sourceStatus: 'approved',
    createdAt: now,
    updatedAt: now,
    metadata: { generated: 'deterministic' },
  });

  return files;
}

/**
 * Assembles the full Product Package for a project — always succeeds (requirement #6):
 * any role without usable output becomes a `missingSections` entry rather than
 * aborting assembly. Pure and synchronous; see assemblyRepository.ts for persisting the
 * result and app/components/sidebar/ProductPackagePanel.tsx for the manual trigger.
 *
 * Sprint 86, Part 6 — `deploymentInfo` (optional, second parameter) is threaded straight
 * onto the returned package's `deploymentReadiness`, unvalidated — the CALLER already has
 * (or can fetch) the Application Manifest and `calculateDeploymentReadiness`'s result, so
 * this stays a pure passthrough rather than this module reaching into BuildersDB itself
 * (this file's own header explains why that's a hard rule, not a preference). Omitted
 * entirely (the common case, e.g. before any code has been generated) leaves
 * `deploymentReadiness` undefined — every existing caller of this function is completely
 * unaffected.
 */
export function assembleProductPackage(
  project: Project,
  deploymentInfo?: ProductPackageDeploymentInfo,
): ProductPackage {
  const sections: ProductPackageSection[] = [];
  const missingSections: MissingSection[] = [];

  for (const { section, label, build } of getSectionBuilders(project)) {
    const file = build();

    if (file) {
      sections.push({ id: section, label, files: [file] });
    } else {
      missingSections.push({
        section,
        label,
        reason: `No approved or draft output yet for this section.`,
      });
    }
  }

  const databaseActivationFiles = buildDatabaseActivationFiles(project);

  if (databaseActivationFiles.length > 0) {
    const databaseSection = sections.find((section) => section.id === 'database');

    if (databaseSection) {
      databaseSection.files.push(...databaseActivationFiles);
    } else {
      sections.push({ id: 'database', label: 'Database', files: databaseActivationFiles });
    }
  }

  const assembledAt = new Date().toISOString();
  const documentationFile = buildDocumentationFile(project, sections, missingSections, assembledAt);
  sections.push({ id: 'documentation', label: 'Documentation', files: [documentationFile] });

  return {
    projectId: project.id,
    projectName: project.name,
    assembledAt,
    sections,
    missingSections,
    deploymentReadiness: deploymentInfo,
  };
}

function buildDocumentationFile(
  project: Project,
  sections: ProductPackageSection[],
  missingSections: MissingSection[],
  assembledAt: string,
): ProductPackageFile {
  return {
    id: `pkg-file-${project.id}-documentation`,
    projectId: project.id,
    path: 'Documentation/product-summary.md',
    filename: 'product-summary.md',
    section: 'documentation',
    title: 'Product Summary',
    content: buildProductSummaryMarkdown(project, sections, missingSections, assembledAt),
    sourceStatus: 'approved',
    createdAt: assembledAt,
    updatedAt: assembledAt,
    metadata: { generated: 'rule-based' },
  };
}

export const productAssembler = {
  assembleProductPackage,
};
