import { describe, expect, it } from 'vitest';
import { describeSchemaError, formatError, isSchemaError, toStructuredError } from './structuredError';

/**
 * Sprint 98A, BUG-010.
 *
 * The regression these pin: Acceptance Test Round 1's entire diagnostic signal for a total
 * persistence outage was the string `[object Object]`. The exact PostgrestError that produced it is
 * the first test below, and its formatted output must name `42703` and `feature_ids`.
 */

/** The real error shape Supabase returned during the BUG-008 outage. */
const BUG_008_ERROR = {
  code: '42703',
  message: 'column builders_application_manifest_files.feature_ids does not exist',
  details: null,
  hint: null,
};

describe('toStructuredError', () => {
  it('never renders a PostgrestError as [object Object]', () => {
    const summary = formatError(BUG_008_ERROR);

    expect(summary).not.toContain('[object Object]');
    expect(summary).toContain('42703');
    expect(summary).toContain('feature_ids');
  });

  it('extracts every field a PostgrestError carries', () => {
    const structured = toStructuredError({
      code: 'PGRST205',
      message: 'Could not find the table',
      details: 'searched public schema',
      hint: 'Perhaps you meant builders_projects',
    });

    expect(structured).toMatchObject({
      code: 'PGRST205',
      message: 'Could not find the table',
      details: 'searched public schema',
      hint: 'Perhaps you meant builders_projects',
    });
    expect(structured.summary).toContain('[PGRST205]');
    expect(structured.summary).toContain('hint:');
  });

  it('handles an Error instance', () => {
    expect(toStructuredError(new Error('boom'))).toMatchObject({ message: 'boom', summary: 'boom' });
  });

  it('handles a bare string', () => {
    expect(toStructuredError('plain failure').summary).toBe('plain failure');
  });

  it('never throws on null, undefined or a primitive', () => {
    expect(toStructuredError(null).summary).toBe('Unknown error');
    expect(toStructuredError(undefined).summary).toBe('Unknown error');
    expect(toStructuredError(42).summary).toBe('Unknown error');
  });

  it('ignores empty and whitespace-only fields rather than emitting dangling separators', () => {
    const structured = toStructuredError({ code: '  ', message: 'real message', details: '', hint: '   ' });

    expect(structured.code).toBeUndefined();
    expect(structured.summary).toBe('real message');
  });

  it('falls back to a usable message when the object has no message field', () => {
    expect(toStructuredError({ code: '23505' }).summary).toContain('23505');
  });
});

describe('isSchemaError', () => {
  it('recognises the drift codes', () => {
    expect(isSchemaError(BUG_008_ERROR)).toBe(true);
    expect(isSchemaError({ code: '42P01' })).toBe(true);
    expect(isSchemaError({ code: 'PGRST205' })).toBe(true);
    expect(isSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  it('does not misclassify unrelated failures', () => {
    expect(isSchemaError({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isSchemaError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isSchemaError(new Error('network down'))).toBe(false);
  });
});

describe('describeSchemaError', () => {
  it('tells the operator to apply migrations', () => {
    const description = describeSchemaError(BUG_008_ERROR);

    expect(description).toContain('feature_ids');
    expect(description).toContain('supabase db push');
  });

  it('returns undefined for a non-schema error, so callers do not mislabel it', () => {
    expect(describeSchemaError({ code: '23505', message: 'duplicate key' })).toBeUndefined();
  });
});
