import { describe, expect, it } from 'vitest';
import {
  analyzePerformance,
  analyzeProjects,
  groupIntoGenerations,
  topExpensiveOperations,
  topModels,
  topRoles,
} from './aiUsageAnalytics';
import type { AiUsageEvent } from './aiUsageQueryTypes';

/**
 * The behaviour worth protecting: exact and inferred generation grouping must never mix, null
 * must never collapse into zero, and rates over an empty set must stay null rather than reading
 * as a confident 100%.
 */

let seq = 0;

function event(overrides: Partial<AiUsageEvent> = {}): AiUsageEvent {
  seq += 1;

  return {
    id: `evt-${seq}`,
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

describe('analyzeProjects', () => {
  it('rolls up per project, highest usage first', () => {
    const rows = analyzeProjects([
      event({ projectId: 'a' }),
      event({ projectId: 'b' }),
      event({ projectId: 'b' }),
      event({ projectId: 'b' }),
    ]);

    expect(rows.map((row) => row.projectId)).toEqual(['b', 'a']);
    expect(rows[0].requests).toBe(3);
  });

  it('excludes events with no project rather than inventing a placeholder project', () => {
    expect(analyzeProjects([event({ projectId: null })])).toHaveLength(0);
  });

  it('reports the most recent activity timestamp', () => {
    const rows = analyzeProjects([
      event({ createdAt: '2026-07-31T09:00:00.000Z' }),
      event({ createdAt: '2026-07-31T12:00:00.000Z' }),
      event({ createdAt: '2026-07-31T11:00:00.000Z' }),
    ]);

    expect(rows[0].lastActivityAt).toBe('2026-07-31T12:00:00.000Z');
  });
});

describe('groupIntoGenerations', () => {
  it('groups exactly on operation_id and marks the generation exact', () => {
    const generations = groupIntoGenerations([
      event({ operationId: 'gen_1', roleKey: 'requirements-draft' }),
      event({ operationId: 'gen_1', roleKey: 'architecture-draft' }),
      event({ operationId: 'gen_2', roleKey: 'requirements-draft' }),
    ]);

    expect(generations).toHaveLength(2);

    const first = generations.find((generation) => generation.id === 'gen_1');
    expect(first?.grouping).toBe('exact');
    expect(first?.totals.requests).toBe(2);
    expect(first?.stages).toHaveLength(2);
  });

  it('ignores the time gap for exact generations — a long pause does not split them', () => {
    const generations = groupIntoGenerations([
      event({ operationId: 'gen_1', createdAt: '2026-07-31T10:00:00.000Z' }),
      event({ operationId: 'gen_1', createdAt: '2026-07-31T23:00:00.000Z' }),
    ]);

    expect(generations).toHaveLength(1);
    expect(generations[0].grouping).toBe('exact');
  });

  it('infers generations for legacy rows by project and time gap', () => {
    const generations = groupIntoGenerations([
      event({ createdAt: '2026-07-31T10:00:00.000Z' }),
      event({ createdAt: '2026-07-31T10:01:00.000Z' }),
      event({ createdAt: '2026-07-31T14:00:00.000Z' }), // well past the gap
    ]);

    expect(generations).toHaveLength(2);
    expect(generations.every((generation) => generation.grouping === 'inferred')).toBe(true);
  });

  it('never merges legacy rows into an exact generation', () => {
    const generations = groupIntoGenerations([
      event({ operationId: 'gen_1', createdAt: '2026-07-31T10:00:00.000Z' }),
      event({ operationId: null, createdAt: '2026-07-31T10:00:30.000Z' }),
    ]);

    expect(generations).toHaveLength(2);
    expect(generations.map((generation) => generation.grouping).sort()).toEqual(['exact', 'inferred']);
  });

  it('keeps inferred generations separate per project even when concurrent', () => {
    const generations = groupIntoGenerations([
      event({ projectId: 'a', createdAt: '2026-07-31T10:00:00.000Z' }),
      event({ projectId: 'b', createdAt: '2026-07-31T10:00:10.000Z' }),
    ]);

    expect(generations).toHaveLength(2);
  });

  it('drops legacy rows that have neither an operation nor a project', () => {
    expect(groupIntoGenerations([event({ projectId: null, operationId: null })])).toHaveLength(0);
  });

  it('marks a generation failed when any request failed, ahead of cancelled', () => {
    const [generation] = groupIntoGenerations([
      event({ operationId: 'g', status: 'success' }),
      event({ operationId: 'g', status: 'cancelled' }),
      event({ operationId: 'g', status: 'failed' }),
    ]);

    expect(generation.status).toBe('failed');
  });

  it('separates wall-clock elapsed time from time spent inside AI calls', () => {
    const [generation] = groupIntoGenerations([
      event({ operationId: 'g', createdAt: '2026-07-31T10:00:00.000Z', durationMs: 1000 }),
      event({ operationId: 'g', createdAt: '2026-07-31T10:01:00.000Z', durationMs: 2000 }),
    ]);

    expect(generation.elapsedMs).toBe(60_000);
    expect(generation.aiTimeMs).toBe(3000);
  });

  it('orders generations newest first', () => {
    const generations = groupIntoGenerations([
      event({ operationId: 'old', createdAt: '2026-07-30T10:00:00.000Z' }),
      event({ operationId: 'new', createdAt: '2026-07-31T10:00:00.000Z' }),
    ]);

    expect(generations[0].id).toBe('new');
  });
});

describe('analyzePerformance', () => {
  it('identifies the fastest and slowest roles by average latency', () => {
    const metrics = analyzePerformance([
      event({ roleKey: 'qa-draft', durationMs: 500 }),
      event({ roleKey: 'backend-draft', durationMs: 4000 }),
    ]);

    expect(metrics.fastestRole?.label).toBe('QA Engineer');
    expect(metrics.slowestRole?.label).toBe('Backend Engineer');
  });

  it('computes success and failure rates', () => {
    const metrics = analyzePerformance([
      event({ status: 'success' }),
      event({ status: 'success' }),
      event({ status: 'success' }),
      event({ status: 'failed' }),
    ]);

    expect(metrics.successRatePercent).toBe(75);
    expect(metrics.failureRatePercent).toBe(25);
  });

  it('reports null rates for an empty set rather than a confident 100%', () => {
    const metrics = analyzePerformance([]);
    expect(metrics.successRatePercent).toBeNull();
    expect(metrics.failureRatePercent).toBeNull();
    expect(metrics.averageTokensPerRequest).toBeNull();
    expect(metrics.averageCostPerRequest).toBeNull();
  });

  it('averages cost over priced requests only, not over every request', () => {
    const metrics = analyzePerformance([
      event({ estimatedCostUsd: 1 }),
      event({ estimatedCostUsd: null }),
      event({ estimatedCostUsd: null }),
    ]);

    expect(metrics.averageCostPerRequest).toBe(1);
  });

  it('counts a repeat of the same role in one generation as a retry', () => {
    const metrics = analyzePerformance([
      event({ operationId: 'g', roleKey: 'architecture-draft' }),
      event({ operationId: 'g', roleKey: 'architecture-draft' }),
      event({ operationId: 'g', roleKey: 'qa-draft' }),
    ]);

    expect(metrics.retryCount).toBe(1);
  });

  it('counts repairs and timeouts from the data rather than a separate store', () => {
    const metrics = analyzePerformance([
      event({ requestType: 'repair' }),
      event({ status: 'failed', errorMessage: 'Request timed out after 60s' }),
    ]);

    expect(metrics.repairCount).toBe(1);
    expect(metrics.timeoutCount).toBe(1);
  });

  it('leaves requests-per-minute null when every request shares one timestamp', () => {
    const metrics = analyzePerformance([event(), event()]);
    expect(metrics.requestsPerMinute).toBeNull();
  });

  it('computes requests per minute across a real span', () => {
    const metrics = analyzePerformance([
      event({ createdAt: '2026-07-31T10:00:00.000Z' }),
      event({ createdAt: '2026-07-31T10:02:00.000Z' }),
    ]);

    expect(metrics.requestsPerMinute).toBe(1);
  });
});

describe('top lists', () => {
  it('ranks models and roles by request count', () => {
    const events = [event({ apiModel: 'a' }), event({ apiModel: 'b' }), event({ apiModel: 'b' })];
    expect(topModels(events)[0].key).toBe('b');
    expect(topRoles(events)[0].label).toBe('Solution Architect');
  });

  it('ranks expensive operations by cost, sorting unpriced groups last', () => {
    const rows = topExpensiveOperations([
      event({ requestType: 'cheap', estimatedCostUsd: 0.1 }),
      event({ requestType: 'pricey', estimatedCostUsd: 5 }),
      event({ requestType: 'unpriced', estimatedCostUsd: null }),
    ]);

    expect(rows[0].key).toBe('pricey');
    expect(rows[rows.length - 1].key).toBe('unpriced');
  });
});
