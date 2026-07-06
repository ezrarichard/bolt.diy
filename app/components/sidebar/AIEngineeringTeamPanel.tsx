import { classNames } from '~/utils/classNames';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { formatArtifactTimestamp, getLatestArtifact, type ProjectArtifact } from '~/lib/projects/artifacts';
import { AUTO_ENGINEERING_ROLES, isAutoEngineeringComplete } from '~/lib/projects/autoEngineeringEngine';
import { useAutoEngineeringPipeline } from '~/lib/hooks/useAutoEngineeringPipeline';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/Collapsible';
import { useState } from 'react';

interface AiEngineeringTeamPanelProps {
  project: Project;
  requirementsCaptured: boolean;
  requirementsArtifact: ProjectArtifact | undefined;

  /** The existing per-stage EngineeringStageSection + "*DraftPanel" JSX (Architecture through DevOps), rendered completely unchanged — this component only decides whether it's visible by default. */
  children: React.ReactNode;
}

type RowStatus = 'done' | 'running' | 'failed' | 'pending';

interface RowMeta {
  label: string;
  status: RowStatus;
  version: number | undefined;
  generatedAt: string | undefined;
}

const ROW_STATUS_META: Record<RowStatus, { icon: string; className: string }> = {
  done: { icon: 'i-ph:check-circle-duotone', className: 'text-green-600 dark:text-green-400' },
  running: { icon: 'i-ph:spinner-gap animate-spin', className: 'text-purple-600 dark:text-purple-400' },
  failed: { icon: 'i-ph:x-circle-duotone', className: 'text-red-600 dark:text-red-400' },
  pending: { icon: 'i-ph:circle-dashed', className: 'text-bolt-elements-textTertiary' },
};

function TeamRow({ meta }: { meta: RowMeta }) {
  const statusMeta = ROW_STATUS_META[meta.status];

  return (
    <li className="flex items-center justify-between gap-3 py-2.5 px-1">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={classNames(statusMeta.icon, 'w-4.5 h-4.5 shrink-0', statusMeta.className)} />
        <span className="text-sm font-medium text-bolt-elements-textPrimary truncate">{meta.label}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-bolt-elements-textTertiary shrink-0">
        {meta.version !== undefined && <span>v{meta.version}</span>}
        {meta.generatedAt && <span>{formatArtifactTimestamp(meta.generatedAt)}</span>}
        {meta.status === 'pending' && <span>Waiting</span>}
        {meta.status === 'running' && <span className="text-purple-600 dark:text-purple-400">Generating…</span>}
        {meta.status === 'failed' && <span className="text-red-600 dark:text-red-400">Failed</span>}
      </div>
    </li>
  );
}

/**
 * Sprint 31 — replaces per-stage "Generate"/"Approve" buttons with a
 * read-only status checklist for the AI Engineering Team (Solution
 * Architect through DevOps Engineer), plus the Business Analyst/Requirements
 * stage for a complete picture. Drives the autonomous chain itself via
 * useAutoEngineeringPipeline — the moment Requirements is captured, this
 * component's mount is what kicks the pipeline off; no separate "Start"
 * button exists because there is no user action left to take between
 * stages.
 *
 * Nothing is lost: the existing per-stage panels (draft content, Regenerate,
 * manual Approve/Discard for power users who want to override the AI's own
 * self-approval) are rendered exactly as before, just moved behind the
 * "View AI Decisions" collapsible below instead of always-open.
 */
export function AiEngineeringTeamPanel({
  project,
  requirementsCaptured,
  requirementsArtifact,
  children,
}: AiEngineeringTeamPanelProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const { isRunning, currentRoleId, failure } = useAutoEngineeringPipeline(project);
  const artifacts = getProjectArtifacts(project);
  const complete = isAutoEngineeringComplete(project);

  const rows: RowMeta[] = [
    {
      label: 'Business Analyst',
      status: requirementsCaptured ? 'done' : 'pending',
      version: requirementsArtifact?.version,
      generatedAt: requirementsArtifact?.updatedAt,
    },
    ...AUTO_ENGINEERING_ROLES.map((role): RowMeta => {
      const latest = getLatestArtifact(artifacts, role.artifactType);
      const isApproved = latest?.status === 'approved';

      let status: RowStatus = 'pending';

      if (isApproved) {
        status = 'done';
      } else if (currentRoleId === role.id) {
        status = 'running';
      } else if (failure?.roleId === role.id) {
        status = 'failed';
      }

      return {
        label: role.label,
        status,
        version: latest?.version,
        generatedAt: latest?.updatedAt,
      };
    }),
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary">
            AI Engineering Team
          </h3>
          <p className="text-[11px] text-bolt-elements-textTertiary mt-0.5">
            Once Requirements is approved, every stage below generates, reviews, and approves itself automatically — no
            manual approval required.
          </p>
        </div>
        <span
          className={classNames(
            'text-[11px] font-medium uppercase tracking-wide px-2.5 py-1 rounded-full border shrink-0',
            complete
              ? 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10'
              : isRunning
                ? 'text-purple-600 dark:text-purple-400 border-purple-500/30 bg-purple-500/10'
                : 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
          )}
        >
          {complete ? 'Complete' : isRunning ? 'Running' : requirementsCaptured ? 'Idle' : 'Waiting on Requirements'}
        </span>
      </div>

      <div
        className={classNames(
          'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] px-4',
          'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md divide-y divide-bolt-elements-borderColor/20',
        )}
      >
        <ul className="divide-y divide-bolt-elements-borderColor/20">
          {rows.map((row) => (
            <TeamRow key={row.label} meta={row} />
          ))}
        </ul>
      </div>

      {failure && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-400">
          The pipeline stopped at a failed stage — {failure.message} Open "View AI Decisions" below to regenerate or
          approve that stage manually; the pipeline resumes automatically from there.
        </div>
      )}

      <div className="mt-4">
        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <div
            className={classNames(
              'rounded-xl border border-dashed border-bolt-elements-borderColor/50 p-5',
              'bg-[#F7F7F8]/60 dark:bg-[#161616]/60 backdrop-blur-md',
            )}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between gap-3 bg-transparent text-left appearance-none focus:outline-none"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={classNames(
                      'i-ph:caret-right w-3.5 h-3.5 text-bolt-elements-textTertiary transition-transform duration-150',
                      isAdvancedOpen && 'rotate-90',
                    )}
                  />
                  <span className="text-sm font-semibold text-bolt-elements-textPrimary">View AI Decisions</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary">
                    Advanced
                  </span>
                </div>
                <span className="text-xs text-bolt-elements-textTertiary">{isAdvancedOpen ? 'Hide' : 'Show'}</span>
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="mt-5 pt-5 border-t border-bolt-elements-borderColor/30 space-y-6">
                <p className="text-[11px] text-bolt-elements-textTertiary">
                  Every engineering document exactly as before — regenerate, approve, or discard any stage manually if
                  you want to override what the AI Engineering Team decided. Nothing here is required; the pipeline
                  above already ran every stage automatically.
                </p>
                {children}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>
    </div>
  );
}
