import { databaseDesignerEngine } from '~/lib/projects/databaseDesignerEngine';
import { logProjectActivity, updateProjectDatabaseActivation, type Project } from '~/lib/stores/projects';
import { generateSchemaSql } from './sqlGenerator';
import { validateStructuredSchema } from './schemaValidator';
import { getDatabaseProvisioner } from './provisioning/getProvisioner';
import type { DatabaseProviderId } from './provisioning/databaseProvisioner';

/**
 * Database Activation Orchestration — Sprint 75 (Real Backend Activation, Phase 1).
 *
 * The single place that chains generate schema -> validate -> (explicit user action) provision
 * -> verify connection, and is the only writer of both `Project.databaseActivation` (via
 * `updateProjectDatabaseActivation`) and the `database_*` activity history entries (via
 * `logProjectActivity`). DatabaseActivationCard.tsx is the only caller — every step here runs
 * only in direct response to a button press, never automatically, per the sprint's safety
 * requirement (Part 10).
 */

export interface DatabaseActivationActionResult {
  ok: boolean;
  message: string;
}

/**
 * Deterministically renders SQL from the approved Database Schema artifact
 * (databaseDesignerEngine.getApprovedStructuredSchema — see Part 1's lockstep DATABASE_DRAFT/
 * DATABASE_SCHEMA pairing) and persists it. Requires the Database Design to be approved first —
 * same gate every other role's next step already uses.
 */
export function generateDatabaseSchema(project: Project): DatabaseActivationActionResult {
  const schema = databaseDesignerEngine.getApprovedStructuredSchema(project);

  if (!schema || schema.tables.length === 0) {
    return {
      ok: false,
      message: 'Approve the Database Design Draft first — its structured schema has no tables yet.',
    };
  }

  const { schemaSql, migrationSql } = generateSchemaSql(schema);

  updateProjectDatabaseActivation(project.id, {
    schema: {
      generatedAt: new Date().toISOString(),
      tableCount: schema.tables.length,
      schemaSql,
      migrationSql,
    },

    // A fresh schema invalidates any prior validation/provisioning/connection state.
    validation: undefined,
    provisioning: undefined,
    connection: undefined,
  });

  logProjectActivity(
    project.id,
    'database_schema_generated',
    `Database schema generated (${schema.tables.length} table${schema.tables.length === 1 ? '' : 's'})`,
  );

  return { ok: true, message: `Schema generated for ${schema.tables.length} table(s).` };
}

/** Validates the currently-approved structured schema and persists the report. Provisioning is blocked downstream unless this reports `passed: true`. */
export function validateDatabaseSchema(project: Project): DatabaseActivationActionResult {
  const schema = databaseDesignerEngine.getApprovedStructuredSchema(project);

  if (!schema || schema.tables.length === 0) {
    return { ok: false, message: 'Generate the schema first — there is nothing to validate yet.' };
  }

  const report = validateStructuredSchema(schema);

  updateProjectDatabaseActivation(project.id, {
    validation: { validatedAt: new Date().toISOString(), report },
  });

  logProjectActivity(
    project.id,
    report.passed ? 'database_validation_passed' : 'database_validation_failed',
    report.passed
      ? 'Database schema validation passed'
      : `Database schema validation failed (${report.errors.length} error${report.errors.length === 1 ? '' : 's'})`,
  );

  return {
    ok: report.passed,
    message: report.passed
      ? 'Validation passed — safe to provision.'
      : `Validation failed: ${report.errors.length} error(s). See the validation report.`,
  };
}

/**
 * Provisions the schema via the given provider (Phase 1: only `'mock'` has a working
 * implementation — see getProvisioner.ts). Refuses to run unless validation has already passed,
 * enforcing Part 10's safety requirement in code, not just by disabling the button.
 */
export async function provisionDatabase(
  project: Project,
  providerId: DatabaseProviderId,
): Promise<DatabaseActivationActionResult> {
  const activation = project.databaseActivation;

  if (!activation?.schema) {
    return { ok: false, message: 'Generate the schema first.' };
  }

  if (!activation.validation?.report.passed) {
    return { ok: false, message: 'Validation must pass before provisioning.' };
  }

  const startedAt = new Date().toISOString();
  updateProjectDatabaseActivation(project.id, {
    provisioning: { provider: providerId, status: 'in_progress', startedAt },
  });
  logProjectActivity(project.id, 'database_provisioning_started', `Database provisioning started (${providerId})`);

  try {
    const provisioner = getDatabaseProvisioner(providerId);
    const schema = databaseDesignerEngine.getApprovedStructuredSchema(project) ?? { tables: [] };
    const result = await provisioner.provision(schema, activation.schema.migrationSql);

    updateProjectDatabaseActivation(project.id, {
      provisioning: {
        provider: providerId,
        status: result.ok ? 'succeeded' : 'failed',
        startedAt,
        finishedAt: result.provisionedAt,
        message: result.message,
      },
    });
    logProjectActivity(
      project.id,
      result.ok ? 'database_provisioning_finished' : 'database_provisioning_failed',
      result.message,
    );

    return { ok: result.ok, message: result.message };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provisioning failed.';

    updateProjectDatabaseActivation(project.id, {
      provisioning: {
        provider: providerId,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        message,
      },
    });
    logProjectActivity(project.id, 'database_provisioning_failed', message);

    return { ok: false, message };
  }
}

/** Verifies the connection to whatever was just provisioned. Requires a successful provisioning step first. */
export async function verifyDatabaseConnection(project: Project): Promise<DatabaseActivationActionResult> {
  const activation = project.databaseActivation;

  if (activation?.provisioning?.status !== 'succeeded') {
    return { ok: false, message: 'Provision the database first.' };
  }

  const provisioner = getDatabaseProvisioner(activation.provisioning.provider);
  const result = await provisioner.verifyConnection();

  updateProjectDatabaseActivation(project.id, {
    connection: { verified: result.ok, verifiedAt: result.verifiedAt, message: result.message },
  });

  if (result.ok) {
    logProjectActivity(project.id, 'database_connection_verified', result.message);
  }

  return { ok: result.ok, message: result.message };
}
