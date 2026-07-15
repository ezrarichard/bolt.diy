import { describe, expect, it } from 'vitest';
import { resolvePipelineHydrationGate } from './pipelineHydrationGate';
import type { ProjectHydrationState } from './hydration';

function state(patch: Partial<ProjectHydrationState>): ProjectHydrationState {
  return {
    status: 'not_started',
    userId: null,
    hydratedAt: null,
    error: null,
    usedLocalFallback: false,
    ...patch,
  };
}

describe('resolvePipelineHydrationGate', () => {
  it('triggers hydration when not_started', () => {
    expect(resolvePipelineHydrationGate(state({ status: 'not_started' }), 0)).toEqual({
      action: 'trigger-hydration',
    });
  });

  it('waits while hydration is loading, regardless of local artifact count', () => {
    expect(resolvePipelineHydrationGate(state({ status: 'loading' }), 0)).toEqual({ action: 'wait' });
    expect(resolvePipelineHydrationGate(state({ status: 'loading' }), 5)).toEqual({ action: 'wait' });
  });

  it('blocks with the hydration error when failed and no local artifacts exist', () => {
    const result = resolvePipelineHydrationGate(state({ status: 'failed', error: 'network unreachable' }), 0);
    expect(result).toEqual({ action: 'block', message: 'network unreachable' });
  });

  it('blocks with a fallback message when failed and no error message was recorded', () => {
    const result = resolvePipelineHydrationGate(state({ status: 'failed', error: null }), 0);
    expect(result.action).toBe('block');
    expect((result as { message: string }).message).toMatch(/saved progress/i);
  });

  it('proceeds (local fallback) when failed but local artifacts already exist', () => {
    expect(resolvePipelineHydrationGate(state({ status: 'failed', error: 'boom' }), 3)).toEqual({
      action: 'proceed',
    });
  });

  it('proceeds when ready', () => {
    expect(resolvePipelineHydrationGate(state({ status: 'ready' }), 0)).toEqual({ action: 'proceed' });
    expect(resolvePipelineHydrationGate(state({ status: 'ready' }), 4)).toEqual({ action: 'proceed' });
  });
});
