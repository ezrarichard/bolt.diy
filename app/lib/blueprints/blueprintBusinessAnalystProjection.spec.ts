import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveBlueprintSelection,
  projectBlueprintForBusinessAnalyst,
  hasBusinessAnalystBlueprintContent,
  describeSuppliedSections,
  formatBlueprintGuidanceSection,
} from './blueprintBusinessAnalystProjection';
import type { BlueprintContent } from './blueprintContentTypes';

describe('resolveEffectiveBlueprintSelection', () => {
  it('returns undefined when no resolution exists', () => {
    expect(resolveEffectiveBlueprintSelection(null)).toBeUndefined();
    expect(resolveEffectiveBlueprintSelection(undefined)).toBeUndefined();
  });

  it('uses the selected id and reports "recommendation" when selected equals recommended', () => {
    const result = resolveEffectiveBlueprintSelection({
      recommendedBlueprintId: 'business-website',
      selectedBlueprintId: 'business-website',
    });

    expect(result).toEqual({ blueprintId: 'business-website', selectionSource: 'recommendation' });
  });

  it('uses the selected id and reports "manual_override" when it differs from recommended', () => {
    const result = resolveEffectiveBlueprintSelection({
      recommendedBlueprintId: 'business-website',
      selectedBlueprintId: 'localshop-india',
    });

    expect(result).toEqual({ blueprintId: 'localshop-india', selectionSource: 'manual_override' });
  });
});

const FULL_CONTENT: BlueprintContent = {
  schemaVersion: 1,
  executiveSummary: { summary: 'A test blueprint.', valueProposition: 'Saves time.' },
  businessDomain: { industry: 'Retail', category: 'Commerce', description: 'Sells things.' },
  typicalCustomers: ['Small shop owners'],
  customerPersonas: [{ name: 'Priya', role: 'Owner', description: 'Runs a shop', goals: [], painPoints: [] }],
  businessGoals: [{ goal: 'Sell online', description: 'Reach more customers', priority: 'high' }],
  coreBusinessProcesses: [{ name: 'Checkout', description: 'Customer buys a product', steps: [] }],
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

describe('projectBlueprintForBusinessAnalyst', () => {
  it('returns undefined for a Blueprint with no structured content', () => {
    expect(projectBlueprintForBusinessAnalyst(undefined)).toBeUndefined();
  });

  it('includes only the 16 Business-Analyst-relevant sections, excluding engineering-heavy ones', () => {
    const projection = projectBlueprintForBusinessAnalyst(FULL_CONTENT);

    expect(projection?.executiveSummary).toEqual(FULL_CONTENT.executiveSummary);
    expect(projection?.standardFeatures).toEqual(FULL_CONTENT.standardFeatures);
    expect(projection?.futureEnhancements).toEqual(FULL_CONTENT.futureEnhancements);

    // engineering-heavy sections must never appear in the projection
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
    const sparse: BlueprintContent = { schemaVersion: 1, typicalCustomers: ['Shop owners'] };
    const projection = projectBlueprintForBusinessAnalyst(sparse);

    expect(projection?.typicalCustomers).toEqual(['Shop owners']);
    expect(projection?.businessGoals).toBeUndefined();
    expect(Object.keys(projection ?? {})).toEqual(['typicalCustomers']);
  });
});

describe('hasBusinessAnalystBlueprintContent', () => {
  it('is false for undefined and for an empty projection', () => {
    expect(hasBusinessAnalystBlueprintContent(undefined)).toBe(false);
    expect(hasBusinessAnalystBlueprintContent(projectBlueprintForBusinessAnalyst({ schemaVersion: 1 }))).toBe(false);
  });

  it('is true once at least one section is populated', () => {
    expect(hasBusinessAnalystBlueprintContent(projectBlueprintForBusinessAnalyst(FULL_CONTENT))).toBe(true);
  });
});

describe('describeSuppliedSections', () => {
  it('lists exactly the populated section keys, for traceability', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      typicalCustomers: ['Shop owners'],
      standardFeatures: [{ name: 'Cart', description: 'x' }],
    };

    expect(describeSuppliedSections(projectBlueprintForBusinessAnalyst(sparse))).toEqual([
      'typicalCustomers',
      'standardFeatures',
    ]);
  });

  it('is empty for undefined', () => {
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });
});

describe('formatBlueprintGuidanceSection', () => {
  it('always states the advisory-only priority instruction', () => {
    const text = formatBlueprintGuidanceSection('LocalShop India', 'recommendation', undefined);
    expect(text).toContain('Customer discovery');
    expect(text).toContain('NOT a requirement');
  });

  it('falls back safely when the Blueprint has no structured content', () => {
    const text = formatBlueprintGuidanceSection('Shopify App', 'recommendation', undefined);
    expect(text).toContain('No structured Blueprint knowledge is available');
  });

  it('labels a manual override distinctly from an accepted recommendation', () => {
    const recommended = formatBlueprintGuidanceSection('Business Website', 'recommendation', undefined);
    const overridden = formatBlueprintGuidanceSection('LocalShop India', 'manual_override', undefined);

    expect(recommended).toContain('the recommended match');
    expect(overridden).toContain('manually selected by the user');
  });

  it('includes populated sections and warns against treating optional features as mandatory', () => {
    const projection = projectBlueprintForBusinessAnalyst(FULL_CONTENT);
    const text = formatBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Sells things.');
    expect(text).toContain('Loyalty program');
    expect(text).toContain('do not add merely because they');
  });
});
