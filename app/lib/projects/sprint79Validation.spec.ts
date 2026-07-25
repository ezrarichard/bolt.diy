import { describe, expect, it } from 'vitest';
import type { GenerationPlan } from '~/lib/code-generation/codeGenerationTypes';
import { buildApplicationManifest } from '~/lib/application-manifest/manifestBuilder';
import { resolveFileCarryForwardPlan } from '~/lib/application-manifest/resumeOrchestrator';
import { deriveBackendModulePlans } from '~/lib/backend-generation/backendModulePlanner';
import type { Feature } from '~/lib/features/featureTypes';
import type { StructuredDatabaseSchema } from '~/lib/database-activation/schemaTypes';

/**
 * Sprint 79 Phase 1 — Backend Generation Foundation validation.
 *
 * Reproduces this sprint's own Part 12 acceptance walkthrough end-to-end at the deterministic
 * engine layer (`deriveBackendModulePlans` -> `buildApplicationManifest` ->
 * `resolveFileCarryForwardPlan`) — the same layer every prior sprint's own
 * `sprintNNValidation.spec.ts` narrative test already verifies at (see sprint47/48/49's own
 * files), since this codebase has never live-executed a real LLM/WebContainer run inside its
 * own test suite; every other sprint's "does this actually work end to end" claim is backed by
 * exactly this kind of deterministic, mocked-AI-response test instead.
 *
 * ONE Feature (FEAT-001, "Book an appointment"), ONE module ("appointments") — this sprint's own
 * explicit "do NOT generate Billing/Inventory" constraint is satisfied by construction: Billing's
 * Feature simply doesn't exist in this scenario, so `deriveBackendModulePlans` never produces a
 * module for it and nothing downstream can invent one.
 */

const APPOINTMENTS_FEATURE: Feature = {
  id: 'feature-1',
  projectId: 'proj-dental-clinic',
  mvpId: 'mvp-1',
  code: 'FEAT-001',
  moduleSlug: 'appointments',
  title: 'Book an appointment',
  dependsOn: [],
  status: 'planned',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const DENTAL_CLINIC_SCHEMA: StructuredDatabaseSchema = {
  tables: [
    { name: 'appointments', columns: [], primaryKey: ['id'] },
    { name: 'providers', columns: [], primaryKey: ['id'] },
  ],
};

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
    scope: { mvpId: 'mvp-1', mvpCode: 'MVP-001', inScopeFeatureIds: ['FEAT-001'], outOfScopeFeatureDescriptions: [] },
    ...overrides,
  };
}

