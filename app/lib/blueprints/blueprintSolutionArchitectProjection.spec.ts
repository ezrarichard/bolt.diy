import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveBlueprintSelection,
  projectBlueprintForSolutionArchitect,
  hasSolutionArchitectBlueprintContent,
  describeSuppliedSections,
  formatSolutionArchitectBlueprintGuidanceSection,
} from './blueprintSolutionArchitectProjection';
import type { BlueprintContent } from './blueprintContentTypes';

describe('resolveEffectiveBlueprintSelection (re-exported, Sprint 63 logic)', () => {
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
  dataEntities: [
    { name: 'Product', description: 'An item for sale', keyFields: ['sku', 'price'], relationships: ['Order'] },
  ],
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

describe('projectBlueprintForSolutionArchitect', () => {
  it('returns undefined for a Blueprint with no structured content', () => {
    expect(projectBlueprintForSolutionArchitect(undefined)).toBeUndefined();
  });

  it('includes only the 10 architecture-relevant sections, excluding planning-only and UI-specific ones', () => {
    const projection = projectBlueprintForSolutionArchitect(FULL_CONTENT);

    expect(projection?.businessDomain).toEqual(FULL_CONTENT.businessDomain);
    expect(projection?.functionalModules).toEqual(FULL_CONTENT.functionalModules);
    expect(projection?.userRoles).toEqual(FULL_CONTENT.userRoles);
    expect(projection?.businessRules).toEqual(FULL_CONTENT.businessRules);
    expect(projection?.integrations).toEqual(FULL_CONTENT.integrations);
    expect(projection?.compliance).toEqual(FULL_CONTENT.compliance);
    expect(projection?.dataEntities).toEqual(FULL_CONTENT.dataEntities);
    expect(projection?.security).toEqual(FULL_CONTENT.security);
    expect(projection?.performanceExpectations).toEqual(FULL_CONTENT.performanceExpectations);
    expect(projection?.deploymentConsiderations).toEqual(FULL_CONTENT.deploymentConsiderations);

    // planning-only sections must never appear in the projection
    expect((projection as Record<string, unknown>).executiveSummary).toBeUndefined();
    expect((projection as Record<string, unknown>).typicalCustomers).toBeUndefined();
    expect((projection as Record<string, unknown>).customerPersonas).toBeUndefined();
    expect((projection as Record<string, unknown>).businessGoals).toBeUndefined();
    expect((projection as Record<string, unknown>).coreBusinessProcesses).toBeUndefined();
    expect((projection as Record<string, unknown>).standardFeatures).toBeUndefined();
    expect((projection as Record<string, unknown>).optionalFeatures).toBeUndefined();
    expect((projection as Record<string, unknown>).futureEnhancements).toBeUndefined();

    // UI-specific / QA-specific sections must never appear either
    expect((projection as Record<string, unknown>).uiPatterns).toBeUndefined();
    expect((projection as Record<string, unknown>).navigation).toBeUndefined();
    expect((projection as Record<string, unknown>).dashboardSuggestions).toBeUndefined();
    expect((projection as Record<string, unknown>).reports).toBeUndefined();
    expect((projection as Record<string, unknown>).notifications).toBeUndefined();
    expect((projection as Record<string, unknown>).testingScenarios).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: BlueprintContent = { schemaVersion: 1, security: [{ concern: 'XSS', mitigation: 'Sanitize input' }] };
    const projection = projectBlueprintForSolutionArchitect(sparse);

    expect(projection?.security).toEqual(sparse.security);
    expect(projection?.functionalModules).toBeUndefined();
    expect(Object.keys(projection ?? {})).toEqual(['security']);
  });
});

describe('hasSolutionArchitectBlueprintContent', () => {
  it('is false for undefined and for an empty projection', () => {
    expect(hasSolutionArchitectBlueprintContent(undefined)).toBe(false);
    expect(hasSolutionArchitectBlueprintContent(projectBlueprintForSolutionArchitect({ schemaVersion: 1 }))).toBe(
      false,
    );
  });

  it('is true once at least one section is populated', () => {
    expect(hasSolutionArchitectBlueprintContent(projectBlueprintForSolutionArchitect(FULL_CONTENT))).toBe(true);
  });
});

describe('describeSuppliedSections', () => {
  it('lists exactly the populated section keys, for traceability', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      security: [{ concern: 'XSS', mitigation: 'Sanitize input' }],
      performanceExpectations: [{ metric: 'p95 latency', target: '<300ms' }],
    };

    expect(describeSuppliedSections(projectBlueprintForSolutionArchitect(sparse))).toEqual([
      'security',
      'performanceExpectations',
    ]);
  });

  it('is empty for undefined', () => {
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });
});

describe('formatSolutionArchitectBlueprintGuidanceSection', () => {
  it('always states the advisory-only, MVP-boundary-respecting instruction', () => {
    const text = formatSolutionArchitectBlueprintGuidanceSection('LocalShop India', 'recommendation', undefined);
    expect(text).toContain('NOT a scope change');
    expect(text).toContain('Engineering Handoff');
  });

  it('falls back safely when the Blueprint has no structured content', () => {
    const text = formatSolutionArchitectBlueprintGuidanceSection('Shopify App', 'recommendation', undefined);
    expect(text).toContain('No structured Blueprint knowledge is available');
  });

  it('labels a manual override distinctly from an accepted recommendation', () => {
    const recommended = formatSolutionArchitectBlueprintGuidanceSection(
      'Business Website',
      'recommendation',
      undefined,
    );
    const overridden = formatSolutionArchitectBlueprintGuidanceSection('LocalShop India', 'manual_override', undefined);

    expect(recommended).toContain('the recommended match');
    expect(overridden).toContain('manually selected by the user');
  });

  it('includes security expectations when available', () => {
    const projection = projectBlueprintForSolutionArchitect(FULL_CONTENT);
    const text = formatSolutionArchitectBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Security expectations');
    expect(text).toContain('Payment fraud');
    expect(text).toContain('Use a PCI-compliant gateway');
  });

  it('includes performance expectations when available', () => {
    const projection = projectBlueprintForSolutionArchitect(FULL_CONTENT);
    const text = formatSolutionArchitectBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Performance expectations');
    expect(text).toContain('Load time');
    expect(text).toContain('<2s');
  });

  it('includes deployment considerations and integration planning when available', () => {
    const projection = projectBlueprintForSolutionArchitect(FULL_CONTENT);
    const text = formatSolutionArchitectBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Deployment considerations');
    expect(text).toContain('SSL');
    expect(text).toContain('Typical integrations / external systems');
    expect(text).toContain('Razorpay');
  });

  it('presents data entities at a high level only, never keyFields/relationships', () => {
    const projection = projectBlueprintForSolutionArchitect(FULL_CONTENT);
    const text = formatSolutionArchitectBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('high level only');
    expect(text).toContain('Product');
    expect(text).not.toContain('sku');
    expect(text).not.toContain('Order');
  });
});
