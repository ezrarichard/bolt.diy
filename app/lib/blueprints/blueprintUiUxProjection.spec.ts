import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveBlueprintSelection,
  projectBlueprintForUiUx,
  hasUiUxBlueprintContent,
  describeSuppliedSections,
  formatUiUxBlueprintGuidanceSection,
} from './blueprintUiUxProjection';
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

describe('projectBlueprintForUiUx', () => {
  it('returns undefined for a Blueprint with no structured content', () => {
    expect(projectBlueprintForUiUx(undefined)).toBeUndefined();
  });

  it('includes only the 12 UI/UX-relevant sections, excluding data/backend/deployment/testing ones', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);

    expect(projection?.userRoles).toEqual(FULL_CONTENT.userRoles);
    expect(projection?.functionalModules).toEqual(FULL_CONTENT.functionalModules);
    expect(projection?.coreBusinessProcesses).toEqual(FULL_CONTENT.coreBusinessProcesses);
    expect(projection?.standardFeatures).toEqual(FULL_CONTENT.standardFeatures);
    expect(projection?.uiPatterns).toEqual(FULL_CONTENT.uiPatterns);
    expect(projection?.navigation).toEqual(FULL_CONTENT.navigation);
    expect(projection?.dashboardSuggestions).toEqual(FULL_CONTENT.dashboardSuggestions);
    expect(projection?.reports).toEqual(FULL_CONTENT.reports);
    expect(projection?.notifications).toEqual(FULL_CONTENT.notifications);
    expect(projection?.businessRules).toEqual(FULL_CONTENT.businessRules);
    expect(projection?.compliance).toEqual(FULL_CONTENT.compliance);
    expect(projection?.businessDomain).toEqual(FULL_CONTENT.businessDomain);

    // Database/backend/deployment/testing/BA-only-beyond-domain sections must never appear
    expect((projection as Record<string, unknown>).executiveSummary).toBeUndefined();
    expect((projection as Record<string, unknown>).typicalCustomers).toBeUndefined();
    expect((projection as Record<string, unknown>).customerPersonas).toBeUndefined();
    expect((projection as Record<string, unknown>).businessGoals).toBeUndefined();
    expect((projection as Record<string, unknown>).optionalFeatures).toBeUndefined();
    expect((projection as Record<string, unknown>).futureEnhancements).toBeUndefined();
    expect((projection as Record<string, unknown>).dataEntities).toBeUndefined();
    expect((projection as Record<string, unknown>).integrations).toBeUndefined();
    expect((projection as Record<string, unknown>).security).toBeUndefined();
    expect((projection as Record<string, unknown>).performanceExpectations).toBeUndefined();
    expect((projection as Record<string, unknown>).deploymentConsiderations).toBeUndefined();
    expect((projection as Record<string, unknown>).testingScenarios).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      navigation: [{ label: 'Home', description: 'Landing page' }],
    };
    const projection = projectBlueprintForUiUx(sparse);

    expect(projection?.navigation).toEqual(sparse.navigation);
    expect(projection?.userRoles).toBeUndefined();
    expect(Object.keys(projection ?? {})).toEqual(['navigation']);
  });
});

describe('hasUiUxBlueprintContent', () => {
  it('is false for undefined and for an empty projection', () => {
    expect(hasUiUxBlueprintContent(undefined)).toBe(false);
    expect(hasUiUxBlueprintContent(projectBlueprintForUiUx({ schemaVersion: 1 }))).toBe(false);
  });

  it('is true once at least one section is populated', () => {
    expect(hasUiUxBlueprintContent(projectBlueprintForUiUx(FULL_CONTENT))).toBe(true);
  });
});

describe('describeSuppliedSections', () => {
  it('lists exactly the populated section keys, for traceability', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      uiPatterns: [{ name: 'Sticky cart', description: 'Always visible' }],
      dashboardSuggestions: [{ name: 'Sales', description: 'Revenue overview', metrics: [] }],
    };

    expect(describeSuppliedSections(projectBlueprintForUiUx(sparse))).toEqual(['uiPatterns', 'dashboardSuggestions']);
  });

  it('is empty for undefined', () => {
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });
});

describe('formatUiUxBlueprintGuidanceSection', () => {
  it('always states the advisory-only, MVP-boundary-respecting instruction', () => {
    const text = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', undefined);
    expect(text).toContain('NOT a scope change');
    expect(text).toContain('Engineering Handoff');
    expect(text).toContain('Database Design');
  });

  it('falls back safely when the Blueprint has no structured content', () => {
    const text = formatUiUxBlueprintGuidanceSection('Shopify App', 'recommendation', undefined);
    expect(text).toContain('No structured Blueprint knowledge is available');
  });

  it('labels a manual override distinctly from an accepted recommendation', () => {
    const recommended = formatUiUxBlueprintGuidanceSection('Business Website', 'recommendation', undefined);
    const overridden = formatUiUxBlueprintGuidanceSection('LocalShop India', 'manual_override', undefined);

    expect(recommended).toContain('the recommended match');
    expect(overridden).toContain('manually selected by the user');
  });

  it('includes UI patterns', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    const text = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Typical UI patterns');
    expect(text).toContain('Sticky cart');
  });

  it('includes navigation', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    const text = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Typical navigation structure');
    expect(text).toContain('Home');
  });

  it('includes user roles', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    const text = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('role-specific experiences');
    expect(text).toContain('Customer');
  });

  it('includes notifications', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    const text = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Typical notifications');
    expect(text).toContain('Order placed');
  });

  it('includes reports when present', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    const text = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Typical reports');
    expect(text).toContain('Sales Report');
  });

  it('includes business rules affecting journeys', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    const text = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('user-flow implications');
    expect(text).toContain('No overselling');
  });

  it('includes compliance-related UX considerations', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    const text = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Compliance considerations');
    expect(text).toContain('GST invoicing');
  });

  it('includes industry terminology via business domain', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    const text = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Industry context');
    expect(text).toContain('Retail');
  });

  it('never mutates the source content', () => {
    const contentCopy = JSON.parse(JSON.stringify(FULL_CONTENT));
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(FULL_CONTENT).toEqual(contentCopy);
  });

  it('is deterministic for the same input', () => {
    const projection = projectBlueprintForUiUx(FULL_CONTENT);
    const first = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);
    const second = formatUiUxBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(first).toEqual(second);
  });
});
