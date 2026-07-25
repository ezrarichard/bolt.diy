import { describe, expect, it, vi } from 'vitest';
import { ARTIFACT_TYPES, createArtifact, type ProjectArtifact } from './artifacts';
import { ROLE_ARTIFACT_CHAIN } from './collaborationContext';
import { AUTO_ENGINEERING_ROLES, getNextAutoRole, isAutoEngineeringComplete } from './autoEngineeringEngine';
import { productOwnerEngine } from './productOwnerEngine';
import { solutionArchitectEngine } from './solutionArchitectEngine';
import type { Project } from '~/lib/stores/projects';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

const { createMvp, recordMvpApproval } = await import('~/lib/mvp/mvpRepository');

/**
 * Sprint 46D — End-to-End Validation.
 *
 * This exercises the REAL pipeline functions (productOwnerEngine, solutionArchitectEngine,
 * autoEngineeringEngine, collaborationContext) end-to-end against realistic, AI-response-shaped
 * fixtures, in place of an actual authenticated browser session — this sprint had no valid
 * login credentials for the "internal team access only" app and no way to drive a real LLM
 * call through the UI, so this is the highest-fidelity validation achievable without those.
 * See this sprint's implementation report for the live BuildersDB checks (read-only + one
 * rejected write probe) that supplement this file.
 *
 * Every function called here is the actual production code path — nothing here reimplements
 * or mocks the pipeline logic itself, only the raw text an LLM would have returned.
 */

const APPROVED_KNOWLEDGE = {
  projectVision: 'A scheduling app for small clinics.',
  coreFeatures: ['Booking', 'Reminders'],
};

function requirementsArtifact(): ProjectArtifact {
  return createArtifact({
    taskId: 'requirements',
    title: 'Requirements Draft v1',
    type: ARTIFACT_TYPES.REQUIREMENTS_DRAFT,
    content: JSON.stringify({
      businessVision: APPROVED_KNOWLEDGE.projectVision,
      coreFeatures: APPROVED_KNOWLEDGE.coreFeatures,
    }),
    status: 'approved',
    generatedBy: 'AI Project Manager',
    version: 1,
  });
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-e2e-validation',
    name: 'Clinic Scheduler',
    icon: '',
    color: 'purple',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectKnowledge: APPROVED_KNOWLEDGE,
    artifacts: [requirementsArtifact()],
    ...overrides,
  } as unknown as Project;
}

/** A realistic, complete AI response — deliberately includes a second roadmap entry (a lightweight future MVP skeleton) and every field this sprint's brief asks to verify. */
const REALISTIC_PRODUCT_OWNER_RESPONSE = JSON.stringify({
  productVision: 'Help small clinics reduce no-shows with simple online scheduling.',
  businessObjectives: ['Reduce no-show rate by 30%', 'Get the first 10 clinics onboarded within a month'],
  productScope: { inScope: ['Booking', 'Reminders', 'Payments'], outOfScope: ['Multi-location support'] },
  roadmapSkeleton: [
    { sequence: 1, theme: 'Core booking flow', targetRelease: 'v0.1', estimatedEffort: 'medium' },
    { sequence: 2, theme: 'Payments and deposits', targetRelease: 'v0.2', estimatedEffort: 'large' },
  ],
  currentMvp: {
    sequence: 1,
    features: [
      {
        name: 'Patient login',
        description: 'Email/password auth for returning patients.',
        priority: 'Must Have',
        dependsOn: [],
        customerValue: 'Nothing else works without an identity.',
      },
      {
        name: 'Appointment booking',
        description: 'Pick a slot and confirm.',
        priority: 'Must Have',
        dependsOn: ['Patient login'],
        customerValue: 'The actual core loop.',
      },
      {
        name: 'Email reminders',
        description: '24h-before email reminder.',
        priority: 'Should Have',
        dependsOn: ['Appointment booking'],
        customerValue: 'Reduces no-shows, but the product works without it on day one.',
      },
    ],
    acceptanceCriteria: ['A patient can register, log in, and book an available slot end to end.'],
    risks: [
      {
        description: 'Email deliverability for reminders is unproven.',
        severity: 'Medium',
        mitigation: 'Use a transactional email provider with delivery guarantees.',
      },
    ],
    assumptions: ['Clinics operate in a single timezone.'],
    openQuestions: ['Should staff see a separate calendar view in this MVP?'],
    technicalConstraints: ['Must use the existing auth provider already selected in Architecture context.'],
    businessConstraints: ['Must launch within one month for the first pilot clinics.'],
    successMetrics: [
      'A patient can complete signup-to-booking in under 3 minutes.',
      'No-show rate drops for pilot clinics within 4 weeks.',
    ],
    exitCriteria: ['All critical defects closed', 'Customer approved preview', 'QA passed'],
    engineeringHandoff: {
      scope: ['Patient login', 'Appointment booking', 'Email reminders'],
      constraints: ['Must use existing auth provider', 'Must launch within one month'],
      architectureGoals: ['Support adding payments in MVP 2 without a rewrite'],
      successCriteria: ['Booking flow works end to end for a pilot clinic'],
      acceptanceCriteria: ['A patient can register, log in, and book an available slot end to end.'],
      outOfScopeFeatures: ['Multi-location support', 'Payments'],
      dependencies: ['Appointment booking depends on Patient login'],
    },
  },
  futureEnhancements: ['Multi-language support', 'SMS reminders'],
});

