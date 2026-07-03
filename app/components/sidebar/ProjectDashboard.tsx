import * as RadixDialog from '@radix-ui/react-dialog';
import { useNavigate } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import { requestChatInputFocus } from '~/lib/stores/projects';
import type { Project } from '~/lib/stores/projects';
import { PROJECT_COLOR_CLASSES } from './ProjectListItem';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { blueprintEngine } from '~/lib/blueprints';

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
  const navigate = useNavigate();

  if (!project) {
    return null;
  }

  const colorClasses = PROJECT_COLOR_CLASSES[project.color] || PROJECT_COLOR_CLASSES.purple;

  /**
   * Sprint 6 — "Start Chat" from the Project Dashboard.
   *
   * Closes the dashboard, keeps the project active (currentProjectIdStore
   * is untouched here — it was already set when the dashboard was opened),
   * client-side navigates to the homepage if we're not already there, and
   * asks the chat textarea to focus itself. No route is created, no
   * message is sent, and no chat persistence is touched — this only moves
   * the user's attention to the existing chat input.
   */
  const handleStartChat = () => {
    onClose();

    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      navigate('/');
    }

    requestChatInputFocus();
  };

  /*
   * Fall back to the Blank Project blueprint (always present in the registry)
   * when the project has no blueprintId, or one that no longer matches a
   * registry entry — satisfies "if no blueprint is found, show Blank Project"
   * while still rendering full structured data rather than a bare string.
   * All blueprint data is read through blueprintEngine, never the registry
   * directly (see app/lib/blueprints/engine.ts).
   */
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();

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
                        rows={[{ label: 'Active', value: blueprint?.name || 'Blank Project' }]}
                      />
                    </div>
                  </div>

                  {/* Blueprint Overview */}
                  {blueprint && (
                    <div>
                      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                        Blueprint Overview
                      </h2>
                      <div
                        className={classNames(
                          'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
                          'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                        )}
                      >
                        <div className="flex items-start gap-3 mb-4">
                          <span className="text-2xl leading-none shrink-0">{blueprint.icon}</span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-bolt-elements-textPrimary">{blueprint.name}</div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-300 font-medium">
                                {blueprintEngine.getBlueprintCategory(blueprint.id)}
                              </span>
                              {blueprintEngine.getBlueprintProductType(blueprint.id) && (
                                <span className="text-xs text-bolt-elements-textTertiary">
                                  {blueprintEngine.getBlueprintProductType(blueprint.id)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                              Recommended Stack
                            </div>
                            {blueprintEngine.getRecommendedStack(blueprint.id).length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {blueprintEngine.getRecommendedStack(blueprint.id).map((item) => (
                                  <span
                                    key={item}
                                    className="text-xs px-2 py-1 rounded-md bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/40 text-bolt-elements-textSecondary"
                                  >
                                    {item}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-bolt-elements-textTertiary">No suggestions yet</div>
                            )}
                          </div>

                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                              Recommended Integrations
                            </div>
                            {blueprintEngine.getRecommendedIntegrations(blueprint.id).length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {blueprintEngine.getRecommendedIntegrations(blueprint.id).map((item) => (
                                  <span
                                    key={item}
                                    className="text-xs px-2 py-1 rounded-md bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/40 text-bolt-elements-textSecondary"
                                  >
                                    {item}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-bolt-elements-textTertiary">No suggestions yet</div>
                            )}
                          </div>

                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                              Recommended Next Steps
                            </div>
                            {blueprintEngine.getRecommendedNextSteps(blueprint.id).length > 0 ? (
                              <ul className="space-y-1.5">
                                {blueprintEngine.getRecommendedNextSteps(blueprint.id).map((step) => (
                                  <li
                                    key={step}
                                    className="flex items-start gap-1.5 text-xs text-bolt-elements-textSecondary"
                                  >
                                    <span className="i-ph:circle-dashed w-3.5 h-3.5 mt-0.5 text-bolt-elements-textTertiary shrink-0" />
                                    {step}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="text-xs text-bolt-elements-textTertiary">No suggestions yet</div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-bolt-elements-borderColor/30 text-[11px] text-bolt-elements-textTertiary">
                          These are recommendations only — nothing here is applied, generated, or connected
                          automatically.
                        </div>
                      </div>
                    </div>
                  )}

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
                      <button
                        type="button"
                        onClick={handleStartChat}
                        className="mt-4 flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
                      >
                        <span className="inline-block i-ph:plus-circle h-4 w-4" />
                        <span className="text-sm font-medium">Start Chat</span>
                      </button>
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
