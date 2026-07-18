import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getBuildersDbClientMock, addProjectActivityMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
  addProjectActivityMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  addProjectActivity: addProjectActivityMock,
}));

const { persistGeneratedFile, markFileGenerating, markFileFailed, computeFileChecksum, reconcileUnplannedFile } =
  await import('./generatedFilesRepository');

const BASE_INPUT = {
  projectId: 'proj-1',
  manifestId: 'manifest-1',
  manifestFileId: 'file-1',
  path: 'src/App.tsx',
};

function fileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'gen-1',
    project_id: 'proj-1',
    manifest_id: 'manifest-1',
    manifest_file_id: 'file-1',
    path: 'src/App.tsx',
    status: 'pending',
    latest_version: 0,
    latest_checksum: null,
    validation_status: null,
    generation_attempts: 0,
    repair_count: 0,
    last_error: null,
    generated_by_role: null,
    created_by: null,
    generated_at: null,
    validated_at: null,
    completed_at: null,
    created_at: '2026-07-18T00:00:00.000Z',
    updated_at: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

/** Builds a from() mock that behaves like a tiny in-memory table for the two Phase 2 tables, tracking inserts/updates so assertions can inspect call history. */
function makeClient(
  options: {
    existingFile?: ReturnType<typeof fileRow> | null;
    manifestFilesRow?: { generation_order: number } | null;
  } = {},
) {
  let currentFileRow = options.existingFile ?? null;
  const insertedVersions: any[] = [];
  const manifestFileUpdates: any[] = [];

  const from = vi.fn((table: string) => {
    if (table === 'builders_generated_application_files') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: currentFileRow, error: null }),
          }),
        }),
        insert: (row: any) => ({
          select: () => ({
            single: () => {
              currentFileRow = fileRow({ ...row, id: currentFileRow?.id ?? 'gen-1' });
              return Promise.resolve({ data: currentFileRow, error: null });
            },
          }),
        }),
        update: (patch: any) => ({
          eq: () => ({
            select: () => ({
              single: () => {
                currentFileRow = { ...currentFileRow, ...patch };
                return Promise.resolve({ data: currentFileRow, error: null });
              },
            }),
          }),
        }),
      };
    }

    if (table === 'builders_generated_application_file_versions') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: insertedVersions.find((v) => v.version === currentFileRow?.latest_version) ?? null,
                  error: null,
                }),
            }),
          }),
        }),
        insert: (row: any) => ({
          select: () => ({
            single: () => {
              const inserted = { id: `version-${insertedVersions.length + 1}`, ...row };
              insertedVersions.push(inserted);

              return Promise.resolve({ data: inserted, error: null });
            },
          }),
        }),
      };
    }

    if (table === 'builders_application_manifest_files') {
      return {
        update: (patch: any) => ({
          eq: () => {
            manifestFileUpdates.push(patch);
            return Promise.resolve({ error: null });
          },
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: options.manifestFilesRow ?? null, error: null }),
              }),
            }),
          }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
        insert: (row: any) => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'reconciled-file-1', ...row }, error: null }),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { from, getCurrentFileRow: () => currentFileRow, insertedVersions, manifestFileUpdates };
}

describe('computeFileChecksum', () => {
  it('is deterministic for identical content', () => {
    expect(computeFileChecksum('export {};')).toBe(computeFileChecksum('export {};'));
  });

  it('differs for different content', () => {
    expect(computeFileChecksum('a')).not.toBe(computeFileChecksum('b'));
  });
});

describe('markFileGenerating', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    addProjectActivityMock.mockClear();
  });

  it('creates the generated-file row with status generating and attempts=1 on first call', async () => {
    const client = makeClient({ existingFile: null });
    getBuildersDbClientMock.mockReturnValue(client);

    const ok = await markFileGenerating({ ...BASE_INPUT, role: 'code-gen-types' });

    expect(ok).toBe(true);
    expect(client.getCurrentFileRow()?.status).toBe('generating');
    expect(client.getCurrentFileRow()?.generation_attempts).toBe(1);
  });

  it('increments generation_attempts on a subsequent call', async () => {
    const client = makeClient({ existingFile: fileRow({ generation_attempts: 2, status: 'failed' }) });
    getBuildersDbClientMock.mockReturnValue(client);

    await markFileGenerating({ ...BASE_INPUT, role: 'code-gen-types' });

    expect(client.getCurrentFileRow()?.generation_attempts).toBe(3);
    expect(client.getCurrentFileRow()?.status).toBe('generating');
  });
});

