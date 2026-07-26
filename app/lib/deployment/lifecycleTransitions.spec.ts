import { describe, expect, it } from 'vitest';
import { DEPLOYMENT_STATUS_TRANSITIONS, isValidDeploymentStatusTransition } from './lifecycleTransitions';
import type { DeploymentStatus } from '~/lib/deployment/deploymentTypes';

describe('isValidDeploymentStatusTransition', () => {
  it('allows a no-op transition from any status', () => {
    for (const status of Object.keys(DEPLOYMENT_STATUS_TRANSITIONS) as DeploymentStatus[]) {
      expect(isValidDeploymentStatusTransition(status, status)).toBe(true);
    }
  });

  it('walks the full pre-release lifecycle in order', () => {
    const path: DeploymentStatus[] = [
      'planning',
      'engineering',
      'generated',
      'repository_connected',
      'database_connected',
      'environment_ready',
      'deploying',
      'deployed',
      'verified',
      'released',
    ];

    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidDeploymentStatusTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('rejects skipping a stage', () => {
    expect(isValidDeploymentStatusTransition('planning', 'deployed')).toBe(false);
    expect(isValidDeploymentStatusTransition('repository_connected', 'released')).toBe(false);
  });

  it('rejects regressing to an earlier stage', () => {
    expect(isValidDeploymentStatusTransition('deployed', 'generated')).toBe(false);
    expect(isValidDeploymentStatusTransition('released', 'planning')).toBe(false);
  });

  it('allows failed to interrupt any pre-released state', () => {
    expect(isValidDeploymentStatusTransition('planning', 'failed')).toBe(true);
    expect(isValidDeploymentStatusTransition('deploying', 'failed')).toBe(true);
    expect(isValidDeploymentStatusTransition('verified', 'failed')).toBe(true);
  });

  it('allows failed to resume back into any pre-released state', () => {
    expect(isValidDeploymentStatusTransition('failed', 'planning')).toBe(true);
    expect(isValidDeploymentStatusTransition('failed', 'environment_ready')).toBe(true);
  });

  it('does not allow failed to jump directly to released', () => {
    expect(isValidDeploymentStatusTransition('failed', 'released')).toBe(false);
  });

  it('allows released to move into maintenance and back', () => {
    expect(isValidDeploymentStatusTransition('released', 'maintenance')).toBe(true);
    expect(isValidDeploymentStatusTransition('maintenance', 'released')).toBe(true);
  });

  it('allows maintenance to archive, and treats archived as terminal', () => {
    expect(isValidDeploymentStatusTransition('maintenance', 'archived')).toBe(true);
    expect(isValidDeploymentStatusTransition('archived', 'released')).toBe(false);
    expect(isValidDeploymentStatusTransition('archived', 'maintenance')).toBe(false);
  });
});
