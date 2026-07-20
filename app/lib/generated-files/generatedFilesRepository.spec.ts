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

const {
  persistGeneratedFile,
  markFileGenerating,
  markFileFailed,
  computeFileChecksum,
  reconcileUnplannedFile,
  getReusableFileContent,
  carryForwardFile,
  reconstructFilesFromManifest,
  isReusableGeneratedStatus,
  updateFileOwnership,
} = await import('./generatedFilesRepository');

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
    ownership: null as string | null,
    current_hash: null as string | null,
    user_modified_at: null as string | null,
    conflict_state: null as string | null,
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

describe('isReusableGeneratedStatus — Resume "trusted" statuses', () => {
  it('trusts generated, validated, and complete', () => {
    expect(isReusableGeneratedStatus('generated')).toBe(true);
    expect(isReusableGeneratedStatus('validated')).toBe(true);
    expect(isReusableGeneratedStatus('complete')).toBe(true);
  });

  it('does not trust pending, failed, generating, or repairing', () => {
    expect(isReusableGeneratedStatus('pending')).toBe(false);
    expect(isReusableGeneratedStatus('failed')).toBe(false);
    expect(isReusableGeneratedStatus('generating')).toBe(false);
    expect(isReusableGeneratedStatus('repairing')).toBe(false);
  });
});

