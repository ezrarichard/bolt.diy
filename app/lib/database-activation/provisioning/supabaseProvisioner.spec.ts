import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { StructuredDatabaseSchema } from '~/lib/database-activation/schemaTypes';

const { getTokenMock, isBuildersDbProjectIdMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
  isBuildersDbProjectIdMock: vi.fn(() => false),
}));

vi.mock('./supabaseSessionCredentials', () => ({
  getSupabaseProvisioningToken: getTokenMock,
}));

vi.mock('./buildersDbProjectGuard', () => ({
  isBuildersDbProjectId: isBuildersDbProjectIdMock,
  BUILDERS_DB_PROJECT_REFUSAL_MESSAGE: 'Refusing to connect or provision — this is the Builders platform database.',
}));

const { createSupabaseProvisioner } = await import('./supabaseProvisioner');

const FIXTURE_TOKEN = 'sbp_super_secret_pat_do_not_leak';

const SCHEMA: StructuredDatabaseSchema = {
  tables: [
    {
      name: 'users',
      columns: [{ name: 'id', type: 'uuid', nullable: false }],
      primaryKey: ['id'],
      indexes: [{ name: 'users_id_idx', columns: ['id'] }],
    },
  ],
  enums: [{ name: 'role', values: ['admin', 'member'] }],
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

describe('SupabaseProvisioner.provision — Sprint 76', () => {
  beforeEach(() => {
    getTokenMock.mockReset();
    isBuildersDbProjectIdMock.mockReset().mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fails clearly when no session token is connected, without calling fetch', async () => {
    getTokenMock.mockReturnValue(undefined);

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.provision(SCHEMA, 'CREATE TABLE users (...);');

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not connected/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses to provision when the target project resolves to BuildersDB, without ever calling fetch — even with a valid token', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    isBuildersDbProjectIdMock.mockReturnValue(true);

    const provisioner = createSupabaseProvisioner({ projectId: 'builders-db-project' });
    const result = await provisioner.provision(SCHEMA, 'CREATE TABLE users (...);');

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/builders platform database/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('provisions successfully and reports the execution report (statement count = tables + enums + indexes)', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.provision(SCHEMA, 'BEGIN; CREATE TABLE users (...); COMMIT;');

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('supabase');
    expect(result.executionReport).toEqual({
      totalStatements: 3, // 1 table + 1 enum + 1 index
      succeededStatements: 3,
      durationMs: expect.any(Number),
      attempts: 1,
      rolledBack: false,
    });
  });

  it('sends the request to the existing /api/supabase/query route with the token as a Bearer header', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    await provisioner.provision(SCHEMA, 'CREATE TABLE users (...);');

    expect(fetch).toHaveBeenCalledWith(
      '/api/supabase/query',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Bearer ${FIXTURE_TOKEN}` }),
      }),
    );
  });

  it('does not retry a 4xx (non-retryable) failure', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: { status: 400, message: 'syntax error' } }, false, 400));

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.provision(SCHEMA, 'CREATE TABLE users (...);');

    expect(result.ok).toBe(false);
    expect(result.executionReport?.attempts).toBe(1);
    expect(result.executionReport?.rolledBack).toBe(true);
    expect(result.executionReport?.succeededStatements).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx (retryable) failure up to 3 attempts', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: { status: 503, message: 'unavailable' } }, false, 503));

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.provision(SCHEMA, 'CREATE TABLE users (...);');

    expect(result.ok).toBe(false);
    expect(result.executionReport?.attempts).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('never leaks the raw token into the result message or execution report, even on failure', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    vi.mocked(fetch).mockRejectedValue(new Error(`Network error near token ${FIXTURE_TOKEN}`));

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.provision(SCHEMA, 'CREATE TABLE users (...);');

    expect(result.message).not.toContain(FIXTURE_TOKEN);
    expect(result.executionReport?.errorMessage).not.toContain(FIXTURE_TOKEN);
    expect(JSON.stringify(result)).not.toContain(FIXTURE_TOKEN);
  });
});

describe('SupabaseProvisioner.verifyConnection — Sprint 76', () => {
  beforeEach(() => {
    getTokenMock.mockReset();
    isBuildersDbProjectIdMock.mockReset().mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fails clearly when no session token is connected', async () => {
    getTokenMock.mockReturnValue(undefined);

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.verifyConnection();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not connected/i);
  });

  it('refuses to verify when the target project resolves to BuildersDB, without ever calling fetch', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    isBuildersDbProjectIdMock.mockReturnValue(true);

    const provisioner = createSupabaseProvisioner({ projectId: 'builders-db-project' });
    const result = await provisioner.verifyConnection();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/builders platform database/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('verifies auth/connectivity/execution via a lightweight query when no schema is given', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ '?column?': 1 }]));

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.verifyConnection();

    expect(result.ok).toBe(true);
    expect(result.schemaVerification).toBeUndefined();
  });

  it('checks schema existence against information_schema.tables and reports all tables found', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([{ '?column?': 1 }])) // select 1
      .mockResolvedValueOnce(jsonResponse([{ table_name: 'users' }])); // information_schema query

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.verifyConnection(SCHEMA);

    expect(result.ok).toBe(true);
    expect(result.schemaVerification).toEqual({
      expectedTables: ['users'],
      foundTables: ['users'],
      missingTables: [],
    });
  });

  it('reports ok: false with the missing table names when a table is not found', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([{ '?column?': 1 }]))
      .mockResolvedValueOnce(jsonResponse([])); // no tables found

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.verifyConnection(SCHEMA);

    expect(result.ok).toBe(false);
    expect(result.schemaVerification?.missingTables).toEqual(['users']);
    expect(result.message).toMatch(/missing/i);
  });

  it('never leaks the raw token into the verification result', async () => {
    getTokenMock.mockReturnValue(FIXTURE_TOKEN);
    vi.mocked(fetch).mockRejectedValue(new Error(`auth failed for ${FIXTURE_TOKEN}`));

    const provisioner = createSupabaseProvisioner({ projectId: 'proj-abc' });
    const result = await provisioner.verifyConnection();

    expect(JSON.stringify(result)).not.toContain(FIXTURE_TOKEN);
  });
});
