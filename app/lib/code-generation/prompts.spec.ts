import { describe, expect, it } from 'vitest';
import { buildServicesPrompt } from './prompts';

describe('buildServicesPrompt — Sprint 86 Part 2 (frontend/backend connection)', () => {
  it('asks for mock data only when no Backend Module is planned (unchanged pre-Sprint-86 behavior)', () => {
    const prompt = buildServicesPrompt({
      projectName: 'Test',
      apiEndpoints: ['/api/products'],
      apiArchitecture: 'REST',
    });

    expect(prompt).toContain('realistic mock data');
    expect(prompt).not.toContain('Generated Backend Module');
  });

  it('instructs the AI to call the real generated backend module instead of mocking, when one is planned', () => {
    const prompt = buildServicesPrompt({
      projectName: 'Test',
      apiEndpoints: ['/api/appointments'],
      apiArchitecture: 'REST',
      backendModules: [{ moduleSlug: 'appointments', apiEndpoints: ['/api/appointments'] }],
    });

    expect(prompt).toContain('Generated Backend Module(s)');
    expect(prompt).toContain('src/features/appointments/service.ts');
    expect(prompt).toContain('../features/<moduleSlug>/service');
    expect(prompt).toMatch(/do NOT return mock data for these/i);
  });

  it('still allows mock data for endpoints not covered by any Backend Module, even when other endpoints are covered', () => {
    const prompt = buildServicesPrompt({
      projectName: 'Test',
      apiEndpoints: ['/api/appointments', '/api/newsletter'],
      apiArchitecture: 'REST',
      backendModules: [{ moduleSlug: 'appointments', apiEndpoints: ['/api/appointments'] }],
    });

    expect(prompt).toMatch(/NOT covered by any Backend Module.*mock data/is);
  });

  it('treats an empty backendModules array exactly like omitting it entirely', () => {
    const withEmpty = buildServicesPrompt({
      projectName: 'Test',
      apiEndpoints: ['/api/products'],
      apiArchitecture: 'REST',
      backendModules: [],
    });
    const withOmitted = buildServicesPrompt({
      projectName: 'Test',
      apiEndpoints: ['/api/products'],
      apiArchitecture: 'REST',
    });

    expect(withEmpty).toBe(withOmitted);
  });
});
