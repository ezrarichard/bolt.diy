import { describe, expect, it } from 'vitest';
import { runGenerationPipeline, type GenerationPhaseHooks } from './generationPipeline';
import type { GenerateFn } from './codeGenerationTypes';
import type { Project } from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import type { BackendModulePlan } from '~/lib/backend-generation/backendModuleTypes';
import { backendModuleFilePathList } from '~/lib/backend-generation/backendModuleTypes';
import {
  derivePhaseStates,
  phaseForFile,
  resolvePhaseActivation,
  type GenerationPhase,
  type PhaseFileForState,
} from '~/lib/application-manifest/phaseModel';
import type { ManifestFileStatus } from '~/lib/application-manifest/manifestTypes';

/**
 * Progressive Phase Runner — Sprint 99B.
 *
 * Drives the real pipeline with a stubbed provider and a stubbed manifest, and asserts the
 * orchestration invariants the sprint asks for: files start queued, Phase 1 activates first, later
 * phases stay queued until their turn, a completed phase is not re-entered, an empty phase is
 * skipped and the runner advances, and no phase is ever activated twice.
 */

function makeProject(): Project {
  return {
    id: 'proj-phase-runner',
    name: 'Phase Runner Test',
    icon: '⚡',
    color: 'purple',
    projectType: 'guided_engineering',
    createdFrom: 'template',
    createdAt: new Date().toISOString(),
  } as Project;
}

function makeEmptyProductPackage(): ProductPackage {
  return {
    projectId: 'proj-phase-runner',
    projectName: 'Phase Runner Test',
    assembledAt: '',
    sections: [],
    missingSections: [],
  };
}

/** Echoes back whatever paths the prompt asked for, so every stage/batch is satisfied with its own planned files. */
const stubGenerate: GenerateFn = async (_system, prompt) => {
  const asked = [...prompt.matchAll(/"([\w./-]+\.(?:ts|tsx|css))"/g)].map((match) => match[1]);
  const paths = asked.length > 0 ? [...new Set(asked)] : ['src/pages/HomePage.tsx'];

  return {
    ok: true,
    text: JSON.stringify({
      files: paths.map((path) => ({
        path,
        content: path.endsWith('.tsx') ? 'export default function C() { return null; }' : 'export {};',
      })),
    }),
  };
};

const RIDES: BackendModulePlan = {
  moduleSlug: 'rides',
  featureIds: ['FEAT-001'],
  databaseTables: ['rides'],
  apiEndpoints: ['GET /api/rides'],
};

const PAYMENTS: BackendModulePlan = {
  moduleSlug: 'payments',
  featureIds: ['FEAT-002'],
  databaseTables: ['payments'],
  apiEndpoints: ['POST /api/payments/create-order'],
};

/**
 * A stand-in for the persisted manifest: every planned file starts `queued` (what
 * `toFileInsertRow` now writes), and the phase hooks below promote them exactly the way
 * `createPhaseHooks` does in useCodeGeneration.ts.
 */
function makeManifestFiles(backendModules: BackendModulePlan[]): PhaseFileForState[] {
  const files: PhaseFileForState[] = [
    { id: 'f-main', path: 'src/main.tsx', category: 'entry', sourceKind: 'scaffold', status: 'queued' },
    { id: 'f-pkg', path: 'package.json', category: 'config', sourceKind: 'scaffold', status: 'queued' },
    { id: 'f-navbar', path: 'src/components/Navbar.tsx', category: 'components', status: 'queued' },
    { id: 'f-footer', path: 'src/components/Footer.tsx', category: 'components', status: 'queued' },
    { id: 'f-types', path: 'src/types/index.ts', category: 'types', status: 'queued' },
    { id: 'f-services', path: 'src/services/api.ts', category: 'services', status: 'queued' },
    { id: 'f-home', path: 'src/pages/HomePage.tsx', category: 'pages', status: 'queued' },
    { id: 'f-readme', path: 'README.md', category: 'documentation', sourceKind: 'scaffold', status: 'queued' },
  ];

  for (const module of backendModules) {
    for (const path of backendModuleFilePathList(module.moduleSlug)) {
      files.push({ id: path, path, category: 'backend', featureIds: module.featureIds, status: 'queued' });
    }
  }

  return files;
}

interface RunnerHarness {
  hooks: GenerationPhaseHooks;
  activations: GenerationPhase[];
  completions: GenerationPhase[];
  skips: GenerationPhase[];

  /** Status of every file at the moment each phase was activated — how "later phases stay queued" is checked. */
  snapshots: { phase: GenerationPhase; statuses: Record<string, ManifestFileStatus> }[];
  files: PhaseFileForState[];
}

function makeHarness(files: PhaseFileForState[], backendModules: BackendModulePlan[]): RunnerHarness {
  const context = { backendModules };
  const harness: RunnerHarness = {
    activations: [],
    completions: [],
    skips: [],
    snapshots: [],
    files,
    hooks: {},
  };

  function activate(phase: GenerationPhase): void {
    const activation = resolvePhaseActivation(harness.files, phase, context);

    if (activation.alreadyComplete && activation.activateFileIds.length === 0) {
      return;
    }

    const ids = new Set(activation.activateFileIds);
    harness.files = harness.files.map((file) => (ids.has(file.id ?? '') ? { ...file, status: 'pending' } : file));
    harness.snapshots.push({
      phase,
      statuses: Object.fromEntries(harness.files.map((file) => [file.path, file.status])),
    });
  }

  harness.hooks = {
    onPhaseActivating(phase) {
      harness.activations.push(phase);
      activate(phase);
    },
    onPhaseCompleted(phase) {
      harness.completions.push(phase);

      // Mirrors what the file lifecycle hooks do in a real run: this phase's AI files reach a finished status.
      harness.files = harness.files.map((file) =>
        phaseForFile(file, context) === phase && file.sourceKind !== 'scaffold' && file.status === 'pending'
          ? { ...file, status: 'generated' }
          : file,
      );
    },
    onPhaseSkipped(phase) {
      harness.skips.push(phase);
      activate(phase);
    },
  };

  return harness;
}

