// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';
import type { Mvp } from '~/lib/mvp/mvpTypes';

const { listMvpsForProjectMock, listProductReviewsMock, listRoadmapReviewsMock } = vi.hoisted(() => ({
  listMvpsForProjectMock: vi.fn(),
  listProductReviewsMock: vi.fn(),
  listRoadmapReviewsMock: vi.fn(),
}));

vi.mock('~/lib/mvp/mvpRepository', () => ({
  mvpRepository: { listMvpsForProject: listMvpsForProjectMock },
}));

vi.mock('~/lib/product-review/productReviewRepository', () => ({
  productReviewRepository: { listProductReviews: listProductReviewsMock },
}));

vi.mock('~/lib/roadmap-review/roadmapReviewRepository', () => ({
  roadmapReviewRepository: { listRoadmapReviews: listRoadmapReviewsMock },
}));

const { useProductEvolutionSummary } = await import('./useProductEvolutionSummary');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Riverside Dental Clinic',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    artifacts: [],
    ...overrides,
  } as Project;
}

function makeMvp(overrides: Partial<Mvp> = {}): Mvp {
  return {
    id: 'mvp-1',
    projectId: 'proj-1',
    code: 'MVP-001',
    sequence: 1,
    theme: 'Core booking flow',
    status: 'released',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  listMvpsForProjectMock.mockReset().mockResolvedValue([]);
  listProductReviewsMock.mockReset().mockResolvedValue([]);
  listRoadmapReviewsMock.mockReset().mockResolvedValue([]);
});

describe('useProductEvolutionSummary', () => {
  it('starts loading, then resolves isEmpty for a project with no MVP data', async () => {
    const { result } = renderHook(() => useProductEvolutionSummary(makeProject()));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.liveEntry).toBeUndefined();
  });

  it('resolves the live entry and next action once a released MVP exists', async () => {
    listMvpsForProjectMock.mockResolvedValue([makeMvp({ status: 'released' })]);

    const { result } = renderHook(() => useProductEvolutionSummary(makeProject()));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.liveEntry?.code).toBe('MVP-001');
    expect(result.current.nextAction?.id).toBe('start-product-review');
  });

  it('stays in a stable loading state when no project is supplied', () => {
    const { result } = renderHook(() => useProductEvolutionSummary(undefined));

    expect(result.current.status).toBe('loading');
    expect(listMvpsForProjectMock).not.toHaveBeenCalled();
  });

  it('resolves to an error state, not a thrown exception, when a repository call fails', async () => {
    listMvpsForProjectMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useProductEvolutionSummary(makeProject()));

    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
