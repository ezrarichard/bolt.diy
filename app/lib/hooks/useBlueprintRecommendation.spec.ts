// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { DiscoveryIntelligenceState } from './useDiscoveryIntelligence';

const { resolveAndRecordBlueprintMock, getLatestBlueprintResolutionMock, selectBlueprintMock } = vi.hoisted(() => ({
  resolveAndRecordBlueprintMock: vi.fn(),
  getLatestBlueprintResolutionMock: vi.fn(),
  selectBlueprintMock: vi.fn(),
}));

vi.mock('~/lib/projects/blueprintResolutionService', () => ({
  resolveAndRecordBlueprint: resolveAndRecordBlueprintMock,
  getLatestBlueprintResolution: getLatestBlueprintResolutionMock,
  selectBlueprint: selectBlueprintMock,
}));

const { useBlueprintRecommendation } = await import('./useBlueprintRecommendation');

function readyDiscovery(decisionState: string, updatedAt = '2026-07-31T00:00:00.000Z'): DiscoveryIntelligenceState {
  return {
    status: 'ready',
    session: { id: 'session-1' } as any,
    model: { decision: { state: decisionState }, updatedAt } as any,
  };
}

function makeResolution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    projectId: 'proj-1',
    sessionId: 'session-1',
    recommendedBlueprintId: 'business-website',
    selectedBlueprintId: 'business-website',
    confidence: 80,
    explanation: ['Local service business'],
    candidates: [],
    resolvedAt: '2026-07-31T00:00:00.000Z',
    createdAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('useBlueprintRecommendation', () => {
  beforeEach(() => {
    resolveAndRecordBlueprintMock.mockReset();
    getLatestBlueprintResolutionMock.mockReset();
    selectBlueprintMock.mockReset();
  });

  it('stays hidden when discovery has not loaded a session/model yet', async () => {
    const { result } = renderHook(() => useBlueprintRecommendation('proj-1', { status: 'loading' }));

    await waitFor(() => expect(result.current.state.status).toBe('hidden'));
    expect(getLatestBlueprintResolutionMock).not.toHaveBeenCalled();
  });

  it('shows an existing resolution without re-running the engine', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());

    const { result } = renderHook(() => useBlueprintRecommendation('proj-1', readyDiscovery('READY')));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(resolveAndRecordBlueprintMock).not.toHaveBeenCalled();

    if (result.current.state.status === 'ready') {
      expect(result.current.state.resolution.id).toBe('res-1');
    }
  });

  it('auto-resolves once when Discovery is READY and no resolution exists yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(null);
    resolveAndRecordBlueprintMock.mockResolvedValue({
      result: { candidates: [], recommendedBlueprintId: 'business-website', resolvedAt: '2026-07-31T00:00:00.000Z' },
      persisted: makeResolution(),
    });

    const { result } = renderHook(() => useBlueprintRecommendation('proj-1', readyDiscovery('READY')));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(resolveAndRecordBlueprintMock).toHaveBeenCalledTimes(1);
    expect(resolveAndRecordBlueprintMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', sessionId: 'session-1' }),
    );
  });

  it('stays hidden (never auto-resolves) when Discovery has not reached READY yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(null);

    const { result } = renderHook(() => useBlueprintRecommendation('proj-1', readyDiscovery('NEEDS_MORE_INFORMATION')));

    await waitFor(() => expect(result.current.state.status).toBe('hidden'));
    expect(resolveAndRecordBlueprintMock).not.toHaveBeenCalled();
  });

  it('surfaces an error rather than silently failing when persistence fails', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(null);
    resolveAndRecordBlueprintMock.mockResolvedValue({
      result: { candidates: [], recommendedBlueprintId: 'business-website', resolvedAt: '2026-07-31T00:00:00.000Z' },
      persisted: null,
    });

    const { result } = renderHook(() => useBlueprintRecommendation('proj-1', readyDiscovery('READY')));

    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });

  describe('selectBlueprint / resetToRecommendation', () => {
    it('records a manual override and reflects it locally without a new resolution row', async () => {
      getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
      selectBlueprintMock.mockResolvedValue(true);

      const { result } = renderHook(() => useBlueprintRecommendation('proj-1', readyDiscovery('READY')));
      await waitFor(() => expect(result.current.state.status).toBe('ready'));

      await result.current.selectBlueprint('localshop-india');

      expect(selectBlueprintMock).toHaveBeenCalledWith('res-1', 'localshop-india');
      await waitFor(() => {
        expect(result.current.state.status === 'ready' && result.current.state.resolution.selectedBlueprintId).toBe(
          'localshop-india',
        );
      });
      expect(result.current.state.status === 'ready' && result.current.state.resolution.recommendedBlueprintId).toBe(
        'business-website',
      );
    });

    it('resetToRecommendation selects the recommended blueprint id', async () => {
      getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'localshop-india' }));
      selectBlueprintMock.mockResolvedValue(true);

      const { result } = renderHook(() => useBlueprintRecommendation('proj-1', readyDiscovery('READY')));
      await waitFor(() => expect(result.current.state.status).toBe('ready'));

      await result.current.resetToRecommendation();

      expect(selectBlueprintMock).toHaveBeenCalledWith('res-1', 'business-website');
    });
  });
});
