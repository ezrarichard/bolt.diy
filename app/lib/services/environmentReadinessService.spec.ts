import { describe, expect, it } from 'vitest';
import { assessEnvironmentReadiness } from './environmentReadinessService';
import type { DeploymentGithub, DeploymentSupabase } from '~/lib/deployment/deploymentTypes';

function makeGithub(overrides: Partial<DeploymentGithub> = {}): DeploymentGithub {
  return {
    id: 'gh-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    repoFullName: 'acme/my-app',
    defaultBranch: 'main',
    visibility: 'private',
    status: 'connected',
    metadata: {},
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

function makeSupabase(overrides: Partial<DeploymentSupabase> = {}): DeploymentSupabase {
  return {
    id: 'sb-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    supabaseProjectRef: 'abcdefghij',
    supabaseProjectUrl: 'https://abcdefghij.supabase.co',
    region: 'us-east-1',
    status: 'connected',
    metadata: {},
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('assessEnvironmentReadiness', () => {
  it('resolves VITE_SUPABASE_URL from a connected Supabase project as a provider variable', () => {
    const report = assessEnvironmentReadiness({
      environmentRequirements: ['VITE_SUPABASE_URL'],
      github: null,
      supabase: makeSupabase(),
    });

    const variable = report.variables[0];
    expect(variable.status).toBe('resolved');
    expect(variable.source).toBe('provider');
    expect(variable.sensitive).toBe(false);
    expect(variable.value).toBe('https://abcdefghij.supabase.co');
    expect(report.resolvedVariables).toHaveLength(1);
    expect(report.providerVariables).toHaveLength(1);
    expect(report.missingVariables).toHaveLength(0);
  });

  it('reports VITE_SUPABASE_URL as missing (provider-sourced) when no Supabase project is connected', () => {
    const report = assessEnvironmentReadiness({
      environmentRequirements: ['VITE_SUPABASE_URL'],
      github: null,
      supabase: null,
    });

    const variable = report.variables[0];
    expect(variable.status).toBe('missing');
    expect(variable.source).toBe('provider');
    expect(variable.value).toBeUndefined();
    expect(report.missingVariables).toHaveLength(1);
  });

  it('always reports VITE_SUPABASE_ANON_KEY as sensitive, manual, and missing — never resolved, never carrying a value', () => {
    const report = assessEnvironmentReadiness({
      environmentRequirements: ['VITE_SUPABASE_ANON_KEY'],
      github: null,
      supabase: makeSupabase(),
    });

    const variable = report.variables[0];
    expect(variable.status).toBe('missing');
    expect(variable.source).toBe('manual');
    expect(variable.sensitive).toBe(true);
    expect(variable.value).toBeUndefined();
    expect(report.sensitiveVariables).toHaveLength(1);
    expect(report.manualVariables).toHaveLength(1);
  });

  it('classifies an unrecognized variable name as unknown/manual, never fabricating a resolution', () => {
    const report = assessEnvironmentReadiness({
      environmentRequirements: ['VITE_CUSTOM_API_URL'],
      github: makeGithub(),
      supabase: makeSupabase(),
    });

    const variable = report.variables[0];
    expect(variable.status).toBe('unknown');
    expect(variable.source).toBe('manual');
    expect(variable.sensitive).toBe(false);
  });

  it('keeps resolved/missing/provider/manual/sensitive as separate, non-mixed views over one variable list', () => {
    const report = assessEnvironmentReadiness({
      environmentRequirements: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
      github: null,
      supabase: makeSupabase(),
    });

    expect(report.variables).toHaveLength(2);
    expect(report.resolvedVariables.map((v) => v.name)).toEqual(['VITE_SUPABASE_URL']);
    expect(report.missingVariables.map((v) => v.name)).toEqual(['VITE_SUPABASE_ANON_KEY']);
    expect(report.providerVariables.map((v) => v.name)).toEqual(['VITE_SUPABASE_URL']);
    expect(report.manualVariables.map((v) => v.name)).toEqual(['VITE_SUPABASE_ANON_KEY']);
    expect(report.sensitiveVariables.map((v) => v.name)).toEqual(['VITE_SUPABASE_ANON_KEY']);
  });

  it('is ready (no invalid variables) even with missing/manual variables outstanding, but fullyResolved only when everything resolved', () => {
    const report = assessEnvironmentReadiness({
      environmentRequirements: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
      github: null,
      supabase: makeSupabase(),
    });

    expect(report.ready).toBe(true);
    expect(report.fullyResolved).toBe(false);
  });

  it('is fullyResolved when every declared variable resolves and there are no requirements missing', () => {
    const report = assessEnvironmentReadiness({
      environmentRequirements: ['VITE_SUPABASE_URL'],
      github: null,
      supabase: makeSupabase(),
    });

    expect(report.fullyResolved).toBe(true);
  });

  it('returns an empty, ready report for a project with no environment requirements at all', () => {
    const report = assessEnvironmentReadiness({ environmentRequirements: [], github: null, supabase: null });

    expect(report.variables).toEqual([]);
    expect(report.ready).toBe(true);
    expect(report.fullyResolved).toBe(false);
  });
});
