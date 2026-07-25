import { describe, expect, it } from 'vitest';
import { renderValidationReportMarkdown, validateStructuredSchema } from './schemaValidator';
import type { StructuredDatabaseSchema } from './schemaTypes';

const CLEAN_SCHEMA: StructuredDatabaseSchema = {
  tables: [
    {
      name: 'authors',
      columns: [{ name: 'id', type: 'uuid', nullable: false }],
      primaryKey: ['id'],
    },
    {
      name: 'books',
      columns: [
        { name: 'id', type: 'uuid', nullable: false },
        { name: 'author_id', type: 'uuid', nullable: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [{ column: 'author_id', referencesTable: 'authors', referencesColumn: 'id' }],
    },
  ],
};

describe('validateStructuredSchema — Sprint 75', () => {
  it('passes a clean schema with no errors or warnings', () => {
    const report = validateStructuredSchema(CLEAN_SCHEMA);

    expect(report.passed).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('fails when there are no tables at all', () => {
    const report = validateStructuredSchema({ tables: [] });

    expect(report.passed).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('no-tables');
  });

  it('flags duplicate table names', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        { name: 'users', columns: [{ name: 'id', type: 'uuid', nullable: false }], primaryKey: ['id'] },
        { name: 'users', columns: [{ name: 'id', type: 'uuid', nullable: false }], primaryKey: ['id'] },
      ],
    };

    const report = validateStructuredSchema(schema);

    expect(report.passed).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('duplicate-table');
  });

  it('flags duplicate column names within a table', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'id', type: 'text', nullable: false },
          ],
          primaryKey: ['id'],
        },
      ],
    };

    const report = validateStructuredSchema(schema);

    expect(report.errors.map((e) => e.code)).toContain('duplicate-column');
  });

  it('flags a foreign key referencing an unknown table', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'books',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'author_id', type: 'uuid', nullable: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [{ column: 'author_id', referencesTable: 'ghost_table', referencesColumn: 'id' }],
        },
      ],
    };

    const report = validateStructuredSchema(schema);

    expect(report.errors.map((e) => e.code)).toContain('invalid-foreign-key');
  });

  it('warns (does not error) on a reserved SQL keyword used as a table/column name', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'order',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'select', type: 'text', nullable: true },
          ],
          primaryKey: ['id'],
        },
      ],
    };

    const report = validateStructuredSchema(schema);

    expect(report.passed).toBe(true);
    expect(report.warnings.map((w) => w.code)).toContain('reserved-keyword');
  });

  it('flags an unsupported column type', () => {
    const schema = {
      tables: [
        {
          name: 'users',
          columns: [{ name: 'id', type: 'money', nullable: false }],
          primaryKey: ['id'],
        },
      ],
    } as unknown as StructuredDatabaseSchema;

    const report = validateStructuredSchema(schema);

    expect(report.errors.map((e) => e.code)).toContain('invalid-type');
  });

  it('flags a circular foreign key reference', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'a',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'b_id', type: 'uuid', nullable: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [{ column: 'b_id', referencesTable: 'b', referencesColumn: 'id' }],
        },
        {
          name: 'b',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'a_id', type: 'uuid', nullable: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [{ column: 'a_id', referencesTable: 'a', referencesColumn: 'id' }],
        },
      ],
    };

    const report = validateStructuredSchema(schema);

    expect(report.errors.map((e) => e.code)).toContain('circular-reference');
  });

  it('flags a table with no primary key', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [{ name: 'logs', columns: [{ name: 'message', type: 'text', nullable: false }], primaryKey: [] }],
    };

    const report = validateStructuredSchema(schema);

    expect(report.errors.map((e) => e.code)).toContain('missing-primary-key');
  });

  it('does not flag a self-referencing foreign key (e.g. parent_id) as circular', () => {
    const schema: StructuredDatabaseSchema = {
      tables: [
        {
          name: 'categories',
          columns: [
            { name: 'id', type: 'uuid', nullable: false },
            { name: 'parent_id', type: 'uuid', nullable: true },
          ],
          primaryKey: ['id'],
          foreignKeys: [{ column: 'parent_id', referencesTable: 'categories', referencesColumn: 'id' }],
        },
      ],
    };

    const report = validateStructuredSchema(schema);

    expect(report.passed).toBe(true);
  });
});

describe('renderValidationReportMarkdown — Sprint 75', () => {
  it('renders a PASSED report with zero errors/warnings sections', () => {
    const markdown = renderValidationReportMarkdown({ passed: true, errors: [], warnings: [] });

    expect(markdown).toContain('**Status: PASSED**');
    expect(markdown).toContain('## Errors (0)');
  });

  it('renders a FAILED report listing each error', () => {
    const markdown = renderValidationReportMarkdown({
      passed: false,
      errors: [{ code: 'missing-primary-key', message: 'Table "logs" has no primary key.', table: 'logs' }],
      warnings: [],
    });

    expect(markdown).toContain('**Status: FAILED**');
    expect(markdown).toContain('missing-primary-key');
    expect(markdown).toContain('Table "logs" has no primary key.');
  });
});
