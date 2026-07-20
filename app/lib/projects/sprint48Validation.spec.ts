import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GenerationPlanScope } from '~/lib/code-generation/codeGenerationTypes';
import { buildGenerationPlan } from '~/lib/code-generation/generationPipeline';
import { buildApplicationManifest } from '~/lib/application-manifest/manifestBuilder';

/**
 * Sprint 48 — MVP-Aware Generation Engine validation.
 *
 * Confirms the three structural pieces this sprint adds on top of Sprint 44.2's manifest/
 * resume machinery and Sprint 47's prompt-level engineering scoping:
 *
 *  1. `GenerationPlan` carries MVP identity + feature scope (Part 1) — and degrades to an
 *     empty/undefined scope for a legacy project (Part 9).
 *  2. That scope survives into the persisted `ApplicationManifest` via `metadata`, with no
 *     new schema column (Part 2/3).
 *  3. `prepareManifestForGeneration` REFUSES to persist a manifest when the MVP it was
 *     planned for is no longer the active one (Part 7 — a real code-level block, not a
 *     prompt instruction) — and never applies that check for a legacy/no-MVP project
 *     (Part 9).
 */

const { resolveActiveMvpIdMock } = vi.hoisted(() => ({ resolveActiveMvpIdMock: vi.fn() }));

vi.mock('~/lib/mvp/mvpRepository', () => ({
  mvpRepository: { resolveActiveMvpId: resolveActiveMvpIdMock },
}));

const { getActiveApplicationManifestMock, listApplicationManifestFilesMock, saveApplicationManifestMock } = vi.hoisted(
  () => ({
    getActiveApplicationManifestMock: vi.fn(),
    listApplicationManifestFilesMock: vi.fn(),
    saveApplicationManifestMock: vi.fn(),
  }),
);

vi.mock('~/lib/application-manifest/applicationManifestRepository', () => ({
  getActiveApplicationManifest: getActiveApplicationManifestMock,
  listApplicationManifestFiles: listApplicationManifestFilesMock,
  saveApplicationManifest: saveApplicationManifestMock,
}));

vi.mock('~/lib/generated-files/generatedFilesRepository', () => ({
  carryForwardFile: vi.fn().mockResolvedValue({ ok: true, carried: true }),
  isReusableGeneratedStatus: (status: string) => ['generated', 'validated', 'complete'].includes(status),
}));

const { prepareManifestForGeneration } = await import('~/lib/application-manifest/resumeOrchestrator');

const HANDOFF_SCOPE: GenerationPlanScope = {
  mvpId: 'mvp-uuid-1',
  mvpCode: 'MVP-001',
  inScopeFeatureIds: ['FEAT-001', 'FEAT-002'],
  outOfScopeFeatureDescriptions: ['Payments (deferred to MVP-002)'],
};

describe('Part 1 — GenerationPlan is MVP-scoped', () => {
  it('carries the MVP id/code and in-scope Feature IDs when a scope is supplied', () => {
    const plan = buildGenerationPlan({ frontend: { pageHierarchy: ['Home'] } } as any, HANDOFF_SCOPE);

    expect(plan.scope).toEqual(HANDOFF_SCOPE);
  });

  it('Part 9 — degrades to an empty/undefined scope for a legacy project (no MVP resolved)', () => {
    const plan = buildGenerationPlan({ frontend: { pageHierarchy: ['Home'] } } as any);

    expect(plan.scope).toEqual({
      mvpId: undefined,
      mvpCode: undefined,
      inScopeFeatureIds: [],
      outOfScopeFeatureDescriptions: [],
    });
  });
});

describe('Part 2/3 — manifest carries MVP identity + feature scope without a new schema column', () => {
  it('buildApplicationManifest threads mvpId/mvpCode/featureScope onto the manifest draft', () => {
    const plan = buildGenerationPlan({ frontend: { pageHierarchy: ['Home'] } } as any, HANDOFF_SCOPE);

    const built = buildApplicationManifest({
      projectId: 'proj-1',
      plan,
      mvpId: HANDOFF_SCOPE.mvpId,
      mvpCode: HANDOFF_SCOPE.mvpCode,
      featureScope: {
        inScopeFeatureIds: HANDOFF_SCOPE.inScopeFeatureIds,
        outOfScopeFeatureDescriptions: HANDOFF_SCOPE.outOfScopeFeatureDescriptions,
      },
    });

    expect(built.ok).toBe(true);
    expect(built.manifest?.mvpId).toBe('mvp-uuid-1');
    expect(built.manifest?.mvpCode).toBe('MVP-001');
    expect(built.manifest?.featureScope?.inScopeFeatureIds).toEqual(['FEAT-001', 'FEAT-002']);
  });
});

