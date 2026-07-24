import { useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { blueprintEngine, type ProjectBlueprint } from '~/lib/blueprints';
import { getLatestBlueprintVersion } from '~/lib/builders-db/repositories/blueprintRepository';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';
import { useBlueprintRecommendation } from '~/lib/hooks/useBlueprintRecommendation';
import type { DiscoveryIntelligenceState } from '~/lib/hooks/useDiscoveryIntelligence';
import {
  confidenceMeta,
  isCustomSelection,
  selectionStatusMeta,
  topAlternates,
} from './blueprintRecommendationDisplay';

/**
 * Sprint 62 — Blueprint Recommendation & Selection.
 *
 * Advisory panel over the Sprint 61 Blueprint Resolution Engine: shows what the engine
 * recommends, why, and what else it considered, and lets the user accept it, pick a different
 * Blueprint, or reset back to the recommendation. Display + `selectBlueprint()` calls only —
 * this component never calls `resolveBlueprintCandidates`/`resolveAndRecordBlueprint` itself
 * (that's `useBlueprintRecommendation`'s job) and, critically, never writes to
 * `project.blueprintId` or triggers any generation. Every AI role still reads
 * `project.blueprintId` exactly as it did before this sprint (see businessAnalystEngine.ts and
 * its siblings) — the recommendation/selection recorded here lives only in
 * `builders_blueprint_resolutions`, read back live via `useBlueprintRecommendation`, so a page
 * refresh reflects the latest selection without anything having mutated the project itself.
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

function BlueprintChip({ blueprint }: { blueprint: ProjectBlueprint | undefined }) {
  if (!blueprint) {
    return <span className="text-sm text-bolt-elements-textTertiary">Unknown Blueprint</span>;
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-base leading-none">{blueprint.icon}</span>
      <span className="text-sm font-medium text-bolt-elements-textPrimary">{blueprint.name}</span>
    </span>
  );
}

function ReasonList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-1 mt-2">
      {reasons.map((reason) => (
        <li key={reason} className="flex items-start gap-1.5 text-xs text-bolt-elements-textSecondary">
          <span className="i-ph:check-circle-duotone w-3.5 h-3.5 mt-0.5 shrink-0 text-purple-500" />
          {reason}
        </li>
      ))}
    </ul>
  );
}

/** Sprint 62 objective 6 — a non-intrusive notice only, never an auto-upgrade. Migration logic is later-sprint work. */
function NewerVersionNotice({ blueprint }: { blueprint: ProjectBlueprint }) {
  const [latestVersion, setLatestVersion] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    getLatestBlueprintVersion(blueprint.id).then((version) => {
      if (!cancelled) {
        setLatestVersion(version);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [blueprint.id]);

  if (!latestVersion || !blueprint.version || latestVersion <= blueprint.version) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
      <span className="i-ph:info-duotone w-3.5 h-3.5 shrink-0" />A newer Blueprint version is available.
    </div>
  );
}

function BlueprintPicker({
  currentId,
  onChoose,
  onClose,
}: {
  currentId: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const options = blueprintEngine.getAllBlueprints().filter((blueprint) => blueprint.enabled);

  return (
    <div className="mt-3 rounded-lg border border-bolt-elements-borderColor/50 bg-bolt-elements-background-depth-2/60 p-2 space-y-1">
      {options.map((blueprint) => (
        <button
          key={blueprint.id}
          type="button"
          onClick={() => {
            onChoose(blueprint.id);
            onClose();
          }}
          className={classNames(
            'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors',
            blueprint.id === currentId
              ? 'bg-purple-500/15 text-purple-600 dark:text-purple-300'
              : 'hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary',
          )}
        >
          <span className="text-sm leading-none">{blueprint.icon}</span>
          <span className="text-xs font-medium">{blueprint.name}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClose}
        className="w-full text-center text-[11px] text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary pt-1"
      >
        Cancel
      </button>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}

function ChipList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary bg-bolt-elements-background-depth-2/60"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

/** Sprint 62 objective 5 — inspects the Sprint 60 structured Blueprint content for the currently selected blueprint. */
function BlueprintDetails({ blueprint }: { blueprint: ProjectBlueprint }) {
  const content = blueprint.content;

  if (!content) {
    return (
      <div className="text-xs text-bolt-elements-textTertiary py-2">
        Detailed Blueprint knowledge isn't available for {blueprint.name} yet.
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-1">
      {content.executiveSummary && (
        <DetailSection title="Summary">
          <p className="text-sm text-bolt-elements-textSecondary">{content.executiveSummary.summary}</p>
          <p className="text-xs text-bolt-elements-textTertiary mt-1">{content.executiveSummary.valueProposition}</p>
        </DetailSection>
      )}

      {content.businessDomain && (
        <DetailSection title="Business Domain">
          <p className="text-sm text-bolt-elements-textSecondary">
            {content.businessDomain.industry} — {content.businessDomain.category}
          </p>
          <p className="text-xs text-bolt-elements-textTertiary mt-1">{content.businessDomain.description}</p>
        </DetailSection>
      )}

      {content.typicalCustomers && content.typicalCustomers.length > 0 && (
        <DetailSection title="Typical Customers">
          <ChipList items={content.typicalCustomers} />
        </DetailSection>
      )}

      {content.functionalModules && content.functionalModules.length > 0 && (
        <DetailSection title="Core Modules">
          <ChipList items={content.functionalModules.map((module) => module.name)} />
        </DetailSection>
      )}

      {content.standardFeatures && content.standardFeatures.length > 0 && (
        <DetailSection title="Standard Features">
          <ChipList items={content.standardFeatures.map((feature) => feature.name)} />
        </DetailSection>
      )}

      {content.userRoles && content.userRoles.length > 0 && (
        <DetailSection title="User Roles">
          <ChipList items={content.userRoles.map((role) => role.name)} />
        </DetailSection>
      )}

      {content.integrations && content.integrations.length > 0 && (
        <DetailSection title="Integrations">
          <ChipList items={content.integrations.map((integration) => integration.name)} />
        </DetailSection>
      )}

      {content.compliance && content.compliance.length > 0 && (
        <DetailSection title="Compliance">
          <ChipList items={content.compliance.map((item) => item.name)} />
        </DetailSection>
      )}

      {content.futureEnhancements && content.futureEnhancements.length > 0 && (
        <DetailSection title="Future Enhancements">
          <ChipList items={content.futureEnhancements.map((item) => item.idea)} />
        </DetailSection>
      )}
    </div>
  );
}

export interface BlueprintRecommendationCardProps {
  projectId: string;
  discovery: DiscoveryIntelligenceState;
}

export function BlueprintRecommendationCard({ projectId, discovery }: BlueprintRecommendationCardProps) {
  const { state, selectBlueprint, resetToRecommendation } = useBlueprintRecommendation(projectId, discovery);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (state.status === 'hidden') {
    return null;
  }

  if (state.status === 'loading' || state.status === 'resolving') {
    return (
      <div className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary px-1 py-2">
        <span className="i-svg-spinners:90-ring-with-bg w-3.5 h-3.5 text-purple-500" />
        {state.status === 'resolving' ? 'Resolving Blueprint recommendation…' : 'Loading Blueprint recommendation…'}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="text-xs text-bolt-elements-textTertiary px-1 py-2">Blueprint recommendation unavailable.</div>
    );
  }

  const { resolution } = state;
  const recommended = blueprintEngine.getBlueprint(resolution.recommendedBlueprintId);
  const selected = blueprintEngine.getBlueprint(resolution.selectedBlueprintId) ?? recommended;
  const custom = isCustomSelection(resolution);
  const alternates = topAlternates(resolution);

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md space-y-4',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">Blueprint Recommendation</div>
        <Badge label={selectionStatusMeta(resolution).label} className={selectionStatusMeta(resolution).badgeClass} />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <BlueprintChip blueprint={recommended} />
        <Badge
          label={confidenceMeta(resolution.confidence).label}
          className={confidenceMeta(resolution.confidence).badgeClass}
        />
      </div>

      <ReasonList reasons={resolution.explanation} />

      <div className="text-[11px] text-bolt-elements-textTertiary">
        Resolved {formatArtifactTimestamp(resolution.resolvedAt)}
      </div>

      {custom && selected && (
        <div className="pt-3 border-t border-bolt-elements-borderColor/30">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
            Currently Selected
          </div>
          <BlueprintChip blueprint={selected} />
        </div>
      )}

      {alternates.length > 0 && (
        <div className="pt-3 border-t border-bolt-elements-borderColor/30">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
            Other Candidates
          </div>
          <div className="space-y-2">
            {alternates.map((candidate) => {
              const blueprint = blueprintEngine.getBlueprint(candidate.blueprintId);
              return (
                <div key={candidate.blueprintId} className="flex items-center justify-between">
                  <BlueprintChip blueprint={blueprint} />
                  <Badge
                    label={confidenceMeta(candidate.confidence).label}
                    className={confidenceMeta(candidate.confidence).badgeClass}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="pt-3 border-t border-bolt-elements-borderColor/30 flex flex-wrap items-center gap-2">
        {custom && (
          <button
            type="button"
            onClick={() => resetToRecommendation()}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary hover:text-purple-600 dark:hover:text-purple-300 transition-colors"
          >
            Reset to Recommendation
          </button>
        )}
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors"
        >
          Choose a Different Blueprint
        </button>
        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg text-bolt-elements-textSecondary hover:text-purple-600 dark:hover:text-purple-300 transition-colors"
        >
          {detailsOpen ? 'Hide Details' : 'View Blueprint Details'}
        </button>
      </div>

      {pickerOpen && (
        <BlueprintPicker
          currentId={resolution.selectedBlueprintId}
          onChoose={(id) => selectBlueprint(id)}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {detailsOpen && selected && (
        <div className="pt-3 border-t border-bolt-elements-borderColor/30">
          <BlueprintDetails blueprint={selected} />
          <div className="pt-2">
            <NewerVersionNotice blueprint={selected} />
          </div>
        </div>
      )}
    </div>
  );
}
