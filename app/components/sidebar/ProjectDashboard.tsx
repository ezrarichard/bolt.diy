import * as RadixDialog from '@radix-ui/react-dialog';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { PROJECT_COLOR_CLASSES } from './ProjectListItem';
import BackgroundRays from '~/components/ui/BackgroundRays';

interface ProjectDashboardProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
}

interface InfoCardProps {
  icon: string;
  label: string;
  rows: { label: string; value: string }[];
}

/**
 * One "Workspace Overview" tile. Values are read straight off the Project
 * object's optional integration fields (githubRepo/supabaseProjectId/
 * deploymentTarget/etc.) — all unset for every project today, so every
 * status honestly reads "Not Connected" rather than faking a connection.
 * The moment a future sprint wires real GitHub/Supabase/Vercel data into
 * those fields, these cards start reflecting reality with no markup changes.
 */
function InfoCard({ icon, label, rows }: InfoCardProps) {
  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
        'hover:border-purple-500/25 dark:hover:border-purple-500/20 transition-colors duration-200',
      )}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 ring-1 ring-purple-500/15 shrink-0">
          <div className={classNames(icon, 'w-4 h-4 text-purple-600/80 dark:text-purple-400/80')} />
        </div>
        <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">{label}</div>
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-xs">
            <span className="text-bolt-elements-textTertiary">{row.label}</span>
            <span className="text-bolt-elements-textSecondary font-medium truncate max-w-[60%]">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ActionButtonProps {
  icon: string;
  label: string;
}

// All Project Actions are placeholders — "No functionality yet" per spec.
function ActionButton({ icon, label }: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled
      title="Coming soon"
      className={classNames(
        'flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium',
        'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50',
        'text-bolt-elements-textTertiary cursor-not-allowed opacity-60',
      )}
    >
      <div className={classNames(icon, 'w-4 h-4')} />
      {label}
    </button>
  );
}

export function ProjectDashboard({ project, open, onClose }: ProjectDashboardProps) {
  if (!project) {
    return null;
  }

  const colorClasses = PROJECT_COLOR_CLASSES[project.color] || PROJECT_COLOR_CLASSES.purple;

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <div className="fixed inset-0 flex items-center justify-center z-[100] modern-scrollbar">
          <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />

          <RadixDialog.Content aria-describedby={undefined} onEscapeKeyDown={onClose} className="relative z-[101]">
            <div
              className={classNames(
                'w-[1100px] max-w-[92vw] h-[90vh]',
                'bg-bolt-elements-background-depth-1',
                'rounded-2xl shadow-2xl',
                'border border-bolt-elements-borderColor',
                'flex flex-col overflow-hidden relative',
                'transform transition-all duration-200 ease-out',
                open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
              )}
            >
              <div className="absolute inset-0 overflow-hidden rounded-2xl">
                <BackgroundRays />
              </div>

              <div className="relative z-10 flex flex-col h-full overflow-y-auto">
                {/* Header */}
                <div className="flex items-start justify-between px-8 py-6 border-b border-bolt-elements-borderColor/60">
                  <div className="flex items-center gap-4">
                    <div
                      className={classNames(
                        'flex items-center justify-center w-14 h-14 rounded-2xl shrink-0 ring-1',
                        colorClasses.bg,
                        colorClasses.ring,
                      )}
                    >
                      <span className="text-2xl leading-none">{project.icon}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <RadixDialog.Title className="text-xl font-semibold tracking-tight text-bolt-elements-textPrimary">
                          {project.name}
                        </RadixDialog.Title>
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 ring-1 ring-green-500/20">
                          <span className="i-ph:circle-duotone w-2.5 h-2.5 text-green-500" />
                          <span className="text-[11px] font-medium text-green-600 dark:text-green-400">
                            Active Project
                          </span>
                        </span>
                      </div>
                      {project.description && (
                        <div className="text-sm text-bolt-elements-textTertiary mt-1">{project.description}</div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={onClose}
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-purple-500/10 dark:hover:bg-purple-500/20 group transition-all duration-200"
                  >
                    <div className="i-ph:x w-4 h-4 text-bolt-elements-textTertiary group-hover:text-purple-500 transition-colors" />
                  </button>
                </div>

                <div className="flex-1 px-8 py-6 space-y-8">
                  {/* Workspace Overview */}
                  <div>
                    <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                      Workspace Overview
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <InfoCard
                        icon="i-ph:github-logo-duotone"
                        label="GitHub"
                        rows={[
                          { label: 'Status', value: project.githubRepo ? 'Connected' : 'Not Connected' },
                          { label: 'Repository', value: project.githubRepo || 'Not linked yet' },
                        ]}
                      />
                      <InfoCard
                        icon="i-ph:database-duotone"
                        label="Supabase"
                        rows={[
                          { label: 'Status', value: project.supabaseProjectId ? 'Connected' : 'Not Connected' },
                          { label: 'Project', value: project.supabaseProjectId || 'Not linked yet' },
                        ]}
                      />
                      <InfoCard
                        icon="i-ph:rocket-launch-duotone"
                        label="Deployment"
                        rows={[
                          { label: 'Status', value: project.deploymentTarget ? 'Connected' : 'Not Connected' },
                          { label: 'Target', value: project.deploymentTarget || 'Not set' },
                        ]}
                      />
                      <InfoCard
                        icon="i-ph:flask-duotone"
                        label="Environment"
                        rows={[{ label: 'Current', value: 'Development' }]}
                      />
                      <InfoCard
                        icon="i-ph:users-duotone"
                        label="Members"
                        rows={[
                          {
                            label: 'Total',
                            value: `${project.members?.length || 1} Member${(project.members?.length || 1) === 1 ? '' : 's'}`,
                          },
                        ]}
                      />
                      <InfoCard
                        icon="i-ph:stack-duotone"
                        label="Templates"
                        rows={[{ label: 'Active', value: project.templates?.[0] || 'Blank Project' }]}
                      />
                    </div>
                  </div>

                  {/* Recent Chats */}
                  <div>
                    <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                      Recent Chats
                    </h2>
                    <div className="flex flex-col items-center justify-center text-center py-14 px-4 rounded-xl border border-dashed border-bolt-elements-borderColor/60">
                      <span className="i-ph:chats-circle-duotone h-9 w-9 text-bolt-elements-textTertiary mb-3" />
                      <div className="text-sm font-medium text-bolt-elements-textSecondary">
                        No chats in this project yet.
                      </div>
                      <div className="text-xs text-bolt-elements-textTertiary mt-1 max-w-[320px]">
                        Start a conversation and it will automatically belong to this project.
                      </div>
                      <a
                        href="/"
                        className="mt-4 flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
                      >
                        <span className="inline-block i-ph:plus-circle h-4 w-4" />
                        <span className="text-sm font-medium">Start Chat</span>
                      </a>
                    </div>
                  </div>

                  {/* Project Actions */}
                  <div>
                    <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                      Project Actions
                    </h2>
                    <div className="flex flex-wrap gap-3">
                      <ActionButton icon="i-ph:github-logo" label="Open GitHub" />
                      <ActionButton icon="i-ph:database" label="Open Supabase" />
                      <ActionButton icon="i-ph:rocket-launch" label="Deploy" />
                      <ActionButton icon="i-ph:sliders-horizontal-duotone" label="Project Settings" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
