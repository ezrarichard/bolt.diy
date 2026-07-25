import type { StructuredDatabaseSchema } from '~/lib/database-activation/schemaTypes';
import type {
  ConnectionResult,
  DatabaseProvisioner,
  ProvisioningResult,
  SqlExecutionReport,
} from './databaseProvisioner';
import { getSupabaseProvisioningToken } from './supabaseSessionCredentials';
import { withRetry } from './retry';
import { BUILDERS_DB_PROJECT_REFUSAL_MESSAGE, isBuildersDbProjectId } from './buildersDbProjectGuard';

/**
 * Supabase Provisioner — Sprint 76 (Real Database Provisioning, Phase 2).
 *
 * The first real (non-mock) `DatabaseProvisioner` implementation. Implements Option C from
 * docs/backend-activation/Provisioning-Architecture.md: connects to a customer's OWN, already-
 * selected Supabase project — never Builders' own `BUILDERS_DB_SUPABASE_URL` project. This is
 * enforced twice: `databaseActivationService.connectSupabaseProject` refuses to even persist a
 * connection to BuildersDB's project id, and `isBuildersDbProjectId` is checked again here, at the
 * start of both `provision()` and `verifyConnection()`, as defense-in-depth against any other path
 * that could construct a `SupabaseProvisioner` with that id.
 *
 * Reuses the existing SQL-execution primitive (`app/routes/api.supabase.query.ts`, unchanged) and
 * the session-scoped credential holder (`supabaseSessionCredentials.ts`) rather than opening a
 * direct Postgres/`@supabase/supabase-js` connection or inventing a new one — see the architecture
 * doc §3/§4. The Management personal access token is read fresh from the session holder on every
 * call and is NEVER embedded in a thrown error, a result `message`, or logged — see
 * `sanitizeMessage` below, applied to every string that could plausibly contain it.
 */

const NOT_CONNECTED_MESSAGE =
  'Not connected to a Supabase project — connect and select a project in the Database card first.';

class SupabaseQueryError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SupabaseQueryError';
    this.status = status;
  }
}

/** Redacts any accidental occurrence of the raw token from a string before it can reach a result, an error, or a log line — defense in depth on top of the fact that no code here deliberately embeds it. */
function sanitizeMessage(message: string, token: string | undefined): string {
  if (!token) {
    return message;
  }

  return message.split(token).join('[REDACTED]');
}

/** A failure is worth retrying only when it looks transient (network failure, or a 5xx from Supabase) — a SQL/auth/permission error (4xx) retrying the exact same request will not fix. */
function isRetryableError(error: unknown): boolean {
  if (error instanceof SupabaseQueryError) {
    return error.status === undefined || error.status >= 500;
  }

  return true;
}

async function executeSupabaseQuery(projectId: string, query: string, token: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch('/api/supabase/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectId, query }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error contacting Supabase.';
    throw new SupabaseQueryError(sanitizeMessage(message, token));
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: { status?: number; statusText?: string; message?: string };
  };

  if (!response.ok || body.error) {
    const detail = body.error?.message ?? response.statusText ?? 'Supabase query failed.';
    throw new SupabaseQueryError(
      sanitizeMessage(`Supabase error: ${detail}`, token),
      body.error?.status ?? response.status,
    );
  }

  return body;
}

/** Every CREATE-* statement sqlGenerator.ts emits for this schema — used to compute the execution report's `totalStatements` deterministically from the schema itself, since the SQL text is executed as one atomic request and doesn't report per-statement results. */
function countGeneratedStatements(schema: StructuredDatabaseSchema): number {
  const enumStatements = schema.enums?.length ?? 0;
  const tableStatements = schema.tables.length;
  const indexStatements = schema.tables.reduce((sum, table) => sum + (table.indexes?.length ?? 0), 0);

  return enumStatements + tableStatements + indexStatements;
}

export interface SupabaseProvisionerConfig {
  projectId: string;
}