describe('getReusableFileContent', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  function makeReadOnlyClient(
    fileByManifestFileId: Record<string, any>,
    versionByFileIdAndVersion: Record<string, string>,
  ) {
    return {
      from: (table: string) => {
        if (table === 'builders_generated_application_files') {
          return {
            select: () => ({
              eq: (_col: string, value: string) => ({
                maybeSingle: () => Promise.resolve({ data: fileByManifestFileId[value] ?? null, error: null }),
              }),
            }),
          };
        }

        if (table === 'builders_generated_application_file_versions') {
          return {
            select: () => ({
              eq: (_col: string, generatedFileId: string) => ({
                eq: (_col2: string, version: number) => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: versionByFileIdAndVersion[`${generatedFileId}:${version}`]
                        ? { content: versionByFileIdAndVersion[`${generatedFileId}:${version}`] }
                        : null,
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };
  }

  it('returns content for a file whose status is trusted (generated/validated/complete)', async () => {
    getBuildersDbClientMock.mockReturnValue(
      makeReadOnlyClient(
        { 'file-1': { id: 'gen-1', status: 'complete', latest_version: 2 } },
        { 'gen-1:2': 'export const x = 1;' },
      ),
    );

    const content = await getReusableFileContent('file-1');
    expect(content).toBe('export const x = 1;');
  });

  it('returns undefined for a file whose status is not trusted (e.g. pending/failed)', async () => {
    getBuildersDbClientMock.mockReturnValue(
      makeReadOnlyClient({ 'file-1': { id: 'gen-1', status: 'failed', latest_version: 1 } }, {}),
    );

    const content = await getReusableFileContent('file-1');
    expect(content).toBeUndefined();
  });

  it('returns undefined when no generated-file row exists at all', async () => {
    getBuildersDbClientMock.mockReturnValue(makeReadOnlyClient({}, {}));

    const content = await getReusableFileContent('file-never-generated');
    expect(content).toBeUndefined();
  });
});

describe('carryForwardFile', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    addProjectActivityMock.mockClear();
  });

  it('copies content/status forward from the source file onto the new manifest file (undowngraded)', async () => {
    const sourceFileRow = {
      id: 'old-gen-1',
      manifest_id: 'old-manifest',
      status: 'complete',
      latest_version: 1,
      latest_checksum: 'fnv1a:abc',
      generated_by_role: 'code-gen-types',
      generated_at: '2026-07-18T00:00:00.000Z',
    };

    const insertedFiles: any[] = [];
    const insertedVersions: any[] = [];

    const from = vi.fn((table: string) => {
      if (table === 'builders_generated_application_files') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: sourceFileRow, error: null }) }),
          }),
          insert: (row: any) => ({
            select: () => ({
              single: () => {
                const inserted = { id: 'new-gen-1', ...row };
                insertedFiles.push(inserted);

                return Promise.resolve({ data: inserted, error: null });
              },
            }),
          }),
        };
      }

      if (table === 'builders_generated_application_file_versions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { content: 'export interface X {}' }, error: null }),
              }),
            }),
          }),
          insert: (row: any) => {
            insertedVersions.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === 'builders_application_manifest_files') {
        return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await carryForwardFile({
      projectId: 'proj-1',
      newManifestId: 'new-manifest',
      newManifestFileId: 'new-manifest-file-1',
      path: 'src/types/index.ts',
      sourceManifestFileId: 'old-manifest-file-1',
      downgradeToGenerated: false,
    });

    expect(result.ok).toBe(true);
    expect(result.carried).toBe(true);
    expect(insertedFiles[0].status).toBe('complete');
    expect(insertedVersions[0].content).toBe('export interface X {}');
    expect(insertedVersions[0].version).toBe(1);
  });

  it('Sprint 49 — carries ownership/edit-detection state forward with the content it describes, resetting only conflict_state', async () => {
    const sourceFileRow = {
      id: 'old-gen-1',
      manifest_id: 'old-manifest',
      status: 'complete',
      latest_version: 1,
      latest_checksum: 'fnv1a:abc',
      generated_by_role: 'code-gen-types',
      generated_at: '2026-07-18T00:00:00.000Z',
      ownership: 'protected',
      current_hash: 'fnv1a:abc',
      user_modified_at: null,
      conflict_state: 'pending_review',
    };

    const insertedFiles: any[] = [];

    const from = vi.fn((table: string) => {
      if (table === 'builders_generated_application_files') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: sourceFileRow, error: null }) }),
          }),
          insert: (row: any) => ({
            select: () => ({
              single: () => {
                const inserted = { id: 'new-gen-1', ...row };
                insertedFiles.push(inserted);

                return Promise.resolve({ data: inserted, error: null });
              },
            }),
          }),
        };
      }

      if (table === 'builders_generated_application_file_versions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { content: 'export interface X {}' }, error: null }),
              }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }

      if (table === 'builders_application_manifest_files') {
        return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    await carryForwardFile({
      projectId: 'proj-1',
      newManifestId: 'new-manifest',
      newManifestFileId: 'new-manifest-file-1',
      path: 'src/lib/custom.ts',
      sourceManifestFileId: 'old-manifest-file-1',
      downgradeToGenerated: false,
    });

    expect(insertedFiles[0].ownership).toBe('protected');
    expect(insertedFiles[0].current_hash).toBe('fnv1a:abc');
    expect(insertedFiles[0].conflict_state).toBeNull();
  });

  it('downgrades to "generated" instead of the source status when downgradeToGenerated is true', async () => {
    const sourceFileRow = {
      id: 'old-gen-2',
      manifest_id: 'old-manifest',
      status: 'complete',
      latest_version: 1,
      latest_checksum: 'fnv1a:def',
      generated_by_role: 'code-gen-services',
      generated_at: '2026-07-18T00:00:00.000Z',
    };

    const insertedFiles: any[] = [];

    const from = vi.fn((table: string) => {
      if (table === 'builders_generated_application_files') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: sourceFileRow, error: null }) }) }),
          insert: (row: any) => ({
            select: () => ({
              single: () => {
                const inserted = { id: 'new-gen-2', ...row };
                insertedFiles.push(inserted);

                return Promise.resolve({ data: inserted, error: null });
              },
            }),
          }),
        };
      }

      if (table === 'builders_generated_application_file_versions') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { content: 'x' }, error: null }) }) }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }

      if (table === 'builders_application_manifest_files') {
        return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    await carryForwardFile({
      projectId: 'proj-1',
      newManifestId: 'new-manifest',
      newManifestFileId: 'new-manifest-file-2',
      path: 'src/services/api.ts',
      sourceManifestFileId: 'old-manifest-file-2',
      downgradeToGenerated: true,
    });

    expect(insertedFiles[0].status).toBe('generated');
  });

  it('does not carry forward when the source file is not in a trusted status', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'builders_generated_application_files') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { status: 'failed', latest_version: 0 }, error: null }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await carryForwardFile({
      projectId: 'proj-1',
      newManifestId: 'new-manifest',
      newManifestFileId: 'new-manifest-file-3',
      path: 'src/App.tsx',
      sourceManifestFileId: 'old-manifest-file-3',
      downgradeToGenerated: false,
    });

    expect(result.ok).toBe(true);
    expect(result.carried).toBe(false);
  });
});

