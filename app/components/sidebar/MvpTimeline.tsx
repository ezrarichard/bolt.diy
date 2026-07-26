import { classNames } from '~/utils/classNames';
import { BuildersStatusBadge, type BuildersStatus } from '~/components/ui/builders';
import type { ProductEvolutionMvpEntry } from '~/lib/projects/productEvolutionView';

/**
 * MVP Timeline — Sprint 84B (Product Evolution Workspace).
 *
 * The ordered MVP1 -> MVP2 -> MVP3+ row inside the Product tab. Deliberately a SEPARATE component
 * from `ProjectWorkflowBar` — that bar represents initial-build progression (Business -> Blueprint
 * -> Plan -> Engineering -> Application) for the CURRENT MVP being built; this component
 * represents the product's long-lived, multi-release lifecycle. See
 * docs/product-management/Sprint-84-Product-Evolution-UX-Plan.md Phase 3 for why the two are
 * never conflated.
 *
 * Desktop/laptop only this sprint — horizontally scrollable (`overflow-x-auto`) rather than
 * clipped, so a project with many MVPs degrades to a scrollbar instead of the clipping
 * `ProjectWorkflowBar`/the dashboard's own tab row already exhibit at narrow widths (Sprint 84A's
 * audit, Finding UI-11). The mobile vertical-accordion conversion is Sprint 84C — this component's
 * props/structure don't assume a fixed desktop-only shape, so that conversion only needs a new
 * render path for the same `entries` prop, not a redesign of the data flowing into it.
 */

export interface MvpTimelineProps {
  entries: ProductEvolutionMvpEntry[];
  selectedSequence?: number;
  onSelect: (sequence: number) => void;
}

function statusPresentation(entry: ProductEvolutionMvpEntry): { status: BuildersStatus; label: string } {
  if (entry.kind === 'skeleton') {
    return { status: 'info', label: 'Future' };
  }

  switch (entry.status) {
    case 'released':
      return { status: 'success', label: entry.isLive ? 'Live · Released' : 'Released' };
    case 'superseded':
      return { status: 'completed', label: 'Superseded' };
    case 'planned':
      return { status: 'pending', label: 'Planned' };
    case 'blocked':
      return { status: 'blocked', label: 'Blocked' };
    default:
      // scoped | generating | ready_for_review | approved | provisioned | generated | qa_passed | ready_for_deployment
      return { status: 'working', label: 'In Progress' };
  }
}

export function MvpTimeline({ entries, selectedSequence, onSelect }: MvpTimelineProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      className="flex items-stretch gap-2 overflow-x-auto pb-1 -mx-1 px-1"
      role="list"
      aria-label="Product MVP timeline"
    >
      {entries.map((entry, index) => {
        const isSelected = entry.sequence === selectedSequence;
        const presentation = statusPresentation(entry);

        return (
          <div key={entry.sequence} className="flex items-center shrink-0" role="listitem">
            {index > 0 && (
              <span className="w-6 h-px bg-bolt-elements-borderColor/50 shrink-0 mx-1" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={() => onSelect(entry.sequence)}
              aria-current={isSelected ? 'true' : undefined}
              className={classNames(
                'builders-focus-ring builders-transition flex flex-col items-start gap-1.5 rounded-xl border px-3.5 py-2.5 text-left min-w-[168px] shrink-0',
                isSelected
                  ? 'border-purple-500/50 bg-purple-50/70 dark:bg-purple-500/[0.1] shadow-sm'
                  : 'border-bolt-elements-borderColor/40 dark:border-white/[0.06] bg-bolt-elements-background-depth-2/60 hover:border-purple-500/30',
                entry.kind === 'skeleton' && 'border-dashed opacity-80',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
                  MVP{entry.sequence}
                </span>
                <span className="text-[10px] text-bolt-elements-textTertiary">{entry.code}</span>
              </div>
              <div className="text-sm font-medium text-bolt-elements-textPrimary truncate max-w-[160px]">
                {entry.theme ?? 'Untitled'}
              </div>
              <BuildersStatusBadge status={presentation.status} label={presentation.label} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
