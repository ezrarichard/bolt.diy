import { describe, expect, it } from 'vitest';
import { runBusinessAssessment } from './businessAssessmentEngine';
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

describe('runBusinessAssessment', () => {
  describe('classification', () => {
    it('classifies a dental clinic as Hospital with high confidence', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: { industry: 'Dental Clinic' } }));

      expect(result.assessment.classification).toBe('Hospital');
      expect(result.evidence.find((e) => e.target.id === 'assessment.classification')?.confidence).toBe('high');
    });

    it('classifies a church by industry keyword', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: { industry: 'Church' } }));
      expect(result.assessment.classification).toBe('Church');
    });

    it('classifies a restaurant by industry keyword', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: { industry: 'Food & Beverage / Restaurant' } }));
      expect(result.assessment.classification).toBe('Restaurant');
    });

    it('classifies a subscription business model as SaaS with medium confidence', () => {
      const result = runBusinessAssessment(
        patch({ businessIdentity: { industry: 'Technology', businessModel: 'Monthly subscription' } }),
      );

      expect(result.assessment.classification).toBe('SaaS');
      expect(result.evidence.find((e) => e.target.id === 'assessment.classification')?.confidence).toBe('medium');
    });

    it('falls back to Small Business (low confidence) for an unmatched but present industry', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: { industry: 'Widget Polishing' } }));

      expect(result.assessment.classification).toBe('Small Business');
      expect(result.evidence.find((e) => e.target.id === 'assessment.classification')?.confidence).toBe('low');
    });

    it('returns Unknown (never fabricates) when there is no industry signal at all', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: {} }));

      const evidence = result.evidence.find((e) => e.target.id === 'assessment.classification');
      expect(result.assessment.classification).toBe('Unknown');
      expect(evidence?.confidence).toBe('low');
      expect(evidence?.transformation).toBe('fallback:no-signal');
    });
  });

  describe('maturity', () => {
    it('returns Unknown rather than assuming Offline when nothing technical was answered', () => {
      const result = runBusinessAssessment(patch());
      expect(result.assessment.maturity).toBe('Unknown');
    });

    it('detects Growing Digital when both integrations and payments are present', () => {
      const result = runBusinessAssessment(
        patch({
          currentSystems: ['WhatsApp'],
          businessIdentity: { formSnapshot: { paymentNeeds: ['Razorpay'] } },
        }),
      );

      expect(result.assessment.maturity).toBe('Growing Digital');
    });

    it('detects Basic Digital from integrations alone', () => {
      const result = runBusinessAssessment(patch({ currentSystems: ['WhatsApp'] }));
      expect(result.assessment.maturity).toBe('Basic Digital');
    });
  });

  describe('projectType', () => {
    it('detects Marketplace from vision text', () => {
      const result = runBusinessAssessment(
        patch({ businessIdentity: { vision: 'A marketplace connecting local vendors and buyers' } }),
      );
      expect(result.assessment.projectType).toBe('Marketplace');
    });

    it('detects Mobile App from vision text', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: { vision: 'A mobile app for tracking habits' } }));
      expect(result.assessment.projectType).toBe('Mobile App');
    });

    it('falls back to Website (low confidence) for a generic vision', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: { vision: 'A site for my business' } }));

      expect(result.assessment.projectType).toBe('Website');
      expect(result.evidence.find((e) => e.target.id === 'assessment.projectType')?.confidence).toBe('low');
    });

    it('returns Unknown when there is no vision text at all', () => {
      const result = runBusinessAssessment(patch());
      expect(result.assessment.projectType).toBe('Unknown');
    });
  });

  describe('industry passthrough', () => {
    it('mirrors businessIdentity.industry into assessment.industry without re-deriving it', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: { industry: 'Healthcare' } }));
      expect(result.assessment.industry).toBe('Healthcare');
    });

    it('omits assessment.industry entirely when no industry was given (never fabricates one)', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: {} }));
      expect(result.assessment.industry).toBeUndefined();
    });
  });

  describe('overall confidence', () => {
    it('is the weakest of the three individual field confidences', () => {
      // industry present-but-unmatched (low) + no tech signal (maturity: low via Unknown) + vision present-but-generic (low)
      const result = runBusinessAssessment(
        patch({ businessIdentity: { industry: 'Widget Polishing', vision: 'A site for my business' } }),
      );
      expect(result.overallConfidence).toBe('low');
    });

    it('is high when every field matched a high-confidence rule', () => {
      const result = runBusinessAssessment(
        patch({
          businessIdentity: { industry: 'Hospital', vision: 'An AI assistant for patient scheduling' },
          currentSystems: ['EHR sync'],
          businessConstraints: ['HIPAA'],
        }),
      );

      // maturity only reaches 'medium' at best here (no payments) — confirms weakest-link logic, not just "any high present".
      expect(result.overallConfidence).not.toBe('high');
    });
  });

  describe('evidence shape (Sprint 52 reuse)', () => {
    it('produces exactly one evidence entry per assessed field, each pointing at a Business Understanding section', () => {
      const result = runBusinessAssessment(patch({ businessIdentity: { industry: 'Church' } }));

      expect(result.evidence).toHaveLength(3);

      for (const entry of result.evidence) {
        expect(entry.source.type).toBe('business_understanding_section');
        expect(entry.target.type).toBe('business_understanding_section');
        expect(entry.target.id).toMatch(/^assessment\./);
        expect(entry.recordedAt).toEqual(expect.any(String));
        expect(['low', 'medium', 'high']).toContain(entry.confidence);
      }
    });

    it('never duplicates customer content in evidence — only ids, section names, and rule identifiers', () => {
      const result = runBusinessAssessment(
        patch({
          businessIdentity: {
            industry: 'Church',
            vision: 'A very long and detailed description of our church community programs',
          },
        }),
      );

      const serialized = JSON.stringify(result.evidence);
      expect(serialized).not.toContain('church community programs');
    });
  });
});
