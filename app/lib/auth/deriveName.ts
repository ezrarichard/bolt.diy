import type { User } from '@supabase/supabase-js';

/**
 * Sprint 41.2 — sidebar/header greeting.
 *
 * Prefers any first-name-shaped field in Supabase `user_metadata` (settable via the
 * Dashboard's "Add User" → User Metadata field — see the Sprint 40 report's manual user
 * creation step). Falls back to the email's local-part, split on common separators
 * (`.`, `_`, `-`, `+`, digits) — e.g. "ezra.richard@gmail.com" -> "Ezra". When the local-part
 * has no separator at all (e.g. "ezrarichard@gmail.com"), there is no reliable way to find a
 * name boundary inside a concatenated string without a name dictionary, so the whole
 * local-part is used as one word ("Ezrarichard") rather than guessing.
 */

function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function deriveFirstName(user: Pick<User, 'email' | 'user_metadata'> | null | undefined): string | null {
  const metadata = user?.user_metadata as Record<string, unknown> | undefined;

  const metadataName =
    (metadata?.first_name as string | undefined) ||
    (metadata?.given_name as string | undefined) ||
    (metadata?.full_name as string | undefined) ||
    (metadata?.name as string | undefined);

  if (typeof metadataName === 'string' && metadataName.trim()) {
    return capitalize(metadataName.trim().split(/\s+/)[0]);
  }

  const email = user?.email;

  if (!email) {
    return null;
  }

  const localPart = email.split('@')[0];
  const [firstSegment] = localPart.split(/[._\-+0-9]+/).filter(Boolean);

  return firstSegment ? capitalize(firstSegment) : null;
}
