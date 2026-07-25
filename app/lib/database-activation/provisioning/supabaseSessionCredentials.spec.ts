// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearSupabaseProvisioningSession,
  connectSupabaseProvisioningSession,
  getSupabaseProvisioningToken,
  isSupabaseProvisioningConnected,
} from './supabaseSessionCredentials';

describe('supabaseSessionCredentials — Sprint 76', () => {
  beforeEach(() => {
    clearSupabaseProvisioningSession();
  });

  it('starts disconnected with no token', () => {
    expect(getSupabaseProvisioningToken()).toBeUndefined();
    expect(isSupabaseProvisioningConnected.get()).toBe(false);
  });

  it('connect stores the token in memory and flips the reactive atom to true', () => {
    connectSupabaseProvisioningSession('fixture-pat-123');

    expect(getSupabaseProvisioningToken()).toBe('fixture-pat-123');
    expect(isSupabaseProvisioningConnected.get()).toBe(true);
  });

  it('mirrors the token to sessionStorage (never localStorage) as a session-scoped convenience', () => {
    connectSupabaseProvisioningSession('fixture-pat-123');

    const mirrored = globalThis.sessionStorage.getItem('builders_supabase_provisioning_session');
    expect(mirrored).toBeTruthy();
    expect(JSON.parse(mirrored as string).token).toBe('fixture-pat-123');
    expect(globalThis.localStorage.getItem('builders_supabase_provisioning_session')).toBeNull();
  });

  it('clear wipes both the in-memory value and the sessionStorage mirror', () => {
    connectSupabaseProvisioningSession('fixture-pat-123');
    clearSupabaseProvisioningSession();

    expect(getSupabaseProvisioningToken()).toBeUndefined();
    expect(isSupabaseProvisioningConnected.get()).toBe(false);
    expect(globalThis.sessionStorage.getItem('builders_supabase_provisioning_session')).toBeNull();
  });

  it('reconnecting with a new token overwrites the previous one entirely', () => {
    connectSupabaseProvisioningSession('first-token');
    connectSupabaseProvisioningSession('second-token');

    expect(getSupabaseProvisioningToken()).toBe('second-token');
  });
});
