/**
 * Builders Design System (Sprint 69) — the single shared status vocabulary.
 *
 * Before this sprint, "status" coloring was independently reinvented at least five times
 * (`ProjectDashboard.tsx`'s `ROADMAP_STATUS_META`, `ProjectTaskCard.tsx`'s `TASK_STATUS_META`,
 * `ReviewComponents.tsx`'s inline approved/changes-requested map, `ProjectWorkflowBar.tsx`'s
 * `STATUS_META`, and `app/components/ui/StatusIndicator.tsx`'s `STATUS_COLORS`) — each picking
 * its own shade of green/red with no shared token or icon. This module is the one place that
 * mapping lives now: a status key -> { label, icon, token CSS classes }. `BuildersStatusBadge`
 * consumes it directly; call sites migrating off a bespoke status map (see Part 12 of the
 * sprint brief) should map their own status union onto `BuildersStatus` and use this instead of
 * hand-rolling colors again.
 *
 * Icon + label are mandatory alongside color on every status (never color-only), per the
 * Accessibility section of the Design System doc.
 */

export type BuildersStatus =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'active'
  | 'pending'
  | 'completed'
  | 'blocked'
  | 'approval'
  | 'working';

export interface BuildersStatusMeta {
  label: string;
  icon: string;
  textClass: string;
  borderClass: string;
  bgClass: string;

  /** True only for statuses that represent ongoing activity — drives the optional spin animation, itself reduced-motion-safe. */
  animated?: boolean;
}

export const BUILDERS_STATUS_META: Record<BuildersStatus, BuildersStatusMeta> = {
  success: {
    label: 'Success',
    icon: 'i-ph:check-circle-fill',
    textClass: 'text-builders-status-success-text',
    borderClass: 'border-builders-status-success-border',
    bgClass: 'bg-builders-status-success-bg',
  },
  warning: {
    label: 'Warning',
    icon: 'i-ph:warning-fill',
    textClass: 'text-builders-status-warning-text',
    borderClass: 'border-builders-status-warning-border',
    bgClass: 'bg-builders-status-warning-bg',
  },
  error: {
    label: 'Error',
    icon: 'i-ph:x-circle-fill',
    textClass: 'text-builders-status-error-text',
    borderClass: 'border-builders-status-error-border',
    bgClass: 'bg-builders-status-error-bg',
  },
  info: {
    label: 'Info',
    icon: 'i-ph:info-fill',
    textClass: 'text-builders-status-info-text',
    borderClass: 'border-builders-status-info-border',
    bgClass: 'bg-builders-status-info-bg',
  },
  active: {
    label: 'Active',
    icon: 'i-ph:circle-fill',
    textClass: 'text-builders-status-active-text',
    borderClass: 'border-builders-status-active-border',
    bgClass: 'bg-builders-status-active-bg',
  },
  pending: {
    label: 'Pending',
    icon: 'i-ph:clock-fill',
    textClass: 'text-builders-status-pending-text',
    borderClass: 'border-builders-status-pending-border',
    bgClass: 'bg-builders-status-pending-bg',
  },
  completed: {
    label: 'Completed',
    icon: 'i-ph:check-circle-fill',
    textClass: 'text-builders-status-completed-text',
    borderClass: 'border-builders-status-completed-border',
    bgClass: 'bg-builders-status-completed-bg',
  },
  blocked: {
    label: 'Blocked',
    icon: 'i-ph:prohibit-fill',
    textClass: 'text-builders-status-blocked-text',
    borderClass: 'border-builders-status-blocked-border',
    bgClass: 'bg-builders-status-blocked-bg',
  },
  approval: {
    label: 'Approval Required',
    icon: 'i-ph:hourglass-medium-fill',
    textClass: 'text-builders-status-approval-text',
    borderClass: 'border-builders-status-approval-border',
    bgClass: 'bg-builders-status-approval-bg',
  },
  working: {
    label: 'Working',
    icon: 'i-ph:spinner-gap-bold',
    textClass: 'text-builders-status-working-text',
    borderClass: 'border-builders-status-working-border',
    bgClass: 'bg-builders-status-working-bg',
    animated: true,
  },
};
