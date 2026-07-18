import { useEffect, useState } from 'react';
import {
  getActiveApplicationManifest,
  listApplicationManifestFiles,
} from '~/lib/application-manifest/applicationManifestRepository';
import { listGeneratedFiles } from '~/lib/generated-files/generatedFilesRepository';
import type {
  ApplicationManifest,
  ApplicationManifestFile,
  ManifestFileCategory,
  ManifestFileStatus,
} from '~/lib/application-manifest/manifestTypes';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';

interface ApplicationManifestPanelProps {
  projectId: string;

  /** Bumped by the caller whenever generation progresses (or finishes), so this panel re-fetches without polling. */
  refreshKey: number;
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

/** Sprint 44.2, Phase 3 — the exact status set the spec's progress panel calls for, in display order. */
const STATUS_ORDER: ManifestFileStatus[] = [
  'complete',
  'validated',
  'repairing',
  'validating',
  'generating',
  'generated',
  'failed',
  'pending',
  'skipped',
  'superseded',
];

const STATUS_LABELS: Record<ManifestFileStatus, string> = {
  complete: 'Complete',
  validated: 'Validated',
  repairing: 'Repairing',
  validating: 'Validating',
  generating: 'Generating',
  generated: 'Generated',
  failed: 'Failed',
  pending: 'Pending',
  skipped: 'Skipped',
  superseded: 'Superseded',
};

const STATUS_CLASSNAMES: Record<ManifestFileStatus, string> = {
  complete: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  validated: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  repairing: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  validating: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  generating: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  generated: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  failed: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  pending: 'border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary',
  skipped: 'border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary',
  superseded: 'border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary',
};

function groupByCategory(files: ApplicationManifestFile[]): { category: ManifestFileCategory; count: number }[] {
  const counts = new Map<ManifestFileCategory, number>();

  for (const file of files) {
    counts.set(file.category, (counts.get(file.category) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/** Files reachable by resume are marked 'generated'/'validated'/'complete' on the manifest-file row too (see generatedFilesRepository.ts's updateManifestFileStatus) — the panel reads that column directly rather than joining the generated-files table, keeping this a single query. */
function groupByStatus(files: ApplicationManifestFile[]): Map<ManifestFileStatus, number> {
  const counts = new Map<ManifestFileStatus, number>();

  for (const file of files) {
    counts.set(file.status, (counts.get(file.status) ?? 0) + 1);
  }

  return counts;
}

/**
 * Sprint 44.2, Phase 3 — the Application Manifest panel now shows per-status progress
 * (complete/validated/repairing/generating/generated/failed/pending/skipped/superseded),
 * not just totals-by-category (Phase 1) — the spec's own "21 / 27 files complete" style
 * summary. Still read-only/observational: the actual Resume/Restart actions live on
 * ProductPackagePanel.tsx's buttons, which is where the live `codeGeneration` hook state
 * (current stage/file) is already displayed.
 */
export function ApplicationManifestPanel({ projectId, refreshKey }: ApplicationManifestPanelProps) {
  const [manifest, setManifest] = useState<ApplicationManifest | null>(null);
  const [files, setFiles] = useState<ApplicationManifestFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    getActiveApplicationManifest(projectId).then(async (current) => {
      if (cancelled) {
        return;
      }

      setManifest(current);

      if (current) {
        const manifestFiles = await listApplicationManifestFiles(current.id);

        // Cross-check against the generated-files table so a status the manifest-file row hasn't caught up to yet (e.g. mid-persist) still shows correctly.
        const generatedFiles = await listGeneratedFiles(current.id);
        const generatedByManifestFileId = new Map(generatedFiles.map((file) => [file.manifestFileId, file.status]));
        const merged = manifestFiles.map((file) => ({
          ...file,
          status: generatedByManifestFileId.get(file.id) ?? file.status,
        }));

        if (!cancelled) {
          setFiles(merged);
        }
      } else {
        setFiles([]);
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  if (isLoading || !manifest) {
    return null;
  }

  const categories = groupByCategory(files);
  const statusCounts = groupByStatus(files);
  const completeCount = (statusCounts.get('complete') ?? 0) + (statusCounts.get('validated') ?? 0);
  const total = manifest.totalFiles || files.length;

  return (
    <div className="rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4 bg-[#F7F7F8]/90 dark:bg-[#161616]/80">
      <div className="flex items-center gap-2 mb-3">
        <span className="i-ph:tree-structure w-4 h-4 text-purple-500" />
        <span className="text-sm font-semibold text-bolt-elements-textPrimary">Application Manifest</span>
        <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400">
          v{manifest.version}
        </span>
        <span className="text-[11px] text-bolt-elements-textTertiary">
          {completeCount} / {total} files complete
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Planned Files</div>
          <div className="text-xs font-medium text-bolt-elements-textPrimary">{manifest.totalFiles}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Manifest Status</div>
          <div className="text-xs font-medium text-bolt-elements-textPrimary capitalize">{manifest.status}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Framework</div>
          <div className="text-xs font-medium text-bolt-elements-textPrimary">{manifest.framework}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Persisted</div>
          <div className="text-xs font-medium text-bolt-elements-textPrimary">
            {formatArtifactTimestamp(manifest.persistedAt)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {STATUS_ORDER.filter((status) => (statusCounts.get(status) ?? 0) > 0).map((status) => (
          <span
            key={status}
            className={`text-[11px] font-medium px-2 py-1 rounded-lg border ${STATUS_CLASSNAMES[status]}`}
          >
            {STATUS_LABELS[status]}: {statusCounts.get(status)}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map(({ category, count }) => (
          <span
            key={category}
            className="text-[11px] px-2 py-1 rounded-lg border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary"
          >
            {CATEGORY_LABELS[category]}: {count}
          </span>
        ))}
      </div>

      {manifest.sourcePackageAssembledAt && (
        <div className="mt-3 text-[11px] text-bolt-elements-textTertiary">
          Source Product Package assembled {formatArtifactTimestamp(manifest.sourcePackageAssembledAt)}
        </div>
      )}
    </div>
  );
}
