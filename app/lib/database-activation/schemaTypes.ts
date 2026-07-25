/**
 * Structured Database Schema — Sprint 75 (Real Backend Activation, Phase 1).
 *
 * The machine-readable counterpart to the Database Engineer's narrative
 * `DatabaseDraft` (see app/lib/projects/prompts/database.ts). Produced by the
 * SAME single LLM call as the narrative draft, but persisted as its own
 * first-class artifact (`ARTIFACT_TYPES.DATABASE_SCHEMA` — see
 * app/lib/projects/artifacts.ts) rather than a field nested inside the
 * narrative one, so every downstream system (sqlGenerator.ts,
 * schemaValidator.ts, the provisioning abstraction, and future backend/API/
 * ORM generation) consumes exactly this shape deterministically, without
 * re-interpreting prose.
 *
 * Intentionally scoped to what sqlGenerator.ts actually emits (CREATE TABLE,
 * PRIMARY KEY, FOREIGN KEY, NOT NULL, DEFAULT, UNIQUE, INDEX, TIMESTAMPS) —
 * `storageBuckets`/`policies` are typed now (per the sprint brief's
 * "future-ready" note) but nothing generates SQL from them yet.
 */

export type SchemaColumnType =
  | 'uuid'
  | 'text'
  | 'varchar'
  | 'integer'
  | 'bigint'
  | 'boolean'
  | 'timestamp'
  | 'date'
  | 'numeric'
  | 'jsonb'
  | 'enum';

export interface SchemaColumn {
  name: string;
  type: SchemaColumnType;

  /** Only meaningful when type === 'varchar'. */
  length?: number;

  /** Only meaningful when type === 'enum' — must match a SchemaEnum.name in the same schema. */
  enumName?: string;
  nullable: boolean;
  unique?: boolean;

  /** Raw SQL literal/expression, e.g. "gen_random_uuid()", "now()", "false", "0". */
  default?: string;
}

export interface SchemaForeignKey {
  column: string;
  referencesTable: string;
  referencesColumn: string;
  onDelete?: 'cascade' | 'set null' | 'restrict';
}

export interface SchemaIndex {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];

  /** Column name(s) forming the primary key. Every table must have at least one. */
  primaryKey: string[];
  foreignKeys?: SchemaForeignKey[];
  indexes?: SchemaIndex[];

  /** Adds standard created_at/updated_at timestamp columns via sqlGenerator.ts rather than requiring them to be spelled out in `columns`. */
  timestamps?: boolean;
}

export interface SchemaEnum {
  name: string;
  values: string[];
}

/** Future-ready per the sprint brief — untouched by sqlGenerator.ts/schemaValidator.ts in Phase 1. */
export interface SchemaStorageBucket {
  name: string;
  public?: boolean;
}

/** Future-ready per the sprint brief — untouched by sqlGenerator.ts/schemaValidator.ts in Phase 1. */
export interface SchemaPolicy {
  table: string;
  name: string;
  description: string;
}

export interface StructuredDatabaseSchema {
  tables: SchemaTable[];
  enums?: SchemaEnum[];
  storageBuckets?: SchemaStorageBucket[];
  policies?: SchemaPolicy[];
}

/** The "no structured schema generated yet" sentinel — used for legacy DatabaseDraft artifacts that predate this field, and as the paired artifact's content when the LLM response omitted `structuredSchema`. */
export const EMPTY_STRUCTURED_SCHEMA: StructuredDatabaseSchema = { tables: [] };

function isSchemaColumnType(value: unknown): value is SchemaColumnType {
  return (
    typeof value === 'string' &&
    (
      [
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
      ] as string[]
    ).includes(value)
  );
}

function toValidColumn(entry: unknown): SchemaColumn | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';

  if (!name || !isSchemaColumnType(record.type)) {
    return undefined;
  }

  return {
    name,
    type: record.type,
    length: typeof record.length === 'number' ? record.length : undefined,
    enumName: typeof record.enumName === 'string' ? record.enumName : undefined,
    nullable: record.nullable === true,
    unique: record.unique === true ? true : undefined,
    default: typeof record.default === 'string' && record.default.trim().length > 0 ? record.default.trim() : undefined,
  };
}

function toValidForeignKey(entry: unknown): SchemaForeignKey | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const column = typeof record.column === 'string' ? record.column.trim() : '';
  const referencesTable = typeof record.referencesTable === 'string' ? record.referencesTable.trim() : '';
  const referencesColumn = typeof record.referencesColumn === 'string' ? record.referencesColumn.trim() : '';

  if (!column || !referencesTable || !referencesColumn) {
    return undefined;
  }

  const onDelete = record.onDelete;

  return {
    column,
    referencesTable,
    referencesColumn,
    onDelete: onDelete === 'cascade' || onDelete === 'set null' || onDelete === 'restrict' ? onDelete : undefined,
  };
}

function toValidIndex(entry: unknown): SchemaIndex | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const columns = Array.isArray(record.columns)
    ? record.columns.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];

  if (!name || columns.length === 0) {
    return undefined;
  }

  return { name, columns, unique: record.unique === true ? true : undefined };
}

function toValidTable(entry: unknown): SchemaTable | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const columns = Array.isArray(record.columns)
    ? record.columns.map(toValidColumn).filter((c): c is SchemaColumn => Boolean(c))
    : [];

  if (!name || columns.length === 0) {
    return undefined;
  }

  const primaryKey = Array.isArray(record.primaryKey)
    ? record.primaryKey.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    : [];

  const foreignKeys = Array.isArray(record.foreignKeys)
    ? record.foreignKeys.map(toValidForeignKey).filter((fk): fk is SchemaForeignKey => Boolean(fk))
    : undefined;

  const indexes = Array.isArray(record.indexes)
    ? record.indexes.map(toValidIndex).filter((idx): idx is SchemaIndex => Boolean(idx))
    : undefined;

  return {
    name,
    columns,
    primaryKey,
    foreignKeys: foreignKeys && foreignKeys.length > 0 ? foreignKeys : undefined,
    indexes: indexes && indexes.length > 0 ? indexes : undefined,
    timestamps: record.timestamps === true ? true : undefined,
  };
}

function toValidEnum(entry: unknown): SchemaEnum | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const values = Array.isArray(record.values)
    ? record.values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];

  if (!name || values.length === 0) {
    return undefined;
  }

  return { name, values };
}

/**
 * Validates and normalizes an arbitrary (LLM-produced) value into a
 * `StructuredDatabaseSchema`, silently dropping malformed entries the same
 * way `parseStructuredDraft` does for the narrative draft — never throws.
 * Returns `EMPTY_STRUCTURED_SCHEMA` (never undefined) when the input isn't a
 * usable object at all, so callers always have a schema to work with, even
 * if it has zero tables.
 */
export function parseStructuredDatabaseSchema(value: unknown): StructuredDatabaseSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_STRUCTURED_SCHEMA;
  }

  const record = value as Record<string, unknown>;
  const tables = Array.isArray(record.tables)
    ? record.tables.map(toValidTable).filter((t): t is SchemaTable => Boolean(t))
    : [];
  const enums = Array.isArray(record.enums)
    ? record.enums.map(toValidEnum).filter((e): e is SchemaEnum => Boolean(e))
    : undefined;

  return {
    tables,
    enums: enums && enums.length > 0 ? enums : undefined,
  };
}
