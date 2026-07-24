import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'fast-glob';
import { findInvalidLegacyTokenReferences, isAllowlisted, LEGACY_TOKEN_PATTERNS } from './legacyTokenGuard';

describe('findInvalidLegacyTokenReferences — pattern self-test (representative bad/good tokens)', () => {
  it('catches a `-dark`-suffixed token', () => {
    const matches = findInvalidLegacyTokenReferences(
      'text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary-dark',
    );
    expect(matches.some((m) => m.patternId === 'dark-suffixed-token')).toBe(true);
  });

  it('catches a bare `bolt-elements-background` reference', () => {
    const matches = findInvalidLegacyTokenReferences('bg-bolt-elements-background text-white');
    expect(matches.some((m) => m.patternId === 'bare-background-token')).toBe(true);
  });

  it('catches a bare `bolt-elements-border` reference', () => {
    const matches = findInvalidLegacyTokenReferences('border border-bolt-elements-border');
    expect(matches.some((m) => m.patternId === 'bare-border-token')).toBe(true);
  });

  it('catches `bolt-elements-ring`', () => {
    const matches = findInvalidLegacyTokenReferences('focus-visible:ring-bolt-elements-ring');
    expect(matches.some((m) => m.patternId === 'nonexistent-ring-token')).toBe(true);
  });

  it('catches `background-depth-0`', () => {
    const matches = findInvalidLegacyTokenReferences('data-[state=active]:bg-bolt-elements-background-depth-0');
    expect(matches.some((m) => m.patternId === 'invalid-background-depth-0')).toBe(true);
  });

  it('ignores a valid depth-suffixed background token', () => {
    const matches = findInvalidLegacyTokenReferences(
      'bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-3',
    );
    expect(matches).toEqual([]);
  });

  it('ignores a valid `borderColor`/`borderColorActive` token', () => {
    const matches = findInvalidLegacyTokenReferences(
      'border border-bolt-elements-borderColor dark:border-bolt-elements-borderColorActive',
    );
    expect(matches).toEqual([]);
  });

  it('ignores a non-bolt-elements `dark:` variant on a plain Tailwind color (e.g. purple, green)', () => {
    const matches = findInvalidLegacyTokenReferences(
      'bg-purple-500/10 dark:bg-purple-500/20 text-green-600 dark:text-green-400',
    );
    expect(matches).toEqual([]);
  });

  it('ignores a valid Builders semantic token', () => {
    const matches = findInvalidLegacyTokenReferences(
      'bg-builders-surface-elevated text-builders-text-primary focus-visible:ring-builders-border-focus',
    );
    expect(matches).toEqual([]);
  });

  it('reports the correct 1-indexed line number', () => {
    const source = ['line one is fine', 'text-bolt-elements-textPrimary-dark', 'line three is fine'].join('\n');
    const matches = findInvalidLegacyTokenReferences(source);
    expect(matches).toEqual([{ patternId: 'dark-suffixed-token', match: 'bolt-elements-textPrimary-dark', line: 2 }]);
  });
});

describe('isAllowlisted', () => {
  it('is false for anything not explicitly listed', () => {
    expect(isAllowlisted('app/components/ui/Button.tsx', 'bolt-elements-ring')).toBe(false);
  });
});

describe('legacy dark-theme token guard — real source scan (Sprint 70)', () => {
  const files = globSync('app/components/ui/**/*.{ts,tsx}', {
    cwd: process.cwd(),

    /*
     * legacyTokenGuard.ts itself is excluded — its own doc comments quote invalid patterns as
     * examples of what NOT to write, which would otherwise trip the scanner on itself.
     */
    ignore: ['**/*.spec.ts', '**/*.spec.tsx', '**/legacyTokenGuard.ts'],
  });

  it('found at least one real file to scan (guards against an accidentally-empty glob)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('contains no unresolved legacy `-dark`/invalid token references outside the explicit allowlist', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const matches = findInvalidLegacyTokenReferences(source);

      for (const match of matches) {
        if (isAllowlisted(file, match.match)) {
          continue;
        }

        offenders.push(`${file}:${match.line} — [${match.patternId}] ${match.match}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every LEGACY_TOKEN_PATTERNS entry has the global flag set (required for per-line multi-match scanning)', () => {
    for (const pattern of LEGACY_TOKEN_PATTERNS) {
      expect(pattern.regex.global, `${pattern.id} must have the 'g' flag`).toBe(true);
    }
  });
});
