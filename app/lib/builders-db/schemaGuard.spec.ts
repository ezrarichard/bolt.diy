import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sprint 98A, BUG-008 — schema drift guard.
 *
 * The regression these tests exist for: Acceptance Round 1 ran code generation for over four
 * minutes against a database missing `builders_application_manifest_files.feature_ids`, persisting
 * nothing, while every other signal said the system was healthy. The guard must detect exactly
 * that condition, and must NOT cry drift for any other kind of failure.
 */

vi.mock('./client', () => ({ getBuildersDbClient: vi.fn(() => null) }));

const { REQUIRED_BUILDERS_DB_SCHEMA, describeSchemaDrift, resetSchemaGuardCache, verifyBuildersDbSchema } =
  await import('./schemaGuard');

const CLOCK = () => '2026-07-27T14:00:00.000Z';

/** A stub PostgREST client. `missing` lists columns the fake database does not have. */
function makeClient(options: { missing?: string[]; missingTables?: string[]; failWith?: unknown } = {}) {
  const missing = new Set(options.missing ?? []);
  const missingTables = new Set(options.missingTables ?? []);
  const calls: Array<{ table: string; columns: string }> = [];

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          calls.push({ table, columns });
          return {
            async limit() {
              if (options.failWith) {
                return { error: options.failWith };
              }

              if (missingTables.has(table)) {
                return { error: { code: 'PGRST205', message: 'Could not find the table' } };
              }

              const requested = columns.split(',');
              const bad = requested.find((column) => missing.has(`${table}.${column}`));

              return bad
                ? { error: { code: '42703', message: `column ${table}.${bad} does not exist` } }
                : { error: null };
            },
          };
        },
      };
    },
  };

  return { client, calls };
}

beforeEach(() => {
  resetSchemaGuardCache();
});

describe('REQUIRED_BUILDERS_DB_SCHEMA', () => {
  it('covers the exact columns that BUG-008 proved were missing', () => {
    const manifestFiles = REQUIRED_BUILDERS_DB_SCHEMA.find(
      (spec) => spec.table === 'builders_application_manifest_files',
    );
    const generatedFiles = REQUIRED_BUILDERS_DB_SCHEMA.find(
      (spec) => spec.table === 'builders_generated_application_files',
    );

    expect(manifestFiles?.columns).toContain('feature_ids');
    expect(generatedFiles?.columns).toEqual(
      expect.arrayContaining(['ownership', 'current_hash', 'user_modified_at', 'conflict_state']),
    );
  });

  it('names a real migration file for every table', () => {
    for (const spec of REQUIRED_BUILDERS_DB_SCHEMA) {
      expect(spec.migration).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
      expect(spec.columns.length).toBeGreaterThan(0);
    }
  });

  it('guards the Sprint 97 column that Postgres reserves', () => {
    const executions = REQUIRED_BUILDERS_DB_SCHEMA.find((spec) => spec.table === 'builders_incremental_executions');

    expect(executions?.columns).toContain('active_role');
    expect(executions?.columns).not.toContain('current_role');
  });
});

