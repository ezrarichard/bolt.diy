import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ARTIFACT_TYPES, createArtifact, type ProjectArtifact } from './artifacts';
import { databaseDesignerEngine } from './databaseDesignerEngine';
import { uiuxDesignerEngine } from './uiuxDesignerEngine';
import { backendEngineerEngine } from './backendEngineerEngine';
import { frontendEngineerEngine } from './frontendEngineerEngine';
import { qaEngineerEngine } from './qaEngineerEngine';
import type { Project } from '~/lib/stores/projects';

/**
 * Sprint 47 — MVP-Aware Engineering Pipeline validation.
 *
 * Confirms every engineering role from Database through QA now receives the Product
 * Owner's Engineering Handoff (feature IDs, scope, out-of-scope boundary) in its context —
 * the same pattern Solution Architect already had from Sprint 46B — and that a project with
 * no approved Product Owner artifact (a legacy project, or one mid-flow before Gate A)
 * degrades to `engineeringHandoff: undefined`, which `formatEngineeringHandoff`
 * (prompts/shared.ts) renders as "scope the full product as before" — the backward
 * compatibility contract this sprint's instructions require.
 */

const APPROVED_KNOWLEDGE = { projectVision: 'A scheduling app for small clinics.', coreFeatures: ['Booking'] };

function approvedArtifact(type: string, content: unknown): ProjectArtifact {
  return createArtifact({
    taskId: 'requirements',
    title: `${type} v1`,
    type,
    content: JSON.stringify(content),
    status: 'approved',
    generatedBy: 'AI',
    version: 1,
  });
}

const HANDOFF = {
  scope: ['Patient login', 'Appointment booking'],
  constraints: ['Must use existing auth provider'],
  architectureGoals: ['Support adding payments later'],
  successCriteria: ['Booking flow works end to end'],
  acceptanceCriteria: ['A patient can book a slot.'],
  features: [
    { id: 'FEAT-001', name: 'Patient login', priority: 'Must Have' },
    { id: 'FEAT-002', name: 'Appointment booking', priority: 'Must Have' },
  ],
  outOfScopeFeatures: ['Payments', 'SMS notifications'],
  dependencies: ['Appointment booking depends on Patient login'],
};

const PRODUCT_OWNER_DRAFT = {
  productVision: 'x',
  currentMvp: { sequence: 1, engineeringHandoff: HANDOFF },
};

function makeProject(artifacts: ProjectArtifact[]): Project {
  return {
    id: 'proj-47-validation',
    name: 'Clinic Scheduler',
    icon: '',
    color: 'purple',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectKnowledge: APPROVED_KNOWLEDGE,
    artifacts,
  } as unknown as Project;
}

const ARCHITECTURE_CONTENT = { architectureSummary: 'x' };
const DATABASE_CONTENT = { databaseOverview: 'x' };
const UIUX_CONTENT = { designVision: 'x' };
const BACKEND_CONTENT = { backendOverview: 'x' };
const FRONTEND_CONTENT = { frontendOverview: 'x' };

