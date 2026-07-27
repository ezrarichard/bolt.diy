/**
 * Structured repository errors — Sprint 98A, BUG-010.
 *
 * WHAT WENT WRONG. Acceptance Test Round 1's only signal that all manifest persistence had failed
 * was this console line:
 *
 *     [ApplicationManifest] saveApplicationManifest() failed: [object Object]
 *
 * A PostgrestError is a plain object, not an `Error`. Passing it to `console.error` as a second
 * argument renders it as `[object Object]` in captured logs, discarding the four fields that would
 * have identified the problem instantly — `code` (`42703`), `message` ("column ... does not
 * exist"), `details` and `hint`. Diagnosing a five-minute outage took an hour of probing because
 * the error had already been thrown away.
 *
 * WHAT THIS DOES. Flattens any error shape into one readable line that always carries the Postgres
 * code, and exposes the same information as structured fields for callers that surface failures in
 * the UI. Nothing is inferred: a field that isn't present isn't invented.
 */

export interface StructuredError {
  /** Postgres SQLSTATE or PostgREST code (`42703`, `PGRST205`, `23505`) when the driver supplied one. */
  code?: string;
  message: string;
  details?: string;
  hint?: string;

  /** The single line safe to log. Always populated. */
  summary: string;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Total: every input produces a usable result, including `null`, a string, an `Error`, or a
 * PostgrestError. Never throws — an error formatter that can itself fail is worthless in a catch
 * block.
 */
export function toStructuredError(error: unknown): StructuredError {
  if (error instanceof Error) {
    return { message: error.message, summary: error.message };
  }

  if (typeof error === 'string') {
    return { message: error, summary: error };
  }

  if (typeof error === 'object' && error !== null) {
    const source = error as Record<string, unknown>;
    const code = readString(source, 'code');
    const message = readString(source, 'message') ?? 'Unknown error';
    const details = readString(source, 'details');
    const hint = readString(source, 'hint');

    /* Code first — it is the field that identifies the failure class fastest (42703 = missing column). */
    const parts = [code ? `[${code}]` : undefined, message, details, hint ? `hint: ${hint}` : undefined].filter(
      Boolean,
    );

    return { code, message, details, hint, summary: parts.join(' — ') };
  }

  return { message: 'Unknown error', summary: 'Unknown error' };
}

/** The one-line form, for logs and thrown `Error` messages. */
export function formatError(error: unknown): string {
  return toStructuredError(error).summary;
}

/**
 * True when the error means "this build expects schema the database does not have" — the BUG-008
 * class. Callers use it to point the operator at a migration instead of a generic retry.
 */
export function isSchemaError(error: unknown): boolean {
  const { code } = toStructuredError(error);
  return code === '42703' || code === '42P01' || code === 'PGRST205' || code === 'PGRST204';
}

/** An operator-facing sentence for a schema error, or undefined when the error is something else. */
export function describeSchemaError(error: unknown): string | undefined {
  if (!isSchemaError(error)) {
    return undefined;
  }

  const { summary } = toStructuredError(error);

  return `${summary}. This means BuildersDB is missing schema this build requires — apply outstanding migrations with \`supabase db push\` and try again.`;
}
