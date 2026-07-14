import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import { updateProjectWorkspaceState, type Project } from '~/lib/stores/projects';
import { resolveModelKey } from './modelRegistry';
import { DEFAULT_GENERATION_PROFILE_ID, DEFAULT_GENERATION_PROFILES } from './defaultProfiles';
import type { GenerationProfile, GenerationProfileWithRoles, RoleModelResolution } from './generationProfileTypes';

/**
 * Generation Profile Repository — Sprint 39.5.
 *
 * `getGenerationProfiles`/`getGenerationProfileById`/`getDefaultGenerationProfile` are
 * DB-first (BuildersDB), falling back to the local `defaultProfiles.ts` constants when
 * BuildersDB is unconfigured/unreachable or hasn't been seeded yet — same defensive
 * contract every other builders-db-backed repository in this codebase follows.
 *
 * `getModelForRole` is deliberately SYNCHRONOUS and never touches the network — it reads
 * only `defaultProfiles.ts` (the 3 fixed system profiles are fully known at build time;
 * see that file's header for why an async DB round trip isn't worth it here) and resolves
 * the role's `modelKey` through modelRegistry.ts's `resolveModelKey()`. Every call site
 * that wraps a `generate()` callback calls this directly, right before firing a request.
 */

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

function unavailable(method: string): void {
  console.warn(`[BuildersDB] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[GenerationProfiles] ${method}() failed:`, error);
}

function findLocalProfile(profileId: string): GenerationProfileWithRoles | undefined {
  return DEFAULT_GENERATION_PROFILES.find((profile) => profile.id === profileId);
}

function toProfileSummary(profile: GenerationProfileWithRoles): GenerationProfile {
  const { roles: _roles, ...summary } = profile;
  return summary;
}

/** Every known Generation Profile — DB rows if BuildersDB is configured and seeded, otherwise the local system defaults. */
export async function getGenerationProfiles(): Promise<GenerationProfile[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getGenerationProfiles');
    return DEFAULT_GENERATION_PROFILES.map(toProfileSummary);
  }

  try {
    const { data, error } = await client.from('builders_generation_profiles').select('*').order('name');

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return DEFAULT_GENERATION_PROFILES.map(toProfileSummary);
    }

    return data.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      mode: row.mode,
      isDefault: row.is_default,
      isSystem: row.is_system,
    }));
  } catch (error) {
    logError('getGenerationProfiles', error);
    return DEFAULT_GENERATION_PROFILES.map(toProfileSummary);
  }
}

export async function getGenerationProfileById(profileId: string): Promise<GenerationProfile | undefined> {
  const profiles = await getGenerationProfiles();
  return profiles.find((profile) => profile.id === profileId);
}

export async function getDefaultGenerationProfile(): Promise<GenerationProfile> {
  const profiles = await getGenerationProfiles();
  return (
    profiles.find((profile) => profile.isDefault) ??
    profiles.find((profile) => profile.id === DEFAULT_GENERATION_PROFILE_ID) ??
    toProfileSummary(DEFAULT_GENERATION_PROFILES[0])
  );
}

/**
 * Resolves `profileId`'s mapping for `roleKey` into a real provider/API model, via the
 * Model Registry — never a raw model id lookup of its own. Returns `undefined` for an
 * unrecognized profile/role/modelKey, which every call site treats as "no override" —
 * falling back safely to whatever the user has manually selected (see useGenerateText.ts).
 */
export function getModelForRole(profileId: string, roleKey: string): RoleModelResolution | undefined {
  const profile = findLocalProfile(profileId) ?? findLocalProfile(DEFAULT_GENERATION_PROFILE_ID);
  const roleEntry = profile?.roles.find((role) => role.roleKey === roleKey);

  if (!roleEntry) {
    return undefined;
  }

  const registryEntry = resolveModelKey(roleEntry.modelKey);

  if (!registryEntry) {
    return undefined;
  }

  return {
    provider: registryEntry.provider,
    model: registryEntry.apiModel,
    modelKey: roleEntry.modelKey,
    temperature: roleEntry.temperature,
    maxTokens: roleEntry.maxTokens,
  };
}

/** Persists which Generation Profile a project has selected — a thin call to the existing, already-defensive `updateProjectWorkspaceState` (merges partials + mirrors to BuildersDB on its own). */
export function saveSelectedProfileForProject(projectId: string, profileId: string): void {
  updateProjectWorkspaceState(projectId, { selectedGenerationProfileId: profileId });
}

/**
 * Convenience wrapper every `generate()` call site uses: resolves `project`'s selected
 * profile (falling back to Balanced when unset) and `roleKey`'s model within it, returning
 * a ready-to-spread options object — `{}` when nothing resolves, so
 * `generate(system, prompt, { ...existingOptions, ...getRoleGenerateOptions(project, roleKey) })`
 * always degrades safely to the user's own cookie-selected model.
 */
export function getRoleGenerateOptions(
  project: Project,
  roleKey: string,
): { model?: string; provider?: string; temperature?: number; modelKey?: string; generationProfileId?: string } {
  const profileId = project.workspaceState?.selectedGenerationProfileId ?? DEFAULT_GENERATION_PROFILE_ID;
  const resolution = getModelForRole(profileId, roleKey);

  return resolution
    ? {
        model: resolution.model,
        provider: resolution.provider,
        temperature: resolution.temperature,
        modelKey: resolution.modelKey,
        generationProfileId: profileId,
      }
    : {};
}
