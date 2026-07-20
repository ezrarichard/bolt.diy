import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ManifestFingerprints } from './manifestTypes';

const {
  getActiveApplicationManifestMock,
  listApplicationManifestFilesMock,
  saveApplicationManifestMock,
  carryForwardFileMock,
} = vi.hoisted(() => ({
  getActiveApplicationManifestMock: vi.fn(),
  listApplicationManifestFilesMock: vi.fn(),
  saveApplicationManifestMock: vi.fn(),
  carryForwardFileMock: vi.fn(),
}));

vi.mock('./applicationManifestRepository', () => ({
  getActiveApplicationManifest: getActiveApplicationManifestMock,
  listApplicationManifestFiles: listApplicationManifestFilesMock,
  saveApplicationManifest: saveApplicationManifestMock,
}));

vi.mock('~/lib/generated-files/generatedFilesRepository', () => ({
  carryForwardFile: carryForwardFileMock,
  isReusableGeneratedStatus: (status: string) => ['generated', 'validated', 'complete'].includes(status),
}));

const { classifyResumeAction, determineCategoryInvalidation, resolveCarryForwardPlan, prepareManifestForGeneration } =
  await import('./resumeOrchestrator');

function makePlan(fingerprints: ManifestFingerprints) {
  return {
    pages: [{ name: 'Home', componentName: 'HomePage', routePath: '/', fileName: 'HomePage.tsx' }],
    sharedComponents: ['Navbar'],
    entities: [],
    apiEndpoints: [],
    fingerprints,
    scope: { inScopeFeatureIds: [], outOfScopeFeatureDescriptions: [] },
  };
}

describe('classifyResumeAction — Resume Rules', () => {
  it('skips complete, validated, and generated files (content already exists, no AI call)', () => {
    expect(classifyResumeAction('complete')).toBe('skip');
    expect(classifyResumeAction('validated')).toBe('skip');
    expect(classifyResumeAction('generated')).toBe('skip');
  });

  it('generates pending and failed files', () => {
    expect(classifyResumeAction('pending')).toBe('generate');
    expect(classifyResumeAction('failed')).toBe('generate');
  });

  it('treats an interrupted "generating" file as needing regeneration (retry safely)', () => {
    expect(classifyResumeAction('generating')).toBe('generate');
  });

  it('ignores superseded files (belong to an inactive manifest version)', () => {
    expect(classifyResumeAction('superseded')).toBe('ignore');
  });
});

describe('determineCategoryInvalidation', () => {
  const previous: ManifestFingerprints = { types: 'a', services: 'b', pages: 'c', components: 'd' };

  it('detects no invalidation when every fingerprint is unchanged', () => {
    const result = determineCategoryInvalidation(previous, { types: 'a', services: 'b', pages: 'c', components: 'd' });
    expect(result).toEqual({ types: false, services: false, pages: false, components: false });
  });

  it('detects only the category whose fingerprint actually changed', () => {
    const result = determineCategoryInvalidation(previous, {
      types: 'CHANGED',
      services: 'b',
      pages: 'c',
      components: 'd',
    });
    expect(result).toEqual({ types: true, services: false, pages: false, components: false });
  });
});

describe('resolveCarryForwardPlan — dependency invalidation', () => {
  const noInvalidation = { types: false, services: false, pages: false, components: false };

  it('types: not reusable when its own fingerprint changed', () => {
    expect(resolveCarryForwardPlan('types', { ...noInvalidation, types: true })).toEqual({
      reusable: false,
      downgradeToGenerated: false,
    });
  });

  it('services: reusable and undowngraded when nothing affecting it changed', () => {
    expect(resolveCarryForwardPlan('services', noInvalidation)).toEqual({
      reusable: true,
      downgradeToGenerated: false,
    });
  });

  it('services: reusable but downgraded to "generated" (revalidate only) when types changed — NOT regenerated immediately', () => {
    expect(resolveCarryForwardPlan('services', { ...noInvalidation, types: true })).toEqual({
      reusable: true,
      downgradeToGenerated: true,
    });
  });

  it('pages: reusable but downgraded when either types or services changed (transitive dependency)', () => {
    expect(resolveCarryForwardPlan('pages', { ...noInvalidation, services: true })).toEqual({
      reusable: true,
      downgradeToGenerated: true,
    });
  });

  it('pages: not reusable at all when the pages category itself changed', () => {
    expect(resolveCarryForwardPlan('pages', { ...noInvalidation, pages: true })).toEqual({
      reusable: false,
      downgradeToGenerated: false,
    });
  });

  it('components: independent of types/services/pages — only its own fingerprint matters', () => {
    expect(
      resolveCarryForwardPlan('components', { ...noInvalidation, types: true, services: true, pages: true }),
    ).toEqual({ reusable: true, downgradeToGenerated: false });
  });

  it('scaffold categories (entry/config/styles/documentation) are always reusable — deterministic template code', () => {
    expect(resolveCarryForwardPlan('entry', { types: true, services: true, pages: true, components: true })).toEqual({
      reusable: true,
      downgradeToGenerated: false,
    });
  });
});

