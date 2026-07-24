import { describe, expect, it } from 'vitest';
import {
  REQUIRED_BLUEPRINT_CONTENT_SECTIONS,
  isSupportedBlueprintContentSchemaVersion,
  validateBlueprintContent,
} from './blueprintContentValidation';
import { BLUEPRINT_CONTENT_SCHEMA_VERSION } from './blueprintContentTypes';
import { blueprintEngine } from './engine';

describe('isSupportedBlueprintContentSchemaVersion', () => {
  it('accepts the current schema version', () => {
    expect(isSupportedBlueprintContentSchemaVersion(BLUEPRINT_CONTENT_SCHEMA_VERSION)).toBe(true);
  });

  it('rejects an unknown future version', () => {
    expect(isSupportedBlueprintContentSchemaVersion(999)).toBe(false);
  });
});

describe('validateBlueprintContent', () => {
  it('reports invalid with no errors softened when content is undefined', () => {
    const result = validateBlueprintContent(undefined);
    expect(result.valid).toBe(false);
    expect(result.completeness).toBe(0);
    expect(result.missingRequiredSections).toEqual(REQUIRED_BLUEPRINT_CONTENT_SECTIONS);
  });

  it('rejects an unsupported schema version', () => {
    const result = validateBlueprintContent({ schemaVersion: 999 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not supported'))).toBe(true);
  });

  it('flags every missing required section by name', () => {
    const result = validateBlueprintContent({ schemaVersion: BLUEPRINT_CONTENT_SCHEMA_VERSION });
    expect(result.valid).toBe(false);
    expect(result.missingRequiredSections).toEqual(REQUIRED_BLUEPRINT_CONTENT_SECTIONS);
  });

  it('rejects a required array section containing a non-object item', () => {
    const result = validateBlueprintContent({
      schemaVersion: BLUEPRINT_CONTENT_SCHEMA_VERSION,
      executiveSummary: { summary: 'x', valueProposition: 'y' },
      businessDomain: { industry: 'x', category: 'y', description: 'z' },
      typicalCustomers: ['a'],
      businessGoals: ['not-an-object' as unknown as never],
      functionalModules: [{ name: 'a', description: 'b', features: [] }],
      standardFeatures: [{ name: 'a', description: 'b' }],
      userRoles: [{ name: 'a', description: 'b', permissions: [] }],
      dataEntities: [{ name: 'a', description: 'b', keyFields: [], relationships: [] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('businessGoals[0]'))).toBe(true);
  });

  it('validates successfully once every required section is populated', () => {
    const result = validateBlueprintContent({
      schemaVersion: BLUEPRINT_CONTENT_SCHEMA_VERSION,
      executiveSummary: { summary: 'x', valueProposition: 'y' },
      businessDomain: { industry: 'x', category: 'y', description: 'z' },
      typicalCustomers: ['a'],
      businessGoals: [{ goal: 'a', description: 'b', priority: 'high' }],
      functionalModules: [{ name: 'a', description: 'b', features: [] }],
      standardFeatures: [{ name: 'a', description: 'b' }],
      userRoles: [{ name: 'a', description: 'b', permissions: [] }],
      dataEntities: [{ name: 'a', description: 'b', keyFields: [], relationships: [] }],
    });
    expect(result.valid).toBe(true);
    expect(result.missingRequiredSections).toEqual([]);
    expect(result.completeness).toBeGreaterThan(0);
    expect(result.completeness).toBeLessThan(100);
  });

  it('the three Sprint 60 reference blueprints validate successfully with high completeness', () => {
    for (const slug of ['business-website', 'localshop-india', 'ai-agent']) {
      const blueprint = blueprintEngine.getBlueprint(slug);
      expect(blueprint, `${slug} should exist`).toBeTruthy();

      const result = validateBlueprintContent(blueprint?.content);
      expect(result.valid, `${slug}: ${result.errors.join('; ')}`).toBe(true);
      expect(result.completeness, `${slug} completeness`).toBeGreaterThanOrEqual(90);
    }
  });

  it('every other blueprint has no content yet (unaffected by this sprint)', () => {
    const untouchedSlugs = [
      'blank-project',
      'shopify-app',
      'saas-starter',
      'mobile-app',
      'marketing-website',
      'nextjs-saas',
    ];

    for (const slug of untouchedSlugs) {
      const blueprint = blueprintEngine.getBlueprint(slug);
      expect(blueprint?.content, `${slug} should have no content`).toBeUndefined();
    }
  });
});
