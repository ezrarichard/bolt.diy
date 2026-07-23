import { describe, expect, it } from 'vitest';
import { runBusinessAssessment } from './businessAssessmentEngine';
import { runDiscoveryDecision } from './discoveryDecisionEngine';
import type { BusinessUnderstandingModelPatch } from '~/lib/builders-db/requirementsSessionDbTypes';

function patch(overrides: Partial<BusinessUnderstandingModelPatch> = {}): BusinessUnderstandingModelPatch {
  return {
    businessIdentity: {},
    targetUsers: [],
    functionalRequirements: [],
    currentSystems: [],
    businessConstraints: [],
    ...overrides,
  };
}

function decide(overrides: Partial<BusinessUnderstandingModelPatch> = {}) {
  const p = patch(overrides);
  return runDiscoveryDecision(p, runBusinessAssessment(p));
}

const WELL_DESCRIBED = patch({
  businessIdentity: {
    industry: 'Hospital',
    vision: 'A patient portal for scheduling appointments and managing records across a multi-location dental clinic',
    formSnapshot: { technicalPreferences: 'Prefer a React frontend with a Postgres-backed API' },
  },
  targetUsers: ['Front-desk staff, dentists, and patients booking appointments online'],
  functionalRequirements: ['Online appointment booking', 'Patient records', 'Insurance claim tracking'],
  currentSystems: ['Existing EHR system', 'SMS reminder service'],
  businessConstraints: ['HIPAA compliance', 'Card payments via Stripe'],
});

const PARTIALLY_COMPLETED = patch({
  businessIdentity: { industry: 'Retail' },
  targetUsers: ['Shoppers'],
  functionalRequirements: ['Product catalog'],
});

const NEARLY_EMPTY = patch();

