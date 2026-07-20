import { computeFileChecksum } from './generatedFilesRepository';
import type { FileConflict, FileOwnership, RecommendedFileAction } from './generatedFileTypes';

/**
 * File Ownership & Customer-Edit Protection — Sprint 49.
 *
 * Pure decision logic only — no BuildersDB access, no WebContainer access. Everything
 * here is a plain function of already-known values (a checksum, an ownership string, a
 * boolean), which is deliberate: the actual READS (live WebContainer content via
 * `readGeneratedFileFromWebContainer`) and WRITES (persisting the resulting ownership via
 * a new `generatedFilesRepository.ts` function) are both browser/BuildersDB-side concerns
 * that belong in useCodeGeneration.ts, the one place in this codebase that already talks
 * to both (see webcontainerWriter.ts's own header comment on why). Keeping this module
 * pure makes every rule here testable without mocking either dependency.
 *
 * Model (Part 5 — deliberately five states, no more):
 *  - `builders_generated` — Builders authored this file and it still matches what
 *    Builders last generated. Safe to regenerate/overwrite automatically.
 *  - `user_modified` — Builders authored this file originally, but its live content no
 *    longer matches the last generated checksum. Preserve by default; raise a conflict.
 *  - `user_owned` — created outside Builders, or explicitly handed to the customer.
 *    Preserve always unless the user explicitly authorizes replacement. STICKY: nothing
 *    in this sprint's automatic pipeline ever assigns this — it requires an explicit
 *    future action (a review UI, Sprint 50+) to set. The engine only ever RESPECTS it
 *    once set; see this file's own "Not Built This Sprint" note below.
 *  - `protected` — Builders must never overwrite it automatically, full stop. Same
 *    "engine respects it, nothing sets it automatically yet" caveat as `user_owned`.
 *  - `unknown_legacy` — predates ownership tracking entirely (every
 *    `builders_generated_application_files` row written before this sprint has
 *    `ownership: undefined`, which is treated identically to `unknown_legacy` — see
 *    `resolveOwnershipAfterEditCheck`). Deliberately NOT a permanent classification: the
 *    moment a comparison baseline (`latestChecksum`) exists and the live content matches
 *    it, this promotes to `builders_generated` — "unknown" is a bootstrap state, not a
 *    life sentence (Part 13's "conservative defaults" does not mean "conservative
 *    forever"; it means "conservative until there is evidence").
 *
 * `protected`/`user_owned` are the only STICKY states — once set, nothing in this file
 * ever downgrades them based on edit-detection evidence, by design (Part 5's own
 * definition: these require an explicit customer/user decision to change, not a
 * checksum comparison). Every other state is RE-DERIVED from evidence on every check,
 * not a one-way ratchet — a file flagged `user_modified` that later matches the last
 * generated checksum again (the customer reverted their edit, or it round-tripped back)
 * is correctly re-classified `builders_generated`, because the evidence for treating it
 * as a conflict no longer exists. This is a deliberate design choice, not an oversight —
 * "reliable detection" (Part 6) means detecting the CURRENT state, not remembering a
 * past one forever.
 */

/**
 * Sprint 49, Part 6 — deterministic content comparison (never timestamps, per this
 * sprint's own instruction). `currentContent: null` means the file doesn't exist in the
 * live workspace right now (deleted, or never written) — never itself "edited" in the
 * ownership sense; the caller (useCodeGeneration.ts) treats a missing file as a
 * different, already-handled case (nothing to preserve, nothing to conflict over).
 */
export function detectManualEdit(currentContent: string | null, lastGeneratedChecksum: string | undefined): boolean {
  if (currentContent === null || !lastGeneratedChecksum) {
    return false;
  }

  return computeFileChecksum(currentContent) !== lastGeneratedChecksum;
}

/**
 * Sprint 49, Parts 5/6/13 — the one ownership-transition rule. `hasBaseline` is whether a
 * `latestChecksum` (the last content Builders itself generated) exists to compare
 * against at all — without one, there is no evidence either way, so an existing
 * classification is kept (or `'unknown_legacy'` for a never-classified row) rather than
 * guessed at (Part 13: "do not retroactively classify legacy files as safe to overwrite
 * without evidence").
 */
export function resolveOwnershipAfterEditCheck(
  current: FileOwnership | undefined,
  edited: boolean,
  hasBaseline: boolean,
): FileOwnership {
  if (current === 'protected' || current === 'user_owned') {
    return current;
  }

  if (!hasBaseline) {
    return current ?? 'unknown_legacy';
  }

  return edited ? 'user_modified' : 'builders_generated';
}

/**
 * Sprint 49, Part 7 — the overwrite policy table. `allowAutoOverwrite: true` means
 * useCodeGeneration.ts may persist newly-generated content and write it to the
 * WebContainer as normal. `requiresConflict: true` means a `FileConflict` should be
 * recorded (Part 8) for a future review UI — distinct from `protected`/`unknown_legacy`,
 * which are preserved SILENTLY (logged as activity, Part 11, but not raised as something
 * requiring a decision — there is nothing to decide for a hard rule or an unproven
 * legacy file).
 */
export function resolveOverwritePolicy(ownership: FileOwnership): {
  allowAutoOverwrite: boolean;
  requiresConflict: boolean;
} {
  switch (ownership) {
    case 'builders_generated':
      return { allowAutoOverwrite: true, requiresConflict: false };
    case 'user_modified':
    case 'user_owned':
      return { allowAutoOverwrite: false, requiresConflict: true };
    case 'protected':
    case 'unknown_legacy':
      return { allowAutoOverwrite: false, requiresConflict: false };
    default:
      return { allowAutoOverwrite: false, requiresConflict: false };
  }
}

function recommendedActionFor(ownership: FileOwnership): RecommendedFileAction {
  switch (ownership) {
    case 'user_modified':
      return 'review_diff';
    case 'user_owned':
      return 'defer';
    default:
      return 'preserve';
  }
}

/** Sprint 49, Part 8 — constructs the reported conflict shape from already-resolved inputs; never decides policy itself (see `resolveOverwritePolicy`). */
export function buildFileConflict(input: {
  path: string;
  mvpId?: string;
  featureIds: string[];
  ownership: FileOwnership;
  existingHash?: string;
  lastGeneratedHash?: string;
  proposedOperation: FileConflict['proposedOperation'];
}): FileConflict {
  const reason =
    input.ownership === 'user_modified'
      ? 'This file was manually modified since Builders last generated it.'
      : input.ownership === 'user_owned'
        ? 'This file is marked as customer-owned and requires explicit authorization to replace.'
        : 'Builders is not permitted to overwrite this file automatically.';

  return {
    path: input.path,
    mvpId: input.mvpId,
    featureIds: input.featureIds,
    existingHash: input.existingHash,
    lastGeneratedHash: input.lastGeneratedHash,
    proposedOperation: input.proposedOperation,
    reason,
    recommendedAction: recommendedActionFor(input.ownership),
  };
}