describe('Sprint 47 — Engineering Handoff reaches every downstream role', () => {
  it('Database Engineer context includes the Engineering Handoff (feature IDs + out-of-scope boundary) when a Product Owner artifact is approved', () => {
    const project = makeProject([
      approvedArtifact(ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT, PRODUCT_OWNER_DRAFT),
      approvedArtifact(ARTIFACT_TYPES.ARCHITECTURE_DRAFT, ARCHITECTURE_CONTENT),
    ]);

    const context = databaseDesignerEngine.buildDatabaseContext(project);

    expect(context.engineeringHandoff?.features.map((f) => f.id)).toEqual(['FEAT-001', 'FEAT-002']);
    expect(context.engineeringHandoff?.outOfScopeFeatures).toContain('Payments');
  });

  it('UI/UX Engineer context includes the Engineering Handoff', () => {
    const project = makeProject([
      approvedArtifact(ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT, PRODUCT_OWNER_DRAFT),
      approvedArtifact(ARTIFACT_TYPES.ARCHITECTURE_DRAFT, ARCHITECTURE_CONTENT),
    ]);

    const context = uiuxDesignerEngine.buildUIUXContext(project);

    expect(context.engineeringHandoff?.features.map((f) => f.id)).toEqual(['FEAT-001', 'FEAT-002']);
  });

  it('Backend Engineer context includes the Engineering Handoff', () => {
    const project = makeProject([
      approvedArtifact(ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT, PRODUCT_OWNER_DRAFT),
      approvedArtifact(ARTIFACT_TYPES.ARCHITECTURE_DRAFT, ARCHITECTURE_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.DATABASE_DRAFT, DATABASE_CONTENT),
    ]);

    const context = backendEngineerEngine.buildBackendContext(project);

    expect(context.engineeringHandoff?.features.map((f) => f.id)).toEqual(['FEAT-001', 'FEAT-002']);
  });

  it('Frontend Engineer context includes the Engineering Handoff', () => {
    const project = makeProject([
      approvedArtifact(ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT, PRODUCT_OWNER_DRAFT),
      approvedArtifact(ARTIFACT_TYPES.ARCHITECTURE_DRAFT, ARCHITECTURE_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.UIUX_DRAFT, UIUX_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.BACKEND_DRAFT, BACKEND_CONTENT),
    ]);

    const context = frontendEngineerEngine.buildFrontendContext(project);

    expect(context.engineeringHandoff?.features.map((f) => f.id)).toEqual(['FEAT-001', 'FEAT-002']);
  });

  it('QA Engineer context includes the Engineering Handoff', () => {
    const project = makeProject([
      approvedArtifact(ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT, PRODUCT_OWNER_DRAFT),
      approvedArtifact(ARTIFACT_TYPES.ARCHITECTURE_DRAFT, ARCHITECTURE_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.DATABASE_DRAFT, DATABASE_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.UIUX_DRAFT, UIUX_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.BACKEND_DRAFT, BACKEND_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.FRONTEND_DRAFT, FRONTEND_CONTENT),
    ]);

    const context = qaEngineerEngine.buildQAContext(project);

    expect(context.engineeringHandoff?.features.map((f) => f.id)).toEqual(['FEAT-001', 'FEAT-002']);
  });
});

describe('Sprint 47 — backward compatibility: legacy projects (no Product Owner artifact) degrade cleanly', () => {
  it('Database Engineer context has engineeringHandoff: undefined for a project with no Product Owner artifact — the exact "generate for the whole product" fallback signal', () => {
    const project = makeProject([approvedArtifact(ARTIFACT_TYPES.ARCHITECTURE_DRAFT, ARCHITECTURE_CONTENT)]);

    const context = databaseDesignerEngine.buildDatabaseContext(project);

    expect(context.engineeringHandoff).toBeUndefined();

    /*
     * The gate and the rest of the context are entirely unaffected — this is what proves the
     * "legacy projects continue using the previous generation flow" requirement.
     */
    expect(databaseDesignerEngine.canGenerateDatabase(project)).toBe(true);
    expect(context.architecture).toEqual(ARCHITECTURE_CONTENT);
  });

  it('QA Engineer (the deepest role in the chain) also degrades cleanly with no Product Owner artifact', () => {
    const project = makeProject([
      approvedArtifact(ARTIFACT_TYPES.ARCHITECTURE_DRAFT, ARCHITECTURE_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.DATABASE_DRAFT, DATABASE_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.UIUX_DRAFT, UIUX_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.BACKEND_DRAFT, BACKEND_CONTENT),
      approvedArtifact(ARTIFACT_TYPES.FRONTEND_DRAFT, FRONTEND_CONTENT),
    ]);

    const context = qaEngineerEngine.buildQAContext(project);

    expect(context.engineeringHandoff).toBeUndefined();
    expect(qaEngineerEngine.canGenerateQA(project)).toBe(true);
  });
});

