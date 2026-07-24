import { describe, expect, it } from 'vitest';
import { exportBlueprint, exportBlueprints, importBlueprint, importBlueprints } from './blueprintPortability';
import { blueprintEngine } from './engine';

describe('exportBlueprint / importBlueprint round trip', () => {
  it('round-trips a content-rich blueprint losslessly', () => {
    const original = blueprintEngine.getBlueprint('business-website');
    expect(original).toBeTruthy();

    const json = exportBlueprint(original!);
    const result = importBlueprint(json);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.blueprint).toEqual(original);
      expect(result.contentValidation.valid).toBe(true);
    }
  });

  it('round-trips a blueprint with no content and reports it as invalid content, without failing the import', () => {
    const original = blueprintEngine.getBlueprint('blank-project');
    expect(original).toBeTruthy();

    const result = importBlueprint(exportBlueprint(original!));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.blueprint.id).toBe('blank-project');
      expect(result.contentValidation.valid).toBe(false);
    }
  });

  it('rejects malformed JSON', () => {
    const result = importBlueprint('{not json');
    expect(result.ok).toBe(false);
  });

  it('rejects an envelope missing the blueprint field', () => {
    const result = importBlueprint(JSON.stringify({ exportFormatVersion: 1 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a blueprint missing required identity fields', () => {
    const result = importBlueprint(JSON.stringify({ exportFormatVersion: 1, blueprint: { id: 'x' } }));
    expect(result.ok).toBe(false);
  });

  it('rejects an export format version newer than this build supports', () => {
    const original = blueprintEngine.getBlueprint('ai-agent');
    const result = importBlueprint(JSON.stringify({ exportFormatVersion: 999, blueprint: original }));
    expect(result.ok).toBe(false);
  });
});

describe('exportBlueprints / importBlueprints (bulk)', () => {
  it('round-trips every blueprint in the catalog', () => {
    const all = blueprintEngine.getAllBlueprints();
    const json = exportBlueprints(all);
    const { results, error } = importBlueprints(json);

    expect(error).toBeUndefined();
    expect(results).toHaveLength(all.length);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('rejects a non-array top-level JSON value', () => {
    const { error, results } = importBlueprints(JSON.stringify({ not: 'an array' }));
    expect(error).toBeTruthy();
    expect(results).toEqual([]);
  });

  it('one malformed entry does not fail the rest of the batch', () => {
    const good = blueprintEngine.getBlueprint('localshop-india');
    const json = JSON.stringify([
      { exportFormatVersion: 1, blueprint: good },
      { exportFormatVersion: 1, blueprint: { missing: 'fields' } },
    ]);

    const { results } = importBlueprints(json);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
  });
});
