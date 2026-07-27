import { describe, expect, it } from 'vitest';
import type { DeliveryPackage } from './deliveryPackageTypes';
import { buildReleaseNotes, countReleaseNoteEntries } from './releaseNotes';

function makePackage(overrides: Partial<DeliveryPackage> = {}): DeliveryPackage {
  return {
    projectInformation: { projectId: 'proj-1', projectName: 'Riverside Dental Clinic' },
    verificationSummary: {
      verified: true,
      status: 'warning',
      checksPassed: 8,
      checksFailed: 0,
      warnings: 1,
      requiredPassed: 5,
      requiredTotal: 5,
      categories: [],
    },
    featureInventory: {
      features: [
        {
          code: 'FEAT-001',
          title: 'Book an appointment',
          description: 'Patients can request a slot.',
          state: 'verified',
          verificationState: 'verified',
          source: 'feature_registry',
          evidence: '',
        },
        {
          code: 'FEAT-002',
          title: 'View treatments',
          state: 'implemented',
          verificationState: 'not_verified',
          source: 'feature_registry',
          evidence: '',
        },
        {
          code: 'CAP:database',
          title: 'Managed database (Supabase)',
          state: 'connected',
          verificationState: 'verified',
          source: 'provider',
          evidence: '',
        },
        {
          code: 'CAP:runtime_configuration',
          title: 'Runtime configuration',
          state: 'configured',
          verificationState: 'unavailable',
          source: 'manifest_scope',
          evidence: '',
        },
        {
          code: 'FUTURE:payments',
          title: 'Online payments for treatments',
          state: 'future',
          verificationState: 'unavailable',
          source: 'manifest_scope',
          evidence: '',
        },
        {
          code: 'FEAT-009',
          title: 'Nice-to-have reporting',
          state: 'optional',
          verificationState: 'unavailable',
          source: 'feature_registry',
          evidence: '',
        },
      ],
      implementedCount: 2,
      verifiedCount: 1,
      futureCount: 1,
      optionalCount: 1,
    },
    knownLimitations: [
      {
        id: 'environment:VITE_SUPABASE_ANON_KEY',
        title: 'Manual configuration required: VITE_SUPABASE_ANON_KEY',
        detail: 'Enter the key manually.',
        severity: 'attention',
        source: 'environment',
      },
      {
        id: 'verification:security.headers',
        title: 'Verification warning: Security headers',
        detail: 'Some common security headers are missing.',
        severity: 'informational',
        source: 'verification',
      },
    ],
    ...overrides,
  } as unknown as DeliveryPackage;
}

describe('buildReleaseNotes', () => {
  it('lists delivered features as New Features, from the delivery package only', () => {
    const notes = buildReleaseNotes(makePackage(), '1.0.0');
    const newFeatures = notes.categories.find((group) => group.category === 'new_features')!;

    expect(newFeatures.entries.map((entry) => entry.title)).toEqual(['Book an appointment', 'View treatments']);
    expect(newFeatures.entries[0].source).toBe('Feature registry');
  });

  it('lists connected and configured capabilities as Infrastructure', () => {
    const notes = buildReleaseNotes(makePackage(), '1.0.0');
    const infrastructure = notes.categories.find((group) => group.category === 'infrastructure')!;

    expect(infrastructure.entries.map((entry) => entry.title)).toEqual([
      'Managed database (Supabase)',
      'Runtime configuration',
    ]);
  });

  it('lists deferred scope as Future Scope, never as delivered', () => {
    const notes = buildReleaseNotes(makePackage(), '1.0.0');
    const future = notes.categories.find((group) => group.category === 'future_scope')!;
    const newFeatures = notes.categories.find((group) => group.category === 'new_features')!;

    expect(future.entries.map((entry) => entry.title)).toEqual(['Online payments for treatments']);
    expect(newFeatures.entries.some((entry) => entry.title.includes('Online payments'))).toBe(false);
  });

  it('separates verification-sourced problems into Known Issues, leaving scope decisions as limitations', () => {
    const notes = buildReleaseNotes(makePackage(), '1.0.0');
    const limitations = notes.categories.find((group) => group.category === 'known_limitations')!;

    expect(notes.knownIssues.map((entry) => entry.title)).toEqual(['Verification warning: Security headers']);
    expect(limitations.entries.map((entry) => entry.title)).toEqual([
      'Manual configuration required: VITE_SUPABASE_ANON_KEY',
    ]);
  });

  it('never invents improvements or bug fixes', () => {
    const notes = buildReleaseNotes(makePackage(), '1.0.0');

    expect(notes.categories.find((group) => group.category === 'improvements')!.entries).toEqual([]);
    expect(notes.categories.find((group) => group.category === 'bug_fixes')!.entries).toEqual([]);
  });

  it('emits no breaking changes — they need a baseline comparison that does not exist yet', () => {
    expect(buildReleaseNotes(makePackage(), '2.0.0').breakingChanges).toEqual([]);
  });

  it('writes a summary from counts and verification state, with no adjectives', () => {
    const notes = buildReleaseNotes(makePackage(), '1.0.0');

    expect(notes.summary).toContain('Riverside Dental Clinic 1.0.0');
    expect(notes.summary).toContain('2 feature(s)');
    expect(notes.summary).toContain('1 advisory item(s)');
    expect(notes.summary).toMatch(/1 known issue\(s\)/);
  });

  it('states plainly when the application was never verified', () => {
    const notes = buildReleaseNotes(
      makePackage({
        verificationSummary: {
          verified: false,
          checksPassed: 0,
          checksFailed: 0,
          warnings: 0,
          requiredPassed: 0,
          requiredTotal: 0,
          categories: [],
        },
      } as Partial<DeliveryPackage>),
      '1.0.0',
    );

    expect(notes.summary).toContain('has not been verified');
  });

  it('produces an empty but well-formed set of notes for an empty package', () => {
    const notes = buildReleaseNotes({} as DeliveryPackage, '1.0.0');

    expect(notes.categories).toHaveLength(6);
    expect(countReleaseNoteEntries(notes)).toBe(0);
    expect(notes.summary).toContain('1.0.0');
  });

  it('gives every entry a source, so nothing reads as marketing copy', () => {
    const notes = buildReleaseNotes(makePackage(), '1.0.0');
    const allEntries = [...notes.categories.flatMap((group) => group.entries), ...notes.knownIssues];

    expect(allEntries.length).toBeGreaterThan(0);
    expect(allEntries.every((entry) => entry.source.length > 0)).toBe(true);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildReleaseNotes(makePackage(), '1.0.0'))).toBe(
      JSON.stringify(buildReleaseNotes(makePackage(), '1.0.0')),
    );
  });
});
