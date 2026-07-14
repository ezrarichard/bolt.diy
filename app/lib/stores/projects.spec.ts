import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getCurrentSessionMock } = vi.hoisted(() => ({ getCurrentSessionMock: vi.fn() }));
const { createProjectWithResultMock, addProjectActivityMock, isBuildersDbAvailableMock } = vi.hoisted(() => ({
  createProjectWithResultMock: vi.fn(),
  addProjectActivityMock: vi.fn(),
  isBuildersDbAvailableMock: vi.fn(),
}));

vi.mock('~/lib/auth/authClient', () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  isBuildersDbAvailable: isBuildersDbAvailableMock,
  buildersDbRepository: {
    createProject: vi.fn(),
    createProjectWithResult: createProjectWithResultMock,
    addProjectActivity: addProjectActivityMock,
  },
}));

const { createQuickBuildLocalProject, persistQuickBuildProject, addProject, projectsStore } = await import(
  './projects'
);

describe('Quick Build project persistence', () => {
  beforeEach(() => {
    getCurrentSessionMock.mockReset();
    createProjectWithResultMock.mockReset();
    addProjectActivityMock.mockReset().mockResolvedValue(true);
    isBuildersDbAvailableMock.mockReset().mockReturnValue(true);
    projectsStore.set([]);
  });

  it('createQuickBuildLocalProject creates exactly one local project with project_type/created_from = quick_build', () => {
    const project = createQuickBuildLocalProject({ name: 'Clothing Store', icon: '⚡', color: 'amber' });

    expect(project.projectType).toBe('quick_build');
    expect(project.createdFrom).toBe('quick_build');
    expect(projectsStore.get()).toHaveLength(1);
    expect(projectsStore.get()[0].id).toBe(project.id);
  });

  it('persistQuickBuildProject awaits the insert and uses the authenticated user for owner_id/created_by', async () => {
    getCurrentSessionMock.mockResolvedValue({ user: { id: 'user-a', email: 'a@example.com' } });
    createProjectWithResultMock.mockResolvedValue({ ok: true, error: null });

    const project = createQuickBuildLocalProject({ name: 'Clothing Store', icon: '⚡', color: 'amber' });
    const result = await persistQuickBuildProject(project);

    expect(result.ok).toBe(true);
    expect(createProjectWithResultMock).toHaveBeenCalledWith(project, 'user-a');
    expect(addProjectActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: project.id, activityType: 'project_created', actorId: 'user-a' }),
    );
  });

  it('rejects unauthenticated creation with a clear error and never attempts the insert', async () => {
    getCurrentSessionMock.mockResolvedValue(null);

    const project = createQuickBuildLocalProject({ name: 'Clothing Store', icon: '⚡', color: 'amber' });
    const result = await persistQuickBuildProject(project);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/signed in/i);
    expect(createProjectWithResultMock).not.toHaveBeenCalled();
  });

  it('surfaces the real BuildersDB error instead of swallowing it, and does not create a second project on retry', async () => {
    getCurrentSessionMock.mockResolvedValue({ user: { id: 'user-a', email: 'a@example.com' } });
    createProjectWithResultMock.mockResolvedValueOnce({ ok: false, error: 'permission denied' });

    const project = createQuickBuildLocalProject({ name: 'Clothing Store', icon: '⚡', color: 'amber' });
    const failed = await persistQuickBuildProject(project);

    expect(failed.ok).toBe(false);
    expect(failed.error).toBe('permission denied');
    expect(projectsStore.get()).toHaveLength(1); // no duplicate local project created by the failed attempt

    createProjectWithResultMock.mockResolvedValueOnce({ ok: true, error: null });

    // Retry reuses the SAME project object/id — exactly one project id used throughout.
    const retried = await persistQuickBuildProject(project);

    expect(retried.ok).toBe(true);
    expect(retried.project.id).toBe(project.id);
    expect(projectsStore.get()).toHaveLength(1);
    expect(createProjectWithResultMock).toHaveBeenCalledTimes(2);
  });

  it('treats an unconfigured BuildersDB as an accepted local-only fallback, not a failure', async () => {
    isBuildersDbAvailableMock.mockReturnValue(false);

    const project = createQuickBuildLocalProject({ name: 'Clothing Store', icon: '⚡', color: 'amber' });
    const result = await persistQuickBuildProject(project);

    expect(result.ok).toBe(true);
    expect(createProjectWithResultMock).not.toHaveBeenCalled();
  });

  it('Guided Engineering (addProject) remains fire-and-forget and unchanged', () => {
    const project = addProject({
      name: 'Guided Engineering Project',
      icon: '🚀',
      color: 'purple',
      projectType: 'guided_engineering',
      createdFrom: 'guided_engineering',
    });

    // addProject() returns synchronously without awaiting the BuildersDB mirror.
    expect(project.projectType).toBe('guided_engineering');
    expect(projectsStore.get()).toHaveLength(1);
  });
});
