import type { DiscoveryIntelligenceState } from '~/lib/hooks/useDiscoveryIntelligence';
import type { DiscoveryDimension, DiscoveryState } from '~/lib/projects/requirementsSession';

/**
 * Sprint 54.1 — Discovery Intelligence UI Integration.
 *
 * Pure display-mapping logic for `BusinessDiscoveryCard.tsx`, kept in its own `.ts` module
 * (rather than inline in the `.tsx` component) specifically so it's testable without rendering
 * JSX — this codebase has no existing convention/tooling for React component-render tests (the
 * Remix Vite plugin's fast-refresh preamble requirement fails outside a real dev server), so
 * every meaningful branch of "what do we show for this state" lives here as a plain function
 * `vitest` can exercise directly.
 */

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface BadgeMeta {
  label: string;
  badgeClass: string;
}

export const DISCOVERY_STATE_META: Record<DiscoveryState, BadgeMeta> = {
  READY: {
    label: 'Ready',
    badgeClass: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10',
  },
  NEEDS_MORE_INFORMATION: {
    label: 'Needs More Information',
    badgeClass: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10',
  },
  INSUFFICIENT_INFORMATION: {
    label: 'Insufficient Information',
    badgeClass: 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10',
  },
};

export const CONFIDENCE_META: Record<ConfidenceLevel, BadgeMeta> = {
  high: { label: 'High', badgeClass: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10' },
  medium: { label: 'Medium', badgeClass: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10' },
  low: { label: 'Low', badgeClass: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50' },
};

export const READY_FOR_DRAFT_META = {
  yes: { label: 'Yes', badgeClass: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10' },
  no: { label: 'No', badgeClass: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50' },
};

/** Every dimension the Sprint 54 brief calls out by name gets its exact requested label; any dimension added later falls back to a generic camelCase splitter rather than needing this map updated in lockstep. */
const DIMENSION_LABELS: Record<DiscoveryDimension, string> = {
  businessVision: 'Business Vision',
  targetUsers: 'Target Users',
  coreFeatures: 'Core Features',
  industry: 'Industry',
  businessAssessment: 'Business Assessment',
  projectType: 'Project Type',
  businessConstraints: 'Business Constraints',
  currentSystems: 'Current Systems',
  integrations: 'Integrations',
  technicalPreferences: 'Technical Preferences',
};

export function formatDimensionLabel(dimension: string): string {
  if (dimension in DIMENSION_LABELS) {
    return DIMENSION_LABELS[dimension as DiscoveryDimension];
  }

  const withSpaces = dimension.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

export function isConfidenceLevel(value: string | undefined): value is ConfidenceLevel {
  return value === 'low' || value === 'medium' || value === 'high';
}

export type BusinessDiscoveryDisplay =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'empty'; message: string }
  | {
      kind: 'ready';
      stateMeta: BadgeMeta;
      classification?: string;
      industry?: string;
      maturity?: string;
      projectType?: string;
      assessmentConfidence?: BadgeMeta;
      completenessScore?: number;
      overallConfidence?: BadgeMeta;
      readyForRequirementsDraft: BadgeMeta;
      missingAreaLabels: string[];
      partialAreaLabels: string[];
    };

const NO_SESSION_MESSAGE = 'Discovery intelligence will be available after the Requirements form is saved.';
const NO_DECISION_MESSAGE = 'Discovery decision has not been calculated yet.';

/**
 * Maps a `useDiscoveryIntelligence` result to exactly what `BusinessDiscoveryCard` should
 * render — every status the hook can return has one explicit branch here, per the Sprint 54.1
 * brief's empty/legacy-state requirements.
 */
export function resolveBusinessDiscoveryDisplay(state: DiscoveryIntelligenceState): BusinessDiscoveryDisplay {
  if (state.status === 'unavailable') {
    return { kind: 'hidden' };
  }

  if (state.status === 'loading') {
    return { kind: 'loading' };
  }

  if (state.status === 'no-session' || state.status === 'no-model' || state.status === 'error') {
    return { kind: 'empty', message: NO_SESSION_MESSAGE };
  }

  const { session, model } = state;
  const { assessment, decision } = model;

  if (!decision.state) {
    return { kind: 'empty', message: NO_DECISION_MESSAGE };
  }

  return {
    kind: 'ready',
    stateMeta: DISCOVERY_STATE_META[decision.state],
    classification: assessment.classification,
    industry: assessment.industry,
    maturity: assessment.maturity,
    projectType: assessment.projectType,
    assessmentConfidence: isConfidenceLevel(session.assessmentConfidence)
      ? CONFIDENCE_META[session.assessmentConfidence]
      : undefined,
    completenessScore: decision.completenessScore,
    overallConfidence: isConfidenceLevel(decision.overallConfidence)
      ? CONFIDENCE_META[decision.overallConfidence]
      : undefined,
    readyForRequirementsDraft: decision.readyForRequirementsDraft ? READY_FOR_DRAFT_META.yes : READY_FOR_DRAFT_META.no,
    missingAreaLabels: (decision.missingAreas ?? []).map(formatDimensionLabel),
    partialAreaLabels: (decision.partialAreas ?? []).map(formatDimensionLabel),
  };
}
