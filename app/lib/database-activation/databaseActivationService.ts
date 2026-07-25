import { ARTIFACT_TYPES, getLatestApprovedArtifact } from '~/lib/projects/artifacts';
import { databaseDesignerEngine } from '~/lib/projects/databaseDesignerEngine';
import {
  getProjectArtifacts,
  logProjectActivity,
  updateProjectDatabaseActivation,
  type Project,
} from '~/lib/stores/projects';
import { generateSchemaSql } from './sqlGenerator';
import { validateStructuredSchema } from './schemaValidator';
import { getDatabaseProvisioner } from './provisioning/getProvisioner';
import type { DatabaseProviderId } from './provisioning/databaseProvisioner';
import { clearSupabaseProvisioningSession } from './provisioning/supabaseSessionCredentials';
import { BUILDERS_DB_PROJECT_REFUSAL_MESSAGE, isBuildersDbProjectId } from './provisioning/buildersDbProjectGuard';

/**
 * Database Activation Orchestration — Sprint 75 (Real Backend Activation, Phase 1), extended
 * Sprint 76 (Real Database Provisioning, Phase 2).
 *
 * The single place that chains connect -> generate schema -> validate -> (explicit user action)
 * provision -> verify connection, and is the only writer of both `Project.databaseActivation` (via
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
 * Sprint 76 — records that a customer's own Supabase project has been selected for this project.
 * Only ever stores the (public) project id — the token that authorized listing/selecting it lives
 * exclusively in the session-scoped credential holder (provisioning/supabaseSessionCredentials.ts)
 * and is never passed to or persisted by this function. See
 * docs/backend-activation/Provisioning-Architecture.md §4.
 */
export function connectSupabaseProject(project: Project, projectId: string): DatabaseActivationActionResult {
  if (!projectId.trim()) {
    return { ok: false, message: 'Select a Supabase project first.' };
  }

  /*
   * Structural BuildersDB isolation (Provisioning-Architecture.md §1) — checked here, at the
   * earliest possible point, so a customer's own Builders platform database can never even be
   * connected, let alone provisioned into.
   */
  if (isBuildersDbProjectId(projectId)) {
    return { ok: false, message: BUILDERS_DB_PROJECT_REFUSAL_MESSAGE };
  }

  updateProjectDatabaseActivation(project.id, {
    connectionConfig: { provider: 'supabase', projectId, connectedAt: new Date().toISOString() },

    // A new connection invalidates any provisioning/connection status recorded against the previous one.
    provisioning: undefined,
    connection: undefined,
  });

  logProjectActivity(project.id, 'database_connected', `Connected to Supabase project ${projectId}`);

  return { ok: true, message: `Connected to Supabase project ${projectId}.` };
}

/**
 * Sprint 76 — clears the project's connection config AND wipes the session-scoped credential (the
 * one and only place the Supabase Management token lives) so nothing about this connection
 * survives disconnect, per the architecture doc's §4.4 "disconnect wipes everything" requirement.
 */
export function disconnectSupabaseProject(project: Project): DatabaseActivationActionResult {
  clearSupabaseProvisioningSession();

  updateProjectDatabaseActivation(project.id, {
    connectionConfig: undefined,
    provisioning: undefined,
    connection: undefined,
  });

  logProjectActivity(project.id, 'database_disconnected', 'Disconnected from Supabase project');

  return { ok: true, message: 'Disconnected.' };
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

  /*
   * Sprint 76 — surfaced in the Workspace UI as "Schema version" so a user can tell whether a later
   * Database Engineer regeneration has outpaced what was actually provisioned.
   */
  const schemaVersion = getLatestApprovedArtifact(
    getProjectArtifacts(project),
    ARTIFACT_TYPES.DATABASE_SCHEMA,
  )?.version;

  updateProjectDatabaseActivation(project.id, {
    schema: {
      generatedAt: new Date().toISOString(),
      tableCount: schema.tables.length,
      schemaSql,
      migrationSql,
      schemaVersion,
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
 * Provisions the schema via the given provider. Refuses to run unless validation has already
 * passed, enforcing Part 10's safety requirement in code, not just by disabling the button.
 *
 * Sprint 76 — `'supabase'` requires a connected project (`activation.connectionConfig`); the actual
 * Management token is never touched by this function — `getDatabaseProvisioner`/
 * `SupabaseProvisioner` read it directly from the session-scoped credential holder.
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

  if (providerId === 'supabase' && activation.connectionConfig?.provider !== 'supabase') {
    return { ok: false, message: 'Connect a Supabase project first.' };
  }

  const startedAt = new Date().toISOString();
  updateProjectDatabaseActivation(project.id, {
    provisioning: { provider: providerId, status: 'in_progress', startedAt },
  });
  logProjectActivity(project.id, 'database_provisioning_started', `Database provisioning started (${providerId})`);

  try {
    const provisioner = getDatabaseProvisioner(providerId, { projectId: activation.connectionConfig?.projectId });
    const schema = databaseDesignerEngine.getApprovedStructuredSchema(project) ?? { tables: [] };
    const result = await provisioner.provision(schema, activation.schema.migrationSql);

    updateProjectDatabaseActivation(project.id, {
      provisioning: {
        provider: providerId,
        status: result.ok ? 'succeeded' : 'failed',
        startedAt,
        finishedAt: result.provisionedAt,
        message: result.message,
        executionReport: result.executionReport,
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

/** Retries a failed provisioning attempt using the same provider/connection recorded from the last attempt. */
export async function retryProvisionDatabase(project: Project): Promise<DatabaseActivationActionResult> {
  const provider = project.databaseActivation?.provisioning?.provider;

  if (!provider) {
    return { ok: false, message: 'Nothing to retry — provision the database first.' };
  }

  return provisionDatabase(project, provider);
}

/** Verifies the connection to whatever was just provisioned, including (Sprint 76) that the generated tables actually exist. Requires a successful provisioning step first. */
export async function verifyDatabaseConnection(project: Project): Promise<DatabaseActivationActionResult> {
  const activation = project.databaseActivation;

  if (activation?.provisioning?.status !== 'succeeded') {
    return { ok: false, message: 'Provision the database first.' };
  }

  const provisioner = getDatabaseProvisioner(activation.provisioning.provider, {
    projectId: activation.connectionConfig?.projectId,
  });
  const schema = databaseDesignerEngine.getApprovedStructuredSchema(project);
  const result = await provisioner.verifyConnection(schema);

  updateProjectDatabaseActivation(project.id, {
    connection: {
      verified: result.ok,
      verifiedAt: result.verifiedAt,
      message: result.message,
      schemaVerification: result.schemaVerification,
    },
  });

  if (result.ok) {
    logProjectActivity(project.id, 'database_connection_verified', result.message);
  }

  return { ok: result.ok, message: result.message };
}
