import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Project } from '~/lib/stores/projects';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

const { createProject, createProjectWithResult } = await import('./buildersDbRepository');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-quick-build-1',
    name: 'Build a simple landing page for a Clothing Store',
    icon: '⚡',
    color: 'amber',
    projectType: 'quick_build',
    createdFrom: 'quick_build',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('createProjectWithResult', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('urgent fix — surfaces the real Postgrest error instead of swallowing it', async () => {
    const insert = vi.fn().mockResolvedValue({
      error: { message: 'new row violates row-level security policy for table "builders_projects"' },
    });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert }) });

    const result = await createProjectWithResult(makeProject(), 'user-a');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('new row violates row-level security policy for table "builders_projects"');
  });

  it('returns ok: true and no error on a successful insert', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert }) });

    const result = await createProjectWithResult(makeProject(), 'user-a');

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it('sends project_type/created_from/owner_id/created_by/last_editor matching the authenticated actor', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert }) });

    await createProjectWithResult(makeProject(), 'user-a');

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_type: 'quick_build',
        created_from: 'quick_build',
        owner_id: 'user-a',
        created_by: 'user-a',
        last_editor: 'user-a',
      }),
    );
  });

  /*
   * Urgent fix — live-verified regression test. `.upsert()` (INSERT ... ON CONFLICT DO
   * UPDATE) requires satisfying the UPDATE policy too, which needs a `builders_project_members`
   * row that doesn't exist yet for a brand-new project — an RLS deadlock confirmed against the
   * live database. `.insert()` is the only call that must ever be used here.
   */
  it('uses insert(), never upsert() — upsert deadlocks against builders_projects_update_editable for a brand-new row', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert, upsert }) });

    await createProjectWithResult(makeProject(), 'user-a');

    expect(insert).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns a safe, non-throwing failure when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await createProjectWithResult(makeProject(), 'user-a');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('createProject() (legacy boolean API) still reflects the same success/failure', async () => {
    getBuildersDbClientMock.mockReturnValue({
      from: () => ({ insert: vi.fn().mockResolvedValue({ error: { message: 'boom' } }) }),
    });

    await expect(createProject(makeProject(), 'user-a')).resolves.toBe(false);
  });
});
