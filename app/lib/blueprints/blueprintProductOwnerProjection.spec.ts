import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveBlueprintSelection,
  projectBlueprintForProductOwner,
  hasProductOwnerBlueprintContent,
  describeSuppliedSections,
  formatProductOwnerBlueprintGuidanceSection,
} from './blueprintProductOwnerProjection';
import type { BlueprintContent } from './blueprintContentTypes';

describe('resolveEffectiveBlueprintSelection (reused from Sprint 63)', () => {
  it('returns undefined when no resolution exists', () => {
    expect(resolveEffectiveBlueprintSelection(null)).toBeUndefined();
  });

  it('reports manual_override when selected differs from recommended', () => {
    const result = resolveEffectiveBlueprintSelection({
      recommendedBlueprintId: 'business-website',
      selectedBlueprintId: 'ai-agent',
    });

    expect(result).toEqual({ blueprintId: 'ai-agent', selectionSource: 'manual_override' });
  });
});

const FULL_CONTENT: BlueprintContent = {
  schemaVersion: 1,
  executiveSummary: { summary: 'A test blueprint.', valueProposition: 'Saves time.' },
  businessDomain: { industry: 'Retail', category: 'Commerce', description: 'Sells things.' },
  typicalCustomers: ['Small shop owners'],
  customerPersonas: [{ name: 'Priya', role: 'Owner', description: 'Runs a shop', goals: [], painPoints: [] }],
  businessGoals: [{ goal: 'Sell online', description: 'Reach more customers', priority: 'high' }],
  coreBusinessProcesses: [
    { name: 'Checkout', description: 'Customer buys a product', steps: ['Browse', 'Cart', 'Pay'] },
  ],
  functionalModules: [{ name: 'Catalog', description: 'Product listing', features: [] }],
  standardFeatures: [{ name: 'Cart', description: 'Shopping cart' }],
  optionalFeatures: [{ name: 'Loyalty program', description: 'Repeat customer discounts' }],
  userRoles: [{ name: 'Customer', description: 'Buys products', permissions: [] }],
  businessRules: [{ rule: 'No overselling', rationale: 'Prevents complaints' }],
  dataEntities: [{ name: 'Product', description: 'An item', keyFields: [], relationships: [] }],
  integrations: [{ name: 'Razorpay', purpose: 'Payments', required: true }],
  compliance: [{ name: 'GST invoicing', description: 'Tax compliance' }],
  uiPatterns: [{ name: 'Sticky cart', description: 'Always visible' }],
  navigation: [{ label: 'Home', description: 'Landing page' }],
  dashboardSuggestions: [{ name: 'Sales', description: 'Revenue overview', metrics: [] }],
  reports: [{ name: 'Sales Report', description: 'Monthly revenue', audience: 'Owner' }],
  notifications: [{ name: 'Order placed', trigger: 'Checkout', channel: 'WhatsApp' }],
  security: [{ concern: 'Payment fraud', mitigation: 'Use a PCI-compliant gateway' }],
  performanceExpectations: [{ metric: 'Load time', target: '<2s' }],
  testingScenarios: [{ scenario: 'Checkout with valid card', expectedOutcome: 'Order confirmed' }],
  deploymentConsiderations: [{ consideration: 'SSL', detail: 'Required' }],
  futureEnhancements: [{ idea: 'Loyalty tiers', description: 'Reward repeat customers' }],
};

