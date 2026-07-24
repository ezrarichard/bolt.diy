import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveBlueprintSelection,
  projectBlueprintForFrontend,
  hasFrontendBlueprintContent,
  describeSuppliedSections,
  formatFrontendBlueprintGuidanceSection,
} from './blueprintFrontendProjection';
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
  security: [{ concern: 'XSS', mitigation: 'Sanitize and escape all user input' }],
  performanceExpectations: [{ metric: 'Time to Interactive', target: '<2s' }],
  testingScenarios: [{ scenario: 'Checkout with valid card', expectedOutcome: 'Order confirmed' }],
  deploymentConsiderations: [{ consideration: 'Autoscaling', detail: 'Scale on CPU > 70%' }],
  futureEnhancements: [{ idea: 'Loyalty tiers', description: 'Reward repeat customers' }],
};

describe('projectBlueprintForFrontend', () => {
  it('returns undefined for a Blueprint with no structured content', () => {
    expect(projectBlueprintForFrontend(undefined)).toBeUndefined();
  });

  it('includes only the 10 frontend-relevant sections, excluding data/backend/deployment/planning ones', () => {
    const projection = projectBlueprintForFrontend(FULL_CONTENT);

    expect(projection?.functionalModules).toEqual(FULL_CONTENT.functionalModules);
    expect(projection?.userRoles).toEqual(FULL_CONTENT.userRoles);
    expect(projection?.uiPatterns).toEqual(FULL_CONTENT.uiPatterns);
    expect(projection?.navigation).toEqual(FULL_CONTENT.navigation);
    expect(projection?.notifications).toEqual(FULL_CONTENT.notifications);
    expect(projection?.reports).toEqual(FULL_CONTENT.reports);
    expect(projection?.performanceExpectations).toEqual(FULL_CONTENT.performanceExpectations);
    expect(projection?.security).toEqual(FULL_CONTENT.security);
    expect(projection?.businessRules).toEqual(FULL_CONTENT.businessRules);
    expect(projection?.integrations).toEqual(FULL_CONTENT.integrations);

    // Database/deployment/planning-only/BA-only/compliance/dashboard sections must never appear
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
    expect((projection as Record<string, unknown>).dashboardSuggestions).toBeUndefined();
    expect((projection as Record<string, unknown>).deploymentConsiderations).toBeUndefined();
    expect((projection as Record<string, unknown>).testingScenarios).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      performanceExpectations: [{ metric: 'Time to Interactive', target: '<2s' }],
    };
    const projection = projectBlueprintForFrontend(sparse);

    expect(projection?.performanceExpectations).toEqual(sparse.performanceExpectations);
    expect(projection?.functionalModules).toBeUndefined();
    expect(Object.keys(projection ?? {})).toEqual(['performanceExpectations']);
  });
});

describe('hasFrontendBlueprintContent', () => {
  it('is false for undefined and for an empty projection', () => {
    expect(hasFrontendBlueprintContent(undefined)).toBe(false);
    expect(hasFrontendBlueprintContent(projectBlueprintForFrontend({ schemaVersion: 1 }))).toBe(false);
  });

  it('is true once at least one section is populated', () => {
    expect(hasFrontendBlueprintContent(projectBlueprintForFrontend(FULL_CONTENT))).toBe(true);
  });
});

describe('describeSuppliedSections', () => {
  it('lists exactly the populated section keys, for traceability', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      security: [{ concern: 'XSS', mitigation: 'Sanitize input' }],
      navigation: [{ label: 'Home', description: 'Landing page' }],
    };

    expect(describeSuppliedSections(projectBlueprintForFrontend(sparse))).toEqual(['navigation', 'security']);
  });

  it('is empty for undefined', () => {
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });
});

describe('formatFrontendBlueprintGuidanceSection', () => {
  it('always states the advisory-only, MVP-boundary-respecting instruction', () => {
    const text = formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', undefined);
    expect(text).toContain('NOT a scope change');
    expect(text).toContain('Engineering Handoff');
    expect(text).toContain('UI/UX Design');
    expect(text).toContain('Backend Design');
  });

  it('falls back safely when the Blueprint has no structured content', () => {
    const text = formatFrontendBlueprintGuidanceSection('Shopify App', 'recommendation', undefined);
    expect(text).toContain('No structured Blueprint knowledge is available');
  });

  it('labels a manual override distinctly from an accepted recommendation', () => {
    const recommended = formatFrontendBlueprintGuidanceSection('Business Website', 'recommendation', undefined);
    const overridden = formatFrontendBlueprintGuidanceSection('LocalShop India', 'manual_override', undefined);

    expect(recommended).toContain('the recommended match');
    expect(overridden).toContain('manually selected by the user');
  });

  it('includes UI patterns', () => {
    const projection = projectBlueprintForFrontend(FULL_CONTENT);
    const text = formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Typical UI patterns to implement');
    expect(text).toContain('Sticky cart');
  });

  it('includes navigation', () => {
    const projection = projectBlueprintForFrontend(FULL_CONTENT);
    const text = formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('route structure');
    expect(text).toContain('Home');
  });

  it('includes business rules', () => {
    const projection = projectBlueprintForFrontend(FULL_CONTENT);
    const text = formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('validation/interaction implications');
    expect(text).toContain('No overselling');
  });

  it('includes performance expectations', () => {
    const projection = projectBlueprintForFrontend(FULL_CONTENT);
    const text = formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Performance expectations');
    expect(text).toContain('Time to Interactive');
  });

  it('includes browser-relevant security', () => {
    const projection = projectBlueprintForFrontend(FULL_CONTENT);
    const text = formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Browser-relevant security expectations');
    expect(text).toContain('XSS');
  });

  it('includes approved integration expectations', () => {
    const projection = projectBlueprintForFrontend(FULL_CONTENT);
    const text = formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('Typical integrations');
    expect(text).toContain('Razorpay');
  });

  it('never mutates the source content', () => {
    const contentCopy = JSON.parse(JSON.stringify(FULL_CONTENT));
    const projection = projectBlueprintForFrontend(FULL_CONTENT);
    formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(FULL_CONTENT).toEqual(contentCopy);
  });

  it('is deterministic for the same input', () => {
    const projection = projectBlueprintForFrontend(FULL_CONTENT);
    const first = formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);
    const second = formatFrontendBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(first).toEqual(second);
  });
});
