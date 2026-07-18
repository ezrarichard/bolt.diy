import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ApplicationManifestDraft, ApplicationManifestFileDraft } from './manifestTypes';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

const { saveApplicationManifest, getActiveApplicationManifest } = await import('./applicationManifestRepository');

function makeDraft(overrides: Partial<ApplicationManifestDraft> = {}): ApplicationManifestDraft {
  return {
    projectId: 'proj-1',
    framework: 'react-vite-ts',
    packageManager: 'npm',
    entryFile: 'src/main.tsx',
    planChecksum: 'fnv1a:deadbeef',
    sourceContentChecksum: 'fnv1a:content0',
    fingerprints: { types: 'fnv1a:t', services: 'fnv1a:s', pages: 'fnv1a:p', components: 'fnv1a:c' },
    ...overrides,
  };
}

function makeFiles(): ApplicationManifestFileDraft[] {
  return [
    {
      path: 'src/App.tsx',
      fileType: 'tsx',
      category: 'entry',
      generationOrder: 0,
      dependencies: [],
      required: true,
      sourceKind: 'scaffold',
    },
  ];
}

describe('saveApplicationManifest', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('inserts version 1 when no manifest exists yet for the project', async () => {
    const insertedManifestRow = {
      id: 'manifest-1',
      project_id: 'proj-1',
      version: 1,
      status: 'active',
      source_package_version: null,
      source_package_assembled_at: null,
      framework: 'react-vite-ts',
      package_manager: 'npm',
      entry_file: 'src/main.tsx',
      total_files: 1,
      completed_files: 0,
      failed_files: 0,
      plan_checksum: 'fnv1a:deadbeef',
      persisted_at: '2026-07-18T00:00:00.000Z',
      created_by: null,
      created_at: '2026-07-18T00:00:00.000Z',
      updated_at: '2026-07-18T00:00:00.000Z',
      completed_at: null,
    };

    const from = vi.fn((table: string) => {
      if (table === 'builders_application_manifests') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
          }),
          insert: () => ({
            select: () => ({ single: () => Promise.resolve({ data: insertedManifestRow, error: null }) }),
          }),
        };
      }

      if (table === 'builders_application_manifest_files') {
        return {
          insert: () => Promise.resolve({ error: null }),
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await saveApplicationManifest(makeDraft(), makeFiles());

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.manifest?.version).toBe(1);
  });

  it('does not create a duplicate version when the plan checksum is unchanged', async () => {
    const existingRow = {
      id: 'manifest-1',
      project_id: 'proj-1',
      version: 3,
      status: 'active',
      source_package_version: null,
      source_package_assembled_at: null,
      framework: 'react-vite-ts',
      package_manager: 'npm',
      entry_file: 'src/main.tsx',
      total_files: 1,
      completed_files: 0,
      failed_files: 0,
      plan_checksum: 'fnv1a:deadbeef',
      source_content_checksum: 'fnv1a:content0',
      metadata: {},
      persisted_at: '2026-07-18T00:00:00.000Z',
      created_by: null,
      created_at: '2026-07-18T00:00:00.000Z',
      updated_at: '2026-07-18T00:00:00.000Z',
      completed_at: null,
    };

    const insert = vi.fn();

    const from = vi.fn((table: string) => {
      if (table === 'builders_application_manifests') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [existingRow], error: null }) }) }),
          }),
          insert,
        };
      }

      if (table === 'builders_application_manifest_files') {
        return {
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await saveApplicationManifest(makeDraft({ planChecksum: 'fnv1a:deadbeef' }), makeFiles());

    expect(result.ok).toBe(true);
    expect(result.created).toBe(false);
    expect(result.manifest?.version).toBe(3);
    expect(insert).not.toHaveBeenCalled();
  });

  it('supersedes the previous active version and inserts a new one when the checksum changed', async () => {
    const existingRow = {
      id: 'manifest-1',
      project_id: 'proj-1',
      version: 1,
      status: 'active',
      source_package_version: null,
      source_package_assembled_at: null,
      framework: 'react-vite-ts',
      package_manager: 'npm',
      entry_file: 'src/main.tsx',
      total_files: 1,
      completed_files: 0,
      failed_files: 0,
      plan_checksum: 'fnv1a:old00000',
      persisted_at: '2026-07-18T00:00:00.000Z',
      created_by: null,
      created_at: '2026-07-18T00:00:00.000Z',
      updated_at: '2026-07-18T00:00:00.000Z',
      completed_at: null,
    };
    const newRow = { ...existingRow, id: 'manifest-2', version: 2, plan_checksum: 'fnv1a:new11111' };

    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const insert = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: newRow, error: null }) }),
    }));

    const from = vi.fn((table: string) => {
      if (table === 'builders_application_manifests') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [existingRow], error: null }) }) }),
          }),
          update,
          insert,
        };
      }

      if (table === 'builders_application_manifest_files') {
        return {
          insert: () => Promise.resolve({ error: null }),
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await saveApplicationManifest(makeDraft({ planChecksum: 'fnv1a:new11111' }), makeFiles());

    expect(update).toHaveBeenCalled();
    expect(insert).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.manifest?.version).toBe(2);
  });

  /**
   * Sprint 44.2, Phase 3 — the core "manifest checksum vs Product Package checksum"
   * requirement: a project can have the exact same FILE STRUCTURE (same pages/paths,
   * `plan_checksum` unchanged) while the underlying Product Package CONTENT changed
   * (different business vision/requirements) — `source_content_checksum` is what
   * catches that, independent of `plan_checksum`.
   */
  it('creates a new version when only the Product Package content checksum changed (file structure/plan_checksum identical)', async () => {
    const existingRow = {
      id: 'manifest-1',
      project_id: 'proj-1',
      version: 1,
      status: 'active',
      source_package_version: null,
      source_package_assembled_at: null,
      framework: 'react-vite-ts',
      package_manager: 'npm',
      entry_file: 'src/main.tsx',
      total_files: 1,
      completed_files: 0,
      failed_files: 0,
      plan_checksum: 'fnv1a:deadbeef', // SAME as makeDraft()'s default — structure unchanged.
      source_content_checksum: 'fnv1a:content0', // will differ from the new draft below.
      metadata: {},
      persisted_at: '2026-07-18T00:00:00.000Z',
      created_by: null,
      created_at: '2026-07-18T00:00:00.000Z',
      updated_at: '2026-07-18T00:00:00.000Z',
      completed_at: null,
    };

    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const insert = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { ...existingRow, id: 'manifest-2', version: 2 }, error: null }),
      }),
    }));

    const from = vi.fn((table: string) => {
      if (table === 'builders_application_manifests') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [existingRow], error: null }) }) }),
          }),
          update,
          insert,
        };
      }

      if (table === 'builders_application_manifest_files') {
        return {
          insert: () => Promise.resolve({ error: null }),
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await saveApplicationManifest(
      makeDraft({ planChecksum: 'fnv1a:deadbeef', sourceContentChecksum: 'fnv1a:DIFFERENT' }),
      makeFiles(),
    );

    expect(update).toHaveBeenCalled(); // previous version superseded
    expect(insert).toHaveBeenCalled(); // new version created
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.manifest?.version).toBe(2);
  });

  it('forceNewVersion always creates a new version even when both checksums are unchanged ("Restart Generation")', async () => {
    const existingRow = {
      id: 'manifest-1',
      project_id: 'proj-1',
      version: 1,
      status: 'active',
      source_package_version: null,
      source_package_assembled_at: null,
      framework: 'react-vite-ts',
      package_manager: 'npm',
      entry_file: 'src/main.tsx',
      total_files: 1,
      completed_files: 0,
      failed_files: 0,
      plan_checksum: 'fnv1a:deadbeef',
      source_content_checksum: 'fnv1a:content0',
      metadata: {},
      persisted_at: '2026-07-18T00:00:00.000Z',
      created_by: null,
      created_at: '2026-07-18T00:00:00.000Z',
      updated_at: '2026-07-18T00:00:00.000Z',
      completed_at: null,
    };

    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const insert = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { ...existingRow, id: 'manifest-2', version: 2 }, error: null }),
      }),
    }));

    const from = vi.fn((table: string) => {
      if (table === 'builders_application_manifests') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [existingRow], error: null }) }) }),
          }),
          update,
          insert,
        };
      }

      if (table === 'builders_application_manifest_files') {
        return {
          insert: () => Promise.resolve({ error: null }),
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    // Identical checksums to the existing row — would normally be a no-op — but forceNewVersion overrides that.
    const result = await saveApplicationManifest(makeDraft(), makeFiles(), { forceNewVersion: true });

    expect(insert).toHaveBeenCalled();
    expect(result.created).toBe(true);
    expect(result.manifest?.version).toBe(2);
  });

  it('returns a safe, non-throwing failure when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await saveApplicationManifest(makeDraft(), makeFiles());

    expect(result.ok).toBe(false);
    expect(result.created).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('reports a failure (never throws) when the insert errors', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'builders_application_manifests') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
          }),
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: { message: 'insert failed' } }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await saveApplicationManifest(makeDraft(), makeFiles());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('insert failed');
  });

  it('getActiveApplicationManifest returns null when BuildersDB is unavailable', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await getActiveApplicationManifest('proj-1');

    expect(result).toBeNull();
  });
});
