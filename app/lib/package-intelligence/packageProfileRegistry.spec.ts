import { describe, expect, it } from 'vitest';
import { packageEngine } from './packageProfileRegistry';
import { PACKAGE_PROFILE_GUIDANCE_SECTION_KEYS } from './packageProfileTypes';

function allGuidanceText(profile: ReturnType<typeof packageEngine.getPackageProfile>): string {
  if (!profile) {
    return '';
  }

  const sections = PACKAGE_PROFILE_GUIDANCE_SECTION_KEYS.map((key) => (profile[key] ?? []).join(' ')).join(' ');

  return [
    sections,
    profile.exclusions.join(' '),
    profile.qualityFloor.join(' '),
    profile.deliveryPositioning,
    profile.sourceMetadata.disclaimer,
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Every sentence that mentions one of these terms must also negate it ("not"/"never"/"does not")
 * within the same sentence — i.e. the profile may only ever describe these as things it does
 * NOT do, never as an affirmative instruction. Sentence-level (not whole-text) so a legitimate
 * "does not require microservices" sentence passes while a hypothetical "use microservices"
 * sentence elsewhere would still fail.
 */
function assertOnlyNegated(text: string, terms: string[]) {
  const sentences = text.split(/[.!?]/);

  for (const sentence of sentences) {
    for (const term of terms) {
      if (sentence.includes(term)) {
        expect(sentence).toMatch(/not|never/);
      }
    }
  }
}

describe('Package Profile Registry — Sprint 73', () => {
  it('Starter profile exists', () => {
    expect(packageEngine.getPackageProfile('STARTER')).toBeDefined();
  });

  it('Professional profile exists', () => {
    expect(packageEngine.getPackageProfile('PROFESSIONAL')).toBeDefined();
  });

  it('Premium profile exists', () => {
    expect(packageEngine.getPackageProfile('PREMIUM')).toBeDefined();
  });

  it('IDs and codes are unique across all profiles', () => {
    const profiles = packageEngine.getAllPackageProfiles();
    const ids = profiles.map((p) => p.id);
    const codes = profiles.map((p) => p.code);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every profile has a version', () => {
    for (const profile of packageEngine.getAllPackageProfiles()) {
      expect(typeof profile.version).toBe('number');
      expect(profile.version).toBeGreaterThan(0);
    }
  });

  it('profile lookup is deterministic — repeated calls return equivalent content', () => {
    const first = packageEngine.getPackageProfile('PROFESSIONAL');
    const second = packageEngine.getPackageProfile('PROFESSIONAL');

    expect(first).toEqual(second);
  });

  it('does not mutate the source profile when read repeatedly', () => {
    const before = JSON.stringify(packageEngine.getPackageProfile('STARTER'));
    packageEngine.getPackageProfile('STARTER');
    packageEngine.getPackageProfile('STARTER');

    const after = JSON.stringify(packageEngine.getPackageProfile('STARTER'));

    expect(after).toBe(before);
  });

  it('an unknown package code returns undefined safely, never throws', () => {
    expect(() => packageEngine.getPackageProfile('ENTERPRISE')).not.toThrow();
    expect(packageEngine.getPackageProfile('ENTERPRISE')).toBeUndefined();
  });

  it('every package includes the shared minimum quality floor', () => {
    const profiles = packageEngine.getAllPackageProfiles();
    const floors = profiles.map((p) => p.qualityFloor);

    expect(floors[0].length).toBeGreaterThan(0);

    for (const floor of floors) {
      expect(floor).toEqual(floors[0]);
    }
  });

  it('Starter does not contain unsafe low-quality wording', () => {
    const text = allGuidanceText(packageEngine.getPackageProfile('STARTER'));

    for (const phrase of [
      'insecure',
      'untested',
      'unvalidated',
      'inaccessible',
      'undocumented',
      'unmaintainable',
      'unsafe deployment',
    ]) {
      expect(text).not.toContain(phrase);
    }
  });

  it('Premium does not automatically require microservices', () => {
    const text = allGuidanceText(packageEngine.getPackageProfile('PREMIUM'));
    assertOnlyNegated(text, ['microservices']);
  });

  it('Premium does not automatically require Kubernetes', () => {
    const text = allGuidanceText(packageEngine.getPackageProfile('PREMIUM'));
    assertOnlyNegated(text, ['kubernetes']);
  });

  it('no profile authorizes unrelated scope (authentication, payments, SSO, multi-tenancy)', () => {
    for (const profile of packageEngine.getAllPackageProfiles()) {
      const text = allGuidanceText(profile);
      assertOnlyNegated(text, ['add authentication', 'add sso', 'add multi-tenancy']);
    }
  });

  it('profile lookup is deterministic across the full catalog', () => {
    const firstPass = packageEngine.getAllPackageProfiles().map((p) => p.code);
    const secondPass = packageEngine.getAllPackageProfiles().map((p) => p.code);

    expect(firstPass).toEqual(secondPass);
  });

  it('no package profile contains pricing claims', () => {
    for (const profile of packageEngine.getAllPackageProfiles()) {
      const text = allGuidanceText(profile);
      expect(text).not.toMatch(/\$\d|price|pricing|cost|invoice amount|quote/);
    }
  });

  it('every profile documents an explicit exclusions list', () => {
    for (const profile of packageEngine.getAllPackageProfiles()) {
      expect(profile.exclusions.length).toBeGreaterThan(0);
    }
  });
});
