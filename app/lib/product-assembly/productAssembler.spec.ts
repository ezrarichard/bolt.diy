import { describe, expect, it } from 'vitest';
import type { Project } from '~/lib/stores/projects';
import { assembleProductPackage } from './productAssembler';

/**
 * Sprint 76 — targeted credential non-leakage check for the Product Package. `productAssembler.ts`
 * only ever reads `project.databaseActivation` (see its own imports — no session-credential module
 * is imported here at all), so a Supabase Management token can never reach an assembled file
 * structurally, not just by discipline. This test proves it end-to-end against the actual
 * `assembleProductPackage` output rather than relying on that structural argument alone.
 */

const FIXTURE_TOKEN = 'sbp_super_secret_pat_do_not_leak';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    ...overrides,
  } as Project;
}

describe('assembleProductPackage — Sprint 76 credential non-leakage', () => {
  it('never includes a Supabase token anywhere in the assembled Database section files, even with a live connectionConfig/provisioning state', () => {
    const project = makeProject({
      databaseActivation: {
        schema: {
          generatedAt: '2026-07-25T00:00:00.000Z',
          tableCount: 1,
          schemaSql: 'CREATE TABLE "users" ("id" uuid NOT NULL, PRIMARY KEY ("id"));',
          migrationSql: 'BEGIN;\nCREATE TABLE "users" ("id" uuid NOT NULL, PRIMARY KEY ("id"));\nCOMMIT;',
        },
        validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },
        connectionConfig: { provider: 'supabase', projectId: 'proj-abc', connectedAt: '2026-07-25T00:00:00.000Z' },
        provisioning: {
          provider: 'supabase',
          status: 'succeeded',
          startedAt: '2026-07-25T00:00:00.000Z',
          finishedAt: '2026-07-25T00:00:05.000Z',
          message: 'Provisioned 1 table(s) to Supabase project proj-abc.',
        },
        connection: { verified: true, verifiedAt: '2026-07-25T00:00:06.000Z', message: 'Connection verified.' },
      },
    });

    const pkg = assembleProductPackage(project);
    const serialized = JSON.stringify(pkg);

    expect(serialized).not.toContain(FIXTURE_TOKEN);

    const databaseSection = pkg.sections.find((section) => section.id === 'database');
    expect(databaseSection?.files.some((file) => file.filename === 'schema.sql')).toBe(true);
  });
});
