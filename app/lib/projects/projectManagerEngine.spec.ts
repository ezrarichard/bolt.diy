import { describe, expect, it } from 'vitest';
import { projectManagerEngine } from './projectManagerEngine';
import { ARTIFACT_TYPES, type ProjectArtifact } from './artifacts';
import { createSyncedRequirementsArtifact } from './requirementsSync';
import type { Project } from '~/lib/stores/projects';

/**
 * Sprint 46.2 — regression tests for the Overview/Project Details/readiness contradiction:
 * a project whose Requirements were only ever captured through the manual dialog
 * (project.projectKnowledge) must be treated as requirements-complete everywhere, without an
 * AI-generated requirements-draft artifact ever being mandatory.
 */

function approvedArtifact(type: string, idSuffix: string): ProjectArtifact {
  return {
    id: `artifact-${idSuffix}`,
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

const SEVEN_ENGINEERING_ROLES_APPROVED: ProjectArtifact[] = [
  approvedArtifact(ARTIFACT_TYPES.ARCHITECTURE_DRAFT, 'architecture'),
  approvedArtifact(ARTIFACT_TYPES.DATABASE_DRAFT, 'database'),
  approvedArtifact(ARTIFACT_TYPES.UIUX_DRAFT, 'uiux'),
  approvedArtifact(ARTIFACT_TYPES.BACKEND_DRAFT, 'backend'),
  approvedArtifact(ARTIFACT_TYPES.FRONTEND_DRAFT, 'frontend'),
  approvedArtifact(ARTIFACT_TYPES.QA_DRAFT, 'qa'),
  approvedArtifact(ARTIFACT_TYPES.DEVOPS_DRAFT, 'devops'),
];

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Riverside Dental Clinic',
    icon: '🚀',
    color: 'purple',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Project;
}

describe('projectManagerEngine — captured knowledge without a requirements artifact', () => {
  const CAPTURED_KNOWLEDGE = {
    projectVision: 'A modern, mobile-friendly website for Riverside Dental Clinic.',
    targetUsers: 'Local residents seeking dental care.',
    coreFeatures: ['Service pages', 'Doctor profiles'],
  };

  it('treats requirements as approved once the synced artifact (from requirementsSync.ts) exists alongside captured knowledge — this is what projects.ts guarantees via syncRequirementsArtifact, tested end-to-end in projectHydration.spec.ts', () => {
    const synced = createSyncedRequirementsArtifact('proj-1', CAPTURED_KNOWLEDGE);
    const project = makeProject({ projectKnowledge: CAPTURED_KNOWLEDGE, artifacts: [synced] });

    const health = projectManagerEngine.analyzeProject(project);
    expect(health.requirementsStatus.status).toBe('approved');
  });

  it('all seven engineering roles approved + synced requirements artifact ⇒ no missing artifacts, ready for generation', () => {
    const synced = createSyncedRequirementsArtifact('proj-1', CAPTURED_KNOWLEDGE);
    const project = makeProject({
      projectKnowledge: CAPTURED_KNOWLEDGE,
      artifacts: [synced, ...SEVEN_ENGINEERING_ROLES_APPROVED],
    });

    const missing = projectManagerEngine.getMissingArtifacts(project);
    expect(missing).toHaveLength(0);

    const readiness = projectManagerEngine.isReadyForGeneration(project);
    expect(readiness.reasons.find((reason) => reason.includes('Requirements'))).toBeUndefined();
  });

  it('next recommended action is no longer "Generate the Requirements Draft" once knowledge + synced artifact exist', () => {
    const synced = createSyncedRequirementsArtifact('proj-1', CAPTURED_KNOWLEDGE);
    const project = makeProject({
      projectKnowledge: CAPTURED_KNOWLEDGE,
      artifacts: [synced, ...SEVEN_ENGINEERING_ROLES_APPROVED],
    });

    const action = projectManagerEngine.getNextRecommendedAction(project);
    expect(action.message).not.toMatch(/Requirements Draft/);
    expect(action.stageId).not.toBe('requirements');
  });

  it('a discarded, higher-version Requirements Draft regenerate attempt does not make an already-complete project look incomplete (getResumableArtifact fallback)', () => {
    const synced = createSyncedRequirementsArtifact('proj-1', CAPTURED_KNOWLEDGE);
    const abandonedRegenerate: ProjectArtifact = {
      id: 'artifact-real-requirements-regenerate',
      taskId: 'requirements',
      title: 'Requirements Draft v2',
      type: ARTIFACT_TYPES.REQUIREMENTS_DRAFT,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      status: 'discarded',
      content: '{}',
      version: 2,
    };

    const project = makeProject({
      projectKnowledge: CAPTURED_KNOWLEDGE,
      artifacts: [synced, abandonedRegenerate, ...SEVEN_ENGINEERING_ROLES_APPROVED],
    });

    const health = projectManagerEngine.analyzeProject(project);
    expect(health.requirementsStatus.status).toBe('approved');
  });

  it('optional "Generate Requirements Draft" AI flow still works — a real approved draft is reported the same as the synced one', () => {
    const realDraft = approvedArtifact(ARTIFACT_TYPES.REQUIREMENTS_DRAFT, 'real-requirements');
    const project = makeProject({ projectKnowledge: CAPTURED_KNOWLEDGE, artifacts: [realDraft] });

    const health = projectManagerEngine.analyzeProject(project);
    expect(health.requirementsStatus.status).toBe('approved');
  });
});
