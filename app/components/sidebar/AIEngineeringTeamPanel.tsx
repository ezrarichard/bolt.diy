import { classNames } from '~/utils/classNames';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { formatArtifactTimestamp, getResumableArtifact, type ProjectArtifact } from '~/lib/projects/artifacts';
import {
  AUTO_ENGINEERING_ESTIMATED_SECONDS,
  AUTO_ENGINEERING_ROLES,
  isAutoEngineeringComplete,
} from '~/lib/projects/autoEngineeringEngine';
import { useAutoEngineeringPipeline } from '~/lib/hooks/useAutoEngineeringPipeline';
import { useEffect, useState } from 'react';

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

/**
 * Ticks once a second while `activeKey` is defined, resetting to 0 every time `activeKey`
 * itself changes — not just when it flips between defined/undefined. Acceptance-test-verified
 * bugfix: the caller used to pass `currentRoleId !== undefined` (a boolean), which only
 * toggles false->true once at the very start of the whole pipeline and stays `true` across
 * every later role transition — so the "Ns elapsed" line kept counting cumulatively across
 * the entire run (e.g. showing "1130s elapsed" moments after a later stage had only just
 * started) instead of resetting per stage. Passing the role id itself means the effect's
 * dependency changes on every stage transition, giving each stage its own elapsed count.
 */
function useElapsedSeconds(activeKey: string | undefined): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);

    if (activeKey === undefined) {
      return undefined;
    }

    /*
     * Sprint 98A, BUG-014 — elapsed is DERIVED FROM A WALL-CLOCK TIMESTAMP, not accumulated one
     * tick at a time.
     *
     * The previous implementation did `setElapsed(value => value + 1)` on a 1s interval, which
     * silently under-reports whenever the browser throttles timers. Background tabs clamp
     * `setInterval`, and Chrome's intensive throttling drops it to roughly once per minute after
     * five minutes — so during Acceptance Test Round 1 ten minutes of real time displayed as ~37
     * seconds. That misreading is what made a slow-but-healthy generation look stalled and sent
     * the investigation after a throttling bug in the generation loop, which has no timers in it
     * at all.
     *
     * Reading the clock each tick makes the number correct regardless of how often the tick fires.
     */
    const startedAt = Date.now();
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));

    const intervalId = setInterval(update, 1000);

    /* A throttled tab fires timers rarely; re-reading on wake corrects the display immediately. */
    document.addEventListener('visibilitychange', update);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', update);
    };
  }, [activeKey]);

  return elapsed;
}

function TeamRow({ meta, elapsedSeconds }: { meta: RowMeta; elapsedSeconds: number }) {
  const statusMeta = ROW_STATUS_META[meta.status];

  return (
    <li className="py-2.5 px-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={classNames(statusMeta.icon, 'w-4.5 h-4.5 shrink-0', statusMeta.className)} />
          <span className="text-sm font-medium text-bolt-elements-textPrimary truncate">{meta.label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-bolt-elements-textTertiary shrink-0">
          {meta.version !== undefined && <span>v{meta.version}</span>}
          {meta.generatedAt && <span>{formatArtifactTimestamp(meta.generatedAt)}</span>}
          {meta.status === 'pending' && <span>Waiting…</span>}
          {meta.status === 'running' && <span className="text-purple-600 dark:text-purple-400">Working…</span>}
          {meta.status === 'failed' && <span className="text-red-600 dark:text-red-400">Needs attention</span>}
        </div>
      </div>
      {meta.status === 'running' && (
        <div className="mt-1 pl-7 text-[11px] text-purple-600/80 dark:text-purple-400/80">
          {meta.label} is working… {elapsedSeconds}s elapsed (est. ~{AUTO_ENGINEERING_ESTIMATED_SECONDS}s)
        </div>
      )}
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
  const { isRunning, currentRoleId, failure, retry } = useAutoEngineeringPipeline(project);
  const elapsedSeconds = useElapsedSeconds(currentRoleId);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const artifacts = getProjectArtifacts(project);
  const complete = isAutoEngineeringComplete(project);

  const failedRoleLabel = failure
    ? (AUTO_ENGINEERING_ROLES.find((role) => role.id === failure.roleId)?.label ?? 'stage')
    : 'stage';

  const rows: RowMeta[] = [
    {
      label: 'AI Project Manager',
      status: requirementsCaptured ? 'done' : 'pending',
      version: requirementsArtifact?.version,
      generatedAt: requirementsArtifact?.updatedAt,
    },
    ...AUTO_ENGINEERING_ROLES.map((role): RowMeta => {
      // Sprint 46.1 — live-verified bugfix: same resolution as useDraftPanel.ts, so this row's status agrees with what the panel below actually shows (see getResumableArtifact's comment).
      const latest = getResumableArtifact(artifacts, role.artifactType);
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
            Once your Project Definition is approved, the AI Product Owner plans your first MVP and waits for your
            approval (Gate A) — every engineering stage after it then generates, reviews, and approves itself
            automatically.
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
          {complete
            ? 'Complete'
            : isRunning
              ? 'Running'
              : requirementsCaptured
                ? 'Idle'
                : 'Waiting on Project Definition'}
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
            <TeamRow key={row.label} meta={row} elapsedSeconds={elapsedSeconds} />
          ))}
        </ul>
      </div>

      {failure && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-3">
          <div className="text-sm font-medium text-bolt-elements-textPrimary">
            {failure.kind === 'hydration'
              ? "Couldn't load this project's saved progress."
              : `The ${failedRoleLabel} stage was interrupted before completion.`}
          </div>
          <div className="text-xs text-bolt-elements-textTertiary mt-0.5">
            {failure.kind === 'hydration'
              ? 'Retry loading before continuing — starting the AI Engineering Team now could duplicate work already saved.'
              : "Retry this stage to continue your AI engineering pipeline. Your completed stages are safe and won't be regenerated."}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={retry}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50"
            >
              <span className="i-ph:arrow-clockwise w-4 h-4" />
              {isRunning ? 'Retrying…' : failure.kind === 'hydration' ? 'Retry Loading' : `Retry ${failedRoleLabel}`}
            </button>
            <button
              type="button"
              onClick={() => setShowTechnicalDetails((value) => !value)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2 transition-colors"
            >
              {showTechnicalDetails ? 'Hide technical details' : 'View technical details'}
            </button>
          </div>
          {showTechnicalDetails && (
            <div className="mt-2 rounded-md border border-bolt-elements-borderColor/40 bg-bolt-elements-background-depth-2 px-3 py-2 text-[11px] text-bolt-elements-textTertiary break-words">
              {failure.message}
            </div>
          )}
        </div>
      )}

      {/* Sprint 44.1 — the AI team's deliverables are shown here directly, no longer hidden behind an "Advanced" gate. Each stage's own panel still collapses to a summary once approved, so the detail stays available without overwhelming the page. */}
      <div className="mt-6">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary">
          What your AI team produced
        </h3>
        <p className="text-[11px] text-bolt-elements-textTertiary mt-0.5 mb-4">
          Each engineer's work, in order. Open any stage to see the details, or regenerate it if you'd like a different
          direction.
        </p>
        <div className="space-y-6">{children}</div>
      </div>
    </div>
  );
}
