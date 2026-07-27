import { describe, expect, it } from 'vitest';
import {
  classifyVersionChange,
  compareSemanticVersions,
  formatSemanticVersion,
  parseSemanticVersion,
  suggestNextVersion,
  validateReleaseVersion,
} from './semanticVersion';

describe('parseSemanticVersion', () => {
  it('parses MAJOR.MINOR.PATCH, with or without a leading v', () => {
    expect(parseSemanticVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemanticVersion('v10.0.1')).toEqual({ major: 10, minor: 0, patch: 1 });
    expect(parseSemanticVersion('  0.0.0  ')).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it('rejects anything that is not a strict three-part version', () => {
    for (const raw of ['1.0', '1', 'v1', '1.0.0-beta', '1.0.0+build', 'one.two.three', '', '  ', null, undefined]) {
      expect(parseSemanticVersion(raw)).toBeNull();
    }
  });

  it('round-trips through format', () => {
    expect(formatSemanticVersion(parseSemanticVersion('v2.3.4')!)).toBe('2.3.4');
  });
});

describe('compareSemanticVersions', () => {
  it('orders by major, then minor, then patch', () => {
    const v = (raw: string) => parseSemanticVersion(raw)!;

    expect(compareSemanticVersions(v('1.0.0'), v('2.0.0'))).toBeLessThan(0);
    expect(compareSemanticVersions(v('1.2.0'), v('1.1.9'))).toBeGreaterThan(0);
    expect(compareSemanticVersions(v('1.1.1'), v('1.1.1'))).toBe(0);
    expect(compareSemanticVersions(v('1.0.10'), v('1.0.9'))).toBeGreaterThan(0);
  });
});

describe('suggestNextVersion', () => {
  it('suggests 1.0.0 for a first release regardless of type', () => {
    expect(suggestNextVersion(undefined, 'patch')).toBe('1.0.0');
    expect(suggestNextVersion(null, 'minor')).toBe('1.0.0');
    expect(suggestNextVersion('not-a-version', 'major')).toBe('1.0.0');
  });

  it('increments the right component and resets the lower ones', () => {
    expect(suggestNextVersion('1.4.7', 'major')).toBe('2.0.0');
    expect(suggestNextVersion('1.4.7', 'minor')).toBe('1.5.0');
    expect(suggestNextVersion('1.4.7', 'patch')).toBe('1.4.8');
  });
});

describe('classifyVersionChange', () => {
  it('classifies what a proposed version actually is', () => {
    expect(classifyVersionChange('1.0.0', '2.0.0')).toBe('major');
    expect(classifyVersionChange('1.0.0', '1.1.0')).toBe('minor');
    expect(classifyVersionChange('1.0.0', '1.0.1')).toBe('patch');
  });

  it('treats a first release as major', () => {
    expect(classifyVersionChange(undefined, '1.0.0')).toBe('major');
  });

  it('returns null when the version does not move forward', () => {
    expect(classifyVersionChange('2.0.0', '1.9.9')).toBeNull();
    expect(classifyVersionChange('1.0.0', '1.0.0')).toBeNull();
  });
});

describe('validateReleaseVersion', () => {
  it('accepts an explicit forward version and normalises it', () => {
    const result = validateReleaseVersion({ version: 'v1.1.0', intendedType: 'minor', previousVersion: '1.0.0' });

    expect(result).toMatchObject({ ok: true, version: '1.1.0', actualType: 'minor', matchesIntent: true });
  });

  it('accepts a version whose type differs from the stated intent, and flags the mismatch', () => {
    const result = validateReleaseVersion({ version: '2.0.0', intendedType: 'minor', previousVersion: '1.0.0' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.actualType).toBe('major');
    expect(result.ok && result.matchesIntent).toBe(false);
  });

  it('rejects a missing version — nothing is ever auto-filled at this layer', () => {
    expect(validateReleaseVersion({ version: '', intendedType: 'minor' })).toMatchObject({
      ok: false,
      code: 'missing',
    });
    expect(validateReleaseVersion({ version: '   ', intendedType: 'minor' })).toMatchObject({ ok: false });
  });

  it('rejects a malformed version with an actionable message', () => {
    const result = validateReleaseVersion({ version: '1.0', intendedType: 'patch' });

    expect(result).toMatchObject({ ok: false, code: 'malformed' });
    expect(result.ok === false && result.message).toMatch(/MAJOR\.MINOR\.PATCH/);
  });

  it('rejects a version that does not move forward', () => {
    expect(validateReleaseVersion({ version: '1.0.0', intendedType: 'patch', previousVersion: '1.2.0' })).toMatchObject(
      { ok: false, code: 'not_greater' },
    );
  });

  it('rejects a duplicate version (Part 14)', () => {
    const result = validateReleaseVersion({
      version: '1.1.0',
      intendedType: 'minor',
      previousVersion: '1.0.0',
      existingVersions: ['1.0.0', '1.1.0'],
    });

    expect(result).toMatchObject({ ok: false, code: 'duplicate' });
  });

  it('normalises before checking for duplicates, so v1.1.0 cannot sneak past 1.1.0', () => {
    expect(
      validateReleaseVersion({
        version: 'v1.1.0',
        intendedType: 'minor',
        previousVersion: '1.0.0',
        existingVersions: ['1.1.0'],
      }),
    ).toMatchObject({ ok: false, code: 'duplicate' });
  });

  it('accepts any forward version for a first release', () => {
    expect(validateReleaseVersion({ version: '0.1.0', intendedType: 'minor' })).toMatchObject({ ok: true });
    expect(validateReleaseVersion({ version: '1.0.0', intendedType: 'major' })).toMatchObject({ ok: true });
  });
});
