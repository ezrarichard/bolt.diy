import { useEffect, useMemo, useState } from 'react';
import { classNames } from '~/utils/classNames';
import {
  getActiveApplicationManifest,
  listApplicationManifestFiles,
  listManifestVersions,
} from '~/lib/application-manifest/applicationManifestRepository';
import { listFileVersions, listGeneratedFiles } from '~/lib/generated-files/generatedFilesRepository';
import { getProjectActivity } from '~/lib/builders-db/repositories/buildersDbRepository';
import {
  computeProgress,
  estimateRemainingMs,
  groupFilesByCategory,
  groupFilesByStatus,
} from '~/lib/application-manifest/dashboardStats';
import { groupActivityEvents, type GroupedActivityEvent } from '~/lib/application-manifest/groupActivityEvents';
import { getDependencyEntry } from '~/lib/application-manifest/dependencyGraph';
import type {
  ApplicationManifest,
  ApplicationManifestFile,
  ManifestFileCategory,
  ManifestFileStatus,
} from '~/lib/application-manifest/manifestTypes';
import type { GeneratedApplicationFileVersion } from '~/lib/generated-files/generatedFileTypes';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';
import type { CodeGenerationState } from '~/lib/hooks/useCodeGeneration';

/**
 * Application Generation Dashboard — Sprint 44.2, Phase 4 ("Engineering Control
 * Center"). Supersedes the Phase 1-3 `ApplicationManifestPanel` card with a full
 * dashboard: manifest header, overall progress, current activity, files-by-status,
 * files-by-category, manifest version history, a full file table, a file detail panel,
 * and a grouped activity timeline.
 *
 * Core principle this component follows throughout: every number shown is read directly
 * from BuildersDB (manifest/generated-file rows) via the pure aggregation helpers in
 * dashboardStats.ts — nothing is computed from local/optimistic frontend state. Live
 * updates while a generation is running come from the SAME `codeGeneration` hook state
 * ProductPackagePanel.tsx already threads through (liveState) plus a `refreshKey` bump
 * per stage change (see ProductPackagePanel.tsx) — no new polling mechanism.
 */

interface GenerationDashboardProps {
  projectId: string;

  /** Bumped by the caller whenever generation progresses (or finishes), so this component re-fetches without polling. */
  refreshKey: number;

  /** The same live hook state ProductPackagePanel.tsx already has — current stage/detail while a run is active. */
  liveState: Pick<CodeGenerationState, 'isRunning' | 'stage' | 'stageLabel' | 'detail'>;
}

interface MergedFile extends ApplicationManifestFile {
  generatedFileId?: string;
  latestVersion?: number;
  repairCount?: number;
}

const CATEGORY_LABELS: Record<ManifestFileCategory, string> = {
  entry: 'Entry',
  config: 'Config',
  pages: 'Pages',
  components: 'Components',
  types: 'Types',
  services: 'Services',
  styles: 'Styles',
  documentation: 'Docs',
  other: 'Other',
};

const STATUS_LABELS: Record<ManifestFileStatus, string> = {
  complete: 'Complete',
  validated: 'Validated',
  repairing: 'Repairing',
  validating: 'Validating',
  generating: 'Generating',
  queued: 'Queued',
  generated: 'Generated',
  pending: 'Pending',
  failed: 'Failed',
  skipped: 'Skipped',
  superseded: 'Superseded',
};

const STATUS_CLASSNAMES: Record<ManifestFileStatus, string> = {
  complete: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  validated: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  repairing: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  validating: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  generating: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  queued: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  generated: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  pending: 'border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary',
  failed: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  skipped: 'border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary',
  superseded: 'border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary',
};

