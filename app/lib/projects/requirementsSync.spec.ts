import { describe, expect, it } from 'vitest';
import {
  createSyncedRequirementsArtifact,
  deriveRequirementsDraftFromKnowledge,
  isSyncedRequirementsArtifact,
  syncedRequirementsArtifactId,
} from './requirementsSync';
import type { ProjectKnowledge } from './knowledge';

describe('deriveRequirementsDraftFromKnowledge', () => {
  it('maps direct-counterpart fields across without an LLM call', () => {
    const knowledge: ProjectKnowledge = {
      projectVision: 'A modern dental clinic website.',
      targetUsers: 'Local patients.',
      businessModel: 'Service-based.',
      coreFeatures: ['Appointments', 'Doctor profiles'],
      pagesOrScreens: ['Home', 'Contact'],
      userRoles: ['Admin', 'Patient'],
      complianceNeeds: ['HIPAA'],
      paymentNeeds: ['Stripe'],
      shippingNeeds: [],
      languages: ['English'],
      technicalPreferences: 'Next.js',
    };

    const draft = deriveRequirementsDraftFromKnowledge(knowledge);

    expect(draft.businessVision).toBe(knowledge.projectVision);
    expect(draft.targetAudience).toBe(knowledge.targetUsers);
    expect(draft.businessModel).toBe(knowledge.businessModel);
    expect(draft.coreFeatures).toEqual(knowledge.coreFeatures);
    expect(draft.pages).toEqual(knowledge.pagesOrScreens);
    expect(draft.userRoles).toEqual(knowledge.userRoles);
    expect(draft.compliance).toEqual(knowledge.complianceNeeds);
    expect(draft.payments).toEqual(knowledge.paymentNeeds);
    expect(draft.languages).toEqual(knowledge.languages);
    expect(draft.technologyRecommendations).toEqual(['Next.js']);
  });

  it('folds fields with no direct RequirementsDraft counterpart into engineeringNotes rather than dropping them', () => {
    const knowledge: ProjectKnowledge = {
      industry: 'Healthcare',
      location: 'Bengaluru, India',
      brandTone: 'Warm and reassuring',
      designPreferences: 'Minimal, calming colors',
      notes: 'Prefers a soft launch first.',
    };

    const draft = deriveRequirementsDraftFromKnowledge(knowledge);

    expect(draft.engineeringNotes).toContain('Healthcare');
    expect(draft.engineeringNotes).toContain('Bengaluru, India');
    expect(draft.engineeringNotes).toContain('Warm and reassuring');
    expect(draft.engineeringNotes).toContain('Minimal, calming colors');
    expect(draft.engineeringNotes).toContain('Prefers a soft launch first.');
  });

  it('omits engineeringNotes entirely when none of the free-text fields are set', () => {
    const draft = deriveRequirementsDraftFromKnowledge({ coreFeatures: ['X'] });
    expect(draft.engineeringNotes).toBeUndefined();
  });
});

describe('createSyncedRequirementsArtifact', () => {
  it('is always version 1 and approved, using a deterministic id for the project', () => {
    const artifact = createSyncedRequirementsArtifact('proj-1', { projectVision: 'Vision' });

    expect(artifact.version).toBe(1);
    expect(artifact.status).toBe('approved');
    expect(artifact.id).toBe(syncedRequirementsArtifactId('proj-1'));
    expect(artifact.type).toBe('requirements-draft');
  });

  it('produces the same id for the same project every time (idempotent target)', () => {
    const first = createSyncedRequirementsArtifact('proj-1', { projectVision: 'A' });
    const second = createSyncedRequirementsArtifact('proj-1', { projectVision: 'B' });

    expect(first.id).toBe(second.id);
  });

  it('produces distinct ids for distinct projects', () => {
    const a = createSyncedRequirementsArtifact('proj-1', { projectVision: 'A' });
    const b = createSyncedRequirementsArtifact('proj-2', { projectVision: 'A' });

    expect(a.id).not.toBe(b.id);
  });
});

describe('isSyncedRequirementsArtifact', () => {
  it('identifies the synced artifact by its deterministic id', () => {
    const synced = createSyncedRequirementsArtifact('proj-1', { projectVision: 'A' });
    expect(isSyncedRequirementsArtifact(synced, 'proj-1')).toBe(true);
  });

  it('does not misidentify a real, independently-generated artifact', () => {
    expect(isSyncedRequirementsArtifact({ id: 'artifact-1784058015321-iv84r9' }, 'proj-1')).toBe(false);
  });
});
