import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ApplicationManifestDraft, ApplicationManifestFileDraft } from './manifestTypes';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

const { saveApplicationManifest, getActiveApplicationManifest, listManifestVersions, activateManifestFiles } =
  await import('./applicationManifestRepository');

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
      featureIds: [],
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

describe('listManifestVersions', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('returns every version for a project, newest-first', async () => {
    const rows = [
      {
        id: 'm-2',
        project_id: 'proj-1',
        version: 2,
        status: 'active',
        plan_checksum: 'a',
        source_content_checksum: 'a',
        metadata: {},
        total_files: 1,
        completed_files: 0,
        failed_files: 0,
        framework: 'react-vite-ts',
        package_manager: 'npm',
        entry_file: 'src/main.tsx',
        persisted_at: '2026-07-19T00:00:00.000Z',
        created_at: '2026-07-19T00:00:00.000Z',
        updated_at: '2026-07-19T00:00:00.000Z',
        created_by: null,
        completed_at: null,
        source_package_version: null,
        source_package_assembled_at: null,
      },
      {
        id: 'm-1',
        project_id: 'proj-1',
        version: 1,
        status: 'superseded',
        plan_checksum: 'a',
        source_content_checksum: 'a',
        metadata: {},
        total_files: 1,
        completed_files: 0,
        failed_files: 0,
        framework: 'react-vite-ts',
        package_manager: 'npm',
        entry_file: 'src/main.tsx',
        persisted_at: '2026-07-18T00:00:00.000Z',
        created_at: '2026-07-18T00:00:00.000Z',
        updated_at: '2026-07-18T00:00:00.000Z',
        created_by: null,
        completed_at: null,
        source_package_version: null,
        source_package_assembled_at: null,
      },
    ];

    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const versions = await listManifestVersions('proj-1');

    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions.map((v) => v.status)).toEqual(['active', 'superseded']);
  });

  it('returns an empty array when BuildersDB is unavailable', async () => {
    getBuildersDbClientMock.mockReturnValue(null);
    expect(await listManifestVersions('proj-1')).toEqual([]);
  });
});

/**
 * Sprint 98A, BUG-009 — transactional manifest persistence.
 *
 * The regression: Acceptance Round 1 left an orphaned `active` manifest declaring 80 files with
 * zero file rows behind it, because the manifest insert and the file insert were separate
 * round-trips and only the second one failed. These tests pin both halves of the fix — the
 * transactional RPC when the migration is applied, and compensating cleanup when it is not.
 */
describe('saveApplicationManifest — BUG-009 transactional persistence', () => {
  const MANIFEST_ROW = {
    id: 'manifest-tx',
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
    persisted_at: '2026-07-27T00:00:00.000Z',
    created_by: null,
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    completed_at: null,
  };

  /** A client whose `rpc` behaves like a database that HAS applied 20260811100000. */
  function makeTransactionalClient(options: { rpcError?: unknown; latest?: unknown } = {}) {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) =>
      options.rpcError ? { data: null, error: options.rpcError } : { data: MANIFEST_ROW, error: null },
    );
    const manifestInsert = vi.fn();
    const manifestUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const manifestDelete = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));

    const from = vi.fn((table: string) => {
      if (table === 'builders_application_manifests') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: options.latest ? [options.latest] : [], error: null }),
              }),
            }),
          }),
          insert: manifestInsert,
          update: manifestUpdate,
          delete: manifestDelete,
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

    return { client: { from, rpc }, rpc, manifestInsert, manifestUpdate, manifestDelete };
  }

  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('uses the transactional RPC and never writes the tables directly', async () => {
    const { client, rpc, manifestInsert, manifestUpdate } = makeTransactionalClient();
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await saveApplicationManifest(makeDraft(), makeFiles());

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('builders_save_application_manifest');

    // The whole point: no separate insert, no separate supersede.
    expect(manifestInsert).not.toHaveBeenCalled();
    expect(manifestUpdate).not.toHaveBeenCalled();
  });

  it('passes the supersede target to the transaction rather than superseding first', async () => {
    const latest = { ...MANIFEST_ROW, id: 'manifest-old', version: 4, plan_checksum: 'different' };
    const { client, rpc, manifestUpdate } = makeTransactionalClient({ latest });
    getBuildersDbClientMock.mockReturnValue(client);

    await saveApplicationManifest(makeDraft(), makeFiles());

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_supersede_manifest_id: 'manifest-old', p_version: 5 });
    expect(manifestUpdate).not.toHaveBeenCalled();
  });

  it('sends files with a null manifest_id — the transaction assigns it', async () => {
    const { client, rpc } = makeTransactionalClient();
    getBuildersDbClientMock.mockReturnValue(client);

    await saveApplicationManifest(makeDraft(), makeFiles());

    const files = (rpc.mock.calls[0][1] as unknown as { p_files: Array<Record<string, unknown>> }).p_files;

    expect(files).toHaveLength(1);
    expect(files[0].manifest_id).toBeNull();
    expect(files[0].path).toBe('src/App.tsx');
    expect(files[0]).toHaveProperty('feature_ids');
  });

  it('reports a genuine transaction failure without falling back', async () => {
    const { client, manifestInsert } = makeTransactionalClient({
      rpcError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await saveApplicationManifest(makeDraft(), makeFiles());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('duplicate key');

    // A real failure must NOT be retried down the non-transactional path.
    expect(manifestInsert).not.toHaveBeenCalled();
  });

  it('falls back to the legacy path when the migration is not applied', async () => {
    const { client, manifestInsert } = makeTransactionalClient({ rpcError: { code: 'PGRST202' } });
    manifestInsert.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: MANIFEST_ROW, error: null }) }),
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await saveApplicationManifest(makeDraft(), makeFiles());

    expect(result.ok).toBe(true);
    expect(manifestInsert).toHaveBeenCalled();
  });

  it('deletes the manifest when the legacy file insert fails — no orphan survives', async () => {
    const manifestDelete = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({
      data: null,
      error: { code: 'PGRST202' },
    }));

    const from = vi.fn((table: string) => {
      if (table === 'builders_application_manifests') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
          }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: MANIFEST_ROW, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          delete: manifestDelete,
        };
      }

      if (table === 'builders_application_manifest_files') {
        // Exactly the BUG-008 failure that produced the orphan in Acceptance Round 1.
        return {
          insert: () => Promise.resolve({ error: { code: '42703', message: 'column feature_ids does not exist' } }),
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from, rpc });

    const result = await saveApplicationManifest(makeDraft(), makeFiles());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('feature_ids');
    expect(manifestDelete).toHaveBeenCalledTimes(1);
  });

  it('says so explicitly when the orphan cleanup itself fails', async () => {
    const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({
      data: null,
      error: { code: 'PGRST202' },
    }));

    const from = vi.fn((table: string) => {
      if (table === 'builders_application_manifests') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
          }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: MANIFEST_ROW, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          delete: () => ({ eq: () => Promise.resolve({ error: { message: 'delete denied' } }) }),
        };
      }

      return {
        insert: () => Promise.resolve({ error: { message: 'files failed' } }),
        select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from, rpc });

    const result = await saveApplicationManifest(makeDraft(), makeFiles());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('must be cleaned up manually');
  });
});

