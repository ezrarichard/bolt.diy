import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveBlueprintSelection,
  projectBlueprintForQa,
  hasQaBlueprintContent,
  describeSuppliedSections,
  formatQaBlueprintGuidanceSection,
} from './blueprintQaProjection';
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
  performanceExpectations: [{ metric: 'API latency', target: '<200ms' }],
  testingScenarios: [{ scenario: 'Checkout with valid card', expectedOutcome: 'Order confirmed' }],
  deploymentConsiderations: [{ consideration: 'Autoscaling', detail: 'Scale on CPU > 70%' }],
  futureEnhancements: [{ idea: 'Loyalty tiers', description: 'Reward repeat customers' }],
};

describe('projectBlueprintForQa', () => {
  it('returns undefined for a Blueprint with no structured content', () => {
    expect(projectBlueprintForQa(undefined)).toBeUndefined();
  });

  it('includes only the 13 QA-relevant sections, excluding UI/deployment/planning-only/BA-only ones', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);

    expect(projection?.functionalModules).toEqual(FULL_CONTENT.functionalModules);
    expect(projection?.coreBusinessProcesses).toEqual(FULL_CONTENT.coreBusinessProcesses);
    expect(projection?.standardFeatures).toEqual(FULL_CONTENT.standardFeatures);
    expect(projection?.businessRules).toEqual(FULL_CONTENT.businessRules);
    expect(projection?.userRoles).toEqual(FULL_CONTENT.userRoles);
    expect(projection?.integrations).toEqual(FULL_CONTENT.integrations);
    expect(projection?.notifications).toEqual(FULL_CONTENT.notifications);
    expect(projection?.reports).toEqual(FULL_CONTENT.reports);
    expect(projection?.compliance).toEqual(FULL_CONTENT.compliance);
    expect(projection?.security).toEqual(FULL_CONTENT.security);
    expect(projection?.performanceExpectations).toEqual(FULL_CONTENT.performanceExpectations);
    expect(projection?.testingScenarios).toEqual(FULL_CONTENT.testingScenarios);
    expect(projection?.dataEntities).toEqual(FULL_CONTENT.dataEntities);

    // Deployment/UI/planning-only/BA-only sections must never appear
    expect((projection as Record<string, unknown>).executiveSummary).toBeUndefined();
    expect((projection as Record<string, unknown>).businessDomain).toBeUndefined();
    expect((projection as Record<string, unknown>).typicalCustomers).toBeUndefined();
    expect((projection as Record<string, unknown>).customerPersonas).toBeUndefined();
    expect((projection as Record<string, unknown>).businessGoals).toBeUndefined();
    expect((projection as Record<string, unknown>).optionalFeatures).toBeUndefined();
    expect((projection as Record<string, unknown>).futureEnhancements).toBeUndefined();
    expect((projection as Record<string, unknown>).uiPatterns).toBeUndefined();
    expect((projection as Record<string, unknown>).navigation).toBeUndefined();
    expect((projection as Record<string, unknown>).dashboardSuggestions).toBeUndefined();
    expect((projection as Record<string, unknown>).deploymentConsiderations).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      testingScenarios: [{ scenario: 'Checkout with valid card', expectedOutcome: 'Order confirmed' }],
    };
    const projection = projectBlueprintForQa(sparse);

    expect(projection?.testingScenarios).toEqual(sparse.testingScenarios);
    expect(projection?.functionalModules).toBeUndefined();
    expect(Object.keys(projection ?? {})).toEqual(['testingScenarios']);
  });
});

describe('hasQaBlueprintContent', () => {
  it('is false for undefined and for an empty projection', () => {
    expect(hasQaBlueprintContent(undefined)).toBe(false);
    expect(hasQaBlueprintContent(projectBlueprintForQa({ schemaVersion: 1 }))).toBe(false);
  });

  it('is true once at least one section is populated', () => {
    expect(hasQaBlueprintContent(projectBlueprintForQa(FULL_CONTENT))).toBe(true);
  });
});

describe('describeSuppliedSections', () => {
  it('lists exactly the populated section keys, for traceability', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      security: [{ concern: 'XSS', mitigation: 'Sanitize input' }],
      testingScenarios: [{ scenario: 'Checkout with valid card', expectedOutcome: 'Order confirmed' }],
    };

    expect(describeSuppliedSections(projectBlueprintForQa(sparse))).toEqual(['security', 'testingScenarios']);
  });

  it('is empty for undefined', () => {
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });
});

describe('formatQaBlueprintGuidanceSection', () => {
  it('always states the advisory-only, MVP-boundary-respecting instruction', () => {
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', undefined);
    expect(text).toContain('NOT a scope change');
    expect(text).toContain('Engineering Handoff');
    expect(text).toContain('future-risk note');
  });

  it('falls back safely when the Blueprint has no structured content', () => {
    const text = formatQaBlueprintGuidanceSection('Shopify App', 'recommendation', undefined);
    expect(text).toContain('No structured Blueprint knowledge is available');
  });

  it('labels a manual override distinctly from an accepted recommendation', () => {
    const recommended = formatQaBlueprintGuidanceSection('Business Website', 'recommendation', undefined);
    const overridden = formatQaBlueprintGuidanceSection('LocalShop India', 'manual_override', undefined);

    expect(recommended).toContain('the recommended match');
    expect(overridden).toContain('manually selected by the user');
  });

  it('includes functional modules', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('functional test coverage');
    expect(text).toContain('Catalog');
  });

  it('includes core business processes', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('end-to-end/system test coverage');
    expect(text).toContain('Checkout');
  });

  it('includes business rules', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Business rules to validate');
    expect(text).toContain('No overselling');
  });

  it('includes user roles', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('role and permission testing');
    expect(text).toContain('Customer');
  });

  it('includes integrations', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('external systems to test');
    expect(text).toContain('Razorpay');
  });

  it('includes notifications', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('notification testing');
    expect(text).toContain('Order placed');
  });

  it('includes reports', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Typical reports');
    expect(text).toContain('Sales Report');
  });

  it('includes compliance', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Compliance considerations to validate');
    expect(text).toContain('GST invoicing');
  });

  it('includes security', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Security expectations to validate');
    expect(text).toContain('Payment fraud');
  });

  it('includes performance expectations', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Performance expectations to validate');
    expect(text).toContain('API latency');
  });

  it('includes testing scenarios', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Industry-typical testing scenarios');
    expect(text).toContain('Checkout with valid card');
  });

  it('surfaces data entities at a high level only, without keyFields/relationships', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const text = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('data-related validation');
    expect(text).toContain('Product');
    expect(text).not.toContain('sku');
    expect(text).not.toContain('Relates to');
  });

  it('never mutates the source content', () => {
    const contentCopy = JSON.parse(JSON.stringify(FULL_CONTENT));
    const projection = projectBlueprintForQa(FULL_CONTENT);
    formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(FULL_CONTENT).toEqual(contentCopy);
  });

  it('is deterministic for the same input', () => {
    const projection = projectBlueprintForQa(FULL_CONTENT);
    const first = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);
    const second = formatQaBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(first).toEqual(second);
  });
});
