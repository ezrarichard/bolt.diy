import { describe, expect, it } from 'vitest';
import { resolveBlueprintCandidates } from './blueprintResolutionEngine';
import { PROJECT_BLUEPRINTS } from './registry';
import type { BusinessUnderstandingModel } from '~/lib/projects/requirementsSession';

function makeModel(overrides: Partial<BusinessUnderstandingModel> = {}): BusinessUnderstandingModel {
  return {
    id: 'model-1',
    sessionId: 'session-1',
    schemaVersion: 1,
    assessment: {},
    decision: {},
    businessIdentity: {},
    businessGoals: [],
    processes: [],
    targetUsers: [],
    painPoints: [],
    businessConstraints: [],
    currentSystems: [],
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    recommendations: [],
    assumptions: [],
    risks: [],
    openQuestions: [],
    traceability: [],
    completeness: { categories: {}, overallReady: false },
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveBlueprintCandidates', () => {
  it('ranks every enabled blueprint, most confident first', () => {
    const result = resolveBlueprintCandidates(makeModel(), PROJECT_BLUEPRINTS);

    expect(result.candidates.length).toBe(PROJECT_BLUEPRINTS.filter((b) => b.enabled).length);

    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].confidence).toBeGreaterThanOrEqual(result.candidates[i].confidence);
    }

    expect(result.recommendedBlueprintId).toBe(result.candidates[0]?.blueprintId);
  });

  it('never forces a choice when nothing has been discovered yet', () => {
    const result = resolveBlueprintCandidates(makeModel(), PROJECT_BLUEPRINTS);

    for (const candidate of result.candidates) {
      expect(candidate.confidence).toBe(0);
      expect(candidate.reasons).toEqual([]);
    }
  });

  it('recommends Business Website for a local service business with contact/booking needs', () => {
    const model = makeModel({
      assessment: { industry: 'Retail', classification: 'Small Business', projectType: 'Website' },
      businessIdentity: { industry: 'Local service business', vision: 'A marketing website for a local salon' },
      businessGoals: ['Generate enquiries', 'Establish credibility'],
      functionalRequirements: ['Contact form', 'WhatsApp CTA', 'Online booking/appointment widget'],
      targetUsers: ['Local shop owners and service providers'],
    });

    const result = resolveBlueprintCandidates(model, PROJECT_BLUEPRINTS);

    expect(result.recommendedBlueprintId).toBe('business-website');
    expect(result.candidates[0].confidence).toBeGreaterThan(0);
    expect(result.candidates[0].reasons.length).toBeGreaterThan(0);
  });

  it('recommends LocalShop India for an MSME commerce storefront', () => {
    const model = makeModel({
      assessment: { industry: 'Retail', classification: 'Retail', projectType: 'Marketplace' },
      businessIdentity: {
        industry: 'Retail & E-commerce (India)',
        vision: 'A commerce storefront for a clothing store selling online',
        businessModel: 'Product sales with UPI payments',
      },
      businessGoals: ['Digitize the storefront', 'Enable India-native payments'],
      functionalRequirements: ['Product catalog', 'Cart and checkout', 'Razorpay / UPI payments'],
      targetUsers: ['Local shop owners digitizing an existing offline store'],
    });

    const result = resolveBlueprintCandidates(model, PROJECT_BLUEPRINTS);

    expect(result.recommendedBlueprintId).toBe('localshop-india');
  });

  it('recommends AI Agent for an autonomous AI SaaS product', () => {
    const model = makeModel({
      assessment: { industry: 'SaaS', classification: 'SaaS', projectType: 'AI Platform' },
      businessIdentity: {
        industry: 'AI / Software Automation',
        vision: 'An autonomous AI agent that uses tool calling and a knowledge base to automate support',
      },
      businessGoals: ['Reliable task completion', 'Transparent reasoning'],
      functionalRequirements: ['Tool calling', 'Knowledge base retrieval', 'Conversation memory'],
      targetUsers: ['Internal teams automating repetitive workflows'],
    });

    const result = resolveBlueprintCandidates(model, PROJECT_BLUEPRINTS);

    expect(result.recommendedBlueprintId).toBe('ai-agent');
  });

  it('recommends Mobile App for a mobile-first companion product', () => {
    const model = makeModel({
      assessment: { projectType: 'Mobile App' },
      businessIdentity: { vision: 'A mobile app companion for our existing product, iOS and Android' },
      functionalRequirements: ['Push notifications', 'App navigation', 'Core screens'],
      targetUsers: ['Mobile users on iOS and Android'],
    });

    const result = resolveBlueprintCandidates(model, PROJECT_BLUEPRINTS);

    expect(result.recommendedBlueprintId).toBe('mobile-app');
  });

  it('never returns disabled blueprints as candidates', () => {
    const disabled = PROJECT_BLUEPRINTS.find((b) => !b.enabled);

    if (!disabled) {
      return;
    }

    const result = resolveBlueprintCandidates(makeModel(), PROJECT_BLUEPRINTS);
    expect(result.candidates.some((c) => c.blueprintId === disabled.id)).toBe(false);
  });

  it('caps confidence at 100 and keeps it non-negative', () => {
    const result = resolveBlueprintCandidates(makeModel(), PROJECT_BLUEPRINTS);

    for (const candidate of result.candidates) {
      expect(candidate.confidence).toBeGreaterThanOrEqual(0);
      expect(candidate.confidence).toBeLessThanOrEqual(100);
    }
  });
});