async function run(harness: RunnerHarness, backendModules: BackendModulePlan[]) {
  return runGenerationPipeline(
    makeProject(),
    makeEmptyProductPackage(),
    stubGenerate,
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    backendModules,
    undefined,
    harness.hooks,
  );
}

describe('Progressive Phase Runner — activation order', () => {
  it('runs phases in ascending order, exactly once each, with no duplicate activation', async () => {
    const backendModules = [RIDES, PAYMENTS];
    const harness = makeHarness(makeManifestFiles(backendModules), backendModules);

    const result = await run(harness, backendModules);

    expect(result.ok).toBe(true);
    expect(harness.activations).toEqual([1, 2, 3, 4, 6]);
    expect(new Set(harness.activations).size).toBe(harness.activations.length);
    expect(harness.completions).toEqual([1, 2, 3, 4, 6]);

    // A phase never completes before it activates.
    for (const phase of harness.completions) {
      expect(harness.activations.indexOf(phase)).toBeGreaterThanOrEqual(0);
    }
  });

  it('activates Phase 1 first and leaves every later phase queued at that moment', async () => {
    const backendModules = [RIDES];
    const harness = makeHarness(makeManifestFiles(backendModules), backendModules);

    await run(harness, backendModules);

    const firstSnapshot = harness.snapshots[0];

    expect(firstSnapshot.phase).toBe(1);
    expect(firstSnapshot.statuses['src/components/Navbar.tsx']).toBe('pending');
    expect(firstSnapshot.statuses['src/main.tsx']).toBe('pending');

    // Phase 2+ untouched.
    expect(firstSnapshot.statuses['src/types/index.ts']).toBe('queued');
    expect(firstSnapshot.statuses['src/pages/HomePage.tsx']).toBe('queued');
    expect(firstSnapshot.statuses['src/features/rides/service.ts']).toBe('queued');
    expect(firstSnapshot.statuses['README.md']).toBe('queued');
  });

  it('skips a phase with no work and advances — a project with no payments never enters Phase 4', async () => {
    const backendModules = [RIDES];
    const harness = makeHarness(makeManifestFiles(backendModules), backendModules);

    await run(harness, backendModules);

    expect(harness.activations).toEqual([1, 2, 3, 6]);
    expect(harness.skips).toEqual([4, 5]);
    expect(derivePhaseStates(harness.files, { backendModules })[3].status).toBe('skipped');
  });

  it('does not re-activate a phase whose files are already complete (a resumed run)', async () => {
    const backendModules = [RIDES];
    const files = makeManifestFiles(backendModules).map((file) =>
      phaseForFile(file, { backendModules }) === 1 && file.sourceKind !== 'scaffold'
        ? { ...file, status: 'complete' as ManifestFileStatus }
        : file,
    );
    const harness = makeHarness(files, backendModules);

    await run(harness, backendModules);

    // The pipeline still visits Phase 1 …
    expect(harness.activations).toContain(1);

    /*
     * … and its already-complete AI files are left exactly as they are. Only the phase's
     * deterministic scaffold rows (written at assembly, so still queued) are promoted — that is
     * the one thing a completed phase's activation may still do.
     */
    expect(harness.files.find((file) => file.path === 'src/components/Navbar.tsx')?.status).toBe('complete');
    expect(harness.files.find((file) => file.path === 'src/components/Footer.tsx')?.status).toBe('complete');
    expect(harness.files.find((file) => file.path === 'src/main.tsx')?.status).toBe('pending');

    // No file anywhere was pushed backwards from a finished status.
    expect(harness.files.filter((file) => file.status === 'complete')).toHaveLength(2);
  });

  it('reaches a state where every phase is completed or skipped once the run finishes', async () => {
    const backendModules = [RIDES, PAYMENTS];
    const harness = makeHarness(makeManifestFiles(backendModules), backendModules);

    await run(harness, backendModules);

    const states = derivePhaseStates(harness.files, { backendModules });

    expect(states.filter((state) => state.status === 'active')).toHaveLength(0);
    expect(states.filter((state) => state.status === 'failed')).toHaveLength(0);
    expect(states[4].status).toBe('skipped'); // no admin work in this project
  });
});

describe('Progressive Phase Runner — backward compatibility', () => {
  it('runs identically with no phase hooks at all (every existing caller)', async () => {
    const result = await runGenerationPipeline(makeProject(), makeEmptyProductPackage(), stubGenerate, () => {});
    expect(result.ok).toBe(true);
  });

  it('a legacy manifest (every file already pending) activates nothing and still generates', async () => {
    const backendModules = [RIDES];
    const legacy = makeManifestFiles(backendModules).map((file) => ({
      ...file,
      status: 'pending' as ManifestFileStatus,
    }));
    const harness = makeHarness(legacy, backendModules);

    const result = await run(harness, backendModules);

    expect(result.ok).toBe(true);
    expect(harness.snapshots.every((snapshot) => Object.values(snapshot.statuses).every((s) => s !== 'queued'))).toBe(
      true,
    );
  });
});
