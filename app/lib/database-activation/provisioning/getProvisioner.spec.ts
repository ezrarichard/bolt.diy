import { describe, expect, it } from 'vitest';
import { getDatabaseProvisioner } from './getProvisioner';

describe('getDatabaseProvisioner — Sprint 75', () => {
  it('returns a working provisioner for "mock"', () => {
    expect(getDatabaseProvisioner('mock').providerId).toBe('mock');
  });

  it.each(['supabase', 'postgres', 'sqlite'] as const)(
    'throws a clear "not implemented" error for "%s"',
    (providerId) => {
      expect(() => getDatabaseProvisioner(providerId)).toThrow(/not implemented/i);
    },
  );
});
