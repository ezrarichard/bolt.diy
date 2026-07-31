/**
 * Builders Observability — module registry.
 *
 * Observability is a container, not a single screen. AI Usage is its first module; Performance,
 * Infrastructure, Deployments and Errors are declared here as `planned` so the shape of the
 * platform is visible in code before any of them exist.
 *
 * This registry is the extension point. Adding a module later means:
 *   1. flipping its `status` to 'available' below (or adding a new entry),
 *   2. adding its Control Panel tab id to `tabId`,
 *   3. rendering its component from ControlPanel.tsx's `getTabComponent`.
 *
 * Nothing here imports a module's implementation, so a `planned` entry costs nothing at runtime
 * and cannot drag an unbuilt module's code into the bundle.
 */

import type { TabType } from '~/components/@settings/core/types';

export type ObservabilityModuleStatus = 'available' | 'planned';

export interface ObservabilityModule {
  id: string;
  label: string;

  /** One line, written for the person reading the Control Panel — not for an engineer. */
  description: string;

  /** Phosphor icon class, matching the rest of the Control Panel's iconography. */
  icon: string;
  status: ObservabilityModuleStatus;

  /**
   * The Control Panel tab this module renders in. Only set for `available` modules — a planned
   * module has no tab, which is what keeps it out of the panel's grid entirely.
   */
  tabId?: TabType;
}

export const OBSERVABILITY_MODULES: readonly ObservabilityModule[] = [
  {
    id: 'ai-usage',
    label: 'AI Usage',
    description: 'Track AI requests, tokens, latency and estimated cost',
    icon: 'i-ph:chart-line-up-duotone',
    status: 'available',
    tabId: 'ai-usage',
  },
  {
    id: 'performance',
    label: 'Performance',
    description: 'Latency, success rate, retries and throughput',
    icon: 'i-ph:gauge-duotone',
    status: 'available',
    tabId: 'performance',
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    description: 'Database, storage and API health',
    icon: 'i-ph:hard-drives-duotone',
    status: 'planned',
  },
  {
    id: 'deployments',
    label: 'Deployments',
    description: 'Deployment frequency, duration and success rate',
    icon: 'i-ph:rocket-launch-duotone',
    status: 'planned',
  },
  {
    id: 'errors',
    label: 'Errors',
    description: 'Failure rates, repair attempts and error clustering',
    icon: 'i-ph:warning-octagon-duotone',
    status: 'planned',
  },
] as const;

/** The modules that actually have a Control Panel tab today. */
export function availableObservabilityModules(): ObservabilityModule[] {
  return OBSERVABILITY_MODULES.filter((module) => module.status === 'available');
}

/** Every Control Panel tab owned by Observability — used by ControlPanel.tsx to build its section. */
export function observabilityTabIds(): TabType[] {
  return availableObservabilityModules()
    .map((module) => module.tabId)
    .filter((tabId): tabId is TabType => Boolean(tabId));
}
