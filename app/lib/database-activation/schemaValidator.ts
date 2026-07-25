import type { SchemaTable, StructuredDatabaseSchema } from './schemaTypes';

/**
 * Schema Validation — Sprint 75 (Real Backend Activation, Phase 1).
 *
 * Pure, deterministic validation of a `StructuredDatabaseSchema` before any
 * SQL is generated or provisioning is attempted. Never mutates the schema,
 * never touches a network or database. `databaseActivationService.ts` is
 * responsible for blocking provisioning whenever `passed === false`.
 */

export type ValidationIssueCode =
  | 'duplicate-table'
  | 'duplicate-column'
  | 'invalid-foreign-key'
  | 'reserved-keyword'
  | 'invalid-type'
  | 'circular-reference'
  | 'missing-primary-key'
  | 'invalid-primary-key-column'
  | 'no-tables';

export interface ValidationIssue {
  code: ValidationIssueCode;
  message: string;
  table?: string;
  column?: string;
}

export interface ValidationReport {
  passed: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Common ANSI SQL / PostgreSQL reserved words worth flagging as unquoted
 * identifiers — not exhaustive, but covers the collisions most likely to
 * show up in an AI-generated schema (e.g. a "user" or "order" table).
 * sqlGenerator.ts always double-quotes identifiers so these would still run,
 * but flagging them here surfaces the surprise before provisioning rather
 * than after.
 */
const RESERVED_KEYWORDS = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'from',
  'where',
  'table',
  'column',
  'index',
  'primary',
  'foreign',
  'key',
  'references',
  'constraint',
  'unique',
  'user',
  'order',
  'group',
  'limit',
  'offset',
  'default',
  'check',
  'null',
  'grant',
  'role',
  'schema',
  'transaction',
  'window',
]);

const VALID_COLUMN_TYPES = new Set([
  'uuid',
  'text',
  'varchar',
  'integer',
  'bigint',
  'boolean',
  'timestamp',
  'date',
  'numeric',
  'jsonb',
  'enum',
]);

function checkDuplicateTables(tables: SchemaTable[], errors: ValidationIssue[]) {
  const seen = new Set<string>();

  for (const table of tables) {
    const key = table.name.toLowerCase();

    if (seen.has(key)) {
      errors.push({
        code: 'duplicate-table',
        message: `Table "${table.name}" is defined more than once.`,
        table: table.name,
      });
    }

    seen.add(key);
  }
}

function checkTable(
  table: SchemaTable,
  allTableNames: Set<string>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
) {
  const seenColumns = new Set<string>();

  for (const column of table.columns) {
    const key = column.name.toLowerCase();

    if (seenColumns.has(key)) {
      errors.push({
        code: 'duplicate-column',
        message: `Column "${column.name}" is defined more than once on table "${table.name}".`,
        table: table.name,
        column: column.name,
      });
    }

    seenColumns.add(key);

    if (!VALID_COLUMN_TYPES.has(column.type)) {
      errors.push({
        code: 'invalid-type',
        message: `Column "${table.name}.${column.name}" has unsupported type "${column.type}".`,
        table: table.name,
        column: column.name,
      });
    }

    if (RESERVED_KEYWORDS.has(key)) {
      warnings.push({
        code: 'reserved-keyword',
        message: `Column "${table.name}.${column.name}" is a reserved SQL keyword — it will still work quoted, but consider renaming it.`,
        table: table.name,
        column: column.name,
      });
    }
  }

  if (RESERVED_KEYWORDS.has(table.name.toLowerCase())) {
    warnings.push({
      code: 'reserved-keyword',
      message: `Table "${table.name}" is a reserved SQL keyword — it will still work quoted, but consider renaming it.`,
      table: table.name,
    });
  }

  if (table.primaryKey.length === 0) {
    errors.push({
      code: 'missing-primary-key',
      message: `Table "${table.name}" has no primary key.`,
      table: table.name,
    });
  } else {
    for (const pkColumn of table.primaryKey) {
      if (!table.columns.some((column) => column.name === pkColumn)) {
        errors.push({
          code: 'invalid-primary-key-column',
          message: `Table "${table.name}"'s primary key references undefined column "${pkColumn}".`,
          table: table.name,
          column: pkColumn,
        });
      }
    }
  }

  for (const fk of table.foreignKeys ?? []) {
    if (!table.columns.some((column) => column.name === fk.column)) {
      errors.push({
        code: 'invalid-foreign-key',
        message: `Table "${table.name}"'s foreign key references undefined local column "${fk.column}".`,
        table: table.name,
        column: fk.column,
      });
      continue;
    }

    if (!allTableNames.has(fk.referencesTable)) {
      errors.push({
        code: 'invalid-foreign-key',
        message: `Table "${table.name}"'s foreign key on "${fk.column}" references unknown table "${fk.referencesTable}".`,
        table: table.name,
        column: fk.column,
      });
    }
  }
}

