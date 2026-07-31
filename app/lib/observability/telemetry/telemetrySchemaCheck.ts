/**
 * Builders Observability — telemetry startup health check.
 *
 * Validates that the AI usage ledger actually exists in the database before anyone relies on it.
 * This is the check that would have caught the ledger being absent for weeks: the migration
 * declaring it was appended to an already-applied file, so Supabase never ran it, and every write
 * failed silently by design.
 *
 * Runs read-only `select … limit 0` probes. It never inserts, never calls the write RPC, and never
 * throws — a failure here downgrades a badge, nothing more.
 */

import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import { recordSchemaReport, type SchemaObjectState, type TelemetrySchemaReport } from './telemetryStatus';

/** PostgREST's code for "relation does not exist in the schema cache". */
const UNDEFINED_TABLE = 'PGRST205';

const LEDGER_TABLE = 'builders_ai_usage_events';
const DAILY_VIEW = 'builders_ai_usage_daily';
const WRITE_RPC = 'builders_record_ai_usage()';

interface ProbeClient {
  from: (table: string) => {
    select: (columns: string) => { limit: (count: number) => Promise<{ error: { code?: string } | null }> };
  };
}

/**
 * `select('*').limit(0)` — verified against this database, including a deliberately non-existent
 * control relation:
 *
 *   missing relation -> 404 PGRST205
 *   present relation -> 200, no error
 *
 * Two forms that look equivalent are NOT usable here, and both were tried:
 *  - `{ head: true, count: 'exact' }` returns **204 with no error for a table that does not
 *    exist**, so it reports every missing relation as present — silently defeating the entire
 *    check. This is the exact class of false-negative this module exists to prevent.
 *  - Selecting a named column (`select('id')`) fails with 42703 on a view whose shape differs,
 *    conflating "wrong columns" with "missing relation".
 *
 * `limit(0)` transfers no rows. RLS still applies but only ever hides ROWS, never the relation, so
 * a restricted user still gets a clean 200 — this stays a schema check, not a permission check.
 */
async function probeRelation(client: ProbeClient, relation: string): Promise<SchemaObjectState> {
  try {
    const { error } = await client.from(relation).select('*').limit(0);

    if (!error) {
      return 'present';
    }

    return error.code === UNDEFINED_TABLE ? 'missing' : 'unverifiable';
  } catch {
    /* Network/transport problem — genuinely unknown, not evidence of absence. */
    return 'unverifiable';
  }
}

/**
 * Runs the check and publishes the result to `telemetryStatusStore`.
 *
 * The RPC is intentionally NOT probed by calling it: PostgREST reports a missing function and a
 * signature mismatch with the same PGRST202 code, its OpenAPI listing requires a service-role key
 * that must never reach the browser, and invoking it for real would write a ledger row. Instead it
 * is inferred from the table — both come from the same migration — and reported `unverifiable`
 * when the table is present, so the UI never claims more certainty than it has.
 */
export async function checkTelemetrySchema(): Promise<TelemetrySchemaReport> {
  const checkedAt = new Date().toISOString();

  if (!isBuildersDbConfigured()) {
    const report: TelemetrySchemaReport = {
      table: 'unverifiable',
      dailyView: 'unverifiable',
      rpc: 'unverifiable',
      missing: [],
      checkedAt,
    };
    recordSchemaReport(report);

    return report;
  }

  const client = getBuildersDbClient() as unknown as ProbeClient | null;

  if (!client) {
    const report: TelemetrySchemaReport = {
      table: 'unverifiable',
      dailyView: 'unverifiable',
      rpc: 'unverifiable',
      missing: [],
      checkedAt,
    };
    recordSchemaReport(report);

    return report;
  }

  const [table, dailyView] = await Promise.all([
    probeRelation(client, LEDGER_TABLE),
    probeRelation(client, DAILY_VIEW),
  ]);

  const rpc: SchemaObjectState = table === 'missing' ? 'missing' : 'unverifiable';

  const missing: string[] = [];

  if (table === 'missing') {
    missing.push(LEDGER_TABLE, WRITE_RPC);
  }

  if (dailyView === 'missing') {
    missing.push(DAILY_VIEW);
  }

  const report: TelemetrySchemaReport = { table, dailyView, rpc, missing, checkedAt };
  recordSchemaReport(report);

  return report;
}
