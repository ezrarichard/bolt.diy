import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getCurrentSessionMock } = vi.hoisted(() => ({ getCurrentSessionMock: vi.fn() }));
const {
  isBuildersDbAvailableMock,
  getRoleOutputsForProjectMock,
  getProjectByIdMock,
  getProjectTasksMock,
  getTaskReviewsMock,
} = vi.hoisted(() => ({
  isBuildersDbAvailableMock: vi.fn(),
  getRoleOutputsForProjectMock: vi.fn(),
  getProjectByIdMock: vi.fn(),
  getProjectTasksMock: vi.fn(),
  getTaskReviewsMock: vi.fn(),
}));
const { checkBuildersDbConnectionMock } = vi.hoisted(() => ({ checkBuildersDbConnectionMock: vi.fn() }));
const { getWorkspaceStateMock } = vi.hoisted(() => ({ getWorkspaceStateMock: vi.fn() }));

vi.mock('~/lib/auth/authClient', () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock('~/lib/builders-db/client', () => ({
  checkBuildersDbConnection: checkBuildersDbConnectionMock,
}));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  isBuildersDbAvailable: isBuildersDbAvailableMock,
  buildersDbRepository: {
    getRoleOutputsForProject: getRoleOutputsForProjectMock,
    getProjectById: getProjectByIdMock,
    getProjectTasks: getProjectTasksMock,
    getTaskReviews: getTaskReviewsMock,
    createProject: vi.fn().mockResolvedValue(true),
    createOrUpdateRoleOutput: vi.fn().mockResolvedValue(true),
    addProjectActivity: vi.fn().mockResolvedValue(true),
    updateProject: vi.fn().mockResolvedValue(true),
    updateProjectTask: vi.fn().mockResolvedValue(true),
    createExecutionLog: vi.fn().mockResolvedValue(true),
    createTaskReview: vi.fn().mockResolvedValue(true),
    touchLastOpened: vi.fn().mockResolvedValue(true),
    deleteProject: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('~/lib/builders-db/repositories/workspaceStateRepository', () => ({
  workspaceStateRepository: {
    getWorkspaceState: getWorkspaceStateMock,
    upsertWorkspaceState: vi.fn().mockResolvedValue(true),
  },
}));

const { hydrateProjectData, updateProjectKnowledge, projectsStore } = await import('./projects');
const { getProjectHydrationState, projectHydrationStore } = await import('~/lib/projects/hydration');
const { getLatestArtifact, getResumableArtifact, ARTIFACT_TYPES } = await import('~/lib/projects/artifacts');
const { syncedRequirementsArtifactId } = await import('~/lib/projects/requirementsSync');

import type { Project } from './projects';
import type { ProjectArtifact } from '~/lib/projects/artifacts';
import type { ProjectKnowledge } from '~/lib/projects/knowledge';

function artifact(overrides: Partial<ProjectArtifact> & Pick<ProjectArtifact, 'id' | 'type'>): ProjectArtifact {
  return {
    taskId: 'task-1',
    title: 'Architecture Draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'approved',
    content: '{}',
    generatedBy: 'Solution Architect',
    version: 1,
    ...overrides,
  };
}

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    ...overrides,
  };
}

