import { describe, expect, it } from 'vitest';
import type { BackendModulePlan } from '~/lib/backend-generation/backendModuleTypes';
import { backendModuleFilePathList } from '~/lib/backend-generation/backendModuleTypes';
import type { ManifestFileCategory, ManifestFileStatus } from './manifestTypes';
import {
  derivePhaseStates,
  isPhaseComplete,
  phaseForFile,
  resolveActivePhase,
  resolvePhaseActivation,
  resolvePhaseResumePlan,
  type GenerationPhase,
  type PhaseFileForState,
} from './phaseModel';

function file(
  path: string,
  category: ManifestFileCategory,
  status: ManifestFileStatus = 'queued',
  overrides: Partial<PhaseFileForState> = {},
): PhaseFileForState {
  return { id: path, path, category, status, ...overrides };
}

function backendFiles(slug: string, status: ManifestFileStatus = 'queued'): PhaseFileForState[] {
  return backendModuleFilePathList(slug).map((path) => file(path, 'backend', status));
}

function modulePlan(overrides: Partial<BackendModulePlan> & { moduleSlug: string }): BackendModulePlan {
  return { featureIds: [], databaseTables: [], apiEndpoints: [], ...overrides };
}

describe('phaseForFile — deterministic phase assignment', () => {
  it('puts the preview shell (entry/config/styles/components) in Phase 1', () => {
    expect(phaseForFile(file('src/main.tsx', 'entry'))).toBe(1);
    expect(phaseForFile(file('package.json', 'config'))).toBe(1);
    expect(phaseForFile(file('src/index.css', 'styles'))).toBe(1);
    expect(phaseForFile(file('src/components/Navbar.tsx', 'components'))).toBe(1);
  });

  it('puts public pages and the shared types/services they import in Phase 2', () => {
    expect(phaseForFile(file('src/types/index.ts', 'types'))).toBe(2);
    expect(phaseForFile(file('src/services/api.ts', 'services'))).toBe(2);
    expect(phaseForFile({ ...file('src/pages/RegisterPage.tsx', 'pages'), componentName: 'RegisterPage' })).toBe(2);
    expect(phaseForFile({ ...file('src/pages/PaymentSuccessPage.tsx', 'pages'), displayName: 'Payment Success' })).toBe(
      2,
    );
  });

  it('puts documentation and uncategorised files in Phase 6', () => {
    expect(phaseForFile(file('README.md', 'documentation'))).toBe(6);
    expect(phaseForFile(file('misc/whatever.txt', 'other'))).toBe(6);
  });

  it('is a pure function — same input, same answer, no side effects', () => {
    const subject = file('src/features/orders/service.ts', 'backend');
    const answers = new Set([phaseForFile(subject), phaseForFile(subject), phaseForFile({ ...subject })]);
    expect(answers.size).toBe(1);
  });
});

describe('phaseForFile — payment classification (Phase 4)', () => {
  it('classifies a payments module by its slug, for both the feature slice and the api adapter', () => {
    expect(phaseForFile(file('src/features/payments/routes.ts', 'backend'))).toBe(4);
    expect(phaseForFile(file('api/payments/index.ts', 'backend'))).toBe(4);
    expect(phaseForFile(file('src/features/checkout/service.ts', 'backend'))).toBe(4);
    expect(phaseForFile(file('src/features/billing/repository.ts', 'backend'))).toBe(4);
  });

  it('classifies by an endpoint that names this module, not by the project-wide endpoint list', () => {
    const context = {
      backendModules: [
        modulePlan({ moduleSlug: 'orders', apiEndpoints: ['POST /api/orders/:id/pay', 'GET /api/rides'] }),
        modulePlan({ moduleSlug: 'rides', apiEndpoints: ['POST /api/orders/:id/pay', 'GET /api/rides'] }),
      ],
    };

    // `orders` owns the pay endpoint …
    expect(phaseForFile(file('src/features/orders/routes.ts', 'backend'), context)).toBe(4);

    // … and `rides` must NOT inherit it just because BackendModulePlan.apiEndpoints is project-wide.
    expect(phaseForFile(file('src/features/rides/routes.ts', 'backend'), context)).toBe(3);
  });

  it('matches whole tokens only — "company" is not a payment module', () => {
    expect(phaseForFile(file('src/features/company/service.ts', 'backend'))).toBe(3);
    expect(phaseForFile(file('src/features/campaigns/service.ts', 'backend'))).toBe(3);
  });
});

describe('phaseForFile — admin classification (Phase 5)', () => {
  it('classifies admin pages into Phase 5 by path, component name or display name', () => {
    expect(phaseForFile(file('src/pages/AdminDashboardPage.tsx', 'pages'))).toBe(5);
    expect(phaseForFile({ ...file('src/pages/Backoffice.tsx', 'pages'), componentName: 'BackofficePage' })).toBe(5);
    expect(phaseForFile({ ...file('src/pages/Ops.tsx', 'pages'), displayName: 'Administrator Console' })).toBe(5);
  });

  it('classifies an admin backend module into Phase 5', () => {
    expect(phaseForFile(file('src/features/admin-reports/repository.ts', 'backend'))).toBe(5);
    expect(phaseForFile(file('api/admin/index.ts', 'backend'))).toBe(5);
  });

  it('leaves a plain user dashboard in the public journey — "dashboard" is not an admin token', () => {
    expect(phaseForFile(file('src/pages/DashboardPage.tsx', 'pages'))).toBe(2);
  });
});