describe('persistGeneratedFile', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    addProjectActivityMock.mockClear();
  });

  it('persists immediately after generation and marks the file generated', async () => {
    const client = makeClient({ existingFile: fileRow({ status: 'generating', generation_attempts: 1 }) });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await persistGeneratedFile({
      ...BASE_INPUT,
      content: 'export default function App() {}',
      generationSource: 'scaffold',
      changeReason: 'initial generation',
    });

    expect(result.ok).toBe(true);
    expect(result.versionCreated).toBe(true);
    expect(client.getCurrentFileRow()?.status).toBe('generated');
    expect(client.manifestFileUpdates[client.manifestFileUpdates.length - 1].status).toBe('generated');
  });

  it('creates a new version when content changed', async () => {
    const client = makeClient({
      existingFile: fileRow({ status: 'generated', latest_version: 1, latest_checksum: computeFileChecksum('old') }),
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await persistGeneratedFile({
      ...BASE_INPUT,
      content: 'new content',
      generationSource: 'scaffold',
      changeReason: 'regenerated',
    });

    expect(result.versionCreated).toBe(true);
    expect(client.insertedVersions).toHaveLength(1);
    expect(client.getCurrentFileRow()?.latest_version).toBe(2);
  });

  it('does not create a new version when the checksum is unchanged', async () => {
    const content = 'unchanged content';
    const client = makeClient({
      existingFile: fileRow({ status: 'generated', latest_version: 1, latest_checksum: computeFileChecksum(content) }),
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await persistGeneratedFile({
      ...BASE_INPUT,
      content,
      generationSource: 'scaffold',
      changeReason: 'no-op regeneration',
    });

    expect(result.ok).toBe(true);
    expect(result.versionCreated).toBe(false);
    expect(client.insertedVersions).toHaveLength(0);

    // Still marked generated even though no new version was created.
    expect(client.getCurrentFileRow()?.status).toBe('generated');
  });

  it('returns a safe, non-throwing failure when BuildersDB is unavailable', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await persistGeneratedFile({
      ...BASE_INPUT,
      content: 'x',
      generationSource: 'scaffold',
      changeReason: 'x',
    });

    expect(result.ok).toBe(false);
    expect(result.versionCreated).toBe(false);
  });
});

describe('markFileFailed', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    addProjectActivityMock.mockClear();
  });

  it('marks only the active file failed and stores its error, leaving no version behind', async () => {
    const client = makeClient({ existingFile: fileRow({ status: 'generating', generation_attempts: 1 }) });
    getBuildersDbClientMock.mockReturnValue(client);

    const ok = await markFileFailed({ ...BASE_INPUT, error: 'model returned invalid JSON' });

    expect(ok).toBe(true);
    expect(client.getCurrentFileRow()?.status).toBe('failed');
    expect(client.getCurrentFileRow()?.last_error).toBe('model returned invalid JSON');
    expect(client.insertedVersions).toHaveLength(0);
  });

  it('emits a generated_file_failed activity event', async () => {
    const client = makeClient({ existingFile: fileRow({ status: 'generating' }) });
    getBuildersDbClientMock.mockReturnValue(client);

    await markFileFailed({ ...BASE_INPUT, error: 'boom' });

    expect(addProjectActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', activityType: 'generated_file_failed' }),
    );
  });
});

describe('reconcileUnplannedFile', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    addProjectActivityMock.mockClear();
  });

  it('rejects an unsafe path without persisting anything', async () => {
    const result = await reconcileUnplannedFile({
      projectId: 'proj-1',
      manifestId: 'manifest-1',
      path: '../../etc/passwd',
      sourceKind: 'ai_generated',
    });

    expect(result.ok).toBe(false);
    expect(getBuildersDbClientMock).not.toHaveBeenCalled();
  });

  it('creates a manifest-file entry for a safe, previously-unplanned path', async () => {
    const client = makeClient({ manifestFilesRow: { generation_order: 25 } });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await reconcileUnplannedFile({
      projectId: 'proj-1',
      manifestId: 'manifest-1',
      path: 'src/components/ExtraCard.tsx',
      sourceKind: 'ai_generated',
      category: 'components',
    });

    expect(result.ok).toBe(true);
    expect(result.manifestFileId).toBe('reconciled-file-1');
    expect(addProjectActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: 'manifest_reconciled' }),
    );
  });

  it('emits unplanned_file_rejected activity for a rejected path', async () => {
    await reconcileUnplannedFile({
      projectId: 'proj-1',
      manifestId: 'manifest-1',
      path: '/etc/passwd',
      sourceKind: 'ai_generated',
    });

    expect(addProjectActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: 'unplanned_file_rejected' }),
    );
  });
});
