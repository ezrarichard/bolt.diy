import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { VerificationReport } from './verificationTypes';

/**
 * Repository-side verification tests — Sprint 92, Part 25. Kept in their own file rather than
 * appended to `deploymentRepository.spec.ts` (already 1000+ lines) but using exactly the same
 * BuildersDB client double.
 */

const { getBuildersDbClientMock } = vi.hoisted(() => ({ getBuildersDbClientMock: vi.fn() }));

vi.mock('~/lib/builders-db/client', () => ({ getBuildersDbClient: getBuildersDbClientMock }));

const {
  startDeploymentVerification,
  recordDeploymentVerification,
  getLatestDeploymentVerification,
  listDeploymentVerifications,
} = await import('./deploymentRepository');

function makeVerificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver-1',
    deployment_id: 'dep-1',
    project_id: 'proj-1',
    vercel_deployment_id: 'dpl_1',
    verification_number: 1,
    status: 'running',
    policy_version: '2026-08-07.1',
    started_at: '2026-08-07T00:00:00.000Z',
    completed_at: null,
    duration_ms: null,
    target_url: 'https://app.vercel.app',
    final_url: null,
    summary: {},
    checks: [],
    message: null,
    created_by: null,
    created_at: '2026-08-07T00:00:00.000Z',
    updated_at: '2026-08-07T00:00:00.000Z',
    ...overrides,
  };
}

function makeReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    status: 'passed',
    policyVersion: '2026-08-07.1',
    targetUrl: 'https://app.vercel.app',
    startedAt: '2026-08-07T00:00:00.000Z',
    completedAt: '2026-08-07T00:00:05.000Z',
    durationMs: 5000,
    checks: [],
    summary: {
      total: 3,
      passed: 3,
      failed: 0,
      warnings: 0,
      skipped: 0,
      unavailable: 0,
      requiredTotal: 3,
      requiredPassed: 3,
      requiredFailed: 0,
    },
    message: 'Verification passed — 3/3 required checks passed.',
    ...overrides,
  };
}

/**
 * A client double covering the three tables `startDeploymentVerification` touches. `insertResult`
 * lets a test simulate the partial unique index rejecting a second concurrent attempt.
 */
function makeClient(options: {
  deploymentStatus?: string;
  latestNumber?: number;
  insertResult?: { data: unknown; error: unknown };
}) {
  const historyInsert = vi.fn().mockReturnValue({
    select: () => ({ single: () => Promise.resolve({ data: { id: 'evt-1' }, error: null }) }),
  });

  const verificationInsert = vi.fn().mockReturnValue({
    select: () => ({
      single: () =>
        Promise.resolve(
          options.insertResult ?? {
            data: makeVerificationRow({ verification_number: (options.latestNumber ?? 0) + 1 }),
            error: null,
          },
        ),
    }),
  });

  const from = vi.fn((table: string) => {
    if (table === 'builders_project_deployments') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { status: options.deploymentStatus ?? 'deployed' }, error: null }),
          }),
        }),
      };
    }

    if (table === 'builders_deployment_verifications') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: options.latestNumber ? [{ verification_number: options.latestNumber }] : [],
                  error: null,
                }),
            }),
          }),
        }),
        insert: verificationInsert,
      };
    }

    if (table === 'builders_deployment_history') {
      return { insert: historyInsert };
    }

    throw new Error(`unexpected table: ${table}`);
  });

  return { client: { from, rpc: vi.fn() }, historyInsert, verificationInsert };
}

describe('startDeploymentVerification', () => {
  beforeEach(() => getBuildersDbClientMock.mockReset());

  it('opens attempt #1 for a deployed Deployment and records one verification_started event', async () => {
    const { client, historyInsert, verificationInsert } = makeClient({ deploymentStatus: 'deployed' });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await startDeploymentVerification({
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      policyVersion: '2026-08-07.1',
      targetUrl: 'https://app.vercel.app',
      vercelDeploymentId: 'dpl_1',
    });

    expect(result.ok).toBe(true);
    expect(verificationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment_id: 'dep-1',
        project_id: 'proj-1',
        verification_number: 1,
        status: 'running',
      }),
    );
    expect(historyInsert).toHaveBeenCalledTimes(1);
    expect(historyInsert).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'verification_started' }));
  });

  it('allocates the next verification number so a retry never overwrites an earlier report', async () => {
    const { client, verificationInsert } = makeClient({ deploymentStatus: 'deployed', latestNumber: 3 });
    getBuildersDbClientMock.mockReturnValue(client);

    await startDeploymentVerification({ deploymentId: 'dep-1', projectId: 'proj-1', policyVersion: 'v' });

    expect(verificationInsert).toHaveBeenCalledWith(expect.objectContaining({ verification_number: 4 }));
  });

  it('allows retrying an already-verified Deployment', async () => {
    const { client } = makeClient({ deploymentStatus: 'verified', latestNumber: 1 });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await startDeploymentVerification({
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      policyVersion: 'v',
    });

    expect(result.ok).toBe(true);
  });

  it('refuses to verify a Deployment that has not been deployed, and writes nothing', async () => {
    const { client, verificationInsert, historyInsert } = makeClient({ deploymentStatus: 'environment_ready' });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await startDeploymentVerification({
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      policyVersion: 'v',
    });

    expect(result).toMatchObject({ ok: false, code: 'not_deployed' });
    expect(verificationInsert).not.toHaveBeenCalled();
    expect(historyInsert).not.toHaveBeenCalled();
  });

  it('reports a duplicate concurrent run when the database rejects a second active attempt', async () => {
    const { client } = makeClient({
      deploymentStatus: 'deployed',
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key value' } },
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await startDeploymentVerification({
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      policyVersion: 'v',
    });

    expect(result).toMatchObject({ ok: false, code: 'already_running' });
  });

  it('returns an explicit failure without throwing when BuildersDB is unconfigured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await startDeploymentVerification({
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      policyVersion: 'v',
    });

    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
  });
});

