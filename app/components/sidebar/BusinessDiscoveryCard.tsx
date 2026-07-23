import { classNames } from '~/utils/classNames';
import type { DiscoveryIntelligenceState } from '~/lib/hooks/useDiscoveryIntelligence';
import { resolveBusinessDiscoveryDisplay, type BadgeMeta } from './businessDiscoveryDisplay';

/**
 * Sprint 54.1 — Discovery Intelligence UI Integration.
 *
 * Renders the Sprint 53 Business Assessment and Sprint 54 Discovery Decision that
 * `useDiscoveryIntelligence` reads from BuildersDB. Display-only: never writes anything, never
 * calls an engine, never generates a question or recommendation — exactly the same read-only
 * relationship every other "*DraftPanel" component in this file has to its own artifact. All
 * branching logic (which message/badge for which state) lives in `businessDiscoveryDisplay.ts`,
 * so this component is a thin, purely presentational switch over `resolveBusinessDiscoveryDisplay`.
 */

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={classNames('text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap', className)}
    >
      {label}
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary bg-bolt-elements-background-depth-2/60">
      {label}
    </span>
  );
}

function DiscoveryField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
        {label}
      </div>
      <div className="text-sm text-bolt-elements-textSecondary">
        {value && value.length > 0 ? value : <span className="text-bolt-elements-textTertiary">Not yet assessed</span>}
      </div>
    </div>
  );
}

function CompletenessBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
          Discovery Completeness
        </div>
        <div className="text-xs font-medium text-bolt-elements-textSecondary">{clamped}%</div>
      </div>
      <div className="h-2 w-full rounded-full bg-bolt-elements-background-depth-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-purple-500 transition-all duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function EmptyDiscoveryState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 px-4 rounded-xl border border-dashed border-bolt-elements-borderColor/60">
      <span className="i-ph:magnifying-glass-duotone h-7 w-7 text-bolt-elements-textTertiary mb-2" />
      <div className="text-xs text-bolt-elements-textTertiary max-w-[360px]">{message}</div>
    </div>
  );
}

function ConfidenceRow({ label, meta }: { label: string; meta?: BadgeMeta }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">{label}</span>
      {meta ? (
        <Badge label={meta.label} className={meta.badgeClass} />
      ) : (
        <span className="text-xs text-bolt-elements-textTertiary">Not yet assessed</span>
      )}
    </div>
  );
}

export interface BusinessDiscoveryCardProps {
  state: DiscoveryIntelligenceState;
}

export function BusinessDiscoveryCard({ state }: BusinessDiscoveryCardProps) {
  const display = resolveBusinessDiscoveryDisplay(state);

  if (display.kind === 'hidden') {
    return null;
  }

  if (display.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary px-1 py-2">
        <span className="i-svg-spinners:90-ring-with-bg w-3.5 h-3.5 text-purple-500" />
        Loading discovery intelligence…
      </div>
    );
  }

  if (display.kind === 'empty') {
    return <EmptyDiscoveryState message={display.message} />;
  }

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md space-y-5',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">Business Discovery</div>
        <Badge label={display.stateMeta.label} className={display.stateMeta.badgeClass} />
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2.5">
          Business Assessment
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DiscoveryField label="Classification" value={display.classification} />
          <DiscoveryField label="Industry" value={display.industry} />
          <DiscoveryField label="Digital Maturity" value={display.maturity} />
          <DiscoveryField label="Project Type" value={display.projectType} />
        </div>
        {display.assessmentConfidence && (
          <div className="mt-3">
            <ConfidenceRow label="Assessment Confidence" meta={display.assessmentConfidence} />
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-bolt-elements-borderColor/30">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2.5">
          Discovery Decision
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-4">
          {typeof display.completenessScore === 'number' && <CompletenessBar score={display.completenessScore} />}
          <ConfidenceRow label="Overall Confidence" meta={display.overallConfidence} />
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
              Ready for Requirements Draft
            </span>
            <Badge
              label={display.readyForRequirementsDraft.label}
              className={display.readyForRequirementsDraft.badgeClass}
            />
          </div>
        </div>

        {display.missingAreaLabels.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
              Missing Areas
            </div>
            <div className="flex flex-wrap gap-1.5">
              {display.missingAreaLabels.map((label) => (
                <Chip key={label} label={label} />
              ))}
            </div>
          </div>
        )}

        {display.partialAreaLabels.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
              Partial Areas
            </div>
            <div className="flex flex-wrap gap-1.5">
              {display.partialAreaLabels.map((label) => (
                <Chip key={label} label={label} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
