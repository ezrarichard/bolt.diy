import { classNames } from '~/utils/classNames';
import { DEFAULT_GENERATION_PROFILES } from '~/lib/generation-profiles/defaultProfiles';

interface GenerationProfileSelectorProps {
  value: string;
  onChange: (profileId: string) => void;
  className?: string;
}

/** One-line cost/quality framing shown under the dropdown — Sprint 39.5's own "cost control" labeling requirement. */
const PROFILE_HINTS: Record<string, string> = {
  'fast-prototype': 'Cheapest and fastest — good for testing.',
  balanced: 'Recommended — a practical mix of speed and quality.',
  production: 'Highest quality — best for final builds.',
};

/**
 * Generation Profile Selector — Sprint 39.5.
 *
 * A plain `<select>` over the 3 fixed system profiles (no custom profile
 * creation/editing this sprint — see app/lib/generation-profiles/defaultProfiles.ts)
 * plus a one-line description underneath. Reused in NewProjectDialog.tsx (choosing a
 * profile at project creation) and ProjectDashboard.tsx's Workspace tab (changing it
 * later) — both just call `onChange` and let the caller decide how to persist it
 * (`saveSelectedProfileForProject` in the dashboard's case, or fold it into the initial
 * `updateProjectWorkspaceState` call right after `addProject` in the dialog's case).
 */
export function GenerationProfileSelector({ value, onChange, className }: GenerationProfileSelectorProps) {
  const selected = DEFAULT_GENERATION_PROFILES.find((profile) => profile.id === value);

  return (
    <div className={className}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={classNames(
          'w-full px-3 py-2 rounded-lg text-sm',
          'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor',
          'text-bolt-elements-textPrimary focus:outline-none focus:ring-1 focus:ring-purple-500/50',
        )}
      >
        {DEFAULT_GENERATION_PROFILES.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
      {selected && (
        <div className="text-[11px] text-bolt-elements-textTertiary mt-1.5">
          {PROFILE_HINTS[selected.id] ?? selected.description}
        </div>
      )}
    </div>
  );
}
