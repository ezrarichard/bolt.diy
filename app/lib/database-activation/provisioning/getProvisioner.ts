import type { DatabaseProviderId, DatabaseProvisioner } from './databaseProvisioner';
import { createMockDatabaseProvisioner } from './mockDatabaseProvisioner';
import { createSupabaseProvisioner } from './supabaseProvisioner';

/**
 * Sprint 76 — connection details a provider needs to target a specific customer database. Kept as
 * generic a shape as practical: `projectId` is the one piece every "connect to an existing hosted
 * project" provider needs (Supabase today; a future self-hosted CubicleDB or managed Postgres could
 * reuse the same field). Providers that don't need one (`'mock'`) simply ignore this parameter.
 * Credentials are NEVER part of this config — each provider reads its own token from its own
 * session-scoped credential holder (see supabaseSessionCredentials.ts) rather than having one
 * threaded through here, so this factory (and every orchestration caller) never needs to know a
 * credential shape at all.
 */
export interface ProvisionerConnectionConfig {
  projectId?: string;
}

/**
 * Sprint 75 — the single factory every caller uses to get a
 * `DatabaseProvisioner`, so Sprint 76+ can add real `'supabase'`/`'postgres'`/
 * `'sqlite'` implementations here without touching any call site. Throws a
 * clear, typed error for providers not yet implemented rather than silently
 * falling back to the mock — provisioning must never surprise the user about
 * which provider actually ran.
 *
 * Sprint 76 — `'supabase'` is now real, but requires a `connection.projectId` (the customer's own
 * Supabase project, selected via the Workspace UI's Connect flow) — throws a clear, actionable
 * error rather than an implementation-detail crash when called before a project is selected.
 */
export function getDatabaseProvisioner(
  providerId: DatabaseProviderId,
  connection?: ProvisionerConnectionConfig,
): DatabaseProvisioner {
  if (providerId === 'mock') {
    return createMockDatabaseProvisioner();
  }

  if (providerId === 'supabase') {
    if (!connection?.projectId) {
      throw new Error('Connect a Supabase project first — no project is selected for this provider yet.');
    }

    return createSupabaseProvisioner({ projectId: connection.projectId });
  }

  throw new Error(
    `The "${providerId}" database provider is not implemented yet (Sprint 76). ` +
      `"mock" and "supabase" are available today — real provisioning for other providers is planned for a later sprint.`,
  );
}
