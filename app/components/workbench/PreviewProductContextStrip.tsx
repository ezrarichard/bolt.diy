import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  currentProjectIdStore,
  projectsStore,
  isProjectDashboardOpenStore,
  updateProjectWorkspaceState,
} from '~/lib/stores/projects';
import { useProductEvolutionSummary } from '~/lib/projects/useProductEvolutionSummary';

/**
 * Preview Product Context Strip — Sprint 84C (Part 4).
 *
 * A single, dismissible row above the Preview toolbar — "Viewing: MVP1 — Released · Next: ... ·
 * [Open Product]" — per `docs/product-management/Sprint-84-Product-Evolution-UX-Plan.md` Section
 * 9. Deliberately thin: it reads the same persisted data `ProductWorkspacePanel` does (via
 * `useProductEvolutionSummary`, itself a wrapper around the Sprint 84B `buildProductEvolutionView`
 * selector), but never renders the timeline, reviews, or approvals themselves — it is a pointer
 * into the Product tab, not a second copy of it. Renders nothing until there is at least one
 * released (live) MVP, and nothing at all if the viewer has dismissed it this session.
 */

const DISMISS_KEY_PREFIX = 'builders:preview-product-strip-dismissed:';

function readDismissed(projectId: string): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY_PREFIX + projectId) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(projectId: string): void {
  try {
    sessionStorage.setItem(DISMISS_KEY_PREFIX + projectId, '1');
  } catch {
    /*
     * sessionStorage unavailable (private browsing, SSR) — the strip simply won't remember the
     * dismissal for this session; it is never a hard failure.
     */
  }
}

export function PreviewProductContextStrip() {
  const currentProjectId = useStore(currentProjectIdStore);
  const projects = useStore(projectsStore);
  const project = projects.find((candidate) => candidate.id === currentProjectId);

  const summary = useProductEvolutionSummary(project);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(project ? readDismissed(project.id) : false);
  }, [project?.id]);

  if (!project || dismissed || summary.status !== 'ready' || summary.isEmpty || !summary.liveEntry) {
    return null;
  }

  const handleOpenProduct = () => {
    updateProjectWorkspaceState(project.id, { lastSelectedTab: 'product' });
    isProjectDashboardOpenStore.set(true);
  };

  const handleDismiss = () => {
    writeDismissed(project.id);
    setDismissed(true);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-b border-bolt-elements-borderColor/40 bg-bolt-elements-background-depth-2/60 text-xs">
      <span className="text-bolt-elements-textTertiary">
        Viewing{' '}
        <span className="font-medium text-bolt-elements-textPrimary">
          {summary.liveEntry.code}
          {summary.liveEntry.status
            ? ` — ${summary.liveEntry.status === 'released' ? 'Released' : summary.liveEntry.status}`
            : ''}
        </span>
      </span>

      {summary.nextAction && summary.nextAction.id !== 'up-to-date' && (
        <span className="text-bolt-elements-textTertiary min-w-0 truncate">
          Next <span className="font-medium text-bolt-elements-textPrimary">{summary.nextAction.label}</span>
        </span>
      )}

      <button
        type="button"
        onClick={handleOpenProduct}
        className="ml-auto shrink-0 text-purple-600 dark:text-purple-300 hover:text-purple-700 dark:hover:text-purple-200 font-medium transition-colors"
      >
        Open Product
      </button>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Hide product status banner"
        title="Hide product status banner"
        className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 transition-colors"
      >
        <span className="i-ph:x w-3.5 h-3.5" />
      </button>
    </div>
  );
}
