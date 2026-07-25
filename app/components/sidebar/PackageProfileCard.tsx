import { classNames } from '~/utils/classNames';
import { setProjectPackageSelection, clearProjectPackageSelection, type Project } from '~/lib/stores/projects';
import { resolveEffectivePackageSelection } from '~/lib/package-intelligence/packageResolutionService';
import { packageEngine } from '~/lib/package-intelligence/packageProfileRegistry';

interface PackageProfileCardProps {
  project: Project;
  className?: string;
}

const AUTO_VALUE = '__none__';

const SELECTION_SOURCE_LABEL: Record<string, string> = {
  manual_override: 'Project selection',
  project_selection: 'Project selection',
  business_discovery: 'Business Discovery',
  none: 'Not set',
};

/**
 * Package Profile Card — Sprint 73 (Package Intelligence Foundation).
 *
 * The smallest safe UI surface for PART 13 of the Sprint 73 brief: displays the effective
 * Package Profile (name + selection source) and lets a user pick Starter/Professional/Premium or
 * clear back to no package. Reuses the same footprint/visual style as `RegionalProfileCard`
 * (Sprint 72) in the Workspace tab, right next to it — no new Dashboard page, no pricing/
 * checkout/quotation UI.
 *
 * Deliberately reads/writes through `resolveEffectivePackageSelection` (pure, synchronous, over
 * the in-memory `Project` already in the reactive `projectsStore`) and the store-level
 * `setProjectPackageSelection`/`clearProjectPackageSelection` mutators (app/lib/stores/projects.ts)
 * rather than the async BuildersDB-only functions in `packageResolutionService.ts` — same reason
 * `RegionalProfileCard` does this: no extra network round trip per render, state stays in
 * lockstep with the reactive `project` prop every other Workspace card already reads.
 */
export function PackageProfileCard({ project, className }: PackageProfileCardProps) {
  const resolution = resolveEffectivePackageSelection(project);
  const profiles = packageEngine.getAllPackageProfiles();
  const currentValue = project.packageSelection?.packageCode ?? AUTO_VALUE;

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;

    if (value === AUTO_VALUE) {
      clearProjectPackageSelection(project.id);
      return;
    }

    setProjectPackageSelection(project.id, value);
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
          <div className="i-ph:package-duotone w-4 h-4 text-purple-600/80 dark:text-purple-400/80" />
        </div>
        <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">Package</div>
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
        <option value={AUTO_VALUE}>No package selected</option>
        {profiles.map((profile) => (
          <option key={profile.code} value={profile.code}>
            {profile.name}
          </option>
        ))}
      </select>

      <div className="mt-2.5 text-xs text-bolt-elements-textSecondary space-y-0.5">
        <div>
          <span className="text-bolt-elements-textTertiary">Package: </span>
          {resolution.packageProfileCode
            ? (profiles.find((profile) => profile.code === resolution.packageProfileCode)?.name ??
              resolution.packageProfileCode)
            : 'Not specified'}
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Source: </span>
          {SELECTION_SOURCE_LABEL[resolution.selectionSource] ?? 'Not set'}
        </div>
      </div>

      <div className="text-[11px] leading-snug text-bolt-elements-textTertiary/80 mt-1.5">
        Package guidance controls implementation depth and delivery maturity. It does not add unrelated product
        features.
      </div>
    </div>
  );
}
