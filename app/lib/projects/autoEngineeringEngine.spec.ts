import { describe, expect, it } from 'vitest';
import {
  getNextAutoRole,
  isAutoEngineeringComplete,
  resumePipelineFromRole,
  AUTO_ENGINEERING_ROLES,
} from './autoEngineeringEngine';
import { ARTIFACT_TYPES, type ProjectArtifact } from './artifacts';
import type { Project } from '~/lib/stores/projects';

/**
 * Sprint 44 — resume-derivation tests. The pipeline decides which stage to (re)run purely
 * from which artifacts are actually approved in the store, never from UI state — so a failed
 * QA that is later retried and approved resumes at DevOps, and earlier approved roles are
 * never re-run.
 */

function approved(type: string): ProjectArtifact {
  return {
    id: `artifact-${type}`,
    taskId: 'requirements',
    title: `${type} v1`,
    type,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'approved',
    content: '{}',
    version: 1,
  };
}

function artifact(overrides: Partial<ProjectArtifact> & Pick<ProjectArtifact, 'id' | 'type'>): ProjectArtifact {
  return {
    taskId: 'requirements',
    title: `${overrides.type} draft`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'draft',
    content: '{}',
    version: 1,
    ...overrides,
  };
}

function makeProject(artifacts: ProjectArtifact[]): Project {
  return {
    id: 'project-1',
    name: 'Test Project',
    icon: '',
    color: 'purple',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    createdAt: '2026-01-01T00:00:00.000Z',
    artifacts,
  } as unknown as Project;
}

/** Business Analyst → … → Frontend all approved; QA + DevOps not yet. This is the reported failure state. */
const APPROVED_THROUGH_FRONTEND = [
  ARTIFACT_TYPES.ARCHITECTURE_DRAFT,
  ARTIFACT_TYPES.DATABASE_DRAFT,
  ARTIFACT_TYPES.UIUX_DRAFT,
  ARTIFACT_TYPES.BACKEND_DRAFT,
  ARTIFACT_TYPES.FRONTEND_DRAFT,
].map(approved);

describe('autoEngineeringEngine resume derivation', () => {
  it('(4) with everything through Frontend approved, the next role is QA — not an earlier, already-approved role', () => {
    const project = makeProject(APPROVED_THROUGH_FRONTEND);

    const next = getNextAutoRole(project);

    expect(next?.id).toBe('qa');
  });

  it('(5) never re-runs an already-approved earlier role', () => {
    const project = makeProject(APPROVED_THROUGH_FRONTEND);

    const next = getNextAutoRole(project);

    expect(['architecture', 'database', 'uiux', 'backend', 'frontend']).not.toContain(next?.id);
  });

  it('(6) once QA is approved, the pipeline resumes at DevOps', () => {
    const project = makeProject([...APPROVED_THROUGH_FRONTEND, approved(ARTIFACT_TYPES.QA_DRAFT)]);

    const next = getNextAutoRole(project);

    expect(next?.id).toBe('devops');
  });

  it('resumePipelineFromRole derives the next stage from approved artifacts and ignores the passed failed-role id', () => {
    const project = makeProject([...APPROVED_THROUGH_FRONTEND, approved(ARTIFACT_TYPES.QA_DRAFT)]);

    // Even if the UI reports the failed role as something stale/wrong, resolution comes from the store.
    expect(resumePipelineFromRole(project, 'architecture')?.id).toBe('devops');
    expect(resumePipelineFromRole(project, 'qa')?.id).toBe('devops');
    expect(resumePipelineFromRole(project)?.id).toBe('devops');
  });

  it('a QA retry re-selects exactly QA while QA is still unapproved (no full-pipeline restart)', () => {
    const project = makeProject(APPROVED_THROUGH_FRONTEND);

    // Two "retry" derivations in a row keep pointing at QA — never back to Business Analyst/Architecture.
    expect(resumePipelineFromRole(project, 'qa')?.id).toBe('qa');
    expect(resumePipelineFromRole(project, 'qa')?.id).toBe('qa');
  });

  it('reports completion (and no next role) only once every stage is approved', () => {
    const allApproved = AUTO_ENGINEERING_ROLES.map((role) => approved(role.artifactType));
    const project = makeProject(allApproved);

    expect(isAutoEngineeringComplete(project)).toBe(true);
    expect(getNextAutoRole(project)).toBeUndefined();
    expect(resumePipelineFromRole(project, 'devops')).toBeUndefined();
  });

  /**
   * Sprint 46.1 — live-verified regression: a project reopened after a browser refresh can have
   * QA/DevOps role outputs restored from BuildersDB with BOTH a draft (or discarded, abandoned
   * "Regenerate") row AND an approved row for the same role — either sharing an artifact id
   * (manual Regenerate reuses the same id across versions) or sharing a version number (a
   * historical duplicate-write). The pre-fix `getNextAutoRole`/`isAutoEngineeringComplete`
   * looked only at "is the numerically-latest version approved," saw the non-approved row, and
   * concluded QA/DevOps needed regenerating even though a real approved output already existed.
   */
  it('resumes correctly when QA and DevOps each have both a draft AND an approved historical row (same artifact id, different versions)', () => {
    const qaApproved = artifact({
      id: 'artifact-qa',
      type: ARTIFACT_TYPES.QA_DRAFT,
      version: 1,
      status: 'approved',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // Manual Regenerate reuses the SAME artifact id, bumps version, and was abandoned as a draft.
    const qaAbandonedDraft = artifact({
      id: 'artifact-qa',
      type: ARTIFACT_TYPES.QA_DRAFT,
      version: 2,
      status: 'draft',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    const devopsApproved = artifact({
      id: 'artifact-devops',
      type: ARTIFACT_TYPES.DEVOPS_DRAFT,
      version: 1,
      status: 'approved',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // A discarded regenerate attempt, same id, higher version, later timestamp.
    const devopsDiscardedDraft = artifact({
      id: 'artifact-devops',
      type: ARTIFACT_TYPES.DEVOPS_DRAFT,
      version: 2,
      status: 'discarded',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });

    const project = makeProject([
      ...APPROVED_THROUGH_FRONTEND,
      qaApproved,
      qaAbandonedDraft,
      devopsApproved,
      devopsDiscardedDraft,
    ]);

    expect(isAutoEngineeringComplete(project)).toBe(true);
    expect(getNextAutoRole(project)).toBeUndefined();
  });

  it('resumes correctly when the draft/approved duplicate shares a version number instead of an artifact id (live-observed pattern)', () => {
    /*
     * Two distinct rows, same version number, different artifact ids — the "first-created wins
     * a tie" reduce in getLatestArtifact would previously have picked whichever came first.
     */
    const qaDraftFirst = artifact({
      id: 'artifact-qa-draft-attempt',
      type: ARTIFACT_TYPES.QA_DRAFT,
      version: 1,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const qaApprovedSecond = artifact({
      id: 'artifact-qa-approved-attempt',
      type: ARTIFACT_TYPES.QA_DRAFT,
      version: 1,
      status: 'approved',
      createdAt: '2026-01-01T01:00:00.000Z',
      updatedAt: '2026-01-01T01:00:00.000Z',
    });

    const project = makeProject([...APPROVED_THROUGH_FRONTEND, qaDraftFirst, qaApprovedSecond]);

    expect(getNextAutoRole(project)?.id).toBe('devops');
  });
});
