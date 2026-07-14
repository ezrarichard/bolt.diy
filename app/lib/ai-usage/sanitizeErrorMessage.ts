const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * AI Usage Ledger — Sprint 42.2.
 *
 * The one place every `errorMessage` passed to recordAiUsage() is cleaned before it reaches
 * `builders_ai_usage_events.error_message` — never duplicated per call site. Two independent
 * protections, since the length limit alone doesn't help if the sensitive part is near the
 * start of a short message:
 *  - Redacts anything that LOOKS like a bearer token / API key / long opaque credential
 *    (`Bearer <token>`, `sk-...`, `key=...`, or any bare run of 20+ token characters) BEFORE
 *    truncating, so a provider SDK error that happens to echo a key back (some do, e.g.
 *    "Invalid API key: sk-ant-...") never reaches storage even in a shortened form.
 *  - Truncates to MAX_ERROR_MESSAGE_LENGTH, matching the DB's own
 *    builders_ai_usage_events_error_message_length_check constraint (see the migration) —
 *    this is the app-side copy of that same limit, not a substitute for it.
 *
 * This only ever receives `error.message`-style short descriptions (see recordAiUsage.ts's
 * callers) — never a raw prompt, response body, header, or cookie; those are simply never
 * passed in to begin with (see the sprint's DO NOT STORE list).
 */
export function sanitizeErrorMessage(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }

  const redacted = message
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(sk|pk|key|token|api[_-]?key)[-_=:\s]+[a-z0-9_\-.]{8,}/gi, '$1=[redacted]')
    .replace(/\b[a-zA-Z0-9_\-]{20,}\b/g, '[redacted]');

  return redacted.length > MAX_ERROR_MESSAGE_LENGTH ? `${redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…` : redacted;
}
