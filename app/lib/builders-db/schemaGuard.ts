import { getBuildersDbClient } from './client';

/**
 * BuildersDB Schema Guard — Sprint 98A, BUG-008.
 *
 * WHY THIS EXISTS. Acceptance Test Round 1 discovered that migration
 * `20260726100000_file_ownership_and_feature_traceability.sql` had never been applied to
 * BuildersDB. Nothing detected it. The application looked healthy, the unit suite passed (2,480
 * tests), and a full structural audit of Sprint 97 passed — while every single application
 * manifest file insert was being rejected by Postgres with `42703 undefined_column`. Code
 * generation ran for over four minutes writing nothing.
 *
 * That is the failure this module makes impossible. It is not a migration runner and it does not
 * repair anything: it asks the database which columns it actually has, compares that against the
 * columns this build's code writes, and reports the difference. The callers decide what to do.
 *
 * WHY COLUMN PROBES AND NOT `information_schema`. PostgREST does not expose `information_schema`
 * to the anon/authenticated roles, so a catalog query is not available from the client. Selecting
 * a column with `limit(0)` is: PostgREST resolves the column list before it fetches any row, so a
 * missing column fails fast with `42703` and transfers no data. This is the same technique the
 * acceptance test used to locate the drift, promoted into the product.
 *
 * COST. One request per table in the happy path (all required columns in a single `select`), and
 * the result is memoised for the process lifetime — a verified schema cannot un-verify itself
 * while the app is running, because migrations are not applied from inside the app.
 */

/** Postgres `undefined_column`. The single error code that means "this build expects a column the database does not have". */
const UNDEFINED_COLUMN = '42703';

/** Postgres `undefined_table`, surfaced by PostgREST as PGRST205 when the table is absent from the schema cache. */
const UNDEFINED_TABLE_CODES = ['42P01', 'PGRST205'];

export interface RequiredTableSchema {
  table: string;

  /** Columns this build WRITES or filters on. Read-only convenience columns are deliberately omitted — this guard protects write paths. */
  columns: string[];

  /** The migration that introduces these columns, quoted verbatim in the failure message so an operator knows exactly what to apply. */
  migration: string;
}

/**
 * The columns Builders' critical write paths depend on.
 *
 * DELIBERATELY NOT EXHAUSTIVE. This is not a schema snapshot — a full mirror of every table would
 * be a second source of truth that drifts from the migrations on its own. It covers the paths
 * whose failure is silent and expensive: manifest persistence (which BUG-008 broke outright),
 * generated-file persistence, role outputs, and the Sprint 95-97 evolution chain that has never
 * run against real data.
 *
 * ADDING TO THIS LIST is the correct response to any future drift incident.
 */
export const REQUIRED_BUILDERS_DB_SCHEMA: RequiredTableSchema[] = [
  {
    table: 'builders_application_manifests',
    columns: [
      'id',
      'project_id',
      'version',
      'status',
      'framework',
      'entry_file',
      'total_files',
      'completed_files',
      'failed_files',
      'plan_checksum',
      'source_content_checksum',
      'metadata',
    ],
    migration: '20260718120000_application_manifest_foundation.sql',
  },
  {
    table: 'builders_application_manifest_files',
    columns: [
      'id',
      'manifest_id',
      'project_id',
      'path',
      'file_type',
      'category',
      'component_name',
      'display_name',
      'generation_order',
      'dependencies',
      'required',
      'source_kind',
      'status',

      /* BUG-008: the column whose absence silently disabled all manifest persistence. */
      'feature_ids',
    ],
    migration: '20260726100000_file_ownership_and_feature_traceability.sql',
  },
  {
    table: 'builders_generated_application_files',
    columns: [
      'id',
      'project_id',
      'path',

      /* BUG-008: the four ownership/traceability columns from the same unapplied migration. */
      'ownership',
      'current_hash',
      'user_modified_at',
      'conflict_state',
    ],
    migration: '20260726100000_file_ownership_and_feature_traceability.sql',
  },
  {
    table: 'builders_role_outputs',
    columns: ['id', 'project_id', 'role_key', 'version', 'status', 'mvp_id'],
    migration: '20260720100000_mvp_foundation.sql',
  },
  {
    table: 'builders_incremental_executions',
    columns: [
      'id',
      'engineering_plan_id',
      'change_request_id',
      'project_id',
      'status',
      'execution_version',
      'recommended_roles',
      'selected_roles',

      /* Sprint 97: renamed from `current_role`, which Postgres reserves. */
      'active_role',
      'scope_fingerprint',
    ],
    migration: '20260810100000_incremental_execution.sql',
  },
  {
    table: 'builders_incremental_role_runs',
    columns: ['id', 'execution_id', 'project_id', 'role', 'attempt', 'status', 'context', 'output'],
    migration: '20260810100000_incremental_execution.sql',
  },
];

export interface SchemaDriftFinding {
  table: string;
  missingColumns: string[];
  tableMissing: boolean;
  migration: string;
}

