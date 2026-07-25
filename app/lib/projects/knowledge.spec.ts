import { describe, expect, it } from 'vitest';
import { isRequirementsCaptured, PRIMARY_MARKET_OPTIONS, type ProjectKnowledge } from './knowledge';

describe('Sprint 72 — ProjectKnowledge.primaryMarketCode (structured discovery market)', () => {
  it('accepts every supported market code', () => {
    for (const code of ['IN', 'AE', 'GB', 'US']) {
      const knowledge: ProjectKnowledge = { primaryMarketCode: code };
      expect(knowledge.primaryMarketCode).toBe(code);
    }
  });

  it('accepts the explicitly-unsupported OTHER state', () => {
    const knowledge: ProjectKnowledge = { primaryMarketCode: 'OTHER' };
    expect(knowledge.primaryMarketCode).toBe('OTHER');
  });

  it('accepts "not specified" as undefined', () => {
    const knowledge: ProjectKnowledge = {};
    expect(knowledge.primaryMarketCode).toBeUndefined();
  });

  it('existing ProjectKnowledge objects without the field remain valid', () => {
    const legacy: ProjectKnowledge = { projectVision: 'A local services marketplace', location: 'India' };
    expect(legacy.primaryMarketCode).toBeUndefined();
    expect(legacy.location).toBe('India');
  });

  it('is a field fully separate from the free-text location field', () => {
    const knowledge: ProjectKnowledge = { location: 'India, Tamil Nadu, Global', primaryMarketCode: 'AE' };

    expect(knowledge.location).toBe('India, Tamil Nadu, Global');
    expect(knowledge.primaryMarketCode).toBe('AE');
  });

  it('serialization is deterministic (plain JSON round-trip preserves the value)', () => {
    const knowledge: ProjectKnowledge = { primaryMarketCode: 'GB' };
    const roundTripped = JSON.parse(JSON.stringify(knowledge)) as ProjectKnowledge;

    expect(roundTripped.primaryMarketCode).toBe('GB');
  });

  it('PRIMARY_MARKET_OPTIONS exposes exactly the not-specified/4-country/other option set', () => {
    expect(PRIMARY_MARKET_OPTIONS.map((option) => option.value)).toEqual(['', 'IN', 'AE', 'GB', 'US', 'OTHER']);
  });
});

describe('Sprint 72 — isRequirementsCaptured includes primaryMarketCode', () => {
  it('counts a captured primary market as meaningful requirements', () => {
    expect(isRequirementsCaptured({ primaryMarketCode: 'IN' })).toBe(true);
  });

  it('does not mutate the source object it reads', () => {
    const knowledge: ProjectKnowledge = { primaryMarketCode: 'US' };
    const snapshot = { ...knowledge };

    isRequirementsCaptured(knowledge);

    expect(knowledge).toEqual(snapshot);
  });

  it('still returns false for an entirely empty knowledge object', () => {
    expect(isRequirementsCaptured({})).toBe(false);
  });
});
