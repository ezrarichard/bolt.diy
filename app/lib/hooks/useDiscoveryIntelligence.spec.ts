// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { isBuildersDbAvailableMock, getLatestRequirementsSessionMock, getBusinessUnderstandingModelMock } = vi.hoisted(
  () => ({
    isBuildersDbAvailableMock: vi.fn(),
    getLatestRequirementsSessionMock: vi.fn(),
    getBusinessUnderstandingModelMock: vi.fn(),
  }),
);

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  isBuildersDbAvailable: isBuildersDbAvailableMock,
}));

vi.mock('~/lib/builders-db/repositories/requirementsSessionRepository', () => ({
  getLatestRequirementsSession: getLatestRequirementsSessionMock,
}));

vi.mock('~/lib/builders-db/repositories/businessUnderstandingRepository', () => ({
  getBusinessUnderstandingModel: getBusinessUnderstandingModelMock,
}));

const { useDiscoveryIntelligence } = await import('./useDiscoveryIntelligence');

describe('useDiscoveryIntelligence', () => {
  beforeEach(() => {
    isBuildersDbAvailableMock.mockReset().mockReturnValue(true);
    getLatestRequirementsSessionMock.mockReset();
    getBusinessUnderstandingModelMock.mockReset();
  });

  it('starts in loading state', () => {
    getLatestRequirementsSessionMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDiscoveryIntelligence('proj-1', 0));

    expect(result.current.status).toBe('loading');
  });

  it('resolves to unavailable when BuildersDB is not configured', async () => {
    isBuildersDbAvailableMock.mockReturnValue(false);

    const { result } = renderHook(() => useDiscoveryIntelligence('proj-1', 0));

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(getLatestRequirementsSessionMock).not.toHaveBeenCalled();
  });

  it('resolves to no-session for a legacy project with no Requirements Session', async () => {
    getLatestRequirementsSessionMock.mockResolvedValue(null);

    const { result } = renderHook(() => useDiscoveryIntelligence('proj-1', 0));

    await waitFor(() => expect(result.current.status).toBe('no-session'));
  });

  it('resolves to no-model when a session exists but has no Business Understanding Model yet', async () => {
    getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
    getBusinessUnderstandingModelMock.mockResolvedValue(null);

    const { result } = renderHook(() => useDiscoveryIntelligence('proj-1', 0));

    await waitFor(() => expect(result.current.status).toBe('no-model'));
  });

  it('resolves to ready with the session and model once both load', async () => {
    const session = { id: 'session-1', assessmentConfidence: 'high' };
    const model = { id: 'model-1', decision: { state: 'READY' }, assessment: {} };
    getLatestRequirementsSessionMock.mockResolvedValue(session);
    getBusinessUnderstandingModelMock.mockResolvedValue(model);

    const { result } = renderHook(() => useDiscoveryIntelligence('proj-1', 0));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    if (result.current.status === 'ready') {
      expect(result.current.session).toBe(session);
      expect(result.current.model).toBe(model);
    }
  });

  it('resolves to error (never throws) when a repository call rejects', async () => {
    getLatestRequirementsSessionMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useDiscoveryIntelligence('proj-1', 0));

    await waitFor(() => expect(result.current.status).toBe('error'));

    if (result.current.status === 'error') {
      expect(result.current.message).toBe('network down');
    }
  });

  it('re-fetches when refreshKey changes', async () => {
    getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
    getBusinessUnderstandingModelMock.mockResolvedValue({ id: 'model-1', decision: {}, assessment: {} });

    const { result, rerender } = renderHook(({ key }) => useDiscoveryIntelligence('proj-1', key), {
      initialProps: { key: 0 },
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getLatestRequirementsSessionMock).toHaveBeenCalledTimes(1);

    rerender({ key: 1 });

    await waitFor(() => expect(getLatestRequirementsSessionMock).toHaveBeenCalledTimes(2));
  });

  it('resets to loading and does not flash the previous project data when the project id changes', async () => {
    const projectASession = { id: 'session-a' };
    const projectAModel = { id: 'model-a', decision: { state: 'READY' }, assessment: {} };
    getLatestRequirementsSessionMock.mockResolvedValueOnce(projectASession);
    getBusinessUnderstandingModelMock.mockResolvedValueOnce(projectAModel);

    const { result, rerender } = renderHook(({ projectId }) => useDiscoveryIntelligence(projectId, 0), {
      initialProps: { projectId: 'proj-a' },
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Switching projects: the very next read must never show proj-a's 'ready' data again.
    let neverFulfilled: () => void = () => {};
    getLatestRequirementsSessionMock.mockReturnValue(new Promise((resolve) => (neverFulfilled = () => resolve(null))));

    rerender({ projectId: 'proj-b' });

    expect(result.current.status).toBe('loading');
    neverFulfilled();
  });
});