describe('runDiscoveryDecision', () => {
  describe('decision state', () => {
    it('returns READY for a well-described project with no missing dimensions', () => {
      const { decision } = decide(WELL_DESCRIBED);

      expect(decision.state).toBe('READY');
      expect(decision.readyForRequirementsDraft).toBe(true);
      expect(decision.missingAreas).toEqual([]);
      expect(decision.completenessScore).toBeGreaterThanOrEqual(70);
    });

    it('returns NEEDS_MORE_INFORMATION for a partially completed project', () => {
      const { decision } = decide(PARTIALLY_COMPLETED);

      expect(decision.state).toBe('NEEDS_MORE_INFORMATION');
      expect(decision.readyForRequirementsDraft).toBe(false);
      expect(decision.completenessScore).toBeGreaterThan(0);
      expect(decision.completenessScore).toBeLessThan(70);
    });

    it('returns INSUFFICIENT_INFORMATION for a nearly empty project', () => {
      const { decision } = decide(NEARLY_EMPTY);

      expect(decision.state).toBe('INSUFFICIENT_INFORMATION');
      expect(decision.readyForRequirementsDraft).toBe(false);
      expect(decision.completenessScore).toBeLessThan(25);
    });

    it('never returns READY when at least one dimension is missing, even at a high score', () => {
      // Every dimension complete except technicalPreferences (never answered) — should still gate on missingAreas.
      const almostComplete = patch({
        businessIdentity: {
          industry: 'Hospital',
          vision: 'A patient scheduling and records platform for a multi-location dental clinic group',
        },
        targetUsers: ['Front-desk staff, dentists, and patients booking appointments online'],
        functionalRequirements: ['Online appointment booking', 'Patient records', 'Insurance claim tracking'],
        currentSystems: ['Existing EHR system', 'SMS reminder service'],
        businessConstraints: ['HIPAA compliance', 'Card payments via Stripe'],
      });

      const { decision } = decide(almostComplete);

      expect(decision.missingAreas).toContain('technicalPreferences');
      expect(decision.state).not.toBe('READY');
    });
  });

  describe('dimensions', () => {
    it('marks businessVision missing when there is no vision text at all', () => {
      const { decision } = decide(NEARLY_EMPTY);
      expect(decision.missingAreas).toContain('businessVision');
    });

    it('marks businessVision partial for a short vision and complete for a substantial one', () => {
      const short = decide({ businessIdentity: { vision: 'A CRM' } });
      expect(short.decision.partialAreas).toContain('businessVision');

      const substantial = decide({
        businessIdentity: { vision: 'A CRM for tracking leads across our regional sales teams' },
      });
      expect(substantial.decision.missingAreas).not.toContain('businessVision');
      expect(substantial.decision.partialAreas).not.toContain('businessVision');
    });

    it('marks coreFeatures partial with one feature and complete with two or more', () => {
      const one = decide({ functionalRequirements: ['Checkout'] });
      expect(one.decision.partialAreas).toContain('coreFeatures');

      const two = decide({ functionalRequirements: ['Checkout', 'Search'] });
      expect(two.decision.partialAreas).not.toContain('coreFeatures');
      expect(two.decision.missingAreas).not.toContain('coreFeatures');
    });

    it('marks industry missing when no industry was given, and partial for an unmatched low-confidence industry', () => {
      const missing = decide(NEARLY_EMPTY);
      expect(missing.decision.missingAreas).toContain('industry');

      const lowConfidence = decide({ businessIdentity: { industry: 'Widget Polishing' } });
      expect(lowConfidence.decision.partialAreas).toContain('industry');

      const highConfidence = decide({ businessIdentity: { industry: 'Hospital' } });
      expect(highConfidence.decision.missingAreas).not.toContain('industry');
      expect(highConfidence.decision.partialAreas).not.toContain('industry');
    });

    it('marks businessAssessment complete only when classification, maturity, and projectType are all known', () => {
      const allUnknown = decide(NEARLY_EMPTY);
      expect(allUnknown.decision.missingAreas).toContain('businessAssessment');

      const allKnown = decide({
        businessIdentity: { industry: 'Hospital', vision: 'A mobile app for booking appointments' },
        currentSystems: ['EHR sync'],
      });
      expect(allKnown.decision.missingAreas).not.toContain('businessAssessment');
      expect(allKnown.decision.partialAreas).not.toContain('businessAssessment');
    });

    it('treats currentSystems and integrations identically, since both derive from the same form signal', () => {
      const { decision } = decide({ currentSystems: ['WhatsApp'] });
      const currentSystemsStatus = decision.partialAreas?.includes('currentSystems')
        ? 'partial'
        : decision.missingAreas?.includes('currentSystems')
          ? 'missing'
          : 'complete';
      const integrationsStatus = decision.partialAreas?.includes('integrations')
        ? 'partial'
        : decision.missingAreas?.includes('integrations')
          ? 'missing'
          : 'complete';

      expect(integrationsStatus).toBe(currentSystemsStatus);
    });
  });

  describe('completenessScore', () => {
    it('is 0 for a completely empty patch', () => {
      const { decision } = decide(NEARLY_EMPTY);
      expect(decision.completenessScore).toBe(0);
    });

    it('is 100 for every dimension complete', () => {
      const { decision } = decide(WELL_DESCRIBED);
      expect(decision.completenessScore).toBe(100);
    });

    it('is monotonic — adding a populated dimension never decreases the score', () => {
      const before = decide(PARTIALLY_COMPLETED).decision.completenessScore ?? 0;
      const after =
        decide({ ...PARTIALLY_COMPLETED, businessConstraints: ['HIPAA', 'PCI-DSS'] }).decision.completenessScore ?? 0;

      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('overallConfidence', () => {
    it('is high for a well-described project', () => {
      expect(decide(WELL_DESCRIBED).decision.overallConfidence).toBe('high');
    });

    it('is low for a nearly empty project', () => {
      expect(decide(NEARLY_EMPTY).decision.overallConfidence).toBe('low');
    });
  });

  describe('evidence shape (Sprint 52/53 reuse)', () => {
    it('produces exactly four evidence entries, one per headline decision output', () => {
      const { evidence } = decide(PARTIALLY_COMPLETED);

      expect(evidence).toHaveLength(4);
      expect(evidence.map((e) => e.target.id).sort()).toEqual(
        ['decision.completenessScore', 'decision.missingAreas', 'decision.partialAreas', 'decision.state'].sort(),
      );

      for (const entry of evidence) {
        expect(entry.source.type).toBe('business_understanding_section');
        expect(entry.target.type).toBe('business_understanding_section');
        expect(entry.recordedAt).toEqual(expect.any(String));
      }
    });

    it('never duplicates customer content in evidence — only ids and rule identifiers', () => {
      const { evidence } = decide({
        businessIdentity: { vision: 'A very long and detailed description of our unique business plan' },
      });

      const serialized = JSON.stringify(evidence);
      expect(serialized).not.toContain('unique business plan');
    });
  });
});