describe('prepareManifestForGeneration', () => {
  beforeEach(() => {
    getActiveApplicationManifestMock.mockReset();
    listApplicationManifestFilesMock.mockReset();
    saveApplicationManifestMock.mockReset();
    carryForwardFileMock.mockReset();
  });

  it('resumes (no carry-forward needed) when saveApplicationManifest reports the plan/content unchanged', async () => {
    getActiveApplicationManifestMock.mockResolvedValue(null);
    listApplicationManifestFilesMock.mockResolvedValue([]);
    saveApplicationManifestMock.mockResolvedValue({
      ok: true,
      created: false,
      manifest: { id: 'manifest-1', version: 1, totalFiles: 1 },
      files: [{ id: 'file-1', path: 'src/App.tsx', category: 'entry' }],
    });

    const result = await prepareManifestForGeneration({
      projectId: 'proj-1',
      plan: makePlan({ types: 't', services: 's', pages: 'p', components: 'c' }),
    });

    expect(result.ok).toBe(true);
    expect(result.resumed).toBe(true);
    expect(result.versionCreated).toBe(false);
    expect(result.carriedForwardCount).toBe(0);
    expect(carryForwardFileMock).not.toHaveBeenCalled();
  });

  it('creates a new version and carries forward only unaffected files when content changed', async () => {
    getActiveApplicationManifestMock.mockResolvedValue({
      id: 'manifest-1',
      version: 1,
      fingerprints: { types: 't-old', services: 's', pages: 'p', components: 'c' },
    });
    listApplicationManifestFilesMock.mockResolvedValue([
      { id: 'old-types-file', path: 'src/types/index.ts', category: 'types' },
      { id: 'old-page-file', path: 'src/pages/HomePage.tsx', category: 'pages' },
    ]);
    saveApplicationManifestMock.mockResolvedValue({
      ok: true,
      created: true,
      manifest: { id: 'manifest-2', version: 2, totalFiles: 2 },
      files: [
        { id: 'new-types-file', path: 'src/types/index.ts', category: 'types' },
        { id: 'new-page-file', path: 'src/pages/HomePage.tsx', category: 'pages' },
      ],
    });
    carryForwardFileMock.mockResolvedValue({ ok: true, carried: true });

    const result = await prepareManifestForGeneration({
      projectId: 'proj-1',

      // types fingerprint changed ('t-new' vs old 't-old') — types is NOT reusable, pages IS (downgraded).
      plan: makePlan({ types: 't-new', services: 's', pages: 'p', components: 'c' }),
    });

    expect(result.ok).toBe(true);
    expect(result.versionCreated).toBe(true);
    expect(result.resumed).toBe(false);

    // Only the pages file (unaffected category, downgraded due to types change) is carried forward — types itself is not.
    expect(carryForwardFileMock).toHaveBeenCalledTimes(1);
    expect(carryForwardFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceManifestFileId: 'old-page-file', downgradeToGenerated: true }),
    );
  });

  it('forceRestart creates a new version without carrying anything forward', async () => {
    getActiveApplicationManifestMock.mockResolvedValue({
      id: 'manifest-1',
      version: 1,
      fingerprints: { types: 't', services: 's', pages: 'p', components: 'c' },
    });
    listApplicationManifestFilesMock.mockResolvedValue([
      { id: 'old-types-file', path: 'src/types/index.ts', category: 'types' },
    ]);
    saveApplicationManifestMock.mockResolvedValue({
      ok: true,
      created: true,
      manifest: { id: 'manifest-2', version: 2, totalFiles: 1 },
      files: [{ id: 'new-types-file', path: 'src/types/index.ts', category: 'types' }],
    });

    const result = await prepareManifestForGeneration({
      projectId: 'proj-1',
      plan: makePlan({ types: 't', services: 's', pages: 'p', components: 'c' }), // identical fingerprints
      forceRestart: true,
    });

    expect(saveApplicationManifestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ forceNewVersion: true }),
    );
    expect(result.versionCreated).toBe(true);
    expect(result.carriedForwardCount).toBe(0);
    expect(carryForwardFileMock).not.toHaveBeenCalled();
  });

  it('reports a failure without throwing when saveApplicationManifest fails', async () => {
    getActiveApplicationManifestMock.mockResolvedValue(null);
    listApplicationManifestFilesMock.mockResolvedValue([]);
    saveApplicationManifestMock.mockResolvedValue({ ok: false, created: false, error: 'insert failed' });

    const result = await prepareManifestForGeneration({
      projectId: 'proj-1',
      plan: makePlan({ types: 't', services: 's', pages: 'p', components: 'c' }),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('insert failed');
  });
});