describe('Part 12 — Dental Clinic verification: ONE backend module (Appointments), end to end', () => {
  it('✓ Backend Module created — one deterministic plan for the Appointments module, referencing (not duplicating) the Feature and schema', () => {
    const modules = deriveBackendModulePlans([APPOINTMENTS_FEATURE], DENTAL_CLINIC_SCHEMA, {
      apiEndpoints: ['GET /appointments', 'POST /appointments'],
    });

    expect(modules).toEqual([
      {
        moduleSlug: 'appointments',
        featureIds: ['FEAT-001'],
        databaseTables: ['appointments', 'providers'],
        apiEndpoints: ['GET /appointments', 'POST /appointments'],
      },
    ]);
  });

  it('✓ Repository/Service/Validators/Types/Routes created, ✓ Manifest updated — the manifest plans exactly six backend files for Appointments, none for any other module', () => {
    const modules = deriveBackendModulePlans([APPOINTMENTS_FEATURE], DENTAL_CLINIC_SCHEMA, undefined);
    const built = buildApplicationManifest({
      projectId: 'proj-dental-clinic',
      mvpId: 'mvp-1',
      plan: makePlan({ backendModules: modules }),
    });

    expect(built.ok).toBe(true);

    const backendFiles = built.files.filter((file) => file.category === 'backend');
    expect(backendFiles.map((file) => file.path).sort()).toEqual(
      [
        'src/features/appointments/types.ts',
        'src/features/appointments/validators.ts',
        'src/features/appointments/repository.ts',
        'src/features/appointments/service.ts',
        'src/features/appointments/routes.ts',
        'api/appointments/index.ts',
      ].sort(),
    );
    expect(backendFiles.every((file) => file.featureIds.includes('FEAT-001'))).toBe(true);

    // Do NOT generate Billing. Do NOT generate Inventory.
    expect(built.files.some((file) => file.path.includes('billing'))).toBe(false);
    expect(built.files.some((file) => file.path.includes('inventory'))).toBe(false);
  });

  it('✓ Resume works, ✓ Carry-forward works, ✓ existing modules untouched — Appointments\' backend files carry forward unaffected by an unrelated frontend "pages" content change', () => {
    const modules = deriveBackendModulePlans([APPOINTMENTS_FEATURE], DENTAL_CLINIC_SCHEMA, undefined);
    const v1 = buildApplicationManifest({
      projectId: 'proj-dental-clinic',
      mvpId: 'mvp-1',
      plan: makePlan({ backendModules: modules }),
    });
    expect(v1.ok).toBe(true);

    const previousRepositoryFile = v1.files.find((file) => file.path === 'src/features/appointments/repository.ts')!;

    // A second, unrelated plan build — same module, same Feature, only the frontend "pages" fingerprint differs (some other page's content changed).
    const v2 = buildApplicationManifest({
      projectId: 'proj-dental-clinic',
      mvpId: 'mvp-1',
      plan: makePlan({
        backendModules: modules,
        fingerprints: { types: 't', services: 's', pages: 'p-CHANGED', components: 'c' },
      }),
    });
    expect(v2.ok).toBe(true);

    const newRepositoryFile = v2.files.find((file) => file.path === 'src/features/appointments/repository.ts')!;

    // The per-file resume decision Sprint 78's resolveFileCarryForwardPlan makes for this file, unaffected by the pages-category invalidation elsewhere in the same manifest.
    const decision = resolveFileCarryForwardPlan(
      previousRepositoryFile,

      // ApplicationManifestFileDraft has the same category/featureIds shape resolveFileCarryForwardPlan needs.
      newRepositoryFile,
      { types: false, services: false, pages: true, components: false },
    );

    expect(decision).toEqual({ reusable: true, downgradeToGenerated: false });
  });

  it("a later MVP's new Feature under the SAME module is not silently trusted as unchanged — regeneration, not stale reuse", () => {
    const remindersFeature: Feature = {
      ...APPOINTMENTS_FEATURE,
      id: 'feature-2',
      mvpId: 'mvp-3',
      code: 'FEAT-018',
      title: 'Appointment reminders',
    };

    const previousModules = deriveBackendModulePlans([APPOINTMENTS_FEATURE], DENTAL_CLINIC_SCHEMA, undefined);
    const accumulatedModules = deriveBackendModulePlans(
      [APPOINTMENTS_FEATURE, remindersFeature],
      DENTAL_CLINIC_SCHEMA,
      undefined,
    );

    // Same ONE module, but its featureIds accumulated — never a second "appointments" module.
    expect(accumulatedModules).toHaveLength(1);
    expect(accumulatedModules[0].featureIds).toEqual(['FEAT-001', 'FEAT-018']);

    const before = buildApplicationManifest({
      projectId: 'proj-dental-clinic',
      plan: makePlan({ backendModules: previousModules }),
    });
    const after = buildApplicationManifest({
      projectId: 'proj-dental-clinic',
      plan: makePlan({
        backendModules: accumulatedModules,
        scope: {
          mvpId: 'mvp-3',
          mvpCode: 'MVP-003',
          inScopeFeatureIds: ['FEAT-001', 'FEAT-018'],
          outOfScopeFeatureDescriptions: [],
        },
      }),
    });

    const previousServiceFile = before.files.find((file) => file.path === 'src/features/appointments/service.ts')!;
    const newServiceFile = after.files.find((file) => file.path === 'src/features/appointments/service.ts')!;

    const decision = resolveFileCarryForwardPlan(previousServiceFile, newServiceFile, {
      types: false,
      services: false,
      pages: false,
      components: false,
    });

    expect(decision).toEqual({ reusable: false, downgradeToGenerated: false });
  });
});
