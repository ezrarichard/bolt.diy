/**
 * Sprint 39.7 — central registry of Builders project workflows, mirroring the static
 * registry shape of app/lib/generation-profiles/defaultProfiles.ts (Sprint 39.5). Every
 * UI surface that needs a project type's icon/label/color reads it from here rather than
 * hardcoding the string — adding a new workflow (GitHub Import, Templates, Browser Use,
 * Marketplace) means adding one entry here, not touching every component that renders a
 * project.
 */
export type ProjectTypeId = 'quick_build' | 'guided_engineering';

export interface ProjectTypeDefinition {
  id: ProjectTypeId;
  displayName: string;
  icon: string;
  color: string;
}

export const PROJECT_TYPE_REGISTRY: Record<ProjectTypeId, ProjectTypeDefinition> = {
  quick_build: {
    id: 'quick_build',
    displayName: 'Quick Build',
    icon: '⚡',
    color: 'amber',
  },
  guided_engineering: {
    id: 'guided_engineering',
    displayName: 'Guided Engineering',
    icon: '🛠',
    color: 'purple',
  },
};

export const PROJECT_TYPE_OPTIONS = Object.values(PROJECT_TYPE_REGISTRY);

/** Falls back to Guided Engineering for missing/unknown ids (e.g. pre-Sprint-39.7 projects). */
export function getProjectTypeDefinition(id: string | undefined): ProjectTypeDefinition {
  return PROJECT_TYPE_REGISTRY[id as ProjectTypeId] ?? PROJECT_TYPE_REGISTRY.guided_engineering;
}

const MODEL_PROVIDER_PREFIX = /^(\[Model:[^\]]*\]\s*)?(\[Provider:[^\]]*\]\s*)?/;

/**
 * Strips the "[Model: ...]\n\n[Provider: ...]\n\n" prefix Chat.client.tsx's sendMessage
 * prepends to every first message's content — irrelevant noise for a project name. Shared
 * by useChatHistory.ts (deriving a new quick_build project's name) and projects.ts
 * (sanitizing legacy project names created before this stripping existed).
 */
export function stripModelProviderPrefix(text: string): string {
  return text.replace(MODEL_PROVIDER_PREFIX, '').trim();
}

/**
 * True if a name still looks like the raw, un-stripped prefix — i.e. it's a leftover bug
 * artifact, not something a user actually typed (a real user-edited title would never
 * start with literal "[Model:"). Used to safely re-derive only buggy legacy names without
 * ever touching a genuine user-edited title.
 */
export function looksLikeRawModelPrefixName(name: string): boolean {
  return /^\[Model:/i.test(name.trim());
}

/**
 * How a project originated — analytics/reporting metadata only, deliberately a superset of
 * ProjectTypeId. Not the same axis: a project can be `createdFrom: 'template'` while its
 * `projectType` stays 'guided_engineering'. No registry entries (icon/color) yet since
 * nothing renders this in the UI this sprint.
 */
export const CREATED_FROM_VALUES = [
  'quick_build',
  'guided_engineering',
  'template',
  'github',
  'browser_use',
  'import',
  'api',
  'clone',
] as const;

export type CreatedFrom = (typeof CREATED_FROM_VALUES)[number];