export interface SchemaVerificationResult {
  /** True only when every required column was confirmed present. */
  ok: boolean;

  /** True when BuildersDB is not configured at all — NOT a drift failure; the app runs local-only. */
  skipped: boolean;
  findings: SchemaDriftFinding[];

  /** A single operator-facing sentence, empty when `ok`. */
  message: string;
  checkedAt: string;
}

function isUndefinedColumn(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNDEFINED_COLUMN;
}

function isUndefinedTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' && UNDEFINED_TABLE_CODES.includes(code);
}

type ProbeClient = {
  from: (table: string) => {
    select: (columns: string) => { limit: (n: number) => Promise<{ error: unknown }> };
  };
};

/** One `select` of every required column. Cheap when the schema is correct, which is the normal case. */
async function probeTable(client: ProbeClient, spec: RequiredTableSchema): Promise<SchemaDriftFinding | null> {
  const { error } = await client.from(spec.table).select(spec.columns.join(',')).limit(0);

  if (!error) {
    return null;
  }

  if (isUndefinedTable(error)) {
    return { table: spec.table, missingColumns: spec.columns, tableMissing: true, migration: spec.migration };
  }

  if (!isUndefinedColumn(error)) {
    /*
     * Something else went wrong (RLS, network, auth). NOT reported as drift: claiming a schema
     * problem because a request failed for an unrelated reason would send operators to the wrong
     * fix, which is exactly the class of misdirection this sprint is removing.
     */
    return null;
  }

  /* Narrow to the exact missing columns only when the combined probe already proved drift exists. */
  const missingColumns: string[] = [];

  for (const column of spec.columns) {
    const { error: columnError } = await client.from(spec.table).select(column).limit(0);

    if (columnError && isUndefinedColumn(columnError)) {
      missingColumns.push(column);
    }
  }

  return {
    table: spec.table,
    missingColumns: missingColumns.length > 0 ? missingColumns : spec.columns,
    tableMissing: false,
    migration: spec.migration,
  };
}

export function describeSchemaDrift(findings: SchemaDriftFinding[]): string {
  if (findings.length === 0) {
    return '';
  }

  const details = findings
    .map((finding) =>
      finding.tableMissing
        ? `table "${finding.table}" is missing entirely (migration ${finding.migration})`
        : `"${finding.table}" is missing ${finding.missingColumns.map((column) => `\`${column}\``).join(', ')} (migration ${finding.migration})`,
    )
    .join('; ');

  const migrations = [...new Set(findings.map((finding) => finding.migration))];

  return `BuildersDB schema is out of date: ${details}. Apply the outstanding migration(s) — ${migrations.join(', ')} — with \`supabase db push\`, then reload. Generation is blocked until the schema matches this build.`;
}

let memoisedResult: SchemaVerificationResult | null = null;

export interface VerifySchemaOptions {
  /** Injected for tests; defaults to the real BuildersDB client. */
  client?: ProbeClient | null;

  /** Re-probe even when a previous verification succeeded. Used by the "re-check" affordance after an operator applies a migration. */
  force?: boolean;
  clock?: () => string;
}

/**
 * Verifies the live BuildersDB schema against what this build writes.
 *
 * NEVER THROWS. A guard that can crash the app is worse than the drift it detects — callers get a
 * result object and decide. `skipped: true` when BuildersDB is unconfigured, which is a supported
 * local-only mode, not a failure.
 */
export async function verifyBuildersDbSchema(options: VerifySchemaOptions = {}): Promise<SchemaVerificationResult> {
  const clock = options.clock ?? (() => new Date().toISOString());

  if (memoisedResult?.ok && !options.force) {
    return memoisedResult;
  }

  const client =
    (options.client === undefined ? (getBuildersDbClient() as ProbeClient | null) : options.client) ?? null;

  if (!client) {
    return { ok: true, skipped: true, findings: [], message: '', checkedAt: clock() };
  }

  const findings: SchemaDriftFinding[] = [];

  try {
    for (const spec of REQUIRED_BUILDERS_DB_SCHEMA) {
      const finding = await probeTable(client, spec);

      if (finding) {
        findings.push(finding);
      }
    }
  } catch (error) {
    /* Probing itself failed (offline, misconfigured). Not drift — do not block on it. */
    console.warn('[SchemaGuard] verification could not complete:', error);
    return { ok: true, skipped: true, findings: [], message: '', checkedAt: clock() };
  }

  const result: SchemaVerificationResult = {
    ok: findings.length === 0,
    skipped: false,
    findings,
    message: describeSchemaDrift(findings),
    checkedAt: clock(),
  };

  if (result.ok) {
    memoisedResult = result;
  } else {
    memoisedResult = null;
    console.error(`[SchemaGuard] ${result.message}`);
  }

  return result;
}

/** Test seam — clears the memoised success so a later probe runs again. */
export function resetSchemaGuardCache(): void {
  memoisedResult = null;
}
