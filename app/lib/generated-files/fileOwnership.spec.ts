import { describe, expect, it } from 'vitest';
import { computeFileChecksum } from './generatedFilesRepository';
import {
  buildFileConflict,
  detectManualEdit,
  resolveOverwritePolicy,
  resolveOwnershipAfterEditCheck,
} from './fileOwnership';

describe('detectManualEdit', () => {
  it('is false when current content matches the last generated checksum', () => {
    const content = 'export const x = 1;';
    expect(detectManualEdit(content, computeFileChecksum(content))).toBe(false);
  });

  it('is true when current content diverges from the last generated checksum', () => {
    expect(detectManualEdit('edited by hand', computeFileChecksum('original'))).toBe(true);
  });

  it('is false when the file does not exist in the live workspace (nothing to compare)', () => {
    expect(detectManualEdit(null, computeFileChecksum('original'))).toBe(false);
  });

  it('is false when there is no baseline checksum at all', () => {
    expect(detectManualEdit('anything', undefined)).toBe(false);
  });
});

describe('resolveOwnershipAfterEditCheck', () => {
  it('is sticky for protected — never downgraded by edit evidence', () => {
    expect(resolveOwnershipAfterEditCheck('protected', true, true)).toBe('protected');
    expect(resolveOwnershipAfterEditCheck('protected', false, true)).toBe('protected');
  });

  it('is sticky for user_owned — never downgraded by edit evidence', () => {
    expect(resolveOwnershipAfterEditCheck('user_owned', false, true)).toBe('user_owned');
  });

  it('promotes an unclassified/legacy row to builders_generated when unchanged and a baseline exists', () => {
    expect(resolveOwnershipAfterEditCheck(undefined, false, true)).toBe('builders_generated');
    expect(resolveOwnershipAfterEditCheck('unknown_legacy', false, true)).toBe('builders_generated');
  });

  it('flags user_modified when content diverges and a baseline exists', () => {
    expect(resolveOwnershipAfterEditCheck('builders_generated', true, true)).toBe('user_modified');
  });

  it('re-derives from evidence, not a one-way ratchet — a reverted edit demotes back to builders_generated', () => {
    expect(resolveOwnershipAfterEditCheck('user_modified', false, true)).toBe('builders_generated');
  });

  it('keeps the current (or unknown_legacy) classification when there is no baseline to compare against — no evidence either way', () => {
    expect(resolveOwnershipAfterEditCheck(undefined, false, false)).toBe('unknown_legacy');
    expect(resolveOwnershipAfterEditCheck('builders_generated', false, false)).toBe('builders_generated');
  });
});

describe('resolveOverwritePolicy — Part 7 overwrite table', () => {
  it('builders_generated: auto-overwrite allowed, no conflict', () => {
    expect(resolveOverwritePolicy('builders_generated')).toEqual({ allowAutoOverwrite: true, requiresConflict: false });
  });

  it('user_modified: no auto-overwrite, raises a conflict', () => {
    expect(resolveOverwritePolicy('user_modified')).toEqual({ allowAutoOverwrite: false, requiresConflict: true });
  });

  it('user_owned: no auto-overwrite, raises a conflict', () => {
    expect(resolveOverwritePolicy('user_owned')).toEqual({ allowAutoOverwrite: false, requiresConflict: true });
  });

  it('protected: no auto-overwrite, no conflict (nothing to decide — a hard rule)', () => {
    expect(resolveOverwritePolicy('protected')).toEqual({ allowAutoOverwrite: false, requiresConflict: false });
  });

  it('unknown_legacy: no auto-overwrite, no conflict (preserved conservatively, not raised for review)', () => {
    expect(resolveOverwritePolicy('unknown_legacy')).toEqual({ allowAutoOverwrite: false, requiresConflict: false });
  });
});

describe('buildFileConflict', () => {
  it('recommends reviewing the diff for a manually-modified file', () => {
    const conflict = buildFileConflict({
      path: 'src/pages/Appointments.tsx',
      mvpId: 'mvp-2',
      featureIds: ['FEAT-003'],
      ownership: 'user_modified',
      existingHash: 'abc',
      lastGeneratedHash: 'def',
      proposedOperation: 'modify',
    });

    expect(conflict.recommendedAction).toBe('review_diff');
    expect(conflict.reason).toMatch(/manually modified/);
    expect(conflict.featureIds).toEqual(['FEAT-003']);
  });

  it('recommends deferring for a customer-owned file', () => {
    const conflict = buildFileConflict({
      path: 'src/lib/custom.ts',
      featureIds: [],
      ownership: 'user_owned',
      proposedOperation: 'modify',
    });

    expect(conflict.recommendedAction).toBe('defer');
  });
});
