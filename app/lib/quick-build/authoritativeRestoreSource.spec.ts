import { describe, expect, it } from 'vitest';
import { shouldSkipLegacyFileRestore } from './authoritativeRestoreSource';

describe('shouldSkipLegacyFileRestore', () => {
  it('skips legacy restore when a quick_build project has a non-empty BuildersDB snapshot', () => {
    expect(
      shouldSkipLegacyFileRestore({ projectType: 'quick_build' }, true, { fileCount: 13, generatedAt: null }),
    ).toBe(true);
  });

  it('falls back to legacy restore when no BuildersDB snapshot exists yet', () => {
    expect(shouldSkipLegacyFileRestore({ projectType: 'quick_build' }, true, null)).toBe(false);
  });

  it('falls back to legacy restore when the snapshot exists but has zero files', () => {
    expect(shouldSkipLegacyFileRestore({ projectType: 'quick_build' }, true, { fileCount: 0, generatedAt: null })).toBe(
      false,
    );
  });

  it('falls back to legacy restore when BuildersDB is unavailable, even with snapshot metadata', () => {
    expect(
      shouldSkipLegacyFileRestore({ projectType: 'quick_build' }, false, { fileCount: 13, generatedAt: null }),
    ).toBe(false);
  });

  it('never skips legacy restore for Guided Engineering — unaffected by this sprint', () => {
    expect(
      shouldSkipLegacyFileRestore({ projectType: 'guided_engineering' }, true, { fileCount: 13, generatedAt: null }),
    ).toBe(false);
  });

  it('never skips legacy restore when there is no linked project at all', () => {
    expect(shouldSkipLegacyFileRestore(undefined, true, { fileCount: 13, generatedAt: null })).toBe(false);
  });
});