describe('recordDeploymentVerification', () => {
  beforeEach(() => getBuildersDbClientMock.mockReset());

  it('finalises a passing report through the transactional RPC and reports the transition', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { transitioned: true, duplicate: false, eventRecorded: true, deploymentStatus: 'verified' },
      error: null,
    });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    const result = await recordDeploymentVerification('ver-1', makeReport(), { performedBy: 'ezra' });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'builders_finalize_deployment_verification',
      expect.objectContaining({ p_verification_id: 'ver-1', p_status: 'passed', p_permits_verified: true }),
    );
    expect(result).toMatchObject({ ok: true, transitioned: true, deploymentStatus: 'verified' });
  });

  it('permits verified for a warning report (the documented advisory rule)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { transitioned: true }, error: null });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    await recordDeploymentVerification('ver-1', makeReport({ status: 'warning' }));

    expect(rpc.mock.calls[0][1].p_permits_verified).toBe(true);
  });

  it('never permits verified for a failed report, but still persists it', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { transitioned: false }, error: null });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    const report = makeReport({
      status: 'failed',
      summary: { ...makeReport().summary, failed: 1, requiredFailed: 1, requiredPassed: 2 },
    });
    const result = await recordDeploymentVerification('ver-1', report);

    expect(rpc.mock.calls[0][1].p_permits_verified).toBe(false);
    expect(rpc.mock.calls[0][1].p_status).toBe('failed');
    expect(result).toMatchObject({ ok: true, transitioned: false });
  });

  it('never permits verified for a cancelled report', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { transitioned: false }, error: null });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    await recordDeploymentVerification('ver-1', makeReport({ status: 'cancelled' }));

    expect(rpc.mock.calls[0][1].p_permits_verified).toBe(false);
  });

  it('surfaces the "already verified, no duplicate event" outcome from the transaction', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { transitioned: false, duplicate: true, deploymentStatus: 'verified' }, error: null });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    const result = await recordDeploymentVerification('ver-1', makeReport());

    expect(result).toMatchObject({ ok: true, transitioned: false, duplicate: true });
  });

  it('leaves the Deployment unchanged when the report cannot be persisted', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    getBuildersDbClientMock.mockReturnValue({ rpc });

    const result = await recordDeploymentVerification('ver-1', makeReport());

    expect(result).toMatchObject({ ok: false, transitioned: false });
    expect(result.message).toMatch(/left unchanged/i);
  });

  it('returns a failure without throwing when BuildersDB is unconfigured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await recordDeploymentVerification('ver-1', makeReport());

    expect(result.ok).toBe(false);
  });
});

describe('reading verification reports', () => {
  beforeEach(() => getBuildersDbClientMock.mockReset());

  it('returns the latest attempt for a deployment', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: makeVerificationRow({
        verification_number: 4,
        status: 'passed',
        summary: {
          total: 9,
          passed: 9,
          failed: 0,
          warnings: 0,
          skipped: 0,
          unavailable: 0,
          requiredTotal: 6,
          requiredPassed: 6,
          requiredFailed: 0,
        },
      }),
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order: () => ({ limit: () => ({ maybeSingle }) }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    const result = await getLatestDeploymentVerification('dep-1');

    expect(eq).toHaveBeenCalledWith('deployment_id', 'dep-1');
    expect(result).toMatchObject({ verificationNumber: 4, status: 'passed', deploymentId: 'dep-1' });
    expect(result?.summary.requiredPassed).toBe(6);
  });

  it('returns null when a deployment has never been verified', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    getBuildersDbClientMock.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }),
    });

    expect(await getLatestDeploymentVerification('dep-1')).toBeNull();
  });

  it('lists every attempt, newest first, keeping older evidence available', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [makeVerificationRow({ id: 'ver-2', verification_number: 2 }), makeVerificationRow({ id: 'ver-1' })],
      error: null,
    });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ order }) }) }) });

    const result = await listDeploymentVerifications('dep-1');

    expect(result.map((verification) => verification.verificationNumber)).toEqual([2, 1]);
  });

  it('scopes every read to its own deployment (project isolation)', async () => {
    const eq = vi.fn().mockReturnValue({ order: () => Promise.resolve({ data: [], error: null }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    await listDeploymentVerifications('dep-b');

    expect(eq).toHaveBeenCalledWith('deployment_id', 'dep-b');
  });
});
