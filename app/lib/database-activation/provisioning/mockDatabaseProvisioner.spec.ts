import { describe, expect, it } from 'vitest';
import { createMockDatabaseProvisioner } from './mockDatabaseProvisioner';

describe('createMockDatabaseProvisioner — Sprint 75', () => {
  it('reports providerId "mock"', () => {
    expect(createMockDatabaseProvisioner().providerId).toBe('mock');
  });

  it('provision() always succeeds deterministically without touching a real database', async () => {
    const provisioner = createMockDatabaseProvisioner();
    const result = await provisioner.provision(
      { tables: [{ name: 'a', columns: [], primaryKey: [] }] },
      'CREATE TABLE a ();',
    );

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('mock');
    expect(result.message).toContain('1 table');
  });

  it('verifyConnection() always succeeds deterministically', async () => {
    const provisioner = createMockDatabaseProvisioner();
    const result = await provisioner.verifyConnection();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('mock');
  });
});