/**
 * Sprint 99B — plan-time `queued` and the one write phase activation performs. No migration is
 * involved in either: `queued` is an existing `ManifestFileStatus` value and the RPC already takes
 * each row's status from the row itself.
 */
describe('Sprint 99B — queued planning and phase activation', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('inserts planned files as queued, not pending, on the transactional path', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        id: 'manifest-1',
        project_id: 'proj-1',
        version: 1,
        status: 'active',
        framework: 'react-vite-ts',
        package_manager: 'npm',
        entry_file: 'src/main.tsx',
        total_files: 1,
        completed_files: 0,
        failed_files: 0,
        plan_checksum: 'fnv1a:deadbeef',
        source_content_checksum: 'fnv1a:content0',
        metadata: {},
        persisted_at: '2026-07-29T00:00:00.000Z',
        created_by: null,
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T00:00:00.000Z',
        completed_at: null,
        mvp_id: null,
        source_package_version: null,
        source_package_assembled_at: null,
      },
      error: null,
    }));

    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
            then: undefined,
          }),
        }),
      }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from, rpc });

    await saveApplicationManifest(makeDraft(), makeFiles());

    const files = (rpc.mock.calls[0] as unknown as [string, { p_files: { status: string }[] }])[1].p_files;
    expect(files.every((file) => file.status === 'queued')).toBe(true);
  });

  it('activateManifestFiles promotes only queued rows of that manifest', async () => {
    const filters: Record<string, unknown> = {};
    const update = vi.fn(() => ({
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return {
          eq: (innerColumn: string, innerValue: unknown) => {
            filters[innerColumn] = innerValue;
            return {
              in: (inColumn: string, ids: string[]) => {
                filters[inColumn] = ids;
                return { select: () => Promise.resolve({ data: ids.map((id) => ({ id })), error: null }) };
              },
            };
          },
        };
      },
    }));

    getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

    const result = await activateManifestFiles('manifest-1', ['file-a', 'file-b']);

    expect(result).toEqual({ ok: true, activated: 2 });
    expect(update).toHaveBeenCalledWith({ status: 'pending' });
    expect(filters).toEqual({ manifest_id: 'manifest-1', status: 'queued', id: ['file-a', 'file-b'] });
  });

  it('activating an empty set is a no-op success — what a legacy (all-pending) manifest produces', async () => {
    const from = vi.fn();
    getBuildersDbClientMock.mockReturnValue({ from });

    expect(await activateManifestFiles('manifest-1', [])).toEqual({ ok: true, activated: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  it('reports a failed activation instead of throwing', async () => {
    getBuildersDbClientMock.mockReturnValue({
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({ in: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }),
          }),
        }),
      }),
    });

    const result = await activateManifestFiles('manifest-1', ['file-a']);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom');
  });
});
