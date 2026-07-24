import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveBlueprintSelection,
  projectBlueprintForBackend,
  hasBackendBlueprintContent,
  describeSuppliedSections,
  formatBackendBlueprintGuidanceSection,
} from './blueprintBackendProjection';
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

describe('projectBlueprintForBackend', () => {
  it('returns undefined for a Blueprint with no structured content', () => {
    expect(projectBlueprintForBackend(undefined)).toBeUndefined();
  });

  it('includes only the 8 service/API-relevant sections, excluding UI/MVP/BA-only/data-modeling ones', () => {
    const projection = projectBlueprintForBackend(FULL_CONTENT);

    expect(projection?.functionalModules).toEqual(FULL_CONTENT.functionalModules);
    expect(projection?.businessRules).toEqual(FULL_CONTENT.businessRules);
    expect(projection?.integrations).toEqual(FULL_CONTENT.integrations);
    expect(projection?.notifications).toEqual(FULL_CONTENT.notifications);
    expect(projection?.userRoles).toEqual(FULL_CONTENT.userRoles);
    expect(projection?.security).toEqual(FULL_CONTENT.security);
    expect(projection?.performanceExpectations).toEqual(FULL_CONTENT.performanceExpectations);
    expect(projection?.deploymentConsiderations).toEqual(FULL_CONTENT.deploymentConsiderations);

    // BA-only / MVP-planning-only / UI-specific / data-modeling sections must never appear
    expect((projection as Record<string, unknown>).executiveSummary).toBeUndefined();
    expect((projection as Record<string, unknown>).businessDomain).toBeUndefined();
    expect((projection as Record<string, unknown>).typicalCustomers).toBeUndefined();
    expect((projection as Record<string, unknown>).customerPersonas).toBeUndefined();
    expect((projection as Record<string, unknown>).businessGoals).toBeUndefined();
    expect((projection as Record<string, unknown>).coreBusinessProcesses).toBeUndefined();
    expect((projection as Record<string, unknown>).standardFeatures).toBeUndefined();
    expect((projection as Record<string, unknown>).optionalFeatures).toBeUndefined();
    expect((projection as Record<string, unknown>).futureEnhancements).toBeUndefined();
    expect((projection as Record<string, unknown>).dataEntities).toBeUndefined();
    expect((projection as Record<string, unknown>).compliance).toBeUndefined();
    expect((projection as Record<string, unknown>).uiPatterns).toBeUndefined();
    expect((projection as Record<string, unknown>).navigation).toBeUndefined();
    expect((projection as Record<string, unknown>).dashboardSuggestions).toBeUndefined();
    expect((projection as Record<string, unknown>).reports).toBeUndefined();
    expect((projection as Record<string, unknown>).testingScenarios).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      notifications: [{ name: 'Order placed', trigger: 'Checkout', channel: 'WhatsApp' }],
    };
    const projection = projectBlueprintForBackend(sparse);

    expect(projection?.notifications).toEqual(sparse.notifications);
    expect(projection?.functionalModules).toBeUndefined();
    expect(Object.keys(projection ?? {})).toEqual(['notifications']);
  });
});

describe('hasBackendBlueprintContent', () => {
  it('is false for undefined and for an empty projection', () => {
    expect(hasBackendBlueprintContent(undefined)).toBe(false);
    expect(hasBackendBlueprintContent(projectBlueprintForBackend({ schemaVersion: 1 }))).toBe(false);
  });

  it('is true once at least one section is populated', () => {
    expect(hasBackendBlueprintContent(projectBlueprintForBackend(FULL_CONTENT))).toBe(true);
  });
});

describe('describeSuppliedSections', () => {
  it('lists exactly the populated section keys, for traceability', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      security: [{ concern: 'XSS', mitigation: 'Sanitize input' }],
      deploymentConsiderations: [{ consideration: 'Autoscaling', detail: 'Scale on CPU > 70%' }],
    };

    expect(describeSuppliedSections(projectBlueprintForBackend(sparse))).toEqual([
      'security',
      'deploymentConsiderations',
    ]);
  });

  it('is empty for undefined', () => {
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });
});

describe('formatBackendBlueprintGuidanceSection', () => {
  it('always states the advisory-only, MVP-boundary-respecting instruction', () => {
    const text = formatBackendBlueprintGuidanceSection('LocalShop India', 'recommendation', undefined);
    expect(text).toContain('NOT a scope change');
    expect(text).toContain('Engineering Handoff');
    expect(text).toContain('Database Design');
  });

  it('falls back safely when the Blueprint has no structured content', () => {
    const text = formatBackendBlueprintGuidanceSection('Shopify App', 'recommendation', undefined);
    expect(text).toContain('No structured Blueprint knowledge is available');
  });

  it('labels a manual override distinctly from an accepted recommendation', () => {
    const recommended = formatBackendBlueprintGuidanceSection('Business Website', 'recommendation', undefined);
    const overridden = formatBackendBlueprintGuidanceSection('LocalShop India', 'manual_override', undefined);

    expect(recommended).toContain('the recommended match');
    expect(overridden).toContain('manually selected by the user');
  });

  it('improves API/service boundary planning via functional modules', () => {
    const projection = projectBlueprintForBackend(FULL_CONTENT);
    const text = formatBackendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('service/API boundaries');
    expect(text).toContain('Catalog');
  });

  it('informs authentication planning via user roles', () => {
    const projection = projectBlueprintForBackend(FULL_CONTENT);
    const text = formatBackendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('authentication/authorization design');
    expect(text).toContain('Customer');
  });

  it('improves integration planning', () => {
    const projection = projectBlueprintForBackend(FULL_CONTENT);
    const text = formatBackendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Typical integrations / external systems');
    expect(text).toContain('Razorpay');
  });

  it('includes security expectations that inform error handling / security design', () => {
    const projection = projectBlueprintForBackend(FULL_CONTENT);
    const text = formatBackendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Security expectations');
    expect(text).toContain('Payment fraud');
  });
});
