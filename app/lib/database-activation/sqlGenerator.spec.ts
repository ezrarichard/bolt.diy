import { describe, expect, it } from 'vitest';
import { generateSchemaSql } from './sqlGenerator';
import type { StructuredDatabaseSchema } from './schemaTypes';

describe('generateSchemaSql — Sprint 75', () => {
  it('renders CREATE TABLE with PK, NOT NULL, DEFAULT, UNIQUE, and timestamps', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()' },
            { name: 'email', type: 'text', nullable: false, unique: true },
            { name: 'nickname', type: 'text', nullable: true },
          ],
          primaryKey: ['id'],
          timestamps: true,
        },
      ],
    };

    const { schemaSql } = generateSchemaSql(schema);

    expect(schemaSql).toContain('CREATE TABLE "users"');
    expect(schemaSql).toContain('"id" uuid NOT NULL DEFAULT gen_random_uuid()');
    expect(schemaSql).toContain('"email" text NOT NULL UNIQUE');
    expect(schemaSql).toContain('"nickname" text');
    expect(schemaSql).not.toMatch(/"nickname" text NOT NULL/);
    expect(schemaSql).toContain('PRIMARY KEY ("id")');
    expect(schemaSql).toContain('"created_at" timestamptz NOT NULL DEFAULT now()');
    expect(schemaSql).toContain('"updated_at" timestamptz NOT NULL DEFAULT now()');
  });

  it('renders FOREIGN KEY constraints with onDelete', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        { name: 'authors', columns: [{ name: 'id', type: 'uuid', nullable: false }], primaryKey: ['id'] },
        {
          name: 'books',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'author_id', type: 'uuid', nullable: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [
            { column: 'author_id', referencesTable: 'authors', referencesColumn: 'id', onDelete: 'cascade' },
          ],
        },
      ],
    };

    const { schemaSql } = generateSchemaSql(schema);

    expect(schemaSql).toContain('FOREIGN KEY ("author_id") REFERENCES "authors" ("id") ON DELETE CASCADE');
  });

  it('orders CREATE TABLE statements so a referenced table always precedes its dependent', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'books',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'author_id', type: 'uuid', nullable: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [{ column: 'author_id', referencesTable: 'authors', referencesColumn: 'id' }],
        },
        { name: 'authors', columns: [{ name: 'id', type: 'uuid', nullable: false }], primaryKey: ['id'] },
      ],
    };

    const { schemaSql } = generateSchemaSql(schema);

    expect(schemaSql.indexOf('CREATE TABLE "authors"')).toBeLessThan(schemaSql.indexOf('CREATE TABLE "books"'));
  });

  it('renders INDEX statements, including UNIQUE indexes', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'email', type: 'text', nullable: false },
          ],
          primaryKey: ['id'],
          indexes: [{ name: 'users_email_idx', columns: ['email'], unique: true }],
        },
      ],
    };

    const { schemaSql } = generateSchemaSql(schema);

    expect(schemaSql).toContain('CREATE UNIQUE INDEX "users_email_idx" ON "users" ("email");');
  });

  it('varchar columns include the configured length, defaulting to 255', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'products',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'sku', type: 'varchar', length: 32, nullable: false },
            { name: 'name', type: 'varchar', nullable: false },
          ],
          primaryKey: ['id'],
        },
      ],
    };

    const { schemaSql } = generateSchemaSql(schema);

    expect(schemaSql).toContain('"sku" varchar(32)');
    expect(schemaSql).toContain('"name" varchar(255)');
  });

  it('is deterministic — identical input produces byte-identical output', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [{ name: 'a', columns: [{ name: 'id', type: 'uuid', nullable: false }], primaryKey: ['id'] }],
    };

    const first = generateSchemaSql(schema);
    const second = generateSchemaSql(schema);

    expect(first.schemaSql).toBe(second.schemaSql);
    expect(first.migrationSql).toBe(second.migrationSql);
  });

  it('wraps migrationSql in BEGIN/COMMIT with a header comment', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [{ name: 'a', columns: [{ name: 'id', type: 'uuid', nullable: false }], primaryKey: ['id'] }],
    };

    const { migrationSql } = generateSchemaSql(schema);

    expect(migrationSql).toContain('Migration 0001 — Initial Schema');
    expect(migrationSql).toContain('BEGIN;');
    expect(migrationSql).toContain('COMMIT;');
  });

  it('renders CREATE TYPE for enums', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'status', type: 'enum', enumName: 'order_status', nullable: false },
          ],
          primaryKey: ['id'],
        },
      ],
      enums: [{ name: 'order_status', values: ['pending', 'shipped'] }],
    };

    const { schemaSql } = generateSchemaSql(schema);

    expect(schemaSql).toContain("CREATE TYPE \"order_status\" AS ENUM ('pending', 'shipped');");
    expect(schemaSql).toContain('"status" order_status NOT NULL');
  });
});
