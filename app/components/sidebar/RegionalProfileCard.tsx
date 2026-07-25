import { classNames } from '~/utils/classNames';
import { setProjectRegionalSelection, clearProjectRegionalSelection, type Project } from '~/lib/stores/projects';
import { resolveEffectiveRegionalSelection } from '~/lib/regional/regionalResolutionService';
import { regionalEngine } from '~/lib/regional/regionalProfileRegistry';

interface RegionalProfileCardProps {
  project: Project;
  className?: string;
}

const AUTO_VALUE = '__auto__';

const SELECTION_SOURCE_LABEL: Record<string, string> = {
  manual_override: 'Manual override',
  business_discovery: 'Business Discovery',
  none: 'Not set',
};

/**
 * Regional Profile Card — Sprint 72 (Regional Selection Activation).
 *
 * The smallest safe UI surface for PART 5/6 of the Sprint 72 brief: displays the effective
 * Regional Profile (name + selection source) and lets a user pick a manual override or return to
 * automatic resolution. Reuses the same footprint/visual style as `GenerationProfileSelector`'s
 * card (Sprint 39.5) in the Workspace tab — no new Dashboard page, no custom settings framework.
 *
 * Deliberately reads/writes through `resolveEffectiveRegionalSelection` (pure, synchronous, over
 * the in-memory `Project` already in the reactive `projectsStore`) and the store-level
 * `setProjectRegionalSelection`/`clearProjectRegionalSelection` mutators (app/lib/stores/projects.ts)
 * rather than the async BuildersDB-only functions in `regionalResolutionService.ts` — this keeps
 * the control's state in lockstep with the same reactive `project` prop every other Workspace
 * card already reads, with no extra network round trip per render.
 */
export function RegionalProfileCard({ project, className }: RegionalProfileCardProps) {
  const resolution = resolveEffectiveRegionalSelection(project);
  const profiles = regionalEngine.getAllRegionalProfiles();
  const currentValue = project.regionalSelection?.regionCode ?? AUTO_VALUE;

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;

    if (value === AUTO_VALUE) {
      clearProjectRegionalSelection(project.id);
      return;
    }

    setProjectRegionalSelection(project.id, value);
  };

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 ring-1 ring-purple-500/15 shrink-0">
          <div className="i-ph:globe-hemisphere-west-duotone w-4 h-4 text-purple-600/80 dark:text-purple-400/80" />
        </div>
        <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">Regional Profile</div>
      </div>

      <select
        value={currentValue}
        onChange={handleChange}
        className={classNames(
          'w-full px-3 py-2 rounded-lg text-sm cursor-pointer',
          'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor',
          'text-bolt-elements-textPrimary focus:outline-none focus:ring-1 focus:ring-purple-500/50',
        )}
      >
        <option value={AUTO_VALUE}>Use automatic selection</option>
        {profiles.map((profile) => (
          <option key={profile.code} value={profile.code}>
            {profile.name}
          </option>
        ))}
      </select>

      <div className="mt-2.5 text-xs text-bolt-elements-textSecondary space-y-0.5">
        <div>
          <span className="text-bolt-elements-textTertiary">Effective region: </span>
          {resolution.matchedCountry ?? 'Not specified'}
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Source: </span>
          {SELECTION_SOURCE_LABEL[resolution.selectionSource] ?? 'Not set'}
        </div>
      </div>

      <div className="text-[11px] leading-snug text-bolt-elements-textTertiary/80 mt-1.5">
        Regional guidance adapts approved product scope to the selected market. It does not add product features or
        guarantee legal compliance.
      </div>
    </div>
  );
}
