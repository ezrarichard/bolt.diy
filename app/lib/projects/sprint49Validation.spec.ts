import { describe, expect, it } from 'vitest';
import type { GenerationPlan } from '~/lib/code-generation/codeGenerationTypes';
import {
  buildApplicationManifest,
  validateFeatureIds,
  validateManifestFileDrafts,
} from '~/lib/application-manifest/manifestBuilder';
import type { ApplicationManifestFileDraft } from '~/lib/application-manifest/manifestTypes';

/**
 * Sprint 49 — File-Level Feature Traceability & Customer-Edit Protection validation.
 *
 * Covers the parts of this sprint that are pure, deterministic engine logic (Parts 2 and
 * 4 — feature ID tagging and structural rejection). Parts 5-9 (ownership model, edit
 * detection, overwrite policy, conflicts) are covered in
 * app/lib/generated-files/fileOwnership.spec.ts (the decision rules) and
 * app/lib/generated-files/generatedFilesRepository.spec.ts (persistence/carry-forward).
 * The WebContainer-reading glue itself (`useCodeGeneration.ts`'s
 * `detectFileOwnershipConflicts`) is not unit-tested directly — it is a thin, mostly
 * sequencing wrapper around those already-tested pieces plus `readGeneratedFileFromWebContainer`,
 * the same "hook wiring isn't independently unit-tested, its pure dependencies are" pattern
 * this codebase already uses for `createFileLifecycleHooks` and friends.
 */

function makePlan(overrides: Partial<GenerationPlan> = {}): GenerationPlan {
  return {
    pages: [
      {
        name: 'Appointments',
        componentName: 'AppointmentsPage',
        routePath: '/appointments',
        fileName: 'AppointmentsPage.tsx',
      },
    ],
    sharedComponents: ['Navbar'],
    entities: ['Appointment'],
    apiEndpoints: ['/api/appointments'],
    fingerprints: { types: 't', services: 's', pages: 'p', components: 'c' },
    scope: { inScopeFeatureIds: [], outOfScopeFeatureDescriptions: [] },
    ...overrides,
  };
}

describe('Part 2 — file-level Feature ID traceability', () => {
  it('tags every AI-generated file with the active MVP in-scope Feature IDs', () => {
    const plan = makePlan({
      scope: {
        mvpId: 'mvp-1',
        mvpCode: 'MVP-001',
        inScopeFeatureIds: ['FEAT-003', 'FEAT-004'],
        outOfScopeFeatureDescriptions: [],
      },
    });

    const built = buildApplicationManifest({ projectId: 'proj-1', plan });

    expect(built.ok).toBe(true);

    const appointmentsPage = built.files.find((file) => file.path === 'src/pages/AppointmentsPage.tsx');
    expect(appointmentsPage?.featureIds).toEqual(['FEAT-003', 'FEAT-004']);
  });

  it('leaves deterministic scaffold files untagged — they implement no feature', () => {
    const plan = makePlan({
      scope: { mvpId: 'mvp-1', mvpCode: 'MVP-001', inScopeFeatureIds: ['FEAT-003'], outOfScopeFeatureDescriptions: [] },
    });

    const built = buildApplicationManifest({ projectId: 'proj-1', plan });
    const packageJson = built.files.find((file) => file.path === 'package.json');

    expect(packageJson?.featureIds).toEqual([]);
  });

  it('Part 13 — a legacy/no-MVP plan tags nothing at all', () => {
    const built = buildApplicationManifest({ projectId: 'proj-1', plan: makePlan() });
    expect(built.ok).toBe(true);
    expect(built.files.every((file) => file.featureIds.length === 0)).toBe(true);
  });
});

describe('Part 4 — structural Feature ID scope enforcement', () => {
  it('validateFeatureIds accepts IDs that are members of the active MVP scope', () => {
    const result = validateFeatureIds(['FEAT-001', 'FEAT-002'], ['FEAT-001', 'FEAT-002', 'FEAT-003']);
    expect(result).toEqual({ valid: ['FEAT-001', 'FEAT-002'], rejected: [] });
  });

  it('rejects an unrecognized/invented Feature ID', () => {
    const result = validateFeatureIds(['FEAT-001', 'FEAT-999'], ['FEAT-001']);
    expect(result).toEqual({ valid: ['FEAT-001'], rejected: ['FEAT-999'] });
  });

  it('rejects a Feature ID belonging to a different (past or future) MVP — it is simply not a member of the current MVP scope', () => {
    // MVP-002's own features (FEAT-011..FEAT-020, say) are never part of MVP-001's inScopeFeatureIds.
    const result = validateFeatureIds(['FEAT-011'], ['FEAT-001', 'FEAT-002']);
    expect(result).toEqual({ valid: [], rejected: ['FEAT-011'] });
  });

  it('validateManifestFileDrafts strips out-of-scope Feature IDs before persistence and reports a warning, without dropping the file itself', () => {
    const files: ApplicationManifestFileDraft[] = [
      {
        path: 'src/pages/AppointmentsPage.tsx',
        fileType: 'tsx',
        category: 'pages',
        generationOrder: 0,
        dependencies: [],
        required: true,
        sourceKind: 'ai_generated',
        featureIds: ['FEAT-001', 'FEAT-999'],
      },
    ];

    const { files: kept, issues } = validateManifestFileDrafts(files, ['FEAT-001']);

    expect(kept).toHaveLength(1);
    expect(kept[0].featureIds).toEqual(['FEAT-001']);
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('FEAT-999'),
      }),
    );
  });

  it('Part 13 — a legacy build (no valid Feature IDs at all) is not treated as an error', () => {
    const plan = makePlan();
    const built = buildApplicationManifest({ projectId: 'proj-1', plan });
    expect(built.ok).toBe(true);
    expect(built.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