export function createSupabaseProvisioner(config: SupabaseProvisionerConfig): DatabaseProvisioner {
  const { projectId } = config;

  return {
    providerId: 'supabase',

    async provision(schema: StructuredDatabaseSchema, sql: string): Promise<ProvisioningResult> {
      const provisionedAt = new Date().toISOString();

      if (isBuildersDbProjectId(projectId)) {
        return { ok: false, provider: 'supabase', message: BUILDERS_DB_PROJECT_REFUSAL_MESSAGE, provisionedAt };
      }

      const token = getSupabaseProvisioningToken();

      if (!token) {
        return { ok: false, provider: 'supabase', message: NOT_CONNECTED_MESSAGE, provisionedAt };
      }

      const totalStatements = countGeneratedStatements(schema);
      const startedAt = Date.now();

      const result = await withRetry(() => executeSupabaseQuery(projectId, sql, token), {
        maxAttempts: 3,
        isRetryable: isRetryableError,
      });

      const durationMs = Date.now() - startedAt;

      if (result.ok) {
        const executionReport: SqlExecutionReport = {
          totalStatements,
          succeededStatements: totalStatements,
          durationMs,
          attempts: result.attempts,
          rolledBack: false,
        };

        return {
          ok: true,
          provider: 'supabase',
          message: `Provisioned ${schema.tables.length} table(s) to Supabase project ${projectId}.`,
          provisionedAt,
          executionReport,
        };
      }

      const errorMessage =
        result.error instanceof Error ? result.error.message : 'Provisioning failed for an unknown reason.';

      /*
       * Sprint 75's SQL generator wraps the whole migration in BEGIN/COMMIT (sqlGenerator.ts) — a failure anywhere
       * aborts the transaction, so nothing this request touched was actually committed.
       */
      const executionReport: SqlExecutionReport = {
        totalStatements,
        succeededStatements: 0,
        errorMessage: sanitizeMessage(errorMessage, token),
        durationMs,
        attempts: result.attempts,
        rolledBack: true,
      };

      return {
        ok: false,
        provider: 'supabase',
        message: sanitizeMessage(errorMessage, token),
        provisionedAt,
        executionReport,
      };
    },

    async verifyConnection(schema?: StructuredDatabaseSchema): Promise<ConnectionResult> {
      const verifiedAt = new Date().toISOString();

      if (isBuildersDbProjectId(projectId)) {
        return { ok: false, provider: 'supabase', message: BUILDERS_DB_PROJECT_REFUSAL_MESSAGE, verifiedAt };
      }

      const token = getSupabaseProvisioningToken();

      if (!token) {
        return { ok: false, provider: 'supabase', message: NOT_CONNECTED_MESSAGE, verifiedAt };
      }

      const pingResult = await withRetry(() => executeSupabaseQuery(projectId, 'select 1;', token), {
        maxAttempts: 3,
        isRetryable: isRetryableError,
      });

      if (!pingResult.ok) {
        const message = pingResult.error instanceof Error ? pingResult.error.message : 'Connection check failed.';
        return { ok: false, provider: 'supabase', message: sanitizeMessage(message, token), verifiedAt };
      }

      if (!schema || schema.tables.length === 0) {
        return {
          ok: true,
          provider: 'supabase',
          message: 'Connection verified — authentication, connectivity, and SQL execution all succeeded.',
          verifiedAt,
        };
      }

      const expectedTables = schema.tables.map((table) => table.name);
      const tableList = expectedTables.map((name) => `'${name.replace(/'/g, "''")}'`).join(', ');
      const existenceQuery = `select table_name from information_schema.tables where table_schema = 'public' and table_name in (${tableList});`;

      const existenceResult = await withRetry(() => executeSupabaseQuery(projectId, existenceQuery, token), {
        maxAttempts: 3,
        isRetryable: isRetryableError,
      });

      if (!existenceResult.ok) {
        const message =
          existenceResult.error instanceof Error ? existenceResult.error.message : 'Schema verification failed.';
        return { ok: false, provider: 'supabase', message: sanitizeMessage(message, token), verifiedAt };
      }

      const rows = Array.isArray(existenceResult.value) ? (existenceResult.value as { table_name: string }[]) : [];
      const foundTables = rows.map((row) => row.table_name);
      const missingTables = expectedTables.filter((name) => !foundTables.includes(name));

      return {
        ok: missingTables.length === 0,
        provider: 'supabase',
        message:
          missingTables.length === 0
            ? `Connection verified — all ${expectedTables.length} table(s) found.`
            : `Connection verified, but ${missingTables.length} of ${expectedTables.length} expected table(s) are missing: ${missingTables.join(', ')}.`,
        verifiedAt,
        schemaVerification: { expectedTables, foundTables, missingTables },
      };
    },
  };
}
