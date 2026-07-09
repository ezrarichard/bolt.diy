import { useState } from 'react';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { assembleProductPackage } from '~/lib/product-assembly/productAssembler';
import { saveProductPackage } from '~/lib/product-assembly/assemblyRepository';
import type { ProductPackage, ProductPackageFile } from '~/lib/product-assembly/assemblyTypes';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';
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
 * Sprint 37 — minimal Product Package preview: a manual "Assemble Product Package"
 * button, a file list grouped by section (with source status badges), a missing-
 * sections callout, and a plain read-only content preview for whichever file is
 * selected. Deliberately no file tree, no editing, no code generation, no live preview
 * — see app/lib/product-assembly/productAssembler.ts for why that's Sprint 38's job.
 *
 * Assembly itself (`assembleProductPackage`) is synchronous and reads only the
 * in-memory `project` prop, so it always works — persisting to BuildersDB
 * (`saveProductPackage`) is a best-effort extra step afterward that never blocks or
 * fails the preview if BuildersDB is unconfigured/unreachable.
 */
export function ProductPackagePanel({ project }: ProductPackagePanelProps) {
  const [pkg, setPkg] = useState<ProductPackage | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [isAssembling, setIsAssembling] = useState(false);
  const codeGeneration = useCodeGeneration();

  const handleAssemble = async () => {
    setIsAssembling(true);

    try {
      const assembled = assembleProductPackage(project);
      setPkg(assembled);
      setSelectedFileId(assembled.sections[0]?.files[0]?.id ?? null);

      // Best-effort — a failed/unconfigured save never affects the preview above.
      await saveProductPackage(assembled);
    } finally {
      setIsAssembling(false);
    }
  };

  const handleGenerate = () => {
    if (pkg) {
      codeGeneration.runGeneration(project, pkg);
    }
  };

  const allFiles = pkg?.sections.flatMap((section) => section.files) ?? [];
  const selectedFile = allFiles.find((file) => file.id === selectedFileId) ?? null;

  return (
    <div className="space-y-4">
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

        {pkg && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={codeGeneration.isRunning}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <span className="i-ph:rocket-launch w-4 h-4" />
            {codeGeneration.isRunning
              ? `${codeGeneration.stageLabel}${codeGeneration.detail ? ` — ${codeGeneration.detail}` : '…'}`
              : codeGeneration.stage === 'complete'
                ? 'Regenerate Application'
                : 'Generate Application'}
          </button>
        )}
      </div>

      {codeGeneration.stage === 'failed' && codeGeneration.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400">
          <div className="font-semibold mb-1">Generation failed</div>
          <div className="whitespace-pre-wrap break-words">{codeGeneration.error}</div>
          <div className="mt-1 text-bolt-elements-textTertiary">
            The previous application (if any) was left untouched — click "Generate Application" to retry.
          </div>
        </div>
      )}

      {!pkg && (
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
