import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Release } from './releaseTypes';

/**
 * Repository-side Release tests — Sprint 94, Part 15. Own file, same BuildersDB client double the
 * rest of the Deployment domain's specs use.
 */

const { getBuildersDbClientMock } = vi.hoisted(() => ({ getBuildersDbClientMock: vi.fn() }));

vi.mock('~/lib/builders-db/client', () => ({ getBuildersDbClient: getBuildersDbClientMock }));

const { createRelease, recordCustomerAcceptance, getLatestRelease, listReleases, getReleaseBaseline } = await import(
  './deploymentRepository'
);

function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    releaseNumber: 1,
    semanticVersion: '1.0.0',
    releaseName: 'v1.0.0',
    releaseType: 'major',
    releaseDate: '2026-08-10T09:00:00.000Z',
    releaseStatus: 'released',
    baseline: {
      capturedAt: '2026-08-10T09:00:00.000Z',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      manifestVersion: 4,
      deliveryPackageId: 'pkg-1',
      verificationId: 'ver-1',
    },
    releaseNotes: { summary: 'ok', categories: [], breakingChanges: [], knownIssues: [] },
    customerAcceptance: { state: 'pending', conditions: [] },
    integrity: { complete: true, checks: [], checksum: 'fnv1a:abc' },
    metadata: { modelVersion: '1.0.0', intendedType: 'major', intentMatchesVersion: true },
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rel-1',
    deployment_id: 'dep-1',
    project_id: 'proj-1',
    release_number: 1,
    semantic_version: '1.0.0',
    release_name: 'v1.0.0',
    release_type: 'major',
    release_status: 'released',
    release_date: '2026-08-10T09:00:00.000Z',
    delivery_package_id: 'pkg-1',
    verification_id: 'ver-1',
    manifest_version: 4,
    baseline: {
      capturedAt: '2026-08-10T09:00:00.000Z',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      manifestVersion: 4,
    },
    release_notes: { summary: 'ok', categories: [], breakingChanges: [], knownIssues: [] },
    integrity: { complete: true, checks: [], checksum: 'fnv1a:abc' },
    customer_acceptance_state: 'pending',
    customer_acceptance_notes: null,
    customer_acceptance_conditions: [],
    customer_acceptance_recorded_by: null,
    customer_acceptance_recorded_at: null,
    metadata: { modelVersion: '1.0.0', intendedType: 'major', intentMatchesVersion: true },
    created_by: 'ezra',
    created_at: '2026-08-10T09:00:00.000Z',
    updated_at: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}

function makeClient(options: { deploymentStatus?: string; rpcResult?: { data: unknown; error: unknown } }) {
  const rpc = vi.fn().mockResolvedValue(
    options.rpcResult ?? {
      data: {
        id: 'rel-1',
        releaseNumber: 1,
        releaseDate: '2026-08-10T09:00:00.000Z',
        transitioned: true,
        supersededReleases: 0,
        deploymentStatus: 'released',
      },
      error: null,
    },
  );

  const from = vi.fn((table: string) => {
    if (table === 'builders_project_deployments') {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: { status: options.deploymentStatus ?? 'delivery_ready' }, error: null }),
          }),
        }),
      };
    }

    throw new Error(`unexpected table: ${table}`);
  });

  return { client: { from, rpc }, rpc };
}

