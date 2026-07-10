import type { User } from '@supabase/supabase-js';
import { getBuildersDbClient } from '~/lib/builders-db/client';

/**
 * Sprint 41.6 — User Profile Sync.
 *
 * Centralizes every `public.profiles` read/write behind three functions, mirroring the
 * existing app/lib/builders-db/repositories/*.ts convention (guarded on the client existing,
 * every Supabase call wrapped, failures logged and returned as `null`/an error string —
 * never thrown). AuthProvider.tsx is the only caller; no other component queries `profiles`
 * directly.
 */

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

const PROFILE_COLUMNS = 'id,email,display_name,avatar_url';

function toUserProfile(row: ProfileRow): UserProfile {
  return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url };
}

function logError(method: string, error: unknown): void {
  console.error(`[profile] ${method}() failed:`, error);
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const client = getBuildersDbClient();

  if (!client) {
    return null;
  }

  try {
    const { data, error } = await client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();

    if (error || !data) {
      if (error) {
        logError('fetchUserProfile', error);
      }

      return null;
    }

    return toUserProfile(data as ProfileRow);
  } catch (error) {
    logError('fetchUserProfile', error);
    return null;
  }
}

/**
 * Safe to call on every login — covers any account whose `on_auth_user_created` trigger
 * didn't fire (e.g. a user created before that trigger existed). `ignoreDuplicates: true`
 * means this upsert only ever INSERTs; it never overwrites a row that already exists, so it
 * can't clobber a display name the user already set.
 */
export async function ensureUserProfile(
  user: Pick<User, 'id' | 'email' | 'user_metadata'>,
): Promise<UserProfile | null> {
  const client = getBuildersDbClient();

  if (!client) {
    return null;
  }

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const seededDisplayName =
    (metadata.display_name as string | undefined) ||
    (metadata.full_name as string | undefined) ||
    (metadata.name as string | undefined) ||
    user.email ||
    null;
  const seededAvatarUrl = (metadata.avatar_url as string | undefined) || null;

  try {
    const { error } = await client
      .from('profiles')
      .upsert(
        { id: user.id, email: user.email ?? null, display_name: seededDisplayName, avatar_url: seededAvatarUrl },
        { onConflict: 'id', ignoreDuplicates: true },
      );

    if (error) {
      logError('ensureUserProfile', error);
    }
  } catch (error) {
    logError('ensureUserProfile', error);
  }

  return fetchUserProfile(user.id);
}

export interface ProfileUpdateInput {
  displayName?: string;
  avatarUrl?: string;
}

export async function updateUserProfile(
  userId: string,
  updates: ProfileUpdateInput,
): Promise<{ profile: UserProfile | null; error: string | null }> {
  const client = getBuildersDbClient();

  if (!client) {
    return { profile: null, error: 'Authentication is not configured on this deployment.' };
  }

  const patch: Record<string, string | null> = {};

  if (updates.displayName !== undefined) {
    patch.display_name = updates.displayName;
  }

  if (updates.avatarUrl !== undefined) {
    patch.avatar_url = updates.avatarUrl || null;
  }

  try {
    const { data, error } = await client
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .maybeSingle();

    if (error || !data) {
      logError('updateUserProfile', error);
      return { profile: null, error: error?.message ?? 'Failed to update profile.' };
    }

    return { profile: toUserProfile(data as ProfileRow), error: null };
  } catch (error) {
    logError('updateUserProfile', error);
    return { profile: null, error: error instanceof Error ? error.message : 'Failed to update profile.' };
  }
}
