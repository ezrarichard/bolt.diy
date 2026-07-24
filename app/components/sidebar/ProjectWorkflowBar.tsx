import { classNames } from '~/utils/classNames';
import { Tooltip } from '~/components/ui/Tooltip';

/**
 * Product Experience Sprint / Sprint UX-2 — Dashboard Workflow Shell.
 *
 * Builders' pipeline is a customer journey (Business -> Blueprint -> Plan -> Engineering ->
 * Application), not a list of AI roles. This bar is the one persistent element that always
 * tells the customer "where am I, what's done, what's next" regardless of which tab they're
 * looking at. Purely presentational — every status/icon/description comes from data the
 * caller derives (ProjectDashboard.tsx), nothing here touches the store, an artifact, or an
 * engine. Sprint UX-2 is a visual-only pass over this same component: larger circular nodes,
 * per-stage icons, an animated fill on the connecting line, and hover tooltips replace the
 * original small numbered-pill version — no prop shape changed except the two new optional
 * `icon`/`description` fields below.
 */

export type WorkflowStageStatus = 'complete' | 'active' | 'pending';

export interface WorkflowStage {
  id: string;
  label: string;
  status: WorkflowStageStatus;

  /** Phosphor icon class (e.g. "i-ph:briefcase-duotone"), shown inside the node once it's no longer pending. */
  icon?: string;

  /** One-line description shown under the label on wide screens, and always inside the hover tooltip. */
  description?: string;
}

interface ProjectWorkflowBarProps {
  stages: WorkflowStage[];
  activeTab: string;
  onSelect: (id: string) => void;
}

/**
 * Sprint UX-2.1 — dark-surface node treatment per state (was: solid saturated fills, which
 * read fine on their own but exposed a real bug: the outer `<button>` below never reset its
 * background, so every node sat on the browser's native `buttonface` gray/white — the
 * "white rectangular card" reported. Fixing that (bg-transparent on the button) alone would
 * have left the old solid-fill circles; this also softens them to translucent surfaces + a
 * colored border/glow, matching the rest of the dashboard's dark-glass language instead of
 * flat UI-kit color chips. Sizes/shadow radius unchanged — colors only.
 */
const STATUS_META: Record<WorkflowStageStatus, { nodeClass: string; labelClass: string; ringClass: string }> = {
  complete: {
    nodeClass: 'bg-green-500/15 border-green-500/50 text-green-400 shadow-[0_0_0_4px_rgba(34,197,94,0.10)]',
    labelClass: 'text-green-600 dark:text-green-400',
    ringClass: '',
  },
  active: {
    nodeClass: 'bg-purple-500/20 border-purple-500/60 text-purple-300 scale-110 workflow-node-glow',
    labelClass: 'text-purple-600 dark:text-purple-300',
    ringClass: '',
  },
  pending: {
    nodeClass:
      'bg-bolt-elements-background-depth-2/80 border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary/70',
    labelClass: 'text-bolt-elements-textTertiary',
    ringClass: '',
  },
};

/** One stage node — a large circular icon/check/number, its label + description, and (except for the last stage) a connecting line whose fill animates in once the stage it leads away from completes. */
function StageNode({
  stage,
  index,
  isActiveTab,
  isLast,
  onSelect,
}: {
  stage: WorkflowStage;
  index: number;
  isActiveTab: boolean;
  isLast: boolean;
  onSelect: (id: string) => void;
}) {
  const meta = STATUS_META[stage.status];

  const nodeIcon =
    stage.status === 'complete' ? (
      <span className="i-ph:check-bold w-5 h-5" />
    ) : stage.icon ? (
      <span className={classNames(stage.icon, 'w-5 h-5')} />
    ) : (
      <span className="text-sm font-semibold">{index + 1}</span>
    );

  return (
    <div className={classNames('flex items-start', isLast ? 'flex-none' : 'flex-1')}>
      <Tooltip
        content={
          <div className="max-w-[220px]">
            <div className="text-xs font-semibold">{stage.label}</div>
            {stage.description && <div className="text-[11px] opacity-80 mt-0.5">{stage.description}</div>}
          </div>
        }
        side="bottom"
      >
        <button
          type="button"
          onClick={() => onSelect(stage.id)}
          aria-label={`${stage.label} — ${stage.status === 'complete' ? 'completed' : stage.status === 'active' ? 'in progress' : 'not started yet'}`}
          className="flex flex-col items-center gap-2 shrink-0 group bg-transparent border-0 p-0 appearance-none focus:outline-none"
        >
          <span className="relative flex items-center justify-center">
            {stage.status === 'active' && (
              <span className="absolute inset-0 rounded-full bg-purple-500/50 workflow-node-ping" />
            )}
            <span
              className={classNames(
                'relative flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 transition-all duration-300',
                meta.nodeClass,
                'group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-purple-400 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-bolt-elements-background-depth-1',
              )}
            >
              {nodeIcon}
            </span>
          </span>
          <span className="flex flex-col items-center gap-0.5 max-w-[110px] sm:max-w-[130px]">
            <span
              className={classNames(
                'text-[12.5px] font-semibold whitespace-nowrap transition-colors',
                isActiveTab ? 'text-bolt-elements-textPrimary' : meta.labelClass,
                'group-hover:text-purple-600 dark:group-hover:text-purple-300',
              )}
            >
              {stage.label}
            </span>
            {stage.description && (
              <span className="hidden lg:block text-[10.5px] leading-tight text-center text-bolt-elements-textTertiary/80 truncate w-full">
                {stage.description}
              </span>
            )}
          </span>
        </button>
      </Tooltip>
      {!isLast && (
        <div className="flex-1 h-[3px] mx-1.5 sm:mx-3 mt-[22px] sm:mt-[24px] rounded-full overflow-hidden bg-bolt-elements-borderColor/30">
          <div
            className={classNames(
              'h-full rounded-full transition-[width] duration-700 ease-out',
              stage.status === 'complete' ? 'w-full bg-green-500' : 'w-0 bg-purple-500',
            )}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Persistent workflow progress bar — Business, Blueprint, Plan, Engineering, Application.
 * `activeTab` only affects which node reads as "currently viewing" (text color) — a node's
 * check/dot/icon always reflects real progress (`stage.status`), never which tab is open, so
 * this stays honest even when the customer is browsing a stage they already completed.
 */
export function ProjectWorkflowBar({ stages, activeTab, onSelect }: ProjectWorkflowBarProps) {
  return (
    <div className="px-5 sm:px-8 py-5 sm:py-6 border-b border-bolt-elements-borderColor/40 bg-gradient-to-b from-bolt-elements-background-depth-2/40 to-transparent">
      <div className="flex items-start max-w-full">
        {stages.map((stage, index) => (
          <StageNode
            key={stage.id}
            stage={stage}
            index={index}
            isActiveTab={activeTab === stage.id}
            isLast={index === stages.length - 1}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