describe('Sprint 47 — manifest/MVP association', () => {
  const { getBuildersDbClientMock } = vi.hoisted(() => ({ getBuildersDbClientMock: vi.fn() }));

  vi.mock('~/lib/builders-db/client', () => ({
    getBuildersDbClient: getBuildersDbClientMock,
    isBuildersDbConfigured: () => true,
  }));

  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('resolveActiveMvpId picks the highest-sequence MVP that has passed Gate A, ignoring "planned" and "superseded" MVPs', async () => {
    const { resolveActiveMvpId } = await import('~/lib/mvp/mvpRepository');

    const rows = [
      {
        id: 'mvp-1',
        project_id: 'p1',
        code: 'MVP-001',
        sequence: 1,
        status: 'superseded',
        theme: null,
        scope_artifact_id: null,
        target_release: null,
        estimated_effort: null,
        business_priority: null,
        blocked_reason: null,
        created_by: null,
        created_at: 'x',
        updated_at: 'x',
        approved_at: null,
      },
      {
        id: 'mvp-2',
        project_id: 'p1',
        code: 'MVP-002',
        sequence: 2,
        status: 'scoped',
        theme: null,
        scope_artifact_id: null,
        target_release: null,
        estimated_effort: null,
        business_priority: null,
        blocked_reason: null,
        created_by: null,
        created_at: 'x',
        updated_at: 'x',
        approved_at: null,
      },
      {
        id: 'mvp-3',
        project_id: 'p1',
        code: 'MVP-003',
        sequence: 3,
        status: 'planned',
        theme: null,
        scope_artifact_id: null,
        target_release: null,
        estimated_effort: null,
        business_priority: null,
        blocked_reason: null,
        created_by: null,
        created_at: 'x',
        updated_at: 'x',
        approved_at: null,
      },
    ];

    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const activeMvpId = await resolveActiveMvpId('p1');

    // MVP-003 is 'planned' (not past Gate A yet) and MVP-001 is 'superseded' — MVP-002 wins.
    expect(activeMvpId).toBe('mvp-2');
  });

  it('resolveActiveMvpId returns undefined when a project has no MVPs at all — the legacy-project signal', async () => {
    const { resolveActiveMvpId } = await import('~/lib/mvp/mvpRepository');

    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    expect(await resolveActiveMvpId('p1')).toBeUndefined();
  });

  it('buildApplicationManifest threads mvpId straight through into the built manifest draft', async () => {
    const { buildApplicationManifest } = await import('~/lib/application-manifest/manifestBuilder');
    const plan = {
      pages: [{ name: 'Home', route: '/' }],
      sharedComponents: [],
      entities: [],
      apiEndpoints: [],
      fingerprints: { types: 't', services: 's', pages: 'p', components: 'c' },
      scope: { inScopeFeatureIds: [], outOfScopeFeatureDescriptions: [] },
    } as unknown as Parameters<typeof buildApplicationManifest>[0]['plan'];

    const result = buildApplicationManifest({ projectId: 'proj-1', plan, mvpId: 'mvp-2' });

    expect(result.ok).toBe(true);
    expect(result.manifest?.mvpId).toBe('mvp-2');
  });

  it('buildApplicationManifest leaves mvpId undefined when omitted — the legacy/no-MVP-yet default', async () => {
    const { buildApplicationManifest } = await import('~/lib/application-manifest/manifestBuilder');
    const plan = {
      pages: [{ name: 'Home', route: '/' }],
      sharedComponents: [],
      entities: [],
      apiEndpoints: [],
      fingerprints: { types: 't', services: 's', pages: 'p', components: 'c' },
      scope: { inScopeFeatureIds: [], outOfScopeFeatureDescriptions: [] },
    } as unknown as Parameters<typeof buildApplicationManifest>[0]['plan'];

    const result = buildApplicationManifest({ projectId: 'proj-1', plan });

    expect(result.ok).toBe(true);
    expect(result.manifest?.mvpId).toBeUndefined();
  });
});
