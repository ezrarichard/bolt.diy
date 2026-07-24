/**
 * Legacy Dark-Theme Token Guard — Sprint 70 (Legacy Dark-Theme Token Remediation).
 *
 * Sprint 69's audit found ~175 occurrences of invalid `-dark`-suffixed and otherwise dead
 * `bolt-elements-*` token references across `app/components/ui/**` — classes that compile
 * (UnoCSS doesn't fail on an unknown utility, it just emits nothing) but resolve to no CSS,
 * silently leaving the browser's native surface/text color exposed. Sprint 70 fixed every
 * occurrence found at the time; this module is the regression guard so the same class of bug
 * can't quietly return. It never inspects computed styles or renders anything — it's a pure
 * static-text scanner over component source, run from `legacyTokenGuard.spec.ts`.
 *
 * Why these specific patterns and not a general "no dead CSS class" linter: this app's theming
 * is CSS-custom-property + `[data-theme]`-attribute based (see `app/styles/variables.scss` and
 * `uno.config.ts`'s `dark: { light: '[data-theme="light"]', dark: '[data-theme="dark"]' }`
 * config) — a semantic token like `bg-bolt-elements-background-depth-1` already resolves
 * correctly in both themes on its own. There is no parallel `-dark`-suffixed token family, so
 * any `*-dark` suffix on a `bolt-elements-*` class is definitionally invalid in this codebase,
 * not just "maybe wrong" — that's what makes a narrow, purpose-built scanner viable here instead
 * of a general-purpose CSS linter.
 */

export type LegacyTokenPatternId =
  | 'dark-suffixed-token'
  | 'bare-background-token'
  | 'bare-border-token'
  | 'nonexistent-ring-token'
  | 'invalid-background-depth-0';

export interface LegacyTokenPattern {
  id: LegacyTokenPatternId;
  description: string;
  regex: RegExp;
}

/**
 * Every known-invalid pattern this guard checks for. Each `regex` must have the `g` flag so
 * `findInvalidLegacyTokenReferences` can collect every match per line, not just the first.
 */
export const LEGACY_TOKEN_PATTERNS: LegacyTokenPattern[] = [
  {
    id: 'dark-suffixed-token',
    description:
      'A `-dark`-suffixed `bolt-elements-*` token (e.g. `text-bolt-elements-textPrimary-dark`). This ' +
      "codebase's theming is attribute-based (`[data-theme]`), not a parallel `-dark` token family — " +
      'the base token already resolves correctly in both themes on its own.',
    regex: /bolt-elements-[a-zA-Z0-9.-]*-dark\b/g,
  },
  {
    id: 'bare-background-token',
    description:
      'A bare `bolt-elements-background` reference with no `-depth-N` suffix. Only ' +
      '`bolt-elements-background-depth-{1,2,3,4}` exist as real tokens (see `uno.config.ts`).',
    regex: /\bbolt-elements-background(?!-depth-[1-4]\b)\b/g,
  },
  {
    id: 'bare-border-token',
    description:
      'A bare `bolt-elements-border` reference. The real token is `bolt-elements-borderColor` ' +
      '(or `bolt-elements-borderColorActive`) — `bolt-elements-border` was never defined.',
    regex: /\bbolt-elements-border(?!Color)\b/g,
  },
  {
    id: 'nonexistent-ring-token',
    description: '`bolt-elements-ring` was never defined as a token in `uno.config.ts`.',
    regex: /\bbolt-elements-ring\b/g,
  },
  {
    id: 'invalid-background-depth-0',
    description: '`bolt-elements-background-depth-0` — only depths 1 through 4 exist.',
    regex: /\bbolt-elements-background-depth-0\b/g,
  },
];

export interface LegacyTokenMatch {
  patternId: LegacyTokenPatternId;
  match: string;
  line: number;
}

/**
 * Scans a single file's source text for every known-invalid pattern, returning one entry per
 * match with its 1-indexed line number. Pure and synchronous — takes source text, not a file
 * path, so it's trivially testable against inline fixtures (see `legacyTokenGuard.spec.ts`).
 */
export function findInvalidLegacyTokenReferences(source: string): LegacyTokenMatch[] {
  const results: LegacyTokenMatch[] = [];
  const lines = source.split('\n');

  lines.forEach((lineText, index) => {
    for (const pattern of LEGACY_TOKEN_PATTERNS) {
      pattern.regex.lastIndex = 0;

      let match: RegExpExecArray | null;

      while ((match = pattern.regex.exec(lineText)) !== null) {
        results.push({ patternId: pattern.id, match: match[0], line: index + 1 });
      }
    }
  });

  return results;
}

/**
 * Explicit allowlist for intentionally-kept occurrences that would otherwise trip a pattern
 * above — e.g. a documentation comment that quotes an invalid class name as an example of what
 * NOT to write. Keyed by file path (relative to the repo root, matching what
 * `legacyTokenGuard.spec.ts`'s glob produces) to the exact matched substrings permitted in that
 * file. Empty today: every occurrence found in Sprint 70's audit was fixed, not allowlisted.
 */
export const LEGACY_TOKEN_ALLOWLIST: Record<string, string[]> = {};

/** True when `match` for `filePath` is explicitly allowlisted above. */
export function isAllowlisted(filePath: string, match: string): boolean {
  return LEGACY_TOKEN_ALLOWLIST[filePath]?.includes(match) ?? false;
}