describe('hydrateProjectData', () => {
  beforeEach(() => {
    getCurrentSessionMock.mockReset().mockResolvedValue({ user: { id: 'user-a', email: 'a@example.com' } });
    isBuildersDbAvailableMock.mockReset().mockReturnValue(true);
    checkBuildersDbConnectionMock.mockReset().mockResolvedValue(true);
    getRoleOutputsForProjectMock.mockReset().mockResolvedValue([]);
    getProjectByIdMock.mockReset().mockResolvedValue(null);
    getProjectTasksMock.mockReset().mockResolvedValue([]);
    getTaskReviewsMock.mockReset().mockResolvedValue([]);
    getWorkspaceStateMock.mockReset().mockResolvedValue(null);
    projectsStore.set([]);
    projectHydrationStore.set({});
  });

  it('restores role outputs from BuildersDB into project.artifacts (refresh/reopen resume)', async () => {
    projectsStore.set([baseProject()]);

    const remoteArtifact = artifact({ id: 'artifact-remote-1', type: 'architecture-draft', status: 'approved' });
    getRoleOutputsForProjectMock.mockResolvedValue([remoteArtifact]);

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1');
    expect(project?.artifacts).toEqual([remoteArtifact]);
    expect(getProjectHydrationState('user-a', 'proj-1').status).toBe('ready');
  });

  it('selects the latest approved version per role and retains version history', async () => {
    projectsStore.set([baseProject()]);

    const v1 = artifact({ id: 'artifact-v1', type: 'architecture-draft', version: 1, status: 'approved' });
    const v2 = artifact({ id: 'artifact-v2', type: 'architecture-draft', version: 2, status: 'approved' });
    getRoleOutputsForProjectMock.mockResolvedValue([v1, v2]);

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    expect(project.artifacts).toHaveLength(2); // both versions retained

    const { getLatestArtifact } = await import('~/lib/projects/artifacts');
    expect(getLatestArtifact(project.artifacts!, 'architecture-draft')?.id).toBe('artifact-v2');
  });

  it('deduplicates rows that share an artifact id (last-write-wins by updatedAt), never creating duplicate artifacts', async () => {
    projectsStore.set([baseProject()]);

    const stale = artifact({
      id: 'artifact-dup',
      type: 'architecture-draft',
      status: 'draft',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const fresh = artifact({
      id: 'artifact-dup',
      type: 'architecture-draft',
      status: 'approved',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    getRoleOutputsForProjectMock.mockResolvedValue([stale, fresh]);

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    expect(project.artifacts).toHaveLength(1);
    expect(project.artifacts?.[0].status).toBe('approved');
  });

  it('preserves an approved version and a later abandoned draft that share the same artifact id (manual Regenerate), and resume finds the approved one', async () => {
    projectsStore.set([baseProject()]);

    const approvedV1 = artifact({
      id: 'artifact-qa',
      type: 'qa-draft',
      version: 1,
      status: 'approved',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // Manual Regenerate (useDraftPanel.ts) reuses the SAME id and bumps only `version`.
    const abandonedDraftV2 = artifact({
      id: 'artifact-qa',
      type: 'qa-draft',
      version: 2,
      status: 'draft',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    getRoleOutputsForProjectMock.mockResolvedValue([approvedV1, abandonedDraftV2]);

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    expect(project.artifacts).toHaveLength(2); // both versions retained, not collapsed

    const { getLatestApprovedArtifact } = await import('~/lib/projects/artifacts');
    expect(getLatestApprovedArtifact(project.artifacts!, 'qa-draft')?.version).toBe(1);
  });

  it('does not erase local artifacts when BuildersDB legitimately returns none', async () => {
    const localArtifact = artifact({ id: 'artifact-local-1', type: 'architecture-draft', status: 'approved' });
    projectsStore.set([baseProject({ artifacts: [localArtifact] })]);

    getRoleOutputsForProjectMock.mockResolvedValue([]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    expect(project.artifacts).toEqual([localArtifact]);
    expect(getProjectHydrationState('user-a', 'proj-1')).toMatchObject({ status: 'ready', usedLocalFallback: true });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('keeping local artifacts'));

    warnSpy.mockRestore();
  });

  it('uses empty artifacts when both remote and local are empty', async () => {
    projectsStore.set([baseProject()]);
    getRoleOutputsForProjectMock.mockResolvedValue([]);

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    expect(project.artifacts).toEqual([]);
    expect(getProjectHydrationState('user-a', 'proj-1').usedLocalFallback).toBe(false);
  });

  it('marks hydration failed (and leaves local artifacts untouched) when BuildersDB is unreachable', async () => {
    const localArtifact = artifact({ id: 'artifact-local-1', type: 'architecture-draft', status: 'approved' });
    projectsStore.set([baseProject({ artifacts: [localArtifact] })]);

    checkBuildersDbConnectionMock.mockResolvedValue(false);

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    expect(project.artifacts).toEqual([localArtifact]); // untouched, not merged/overwritten
    expect(getProjectHydrationState('user-a', 'proj-1')).toMatchObject({ status: 'failed' });
    expect(getRoleOutputsForProjectMock).not.toHaveBeenCalled();
  });

  it('treats an unconfigured BuildersDB as an accepted local-only fallback (ready), not a failure', async () => {
    projectsStore.set([baseProject()]);
    isBuildersDbAvailableMock.mockReturnValue(false);

    await hydrateProjectData('proj-1');

    expect(getProjectHydrationState('user-a', 'proj-1')).toMatchObject({ status: 'ready', usedLocalFallback: true });
    expect(checkBuildersDbConnectionMock).not.toHaveBeenCalled();
  });

  it('restores task status/notes, task reviews, and workspace state alongside artifacts', async () => {
    projectsStore.set([baseProject()]);

    getProjectTasksMock.mockResolvedValue([{ taskId: 'task-1', status: 'in-progress', notes: 'from remote' }]);
    getTaskReviewsMock.mockResolvedValue([
      { taskId: 'task-2', reviewStatus: 'approved', reviewedAt: '2026-01-01T00:00:00.000Z', reviewedBy: 'user-a' },
    ]);
    getWorkspaceStateMock.mockResolvedValue({
      lastGenerationStatus: 'generated',
      lastPreviewStatus: 'available',
      generatedApplicationExists: true,
      previewAvailable: true,
      workbenchFilesCreated: true,
      productPackageAssembled: true,
    });
    getProjectByIdMock.mockResolvedValue(
      baseProject({ projectKnowledge: { coreFeatures: ['login'] } as never, roadmapStatus: { step1: 'completed' } }),
    );

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    expect(project.taskStatus?.['task-1']).toBe('in-progress');
    expect(project.taskNotes?.['task-1']).toBe('from remote');
    expect(project.taskReview?.['task-2']?.reviewStatus).toBe('approved');
    expect(project.workspaceState?.productPackageAssembled).toBe(true);
    expect(project.projectKnowledge).toEqual({ coreFeatures: ['login'] });
    expect(project.roadmapStatus).toEqual({ step1: 'completed' });
  });

  it('does not run BuildersDB hydration twice concurrently for the same project (in-flight guard)', async () => {
    projectsStore.set([baseProject()]);

    let resolveFetch!: (value: unknown[]) => void;
    getRoleOutputsForProjectMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = hydrateProjectData('proj-1');
    const second = hydrateProjectData('proj-1'); // should be a no-op no-op while the first is in flight

    resolveFetch([]);
    await Promise.all([first, second]);

    expect(getRoleOutputsForProjectMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Sprint 46.2 — a project whose Requirements were only ever captured through the manual
   * dialog (project.projectKnowledge) has no requirements-draft artifact at all. Hydration
   * must self-heal this by synthesizing one locally (no LLM call), using a deterministic id so
   * repeated reopens never duplicate it.
   */
  const CAPTURED_KNOWLEDGE: ProjectKnowledge = {
    projectVision: 'A modern, mobile-friendly website for Riverside Dental Clinic.',
    targetUsers: 'Local residents seeking dental care.',
    coreFeatures: ['Service pages', 'Doctor profiles'],
  };

  it('self-heals a missing requirements-draft artifact from captured projectKnowledge during hydration', async () => {
    projectsStore.set([baseProject({ projectKnowledge: CAPTURED_KNOWLEDGE })]);
    getProjectByIdMock.mockResolvedValue(baseProject({ projectKnowledge: CAPTURED_KNOWLEDGE }));

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    const requirementsArtifact = getLatestArtifact(project.artifacts ?? [], ARTIFACT_TYPES.REQUIREMENTS_DRAFT);

    expect(requirementsArtifact).toBeDefined();
    expect(requirementsArtifact?.status).toBe('approved');
    expect(requirementsArtifact?.id).toBe(syncedRequirementsArtifactId('proj-1'));
  });

  it('does not duplicate the synced requirements artifact on repeated reopen', async () => {
    projectsStore.set([baseProject({ projectKnowledge: CAPTURED_KNOWLEDGE })]);
    getProjectByIdMock.mockResolvedValue(baseProject({ projectKnowledge: CAPTURED_KNOWLEDGE }));

    await hydrateProjectData('proj-1');
    await hydrateProjectData('proj-1');
    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    const matching = (project.artifacts ?? []).filter((a) => a.type === ARTIFACT_TYPES.REQUIREMENTS_DRAFT);

    expect(matching).toHaveLength(1);
    expect(matching[0].version).toBe(1);
  });

  it('never overwrites a real, independently-generated Requirements Draft artifact', async () => {
    const realDraft: ProjectArtifact = {
      id: 'artifact-real-requirements',
      taskId: 'requirements',
      title: 'Requirements Draft v1',
      type: ARTIFACT_TYPES.REQUIREMENTS_DRAFT,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'draft',
      content: '{"businessVision":"real AI content"}',
      generatedBy: 'AI Business Analyst',
      version: 1,
    };
    projectsStore.set([baseProject({ projectKnowledge: CAPTURED_KNOWLEDGE, artifacts: [realDraft] })]);
    getRoleOutputsForProjectMock.mockResolvedValue([realDraft]);
    getProjectByIdMock.mockResolvedValue(baseProject({ projectKnowledge: CAPTURED_KNOWLEDGE }));

    await hydrateProjectData('proj-1');

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    const matching = (project.artifacts ?? []).filter((a) => a.type === ARTIFACT_TYPES.REQUIREMENTS_DRAFT);

    expect(matching).toHaveLength(1);
    expect(matching[0]).toEqual(realDraft);
  });

  it('saving manual Requirements & Knowledge synthesizes/updates the approved artifact without an Anthropic call', async () => {
    projectsStore.set([baseProject()]);

    updateProjectKnowledge('proj-1', CAPTURED_KNOWLEDGE);

    const project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    const requirementsArtifact = getLatestArtifact(project.artifacts ?? [], ARTIFACT_TYPES.REQUIREMENTS_DRAFT);

    expect(requirementsArtifact?.status).toBe('approved');
    expect(requirementsArtifact?.id).toBe(syncedRequirementsArtifactId('proj-1'));

    const parsedContent = JSON.parse(requirementsArtifact!.content);
    expect(parsedContent.businessVision).toBe(CAPTURED_KNOWLEDGE.projectVision);
  });

  it('getResumableArtifact keeps Requirements approved even if the synced artifact is later discarded and no other version exists', async () => {
    projectsStore.set([baseProject()]);
    updateProjectKnowledge('proj-1', CAPTURED_KNOWLEDGE);

    let project = projectsStore.get().find((p) => p.id === 'proj-1')!;
    expect(getResumableArtifact(project.artifacts ?? [], ARTIFACT_TYPES.REQUIREMENTS_DRAFT)?.status).toBe('approved');

    // Re-saving with the exact same knowledge is a no-op write (idempotent) — still exactly one artifact.
    updateProjectKnowledge('proj-1', CAPTURED_KNOWLEDGE);
    project = projectsStore.get().find((p) => p.id === 'proj-1')!;

    const matching = (project.artifacts ?? []).filter((a) => a.type === ARTIFACT_TYPES.REQUIREMENTS_DRAFT);
    expect(matching).toHaveLength(1);
  });

  it('Quick Build projects are never affected by requirements syncing', async () => {
    projectsStore.set([
      baseProject({
        id: 'proj-qb',
        projectType: 'quick_build',
        createdFrom: 'quick_build',
        projectKnowledge: CAPTURED_KNOWLEDGE,
      }),
    ]);

    await hydrateProjectData('proj-qb');

    const project = projectsStore.get().find((p) => p.id === 'proj-qb')!;
    expect(project.artifacts ?? []).toHaveLength(0);
  });
});