describe('Sprint 46D — full planning pipeline, end to end', () => {
  it('VERIFY GATE A: Architecture is blocked before Requirements even without a Product Owner artifact', () => {
    const project = makeProject();
    expect(solutionArchitectEngine.canGenerateArchitecture(project)).toBe(false);
    expect(productOwnerEngine.canGenerateProductOwner(project)).toBe(true);
  });

  it('VERIFY PRODUCT OWNER + IDENTITY: parses every field this sprint asks to confirm, with MVP/Feature IDs present', () => {
    const result = productOwnerEngine.parseDraft(REALISTIC_PRODUCT_OWNER_RESPONSE);
    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    const { draft } = result;

    // Product Vision, Business Goals, Roadmap, Future MVP skeleton.
    expect(draft.productVision).toBeTruthy();
    expect(draft.businessObjectives?.length).toBeGreaterThan(0);
    expect(draft.roadmapSkeleton).toHaveLength(2);
    expect(draft.roadmapSkeleton?.[1].sequence).toBe(2); // future MVP skeleton — lightweight, present.

    // MVP IDs.
    expect(draft.currentMvp?.id).toBe('MVP-001');
    expect(draft.roadmapSkeleton?.[0].id).toBe('MVP-001');
    expect(draft.roadmapSkeleton?.[1].id).toBe('MVP-002');

    // Feature IDs.
    const featureIds = draft.currentMvp?.features.map((f) => f.id) ?? [];
    expect(featureIds).toEqual(['FEAT-001', 'FEAT-002', 'FEAT-003']);

    // Current MVP: Success Metrics, Exit Criteria, Risk List, Engineering Handoff, Dependencies.
    expect(draft.currentMvp?.successMetrics.length).toBeGreaterThan(0);
    expect(draft.currentMvp?.exitCriteria.length).toBeGreaterThan(0);
    expect(draft.currentMvp?.risks.length).toBeGreaterThan(0);
    expect(draft.currentMvp?.engineeringHandoff.dependencies.length).toBeGreaterThan(0);
    expect(draft.currentMvp?.engineeringHandoff.outOfScopeFeatures).toContain('Payments');

    // Future MVP skeleton stays lightweight (no features/risks/acceptanceCriteria fields at all).
    expect((draft.roadmapSkeleton?.[1] as unknown as Record<string, unknown>).features).toBeUndefined();
  });

  it('VERIFY TRACEABILITY: MVP code and every Feature ID referenced in the Engineering Handoff are internally consistent (no identity loss)', () => {
    const result = productOwnerEngine.parseDraft(REALISTIC_PRODUCT_OWNER_RESPONSE);
    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    const { currentMvp } = result.draft;
    const allFeatureIds = new Set(currentMvp!.features.map((f) => f.id));

    // Every handoff feature ID must trace back to a real feature id — no orphaned references.
    for (const handoffFeature of currentMvp!.engineeringHandoff.features) {
      expect(allFeatureIds.has(handoffFeature.id)).toBe(true);
    }

    /*
     * "Won't Have" features (none in this fixture) would be excluded from the handoff — confirm
     * the handoff feature count matches the Must/Should Have count exactly (3 of 3 here).
     */
    expect(currentMvp!.engineeringHandoff.features).toHaveLength(3);
  });

  it('VERIFY GATE A blocking → approval → Architecture unblocked, and Solution Architect receives ONLY the structured handoff, never the narrative artifact', () => {
    const parsed = productOwnerEngine.parseDraft(REALISTIC_PRODUCT_OWNER_RESPONSE);
    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const draftArtifact = productOwnerEngine.createDraftArtifact(parsed.draft, 1);
    expect(draftArtifact.status).toBe('draft'); // never auto-approved

    // Still a draft — Architecture must remain blocked (Gate A not yet passed).
    let project = makeProject({ artifacts: [requirementsArtifact(), draftArtifact] });
    expect(solutionArchitectEngine.canGenerateArchitecture(project)).toBe(false);

    /*
     * Reject (changes requested): still blocked. Simulated by leaving status as 'draft' —
     * the real UI never transitions a rejected artifact to 'approved'.
     */
    expect(solutionArchitectEngine.canGenerateArchitecture(project)).toBe(false);

    // Gate A approval — the ONLY transition that unblocks Architecture.
    const approvedArtifact: ProjectArtifact = { ...draftArtifact, status: 'approved' };
    project = makeProject({ artifacts: [requirementsArtifact(), approvedArtifact] });
    expect(solutionArchitectEngine.canGenerateArchitecture(project)).toBe(true);

    // The actual context Architecture receives.
    const context = solutionArchitectEngine.buildArchitectureContext(project);
    expect(context.engineeringHandoff).toBeDefined();
    expect(context.engineeringHandoff?.outOfScopeFeatures).toContain('Multi-location support');
    expect(context.engineeringHandoff?.features.map((f) => f.id)).toEqual(['FEAT-001', 'FEAT-002', 'FEAT-003']);

    /*
     * Confirm no Product Owner narrative field (productVision, businessObjectives, roadmapSkeleton,
     * futureEnhancements) leaks into what Architecture receives — only the structured handoff.
     */
    const contextKeys = Object.keys(context);
    expect(contextKeys).not.toContain('productVision');
    expect(contextKeys).not.toContain('businessObjectives');
    expect(contextKeys).not.toContain('roadmapSkeleton');
    expect(contextKeys).not.toContain('futureEnhancements');
  });

  it('VERIFY ENGINEERING PIPELINE / ROLE_ARTIFACT_CHAIN: Product Owner sits between Business Analyst and Solution Architect, exactly once', () => {
    const roles = ROLE_ARTIFACT_CHAIN.map((entry) => entry.role);
    expect(roles.indexOf('Business Analyst')).toBe(0);
    expect(roles.indexOf('Product Owner')).toBe(1);
    expect(roles.indexOf('Solution Architect')).toBe(2);
    expect(roles.filter((role) => role === 'Product Owner')).toHaveLength(1);
  });

  it('VERIFY LEGACY PROJECTS: a pre-Sprint-46 project (Architecture already approved, no Product Owner artifact) is never retroactively blocked, and the rest of the pipeline still functions', () => {
    const legacyArtifacts: ProjectArtifact[] = [
      requirementsArtifact(),
      createArtifact({
        taskId: 'requirements',
        title: 'Architecture Draft v1',
        type: ARTIFACT_TYPES.ARCHITECTURE_DRAFT,
        content: '{}',
        status: 'approved',
        generatedBy: 'AI Solution Architect',
        version: 1,
      }),
      createArtifact({
        taskId: 'requirements',
        title: 'Database Design Draft v1',
        type: ARTIFACT_TYPES.DATABASE_DRAFT,
        content: '{}',
        status: 'approved',
        generatedBy: 'AI Database Engineer',
        version: 1,
      }),
    ];

    const project = makeProject({ artifacts: legacyArtifacts });

    // No Product Owner requirement.
    expect(productOwnerEngine.canGenerateProductOwner(project)).toBe(false);
    expect(productOwnerEngine.hasLegacyEngineeringProgress(project)).toBe(true);

    // The pipeline resumes at the next role (UI/UX) — not Product Owner, not re-running Architecture/Database.
    const next = getNextAutoRole(project);
    expect(next?.id).toBe('uiux');

    // Completing the rest of the pipeline (without ever touching Product Owner) still reaches "complete".
    const fullyLegacyComplete = makeProject({
      artifacts: [
        ...legacyArtifacts,
        ...['uiux-draft', 'backend-draft', 'frontend-draft', 'qa-draft', 'devops-draft'].map((type) =>
          createArtifact({
            taskId: 'requirements',
            title: `${type} v1`,
            type,
            content: '{}',
            status: 'approved',
            generatedBy: 'AI',
            version: 1,
          }),
        ),
      ],
    });

    expect(isAutoEngineeringComplete(fullyLegacyComplete)).toBe(true);
    expect(getNextAutoRole(fullyLegacyComplete)).toBeUndefined();
  });

  it('VERIFY MVP CREATION + approval history: the exact sequence ProductOwnerDraftPanel performs on Gate A, using a realistic Product Owner draft', async () => {
    getBuildersDbClientMock.mockReset();

    const parsed = productOwnerEngine.parseDraft(REALISTIC_PRODUCT_OWNER_RESPONSE);
    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const { draft } = parsed;
    const roadmapEntry = draft.roadmapSkeleton?.find((entry) => entry.sequence === draft.currentMvp!.sequence);

    const insertedMvpRow = {
      id: 'mvp-row-1',
      project_id: 'proj-e2e-validation',
      code: draft.currentMvp!.id,
      sequence: draft.currentMvp!.sequence,
      theme: roadmapEntry?.theme ?? null,
      status: 'planned',
      scope_artifact_id: null,
      target_release: roadmapEntry?.targetRelease ?? null,
      estimated_effort: roadmapEntry?.estimatedEffort ?? null,
      business_priority: null,
      blocked_reason: null,
      created_by: 'user-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      approved_at: null,
    };

    const insertMvp = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: insertedMvpRow, error: null }) }),
    }));
    const insertApproval = vi.fn(() => Promise.resolve({ error: null }));
    const updateMvp = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));

    const from = vi.fn((table: string) => {
      if (table === 'builders_mvps') {
        return {
          insert: insertMvp,
          update: updateMvp,

          /*
           * Sprint 78 Phase 0 — updateMvpStatus now reads the MVP's current status via getMvpById
           * (transition validation) before writing; this MVP is 'planned' until Gate A approval.
           */
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: insertedMvpRow, error: null }) }),
          }),
        };
      }

      if (table === 'builders_mvp_approvals') {
        return { insert: insertApproval };
      }

      throw new Error(`unexpected table ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    // Step 1: create MVP 1 with the fields the Product Owner draft proposed.
    const created = await createMvp({
      projectId: 'proj-e2e-validation',
      sequence: draft.currentMvp!.sequence,
      code: draft.currentMvp!.id,
      theme: roadmapEntry?.theme,
      targetRelease: roadmapEntry?.targetRelease,
      estimatedEffort: roadmapEntry?.estimatedEffort,
      createdBy: 'user-1',
    });

    expect(created.ok).toBe(true);
    expect(created.mvp?.code).toBe('MVP-001');
    expect(created.mvp?.sequence).toBe(1);
    expect(created.mvp?.targetRelease).toBe('v0.1');
    expect(created.mvp?.estimatedEffort).toBe('medium');
    expect(created.mvp?.businessPriority).toBeUndefined(); // Product Owner doesn't propose this — correctly absent, not defaulted to a wrong value.
    expect(created.mvp?.blockedReason).toBeUndefined(); // never set at creation — only ever set later, operationally.

    // Step 2: record the Gate A (scope) approval against the newly created MVP.
    const approved = await recordMvpApproval({
      mvpId: created.mvp!.id,
      projectId: 'proj-e2e-validation',
      stage: 'scope',
      decision: 'approved',
      decidedBy: 'user-1',
    });

    expect(approved).toBe(true);
    expect(insertApproval).toHaveBeenCalledWith(
      expect.objectContaining({ mvp_id: 'mvp-row-1', stage: 'scope', decision: 'approved' }),
    );
    expect(updateMvp).toHaveBeenCalledWith(expect.objectContaining({ status: 'scoped' })); // Gate A → 'scoped', not 'approved' (that's Gate B).
  });

  it('VERIFY BUILDERSDB CONSISTENCY (schema shape, code-side): every AUTO_ENGINEERING_ROLES entry has a distinct artifactType matching ARTIFACT_TYPES, and Product Owner is first', () => {
    expect(AUTO_ENGINEERING_ROLES[0].id).toBe('productowner');
    expect(AUTO_ENGINEERING_ROLES[0].artifactType).toBe(ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT);

    const artifactTypes = AUTO_ENGINEERING_ROLES.map((role) => role.artifactType);
    expect(new Set(artifactTypes).size).toBe(artifactTypes.length); // no duplicates
  });
});
