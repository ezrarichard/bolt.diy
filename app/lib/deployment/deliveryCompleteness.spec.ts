import { describe, expect, it } from 'vitest';
import {
  calculateDeliveryCompleteness,
  resolveCompletenessLevel,
  type CompletenessInput,
} from './deliveryCompleteness';

function input(overrides: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    deploymentSummary: {
      lifecycleStatus: 'verified',
      environment: 'preview',
      provider: 'vercel',
      vercelProjectName: 'my-app',
      previewUrl: 'https://my-app.vercel.app',
    },
    verificationSummary: {
      verified: true,
      status: 'passed',
      checksPassed: 9,
      checksFailed: 0,
      warnings: 0,
      requiredPassed: 6,
      requiredTotal: 6,
      categories: [],
    },
    repositoryInformation: { provider: 'github', repositoryFullName: 'acme/my-app', branch: 'main' },
    databaseInformation: { provider: 'supabase', projectRef: 'abcdefghijklmnopqrst', schemaVersion: 2 },
    environmentSummary: {
      ready: true,
      fullyResolved: true,
      variables: [{ name: 'VITE_SUPABASE_URL', status: 'resolved', source: 'provider', sensitive: false, detail: '' }],
      resolvedCount: 1,
      manualCount: 0,
    },
    applicationSummary: {
      framework: 'react-vite-ts',
      packageManager: 'npm',
      entryFile: 'src/main.tsx',
      runtimeRequirements: [],
      requiredServices: [],
      routes: [{ path: '/', name: 'Home' }],
      totalFiles: 20,
      completedFiles: 20,
      dependencies: [],
    },
    generationMetadata: { manifestVersion: 4, totalFiles: 20, completedFiles: 20, failedFiles: 0 },
    featureInventory: {
      features: [
        {
          code: 'FEAT-001',
          title: 'Book',
          state: 'verified',
          verificationState: 'verified',
          source: 'feature_registry',
          evidence: '',
        },
      ],
      implementedCount: 1,
      verifiedCount: 1,
      futureCount: 0,
      optionalCount: 0,
    },
    blueprintSummary: { name: 'Business Website', recommendedStack: [], recommendedIntegrations: [] },
    documentation: {
      available: true,
      sections: [{ id: 'requirements', label: 'Requirements', fileCount: 1 }],
      missingSections: [],
    },
    adminGuide: {
      previewUrl: 'https://my-app.vercel.app',
      repositoryUrl: 'https://github.com/acme/my-app',
      environmentVariables: [],
      procedures: [{ id: 'redeploy', title: 'How to redeploy', steps: ['…'] }],
    },
    acceptanceChecklist: {
      items: [
        { id: 'a', label: 'A', state: 'satisfied', evidence: '', customerAction: false },
        { id: 'customer_review', label: 'Customer review', state: 'pending', evidence: '', customerAction: true },
      ],
      satisfiedCount: 1,
      outstandingCount: 1,
      customerActionCount: 1,
    },
    requiresDatabase: true,
    ...overrides,
  };
}

