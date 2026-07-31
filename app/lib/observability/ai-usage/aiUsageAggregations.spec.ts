import { describe, expect, it } from 'vitest';
import {
  breakdownByProvider,
  breakdownByRole,
  formatRoleLabel,
  resolveRangeStart,
  sumCostSince,
  summarizeUsage,
} from './aiUsageAggregations';
import type { AiUsageEvent } from './aiUsageQueryTypes';

/**
 * The behaviour worth protecting here is the null discipline: "we don't know" and "zero" must
 * never collapse into each other. Every other assertion is ordinary arithmetic.
 */

function event(overrides: Partial<AiUsageEvent> = {}): AiUsageEvent {
  return {
    id: 'evt-1',
    createdAt: '2026-07-31T10:00:00.000Z',
    projectId: 'proj-1',
    requestType: 'architecture',
    roleKey: 'architecture-draft',
    operationId: null,
    provider: 'Anthropic',
    modelKey: 'claude-sonnet-4.6',
    apiModel: 'claude-sonnet-4-6',
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 0,
    cachedOutputTokens: 0,
    totalTokens: 150,
    estimatedCostUsd: null,
    durationMs: 1000,
    status: 'success',
    errorMessage: null,
    ...overrides,
  };
}

describe('summarizeUsage', () => {
  it('sums token counts and counts failures', () => {
    const totals = summarizeUsage([
      event({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      event({ id: 'evt-2', inputTokens: 20, outputTokens: 5, totalTokens: 25, status: 'failed' }),
    ]);

    expect(totals.requests).toBe(2);
    expect(totals.inputTokens).toBe(120);
    expect(totals.outputTokens).toBe(55);
    expect(totals.totalTokens).toBe(175);
    expect(totals.failures).toBe(1);
  });

  it('adds cached input and output tokens into a single cached figure', () => {
    const totals = summarizeUsage([event({ cachedInputTokens: 40, cachedOutputTokens: 2 })]);
    expect(totals.cachedTokens).toBe(42);
  });

  it('reports cost as null when NO event carried a cost, rather than 0', () => {
    const totals = summarizeUsage([event({ estimatedCostUsd: null }), event({ id: 'e2', estimatedCostUsd: null })]);
    expect(totals.estimatedCostUsd).toBeNull();
  });

  it('reports a real 0 cost as 0, not null', () => {
    const totals = summarizeUsage([event({ estimatedCostUsd: 0 })]);
    expect(totals.estimatedCostUsd).toBe(0);
  });

  it('sums only the priced events when cost is partially known', () => {
    const totals = summarizeUsage([
      event({ estimatedCostUsd: 0.25 }),
      event({ id: 'e2', estimatedCostUsd: null }),
      event({ id: 'e3', estimatedCostUsd: 0.5 }),
    ]);
    expect(totals.estimatedCostUsd).toBe(0.75);
  });

  it('averages latency over reporting events only, and is null when none reported', () => {
    expect(summarizeUsage([event({ durationMs: 100 }), event({ id: 'e2', durationMs: null })]).averageLatencyMs).toBe(
      100,
    );
    expect(summarizeUsage([event({ durationMs: null })]).averageLatencyMs).toBeNull();
  });

  it('returns an empty-but-valid summary for no events', () => {
    const totals = summarizeUsage([]);
    expect(totals.requests).toBe(0);
    expect(totals.totalTokens).toBe(0);
    expect(totals.estimatedCostUsd).toBeNull();
    expect(totals.averageLatencyMs).toBeNull();
  });
});

describe('breakdownByProvider', () => {
  it('groups by provider and orders by request count', () => {
    const rows = breakdownByProvider([
      event({ provider: 'Anthropic' }),
      event({ id: 'e2', provider: 'OpenAI' }),
      event({ id: 'e3', provider: 'OpenAI' }),
    ]);

    expect(rows.map((row) => row.key)).toEqual(['OpenAI', 'Anthropic']);
    expect(rows[0].requests).toBe(2);
  });

  it('is provider-agnostic — an unseen provider still appears', () => {
    const rows = breakdownByProvider([event({ provider: 'kimi' })]);
    expect(rows[0].label).toBe('Kimi');
  });
});

describe('breakdownByRole', () => {
  it('falls back to request_type when a call carried no role', () => {
    const rows = breakdownByRole([event({ roleKey: null, requestType: 'quick_chat' })]);
    expect(rows[0].label).toBe('Chat');
  });

  it('groups the paired architecture artifacts under one role', () => {
    const rows = breakdownByRole([
      event({ roleKey: 'architecture-draft' }),
      event({ id: 'e2', roleKey: 'technical-architecture' }),
    ]);

    // Same human role, but they are distinct keys — both must be labelled Solution Architect.
    expect(rows.every((row) => row.label === 'Solution Architect')).toBe(true);
  });
});

describe('formatRoleLabel', () => {
  it('maps every known engineering role to its human name', () => {
    expect(formatRoleLabel('requirements-draft')).toBe('Business Analyst');
    expect(formatRoleLabel('product-owner-draft')).toBe('Product Owner');
    expect(formatRoleLabel('database-draft')).toBe('Database Engineer');
    expect(formatRoleLabel('uiux-draft')).toBe('UI/UX Engineer');
    expect(formatRoleLabel('backend-draft')).toBe('Backend Engineer');
    expect(formatRoleLabel('frontend-draft')).toBe('Frontend Engineer');
    expect(formatRoleLabel('qa-draft')).toBe('QA Engineer');
    expect(formatRoleLabel('devops-draft')).toBe('DevOps Engineer');
  });

  it('degrades gracefully for a role added after this map was written', () => {
    expect(formatRoleLabel('security-engineer-draft')).toBe('Security Engineer Draft');
  });
});

describe('resolveRangeStart', () => {
  const now = new Date(2026, 6, 31, 14, 30); // 31 Jul 2026, local time
  const sessionStart = '2026-07-31T12:00:00.000Z';

  it('uses the session timestamp verbatim for the session range', () => {
    expect(resolveRangeStart('session', sessionStart, now)).toBe(sessionStart);
  });

  it('uses local midnight for today, not UTC midnight', () => {
    expect(resolveRangeStart('today', sessionStart, now)).toBe(new Date(2026, 6, 31).toISOString());
  });

  it('includes today in the 7-day window (6 days back, not 7)', () => {
    expect(resolveRangeStart('7d', sessionStart, now)).toBe(new Date(2026, 6, 25).toISOString());
  });

  it('includes today in the 30-day window', () => {
    expect(resolveRangeStart('30d', sessionStart, now)).toBe(new Date(2026, 6, 2).toISOString());
  });
});

describe('sumCostSince', () => {
  it('counts only events at or after the boundary', () => {
    const events = [
      event({ createdAt: '2026-07-31T09:00:00.000Z', estimatedCostUsd: 1 }),
      event({ id: 'e2', createdAt: '2026-07-31T11:00:00.000Z', estimatedCostUsd: 2 }),
    ];

    expect(sumCostSince(events, '2026-07-31T10:00:00.000Z')).toBe(2);
  });

  it('is null when nothing in the window had a known price', () => {
    expect(sumCostSince([event({ estimatedCostUsd: null })], '2026-07-31T00:00:00.000Z')).toBeNull();
  });
});
