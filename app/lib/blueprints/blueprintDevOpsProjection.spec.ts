import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveBlueprintSelection,
  projectBlueprintForDevOps,
  hasDevOpsBlueprintContent,
  describeSuppliedSections,
  formatDevOpsBlueprintGuidanceSection,
} from './blueprintDevOpsProjection';
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
  userRoles: [{ name: 'Admin', description: 'Manages the store', permissions: [] }],
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
  notifications: [{ name: 'Order failed', trigger: 'Payment error', channel: 'PagerDuty' }],
  security: [{ concern: 'Payment fraud', mitigation: 'Use a PCI-compliant gateway' }],
  performanceExpectations: [{ metric: 'API latency', target: '<200ms' }],
  testingScenarios: [{ scenario: 'Checkout with valid card', expectedOutcome: 'Order confirmed' }],
  deploymentConsiderations: [{ consideration: 'Autoscaling', detail: 'Scale on CPU > 70%' }],
  futureEnhancements: [{ idea: 'Loyalty tiers', description: 'Reward repeat customers' }],
};

describe('projectBlueprintForDevOps', () => {
  it('returns undefined for a Blueprint with no structured content', () => {
    expect(projectBlueprintForDevOps(undefined)).toBeUndefined();
  });

  it('includes only the 9 operationally-relevant sections, excluding UI/database/planning/BA-only ones', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);

    expect(projection?.integrations).toEqual(FULL_CONTENT.integrations);
    expect(projection?.security).toEqual(FULL_CONTENT.security);
    expect(projection?.compliance).toEqual(FULL_CONTENT.compliance);
    expect(projection?.performanceExpectations).toEqual(FULL_CONTENT.performanceExpectations);
    expect(projection?.deploymentConsiderations).toEqual(FULL_CONTENT.deploymentConsiderations);
    expect(projection?.notifications).toEqual(FULL_CONTENT.notifications);
    expect(projection?.functionalModules).toEqual(FULL_CONTENT.functionalModules);
    expect(projection?.userRoles).toEqual(FULL_CONTENT.userRoles);
    expect(projection?.businessRules).toEqual(FULL_CONTENT.businessRules);

    // UI/database/planning-only/BA-only/QA-only sections must never appear
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
    expect((projection as Record<string, unknown>).uiPatterns).toBeUndefined();
    expect((projection as Record<string, unknown>).navigation).toBeUndefined();
    expect((projection as Record<string, unknown>).dashboardSuggestions).toBeUndefined();
    expect((projection as Record<string, unknown>).reports).toBeUndefined();
    expect((projection as Record<string, unknown>).testingScenarios).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      deploymentConsiderations: [{ consideration: 'Autoscaling', detail: 'Scale on CPU > 70%' }],
    };
    const projection = projectBlueprintForDevOps(sparse);

    expect(projection?.deploymentConsiderations).toEqual(sparse.deploymentConsiderations);
    expect(projection?.integrations).toBeUndefined();
    expect(Object.keys(projection ?? {})).toEqual(['deploymentConsiderations']);
  });
});

describe('hasDevOpsBlueprintContent', () => {
  it('is false for undefined and for an empty projection', () => {
    expect(hasDevOpsBlueprintContent(undefined)).toBe(false);
    expect(hasDevOpsBlueprintContent(projectBlueprintForDevOps({ schemaVersion: 1 }))).toBe(false);
  });

  it('is true once at least one section is populated', () => {
    expect(hasDevOpsBlueprintContent(projectBlueprintForDevOps(FULL_CONTENT))).toBe(true);
  });
});

describe('describeSuppliedSections', () => {
  it('lists exactly the populated section keys, for traceability', () => {
    const sparse: BlueprintContent = {
      schemaVersion: 1,
      security: [{ concern: 'XSS', mitigation: 'Sanitize input' }],
      userRoles: [{ name: 'Admin', description: 'Manages the store', permissions: [] }],
    };

    expect(describeSuppliedSections(projectBlueprintForDevOps(sparse))).toEqual(['security', 'userRoles']);
  });

  it('is empty for undefined', () => {
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });
});

describe('formatDevOpsBlueprintGuidanceSection', () => {
  it('always states the advisory-only, MVP-boundary-respecting instruction', () => {
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', undefined);
    expect(text).toContain('NOT a scope change');
    expect(text).toContain('Engineering Handoff');
    expect(text).toContain('simplest production-appropriate deployment');
  });

  it('falls back safely when the Blueprint has no structured content', () => {
    const text = formatDevOpsBlueprintGuidanceSection('Shopify App', 'recommendation', undefined);
    expect(text).toContain('No structured Blueprint knowledge is available');
  });

  it('labels a manual override distinctly from an accepted recommendation', () => {
    const recommended = formatDevOpsBlueprintGuidanceSection('Business Website', 'recommendation', undefined);
    const overridden = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'manual_override', undefined);

    expect(recommended).toContain('the recommended match');
    expect(overridden).toContain('manually selected by the user');
  });

  it('includes integrations', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('external systems to operate');
    expect(text).toContain('Razorpay');
  });

  it('includes security', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('security hardening');
    expect(text).toContain('Payment fraud');
  });

  it('includes compliance', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('compliance-aware operations');
    expect(text).toContain('GST invoicing');
  });

  it('includes performance expectations', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('scaling and availability planning');
    expect(text).toContain('API latency');
  });

  it('includes deployment considerations', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('backup/recovery where represented');
    expect(text).toContain('Autoscaling');
  });

  it('includes operationally relevant functional modules', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('deployment boundaries');
    expect(text).toContain('Catalog');
  });

  it('includes notifications relevant to operational alerting', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('operational alerting design');
    expect(text).toContain('Order failed');
  });

  it('includes user roles relevant to access and administrative operations', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('access control and administrative operations');
    expect(text).toContain('Admin');
  });

  it('includes business rules affecting operational reliability', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const text = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(text).toContain('operational-reliability implications');
    expect(text).toContain('No overselling');
  });

  it('never mutates the source content', () => {
    const contentCopy = JSON.parse(JSON.stringify(FULL_CONTENT));
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(FULL_CONTENT).toEqual(contentCopy);
  });

  it('is deterministic for the same input', () => {
    const projection = projectBlueprintForDevOps(FULL_CONTENT);
    const first = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);
    const second = formatDevOpsBlueprintGuidanceSection('LocalShop India', 'recommendation', projection);

    expect(first).toEqual(second);
  });
});
