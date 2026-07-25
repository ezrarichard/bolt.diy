import { describe, expect, it } from 'vitest';
import type { Feature } from '~/lib/features/featureTypes';
import type { StructuredDatabaseSchema } from '~/lib/database-activation/schemaTypes';
import type { BackendDraft } from '~/lib/projects/prompts/backend';
import { deriveBackendModulePlans } from './backendModulePlanner';
import { backendModuleFilePathList, backendModuleFilePaths } from './backendModuleTypes';

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'feature-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    code: 'FEAT-001',
    moduleSlug: 'appointments',
    title: 'Book an appointment',
    dependsOn: [],
    status: 'planned',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const SCHEMA: StructuredDatabaseSchema = {
  tables: [
    { name: 'appointments', columns: [], primaryKey: ['id'] },
    { name: 'providers', columns: [], primaryKey: ['id'] },
  ],
};

const BACKEND_DRAFT: BackendDraft = {
  apiEndpoints: ['GET /appointments', 'POST /appointments'],
};

describe('deriveBackendModulePlans — Sprint 79 Phase 1 deterministic Backend Module derivation', () => {
  it('groups a single Feature into a single-module plan carrying the schema tables and API endpoints by reference', () => {
    const plans = deriveBackendModulePlans([makeFeature()], SCHEMA, BACKEND_DRAFT);

    expect(plans).toEqual([
      {
        moduleSlug: 'appointments',
        featureIds: ['FEAT-001'],
        databaseTables: ['appointments', 'providers'],
        apiEndpoints: ['GET /appointments', 'POST /appointments'],
      },
    ]);
  });

  it('accumulates multiple Features sharing one moduleSlug into ONE plan, never one per Feature', () => {
    const features = [
      makeFeature({ id: 'f1', code: 'FEAT-001', moduleSlug: 'appointments' }),
      makeFeature({ id: 'f2', code: 'FEAT-002', moduleSlug: 'appointments' }),
    ];

    const plans = deriveBackendModulePlans(features, SCHEMA, BACKEND_DRAFT);

    expect(plans).toHaveLength(1);
    expect(plans[0].featureIds).toEqual(['FEAT-001', 'FEAT-002']);
  });

  it('produces one plan per distinct moduleSlug when Features belong to different modules', () => {
    const features = [
      makeFeature({ id: 'f1', code: 'FEAT-001', moduleSlug: 'appointments' }),
      makeFeature({ id: 'f2', code: 'FEAT-010', moduleSlug: 'billing' }),
    ];

    const plans = deriveBackendModulePlans(features, SCHEMA, BACKEND_DRAFT);
    const slugs = plans.map((plan) => plan.moduleSlug);

    expect(slugs.sort()).toEqual(['appointments', 'billing']);
  });

  it('never duplicates a Feature code within one module, even if handed the same Feature twice', () => {
    const features = [makeFeature({ id: 'f1', code: 'FEAT-001' }), makeFeature({ id: 'f1', code: 'FEAT-001' })];

    const plans = deriveBackendModulePlans(features, SCHEMA, BACKEND_DRAFT);

    expect(plans[0].featureIds).toEqual(['FEAT-001']);
  });

  it('degrades to empty databaseTables/apiEndpoints (never throws) when no schema/backend draft is approved yet', () => {
    const plans = deriveBackendModulePlans([makeFeature()], undefined, undefined);

    expect(plans[0].databaseTables).toEqual([]);
    expect(plans[0].apiEndpoints).toEqual([]);
  });

  it('returns [] for no Features (no active MVP, or a legacy project)', () => {
    expect(deriveBackendModulePlans([], SCHEMA, BACKEND_DRAFT)).toEqual([]);
  });
});

describe("backendModuleFilePaths / backendModuleFilePathList — single source of truth for a module's fixed file set", () => {
  it('produces the exact six-file Vertical Slice layout for a module', () => {
    expect(backendModuleFilePaths('appointments')).toEqual({
      types: 'src/features/appointments/types.ts',
      validators: 'src/features/appointments/validators.ts',
      repository: 'src/features/appointments/repository.ts',
      service: 'src/features/appointments/service.ts',
      routes: 'src/features/appointments/routes.ts',
      apiAdapter: 'api/appointments/index.ts',
    });
  });

  it("the flat list matches the object's own values in dependency order", () => {
    const paths = backendModuleFilePaths('billing');
    expect(backendModuleFilePathList('billing')).toEqual([
      paths.types,
      paths.validators,
      paths.repository,
      paths.service,
      paths.routes,
      paths.apiAdapter,
    ]);
  });
});
