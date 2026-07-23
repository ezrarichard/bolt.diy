import { describe, expect, it } from 'vitest';
import { getModelForRole, getRoleGenerateOptions } from './generationProfileRepository';
import { DEFAULT_GENERATION_PROFILES } from './defaultProfiles';
import type { Project } from '~/lib/stores/projects';

/**
 * Sprint 57.1 — regression coverage for the root cause behind the Discovery AI Engine's
 * live-verified 401 ("Invalid or missing API key"): a roleKey with no entry in
 * `DEFAULT_GENERATION_PROFILES` silently resolves to `{}`, and every caller that doesn't also
 * fall back to a working model/provider pair (like `useGenerateText`'s naked
 * `DEFAULT_MODEL`/`DEFAULT_PROVIDER`) breaks. `getModelForRole`/`getRoleGenerateOptions` are
 * pure and synchronous (no BuildersDB, see this module's own header comment), so this is a
 * plain unit test — no live provider call, no network.
 */

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    icon: '',
    color: '',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Project;
}

describe('getModelForRole — discovery-agent (Sprint 57.1 regression)', () => {
  it.each(DEFAULT_GENERATION_PROFILES.map((p) => p.id))(
    'resolves a real model/provider for discovery-agent in the %s profile',
    (profileId) => {
      const resolution = getModelForRole(profileId, 'discovery-agent');

      expect(resolution).toBeDefined();
      expect(resolution?.provider).toBeTruthy();
      expect(resolution?.model).toBeTruthy();
    },
  );

  it('every DEFAULT_GENERATION_PROFILES tier registers a discovery-agent role', () => {
    for (const profile of DEFAULT_GENERATION_PROFILES) {
      const entry = profile.roles.find((role) => role.roleKey === 'discovery-agent');
      expect(entry, `profile "${profile.id}" is missing a discovery-agent role entry`).toBeDefined();
    }
  });

  it('mirrors the same model tier as requirements-draft in every profile', () => {
    for (const profile of DEFAULT_GENERATION_PROFILES) {
      const discoveryEntry = profile.roles.find((role) => role.roleKey === 'discovery-agent');
      const requirementsEntry = profile.roles.find((role) => role.roleKey === 'requirements-draft');
      expect(discoveryEntry?.modelKey).toBe(requirementsEntry?.modelKey);
    }
  });

  it('returns undefined for a genuinely unregistered roleKey, proving the test itself is meaningful', () => {
    expect(getModelForRole('balanced', 'not-a-real-role')).toBeUndefined();
  });
});

describe('getRoleGenerateOptions — discovery-agent (Sprint 57.1 regression)', () => {
  it('resolves model/provider for a project with no selected Generation Profile (defaults to balanced)', () => {
    const options = getRoleGenerateOptions(project(), 'discovery-agent');

    expect(options.model).toBeTruthy();
    expect(options.provider).toBeTruthy();
    expect(options.generationProfileId).toBe('balanced');
  });

  it('resolves model/provider for a project with an explicit Generation Profile selected', () => {
    const options = getRoleGenerateOptions(
      project({ workspaceState: { selectedGenerationProfileId: 'production' } as Project['workspaceState'] }),
      'discovery-agent',
    );

    expect(options.generationProfileId).toBe('production');
    expect(options.model).toBeTruthy();
  });
});
