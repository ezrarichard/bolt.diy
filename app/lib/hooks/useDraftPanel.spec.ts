// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';
import type { ProjectArtifact } from '~/lib/projects/artifacts';

/**
 * Sprint 75 — regression coverage for `useDraftPanel`'s optional lockstep artifact pairing
 * (`pairedArtifactType`/`createPairedArtifact`), added so the Database Engineer's DATABASE_DRAFT
 * and DATABASE_SCHEMA artifacts can never drift apart (no draft v3 paired with an approved schema
 * v1 — see the Sprint 75 plan's "Lockstep lifecycle" requirement). Exercises the hook generically
 * (fake artifact types "primary-type"/"paired-type") rather than through the full Database
 * Engineer prompt/LLM pipeline, which is exercised by databaseDesignerEngine.spec.ts instead.
 */

let artifactsById: Record<string, ProjectArtifact> = {};

const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }));

vi.mock('./useGenerateText', () => ({
  useGenerateText: () => ({ generate: generateMock, isGenerating: false }),
}));

vi.mock('~/lib/ai/context/buildersDbContextProvider', () => ({ buildRoleContextBlock: async () => '' }));
vi.mock('~/lib/generation-profiles/generationProfileRepository', () => ({ getRoleGenerateOptions: () => ({}) }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));

vi.mock('~/lib/stores/projects', () => ({
  getProjectArtifacts: () => Object.values(artifactsById),
  addProjectArtifact: (_projectId: string, artifact: ProjectArtifact) => {
    artifactsById[artifact.id] = artifact;
  },
  updateProjectArtifact: (_projectId: string, artifactId: string, partial: Partial<ProjectArtifact>) => {
    artifactsById[artifactId] = { ...artifactsById[artifactId], ...partial, updatedAt: new Date().toISOString() };
  },
}));

const { useDraftPanel } = await import('./useDraftPanel');

function makeArtifact(id: string, type: string, version: number, status: ProjectArtifact['status']): ProjectArtifact {
  return {
    id,
    taskId: 'requirements',
    title: `${type} v${version}`,
    type,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status,
    content: JSON.stringify({ note: 'x' }),
    generatedBy: 'Test Engine',
    version,
  };
}

const project = { id: 'proj-1' } as Project;