describe('phaseForFile — unmatched backend default (Phase 3)', () => {
  it('defaults an unmatched module to Phase 3', () => {
    expect(phaseForFile(file('src/features/rides/service.ts', 'backend'))).toBe(3);
  });

  it('defaults a backend file with no recognisable module path to Phase 3', () => {
    expect(phaseForFile(file('src/backend-thing.ts', 'backend'))).toBe(3);
  });

  it('defaults when no module plan context is supplied at all', () => {
    expect(phaseForFile(file('src/features/bookings/types.ts', 'backend'), {})).toBe(3);
  });
});

describe('derivePhaseStates — derived completion, no stored phase state', () => {
  const context = {};

  it('marks a phase containing zero files as skipped, and only that case', () => {
    const files = [file('src/main.tsx', 'entry'), file('src/pages/HomePage.tsx', 'pages')];
    const states = derivePhaseStates(files, context);

    expect(states[2].status).toBe('skipped'); // 3 Backend
    expect(states[3].status).toBe('skipped'); // 4 Payments
    expect(states[4].status).toBe('skipped'); // 5 Admin
    expect(states[0].status).not.toBe('skipped'); // 1 has files
  });

  it('reports completed / active / pending across phases from file status alone', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('src/types/index.ts', 'types', 'generating'),
      file('src/pages/HomePage.tsx', 'pages', 'queued'),
      ...backendFiles('rides'),
    ];

    const states = derivePhaseStates(files, context);

    expect(states[0].status).toBe('completed');
    expect(states[1].status).toBe('active');
    expect(states[2].status).toBe('pending');
  });

  it('never reports two active phases — a later in-flight phase degrades to pending', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'generating'),
      file('src/types/index.ts', 'types', 'generating'),
    ];

    const states = derivePhaseStates(files, context);

    expect(states.filter((state) => state.status === 'active')).toHaveLength(1);
    expect(states[0].status).toBe('active');
    expect(states[1].status).toBe('pending');
  });

  it('reports failed when a phase has nothing left in flight and something failed', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'validated'),
      file('src/components/Footer.tsx', 'components', 'failed'),
    ];

    expect(derivePhaseStates(files, context)[0].status).toBe('failed');
    expect(isPhaseComplete(files, 1, context)).toBe(false);
  });

  it('treats generated/validated/complete as finished — the statuses resume already trusts', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'generated'),
      file('src/components/Footer.tsx', 'components', 'validated'),
      file('src/index.css', 'styles', 'complete'),
    ];

    expect(isPhaseComplete(files, 1, context)).toBe(true);
  });

  it('ignores superseded rows entirely — they belong to an older manifest version', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('src/components/Old.tsx', 'components', 'superseded'),
    ];

    const state = derivePhaseStates(files, context)[0];

    expect(state.status).toBe('completed');
    expect(state.total).toBe(1);
  });

  it('does not let a deterministic scaffold file gate its phase (it is only written at assembly)', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('package.json', 'config', 'queued', { sourceKind: 'scaffold' }),
    ];

    const state = derivePhaseStates(files, context)[0];

    expect(state.total).toBe(2);
    expect(state.blocking).toBe(1);
    expect(state.status).toBe('completed');
  });
});

describe('resolveActivePhase — lowest incomplete phase', () => {
  it('starts a brand-new manifest at Phase 1', () => {
    const files = [file('src/components/Navbar.tsx', 'components'), file('src/pages/HomePage.tsx', 'pages')];
    expect(resolveActivePhase(files)).toBe(1);
  });

  it('advances past completed AND skipped phases', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('src/types/index.ts', 'types', 'complete'),
      file('src/pages/HomePage.tsx', 'pages', 'complete'),

      // No Phase 3 or 4 files at all — both skipped.
      file('src/pages/AdminPage.tsx', 'pages', 'queued'),
    ];

    expect(resolveActivePhase(files)).toBe(5);
  });

  it('is undefined once every phase is complete or skipped', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('src/pages/HomePage.tsx', 'pages', 'complete'),
      file('README.md', 'documentation', 'complete'),
    ];

    expect(resolveActivePhase(files)).toBeUndefined();
  });
});

