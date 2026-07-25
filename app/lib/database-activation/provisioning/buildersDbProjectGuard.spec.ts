import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getBuildersDbConfigMock } = vi.hoisted(() => ({ getBuildersDbConfigMock: vi.fn() }));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbConfig: getBuildersDbConfigMock,
}));

const { isBuildersDbProjectId } = await import('./buildersDbProjectGuard');

describe('isBuildersDbProjectId — Sprint 76', () => {
  beforeEach(() => {
    getBuildersDbConfigMock.mockReset();
  });

  it('returns false when BuildersDB is not configured — never blocks an unconfigured environment', () => {
    getBuildersDbConfigMock.mockReturnValue(undefined);

    expect(isBuildersDbProjectId('anything')).toBe(false);
  });

  it("returns true when the project id matches BuildersDB's own project ref exactly", () => {
    getBuildersDbConfigMock.mockReturnValue({ url: 'https://abcdefghijklmnop.supabase.co', anonKey: 'x' });

    expect(isBuildersDbProjectId('abcdefghijklmnop')).toBe(true);
  });

  it('matches case-insensitively', () => {
    getBuildersDbConfigMock.mockReturnValue({ url: 'https://AbCdEf.supabase.co', anonKey: 'x' });

    expect(isBuildersDbProjectId('abcdef')).toBe(true);
    expect(isBuildersDbProjectId('ABCDEF')).toBe(true);
  });

  it('returns false for a different, legitimate customer project id', () => {
    getBuildersDbConfigMock.mockReturnValue({ url: 'https://abcdefghijklmnop.supabase.co', anonKey: 'x' });

    expect(isBuildersDbProjectId('some-other-customer-project')).toBe(false);
  });

  it("returns false (never blocks) when BuildersDB's configured URL is not a recognizable Supabase project URL", () => {
    getBuildersDbConfigMock.mockReturnValue({ url: 'https://not-a-supabase-host.example.com', anonKey: 'x' });

    expect(isBuildersDbProjectId('anything')).toBe(false);
  });
});