describe('createRelease', () => {
  beforeEach(() => getBuildersDbClientMock.mockReset());

  it('creates the release through the transactional RPC and reports the lifecycle transition', async () => {
    const { client, rpc } = makeClient({ deploymentStatus: 'delivery_ready' });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createRelease('dep-1', 'proj-1', makeRelease(), { createdBy: 'ezra' });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'builders_create_release',
      expect.objectContaining({
        p_deployment_id: 'dep-1',
        p_project_id: 'proj-1',
        p_semantic_version: '1.0.0',
        p_release_type: 'major',
        p_delivery_package_id: 'pkg-1',
        p_verification_id: 'ver-1',
        p_manifest_version: 4,
      }),
    );
    expect(result).toMatchObject({ ok: true, transitioned: true, supersededReleases: 0 });
    expect(result.ok && result.release.id).toBe('rel-1');
  });

  it('creates a follow-up release from an already-released Deployment and reports the supersede', async () => {
    const { client } = makeClient({
      deploymentStatus: 'released',
      rpcResult: {
        data: {
          id: 'rel-2',
          releaseNumber: 2,
          releaseDate: '2026-08-11T09:00:00.000Z',
          transitioned: false,
          supersededReleases: 1,
          deploymentStatus: 'released',
        },
        error: null,
      },
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createRelease(
      'dep-1',
      'proj-1',
      makeRelease({ semanticVersion: '1.0.1', releaseType: 'patch' }),
    );

    expect(result).toMatchObject({ ok: true, transitioned: false, supersededReleases: 1 });
    expect(result.ok && result.release.releaseNumber).toBe(2);
  });

  it('refuses a Deployment that has no delivery package, and never calls the RPC', async () => {
    const { client, rpc } = makeClient({ deploymentStatus: 'verified' });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createRelease('dep-1', 'proj-1', makeRelease());

    expect(result).toMatchObject({ ok: false, code: 'not_delivery_ready' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate version from the unique constraint as an actionable message', async () => {
    const { client } = makeClient({
      deploymentStatus: 'released',
      rpcResult: { data: null, error: { code: '23505', message: 'duplicate key value' } },
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createRelease('dep-1', 'proj-1', makeRelease());

    expect(result).toMatchObject({ ok: false, code: 'duplicate_version' });
    expect(result.ok === false && result.message).toMatch(/already been released/i);
  });

  it('leaves the Deployment unchanged when the transaction fails', async () => {
    const { client } = makeClient({
      deploymentStatus: 'delivery_ready',
      rpcResult: { data: null, error: { message: 'boom' } },
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createRelease('dep-1', 'proj-1', makeRelease());

    expect(result).toMatchObject({ ok: false, code: 'error' });
    expect(result.ok === false && result.message).toMatch(/left unchanged/i);
  });

  it('returns a failure without throwing when BuildersDB is unconfigured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await createRelease('dep-1', 'proj-1', makeRelease())).toMatchObject({ ok: false, code: 'unavailable' });
  });
});

describe('recordCustomerAcceptance', () => {
  beforeEach(() => getBuildersDbClientMock.mockReset());

  it('records an acceptance as customer_accepted', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { state: 'accepted', previousState: 'pending', eventRecorded: true },
      error: null,
    });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    const result = await recordCustomerAcceptance('rel-1', 'accepted', { notes: 'Looks good', recordedBy: 'ezra' });

    expect(rpc).toHaveBeenCalledWith(
      'builders_record_release_acceptance',
      expect.objectContaining({ p_release_id: 'rel-1', p_state: 'accepted', p_event_type: 'customer_accepted' }),
    );
    expect(result).toMatchObject({ ok: true, state: 'accepted', eventRecorded: true });
  });

  it('maps accepted_with_conditions onto customer_accepted and carries the conditions', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { state: 'accepted_with_conditions' }, error: null });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    await recordCustomerAcceptance('rel-1', 'accepted_with_conditions', { conditions: ['Fix the logo'] });

    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_event_type: 'customer_accepted',
      p_conditions: ['Fix the logo'],
    });
  });

  it('maps rejection and needs_revision onto customer_rejected', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    await recordCustomerAcceptance('rel-1', 'rejected');
    await recordCustomerAcceptance('rel-1', 'needs_revision');

    expect(rpc.mock.calls[0][1].p_event_type).toBe('customer_rejected');
    expect(rpc.mock.calls[1][1].p_event_type).toBe('customer_rejected');
  });

  it('writes no history event when the state is reset to pending', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { state: 'pending', eventRecorded: false }, error: null });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    const result = await recordCustomerAcceptance('rel-1', 'pending');

    expect(rpc.mock.calls[0][1].p_event_type).toBeNull();
    expect(result.eventRecorded).toBe(false);
  });

  it('never touches any table other than the release transaction', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const from = vi.fn();
    getBuildersDbClientMock.mockReturnValue({ rpc, from });

    await recordCustomerAcceptance('rel-1', 'accepted');

    expect(from).not.toHaveBeenCalled();
  });

  it('reports a failure without throwing', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    expect(await recordCustomerAcceptance('rel-1', 'accepted')).toMatchObject({ ok: false, eventRecorded: false });
  });
});