/** Status → single-character indicator, matching the spec's own "✓ ⚡ 🛠 ✗ ○" example set, extended for the two statuses (queued/validating) it didn't enumerate. */
const STATUS_ICON: Record<ManifestFileStatus, string> = {
  complete: '✓',
  validated: '✓',
  repairing: '🛠',
  validating: '⋯',
  generating: '⚡',
  queued: '⏳',
  generated: '●',
  pending: '○',
  failed: '✗',
  skipped: '⊘',
  superseded: '⊙',
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${seconds}s`;
}

function shortChecksum(checksum: string | undefined): string {
  return checksum ? checksum.replace(/^fnv1a:/, '').slice(0, 8) : '—';
}

export function GenerationDashboard({ projectId, refreshKey, liveState }: GenerationDashboardProps) {
  const [manifest, setManifest] = useState<ApplicationManifest | null>(null);
  const [files, setFiles] = useState<MergedFile[]>([]);
  const [versions, setVersions] = useState<ApplicationManifest[]>([]);
  const [activity, setActivity] = useState<GroupedActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedFileVersions, setSelectedFileVersions] = useState<GeneratedApplicationFileVersion[]>([]);

  // A plain UI clock for "elapsed time" — never a new data-fetch mechanism, just a re-render tick while a run is active.
  const [now, setNow] = useState(() => Date.now());
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (liveState.isRunning && runStartedAt === null) {
      setRunStartedAt(Date.now());
    } else if (!liveState.isRunning) {
      setRunStartedAt(null);
    }
  }, [liveState.isRunning, runStartedAt]);

  useEffect(() => {
    if (!liveState.isRunning) {
      return undefined;
    }

    const interval = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(interval);
  }, [liveState.isRunning]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    (async () => {
      const current = await getActiveApplicationManifest(projectId);

      if (cancelled) {
        return;
      }

      setManifest(current);

      if (!current) {
        setFiles([]);
        setVersions([]);
        setActivity([]);
        setIsLoading(false);

        return;
      }

      const [manifestFiles, generatedFiles, manifestVersions, rawActivity] = await Promise.all([
        listApplicationManifestFiles(current.id),
        listGeneratedFiles(current.id),
        listManifestVersions(projectId),
        getProjectActivity(projectId),
      ]);

      if (cancelled) {
        return;
      }

      const generatedByManifestFileId = new Map(generatedFiles.map((file) => [file.manifestFileId, file]));
      const merged: MergedFile[] = manifestFiles.map((file) => {
        const generated = generatedByManifestFileId.get(file.id);
        return {
          ...file,
          status: generated?.status ?? file.status,
          generatedFileId: generated?.id,
          latestVersion: generated?.latestVersion,
          repairCount: generated?.repairCount,
          lastError: generated?.lastError ?? file.lastError,
        };
      });

      setFiles(merged);
      setVersions(manifestVersions);
      setActivity(
        groupActivityEvents(
          rawActivity
            .filter((event) => event.activityType.startsWith('generat') || event.activityType.startsWith('manifest'))
            .map((event) => ({
              activityType: event.activityType,
              description: event.description,
              createdAt: event.createdAt,
            })),
        ),
      );
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  useEffect(() => {
    if (!selectedPath) {
      setSelectedFileVersions([]);
      return undefined;
    }

    const file = files.find((entry) => entry.path === selectedPath);

    if (!file?.generatedFileId) {
      setSelectedFileVersions([]);
      return undefined;
    }

    let cancelled = false;
    listFileVersions(file.generatedFileId).then((result) => {
      if (!cancelled) {
        setSelectedFileVersions(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedPath, files]);

  const progress = useMemo(() => computeProgress(files), [files]);
  const statusGroups = useMemo(() => groupFilesByStatus(files), [files]);
  const categoryGroups = useMemo(() => groupFilesByCategory(files), [files]);
  const dependencyEntry = selectedPath ? getDependencyEntry(files, selectedPath) : null;
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;

  const elapsedMs = runStartedAt ? now - runStartedAt : 0;
  const estimatedRemainingMs = runStartedAt
    ? estimateRemainingMs({ completed: progress.completed, total: progress.total, elapsedMs })
    : undefined;

  if (isLoading || !manifest) {
    return null;
  }

  return (
    <div className="rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] bg-[#F7F7F8]/90 dark:bg-[#161616]/80 divide-y divide-bolt-elements-borderColor/30">
      {/* Manifest header */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="i-ph:tree-structure w-4 h-4 text-purple-500" />
          <span className="text-sm font-semibold text-bolt-elements-textPrimary">Application Generation Dashboard</span>
          <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400">
            v{manifest.version}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Status</div>
            <div className="text-xs font-medium text-bolt-elements-textPrimary capitalize">{manifest.status}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">
              Structure Checksum
            </div>
            <div className="text-xs font-mono text-bolt-elements-textPrimary">
              {shortChecksum(manifest.planChecksum)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Created</div>
            <div className="text-xs font-medium text-bolt-elements-textPrimary">
              {formatArtifactTimestamp(manifest.createdAt)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Updated</div>
            <div className="text-xs font-medium text-bolt-elements-textPrimary">
              {formatArtifactTimestamp(manifest.updatedAt)}
            </div>
          </div>
        </div>
        {manifest.sourcePackageAssembledAt && (
          <div className="mt-2 text-[11px] text-bolt-elements-textTertiary">
            Source Product Package assembled {formatArtifactTimestamp(manifest.sourcePackageAssembledAt)}
          </div>
        )}
      </div>

      {/* Overall progress */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-bolt-elements-textPrimary">Overall Progress</span>
          <span className="text-xs text-bolt-elements-textSecondary">
            {progress.completed} / {progress.total} files complete — {progress.percent}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-bolt-elements-background-depth-2 overflow-hidden">
          <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${progress.percent}%` }} />
        </div>
      </div>

      {/* Current activity */}
      {liveState.isRunning && (
        <div className="p-4">
          <div className="text-xs font-semibold text-bolt-elements-textPrimary mb-2">Current Activity</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Stage</div>
              <div className="text-xs font-medium text-bolt-elements-textPrimary">{liveState.stageLabel}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Detail</div>
              <div className="text-xs font-medium text-bolt-elements-textPrimary">{liveState.detail ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Elapsed</div>
              <div className="text-xs font-medium text-bolt-elements-textPrimary">{formatDuration(elapsedMs)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Est. Remaining</div>
              <div className="text-xs font-medium text-bolt-elements-textPrimary">
                {estimatedRemainingMs !== undefined ? `~${formatDuration(estimatedRemainingMs)}` : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Files by status */}
      <div className="p-4">
        <div className="text-xs font-semibold text-bolt-elements-textPrimary mb-2">Files by Status</div>
        <div className="flex flex-wrap gap-2">
          {statusGroups.map(({ status, count }) => (
            <span
              key={status}
              className={classNames('text-[11px] font-medium px-2 py-1 rounded-lg border', STATUS_CLASSNAMES[status])}
            >
              {STATUS_LABELS[status]}: {count}
            </span>
          ))}
        </div>
      </div>

      {/* Files by category */}
      <div className="p-4">
        <div className="text-xs font-semibold text-bolt-elements-textPrimary mb-2">Files by Category</div>
        <div className="flex flex-wrap gap-2">
          {categoryGroups.map(({ category, count }) => (
            <span
              key={category}
              className="text-[11px] px-2 py-1 rounded-lg border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary"
            >
              {CATEGORY_LABELS[category]}: {count}
            </span>
          ))}
        </div>
      </div>

      {/* Manifest versions */}
      {versions.length > 1 && (
        <div className="p-4">
          <div className="text-xs font-semibold text-bolt-elements-textPrimary mb-2">Manifest Versions</div>
          <div className="flex flex-wrap gap-2">
            {versions.map((version) => (
              <span
                key={version.id}
                className={classNames(
                  'text-[11px] font-medium px-2 py-1 rounded-lg border',
                  version.status === 'active'
                    ? 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400'
                    : 'border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary',
                )}
              >
                v{version.version} — {version.status === 'active' ? 'Current' : 'Superseded'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* File table */}
      <div className="p-4">
        <div className="text-xs font-semibold text-bolt-elements-textPrimary mb-2">Planned Files ({files.length})</div>
        <div className="max-h-72 overflow-y-auto modern-scrollbar rounded-lg border border-bolt-elements-borderColor/30">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-bolt-elements-background-depth-1 text-bolt-elements-textTertiary">
              <tr>
                <th className="text-left font-medium px-2 py-1">Status</th>
                <th className="text-left font-medium px-2 py-1">Path</th>
                <th className="text-left font-medium px-2 py-1">Category</th>
                <th className="text-left font-medium px-2 py-1">Attempts</th>
                <th className="text-left font-medium px-2 py-1">Repairs</th>
                <th className="text-left font-medium px-2 py-1">Version</th>
                <th className="text-left font-medium px-2 py-1">Updated</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr
                  key={file.id}
                  onClick={() => setSelectedPath(file.path)}
                  className={classNames(
                    'cursor-pointer border-t border-bolt-elements-borderColor/20 hover:bg-bolt-elements-background-depth-2',
                    selectedPath === file.path && 'bg-purple-50 dark:bg-purple-500/10',
                  )}
                >
                  <td className="px-2 py-1">
                    <span
                      className={classNames(
                        'inline-block w-4 text-center',
                        STATUS_CLASSNAMES[file.status].split(' ')[2],
                      )}
                    >
                      {STATUS_ICON[file.status]}
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono text-bolt-elements-textPrimary truncate max-w-[220px]">
                    {file.path}
                  </td>
                  <td className="px-2 py-1 text-bolt-elements-textSecondary">{CATEGORY_LABELS[file.category]}</td>
                  <td className="px-2 py-1 text-bolt-elements-textSecondary">{file.generationAttempts}</td>
                  <td className="px-2 py-1 text-bolt-elements-textSecondary">{file.repairCount ?? 0}</td>
                  <td className="px-2 py-1 text-bolt-elements-textSecondary">{file.latestVersion ?? '—'}</td>
                  <td className="px-2 py-1 text-bolt-elements-textSecondary">
                    {formatArtifactTimestamp(file.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* File details */}
      {selectedFile && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-bolt-elements-textPrimary font-mono">{selectedFile.path}</div>
            <button
              type="button"
              onClick={() => setSelectedPath(null)}
              className="text-[11px] text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Purpose</div>
              <div className="text-xs text-bolt-elements-textPrimary">
                {selectedFile.displayName ?? selectedFile.componentName ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Status</div>
              <div className="text-xs text-bolt-elements-textPrimary capitalize">{selectedFile.status}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">
                Generation Attempts
              </div>
              <div className="text-xs text-bolt-elements-textPrimary">{selectedFile.generationAttempts}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Repair Attempts</div>
              <div className="text-xs text-bolt-elements-textPrimary">{selectedFile.repairCount ?? 0}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Checksum</div>
              <div className="text-xs font-mono text-bolt-elements-textPrimary">
                {shortChecksum(selectedFile.checksum)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">
                Created / Updated
              </div>
              <div className="text-xs text-bolt-elements-textPrimary">
                {formatArtifactTimestamp(selectedFile.createdAt)} / {formatArtifactTimestamp(selectedFile.updatedAt)}
              </div>
            </div>
          </div>

          {selectedFile.lastError && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-600 dark:text-red-400">
              {selectedFile.lastError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                Dependencies ({dependencyEntry?.dependsOn.length ?? 0})
              </div>
              {dependencyEntry && dependencyEntry.dependsOn.length > 0 ? (
                <ul className="space-y-0.5">
                  {dependencyEntry.dependsOn.map((path) => (
                    <li key={path} className="text-[11px] font-mono text-bolt-elements-textSecondary">
                      {path}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[11px] text-bolt-elements-textTertiary">None</div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                Used By ({dependencyEntry?.usedBy.length ?? 0})
              </div>
              {dependencyEntry && dependencyEntry.usedBy.length > 0 ? (
                <ul className="space-y-0.5">
                  {dependencyEntry.usedBy.map((path) => (
                    <li key={path} className="text-[11px] font-mono text-bolt-elements-textSecondary">
                      {path}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[11px] text-bolt-elements-textTertiary">None</div>
              )}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
              Version History ({selectedFileVersions.length})
            </div>
            {selectedFileVersions.length > 0 ? (
              <ul className="space-y-1">
                {[...selectedFileVersions].reverse().map((version) => (
                  <li key={version.id} className="text-[11px] text-bolt-elements-textSecondary flex items-center gap-2">
                    <span className="font-mono">v{version.version}</span>
                    <span>{version.changeReason}</span>
                    <span className="text-bolt-elements-textTertiary">
                      {formatArtifactTimestamp(version.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[11px] text-bolt-elements-textTertiary">No versions persisted yet.</div>
            )}
          </div>
        </div>
      )}

      {/* Activity timeline */}
      {activity.length > 0 && (
        <div className="p-4">
          <div className="text-xs font-semibold text-bolt-elements-textPrimary mb-2">Generation Activity</div>
          <ul className="space-y-1 max-h-48 overflow-y-auto modern-scrollbar">
            {activity.slice(0, 30).map((event, index) => (
              <li
                key={`${event.activityType}-${event.createdAt}-${index}`}
                className="text-[11px] flex items-center gap-2"
              >
                <span className="text-bolt-elements-textSecondary">{event.description}</span>
                <span className="text-bolt-elements-textTertiary">{formatArtifactTimestamp(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
