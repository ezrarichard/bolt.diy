import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DeliveryPackage } from './deliveryPackageTypes';

/**
 * Repository-side Delivery Package tests — Sprint 93, Part 17. Own file, same BuildersDB client
 * double the rest of the Deployment domain's specs use.
 */

const { getBuildersDbClientMock } = vi.hoisted(() => ({ getBuildersDbClientMock: vi.fn() }));

vi.mock('~/lib/builders-db/client', () => ({ getBuildersDbClient: getBuildersDbClientMock }));

const { recordDeliveryPackage, getLatestDeliveryPackage, listDeliveryPackages } = await import(
  './deploymentRepository'
);

function makePackage(overrides: Partial<DeliveryPackage> = {}): DeliveryPackage {
  return {
    versionSummary: { manifestVersion: 4, packageNumber: 1 },
    completeness: { score: 92, level: 'almost_complete', dimensions: [] },
    packageMetadata: {
      packageVersion: '1.0.0',
      generatorVersion: '1.0.0',
      deliveredAt: '2026-08-08T12:00:00.000Z',
      sources: [],
    },
    ...overrides,
  } as unknown as DeliveryPackage;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pkg-1',
    deployment_id: 'dep-1',
    project_id: 'proj-1',
    package_number: 1,
    package_version: '1.0.0',
    generator_version: '1.0.0',
    status: 'generated',
    manifest_version: 4,
    verification_id: 'ver-1',
    completeness_score: 92,
    completeness_level: 'almost_complete',
    delivery_summary: { projectInformation: { projectId: 'proj-1', projectName: 'Riverside' } },
    generated_at: '2026-08-08T12:00:00.000Z',
    generated_by: 'ezra',
    created_at: '2026-08-08T12:00:00.000Z',
    ...overrides,
  };
}

function makeClient(options: { deploymentStatus?: string; rpcResult?: { data: unknown; error: unknown } }) {
  const rpc = vi.fn().mockResolvedValue(
    options.rpcResult ?? {
      data: {
        id: 'pkg-1',
        packageNumber: 1,
        generatedAt: '2026-08-08T12:00:00.000Z',
        transitioned: true,
        eventType: 'delivery_package_generated',
        deploymentStatus: 'delivery_ready',
      },
      error: null,
    },
  );

  const from = vi.fn((table: string) => {
    if (table === 'builders_project_deployments') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { status: options.deploymentStatus ?? 'verified' }, error: null }),
          }),
        }),
      };
    }

    throw new Error(`unexpected table: ${table}`);
  });

  return { client: { from, rpc }, rpc };
}

describe('recordDeliveryPackage', () => {
  beforeEach(() => getBuildersDbClientMock.mockReset());

  it('persists the package through the transactional RPC and reports the lifecycle transition', async () => {
    const { client, rpc } = makeClient({ deploymentStatus: 'verified' });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await recordDeliveryPackage('dep-1', 'proj-1', makePackage(), {
      verificationId: 'ver-1',
      generatedBy: 'ezra',
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'builders_record_delivery_package',
      expect.objectContaining({
        p_deployment_id: 'dep-1',
        p_project_id: 'proj-1',
        p_package_version: '1.0.0',
        p_manifest_version: 4,
        p_verification_id: 'ver-1',
        p_completeness_score: 92,
        p_completeness_level: 'almost_complete',
      }),
    );
    expect(result).toMatchObject({ ok: true, transitioned: true, eventType: 'delivery_package_generated' });
    expect(result.ok && result.record.packageNumber).toBe(1);
  });

  it('regenerates for an already-delivery_ready Deployment without a second "generated" event', async () => {
    const { client } = makeClient({
      deploymentStatus: 'delivery_ready',
      rpcResult: {
        data: {
          id: 'pkg-2',
          packageNumber: 2,
          generatedAt: '2026-08-09T12:00:00.000Z',
          transitioned: false,
          eventType: 'delivery_package_updated',
          deploymentStatus: 'delivery_ready',
        },
        error: null,
      },
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await recordDeliveryPackage('dep-1', 'proj-1', makePackage());

    expect(result).toMatchObject({ ok: true, transitioned: false, eventType: 'delivery_package_updated' });
    expect(result.ok && result.record.packageNumber).toBe(2);
  });

  it('refuses an unverified Deployment and never calls the RPC', async () => {
    const { client, rpc } = makeClient({ deploymentStatus: 'deployed' });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await recordDeliveryPackage('dep-1', 'proj-1', makePackage());

    expect(result).toMatchObject({ ok: false, code: 'not_verified' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('leaves the Deployment unchanged when the transaction fails', async () => {
    const { client } = makeClient({
      deploymentStatus: 'verified',
      rpcResult: { data: null, error: { message: 'boom' } },
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await recordDeliveryPackage('dep-1', 'proj-1', makePackage());

    expect(result).toMatchObject({ ok: false, code: 'error' });
    expect(result.ok === false && result.message).toMatch(/left unchanged/i);
  });

  it('returns a failure without throwing when BuildersDB is unconfigured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await recordDeliveryPackage('dep-1', 'proj-1', makePackage())).toMatchObject({
      ok: false,
      code: 'unavailable',
    });
  });
});

describe('reading delivery packages', () => {
  beforeEach(() => getBuildersDbClientMock.mockReset());

  it('returns the latest package for a deployment', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: makeRow({ package_number: 3 }), error: null });
    const eq = vi.fn().mockReturnValue({ order: () => ({ limit: () => ({ maybeSingle }) }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    const result = await getLatestDeliveryPackage('dep-1');

    expect(eq).toHaveBeenCalledWith('deployment_id', 'dep-1');
    expect(result).toMatchObject({
      packageNumber: 3,
      completenessScore: 92,
      completenessLevel: 'almost_complete',
      verificationId: 'ver-1',
    });
    expect(result?.deliverySummary.projectInformation.projectName).toBe('Riverside');
  });

  it('returns null when no package has been generated', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    getBuildersDbClientMock.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }),
    });

    expect(await getLatestDeliveryPackage('dep-1')).toBeNull();
  });

  it('lists every package newest first, keeping older packages available', async () => {
    const order = vi
      .fn()
      .mockResolvedValue({ data: [makeRow({ id: 'pkg-2', package_number: 2 }), makeRow()], error: null });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ order }) }) }) });

    const result = await listDeliveryPackages('dep-1');

    expect(result.map((entry) => entry.packageNumber)).toEqual([2, 1]);
  });

  it('scopes every read to its own deployment (project isolation)', async () => {
    const eq = vi.fn().mockReturnValue({ order: () => Promise.resolve({ data: [], error: null }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    await listDeliveryPackages('dep-b');

    expect(eq).toHaveBeenCalledWith('deployment_id', 'dep-b');
  });
});
