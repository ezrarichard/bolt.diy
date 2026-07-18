import { useEffect, useState } from 'react';
import {
  getActiveApplicationManifest,
  listApplicationManifestFiles,
} from '~/lib/application-manifest/applicationManifestRepository';
import type {
  ApplicationManifest,
  ApplicationManifestFile,
  ManifestFileCategory,
} from '~/lib/application-manifest/manifestTypes';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';

interface ApplicationManifestPanelProps {
  projectId: string;

  /** Bumped by the caller whenever a new generation run finishes, so this panel re-fetches the (possibly just-persisted) manifest without polling. */
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

function groupByCategory(files: ApplicationManifestFile[]): { category: ManifestFileCategory; count: number }[] {
  const counts = new Map<ManifestFileCategory, number>();

  for (const file of files) {
    counts.set(file.category, (counts.get(file.category) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Sprint 44.2, Phase 1 — read-only summary of the persisted Application Manifest: total
 * planned files, files by category, manifest/source-package version, and status. Purely
 * observational this phase — no per-file drill-down or regenerate action yet (those are
 * later-phase UI, once file-level persistence/resume exist to act on).
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

        if (!cancelled) {
          setFiles(manifestFiles);
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

  return (
    <div className="rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4 bg-[#F7F7F8]/90 dark:bg-[#161616]/80">
      <div className="flex items-center gap-2 mb-3">
        <span className="i-ph:tree-structure w-4 h-4 text-purple-500" />
        <span className="text-sm font-semibold text-bolt-elements-textPrimary">Application Manifest</span>
        <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400">
          v{manifest.version}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Planned Files</div>
          <div className="text-xs font-medium text-bolt-elements-textPrimary">{manifest.totalFiles}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Status</div>
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
