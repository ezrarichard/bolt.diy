import { describe, expect, it } from 'vitest';
import { hasLegacyEngineeringProgress, productOwnerEngine } from './productOwnerEngine';
import { ARTIFACT_TYPES, type ProjectArtifact } from './artifacts';
import type { Project } from '~/lib/stores/projects';

/**
 * Sprint 46B — Product Owner engine tests. Two things get dedicated coverage here that no
 * other role has: (1) the bespoke parser (prompts/productOwner.ts's nested shape doesn't fit
 * the shared `parseStructuredDraft`), and (2) the legacy-project bypass that makes this new
 * role never retroactively block a project that already progressed past where it would have
 * run — see this sprint's implementation report for why both are genuinely new logic.
 *
 * Sprint 46C — adds coverage for permanent MVP/feature ID assignment: minting on first
 * generation, and carry-forward across a regeneration (matched by feature name against the
 * previous draft, passed as `parseDraft`'s optional second argument) — see
 * docs/05-AI-Product-Owner/08-identity-and-traceability.md.
 */

function approved(type: string): ProjectArtifact {
  return {
    id: `artifact-${type}`,
    taskId: 'requirements',
    title: `${type} v1`,
    type,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'approved',
    content: '{}',
    version: 1,
  };
}

function makeProject(artifacts: ProjectArtifact[], knowledge?: unknown): Project {
  return {
    id: 'project-1',
    name: 'Test Project',
    icon: '',
    color: 'purple',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    createdAt: '2026-01-01T00:00:00.000Z',
    artifacts,
    projectKnowledge: knowledge,
  } as unknown as Project;
}

const VALID_RAW_RESPONSE = JSON.stringify({
  productVision: 'A scheduling app for small clinics.',
  businessObjectives: ['Reduce no-shows'],
  productScope: { inScope: ['Booking', 'Reminders'], outOfScope: ['Billing'] },
  roadmapSkeleton: [
    { sequence: 1, theme: 'Core booking flow', targetRelease: 'v0.1', estimatedEffort: 'medium' },
    { sequence: 2, theme: 'Payments', targetRelease: 'v0.2' },
  ],
  currentMvp: {
    sequence: 1,
    features: [
      {
        name: 'Patient login',
        description: 'Email/password auth.',
        priority: 'Must Have',
        dependsOn: [],
        customerValue: 'Nothing else works without an identity.',
      },
    ],
    acceptanceCriteria: ['A patient can log in and see their dashboard.'],
    risks: [
      { description: 'SMS provider integration is unproven.', severity: 'Medium', mitigation: 'Prototype early.' },
    ],
    assumptions: ['Clinics operate in a single timezone.'],
    openQuestions: ['Should staff have a separate login?'],
    technicalConstraints: [],
    businessConstraints: [],
    successMetrics: ['A patient can complete signup in under 2 minutes.'],
    exitCriteria: ['QA passed', 'Customer approved preview'],
    engineeringHandoff: {
      scope: ['Patient login', 'Booking'],
      constraints: ['Must use existing auth provider'],
      architectureGoals: ['Support adding payments later without a rewrite'],
      successCriteria: ['Booking flow works end to end'],
      acceptanceCriteria: ['A patient can log in and see their dashboard.'],
      featurePriority: { 'Patient login': 'Must Have' },
      outOfScopeFeatures: ['Billing'],
      dependencies: [],
    },
  },
  futureEnhancements: ['Multi-language support'],
});

describe('productOwnerEngine.parseDraft', () => {
  it('parses a complete, well-formed response', () => {
    const result = productOwnerEngine.parseDraft(VALID_RAW_RESPONSE);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.draft.currentMvp?.features).toHaveLength(1);
      expect(result.draft.currentMvp?.features[0].priority).toBe('Must Have');
      expect(result.draft.currentMvp?.engineeringHandoff.outOfScopeFeatures).toEqual(['Billing']);
      expect(result.draft.roadmapSkeleton).toHaveLength(2);
    }
  });

  it('rejects a response missing currentMvp entirely', () => {
    const result = productOwnerEngine.parseDraft(JSON.stringify({ productVision: 'Something' }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('currentMvp');
    }
  });

  it('rejects a currentMvp with no features (an MVP with nothing in it is not valid)', () => {
    const raw = JSON.stringify({
      currentMvp: {
        sequence: 1,
        features: [],
        engineeringHandoff: {
          scope: [],
          constraints: [],
          architectureGoals: [],
          successCriteria: [],
          acceptanceCriteria: [],
          featurePriority: {},
          outOfScopeFeatures: [],
          dependencies: [],
        },
      },
    });

    const result = productOwnerEngine.parseDraft(raw);

    expect(result.ok).toBe(false);
  });

  it('reports a clear, actionable error for a truncated response', () => {
    const truncated =
      '{"productVision": "A scheduling app", "currentMvp": { "sequence": 1, "features": [ { "name": "Patient login"';

    const result = productOwnerEngine.parseDraft(truncated);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('cut off');
    }
  });

  it('silently drops an invalid feature (missing priority) rather than failing the whole draft', () => {
    const raw = JSON.stringify({
      currentMvp: {
        sequence: 1,
        features: [
          { name: 'Valid feature', description: 'x', priority: 'Must Have', dependsOn: [], customerValue: 'x' },
          { name: 'Invalid feature — no priority', description: 'x', dependsOn: [], customerValue: 'x' },
        ],
        engineeringHandoff: {
          scope: [],
          constraints: [],
          architectureGoals: [],
          successCriteria: [],
          acceptanceCriteria: [],
          featurePriority: {},
          outOfScopeFeatures: [],
          dependencies: [],
        },
      },
    });

    const result = productOwnerEngine.parseDraft(raw);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.draft.currentMvp?.features).toHaveLength(1);
      expect(result.draft.currentMvp?.features[0].name).toBe('Valid feature');
    }
  });
});

