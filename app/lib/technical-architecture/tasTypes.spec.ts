import { describe, expect, it } from 'vitest';
import {
  EMPTY_TAS,
  TAS_VERSION,
  isEmptyTas,
  parseTechnicalArchitectureSpec,
  type TechnicalArchitectureSpecification,
} from './tasTypes';

/**
 * Sprint 100B — `parseTechnicalArchitectureSpec` is the tolerant half of the TAS
 * contract: it must NEVER throw and NEVER return undefined, because that guarantee
 * is what stops a malformed model response from breaking the narrative Architecture
 * Draft's existing approval flow. These tests pin that guarantee, plus the coercion
 * rules the schema fixes (secrets are never client-exposed, authorization is always
 * server-side enforced, off-vocabulary enum values fall back rather than propagate).
 *
 * Correctness of a parsed spec is tasValidation.spec.ts's job, not this file's.
 */

const MINIMAL_TAS = {
  tasVersion: '1.0',
  projectId: 'p1',
  projectName: 'BoutiquePro',
  mvpSequence: 1,
  changeClass: 'structural',
  systemOverview: {
    summary: 'Multi-tenant SaaS for boutiques.',
    productType: 'vertical-saas',
    topology: 'stateless web tier + managed database',
    modules: [{ id: 'orders', name: 'Orders', responsibility: 'Order lifecycle', dependsOn: ['customers'] }],
    systemBoundaries: ['Inventory is not modelled'],
  },
  capabilities: [
    {
      id: 'cap-payments',
      kind: 'payment',
      name: 'Payment Recording',
      purpose: 'Record advances and settlement.',
      port: 'PaymentProvider',
      portSurface: ['recordPayment'],
      bindings: [
        { id: 'pay-manual', provider: 'Manual entry', providerType: 'manual', lifecycle: 'current' },
        {
          id: 'pay-razorpay',
          provider: 'Razorpay',
          providerType: 'hosted-api',
          lifecycle: 'future',
          targetMvpSequence: 2,
          v1Cost: 'zero',
          v1CostJustification: 'Port exists for manual recording anyway.',
          invariants: ['No gateway SDK type outside the adapter'],
          doNotBuild: ['Razorpay SDK integration'],
        },
      ],
      runtimeConfigurable: false,
      configScreenRequired: false,
      secretRefs: [],
      fallback: { kind: 'none', description: 'Manual entry cannot fail.' },
      failureMode: 'blocking',
      decisionRefs: [],
    },
  ],
};

