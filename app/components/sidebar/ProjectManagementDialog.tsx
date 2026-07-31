import { useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { classNames } from '~/utils/classNames';
import {
  archiveProjects,
  permanentlyDeleteProjects,
  projectsStore,
  restoreProjects,
  softDeleteProjects,
  toggleProjectPinned,
  type Project,
} from '~/lib/stores/projects';
import {
  CLEANUP_CATEGORY_LABEL,
  findDuplicateProjects,
  matchesFilter,
  matchesSearch,
  resolveProjectStatus,
  sortProjectsForDisplay,
  suggestProjectsForCleanup,
  type ProjectFilter,
} from '~/lib/projects/projectLifecycle';
import { DEFAULT_GENERATION_PROFILES, DEFAULT_GENERATION_PROFILE_ID } from '~/lib/generation-profiles/defaultProfiles';
import { getProjectTypeDefinition } from '~/lib/project-types/projectTypeRegistry';

/**
 * Project Management — bulk lifecycle across every project.
 *
 * Lives in its own dialog rather than the sidebar: the sidebar is 320px, which cannot show the
 * columns the brief asks for (name, description, dates, type, status, profile) let alone a
 * selection column. The sidebar keeps quick filtering; this is where bulk work happens.
 *
 * NOTHING here acts without an explicit confirmation naming the projects. In particular the
 * "archive development projects" suggestion is PRE-SELECTED, never applied — the classifier
 * proposes, a human decides.
 */

const FILTERS: { value: ProjectFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'deleted', label: 'Recycle Bin' },
  { value: 'all', label: 'All' },
];

const STATUS_BADGE: Record<string, string> = {
  active: 'text-builders-status-success-text border-builders-status-success-border/40 bg-builders-status-success-bg',
  archived: 'text-bolt-elements-textSecondary border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-3',
  deleted: 'text-builders-status-error-text border-builders-status-error-border/40 bg-builders-status-error-bg',
};

function generationProfileName(project: Project): string {
  const id = project.workspaceState?.selectedGenerationProfileId ?? DEFAULT_GENERATION_PROFILE_ID;
  return DEFAULT_GENERATION_PROFILES.find((profile) => profile.id === id)?.name ?? 'Balanced';
}