describe('resolvePhaseActivation — queued → pending, one phase at a time', () => {
  const files = [
    file('src/components/Navbar.tsx', 'components'),
    file('src/index.css', 'styles', 'queued', { sourceKind: 'scaffold' }),
    file('src/types/index.ts', 'types'),
    file('src/pages/HomePage.tsx', 'pages'),
    ...backendFiles('rides'),
  ];

  it('activates only the requested phase, leaving every later phase queued', () => {
    const activation = resolvePhaseActivation(files, 1);

    expect(activation.activateFileIds.sort()).toEqual(['src/components/Navbar.tsx', 'src/index.css']);
    expect(activation.activateFileIds).not.toContain('src/types/index.ts');
    expect(activation.alreadyComplete).toBe(false);
  });

  it('only ever promotes queued files — nothing already in flight or finished is touched', () => {
    const mixed = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('src/components/Footer.tsx', 'components', 'generating'),
      file('src/components/Sidebar.tsx', 'components', 'queued'),
    ];

    expect(resolvePhaseActivation(mixed, 1).activateFileIds).toEqual(['src/components/Sidebar.tsx']);
  });

  it('reports a completed phase as alreadyComplete so it is never re-entered', () => {
    const completed = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('src/pages/HomePage.tsx', 'pages', 'queued'),
    ];

    const activation = resolvePhaseActivation(completed, 1);

    expect(activation.alreadyComplete).toBe(true);
    expect(activation.activateFileIds).toEqual([]);
  });

  it('re-activating a phase that is already pending is a no-op — no duplicate activation', () => {
    const activated = files.map((entry) =>
      phaseForFile(entry) === 1 ? { ...entry, status: 'pending' as ManifestFileStatus } : entry,
    );

    expect(resolvePhaseActivation(activated, 1).activateFileIds).toEqual([]);
  });
});

describe('resolvePhaseResumePlan — resume starts at the lowest incomplete phase', () => {
  it('resumes mid-backend: earlier phases completed, only the active phase regenerates', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('src/types/index.ts', 'types', 'validated'),
      file('src/services/api.ts', 'services', 'complete'),
      file('src/pages/HomePage.tsx', 'pages', 'complete'),
      ...backendFiles('rides', 'failed'),
      ...backendFiles('payments'),
    ];

    const plan = resolvePhaseResumePlan(files);

    expect(plan.activePhase).toBe(3);
    expect(plan.completedPhases).toEqual([1, 2]);
    expect(plan.regeneratePaths).toEqual(backendModuleFilePathList('rides'));

    // The Payments phase is untouched — a later phase is never pulled into the active one.
    expect(plan.regeneratePaths.some((path) => path.includes('payments'))).toBe(false);
  });

  it('reuses every validated/complete/generated file, and only those', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('src/components/Footer.tsx', 'components', 'validated'),
      file('src/types/index.ts', 'types', 'generated'),
      file('src/services/api.ts', 'services', 'failed'),
      file('src/pages/HomePage.tsx', 'pages', 'queued'),
    ];

    expect(resolvePhaseResumePlan(files).reusablePaths.sort()).toEqual([
      'src/components/Footer.tsx',
      'src/components/Navbar.tsx',
      'src/types/index.ts',
    ]);
  });

  it('skips phases with no files and resumes at the next real one', () => {
    const files = [
      file('src/components/Navbar.tsx', 'components', 'complete'),
      file('src/pages/HomePage.tsx', 'pages', 'complete'),
      file('src/pages/AdminUsersPage.tsx', 'pages', 'queued'),
    ];

    const plan = resolvePhaseResumePlan(files);

    // 3/4 have no backend at all; 6 has no documentation file in this fixture — all three skip.
    expect(plan.skippedPhases).toEqual([3, 4, 6]);
    expect(plan.activePhase).toBe(5);
  });

  it('a payments-free project never reports Phase 4 as failed', () => {
    const files = [...backendFiles('rides', 'complete'), file('src/pages/HomePage.tsx', 'pages', 'complete')];
    const states = derivePhaseStates(files);

    expect(states[3].status).toBe('skipped');
    expect(states.some((state) => state.status === 'failed')).toBe(false);
  });
});

describe('backward compatibility — a legacy manifest (every file pending)', () => {
  const legacy: PhaseFileForState[] = [
    file('src/main.tsx', 'entry', 'pending', { sourceKind: 'scaffold' }),
    file('src/components/Navbar.tsx', 'components', 'pending'),
    file('src/types/index.ts', 'types', 'pending'),
    file('src/services/api.ts', 'services', 'pending'),
    file('src/pages/HomePage.tsx', 'pages', 'pending'),
  ];

  it('activates nothing — the files are already activated, so no migration is needed', () => {
    for (const phase of [1, 2, 3, 4, 5, 6] as GenerationPhase[]) {
      expect(resolvePhaseActivation(legacy, phase).activateFileIds).toEqual([]);
    }
  });

  it('still resolves an active phase and a sane resume plan', () => {
    const plan = resolvePhaseResumePlan(legacy);

    expect(plan.activePhase).toBe(1);
    expect(plan.reusablePaths).toEqual([]);
    expect(plan.regeneratePaths).toEqual(['src/components/Navbar.tsx']);
  });

  it('reads as one already-activated phase rather than anything queued', () => {
    const states = derivePhaseStates(legacy);

    expect(states[0].status).toBe('active');
    expect(states[0].queued).toBe(0);
    expect(states[1].status).toBe('pending');
  });
});
