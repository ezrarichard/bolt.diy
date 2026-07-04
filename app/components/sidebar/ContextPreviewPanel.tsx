import { useState } from 'react';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import {
  buildContextBundle,
  CONTEXT_BUDGET_LIMITS,
  CONTEXT_BUDGETS,
  CONTEXT_ROLE_LABELS,
  CONTEXT_ROLES,
  type ContextBudget,
  type ContextRole,
} from '~/lib/projects/contextEngine';

interface ContextPreviewPanelProps {
  project: Project;
}

/**
 * Sprint 17 — an internal/team-only preview of what `buildContextBundle()`
 * would hand a given AI role: which sections it includes, which it excludes
 * (and why), the estimated token cost, and any warnings. Purely a read over
 * already-approved project data recomputed on every render — no AI call, no
 * store write, no side effects. This is a debugging/design tool for the
 * Builders team while future roles (Backend/Frontend/QA/DevOps Engineer)
 * are built, not a feature end users interact with.
 */
export function ContextPreviewPanel({ project }: ContextPreviewPanelProps) {
  const [role, setRole] = useState<ContextRole>('backend-engineer');
  const [budget, setBudget] = useState<ContextBudget>('medium');

  const bundle = buildContextBundle(project, role, { budget });
  const budgetLimit = CONTEXT_BUDGET_LIMITS[budget];
  const usagePercent = Math.min(100, Math.round((bundle.estimatedTokens / budgetLimit) * 100));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary flex flex-col gap-1">
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as ContextRole)}
            className="bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 rounded-lg px-2 py-1.5 text-sm font-normal normal-case text-bolt-elements-textPrimary"
          >
            {CONTEXT_ROLES.map((contextRole) => (
              <option key={contextRole} value={contextRole}>
                {CONTEXT_ROLE_LABELS[contextRole]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary flex flex-col gap-1">
          Budget
          <select
            value={budget}
            onChange={(event) => setBudget(event.target.value as ContextBudget)}
            className="bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 rounded-lg px-2 py-1.5 text-sm font-normal normal-case text-bolt-elements-textPrimary"
          >
            {CONTEXT_BUDGETS.map((contextBudget) => (
              <option key={contextBudget} value={contextBudget}>
                {contextBudget} ({CONTEXT_BUDGET_LIMITS[contextBudget]} tokens)
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="text-sm text-bolt-elements-textSecondary">{bundle.summary}</div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
          Estimated Tokens
        </div>
        <div className="text-sm text-bolt-elements-textPrimary">
          ~{bundle.estimatedTokens} / {budgetLimit} ({usagePercent}%)
        </div>
      </div>

      {bundle.warnings.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Warnings
          </div>
          {bundle.warnings.map((warning) => (
            <div key={warning} className="text-xs text-amber-600 dark:text-amber-400">
              {warning}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400 mb-1.5">
            Included Sections ({bundle.includedSections.length})
          </div>
          <ul className="space-y-1">
            {bundle.includedSections.map((section) => (
              <li
                key={section.id}
                className={classNames(
                  'text-xs text-bolt-elements-textSecondary flex items-center justify-between gap-2 rounded-md px-2 py-1',
                  'bg-green-500/5 border border-green-500/20',
                )}
              >
                <span>{section.label}</span>
                <span className="text-bolt-elements-textTertiary shrink-0">~{section.estimatedTokens}t</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
            Excluded Sections ({bundle.excludedSections.length})
          </div>
          <ul className="space-y-1">
            {bundle.excludedSections.map((section) => (
              <li
                key={section.id}
                className="text-xs text-bolt-elements-textTertiary rounded-md px-2 py-1 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/40"
              >
                <span className="font-medium text-bolt-elements-textSecondary">{section.label}</span>: {section.reason}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
