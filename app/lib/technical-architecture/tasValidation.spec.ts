import { describe, expect, it } from 'vitest';
import { EMPTY_TAS, parseTechnicalArchitectureSpec, type TechnicalArchitectureSpecification } from './tasTypes';
import { UNIMPLEMENTED_TAS_RULES, validateTechnicalArchitecture } from './tasValidation';

/**
 * Sprint 100B — the strict half of the TAS contract. Rule ids match
 * docs/architecture/TAS-Schema.md §9 one-for-one.
 *
 * The most important test in this file is the first one: an EMPTY_TAS validates
 * as OK. "No TAS" is the permanent, valid state of every project created before
 * Sprint 100B, and treating it as a validation failure would turn backward
 * compatibility into a wall of false findings.
 */

/** A spec that passes every implemented rule — the baseline each test below breaks in exactly one way. */
function validTas(): TechnicalArchitectureSpecification {
  return parseTechnicalArchitectureSpec({
    tasVersion: '1.0',
    projectId: 'boutiquepro',
    projectName: 'BoutiquePro',
    mvpSequence: 1,
    changeClass: 'structural',
    systemOverview: {
      summary: 'Multi-tenant SaaS for boutiques.',
      productType: 'vertical-saas',
      topology: 'stateless web tier',
      modules: [
        { id: 'customers', name: 'Customers', responsibility: 'Register', dependsOn: [] },
        { id: 'orders', name: 'Orders', responsibility: 'Orders', dependsOn: ['customers'] },
      ],
      systemBoundaries: [],
    },
    decisions: [
      {
        id: 'ADR-001',
        title: 'Row-scoped tenancy',
        decision: 'boutique_id everywhere',
        rationale: 'Right for projected scale',
        alternativesRejected: [{ option: 'Database per tenant', reason: 'Operationally expensive' }],
      },
    ],
    capabilities: [
      {
        id: 'cap-payments',
        kind: 'payment',
        name: 'Payment Recording',
        purpose: 'Record settlement',
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
            v1CostJustification: 'Port required anyway.',
            invariants: ['No gateway SDK type outside the adapter'],
            doNotBuild: ['Razorpay SDK integration'],
          },
        ],
        runtimeConfigurable: false,
        configScreenRequired: false,
        secretRefs: ['sec-db'],
        fallback: { kind: 'none', description: 'Manual entry cannot fail.' },
        failureMode: 'blocking',
        decisionRefs: ['ADR-001'],
      },
    ],
    configuration: {
      settings: [
        {
          key: 'boutique.timezone',
          description: 'Tenant timezone',
          scope: 'tenant',
          mutability: 'runtime-admin',
          valueType: 'string',
          screenRef: 'scr-profile',
          lifecycle: 'current',
        },
      ],
      environmentVariables: [
        {
          name: 'DATABASE_URL',
          description: 'Connection string',
          owner: 'devops',
          scope: 'server',
          requiredAt: 'boot',
          hasSafeDefault: false,
          isSecret: true,
        },
      ],
      secrets: [
        {
          id: 'sec-db',
          name: 'DATABASE_URL',
          description: 'Connection string',
          storage: 'platform-secret-store',
          clientExposed: false,
          scope: 'deployment',
        },
      ],
      screens: [
        {
          id: 'scr-profile',
          name: 'Boutique Profile',
          accessRole: 'owner',
          settingKeys: ['boutique.timezone'],
          hasConnectionTest: false,
          location: 'Settings > Profile',
        },
      ],
    },
    security: {
      authentication: {
        method: 'Phone + OTP',
        identityField: 'phone',
        sessionMechanism: 'signed token',
        sessionExpiry: '12h',
        revocation: 'On deactivation',
        credentialStorage: 'hashed',
        rateLimiting: 'per identity and IP',
      },
      authorization: {
        model: 'rbac',
        enforcementPoint: 'API middleware',
        roles: ['owner'],
        permissionSource: 'role map',
      },
      boundaries: [],
      publicSurfaces: [],
    },
    tenancy: {
      model: 'shared-schema-row-scoped',
      scopeColumn: 'boutique_id',
      identitySource: 'authenticated session claim',
      enforcementLayers: [
        { layer: 'application', mechanism: 'data-access scoping', guaranteeIfOthersFail: 'No unscoped read' },
        { layer: 'database', mechanism: 'row-level security', guaranteeIfOthersFail: 'Zero foreign rows' },
      ],
      cacheKeyConvention: '{boutique_id}:{entity}:{id}',
      storagePathConvention: '{boutique_id}/{bucket}/{asset_id}',
      levels: [{ name: 'Single boutique', description: 'One per tenant', lifecycle: 'current' }],
    },
    crossCutting: {
      storage: {
        provider: 'Object storage',
        buckets: [],
        pathConvention: '{boutique_id}/',
        accessModel: 'signed-url',
        virusScanning: true,
      },
      featureToggles: {
        evaluationPoint: 'server-side resolver',
        source: 'tenant-config',
        flags: [
          {
            key: 'feature.aiEnabled',
            description: 'Master AI switch',
            defaultState: false,
            scope: 'system',
            removalCondition: 'Removed when AI ships',
            lifecycle: 'current',
          },
        ],
      },
      backgroundProcessing: {
        mechanism: 'Managed queue',
        jobs: [
          {
            id: 'job-export',
            name: 'Data export',
            trigger: 'Owner request',
            idempotencyKey: 'export_request_id',
            retryPolicy: 'backoff',
            maxAttempts: 3,
            userVisibleFailure: 'Marked failed',
            lifecycle: 'current',
          },
        ],
        deadLetterHandling: 'DLQ + alert',
      },
      scheduledJobs: {
        scheduler: 'Platform cron',
        jobs: [
          {
            id: 'sched-overdue',
            name: 'Overdue recalculation',
            schedule: '0 1 * * *',
            timezone: 'Asia/Kolkata',
            overlapPolicy: 'skip',
            failureAlerting: 'Warn after two failures',
            lifecycle: 'current',
          },
        ],
      },
      caching: { layers: [], keyConvention: '{boutique_id}:{layer}', tenantPrefixed: true },
      audit: {
        events: [
          {
            event: 'entity.mutated',
            entityTypes: ['order'],
            capturesFieldChanges: true,
            reasonRequired: false,
            lifecycle: 'current',
          },
        ],
        sink: 'Append-only audit table',
        immutabilityMechanism: 'No update/delete grant',
        retentionPeriod: '7 years',
        requiredFields: ['boutique_id'],
      },
      logging: {
        levels: ['error', 'info'],
        sink: 'Aggregator',
        format: 'structured-json',
        requiredContext: ['correlation_id'],
        prohibitedContent: ['Customer measurement values'],
        retentionPeriod: '30 days',
      },
      monitoring: { signals: [], alertRouting: 'on-call' },
    },
    deployment: {
      hostingModel: 'Managed platform',
      region: 'ap-south-1',
      environments: [],
      migrationStrategy: 'expand-migrate-contract',
      zeroDowntimeRequired: true,
      rollbackStrategy: 'automated',
      cicdGates: [],
      scalability: { envelope: [], statelessTier: true, horizontalScaling: 'autoscale' },
    },
    evolution: {
      entries: [
        {
          sourceRef: 'capabilities.cap-payments.bindings.pay-razorpay',
          capability: 'Payments',
          currentState: 'Manual entry',
          futureState: 'Razorpay',
          lifecycle: 'future',
          targetMvpSequence: 2,
          seamKind: 'interface',
          v1Cost: 'zero',
          v1CostJustification: 'Port required anyway.',
          invariants: ['No gateway SDK type outside the adapter'],
          migrationSketch: 'Add an implementation behind the existing port.',
        },
      ],
      deliberatelyUnprepared: [],
    },
    nonGoals: [],
    doNotBuild: [
      {
        id: 'dnb-razorpay',
        statement: 'No Razorpay SDK integration',
        origin: 'derived',
        sourceRef: 'capabilities.cap-payments.bindings.pay-razorpay',
        verifiable: 'grep for the razorpay package returns zero matches',
      },
    ],
    directives: [
      {
        id: 'TAS-PAY-01',
        appliesTo: ['backend'],
        kind: 'boundary',
        directive: 'All payment calls route through the PaymentProvider adapter',
        verifiable: 'No provider SDK type appears outside the adapter module',
        sourceSection: 'capabilities.cap-payments',
        mvpSequence: 1,
        severity: 'must',
      },
    ],
  });
}