describe('parseTechnicalArchitectureSpec — Sprint 100B', () => {
  it('degrades to EMPTY_TAS for undefined, null, primitives and arrays rather than throwing', () => {
    for (const input of [undefined, null, 'a string', 42, true, [], [{ capabilities: [] }]]) {
      expect(() => parseTechnicalArchitectureSpec(input)).not.toThrow();
      expect(parseTechnicalArchitectureSpec(input)).toEqual(EMPTY_TAS);
    }
  });

  it('parses a well-formed spec, preserving lifecycle and seam fields verbatim', () => {
    const tas = parseTechnicalArchitectureSpec(MINIMAL_TAS);

    expect(tas.projectName).toBe('BoutiquePro');
    expect(tas.mvpSequence).toBe(1);
    expect(tas.capabilities).toHaveLength(1);

    const bindings = tas.capabilities[0].bindings;
    expect(bindings.map((binding) => binding.lifecycle)).toEqual(['current', 'future']);

    const future = bindings[1];
    expect(future.targetMvpSequence).toBe(2);
    expect(future.v1Cost).toBe('zero');
    expect(future.invariants).toEqual(['No gateway SDK type outside the adapter']);
    expect(future.doNotBuild).toEqual(['Razorpay SDK integration']);
  });

  it('always stamps the current schema version, ignoring whatever the model claimed', () => {
    expect(parseTechnicalArchitectureSpec({ ...MINIMAL_TAS, tasVersion: '9.9' }).tasVersion).toBe(TAS_VERSION);
  });

  it('drops malformed array entries instead of failing the whole parse', () => {
    const tas = parseTechnicalArchitectureSpec({
      ...MINIMAL_TAS,
      decisions: [
        { id: 'ADR-001', title: 'Row-scoped tenancy', decision: 'd', rationale: 'r', alternativesRejected: [] },
        { title: 'no id — dropped' },
        'not an object',
        null,
      ],
    });

    expect(tas.decisions).toHaveLength(1);
    expect(tas.decisions[0].id).toBe('ADR-001');
  });

  it('coerces off-vocabulary enum values to a safe default rather than propagating them', () => {
    const tas = parseTechnicalArchitectureSpec({
      ...MINIMAL_TAS,
      changeClass: 'not-a-change-class',
      capabilities: [
        {
          ...MINIMAL_TAS.capabilities[0],
          kind: 'blockchain',
          failureMode: 'catastrophic',
          bindings: [{ id: 'b', provider: 'X', providerType: 'telepathy', lifecycle: 'someday' }],
        },
      ],
    });

    expect(tas.changeClass).toBe('structural');
    expect(tas.capabilities[0].kind).toBe('external');
    expect(tas.capabilities[0].failureMode).toBe('blocking');
    expect(tas.capabilities[0].bindings[0].providerType).toBe('hosted-api');
    expect(tas.capabilities[0].bindings[0].lifecycle).toBe('current');
  });

  it('forces secrets to clientExposed:false even when the model says otherwise', () => {
    const tas = parseTechnicalArchitectureSpec({
      ...MINIMAL_TAS,
      configuration: {
        settings: [],
        environmentVariables: [],
        secrets: [
          { id: 's1', name: 'API_KEY', description: 'k', storage: 'env-var', clientExposed: true, scope: 'deployment' },
        ],
        screens: [],
      },
    });

    expect(tas.configuration.secrets[0].clientExposed).toBe(false);
  });

  it('forces authorization.serverSideEnforced to true even when the model says otherwise', () => {
    const tas = parseTechnicalArchitectureSpec({
      ...MINIMAL_TAS,
      security: { authorization: { model: 'rbac', enforcementPoint: 'API middleware', serverSideEnforced: false } },
    });

    expect(tas.security.authorization.serverSideEnforced).toBe(true);
  });

  it('fills every missing top-level section from EMPTY_TAS so callers never null-check', () => {
    const tas = parseTechnicalArchitectureSpec({ systemOverview: { summary: 'only this' } });

    expect(tas.capabilities).toEqual([]);
    expect(tas.configuration.settings).toEqual([]);
    expect(tas.crossCutting.logging.prohibitedContent).toEqual([]);
    expect(tas.deployment.scalability.envelope).toEqual([]);
    expect(tas.evolution.entries).toEqual([]);
    expect(tas.directives).toEqual([]);
  });

  it('round-trips through JSON, which is how the artifact is persisted', () => {
    const parsed = parseTechnicalArchitectureSpec(MINIMAL_TAS);
    const roundTripped = parseTechnicalArchitectureSpec(JSON.parse(JSON.stringify(parsed)));

    expect(roundTripped).toEqual(parsed);
  });
});

describe('isEmptyTas — Sprint 100B', () => {
  it('treats undefined and EMPTY_TAS as empty', () => {
    expect(isEmptyTas(undefined)).toBe(true);
    expect(isEmptyTas(EMPTY_TAS)).toBe(true);
  });

  it('treats a spec with real content as non-empty', () => {
    expect(isEmptyTas(parseTechnicalArchitectureSpec(MINIMAL_TAS))).toBe(false);
  });

  it('treats a spec with only a summary as non-empty', () => {
    const tas: TechnicalArchitectureSpecification = {
      ...EMPTY_TAS,
      systemOverview: { ...EMPTY_TAS.systemOverview, summary: 'A real architecture summary.' },
    };

    expect(isEmptyTas(tas)).toBe(false);
  });
});
