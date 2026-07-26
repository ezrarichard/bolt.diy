import type { VerificationEvidence } from '~/lib/deployment/verificationTypes';

/**
 * Verification Evidence Redaction — Sprint 92, Parts 4/10/19/24.
 *
 * Verification evidence is persisted to BuildersDB and rendered in the dashboard, so it must never
 * carry a credential. The engine already only ever writes controlled values (status codes, URLs,
 * header NAMES, durations) — this module is the defence-in-depth layer applied to every value on
 * the way out, so a future check that accidentally passes a raw response through cannot leak one.
 *
 * Three rules:
 *  1. Any query-string parameter whose name looks credential-bearing is replaced in URLs — a
 *     token must never survive in a `target`/`finalUrl`.
 *  2. Any value that structurally looks like a JWT / long opaque key is replaced wholesale.
 *  3. Every string is length-bounded, so a response body can never be smuggled in as "evidence".
 */

const MAX_EVIDENCE_STRING_LENGTH = 300;

const SENSITIVE_PARAM_NAMES =
  /^(apikey|api_key|access_token|refresh_token|token|key|secret|password|pwd|auth|authorization|signature|sig|code|session|jwt)$/i;

/** A JWT (Supabase anon/service keys are JWTs) or any long opaque secret-shaped blob. */
const CREDENTIAL_SHAPED =
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|(sb|sk|pk|ghp|gho|ghs|vercel)_[A-Za-z0-9_-]{16,})\b/g;

export const REDACTED = '[redacted]';

/** Strips credential-bearing query parameters from a URL, leaving the rest legible. Non-URL input is returned unchanged (after the generic scrub). */
export function redactUrl(raw: string): string {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return scrubCredentials(raw);
  }

  let changed = false;

  for (const name of [...url.searchParams.keys()]) {
    if (SENSITIVE_PARAM_NAMES.test(name)) {
      url.searchParams.set(name, REDACTED);
      changed = true;
    }
  }

  if (url.username || url.password) {
    url.username = '';
    url.password = '';
    changed = true;
  }

  return scrubCredentials(changed ? url.toString() : raw);
}

function scrubCredentials(value: string): string {
  return value.replace(CREDENTIAL_SHAPED, REDACTED);
}

export function redactEvidenceValue(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value !== 'string') {
    return value;
  }

  const scrubbed = /^https?:\/\//i.test(value.trim()) ? redactUrl(value.trim()) : scrubCredentials(value);

  return scrubbed.length > MAX_EVIDENCE_STRING_LENGTH ? `${scrubbed.slice(0, MAX_EVIDENCE_STRING_LENGTH)}…` : scrubbed;
}

export function redactEvidence(evidence: VerificationEvidence): VerificationEvidence {
  const result: VerificationEvidence = {};

  for (const [key, value] of Object.entries(evidence)) {
    result[key] = redactEvidenceValue(value);
  }

  return result;
}
