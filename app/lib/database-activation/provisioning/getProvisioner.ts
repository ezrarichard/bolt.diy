import type { DatabaseProviderId, DatabaseProvisioner } from './databaseProvisioner';
import { createMockDatabaseProvisioner } from './mockDatabaseProvisioner';

/**
 * Sprint 75 — the single factory every caller uses to get a
 * `DatabaseProvisioner`, so Sprint 76+ can add real `'supabase'`/`'postgres'`/
 * `'sqlite'` implementations here without touching any call site. Throws a
 * clear, typed error for providers not yet implemented rather than silently
 * falling back to the mock — provisioning must never surprise the user about
 * which provider actually ran.
 */
export function getDatabaseProvisioner(providerId: DatabaseProviderId): DatabaseProvisioner {
  if (providerId === 'mock') {
    return createMockDatabaseProvisioner();
  }

  throw new Error(
    `The "${providerId}" database provider is not implemented in Sprint 75 (Real Backend Activation, Phase 1). ` +
      `Only "mock" is available today — real provisioning is planned for a later sprint.`,
  );
}
