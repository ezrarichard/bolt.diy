/**
 * Product Assembly Domain — Sprint 37 (AI Product Assembly Engine).
 *
 * Types for the "Product Package": every approved (or, failing that, latest-draft) AI
 * role output for a project, assembled into a structured set of files
 * (Requirements/BRD.md, Architecture/architecture.md, ...). This sprint deliberately
 * does NOT generate runnable code — see productAssembler.ts's header comment for why
 * that's Sprint 38's job, not this one.
 *
 * `ProductAssemblySection` is adapted from the project's ACTUAL 8 AI roles (see
 * app/lib/projects/artifacts.ts's ARTIFACT_TYPES and
 * app/lib/projects/collaborationContext.ts's ROLE_ARTIFACT_CHAIN) rather than the
 * sprint brief's suggested structure verbatim: there is no "Project Manager" or
 * dedicated "API" AI role/artifact anywhere in this codebase (ProjectManagerPanel.tsx
 * is a read-only, locally-computed readiness view — it never calls an LLM and produces
 * no artifact of its own). `api` is kept as a section, derived from the Backend
 * Engineer's own draft (see productAssembler.ts's buildApiFile) rather than invented
 * from nothing; "Project Management" has no section at all — see
 * assemblyMarkdown.ts's product summary, which explains this adaptation inline.
 */

export type ProductAssemblySection =
  | 'requirements'
  | 'architecture'
  | 'database'
  | 'uiux'
  | 'api'
  | 'backend'
  | 'frontend'
  | 'qa'
  | 'devops'
  | 'documentation';

/**
 * Per-file assembly status — NOT the same union as `ProjectArtifactStatus`
 * (app/lib/projects/artifacts.ts also has `'discarded'`/`'final'`/`'placeholder'`): a
 * discarded or still-empty-placeholder artifact is treated as "no usable content", i.e.
 * `'missing'`, exactly like a role that hasn't generated anything yet — the Product
 * Package only ever shows content a human could plausibly build from.
 */
export type ProductAssemblyStatus = 'approved' | 'draft' | 'missing';

/** Where one assembled file's content came from — the source traceability requirement #5 calls for. */
export interface ProductAssemblySource {
  /** Human-readable role label, e.g. "Business Analyst" — undefined for the rule-based Documentation section, which has no single AI source. */
  role?: string;

  /** ARTIFACT_TYPES value, e.g. 'requirements-draft' — undefined for the Documentation section. */
  roleKey?: string;
  artifactId?: string;
  version?: number;
  status: ProductAssemblyStatus;
  updatedAt?: string;
}

export interface ProductPackageFile {
  id: string;
  projectId: string;

  /** Full path within the package, e.g. "Requirements/BRD.md". */
  path: string;
  filename: string;
  section: ProductAssemblySection;
  title: string;

  /** Markdown. */
  content: string;
  sourceRole?: string;
  sourceArtifactId?: string;
  sourceVersion?: number;
  sourceStatus: ProductAssemblyStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ProductPackageSection {
  id: ProductAssemblySection;
  label: string;
  files: ProductPackageFile[];
}

export interface MissingSection {
  section: ProductAssemblySection;
  label: string;
  reason: string;
}

/** The full assembled package for one project — requirement #6 ("Handle Missing Outputs"): assembly always succeeds and returns a package, even when every section is missing. */
export interface ProductPackage {
  projectId: string;
  projectName: string;
  assembledAt: string;
  sections: ProductPackageSection[];
  missingSections: MissingSection[];
}
