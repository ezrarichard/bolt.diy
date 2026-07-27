import { describe, expect, it } from 'vitest';
import type { DiscoveredImpact } from './incrementalExecutionTypes';
import {
  decisionAllowsContinuation,
  describeScopeDecision,
  isMaterialDiscovery,
  materialDiscoveries,
  parseDiscoveredImpacts,
  summariseDiscoveries,
} from './discoveredImpact';

const AT = '2026-08-14T10:00:00.000Z';

function valid(overrides: Record<string, unknown> = {}) {
  return {
    description: 'The bookings export job reads the column being renamed.',
    category: 'backend',
    affectedArtifact: 'api/exports.ts',
    reasoning: 'It selects the column by name.',
    severity: 'high',
    recommendedAction: 'expand_scope',
    scopeChangeRequired: true,
    ...overrides,
  };
}

describe('parseDiscoveredImpacts', () => {
  it('returns nothing when the draft has no discoveredImpact array', () => {
    expect(parseDiscoveredImpacts({ summary: 'all good' }, 'backend', AT)).toEqual([]);
    expect(parseDiscoveredImpacts(null, 'backend', AT)).toEqual([]);
    expect(parseDiscoveredImpacts({ discoveredImpact: 'oops' }, 'backend', AT)).toEqual([]);
  });

  it('parses a complete entry and stamps the reporting role', () => {
    const [discovery] = parseDiscoveredImpacts({ discoveredImpact: [valid()] }, 'backend', AT);

    expect(discovery).toMatchObject({
      affectedArtifact: 'api/exports.ts',
      severity: 'high',
      recommendedAction: 'expand_scope',
      scopeChangeRequired: true,
      reportedByRole: 'backend',
      reportedAt: AT,
    });
  });

  it('drops an entry with an unknown category, severity or action rather than defaulting it', () => {
    const raw = {
      discoveredImpact: [
        valid({ category: 'astrology' }),
        valid({ severity: 'catastrophic' }),
        valid({ recommendedAction: 'do_it_anyway' }),
      ],
    };

    // A fabricated default would be acted on by a human — no finding is safer than a wrong one.
    expect(parseDiscoveredImpacts(raw, 'backend', AT)).toEqual([]);
  });

  it('drops an entry with no description or no affected artifact', () => {
    const raw = { discoveredImpact: [valid({ description: '  ' }), valid({ affectedArtifact: '' }), 42, null] };

    expect(parseDiscoveredImpacts(raw, 'backend', AT)).toEqual([]);
  });

  it('treats a missing scopeChangeRequired as false rather than true', () => {
    const [discovery] = parseDiscoveredImpacts(
      { discoveredImpact: [valid({ scopeChangeRequired: undefined })] },
      'backend',
      AT,
    );

    expect(discovery.scopeChangeRequired).toBe(false);
  });

  it('falls back to the description when reasoning is missing', () => {
    const [discovery] = parseDiscoveredImpacts({ discoveredImpact: [valid({ reasoning: '' })] }, 'backend', AT);

    expect(discovery.reasoning).toBe(discovery.description);
  });
});

describe('materiality', () => {
  const base: DiscoveredImpact = {
    description: 'x',
    category: 'ui',
    affectedArtifact: 'pages/Home.tsx',
    reasoning: 'x',
    severity: 'low',
    recommendedAction: 'monitor_only',
    scopeChangeRequired: false,
  };

  it('is not material for a low-severity monitor-only note', () => {
    expect(isMaterialDiscovery(base)).toBe(false);
  });

  it('is material when the role says the scope must change', () => {
    expect(isMaterialDiscovery({ ...base, scopeChangeRequired: true })).toBe(true);
  });

  it('is material when the role asks to expand scope or re-analyse', () => {
    expect(isMaterialDiscovery({ ...base, recommendedAction: 'expand_scope' })).toBe(true);
    expect(isMaterialDiscovery({ ...base, recommendedAction: 'return_to_impact_analysis' })).toBe(true);
  });

  it('is material at high or critical severity regardless of the recommendation', () => {
    expect(isMaterialDiscovery({ ...base, severity: 'high' })).toBe(true);
    expect(isMaterialDiscovery({ ...base, severity: 'critical' })).toBe(true);
    expect(isMaterialDiscovery({ ...base, severity: 'medium' })).toBe(false);
  });

  it('filters and summarises', () => {
    const discoveries = [base, { ...base, severity: 'critical' as const }];

    expect(materialDiscoveries(discoveries)).toHaveLength(1);
    expect(summariseDiscoveries(discoveries)).toContain('1 requiring an operator decision');
    expect(summariseDiscoveries([])).toContain('No impact outside');
  });
});

describe('scope decisions', () => {
  it('only continues on a rejection or an explicit continue', () => {
    expect(decisionAllowsContinuation('continue_without_expansion')).toBe(true);
    expect(decisionAllowsContinuation('reject_expansion')).toBe(true);
    expect(decisionAllowsContinuation('approve_expansion')).toBe(false);
    expect(decisionAllowsContinuation('return_to_impact_analysis')).toBe(false);
  });

  it('says plainly that an approved expansion needs a new plan, not a resume', () => {
    expect(describeScopeDecision('approve_expansion')).toContain('re-plan');
    expect(describeScopeDecision('approve_expansion')).toContain('new execution');
  });
});
