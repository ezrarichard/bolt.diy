import { useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { updateProjectWorkspaceState, type Project } from '~/lib/stores/projects';
import { assembleProductPackage } from '~/lib/product-assembly/productAssembler';
import { getProductPackage, saveProductPackage } from '~/lib/product-assembly/assemblyRepository';
import type { ProductPackage, ProductPackageFile } from '~/lib/product-assembly/assemblyTypes';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';
import { getWorkspaceSnapshotProvider } from '~/lib/workspace-snapshot';
import { useCodeGeneration } from '~/lib/hooks/useCodeGeneration';

interface ProductPackagePanelProps {
  project: Project;
}

const STATUS_META: Record<ProductPackageFile['sourceStatus'], { label: string; className: string }> = {
  approved: { label: 'Approved', className: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10' },
  draft: { label: 'Draft', className: 'text-purple-600 dark:text-purple-400 border-purple-500/30 bg-purple-500/10' },
  missing: { label: 'Missing', className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50' },
};

/**
 * Sprint 37 — Product Package preview: a manual "Assemble Product Package" button, a file
 * list grouped by section (with source status badges), a missing-sections callout, and a
 * plain read-only content preview for whichever file is selected.
 *
 * Sprint 38.5 — Workspace Resume. Two gaps this closes:
 *  1. `pkg` now hydrates from BuildersDB on mount (`getProductPackage`, already fully
 *     implemented since Sprint 37 but never called anywhere before this) — reopening an
 *     already-assembled project no longer shows the empty "Nothing assembled yet" state.
 *  2. Once `project.workspaceState?.generatedApplicationExists` is true (persisted by
 *     useCodeGeneration.ts on a successful generation), the primary action becomes
 *     "Continue Development" (calls `resumeApplication`, which re-materializes the
 *     already-generated files into a fresh WebContainer with no LLM call — see that
 *     function's own comment) instead of "Generate Application", with an Application
 *     Status card showing what's actually there and a secondary "Regenerate" action for
 *     the old flow.
 */
export function ProductPackagePanel({ project }: ProductPackagePanelProps) {
  const [pkg, setPkg] = useState<ProductPackage | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [isAssembling, setIsAssembling] = useState(false);
  const [isLoadingPackage, setIsLoadingPackage] = useState(true);
  const [generatedFileCount, setGeneratedFileCount] = useState<number | null>(null);
  const codeGeneration = useCodeGeneration();

  const workspaceState = project.workspaceState;
  const applicationGenerated = Boolean(workspaceState?.generatedApplicationExists);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingPackage(true);

    getProductPackage(project.id).then((persisted) => {
      if (!cancelled && persisted) {
        setPkg(persisted);
        setSelectedFileId(persisted.sections[0]?.files[0]?.id ?? null);
      }

      if (!cancelled) {
        setIsLoadingPackage(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    if (!applicationGenerated) {
      return undefined;
    }

    let cancelled = false;
    getWorkspaceSnapshotProvider()
      .getSnapshotMeta(project.id)
      .then((meta) => {
        if (!cancelled) {
          setGeneratedFileCount(meta?.fileCount ?? null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project.id, applicationGenerated]);

  const handleAssemble = async () => {
    setIsAssembling(true);

    try {
      const assembled = assembleProductPackage(project);
      setPkg(assembled);
      setSelectedFileId(assembled.sections[0]?.files[0]?.id ?? null);

      // Best-effort — a failed/unconfigured save never affects the preview above.
      await saveProductPackage(assembled);
      updateProjectWorkspaceState(project.id, {
        productPackageAssembled: true,
        lastActivity: 'Product Package assembled',
      });
    } finally {
      setIsAssembling(false);
    }
  };

  const handleGenerate = () => {
    if (pkg) {
      codeGeneration.runGeneration(project, pkg);
    }
  };

  const handleContinueDevelopment = () => {
    codeGeneration.resumeApplication(project);
  };

  const allFiles = pkg?.sections.flatMap((section) => section.files) ?? [];
  const selectedFile = allFiles.find((file) => file.id === selectedFileId) ?? null;

  return (
    <div className="space-y-4">
      {applicationGenerated && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="i-ph:check-circle-fill w-4 h-4 text-green-500" />
            <span className="text-sm font-semibold text-bolt-elements-textPrimary">Application Status</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Status</div>
              <div className="text-xs font-medium text-green-600 dark:text-green-400">Generated</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Last Build</div>
              <div className="text-xs font-medium text-bolt-elements-textPrimary">
                {workspaceState?.lastGenerationTime ? formatArtifactTimestamp(workspaceState.lastGenerationTime) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Preview</div>
              <div className="text-xs font-medium text-bolt-elements-textPrimary">
                {workspaceState?.previewAvailable ? 'Available' : 'Not Available'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">Files</div>
              <div className="text-xs font-medium text-bolt-elements-textPrimary">{generatedFileCount ?? '—'}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleContinueDevelopment}
              disabled={codeGeneration.isRunning}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <span className="i-ph:play-fill w-4 h-4" />
              {codeGeneration.isRunning
                ? `${codeGeneration.stageLabel}${codeGeneration.detail ? ` — ${codeGeneration.detail}` : '…'}`
                : 'Continue Development'}
            </button>
            {pkg && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={codeGeneration.isRunning}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2 transition-colors disabled:opacity-50"
              >
                <span className="i-ph:arrow-clockwise w-3.5 h-3.5" />
                Regenerate
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleAssemble}
          disabled={isAssembling}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50"
        >
          <span className="i-ph:package w-4 h-4" />
          {isAssembling ? 'Assembling…' : pkg ? 'Re-Assemble Product Package' : 'Assemble Product Package'}
        </button>
        {pkg && (
          <span className="text-[11px] text-bolt-elements-textTertiary">
            Assembled {formatArtifactTimestamp(pkg.assembledAt)}
          </span>
        )}

        {!applicationGenerated && pkg && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={codeGeneration.isRunning}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <span className="i-ph:rocket-launch w-4 h-4" />
            {codeGeneration.isRunning
              ? `${codeGeneration.stageLabel}${codeGeneration.detail ? ` — ${codeGeneration.detail}` : '…'}`
              : 'Generate Application'}
          </button>
        )}
      </div>

      {codeGeneration.stage === 'failed' && codeGeneration.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400">
          <div className="font-semibold mb-1">Generation failed</div>
          <div className="whitespace-pre-wrap break-words">{codeGeneration.error}</div>
          <div className="mt-1 text-bolt-elements-textTertiary">
            The previous application (if any) was left untouched — click{' '}
            {applicationGenerated ? '"Continue Development"' : '"Generate Application"'} to retry.
          </div>
        </div>
      )}

      {!pkg && !isLoadingPackage && (
        <div className="text-xs text-bolt-elements-textTertiary px-1">
          Nothing assembled yet — click "Assemble Product Package" to collect every approved (or latest draft) AI role
          output into a structured package.
        </div>
      )}

      {pkg && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1 space-y-3">
            {pkg.sections.map((section) => (
              <div key={section.id}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                  {section.label}
                </div>
                {section.files.map((file) => {
                  const statusMeta = STATUS_META[file.sourceStatus];

                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => setSelectedFileId(file.id)}
                      className={classNames(
                        'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors mb-1',
                        selectedFileId === file.id
                          ? 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300'
                          : 'hover:bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary',
                      )}
                    >
                      <span className="truncate">{file.filename}</span>
                      <span
                        className={classNames(
                          'text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full border shrink-0',
                          statusMeta.className,
                        )}
                      >
                        {statusMeta.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}

            {pkg.missingSections.length > 0 && (
              <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-red-500 mb-1">Missing</div>
                <ul className="space-y-0.5">
                  {pkg.missingSections.map((entry) => (
                    <li key={entry.section} className="text-xs text-bolt-elements-textSecondary">
                      - {entry.label} output
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            {selectedFile ? (
              <div className="rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4 bg-[#F7F7F8]/90 dark:bg-[#161616]/80">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-bolt-elements-textPrimary">{selectedFile.path}</div>
                  {selectedFile.sourceRole && (
                    <div className="text-[11px] text-bolt-elements-textTertiary">
                      {selectedFile.sourceRole}
                      {selectedFile.sourceVersion ? ` v${selectedFile.sourceVersion}` : ''}
                    </div>
                  )}
                </div>
                <pre className="whitespace-pre-wrap break-words text-xs text-bolt-elements-textSecondary max-h-96 overflow-y-auto modern-scrollbar">
                  {selectedFile.content}
                </pre>
              </div>
            ) : (
              <div className="text-xs text-bolt-elements-textTertiary px-1">Select a file to preview its content.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
