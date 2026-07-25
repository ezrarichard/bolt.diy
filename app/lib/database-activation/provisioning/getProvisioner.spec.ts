import { describe, expect, it } from 'vitest';
import { getDatabaseProvisioner } from './getProvisioner';

describe('getDatabaseProvisioner — Sprint 75/76', () => {
  it('returns a working provisioner for "mock" with no connection config needed', () => {
    expect(getDatabaseProvisioner('mock').providerId).toBe('mock');
  });

  it('returns a working SupabaseProvisioner for "supabase" when a projectId is given (Sprint 76)', () => {
    const provisioner = getDatabaseProvisioner('supabase', { projectId: 'proj-abc' });
    expect(provisioner.providerId).toBe('supabase');
  });

  it('throws a clear, actionable error for "supabase" when no projectId is given', () => {
    expect(() => getDatabaseProvisioner('supabase')).toThrow(/connect a supabase project/i);
  });

  it.each(['postgres', 'sqlite'] as const)('throws a clear "not implemented" error for "%s"', (providerId) => {
    expect(() => getDatabaseProvisioner(providerId)).toThrow(/not implemented/i);
  });
});