describe('projectBlueprintForProductOwner', () => {
  it('returns undefined for a Blueprint with no structured content', () => {
    expect(projectBlueprintForProductOwner(undefined)).toBeUndefined();
  });

  it('includes only the 12 Product-Owner-relevant sections, excluding BA-only and engineering sections', () => {
    const projection = projectBlueprintForProductOwner(FULL_CONTENT);

    expect(projection?.businessGoals).toEqual(FULL_CONTENT.businessGoals);
    expect(projection?.coreBusinessProcesses).toEqual(FULL_CONTENT.coreBusinessProcesses);
    expect(projection?.futureEnhancements).toEqual(FULL_CONTENT.futureEnhancements);

    // Business-Analyst-only sections must never appear in the Product Owner projection.
    expect((projection as Record<string, unknown>).executiveSummary).toBeUndefined();
    expect((projection as Record<string, unknown>).businessDomain).toBeUndefined();
    expect((projection as Record<string, unknown>).typicalCustomers).toBeUndefined();
    expect((projection as Record<string, unknown>).customerPersonas).toBeUndefined();

    // Engineering-heavy sections must never appear either.
    expect((projection as Record<string, unknown>).dataEntities).toBeUndefined();
    expect((projection as Record<string, unknown>).uiPatterns).toBeUndefined();
    expect((projection as Record<string, unknown>).navigation).toBeUndefined();
    expect((projection as Record<string, unknown>).dashboardSuggestions).toBeUndefined();
    expect((projection as Record<string, unknown>).security).toBeUndefined();
    expect((projection as Record<string, unknown>).performanceExpectations).toBeUndefined();
    expect((projection as Record<string, unknown>).testingScenarios).toBeUndefined();
    expect((projection as Record<string, unknown>).deploymentConsiderations).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: BlueprintContent = { schemaVersion: 1, standardFeatures: [{ name: 'Cart', description: 'x' }] };
    const projection = projectBlueprintForProductOwner(sparse);

    expect(projection?.standardFeatures).toEqual(sparse.standardFeatures);
    expect(projection?.businessGoals).toBeUndefined();
    expect(Object.keys(projection ?? {})).toEqual(['standardFeatures']);
  });
});

describe('hasProductOwnerBlueprintContent', () => {
  it('is false for undefined and an empty projection', () => {
    expect(hasProductOwnerBlueprintContent(undefined)).toBe(false);
    expect(hasProductOwnerBlueprintContent(projectBlueprintForProductOwner({ schemaVersion: 1 }))).toBe(false);
  });

  it('is true once at least one section is populated', () => {
    expect(hasProductOwnerBlueprintContent(projectBlueprintForProductOwner(FULL_CONTENT))).toBe(true);
  });
});

describe('describeSuppliedSections', () => {
  it('lists exactly the populated section keys', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      businessGoals: [{ goal: 'x', description: 'y', priority: 'high' }],
      compliance: [{ name: 'GST', description: 'x' }],
    };

    expect(describeSuppliedSections(projectBlueprintForProductOwner(sparse))).toEqual(['businessGoals', 'compliance']);
  });

  it('is empty for undefined', () => {
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });
});

describe('formatProductOwnerBlueprintGuidanceSection', () => {
  it('always states scope-discipline instructions', () => {
    const text = formatProductOwnerBlueprintGuidanceSection('LocalShop India', 'recommendation', undefined);
    expect(text).toContain('NOT confirmed scope');
    expect(text).toContain('the customer wins');
  });

  it('falls back safely when the Blueprint has no structured content', () => {
    const text = formatProductOwnerBlueprintGuidanceSection('Shopify App', 'recommendation', undefined);
    expect(text).toContain('No structured Blueprint knowledge is available');
  });

  it('labels a manual override distinctly from an accepted recommendation', () => {
    const recommended = formatProductOwnerBlueprintGuidanceSection('Business Website', 'recommendation', undefined);
    const overridden = formatProductOwnerBlueprintGuidanceSection('AI Agent', 'manual_override', undefined);

    expect(recommended).toContain('the recommended match');
    expect(overridden).toContain('manually selected by the user');
  });

  it('includes populated sections and marks optional features as recommendations only', () => {
    const projection = projectBlueprintForProductOwner(FULL_CONTENT);
    const text = formatProductOwnerBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Loyalty program');
    expect(text).toContain('recommend, never auto-scope');
    expect(text).toContain('Checkout');
    expect(text).toContain('Browse → Cart → Pay');
  });
});
