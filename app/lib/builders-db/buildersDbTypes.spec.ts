import { describe, expect, it } from 'vitest';
import { fromRoleOutputRow, toRoleOutputRow, type BuildersDbRoleOutputRow } from './buildersDbTypes';
import type { ProjectArtifact } from '~/lib/projects/artifacts';

/** Sprint 78 Phase 0 — `mvpId` round-trip: the `builders_role_outputs.mvp_id` column has existed since Sprint 45, but nothing wrote or read it back until this sprint (Sprint 77 recommendation #1). */

function makeArtifact(overrides: Partial<ProjectArtifact> = {}): ProjectArtifact {
  return {
    id: 'artifact-1',
    taskId: 'requirements',
    title: 'Database Design Draft v1',
    type: 'database-draft',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    status: 'draft',
    content: '{}',
    generatedBy: 'AI Database Designer',
    version: 1,
    ...overrides,
  };
}

describe('toRoleOutputRow — mvpId (Sprint 78 Phase 0)', () => {
  it('writes the given mvpId into the row', () => {
    const row = toRoleOutputRow('proj-1', makeArtifact(), 'manual', null, null, 'mvp-1');

    expect(row.mvp_id).toBe('mvp-1');
  });

  it('writes null when no mvpId is given, matching every existing call site before this sprint', () => {
    const row = toRoleOutputRow('proj-1', makeArtifact());

    expect(row.mvp_id).toBeNull();
  });
});

describe('fromRoleOutputRow — mvpId (Sprint 78 Phase 0)', () => {
  function makeRow(overrides: Partial<BuildersDbRoleOutputRow> = {}): BuildersDbRoleOutputRow {
    return {
      id: 'row-1',
      artifact_id: 'artifact-1',
      project_id: 'proj-1',
      task_id: 'requirements',
      role_key: 'database-draft',
      role_name: 'AI Database Designer',
      title: 'Database Design Draft v1',
      status: 'draft',
      content: '{}',
      version: 1,
      generation_type: 'manual',
      parent_version_id: null,
      generated_by_user: null,
      mvp_id: null,
      created_at: '2026-07-25T00:00:00.000Z',
      updated_at: '2026-07-25T00:00:00.000Z',
      ...overrides,
    };
  }

  it('reads mvp_id back as mvpId when present', () => {
    const artifact = fromRoleOutputRow(makeRow({ mvp_id: 'mvp-1' }));

    expect(artifact.mvpId).toBe('mvp-1');
  });

  it('reads undefined (never null) when mvp_id is null — matching every other optional ProjectArtifact field', () => {
    const artifact = fromRoleOutputRow(makeRow({ mvp_id: null }));

    expect(artifact.mvpId).toBeUndefined();
  });

  it("round-trips: writing an artifact with mvpId (as stores/projects.ts's call sites now do, passing artifact.mvpId through explicitly) and reading the row back yields the same mvpId", () => {
    const original = makeArtifact({ mvpId: 'mvp-42' });
    const row = toRoleOutputRow('proj-1', original, 'manual', null, null, original.mvpId ?? null);
    const roundTripped = fromRoleOutputRow({ ...makeRow(), mvp_id: row.mvp_id, id: 'row-1' });

    expect(roundTripped.mvpId).toBe('mvp-42');
  });
});
