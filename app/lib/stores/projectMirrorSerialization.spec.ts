import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Sprint 45 — regression test for the BuildersDB write-through race.
 *
 * A role artifact is mirrored twice back-to-back: addProjectArtifact fires the `draft` INSERT
 * and updateProjectArtifact fires the `approved` UPDATE, both a read-then-upsert on the same
 * (artifact_id, version) row. When the mirror was fire-and-forget/unordered, the draft write
 * could land AFTER the approve write and silently persist `draft` (observed live). The queue
 * is now serialized; this proves the approve write only runs once the draft write has fully
 * completed, so `approved` is always the last write.
 */

const { getCurrentSessionMock, isAvailMock, createOrUpdateMock, activityMock } = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  isAvailMock: vi.fn(),
  createOrUpdateMock: vi.fn(),
  activityMock: vi.fn(),
}));

vi.mock('~/lib/auth/authClient', () => ({ getCurrentSession: getCurrentSessionMock }));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  isBuildersDbAvailable: isAvailMock,

  // Any repo method not explicitly listed resolves to a harmless no-op so unrelated mirrors don't throw.
  buildersDbRepository: new Proxy(
    { createOrUpdateRoleOutput: createOrUpdateMock, addProjectActivity: activityMock },
    { get: (target, prop) => (prop in target ? (target as never)[prop] : vi.fn(() => Promise.resolve(true))) },
  ),
}));

vi.mock('~/lib/builders-db/repositories/workspaceStateRepository', () => ({
  workspaceStateRepository: {
    upsertWorkspaceState: vi.fn(() => Promise.resolve(true)),
    getWorkspaceState: vi.fn(() => Promise.resolve(null)),
  },
}));

const { addProjectArtifact, projectsStore } = await import('./projects');

const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe('BuildersDB mirror serialization (Sprint 45)', () => {
  beforeEach(() => {
    isAvailMock.mockReset().mockReturnValue(true);
    getCurrentSessionMock
      .mockReset()
      .mockResolvedValue({ user: { id: 'user-1', email: 'e@example.com', user_metadata: { full_name: 'Tester' } } });
    activityMock.mockReset().mockResolvedValue(true);
    createOrUpdateMock.mockReset();
    projectsStore.set([{ id: 'p1', name: 'P', icon: '', color: 'purple', createdAt: '', artifacts: [] } as never]);
  });

  const makeArtifact = (id: string, status: string) =>
    ({
      id,
      taskId: 't',
      title: id,
      type: 'frontend-draft',
      createdAt: '',
      updatedAt: '',
      status,
      content: '{}',
      version: 1,
    }) as never;

  it('serializes write-through: a later mirror never starts until the earlier one finishes (prevents the draft→approve overwrite race)', async () => {
    const started: string[] = [];
    const finished: string[] = [];
    let releaseFirst: () => void = () => undefined;

    createOrUpdateMock.mockImplementation((_pid: string, artifact: { id: string }) => {
      started.push(artifact.id);

      if (artifact.id === 'first') {
        return new Promise((res) => {
          releaseFirst = () => {
            finished.push('first');
            res(true);
          };
        });
      }

      finished.push(artifact.id);

      return Promise.resolve(true);
    });

    // Two writes enqueued back-to-back; the first is held in-flight.
    addProjectArtifact('p1', makeArtifact('first', 'draft'), 'automatic');
    addProjectArtifact('p1', makeArtifact('second', 'draft'), 'automatic');
    await flush();

    /*
     * While the first write is unresolved, the second must NOT have started — the queue is serialized.
     * (Before the fix, both fired concurrently and the later write could land first and overwrite.)
     */
    expect(started).toEqual(['first']);

    releaseFirst();

    for (let i = 0; i < 60 && !finished.includes('second'); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // The second write ran only after the first fully finished, in enqueue order.
    expect(started).toEqual(['first', 'second']);
    expect(finished).toEqual(['first', 'second']);
  });
});
