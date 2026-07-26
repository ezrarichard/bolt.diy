import { describe, expect, it } from 'vitest';
import { redactEvidence, redactEvidenceValue, redactUrl, REDACTED } from './verificationRedaction';

describe('redactUrl', () => {
  it('leaves an ordinary deployment URL untouched', () => {
    expect(redactUrl('https://app-abc123.vercel.app/about')).toBe('https://app-abc123.vercel.app/about');
  });

  it('strips credential-bearing query parameters', () => {
    expect(redactUrl('https://project.supabase.co/rest/v1/?apikey=eyJhbGciOi.abcdefghij.signature')).toContain(
      `apikey=${encodeURIComponent(REDACTED)}`,
    );
  });

  it('strips embedded basic-auth credentials', () => {
    expect(redactUrl('https://user:hunter2@app.vercel.app/')).not.toContain('hunter2');
  });
});

describe('redactEvidenceValue', () => {
  it('passes through numbers and booleans', () => {
    expect(redactEvidenceValue(200)).toBe(200);
    expect(redactEvidenceValue(true)).toBe(true);
    expect(redactEvidenceValue(null)).toBeNull();
  });

  it('replaces a JWT-shaped value anywhere in a string', () => {
    const value = redactEvidenceValue('token was eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdef123 rejected');

    expect(value).toContain(REDACTED);
    expect(value).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('replaces provider-prefixed key shapes', () => {
    expect(redactEvidenceValue('sb_secret_abcdefghijklmnop1234')).toContain(REDACTED);
    expect(redactEvidenceValue('ghp_abcdefghijklmnopqrstuvwxyz01')).toContain(REDACTED);
  });

  it('bounds string length so a response body can never be smuggled in as evidence', () => {
    const value = redactEvidenceValue('x'.repeat(5000)) as string;

    expect(value.length).toBeLessThanOrEqual(301);
  });
});

describe('redactEvidence', () => {
  it('redacts every value in the map', () => {
    const evidence = redactEvidence({
      status: 500,
      finalUrl: 'https://project.supabase.co/rest/v1/?apikey=eyJhbGciOi.abcdefghij.sig',
      note: 'ok',
    });

    expect(evidence.status).toBe(500);
    expect(String(evidence.finalUrl)).not.toContain('eyJhbGciOi.abcdefghij.sig');
    expect(evidence.note).toBe('ok');
  });
});