describe('calculateDeliveryCompleteness', () => {
  it('scores a fully-evidenced delivery as complete', () => {
    const result = calculateDeliveryCompleteness(input());

    expect(result.score).toBe(100);
    expect(result.level).toBe('complete');
  });

  it('is advisory — it never rejects, it only reports', () => {
    const result = calculateDeliveryCompleteness(
      input({
        deploymentSummary: { lifecycleStatus: 'verified', environment: 'preview', provider: 'none' },
        verificationSummary: {
          verified: false,
          checksPassed: 0,
          checksFailed: 0,
          warnings: 0,
          requiredPassed: 0,
          requiredTotal: 0,
          categories: [],
        },
        repositoryInformation: { provider: 'none' },
        databaseInformation: { provider: 'none' },
        documentation: { available: false, sections: [], missingSections: [] },
        blueprintSummary: { recommendedStack: [], recommendedIntegrations: [] },
        generationMetadata: { totalFiles: 0, completedFiles: 0, failedFiles: 0 },
        adminGuide: { environmentVariables: [], procedures: [] },
        featureInventory: { features: [], implementedCount: 0, verifiedCount: 0, futureCount: 0, optionalCount: 0 },
      }),
    );

    expect(result.score).toBeLessThan(30);
    expect(result.level).toBe('incomplete');
    expect(result.dimensions.length).toBeGreaterThan(0);
  });

  it('scores an unverified deployment zero for verification but still packages everything else', () => {
    const result = calculateDeliveryCompleteness(
      input({
        verificationSummary: {
          verified: false,
          checksPassed: 0,
          checksFailed: 0,
          warnings: 0,
          requiredPassed: 0,
          requiredTotal: 0,
          categories: [],
        },
      }),
    );

    expect(result.dimensions.find((entry) => entry.id === 'verification')?.score).toBe(0);
    expect(result.score).toBeGreaterThan(50);
  });

  it('gives a warning verification near-full credit, since a warning still permits handover', () => {
    const result = calculateDeliveryCompleteness(
      input({
        verificationSummary: {
          verified: true,
          status: 'warning',
          checksPassed: 8,
          checksFailed: 0,
          warnings: 1,
          requiredPassed: 6,
          requiredTotal: 6,
          categories: [],
        },
      }),
    );

    expect(result.dimensions.find((entry) => entry.id === 'verification')?.score).toBe(0.85);

    // Still a complete delivery — advisory warnings cost a few points, they never demote the level on their own.
    expect(result.score).toBeLessThan(100);
    expect(result.level).toBe('complete');
  });

  it('does not penalise a frontend-only application for having no database', () => {
    const withDatabase = calculateDeliveryCompleteness(input());
    const withoutDatabase = calculateDeliveryCompleteness(
      input({ requiresDatabase: false, databaseInformation: { provider: 'none' } }),
    );

    expect(withoutDatabase.dimensions.find((entry) => entry.id === 'database')?.score).toBe(1);
    expect(withoutDatabase.score).toBe(withDatabase.score);
  });

  it('gives partial credit for partially-resolved environment variables', () => {
    const result = calculateDeliveryCompleteness(
      input({
        environmentSummary: {
          ready: true,
          fullyResolved: false,
          variables: [
            { name: 'A', status: 'resolved', source: 'provider', sensitive: false, detail: '' },
            { name: 'B', status: 'missing', source: 'manual', sensitive: true, detail: '' },
          ],
          resolvedCount: 1,
          manualCount: 1,
        },
      }),
    );

    expect(result.dimensions.find((entry) => entry.id === 'environment')?.score).toBe(0.5);
  });

  it('explains every dimension it scored', () => {
    const result = calculateDeliveryCompleteness(input());

    expect(result.dimensions.every((entry) => entry.detail.length > 0)).toBe(true);
    expect(result.dimensions.map((entry) => entry.id)).toEqual([
      'deployment',
      'verification',
      'repository',
      'database',
      'environment',
      'manifest',
      'features',
      'blueprint',
      'documentation',
      'admin_guide',
      'acceptance_checklist',
    ]);
  });

  it('excludes customer-action items from the checklist dimension, so a pending customer never lowers the score', () => {
    const result = calculateDeliveryCompleteness(input());

    expect(result.dimensions.find((entry) => entry.id === 'acceptance_checklist')?.score).toBe(1);
  });
});

describe('resolveCompletenessLevel', () => {
  it('maps the documented thresholds', () => {
    expect(resolveCompletenessLevel(100)).toBe('complete');
    expect(resolveCompletenessLevel(95)).toBe('complete');
    expect(resolveCompletenessLevel(94)).toBe('almost_complete');
    expect(resolveCompletenessLevel(75)).toBe('almost_complete');
    expect(resolveCompletenessLevel(74)).toBe('incomplete');
    expect(resolveCompletenessLevel(0)).toBe('incomplete');
  });
});
