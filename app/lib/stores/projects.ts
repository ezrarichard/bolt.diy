import { atom } from 'nanostores';

/**
 * Project data model — Sprint 1 (UI-only).
 *
 * Only `id`, `name`, `icon`, `color`, `description`, and `createdAt` are
 * populated today. Everything else is typed now so future sprints (GitHub
 * repo linking, Supabase project linking, deploy targets, env vars,
 * members, templates, MCP servers, knowledge base) can be filled in
 * without another interface rewrite. None of this is persisted to
 * IndexedDB — projects live in localStorage only, and chats are NOT
 * associated with projects yet (see app/components/sidebar/Menu.client.tsx).
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  icon: string; // emoji, shown in the project's circular avatar
  color: string; // tailwind-ish accent color token, e.g. 'purple' | 'blue' | 'green'
  createdAt: string;

  /**
   * Sprint 3 — id of the ProjectBlueprint (see app/lib/blueprints/) chosen
   * when the project was created. Metadata only: no prompt, template, or
   * repository is generated from this yet. Future sprints will use it to
   * drive starter prompts/templates/integrations per blueprint.
   */
  blueprintId?: string;

  // Future fields — intentionally unset in Sprint 1.
  githubRepo?: string;
  supabaseProjectId?: string;
  deploymentTarget?: 'vercel' | 'netlify' | 'cloudflare';
  environmentVariables?: Record<string, string>;
  members?: string[];
  templates?: string[];
  mcpServers?: string[];
  knowledgeBase?: string[];
}

const STORAGE_KEY = 'builder_projects';

const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj-builders-platform',
    name: 'Builders Platform',
    description: 'The internal AI engineering platform itself.',
    icon: '🚀',
    color: 'purple',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'proj-localshop-india',
    name: 'LocalShop India',
    description: 'Local commerce storefront.',
    icon: '🏪',
    color: 'orange',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'proj-ai-advertising',
    name: 'AI Advertising',
    description: 'AI-driven ad platform.',
    icon: '🤖',
    color: 'blue',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'proj-company-website',
    name: 'Company Website',
    description: 'Marketing site.',
    icon: '🌐',
    color: 'green',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'proj-mobile-app',
    name: 'Mobile App',
    description: 'Companion mobile app.',
    icon: '📱',
    color: 'pink',
    createdAt: new Date().toISOString(),
  },
];

function loadProjects(): Project[] {
  if (typeof window === 'undefined') {
    return MOCK_PROJECTS;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored) {
      const parsed = JSON.parse(stored);

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (error) {
    console.error('Failed to load projects from localStorage:', error);
  }

  return MOCK_PROJECTS;
}

export const projectsStore = atom<Project[]>(loadProjects());

/**
 * The "Current Project" — Sprint 2 concept. Set when a project is opened
 * from the sidebar (opens the Project Dashboard modal); null when no
 * project is active. Pure UI state, not persisted, not yet consumed by
 * chat creation/persistence. Future sprints can read this when creating a
 * chat so it's associated with the active project.
 */
export const currentProjectIdStore = atom<string | null>(null);

/**
 * Sprint 6 — whether the Project Dashboard modal is open. Lifted out of
 * Menu.client.tsx's local component state so other components (e.g. the
 * Current Project badge near the chat input) can reopen the dashboard for
 * the active project without prop-drilling through BaseChat/Menu.
 */
export const isProjectDashboardOpenStore = atom(false);

/**
 * Sprint 6 — a monotonically increasing counter. Bump it via
 * requestChatInputFocus() to ask the chat prompt textarea to focus itself
 * (e.g. after closing the Project Dashboard from "Start Chat"). This is a
 * signal, not a value: components that care watch it change in a
 * useEffect and imperatively call textareaRef.current?.focus() — the
 * number itself has no meaning beyond "this changed since last time."
 */
export const focusChatInputRequestStore = atom(0);

export function requestChatInputFocus() {
  focusChatInputRequestStore.set(focusChatInputRequestStore.get() + 1);
}

function persist(projects: Project[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }
}

export function addProject(input: {
  name: string;
  icon: string;
  color: string;
  description?: string;
  blueprintId?: string;
}): Project {
  const project: Project = {
    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    description: input.description,
    icon: input.icon,
    color: input.color,
    blueprintId: input.blueprintId,
    createdAt: new Date().toISOString(),
  };

  const next = [...projectsStore.get(), project];
  projectsStore.set(next);
  persist(next);

  return project;
}

export const PROJECT_COLOR_OPTIONS = ['purple', 'blue', 'green', 'orange', 'pink', 'teal'] as const;
export const PROJECT_ICON_OPTIONS = ['🚀', '🏪', '🤖', '🌐', '📱', '💼', '🧪', '⚙️', '📊', '🎨'] as const;