describe('verifyBuildersDbSchema', () => {
  it('passes when every required column exists', async () => {
    const { client } = makeClient();
    const result = await verifyBuildersDbSchema({ client, clock: CLOCK });

    expect(result).toMatchObject({ ok: true, skipped: false, findings: [], message: '' });
  });

  it('uses one request per table when the schema is correct', async () => {
    const { client, calls } = makeClient();
    await verifyBuildersDbSchema({ client, clock: CLOCK });

    expect(calls).toHaveLength(REQUIRED_BUILDERS_DB_SCHEMA.length);
  });

  it('detects the exact BUG-008 drift and names the migration', async () => {
    const { client } = makeClient({ missing: ['builders_application_manifest_files.feature_ids'] });
    const result = await verifyBuildersDbSchema({ client, clock: CLOCK });

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      table: 'builders_application_manifest_files',
      missingColumns: ['feature_ids'],
      tableMissing: false,
      migration: '20260726100000_file_ownership_and_feature_traceability.sql',
    });
    expect(result.message).toContain('feature_ids');
    expect(result.message).toContain('20260726100000_file_ownership_and_feature_traceability.sql');
    expect(result.message).toContain('supabase db push');
  });

  it('reports every missing column, not just the first', async () => {
    const { client } = makeClient({
      missing: [
        'builders_generated_application_files.ownership',
        'builders_generated_application_files.current_hash',
        'builders_generated_application_files.conflict_state',
      ],
    });
    const result = await verifyBuildersDbSchema({ client, clock: CLOCK });

    expect(result.findings[0].missingColumns).toEqual(['ownership', 'current_hash', 'conflict_state']);
  });

  it('reports a missing table distinctly from missing columns', async () => {
    const { client } = makeClient({ missingTables: ['builders_incremental_role_runs'] });
    const result = await verifyBuildersDbSchema({ client, clock: CLOCK });

    const finding = result.findings.find((entry) => entry.table === 'builders_incremental_role_runs');

    expect(finding?.tableMissing).toBe(true);
    expect(result.message).toContain('missing entirely');
  });

  it('does NOT report drift for an unrelated failure', async () => {
    // An RLS denial or network error must not be misreported as schema drift.
    const { client } = makeClient({ failWith: { code: '42501', message: 'permission denied' } });
    const result = await verifyBuildersDbSchema({ client, clock: CLOCK });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('skips cleanly when BuildersDB is not configured', async () => {
    const result = await verifyBuildersDbSchema({ client: null, clock: CLOCK });

    expect(result).toMatchObject({ ok: true, skipped: true, findings: [] });
  });

  it('never throws when the probe itself explodes', async () => {
    const exploding = {
      from() {
        throw new Error('network down');
      },
    } as never;

    const result = await verifyBuildersDbSchema({ client: exploding, clock: CLOCK });

    expect(result).toMatchObject({ ok: true, skipped: true });
  });

  it('memoises a successful verification', async () => {
    const { client, calls } = makeClient();

    await verifyBuildersDbSchema({ client, clock: CLOCK });

    const before = calls.length;
    await verifyBuildersDbSchema({ client, clock: CLOCK });

    expect(calls.length).toBe(before);
  });

  it('never memoises a failure — drift is re-checked until fixed', async () => {
    const { client, calls } = makeClient({ missing: ['builders_application_manifest_files.feature_ids'] });

    await verifyBuildersDbSchema({ client, clock: CLOCK });

    const before = calls.length;
    const second = await verifyBuildersDbSchema({ client, clock: CLOCK });

    expect(calls.length).toBeGreaterThan(before);
    expect(second.ok).toBe(false);
  });

  it('re-probes on force, so an operator can re-check after applying a migration', async () => {
    const { client, calls } = makeClient();

    await verifyBuildersDbSchema({ client, clock: CLOCK });

    const before = calls.length;
    await verifyBuildersDbSchema({ client, clock: CLOCK, force: true });

    expect(calls.length).toBeGreaterThan(before);
  });
});

describe('describeSchemaDrift', () => {
  it('is empty when there is no drift', () => {
    expect(describeSchemaDrift([])).toBe('');
  });

  it('de-duplicates migrations across several tables', () => {
    const message = describeSchemaDrift([
      {
        table: 'a',
        missingColumns: ['x'],
        tableMissing: false,
        migration: '20260726100000_file_ownership_and_feature_traceability.sql',
      },
      {
        table: 'b',
        missingColumns: ['y'],
        tableMissing: false,
        migration: '20260726100000_file_ownership_and_feature_traceability.sql',
      },
    ]);

    /* Both tables cite the migration in their own detail, but the "apply these" list names it once. */
    const applyList = message.slice(message.indexOf('Apply the outstanding migration'));

    expect(applyList.match(/20260726100000/g)).toHaveLength(1);
    expect(message).toContain('Generation is blocked');
  });
});