function formatDate(iso: string | undefined): string {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** Confirmation shown before every bulk action. Lists the projects by name — the brief's Phase 7. */
function ConfirmDialog({
  title,
  intent,
  projects,
  confirmLabel,
  requireTyped,
  onConfirm,
  onCancel,
}: {
  title: string;
  intent: 'normal' | 'destructive';
  projects: Project[];
  confirmLabel: string;

  /** Permanent deletion additionally requires typing DELETE — it is the one irreversible action. */
  requireTyped?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const canConfirm = !requireTyped || typed.trim().toUpperCase() === 'DELETE';

  return (
    <RadixDialog.Root open onOpenChange={(next) => !next && onCancel()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[210] bg-black/60 backdrop-blur-sm" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[211] w-[min(460px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 shadow-2xl"
        >
          <div className="px-5 py-4 border-b border-bolt-elements-borderColor/60">
            <RadixDialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary">
              {title}
            </RadixDialog.Title>
            <p className="mt-1 text-xs text-bolt-elements-textSecondary">
              {projects.length} project{projects.length === 1 ? '' : 's'} will be affected.
            </p>
          </div>

          <div className="px-5 py-3 max-h-[220px] overflow-y-auto">
            <ul className="space-y-1">
              {projects.map((project) => (
                <li key={project.id} className="flex items-center gap-2 text-xs text-bolt-elements-textPrimary">
                  <span className="text-sm leading-none">{project.icon}</span>
                  <span className="truncate">{project.name}</span>
                </li>
              ))}
            </ul>
          </div>

          {requireTyped && (
            <div className="px-5 pb-3">
              <p className="text-xs text-builders-status-error-text mb-1.5">
                This cannot be undone. These projects will be permanently removed.
              </p>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Type DELETE to confirm"
                className="w-full rounded-lg px-2.5 py-1.5 text-xs appearance-none border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-bolt-elements-borderColor/60">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-xs bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={onConfirm}
              className={classNames(
                'px-3 py-1.5 rounded-lg text-xs font-medium appearance-none border-0 text-white transition-colors',
                intent === 'destructive' ? 'bg-red-600 hover:bg-red-700' : 'bg-purple-600 hover:bg-purple-700',
                canConfirm ? '' : 'opacity-50 cursor-not-allowed',
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

type PendingAction = 'archive' | 'restore' | 'delete' | 'permanent';

export function ProjectManagementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projects = useStore(projectsStore);
  const [filter, setFilter] = useState<ProjectFilter>('active');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction | null>(null);

  const counts = useMemo(
    () => ({
      active: projects.filter((project) => resolveProjectStatus(project) === 'active').length,
      archived: projects.filter((project) => resolveProjectStatus(project) === 'archived').length,
      deleted: projects.filter((project) => resolveProjectStatus(project) === 'deleted').length,
      all: projects.length,
    }),
    [projects],
  );

  /* Search deliberately ignores the status filter when a query is present, so archived work stays findable. */
  const visible = useMemo(() => {
    const searching = query.trim().length > 0;
    const matched = projects.filter(
      (project) => matchesSearch(project, query) && (searching || matchesFilter(project, filter)),
    );

    return sortProjectsForDisplay(matched);
  }, [projects, filter, query]);

  const suggestions = useMemo(() => suggestProjectsForCleanup(projects), [projects]);
  const duplicates = useMemo(() => findDuplicateProjects(projects), [projects]);

  const selectedProjects = useMemo(() => projects.filter((project) => selected.has(project.id)), [projects, selected]);

  const toggle = (projectId: string) =>
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }

      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((project) => selected.has(project.id));

  const runPending = () => {
    const ids = selectedProjects.map((project) => project.id);

    if (pending === 'archive') {
      archiveProjects(ids);
    } else if (pending === 'restore') {
      restoreProjects(ids);
    } else if (pending === 'delete') {
      softDeleteProjects(ids);
    } else if (pending === 'permanent') {
      permanentlyDeleteProjects(ids);
    }

    setSelected(new Set());
    setPending(null);
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <RadixDialog.Root open onOpenChange={(next) => !next && onClose()}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm" />
          <RadixDialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-[151] w-[min(1080px,94vw)] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 shadow-2xl flex flex-col"
          >
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-bolt-elements-borderColor/60">
              <div>
                <RadixDialog.Title className="text-lg font-semibold tracking-tight text-bolt-elements-textPrimary">
                  Manage Projects
                </RadixDialog.Title>
                <p className="mt-0.5 text-xs text-bolt-elements-textSecondary">
                  Archive, restore and recover projects. Nothing is removed unless you permanently delete it.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close project management"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-transparent border-0 appearance-none hover:bg-builders-brand-subtleSurface group transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus"
              >
                <div className="i-ph:x w-4 h-4 text-bolt-elements-textSecondary group-hover:text-builders-brand-primary" />
              </button>
            </div>

            {/* Filters + search */}
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-bolt-elements-borderColor/50">
              <div className="flex rounded-lg border border-bolt-elements-borderColor/60 overflow-hidden">
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFilter(option.value)}
                    className={classNames(
                      'px-2.5 py-1 text-[11px] appearance-none border-0 transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus',
                      filter === option.value
                        ? 'bg-builders-brand-subtleSurface text-builders-brand-primary font-medium'
                        : 'bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
                    )}
                  >
                    {option.label} <span className="tabular-nums opacity-70">{counts[option.value]}</span>
                  </button>
                ))}
              </div>

              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search all projects, including archived…"
                aria-label="Search all projects"
                className="flex-1 min-w-[200px] rounded-lg px-2.5 py-1 text-xs appearance-none border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus"
              />
            </div>

            {/* Cleanup suggestion — pre-selects, never applies. */}
            {filter === 'active' && !query && suggestions.length > 0 && (
              <div className="mx-5 mt-3 rounded-xl border border-builders-status-warning-border/40 bg-builders-status-warning-bg px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-bolt-elements-textPrimary">
                    <span className="font-semibold">{suggestions.length} projects look like development work</span>
                    {duplicates.length > 0 && <span> · {duplicates.length} duplicate name(s)</span>}
                    <span className="block text-[11px] text-bolt-elements-textSecondary mt-0.5">
                      {[...new Set(suggestions.map((s) => CLEANUP_CATEGORY_LABEL[s.category]))].join(', ')}. Nothing is
                      archived until you confirm.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(suggestions.map((s) => s.projectId)))}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium appearance-none border-0 bg-purple-600 hover:bg-purple-700 text-white transition-colors"
                  >
                    Select them
                  </button>
                </div>
              </div>
            )}

            {/* Bulk action bar */}
            {selected.size > 0 && (
              <div className="mx-5 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-builders-brand-primary/40 bg-builders-brand-subtleSurface px-3.5 py-2">
                <span className="text-xs font-medium text-bolt-elements-textPrimary">{selected.size} selected</span>
                <div className="flex-1" />
                {(
                  [
                    ['archive', 'Archive', 'normal'],
                    ['restore', 'Restore', 'normal'],
                    ['delete', 'Delete', 'normal'],
                    ['permanent', 'Permanent Delete', 'destructive'],
                  ] as const
                ).map(([action, label, intent]) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => setPending(action)}
                    className={classNames(
                      'px-2.5 py-1 rounded-lg text-[11px] appearance-none border transition-colors',
                      intent === 'destructive'
                        ? 'border-builders-status-error-border/50 text-builders-status-error-text hover:bg-builders-status-error-bg'
                        : 'border-bolt-elements-borderColor/60 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
                      'bg-transparent',
                    )}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="px-2 py-1 rounded-lg text-[11px] bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Table */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
              {visible.length === 0 ? (
                <p className="py-8 text-center text-xs text-bolt-elements-textSecondary">No projects match.</p>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-bolt-elements-textSecondary">
                      <th className="font-medium py-1.5 pr-2 w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all visible projects"
                          checked={allVisibleSelected}
                          onChange={() =>
                            setSelected(allVisibleSelected ? new Set() : new Set(visible.map((p) => p.id)))
                          }
                        />
                      </th>
                      <th className="font-medium py-1.5 pr-3">Project</th>
                      <th className="font-medium py-1.5 pr-3">Type</th>
                      <th className="font-medium py-1.5 pr-3">Profile</th>
                      <th className="font-medium py-1.5 pr-3">Created</th>
                      <th className="font-medium py-1.5 pr-3">Updated</th>
                      <th className="font-medium py-1.5 pr-3">Status</th>
                      <th className="font-medium py-1.5 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bolt-elements-borderColor/40">
                    {visible.map((project) => {
                      const status = resolveProjectStatus(project);

                      return (
                        <tr
                          key={project.id}
                          className={classNames(
                            'text-bolt-elements-textSecondary transition-colors',
                            selected.has(project.id)
                              ? 'bg-builders-brand-subtleSurface'
                              : 'hover:bg-bolt-elements-background-depth-3/50',
                          )}
                        >
                          <td className="py-1.5 pr-2">
                            <input
                              type="checkbox"
                              aria-label={`Select ${project.name}`}
                              checked={selected.has(project.id)}
                              onChange={() => toggle(project.id)}
                            />
                          </td>
                          <td className="py-1.5 pr-3 max-w-[300px]">
                            <div className="flex items-center gap-1.5">
                              {project.pinnedAt && (
                                <span
                                  aria-label="Pinned"
                                  className="i-ph:push-pin-fill w-3 h-3 text-builders-brand-primary shrink-0"
                                />
                              )}
                              <span className="text-sm leading-none">{project.icon}</span>
                              <span className="text-bolt-elements-textPrimary truncate">{project.name}</span>
                            </div>
                            {project.description && (
                              <div className="text-[10px] text-bolt-elements-textSecondary truncate pl-5">
                                {project.description}
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {getProjectTypeDefinition(project.projectType).displayName}
                          </td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{generationProfileName(project)}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(project.createdAt)}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {formatDate(project.updatedAt ?? project.createdAt)}
                          </td>
                          <td className="py-1.5 pr-3">
                            <span
                              className={classNames(
                                'px-1.5 py-0.5 rounded-full text-[10px] font-medium border capitalize',
                                STATUS_BADGE[status],
                              )}
                            >
                              {status === 'deleted' ? 'in bin' : status}
                            </span>
                          </td>
                          <td className="py-1.5">
                            <button
                              type="button"
                              onClick={() => toggleProjectPinned(project.id)}
                              aria-label={project.pinnedAt ? `Unpin ${project.name}` : `Pin ${project.name}`}
                              className="flex items-center justify-center w-6 h-6 rounded-md bg-transparent border-0 appearance-none text-bolt-elements-textTertiary hover:text-builders-brand-primary transition-colors"
                            >
                              <span
                                className={classNames(
                                  'w-3.5 h-3.5',
                                  project.pinnedAt ? 'i-ph:push-pin-fill text-builders-brand-primary' : 'i-ph:push-pin',
                                )}
                              />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      {pending && (
        <ConfirmDialog
          title={
            pending === 'archive'
              ? 'Archive projects?'
              : pending === 'restore'
                ? 'Restore projects?'
                : pending === 'delete'
                  ? 'Move to recycle bin?'
                  : 'Permanently delete projects?'
          }
          intent={pending === 'permanent' ? 'destructive' : 'normal'}
          projects={selectedProjects}
          confirmLabel={
            pending === 'archive'
              ? 'Archive'
              : pending === 'restore'
                ? 'Restore'
                : pending === 'delete'
                  ? 'Move to bin'
                  : 'Delete forever'
          }
          requireTyped={pending === 'permanent'}
          onConfirm={runPending}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