describe('useDraftPanel — Sprint 75 lockstep artifact pairing', () => {
  beforeEach(() => {
    artifactsById = {};
    generateMock.mockReset();
    generateMock.mockResolvedValue({ ok: true, text: '{"note":"generated"}' });
  });

  function setup() {
    return renderHook(() =>
      useDraftPanel<{ note: string }, Record<string, never>>({
        project,
        artifactType: 'primary-type',
        titlePrefix: 'Test Draft',
        buildContext: () => ({}),
        buildPrompt: () => ({ system: 's', prompt: 'p' }),
        parseDraft: (rawText) => ({ ok: true, draft: JSON.parse(rawText) }),
        createDraftArtifact: (draft, version) => ({
          id: 'primary-artifact',
          taskId: 'requirements',
          title: `Test Draft v${version}`,
          type: 'primary-type',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'draft',
          content: JSON.stringify(draft),
          generatedBy: 'Test Engine',
          version,
        }),
        pairedArtifactType: 'paired-type',
        createPairedArtifact: (draft, version) => ({
          id: 'paired-artifact',
          taskId: 'requirements',
          title: `Test Schema v${version}`,
          type: 'paired-type',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'draft',
          content: JSON.stringify(draft),
          generatedBy: 'Test Engine',
          version,
        }),
      }),
    );
  }

  it('creates the paired artifact at the same version as the primary artifact on first generation', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.runGeneration();
    });

    expect(artifactsById['primary-artifact'].version).toBe(1);
    expect(artifactsById['paired-artifact'].version).toBe(1);
  });

  it('approving the primary artifact also approves the paired artifact at the matching version', async () => {
    const { result, rerender } = setup();

    await act(async () => {
      await result.current.runGeneration();
    });
    rerender();

    act(() => {
      result.current.handleApprove();
    });

    expect(artifactsById['primary-artifact'].status).toBe('approved');
    expect(artifactsById['paired-artifact'].status).toBe('approved');
  });

  it('discarding the primary artifact also discards the paired artifact', async () => {
    const { result, rerender } = setup();

    await act(async () => {
      await result.current.runGeneration();
    });
    rerender();

    act(() => {
      result.current.handleDiscard();
    });

    expect(artifactsById['primary-artifact'].status).toBe('discarded');
    expect(artifactsById['paired-artifact'].status).toBe('discarded');
  });

  it('regenerating (after approval) bumps both artifacts to the same new version', async () => {
    artifactsById = {
      'primary-artifact': makeArtifact('primary-artifact', 'primary-type', 1, 'approved'),
      'paired-artifact': makeArtifact('paired-artifact', 'paired-type', 1, 'approved'),
    };

    const { result, rerender } = setup();
    rerender();

    await act(async () => {
      await result.current.runGeneration(artifactsById['primary-artifact']);
    });

    expect(artifactsById['primary-artifact'].version).toBe(2);
    expect(artifactsById['paired-artifact'].version).toBe(2);
    expect(artifactsById['primary-artifact'].status).toBe('draft');
    expect(artifactsById['paired-artifact'].status).toBe('draft');
  });

  it('never lets the two artifacts end up at different versions across regenerate -> approve -> regenerate -> discard', async () => {
    const { result, rerender } = setup();

    await act(async () => {
      await result.current.runGeneration();
    });
    rerender();

    act(() => result.current.handleApprove());
    rerender();

    await act(async () => {
      await result.current.runGeneration(artifactsById['primary-artifact']);
    });
    rerender();

    act(() => result.current.handleDiscard());

    expect(artifactsById['primary-artifact'].version).toBe(artifactsById['paired-artifact'].version);
    expect(artifactsById['primary-artifact'].status).toBe(artifactsById['paired-artifact'].status);
  });

  describe('legacy projects — primary artifact exists with no paired artifact at all (pre-Sprint-75 data)', () => {
    function setupLegacyApproved() {
      artifactsById = {
        'primary-artifact': makeArtifact('primary-artifact', 'primary-type', 2, 'approved'),
      };

      return setup();
    }

    it('resumes/renders a legacy artifact with no paired artifact without throwing, and reports no paired content', () => {
      const { result } = setupLegacyApproved();

      expect(() => result.current.latest).not.toThrow();
      expect(result.current.latest?.version).toBe(2);
      expect(result.current.latest?.status).toBe('approved');
      expect(artifactsById['paired-artifact']).toBeUndefined();
    });

    it('approving a legacy pending-draft artifact (no paired artifact yet) succeeds and creates nothing extra', () => {
      artifactsById = {
        'primary-artifact': makeArtifact('primary-artifact', 'primary-type', 2, 'draft'),
      };

      const { result, rerender } = setup();
      rerender();

      expect(() => act(() => result.current.handleApprove())).not.toThrow();

      expect(artifactsById['primary-artifact'].status).toBe('approved');
      expect(artifactsById['paired-artifact']).toBeUndefined();
    });

    it('discarding a legacy artifact (no paired artifact) succeeds without throwing', () => {
      const { result, rerender } = setupLegacyApproved();
      rerender();

      expect(() => act(() => result.current.handleDiscard())).not.toThrow();
      expect(artifactsById['primary-artifact'].status).toBe('discarded');
    });

    it('regenerating a legacy artifact creates a brand-new paired artifact at the same bumped version, establishing lockstep going forward', async () => {
      const { result, rerender } = setupLegacyApproved();
      rerender();

      await act(async () => {
        await result.current.runGeneration(artifactsById['primary-artifact']);
      });

      expect(artifactsById['primary-artifact'].version).toBe(3);
      expect(artifactsById['primary-artifact'].status).toBe('draft');

      // The paired artifact did not exist before regeneration — it must now exist, at the same version.
      expect(artifactsById['paired-artifact']).toBeDefined();
      expect(artifactsById['paired-artifact'].version).toBe(3);
      expect(artifactsById['paired-artifact'].status).toBe('draft');
    });

    it('approving after a legacy-triggered regeneration keeps both artifacts in lockstep from then on', async () => {
      const { result, rerender } = setupLegacyApproved();
      rerender();

      await act(async () => {
        await result.current.runGeneration(artifactsById['primary-artifact']);
      });
      rerender();

      act(() => result.current.handleApprove());

      expect(artifactsById['primary-artifact'].version).toBe(artifactsById['paired-artifact'].version);
      expect(artifactsById['primary-artifact'].status).toBe('approved');
      expect(artifactsById['paired-artifact'].status).toBe('approved');
    });
  });
});