describe('validateTechnicalArchitecture — backward compatibility', () => {
  it('treats an EMPTY_TAS as valid — "no TAS" is the permanent state of every pre-100B project', () => {
    const result = validateTechnicalArchitecture(EMPTY_TAS);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('treats a spec parsed from an empty object as valid for the same reason', () => {
    expect(validateTechnicalArchitecture(parseTechnicalArchitectureSpec({})).ok).toBe(true);
  });
});

describe('validateTechnicalArchitecture — the reference spec', () => {
  it('passes every implemented rule with no errors', () => {
    const result = validateTechnicalArchitecture(validTas());

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('validateTechnicalArchitecture — MVP protection rules', () => {
  it('V3: rejects two current bindings for one capability', () => {
    const tas = validTas();
    tas.capabilities[0].bindings[1].lifecycle = 'current';

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V3');
  });

  it('V5: rejects a future binding that nothing in doNotBuild covers', () => {
    const tas = validTas();
    tas.capabilities[0].bindings[1].doNotBuild = undefined;
    tas.doNotBuild = [];

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V5');
  });

  it('V6: rejects a future binding missing its seam declaration', () => {
    const tas = validTas();
    tas.capabilities[0].bindings[1].invariants = undefined;
    tas.capabilities[0].bindings[1].v1CostJustification = undefined;

    const rules = validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule);
    expect(rules.filter((rule) => rule === 'V6').length).toBeGreaterThanOrEqual(2);
  });

  it('V7: warns when a deferred binding declares invariants it is not owed', () => {
    const tas = validTas();
    tas.capabilities[0].bindings[1].lifecycle = 'deferred';
    tas.capabilities[0].bindings[1].invariants = ['something'];

    expect(validateTechnicalArchitecture(tas).warnings.map((finding) => finding.rule)).toContain('V7');
  });

  it('accepts a capability with ZERO current bindings — "declared but unbuilt" is legal', () => {
    const tas = validTas();
    tas.capabilities[0].bindings = tas.capabilities[0].bindings.filter((binding) => binding.lifecycle !== 'current');

    const rules = validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule);
    expect(rules).not.toContain('V3');
  });
});

describe('validateTechnicalArchitecture — configuration and secrets', () => {
  it('V8: rejects a secretRef that resolves to nothing', () => {
    const tas = validTas();
    tas.capabilities[0].secretRefs = ['sec-does-not-exist'];

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V8');
  });

  it('V10: rejects a client-scoped secret environment variable', () => {
    const tas = validTas();
    tas.configuration.environmentVariables[0].scope = 'client';

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V10');
  });

  it('V11: rejects a runtime-mutable setting with no screen', () => {
    const tas = validTas();
    tas.configuration.settings[0].screenRef = undefined;

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V11');
  });

  it('V12: rejects a config screen exposing an undeclared setting', () => {
    const tas = validTas();
    tas.configuration.screens[0].settingKeys = ['not.a.real.setting'];

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V12');
  });
});

describe('validateTechnicalArchitecture — tenancy and security', () => {
  it('V19: rejects a multi-tenant cache key convention with no tenant prefix', () => {
    const tas = validTas();
    tas.tenancy.cacheKeyConvention = '{entity}:{id}';

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V19');
  });

  it('V19: rejects a multi-tenant architecture with tenantPrefixed caching disabled', () => {
    const tas = validTas();
    tas.crossCutting.caching.tenantPrefixed = false;

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V19');
  });

  it('V19: does NOT apply the tenant-prefix rules to a single-tenant architecture', () => {
    const tas = validTas();
    tas.tenancy.model = 'single-tenant';
    tas.tenancy.cacheKeyConvention = '{entity}:{id}';
    tas.tenancy.storagePathConvention = '{bucket}/{id}';
    tas.crossCutting.caching.tenantPrefixed = false;

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).not.toContain('V19');
  });

  it('V20: rejects tenant identity sourced from the request', () => {
    const tas = validTas();
    tas.tenancy.identitySource = 'the boutiqueId request parameter';

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V20');
  });

  it('V21: warns when a multi-tenant architecture has only one enforcement layer', () => {
    const tas = validTas();
    tas.tenancy.enforcementLayers = [tas.tenancy.enforcementLayers[0]];

    expect(validateTechnicalArchitecture(tas).warnings.map((finding) => finding.rule)).toContain('V21');
  });
});

describe('validateTechnicalArchitecture — cross-cutting and directives', () => {
  it('V23: rejects a background job with no idempotency key', () => {
    const tas = validTas();
    tas.crossCutting.backgroundProcessing.jobs[0].idempotencyKey = '';

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V23');
  });

  it('V24: rejects a scheduled job with no timezone', () => {
    const tas = validTas();
    tas.crossCutting.scheduledJobs.jobs[0].timezone = '';

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V24');
  });

  it('V25: rejects a feature toggle with no removal condition', () => {
    const tas = validTas();
    tas.crossCutting.featureToggles.flags[0].removalCondition = '';

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V25');
  });

  it('V26: rejects logging with no prohibited content', () => {
    const tas = validTas();
    tas.crossCutting.logging.prohibitedContent = [];

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V26');
  });

  it('V28: rejects a directive with no verifiable', () => {
    const tas = validTas();
    tas.directives[0].verifiable = '';

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V28');
  });

  it('V29: rejects a directive citing a non-existent TAS section', () => {
    const tas = validTas();
    tas.directives[0].sourceSection = 'somewhereElse.thing';

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V29');
  });

  it('V30: warns about a decision that rejects no alternatives', () => {
    const tas = validTas();
    tas.decisions[0].alternativesRejected = [];

    expect(validateTechnicalArchitecture(tas).warnings.map((finding) => finding.rule)).toContain('V30');
  });

  it('V33: rejects a module dependency cycle', () => {
    const tas = validTas();
    tas.systemOverview.modules[0].dependsOn = ['orders'];

    expect(validateTechnicalArchitecture(tas).errors.map((finding) => finding.rule)).toContain('V33');
  });
});

describe('validateTechnicalArchitecture — never throws', () => {
  it('survives every parsed shape, including deeply empty ones', () => {
    for (const input of [undefined, null, {}, { capabilities: [{}] }, { directives: [{ directive: 'x' }] }]) {
      expect(() => validateTechnicalArchitecture(parseTechnicalArchitectureSpec(input))).not.toThrow();
    }
  });
});

describe('UNIMPLEMENTED_TAS_RULES', () => {
  it('documents exactly the Sprint 100A rules deferred past 100B', () => {
    expect([...UNIMPLEMENTED_TAS_RULES]).toEqual(['V2', 'V31', 'V35']);
  });
});
