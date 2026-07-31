/**
 * Builders Observability / AI Usage — optional spend budgets.
 *
 * Entirely opt-in. With nothing configured the dashboard hides its budget widgets completely
 * rather than showing an empty or zero budget, which is the behaviour the feature brief asks for.
 *
 * Stored in localStorage, not BuildersDB: a budget is a personal display preference for this
 * browser, needs no migration, and must never block the dashboard when BuildersDB is
 * unreachable. Persisting it server-side is a later change if budgets ever become a team-level
 * policy rather than a personal reminder.
 */

import { atom } from 'nanostores';

const STORAGE_KEY = 'builders.observability.aiUsageBudget';

export interface AiUsageBudget {
  /** USD ceiling for the current local day. Undefined = not configured = widget hidden. */
  dailyUsd?: number;

  /** USD ceiling for the current local month. */
  monthlyUsd?: number;
}

const EMPTY_BUDGET: AiUsageBudget = {};

/** A budget must be a positive, finite number — anything else is treated as "not configured". */
function sanitize(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function read(): AiUsageBudget {
  if (typeof localStorage === 'undefined') {
    return EMPTY_BUDGET;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return EMPTY_BUDGET;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return { dailyUsd: sanitize(parsed.dailyUsd), monthlyUsd: sanitize(parsed.monthlyUsd) };
  } catch {
    /* A corrupt value behaves exactly like no value — never throw on read. */
    return EMPTY_BUDGET;
  }
}

export const aiUsageBudgetStore = atom<AiUsageBudget>(read());

export function setAiUsageBudget(budget: AiUsageBudget): void {
  const next: AiUsageBudget = { dailyUsd: sanitize(budget.dailyUsd), monthlyUsd: sanitize(budget.monthlyUsd) };
  aiUsageBudgetStore.set(next);

  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    if (next.dailyUsd === undefined && next.monthlyUsd === undefined) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Storage full or blocked — the in-memory store still reflects the change for this session. */
  }
}

export function hasAnyBudget(budget: AiUsageBudget): boolean {
  return budget.dailyUsd !== undefined || budget.monthlyUsd !== undefined;
}

export interface BudgetProgress {
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  percentUsed: number;

  /** True once spend reaches the limit — the dashboard colours the bar from this, not from a magic number. */
  exceeded: boolean;
}

/**
 * `usedUsd` is null when nothing in the period had a known price. That is NOT zero spend, so the
 * caller shows the budget without a usage figure rather than claiming 0% used.
 */
export function resolveBudgetProgress(limitUsd: number | undefined, usedUsd: number | null): BudgetProgress | null {
  if (limitUsd === undefined || usedUsd === null) {
    return null;
  }

  const percentUsed = Math.round((usedUsd / limitUsd) * 100);

  return {
    limitUsd,
    usedUsd,
    remainingUsd: Math.max(limitUsd - usedUsd, 0),
    percentUsed,
    exceeded: usedUsd >= limitUsd,
  };
}
