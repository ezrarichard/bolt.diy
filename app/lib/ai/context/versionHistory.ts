import { buildersDbRepository, isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import { estimateTokens } from '~/lib/projects/contextEngine';
import { formatArtifactTimestamp, parseArtifactContent, type ProjectArtifact } from '~/lib/projects/artifacts';
import { ROLE_ARTIFACT_CHAIN } from '~/lib/projects/collaborationContext';
import { humanizeFieldKey } from './buildersDbContextProvider';

/**
 * Version History, Change Summaries & Context Preview — Sprint 36.
 *
 * Builds on Sprint 34/35's `builders_role_outputs` (now genuinely one row per version —
 * see supabase/migrations/20260707090000_sprint36_knowledge_memory.sql and
 * buildersDbRepository.ts's `getRoleVersionHistory`/`getLatestApproved`/`getLatestDraft`)
 * to answer three things Sprint 35 couldn't: what did earlier versions look like, what
 * changed between them, and — across a whole project — what's the current
 * approved-or-latest state of every role at a glance. Nothing here talks to Supabase
 * directly; every function goes through `buildersDbRepository`, same as
 * app/lib/ai/context/buildersDbContextProvider.ts.
 *
 * Deliberately presentation/read-only: nothing here writes to BuildersDB or changes
 * generation behavior. `buildRoleContextBlock` (buildersDbContextProvider.ts) is
 * unaffected by this file — this is for debugging/future-UI consumption (requirement
 * #6's "mainly for future UI... a backend/helper implementation is sufficient").
 */

// ── Context size management (requirement #8) ────────────────────────────

/**
 * Token-budgeted ordering/truncation over an already-built list of labeled text
 * sections, in priority order (first = most important, trimmed last). Mirrors
 * app/lib/projects/contextEngine.ts's own budget-trim loop (same "running total, stop
 * once the next section would exceed the limit" shape) rather than inventing a
 * different algorithm — reused here for role-output/task sections instead of
 * contextEngine's full `ContextBundle` sections. Deliberately minimal: no summarization,
 * just prioritization + truncation, exactly what requirement #8 asks for ("do not
 * over-engineer").
 */
export function applyContextBudget<T extends { label: string; content: string }>(
  sections: T[],
  budgetTokens: number,
): { included: T[]; excluded: { label: string; reason: string }[] } {
  const included: T[] = [];
  const excluded: { label: string; reason: string }[] = [];
  let runningTotal = 0;

  for (const section of sections) {
    const tokens = estimateTokens(section.content);

    if (runningTotal + tokens <= budgetTokens) {
      included.push(section);
      runningTotal += tokens;
    } else {
      excluded.push({ label: section.label, reason: `Excluded to stay within the ${budgetTokens}-token budget.` });
    }
  }

  return { included, excluded };
}

// ── Version history ───────────────────────────────────────────────────────

export interface VersionHistoryEntry {
  version: number;
  status: ProjectArtifact['status'];
  updatedAt: string;
  generatedBy?: string;
}

/** Thin re-export of the repository's read — kept here (rather than requiring every caller to import buildersDbRepository directly) so this file is the one-stop-shop for "everything about a role's version timeline". Empty array whenever BuildersDB is unavailable, same fallback contract as buildersDbContextProvider.ts. */
export async function getRoleVersionHistory(projectId: string, roleKey: string): Promise<ProjectArtifact[]> {
  if (!isBuildersDbAvailable()) {
    return [];
  }

  return buildersDbRepository.getRoleVersionHistory(projectId, roleKey);
}

/** Requirement #5 — the version to treat as "active": the latest approved one, or the latest draft if nothing's been approved yet. Same rule buildersDbContextProvider.ts's `getPreferredRoleOutputs` already applies during context retrieval; exposed here as a single-role convenience for version-history/preview callers that don't need the whole project's context. */
export async function getActiveVersion(projectId: string, roleKey: string): Promise<ProjectArtifact | null> {
  if (!isBuildersDbAvailable()) {
    return null;
  }

  const approved = await buildersDbRepository.getLatestApproved(projectId, roleKey);

  return approved ?? buildersDbRepository.getLatestDraft(projectId, roleKey);
}

/** Formats one role's version list for a human-readable preview — requirement #6's example format ("Business Analyst / Version 3 / Approved / Updated: ..."). */
export function formatVersionHistoryForPreview(roleLabel: string, versions: ProjectArtifact[]): string {
  if (versions.length === 0) {
    return `${roleLabel}\nNo versions yet.`;
  }

  const sorted = [...versions].sort((a, b) => (b.version ?? 0) - (a.version ?? 0));

  const lines = sorted.map((entry) => {
    const statusLabel = entry.status === 'approved' ? 'Approved' : entry.status;
    return `Version ${entry.version ?? 1} — ${statusLabel}\nUpdated: ${formatArtifactTimestamp(entry.updatedAt)}`;
  });

  return `${roleLabel}\n${lines.join('\n\n')}`;
}

/**
 * Requirement #6 — "Context Preview": a readable snapshot of every pipeline role's
 * current version state for a project, in pipeline order. Fetches every role's version
 * history in parallel; a role with no versions yet still gets its own "No versions yet."
 * line rather than being silently omitted, so the preview always shows the full
 * pipeline shape.
 */
export async function buildContextPreview(projectId: string): Promise<string> {
  if (!isBuildersDbAvailable()) {
    return 'BuildersDB is not configured — no persistent context to preview.';
  }

  try {
    const perRole = await Promise.all(
      ROLE_ARTIFACT_CHAIN.map(async ({ type, role }) => {
        const versions = await buildersDbRepository.getRoleVersionHistory(projectId, type);
        return formatVersionHistoryForPreview(role, versions);
      }),
    );

    return `Persistent Context\n\n${perRole.join('\n\n')}`;
  } catch (error) {
    console.error('[BuildersDB Context] buildContextPreview failed:', error);
    return 'Context preview unavailable (BuildersDB read failed).';
  }
}

// ── Change summaries (requirement #7) ────────────────────────────────────

/** Set-difference between two string lists — the only "diff" requirement #7 asks for ("keep this simple, large AI summarisation unnecessary"). */
function diffListField(
  previous: string[] | undefined,
  current: string[] | undefined,
): { added: string[]; removed: string[] } {
  const previousSet = new Set(previous ?? []);
  const currentSet = new Set(current ?? []);

  return {
    added: (current ?? []).filter((item) => !previousSet.has(item)),
    removed: (previous ?? []).filter((item) => !currentSet.has(item)),
  };
}

/**
 * Lightweight version-to-version diff: for list fields (coreFeatures, applicationModules,
 * ...), reports added/removed items; for any other changed field, just names it as
 * changed rather than diffing free text. Skips `engineeringNotes`/`aiDecisions` — same
 * reasoning as buildersDbContextProvider.ts's content formatter, they're their own
 * dedicated section elsewhere, not something a change summary should re-describe.
 */
export function summarizeVersionChange(
  roleLabel: string,
  previous: ProjectArtifact | undefined,
  current: ProjectArtifact,
): string {
  const header = `${roleLabel} v${current.version ?? 1}`;

  if (!previous) {
    return `${header}\nInitial version — no prior version to compare.`;
  }

  const previousContent = parseArtifactContent<Record<string, unknown>>(previous.content) ?? {};
  const currentContent = parseArtifactContent<Record<string, unknown>>(current.content) ?? {};
  const keys = new Set([...Object.keys(previousContent), ...Object.keys(currentContent)]);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const key of keys) {
    if (key === 'engineeringNotes' || key === 'aiDecisions') {
      continue;
    }

    const previousValue = previousContent[key];
    const currentValue = currentContent[key];

    if (Array.isArray(previousValue) || Array.isArray(currentValue)) {
      const diff = diffListField(previousValue as string[] | undefined, currentValue as string[] | undefined);
      added.push(...diff.added);
      removed.push(...diff.removed);
    } else if (JSON.stringify(previousValue ?? null) !== JSON.stringify(currentValue ?? null)) {
      changed.push(humanizeFieldKey(key));
    }
  }

  const lines = [header];
  lines.push(added.length > 0 ? `Added:\n${added.map((item) => `- ${item}`).join('\n')}` : 'Added: none');
  lines.push(removed.length > 0 ? `Removed:\n${removed.map((item) => `- ${item}`).join('\n')}` : 'Removed: none');

  if (changed.length > 0) {
    lines.push(`Changed: ${changed.join(', ')}`);
  }

  return lines.join('\n');
}

/** Convenience: summarizes every version transition for a role (v1->v2, v2->v3, ...) in order — a full changelog rather than a single diff. */
export async function getRoleChangeLog(projectId: string, roleKey: string): Promise<string[]> {
  if (!isBuildersDbAvailable()) {
    return [];
  }

  const versions = await buildersDbRepository.getRoleVersionHistory(projectId, roleKey);
  const roleLabel = ROLE_ARTIFACT_CHAIN.find((entry) => entry.type === roleKey)?.role ?? roleKey;

  return versions.map((version, index) => summarizeVersionChange(roleLabel, versions[index - 1], version));
}

export const versionHistory = {
  getRoleVersionHistory,
  getActiveVersion,
  formatVersionHistoryForPreview,
  buildContextPreview,
  summarizeVersionChange,
  getRoleChangeLog,
  applyContextBudget,
};