/** DFS cycle detection over the FK graph (table -> referencesTable edges). One issue per distinct cycle found. */
function checkCircularReferences(tables: SchemaTable[], errors: ValidationIssue[]) {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const state = new Map<string, 'visiting' | 'done'>();
  const reportedCycles = new Set<string>();

  function visit(table: SchemaTable, path: string[]) {
    const status = state.get(table.name);

    if (status === 'done') {
      return;
    }

    if (status === 'visiting') {
      const cycleStart = path.indexOf(table.name);
      const cycle = [...path.slice(cycleStart), table.name];
      const cycleKey = [...cycle].sort().join('>');

      if (!reportedCycles.has(cycleKey)) {
        reportedCycles.add(cycleKey);
        errors.push({
          code: 'circular-reference',
          message: `Circular foreign key reference detected: ${cycle.join(' -> ')}.`,
          table: table.name,
        });
      }

      return;
    }

    state.set(table.name, 'visiting');

    for (const fk of table.foreignKeys ?? []) {
      const referenced = byName.get(fk.referencesTable);

      if (referenced && referenced.name !== table.name) {
        visit(referenced, [...path, table.name]);
      }
    }

    state.set(table.name, 'done');
  }

  for (const table of tables) {
    if (!state.has(table.name)) {
      visit(table, []);
    }
  }
}

export function validateStructuredSchema(schema: StructuredDatabaseSchema): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (schema.tables.length === 0) {
    errors.push({
      code: 'no-tables',
      message: 'The structured schema has no tables — generate the Database Schema first.',
    });
    return { passed: false, errors, warnings };
  }

  checkDuplicateTables(schema.tables, errors);

  const allTableNames = new Set(schema.tables.map((table) => table.name));

  for (const table of schema.tables) {
    checkTable(table, allTableNames, errors, warnings);
  }

  checkCircularReferences(schema.tables, errors);

  return { passed: errors.length === 0, errors, warnings };
}

function renderIssueLine(issue: ValidationIssue): string {
  const location = issue.column ? `${issue.table}.${issue.column}` : issue.table;
  return `- **${issue.code}**${location ? ` (\`${location}\`)` : ''}: ${issue.message}`;
}

/** Renders a `ValidationReport` as the `Database/validation-report.md` Product Package file. */
export function renderValidationReportMarkdown(report: ValidationReport): string {
  const lines = [
    '# Database Schema Validation Report',
    '',
    report.passed
      ? '**Status: PASSED** — safe to provision.'
      : '**Status: FAILED** — resolve all errors before provisioning.',
    '',
    `## Errors (${report.errors.length})`,
    '',
    ...(report.errors.length > 0 ? report.errors.map(renderIssueLine) : ['None.']),
    '',
    `## Warnings (${report.warnings.length})`,
    '',
    ...(report.warnings.length > 0 ? report.warnings.map(renderIssueLine) : ['None.']),
  ];

  return lines.join('\n');
}
