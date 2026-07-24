import { describe, expect, it } from 'vitest';
import {
  confidenceMeta,
  isCustomSelection,
  selectionStatusMeta,
  topAlternates,
} from './blueprintRecommendationDisplay';

function makeResolution(overrides: Record<string, unknown> = {}) {
  return {
    recommendedBlueprintId: 'business-website',
    selectedBlueprintId: 'business-website',
    candidates: [
      { blueprintId: 'business-website', blueprintName: 'Business Website', confidence: 90, reasons: [] },
      { blueprintId: 'localshop-india', blueprintName: 'LocalShop India', confidence: 40, reasons: [] },
      { blueprintId: 'ai-agent', blueprintName: 'AI Agent', confidence: 20, reasons: [] },
      { blueprintId: 'mobile-app', blueprintName: 'Mobile App', confidence: 10, reasons: [] },
      { blueprintId: 'saas-starter', blueprintName: 'SaaS Starter', confidence: 5, reasons: [] },
    ],
    ...overrides,
  };
}

describe('confidenceMeta', () => {
  it('labels 70+ as high (green)', () => {
    expect(confidenceMeta(96).badgeClass).toContain('green');
  });

  it('labels 40-69 as medium (amber)', () => {
    expect(confidenceMeta(42).badgeClass).toContain('amber');
  });

  it('labels below 40 as low (neutral)', () => {
    const meta = confidenceMeta(10);
    expect(meta.badgeClass).not.toContain('green');
    expect(meta.badgeClass).not.toContain('amber');
  });

  it('always includes the raw percentage in the label', () => {
    expect(confidenceMeta(74).label).toBe('74% confidence');
  });
});

describe('isCustomSelection / selectionStatusMeta', () => {
  it('is false when selected equals recommended', () => {
    const resolution = makeResolution();
    expect(isCustomSelection(resolution)).toBe(false);
    expect(selectionStatusMeta(resolution).label).toBe('Following Recommendation');
  });

  it('is true once the user overrides the selection', () => {
    const resolution = makeResolution({ selectedBlueprintId: 'localshop-india' });
    expect(isCustomSelection(resolution)).toBe(true);
    expect(selectionStatusMeta(resolution).label).toBe('Custom Selection');
  });
});

describe('topAlternates', () => {
  it('excludes the recommended blueprint and caps at 3, most confident first', () => {
    const resolution = makeResolution();
    const alternates = topAlternates(resolution);

    expect(alternates.map((c) => c.blueprintId)).toEqual(['localshop-india', 'ai-agent', 'mobile-app']);
    expect(alternates.some((c) => c.blueprintId === 'business-website')).toBe(false);
  });

  it('returns an empty list when there is only the recommended candidate', () => {
    const resolution = makeResolution({
      candidates: [{ blueprintId: 'business-website', blueprintName: 'Business Website', confidence: 90, reasons: [] }],
    });

    expect(topAlternates(resolution)).toEqual([]);
  });
});
