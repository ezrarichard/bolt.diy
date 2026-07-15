import { describe, expect, it } from 'vitest';
import { getApprovedArtifactContent, getLatestApprovedArtifact, getResumableArtifact } from './artifacts';
import type { ProjectArtifact } from './artifacts';

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

describe('getLatestApprovedArtifact', () => {
  it('returns undefined when nothing of that type is approved', () => {
    const artifacts = [artifact({ id: 'a1', type: 'qa-draft', status: 'draft' })];
    expect(getLatestApprovedArtifact(artifacts, 'qa-draft')).toBeUndefined();
  });

  it('ignores a newer, non-approved version and returns the approved one (same artifact id)', () => {
    const approved = artifact({ id: 'a1', type: 'qa-draft', version: 1, status: 'approved' });
    const abandonedDraft = artifact({
      id: 'a1',
      type: 'qa-draft',
      version: 2,
      status: 'draft',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(getLatestApprovedArtifact([approved, abandonedDraft], 'qa-draft')).toBe(approved);
  });

  it('ignores a newer discarded version and returns the earlier approved one', () => {
    const approved = artifact({ id: 'a1', type: 'devops-draft', version: 1, status: 'approved' });
    const discarded = artifact({
      id: 'a1',
      type: 'devops-draft',
      version: 2,
      status: 'discarded',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });

    expect(getLatestApprovedArtifact([approved, discarded], 'devops-draft')).toBe(approved);
  });

  it('picks the highest-version approved entry when multiple approved versions exist', () => {
    const v1 = artifact({ id: 'a1', type: 'qa-draft', version: 1, status: 'approved' });
    const v2 = artifact({ id: 'a2', type: 'qa-draft', version: 2, status: 'approved' });

    expect(getLatestApprovedArtifact([v1, v2], 'qa-draft')?.id).toBe('a2');
  });
});

describe('getResumableArtifact', () => {
  it('returns the true latest version when it is not discarded', () => {
    const draft = artifact({ id: 'a1', type: 'qa-draft', version: 1, status: 'draft' });
    expect(getResumableArtifact([draft], 'qa-draft')).toBe(draft);
  });

  it('falls back to the latest approved version when the true latest was discarded', () => {
    const approved = artifact({ id: 'a1', type: 'qa-draft', version: 1, status: 'approved' });
    const discarded = artifact({
      id: 'a1',
      type: 'qa-draft',
      version: 2,
      status: 'discarded',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(getResumableArtifact([approved, discarded], 'qa-draft')).toBe(approved);
  });

  it('returns the discarded entry itself when no approved version exists at all', () => {
    const discarded = artifact({ id: 'a1', type: 'qa-draft', version: 1, status: 'discarded' });
    expect(getResumableArtifact([discarded], 'qa-draft')).toBe(discarded);
  });
});

describe('getApprovedArtifactContent', () => {
  it('parses the approved version even when a newer discarded version also exists', () => {
    const approved = artifact({
      id: 'a1',
      type: 'architecture-draft',
      version: 1,
      status: 'approved',
      content: '{"ok":true}',
    });
    const discarded = artifact({
      id: 'a1',
      type: 'architecture-draft',
      version: 2,
      status: 'discarded',
      updatedAt: '2026-01-02T00:00:00.000Z',
      content: '{"ok":false}',
    });

    expect(getApprovedArtifactContent<{ ok: boolean }>([approved, discarded], 'architecture-draft')).toEqual({
      ok: true,
    });
  });
});