describe('Part 7 — out-of-scope protection (structural enforcement, not a prompt suggestion)', () => {
  beforeEach(() => {
    resolveActiveMvpIdMock.mockReset();
    getActiveApplicationManifestMock.mockReset();
    listApplicationManifestFilesMock.mockReset();
    saveApplicationManifestMock.mockReset();
  });

  function makePlan() {
    return {
      pages: [{ name: 'Home', componentName: 'HomePage', routePath: '/', fileName: 'HomePage.tsx' }],
      sharedComponents: ['Navbar'],
      entities: [],
      apiEndpoints: [],
      fingerprints: { types: 't', services: 's', pages: 'p', components: 'c' },
      scope: HANDOFF_SCOPE,
    };
  }

  it('refuses to persist when the resolved active MVP no longer matches the one this run was planned for', async () => {
    resolveActiveMvpIdMock.mockResolvedValue('mvp-uuid-2'); // a DIFFERENT MVP has since become active

    const result = await prepareManifestForGeneration({
      projectId: 'proj-1',
      plan: makePlan(),
      mvpId: 'mvp-uuid-1',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no longer the active MVP/);
    expect(saveApplicationManifestMock).not.toHaveBeenCalled();
  });

  it('proceeds normally when the resolved active MVP still matches', async () => {
    resolveActiveMvpIdMock.mockResolvedValue('mvp-uuid-1');
    getActiveApplicationManifestMock.mockResolvedValue(null);
    listApplicationManifestFilesMock.mockResolvedValue([]);
    saveApplicationManifestMock.mockResolvedValue({
      ok: true,
      created: true,
      manifest: { id: 'manifest-1', version: 1, totalFiles: 1, mvpId: 'mvp-uuid-1' },
      files: [{ id: 'file-1', path: 'src/App.tsx', category: 'entry' }],
    });

    const result = await prepareManifestForGeneration({
      projectId: 'proj-1',
      plan: makePlan(),
      mvpId: 'mvp-uuid-1',
    });

    expect(result.ok).toBe(true);
    expect(saveApplicationManifestMock).toHaveBeenCalled();
  });

  it('Part 9 — never runs the guard for a legacy/no-MVP project (mvpId undefined)', async () => {
    getActiveApplicationManifestMock.mockResolvedValue(null);
    listApplicationManifestFilesMock.mockResolvedValue([]);
    saveApplicationManifestMock.mockResolvedValue({
      ok: true,
      created: true,
      manifest: { id: 'manifest-1', version: 1, totalFiles: 1 },
      files: [{ id: 'file-1', path: 'src/App.tsx', category: 'entry' }],
    });

    const result = await prepareManifestForGeneration({
      projectId: 'proj-1',
      plan: { ...makePlan(), scope: { inScopeFeatureIds: [], outOfScopeFeatureDescriptions: [] } },
    });

    expect(resolveActiveMvpIdMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('Part 5/8 — reports a cross-MVP transition when the previously active manifest belonged to a different MVP', async () => {
    resolveActiveMvpIdMock.mockResolvedValue('mvp-uuid-2');
    getActiveApplicationManifestMock.mockResolvedValue({
      id: 'manifest-1',
      version: 1,
      mvpId: 'mvp-uuid-1', // MVP-001's manifest
      fingerprints: { types: 't', services: 's', pages: 'p', components: 'c' },
    });
    listApplicationManifestFilesMock.mockResolvedValue([
      { id: 'old-entry-file', path: 'src/App.tsx', category: 'entry' },
    ]);
    saveApplicationManifestMock.mockResolvedValue({
      ok: true,
      created: true,
      manifest: { id: 'manifest-2', version: 2, totalFiles: 1, mvpId: 'mvp-uuid-2' },
      files: [{ id: 'new-entry-file', path: 'src/App.tsx', category: 'entry' }],
    });

    const result = await prepareManifestForGeneration({
      projectId: 'proj-1',
      plan: { ...makePlan(), scope: { ...HANDOFF_SCOPE, mvpId: 'mvp-uuid-2', mvpCode: 'MVP-002' } },
      mvpId: 'mvp-uuid-2', // MVP-002 is now active — this run is planning MVP-002
    });

    expect(result.ok).toBe(true);
    expect(result.crossMvpTransition).toBe(true);
    expect(result.previousMvpId).toBe('mvp-uuid-1');
  });
});
