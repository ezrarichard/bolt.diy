import { describe, expect, it } from 'vitest';
import { shouldInvalidateProjectHydration } from './authHydrationInvalidation';

describe('shouldInvalidateProjectHydration', () => {
  it('invalidates on a genuine sign-out (previously had a signed-in user)', () => {
    expect(shouldInvalidateProjectHydration('user-a', 'unauthenticated', null)).toBe(true);
  });

  it('does not invalidate an unauthenticated -> unauthenticated no-op', () => {
    expect(shouldInvalidateProjectHydration(null, 'unauthenticated', null)).toBe(false);
  });

  it('invalidates when a different user becomes authenticated without an intervening sign-out', () => {
    expect(shouldInvalidateProjectHydration('user-a', 'authenticated', 'user-b')).toBe(true);
  });

  it('does not invalidate when the same user re-authenticates (e.g. token refresh)', () => {
    expect(shouldInvalidateProjectHydration('user-a', 'authenticated', 'user-a')).toBe(false);
  });

  it('does not invalidate the very first sign-in (no previous user)', () => {
    expect(shouldInvalidateProjectHydration(null, 'authenticated', 'user-a')).toBe(false);
  });
});