describe('reconstructFilesFromManifest — Workspace Restore / WebContainer Restart', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it("reconstructs only files with a trusted status, fetching each one's latest content — never calling the AI", async () => {
    const generatedFileRows = [
      {
        id: 'gen-1',
        manifest_id: 'manifest-1',
        manifest_file_id: 'mf-1',
        path: 'src/App.tsx',
        status: 'complete',
        latest_version: 1,
      },
      {
        id: 'gen-2',
        manifest_id: 'manifest-1',
        manifest_file_id: 'mf-2',
        path: 'src/pages/HomePage.tsx',
        status: 'validated',
        latest_version: 1,
      },
      {
        id: 'gen-3',
        manifest_id: 'manifest-1',
        manifest_file_id: 'mf-3',
        path: 'src/pages/ContactPage.tsx',
        status: 'pending',
        latest_version: 0,
      },
    ];

    const from = vi.fn((table: string) => {
      if (table === 'builders_generated_application_files') {
        return {
          select: () => ({
            eq: (col: string, value: string) => {
              if (col === 'manifest_id') {
                return Promise.resolve({ data: generatedFileRows, error: null });
              }

              // manifest_file_id lookup (used internally by getReusableFileContent)
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: generatedFileRows.find((r) => r.manifest_file_id === value) ?? null,
                    error: null,
                  }),
              };
            },
          }),
        };
      }

      if (table === 'builders_generated_application_file_versions') {
        return {
          select: () => ({
            eq: (_col: string, generatedFileId: string) => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { content: `content of ${generatedFileId}` },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const files = await reconstructFilesFromManifest('manifest-1');

    // Only the 'complete'/'validated' files (not the 'pending' one) are reconstructed.
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path).sort()).toEqual(['src/App.tsx', 'src/pages/HomePage.tsx']);
    expect(files.find((f) => f.path === 'src/App.tsx')?.content).toBe('content of gen-1');
  });

  it('returns an empty array when BuildersDB is unavailable', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const files = await reconstructFilesFromManifest('manifest-1');
    expect(files).toEqual([]);
  });
});

describe('updateFileOwnership', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('persists ownership/current_hash/user_modified_at/conflict_state onto the existing row', async () => {
    const client = makeClient({ existingFile: fileRow({ ownership: null }) });
    getBuildersDbClientMock.mockReturnValue(client);

    const ok = await updateFileOwnership({
      ...BASE_INPUT,
      ownership: 'user_modified',
      currentHash: 'fnv1a:new',
      userModifiedAt: '2026-07-26T00:00:00.000Z',
      conflictState: 'pending_review',
    });

    expect(ok).toBe(true);
    expect(client.getCurrentFileRow()?.ownership).toBe('user_modified');
    expect(client.getCurrentFileRow()?.current_hash).toBe('fnv1a:new');
    expect(client.getCurrentFileRow()?.conflict_state).toBe('pending_review');
  });

  it('is a no-op when no generated-file row exists yet for this manifest file', async () => {
    const client = makeClient({ existingFile: null });
    getBuildersDbClientMock.mockReturnValue(client);

    const ok = await updateFileOwnership({ ...BASE_INPUT, ownership: 'builders_generated' });

    expect(ok).toBe(false);
  });

  it('returns false (never throws) when BuildersDB is unavailable', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const ok = await updateFileOwnership({ ...BASE_INPUT, ownership: 'builders_generated' });
    expect(ok).toBe(false);
  });
});