describe('reading releases', () => {
  beforeEach(() => getBuildersDbClientMock.mockReset());

  it('returns the latest release for a deployment', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: makeRow({ release_number: 3 }), error: null });
    const eq = vi.fn().mockReturnValue({ order: () => ({ limit: () => ({ maybeSingle }) }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    const result = await getLatestRelease('dep-1');

    expect(eq).toHaveBeenCalledWith('deployment_id', 'dep-1');
    expect(result).toMatchObject({ releaseNumber: 3, semanticVersion: '1.0.0', releaseStatus: 'released' });
    expect(result?.customerAcceptance.state).toBe('pending');
  });

  it('maps a recorded acceptance back out of the row', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: makeRow({
        customer_acceptance_state: 'accepted_with_conditions',
        customer_acceptance_notes: 'Ship it, but fix the logo',
        customer_acceptance_conditions: ['Fix the logo'],
        customer_acceptance_recorded_by: 'ezra',
        customer_acceptance_recorded_at: '2026-08-11T10:00:00.000Z',
      }),
      error: null,
    });
    getBuildersDbClientMock.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }),
    });

    const result = await getLatestRelease('dep-1');

    expect(result?.customerAcceptance).toMatchObject({
      state: 'accepted_with_conditions',
      conditions: ['Fix the logo'],
      recordedBy: 'ezra',
      recordedAt: '2026-08-11T10:00:00.000Z',
    });
  });

  it('returns null when nothing has been released', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    getBuildersDbClientMock.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }),
    });

    expect(await getLatestRelease('dep-1')).toBeNull();
  });

  it('lists every release newest first, keeping superseded ones available', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        makeRow({ id: 'rel-2', release_number: 2, semantic_version: '1.0.1' }),
        makeRow({ release_status: 'superseded' }),
      ],
      error: null,
    });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ order }) }) }) });

    const result = await listReleases('dep-1');

    expect(result.map((release) => release.semanticVersion)).toEqual(['1.0.1', '1.0.0']);
    expect(result[1].releaseStatus).toBe('superseded');
  });

  it('scopes every read to its own deployment (project isolation)', async () => {
    const eq = vi.fn().mockReturnValue({ order: () => Promise.resolve({ data: [], error: null }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    await listReleases('dep-b');

    expect(eq).toHaveBeenCalledWith('deployment_id', 'dep-b');
  });
});

describe('getReleaseBaseline (Parts 8/9)', () => {
  beforeEach(() => getBuildersDbClientMock.mockReset());

  it('returns the LIVE release baseline, filtering out superseded releases', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: makeRow(), error: null });
    const statusEq = vi.fn().mockReturnValue({ order: () => ({ limit: () => ({ maybeSingle }) }) });
    const deploymentEq = vi.fn().mockReturnValue({ eq: statusEq });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq: deploymentEq }) }) });

    const baseline = await getReleaseBaseline('dep-1');

    expect(deploymentEq).toHaveBeenCalledWith('deployment_id', 'dep-1');
    expect(statusEq).toHaveBeenCalledWith('release_status', 'released');
    expect(baseline).toMatchObject({ deploymentId: 'dep-1', manifestVersion: 4 });
  });

  it('returns null when the deployment has never been released', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    getBuildersDbClientMock.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }),
      }),
    });

    expect(await getReleaseBaseline('dep-1')).toBeNull();
  });
});
