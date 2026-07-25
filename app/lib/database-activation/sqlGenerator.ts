import type { SchemaColumn, SchemaTable, StructuredDatabaseSchema } from './schemaTypes';

/**
 * Deterministic SQL Generator — Sprint 75 (Real Backend Activation, Phase 1).
 *
 * Pure function: `generateSchemaSql(schema)` always produces byte-identical
 * output for the same `StructuredDatabaseSchema` input — no timestamps, no
 * randomness, no I/O. No ORM output, no runtime database access; this file
 * never connects to anything. Callers (databaseActivationService.ts) are
 * responsible for validating the schema first (schemaValidator.ts) — this
 * generator does not re-validate, it only renders whatever it's given.
 */

const SQL_TYPE_MAP: Record<SchemaColumn['type'], (column: SchemaColumn) => string> = {
  uuid: () => 'uuid',
  text: () => 'text',
  varchar: (column) => `varchar(${column.length ?? 255})`,
  integer: () => 'integer',
  bigint: () => 'bigint',
  boolean: () => 'boolean',
  timestamp: () => 'timestamptz',
  date: () => 'date',
  numeric: () => 'numeric',
  jsonb: () => 'jsonb',
  enum: (column) => column.enumName ?? 'text',
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function renderColumnDefinition(column: SchemaColumn): string {
  const parts = [quoteIdent(column.name), SQL_TYPE_MAP[column.type](column)];

  if (!column.nullable) {
    parts.push('NOT NULL');
  }

  if (column.unique) {
    parts.push('UNIQUE');
  }

  if (column.default !== undefined) {
    parts.push(`DEFAULT ${column.default}`);
  }

  return parts.join(' ');
}

const TIMESTAMP_COLUMNS = [
  '  "created_at" timestamptz NOT NULL DEFAULT now()',
  '  "updated_at" timestamptz NOT NULL DEFAULT now()',
];

function renderEnumStatement(name: string, values: string[]): string {
  const literals = values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
  return `CREATE TYPE ${quoteIdent(name)} AS ENUM (${literals});`;
}

function renderCreateTableStatement(table: SchemaTable): string {
  const lines: string[] = table.columns.map((column) => `  ${renderColumnDefinition(column)}`);

  if (table.timestamps) {
    lines.push(...TIMESTAMP_COLUMNS);
  }

  if (table.primaryKey.length > 0) {
    lines.push(`  PRIMARY KEY (${table.primaryKey.map(quoteIdent).join(', ')})`);
  }

  for (const fk of table.foreignKeys ?? []) {
    const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete.toUpperCase()}` : '';
    lines.push(
      `  FOREIGN KEY (${quoteIdent(fk.column)}) REFERENCES ${quoteIdent(fk.referencesTable)} (${quoteIdent(fk.referencesColumn)})${onDelete}`,
    );
  }

  return `CREATE TABLE ${quoteIdent(table.name)} (\n${lines.join(',\n')}\n);`;
}

function renderIndexStatements(table: SchemaTable): string[] {
  return (table.indexes ?? []).map((index) => {
    const unique = index.unique ? 'UNIQUE ' : '';
    return `CREATE ${unique}INDEX ${quoteIdent(index.name)} ON ${quoteIdent(table.name)} (${index.columns.map(quoteIdent).join(', ')});`;
  });
}

/**
 * Orders tables so a referenced table's CREATE TABLE always precedes the
 * table(s) that FOREIGN KEY into it — required for the generated SQL to run
 * top-to-bottom without error. Falls back to the declared order for any
 * table involved in a cycle (schemaValidator.ts is responsible for flagging
 * circular references before this ever runs) rather than throwing.
 */
function topologicalOrder(tables: SchemaTable[]): SchemaTable[] {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: SchemaTable[] = [];

  function visit(table: SchemaTable) {
    if (visited.has(table.name) || visiting.has(table.name)) {
      return;
    }

    visiting.add(table.name);

    for (const fk of table.foreignKeys ?? []) {
      const referenced = byName.get(fk.referencesTable);

      if (referenced && referenced.name !== table.name) {
        visit(referenced);
      }
    }

    visiting.delete(table.name);
    visited.add(table.name);
    ordered.push(table);
  }

  for (const table of tables) {
    visit(table);
  }

  return ordered;
}

export interface GeneratedSchemaSql {
  schemaSql: string;
  migrationSql: string;
}

/**
 * Renders the full, deterministic DDL for a structured schema: enum types
 * first, then tables in FK-dependency order, then indexes. `schemaSql` is
 * the plain current-state DDL (for `Database/schema.sql` in the Product
 * Package); `migrationSql` wraps the same statements as
 * "Migration 0001 — Initial Schema" inside a transaction (Phase 1 only ever
 * produces one migration — there is no diffing engine yet).
 */
export function generateSchemaSql(schema: StructuredDatabaseSchema): GeneratedSchemaSql {
  const statements: string[] = [];

  for (const schemaEnum of schema.enums ?? []) {
    statements.push(renderEnumStatement(schemaEnum.name, schemaEnum.values));
  }

  const orderedTables = topologicalOrder(schema.tables);

  for (const table of orderedTables) {
    statements.push(renderCreateTableStatement(table));
  }

  for (const table of orderedTables) {
    statements.push(...renderIndexStatements(table));
  }

  const schemaSql = statements.join('\n\n');

  const migrationSql = [
    '-- Migration 0001 — Initial Schema',
    '-- Generated deterministically from the approved Database Schema artifact. Do not edit by hand.',
    '',
    'BEGIN;',
    '',
    schemaSql,
    '',
    'COMMIT;',
  ].join('\n');

  return { schemaSql, migrationSql };
}
