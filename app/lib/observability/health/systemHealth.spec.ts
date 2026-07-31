import { describe, expect, it } from 'vitest';
import { overallHealth, resolveSystemHealth, type HealthInputs } from './systemHealth';

/**
 * The rule worth protecting: an integration the user never set up is `not-configured`, and that
 * must never read as a failure or drag the overall indicator down.
 */

function inputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    recentAiStatuses: ['success', 'success'],
    aiProvider: 'Anthropic',
    buildersDbConfigured: true,
    buildersDbReachable: true,
    supabaseConnected: true,
    supabaseConfigured: true,
    githubConnected: true,
    deploymentProvider: 'Vercel',
    deploymentConnected: true,
    storageAvailable: true,
    telemetry: { state: 'healthy', missing: [] },
    ...overrides,
  };
}

function statusOf(components: ReturnType<typeof resolveSystemHealth>, id: string) {
  return components.find((component) => component.id === id)?.status;
}

describe('resolveSystemHealth', () => {
  it('reports every component healthy when everything is connected', () => {
    const components = resolveSystemHealth(inputs());
    expect(components.every((component) => component.status === 'healthy')).toBe(true);
    expect(components).toHaveLength(7);
  });

  it('treats an unconfigured integration as not-configured, not offline', () => {
    const components = resolveSystemHealth(inputs({ githubConnected: false, deploymentProvider: null }));
    expect(statusOf(components, 'github')).toBe('not-configured');
    expect(statusOf(components, 'deployment')).toBe('not-configured');
  });

  it('distinguishes configured-but-unreachable from not-configured', () => {
    expect(statusOf(resolveSystemHealth(inputs({ buildersDbReachable: false })), 'builders-db')).toBe('offline');
    expect(statusOf(resolveSystemHealth(inputs({ buildersDbConfigured: false })), 'builders-db')).toBe(
      'not-configured',
    );
  });

  it('warns when a minority of recent AI requests failed', () => {
    const components = resolveSystemHealth(inputs({ recentAiStatuses: ['failed', 'failed', 'success', 'success'] }));
    expect(statusOf(components, 'ai-provider')).toBe('warning');
  });

  it('reports the provider offline only when every recent request failed', () => {
    const components = resolveSystemHealth(inputs({ recentAiStatuses: ['failed', 'failed'] }));
    expect(statusOf(components, 'ai-provider')).toBe('offline');
  });

  it('reports not-configured when no AI request has ever been recorded', () => {
    const components = resolveSystemHealth(inputs({ recentAiStatuses: [], aiProvider: null }));
    expect(statusOf(components, 'ai-provider')).toBe('not-configured');
  });

  it('does not treat a cancelled request as a failure', () => {
    const components = resolveSystemHealth(inputs({ recentAiStatuses: ['cancelled', 'success'] }));
    expect(statusOf(components, 'ai-provider')).toBe('healthy');
  });
});

describe('telemetry component', () => {
  it('is offline and names the missing objects when the ledger does not exist', () => {
    const components = resolveSystemHealth(
      inputs({ telemetry: { state: 'unavailable', missing: ['builders_ai_usage_events'] } }),
    );
    const telemetry = components.find((component) => component.id === 'telemetry');

    expect(telemetry?.status).toBe('offline');
    expect(telemetry?.detail).toContain('builders_ai_usage_events');
  });

  it('warns and surfaces the last error when logging is failing', () => {
    const components = resolveSystemHealth(
      inputs({ telemetry: { state: 'degraded', missing: [], lastErrorMessage: 'relation does not exist' } }),
    );
    const telemetry = components.find((component) => component.id === 'telemetry');

    expect(telemetry?.status).toBe('warning');
    expect(telemetry?.detail).toContain('relation does not exist');
  });

  it('is not-configured, never a failure, before the check has run', () => {
    const components = resolveSystemHealth(inputs({ telemetry: undefined }));
    expect(components.find((component) => component.id === 'telemetry')?.status).toBe('not-configured');
  });

  it('drags the overall indicator down when the ledger is missing', () => {
    const components = resolveSystemHealth(
      inputs({ telemetry: { state: 'unavailable', missing: ['builders_ai_usage_events'] } }),
    );
    expect(overallHealth(components)).toBe('offline');
  });
});

describe('overallHealth', () => {
  it('is driven by the worst real status', () => {
    expect(overallHealth(resolveSystemHealth(inputs()))).toBe('healthy');
    expect(overallHealth(resolveSystemHealth(inputs({ buildersDbReachable: false })))).toBe('offline');
    expect(
      overallHealth(resolveSystemHealth(inputs({ recentAiStatuses: ['failed', 'failed', 'success', 'success'] }))),
    ).toBe('warning');
  });

  it('is never dragged down by an unconfigured integration', () => {
    const components = resolveSystemHealth(inputs({ githubConnected: false, deploymentProvider: null }));
    expect(overallHealth(components)).toBe('healthy');
  });

  it('is not-configured when nothing at all is set up', () => {
    expect(overallHealth([{ id: 'x', label: 'X', status: 'not-configured', detail: '' }])).toBe('not-configured');
  });
});