describe('productOwnerEngine.parseDraft — Sprint 46C identity assignment', () => {
  it('mints MVP-001 and sequential FEAT-00N ids on a first-ever generation (no previous draft)', () => {
    const result = productOwnerEngine.parseDraft(VALID_RAW_RESPONSE);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.draft.currentMvp?.id).toBe('MVP-001');
      expect(result.draft.roadmapSkeleton?.[0].id).toBe('MVP-001');
      expect(result.draft.roadmapSkeleton?.[1].id).toBe('MVP-002');
      expect(result.draft.currentMvp?.features[0].id).toBe('FEAT-001');
    }
  });

  it('derives engineeringHandoff.features from currentMvp.features (with ids), excluding "Won\'t Have" items', () => {
    const raw = JSON.stringify({
      currentMvp: {
        sequence: 1,
        features: [
          { name: 'Must feature', description: 'x', priority: 'Must Have', dependsOn: [], customerValue: 'x' },
          { name: 'Deferred feature', description: 'x', priority: "Won't Have", dependsOn: [], customerValue: 'x' },
        ],
        engineeringHandoff: {
          scope: [],
          constraints: [],
          architectureGoals: [],
          successCriteria: [],
          acceptanceCriteria: [],
          outOfScopeFeatures: [],
          dependencies: [],
        },
      },
    });

    const result = productOwnerEngine.parseDraft(raw);

    expect(result.ok).toBe(true);

    if (result.ok) {
      const handoffFeatures = result.draft.currentMvp?.engineeringHandoff.features ?? [];
      expect(handoffFeatures).toHaveLength(1);
      expect(handoffFeatures[0]).toEqual({ id: 'FEAT-001', name: 'Must feature', priority: 'Must Have' });
    }
  });

  it("carries forward a matching feature's id across a regeneration, and mints a new id only for a genuinely new feature", () => {
    const first = productOwnerEngine.parseDraft(VALID_RAW_RESPONSE);
    expect(first.ok).toBe(true);

    if (!first.ok) {
      return;
    }

    const regenerated = JSON.stringify({
      currentMvp: {
        sequence: 1,
        features: [
          // Same name as the first generation's only feature — should keep FEAT-001, not become FEAT-002.
          {
            name: 'Patient login',
            description: 'Updated copy.',
            priority: 'Must Have',
            dependsOn: [],
            customerValue: 'x',
          },

          // Genuinely new — should mint the next available id.
          {
            name: 'Appointment reminders',
            description: 'x',
            priority: 'Should Have',
            dependsOn: ['Patient login'],
            customerValue: 'x',
          },
        ],
        engineeringHandoff: {
          scope: [],
          constraints: [],
          architectureGoals: [],
          successCriteria: [],
          acceptanceCriteria: [],
          outOfScopeFeatures: [],
          dependencies: [],
        },
      },
    });

    const second = productOwnerEngine.parseDraft(regenerated, first.draft);

    expect(second.ok).toBe(true);

    if (second.ok) {
      const [carriedForward, brandNew] = second.draft.currentMvp!.features;
      expect(carriedForward.id).toBe('FEAT-001');
      expect(brandNew.id).toBe('FEAT-002');
    }
  });

  it('treats a renamed feature as new (a documented limitation, not a bug — see docs/05-AI-Product-Owner/08-identity-and-traceability.md)', () => {
    const first = productOwnerEngine.parseDraft(VALID_RAW_RESPONSE);
    expect(first.ok).toBe(true);

    if (!first.ok) {
      return;
    }

    const renamed = JSON.stringify({
      currentMvp: {
        sequence: 1,
        features: [
          {
            name: 'Account sign-in',
            description: 'Renamed from Patient login.',
            priority: 'Must Have',
            dependsOn: [],
            customerValue: 'x',
          },
        ],
        engineeringHandoff: {
          scope: [],
          constraints: [],
          architectureGoals: [],
          successCriteria: [],
          acceptanceCriteria: [],
          outOfScopeFeatures: [],
          dependencies: [],
        },
      },
    });

    const second = productOwnerEngine.parseDraft(renamed, first.draft);

    expect(second.ok).toBe(true);

    if (second.ok) {
      // Not "FEAT-001" — a rename has no matching-name signal to carry forward against.
      expect(second.draft.currentMvp?.features[0].id).toBe('FEAT-002');
    }
  });
});

describe('hasLegacyEngineeringProgress / canGenerateProductOwner backward compatibility', () => {
  it('is false for a brand-new project with no engineering artifacts yet', () => {
    const project = makeProject([]);
    expect(hasLegacyEngineeringProgress(project)).toBe(false);
  });

  it('is true for a project that already has an approved Architecture Draft (predates this role)', () => {
    const project = makeProject([approved(ARTIFACT_TYPES.ARCHITECTURE_DRAFT)]);
    expect(hasLegacyEngineeringProgress(project)).toBe(true);
  });

  it('canGenerateProductOwner is false for a legacy project even with requirements captured, so it is never retroactively required', () => {
    const legacyKnowledge = { projectVision: 'x', coreFeatures: ['a'] };
    const project = makeProject([approved(ARTIFACT_TYPES.ARCHITECTURE_DRAFT)], legacyKnowledge);

    expect(productOwnerEngine.canGenerateProductOwner(project)).toBe(false);
  });
});
