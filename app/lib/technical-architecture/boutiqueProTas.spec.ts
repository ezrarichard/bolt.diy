import { describe, expect, it } from 'vitest';
import { solutionArchitectEngine } from '~/lib/projects/solutionArchitectEngine';
import { ARTIFACT_TYPES, parseArtifactContent } from '~/lib/projects/artifacts';
import type { ArchitectureDraft } from '~/lib/projects/prompts/architecture';
import { parseTechnicalArchitectureSpec } from './tasTypes';
import { validateTechnicalArchitecture } from './tasValidation';

/**
 * Sprint 100B — BoutiquePro validation.
 *
 * The sprint brief names BoutiquePro as the validation project, so this file walks
 * the real thing end to end: ONE simulated LLM response containing both outputs →
 * parseDraft → the two paired artifacts → validation → retrieval. The TAS content
 * is the BoutiquePro V1 specification worked out in Sprint 100A
 * (docs/architecture/BoutiquePro-TAS-Validation.md), trimmed to the sections those
 * checks exercise.
 *
 * The checks below are exactly the brief's validation list:
 *   - narrative and TAS contain identical architectural intent
 *   - every mandatory TAS field exists
 *   - validation passes
 *   - versioning works
 *   - pairing works
 *   - retrieval works
 *   - no downstream role consumes the artifact
 */

const BOUTIQUEPRO_RESPONSE = JSON.stringify({
  architectureSummary:
    'Multi-tenant SaaS for boutique and tailoring shops in India. Stateless web tier serving an installable PWA, backed by a managed relational database using shared-schema row-scoped isolation keyed on boutique_id.',
  applicationModules: ['Customers', 'Measurements', 'Orders', 'Billing', 'Settings'],
  frontendArchitecture: 'Installable PWA, mobile-first, rendered from a stateless web tier.',
  backendArchitecture: 'Stateless API tier; tenant scope applied at the data-access layer.',
  databaseArchitecture: 'Managed relational database, shared schema, boutique_id on every tenant-owned entity.',
  authenticationStrategy: 'Phone number plus OTP; sessions revoked immediately on staff deactivation.',
  authorizationRoles: ['Owner', 'Reception', 'Master Tailor', 'Tailor'],
  integrations: ['Manual payment recording', 'WhatsApp deep link for sharing bills'],
  paymentArchitecture:
    'V1 records payments taken outside the system (cash, the shop UPI QR). No payment gateway is integrated; Razorpay is planned for a later MVP.',
  complianceArchitecture: 'Tax fields exist on the bill but stay dormant and hidden in V1; GST invoicing is deferred.',
  deploymentArchitecture: 'Managed platform in an India region, stateless and autoscaled.',
  securityConsiderations: ['Two independent tenant isolation layers', 'Measurements are sensitive personal data'],
  scalabilityPlan: 'Stateless tier autoscaled for festival peaks; shared-schema isolation suits the projected scale.',
  risks: ['Adoption — digitising paper cards'],
  openQuestions: ['Is GST invoicing required at V1?'],
  recommendedNextSteps: ['Database design for the measurement engine'],
  engineeringNotes: 'Index every tenant-owned table with boutique_id leading. Measurements are append-only.',

  technicalArchitecture: {
    tasVersion: '1.0',
    projectId: 'boutiquepro',
    projectName: 'BoutiquePro',
    mvpSequence: 1,
    changeClass: 'structural',

    systemOverview: {
      summary:
        'Multi-tenant SaaS for boutique and tailoring shops in India. Stateless web tier serving an installable PWA, backed by a managed relational database using shared-schema row-scoped isolation.',
      productType: 'vertical-saas',
      topology: 'stateless web tier + managed relational database + object storage',
      modules: [
        { id: 'customers', name: 'Customer Register', responsibility: 'Customer records', dependsOn: [] },
        {
          id: 'measurements',
          name: 'Measurement Engine',
          responsibility: 'Immutable measurement sets',
          dependsOn: ['customers'],
        },
        {
          id: 'orders',
          name: 'Orders & Timeline',
          responsibility: 'Orders, items, stages',
          dependsOn: ['customers', 'measurements'],
        },
        { id: 'billing', name: 'Billing', responsibility: 'Payments and bills', dependsOn: ['orders'] },
      ],
      systemBoundaries: ['Inventory and fabric stock are not modelled'],
    },

    decisions: [
      {
        id: 'ADR-001',
        title: 'Shared-schema row-scoped tenant isolation',
        decision:
          'One database, boutique_id on every tenant-owned entity, enforced at the data-access layer and the database.',
        rationale: 'Correct for the projected tenant count; database-per-tenant makes migrations a fleet operation.',
        alternativesRejected: [
          { option: 'Database per tenant', reason: 'Operationally expensive at projected scale' },
          { option: 'Schema per tenant', reason: 'Connection-pool and migration complexity' },
        ],
        satisfies: ['BR-T-2', 'NFR-SEC-1'],
      },
      {
        id: 'ADR-002',
        title: 'Measurements are append-only',
        decision: 'Measurement sets are immutable; corrections create a superseding version.',
        rationale: 'A silently edited measurement destroys fabric worth more than the stitching charge.',
        alternativesRejected: [
          { option: 'Mutable records with an audit trail', reason: 'The trail proves it after the fabric is cut' },
        ],
        satisfies: ['BR-M-1'],
      },
      {
        id: 'ADR-005',
        title: 'V1 sends no automated messages',
        decision: 'Customer communication is a manual WhatsApp deep-link share.',
        rationale:
          'Automated messaging needs a BSP account, template approval, consent management and per-message cost.',
        alternativesRejected: [
          {
            option: 'WhatsApp Business API at V1',
            reason: 'Infrastructure and consent burden disproportionate to V1 value',
          },
        ],
      },
    ],

    capabilities: [
      {
        id: 'cap-payments',
        kind: 'payment',
        name: 'Payment Recording',
        purpose: 'Record advances, part payments and final settlement.',
        port: 'PaymentProvider',
        portSurface: ['recordPayment', 'voidPayment', 'recordRefund'],
        bindings: [
          {
            id: 'pay-manual',
            provider: 'Manual entry (cash / UPI reference / card)',
            providerType: 'manual',
            lifecycle: 'current',
          },
          {
            id: 'pay-razorpay',
            provider: 'Razorpay',
            providerType: 'hosted-api',
            sdkPackage: 'razorpay',
            lifecycle: 'future',
            targetMvpSequence: 2,
            v1Cost: 'zero',
            v1CostJustification:
              'The PaymentProvider port and the Payment entity already exist in V1 for manual recording.',
            invariants: ['No call site outside the PaymentProvider adapter references a gateway SDK type'],
            doNotBuild: ['Razorpay SDK integration', 'Payment webhook endpoint'],
          },
          {
            id: 'pay-wallet',
            provider: 'Stored-value customer wallet',
            providerType: 'self-hosted',
            lifecycle: 'deferred',
          },
        ],
        runtimeConfigurable: false,
        configScreenRequired: false,
        secretRefs: [],
        fallback: { kind: 'none', description: 'Manual entry has no external dependency in V1.' },
        failureMode: 'blocking',
        decisionRefs: [],
      },
      {
        id: 'cap-customer-messaging',
        kind: 'notification',
        name: 'Customer Messaging',
        purpose: 'Send order status and bills to customers.',
        port: 'CustomerMessenger',
        portSurface: ['composeMessage', 'sendMessage'],
        bindings: [
          {
            id: 'msg-whatsapp-deeplink',
            provider: 'WhatsApp deep link (wa.me)',
            providerType: 'manual',
            lifecycle: 'current',
          },
          {
            id: 'msg-whatsapp-bsp',
            provider: 'WhatsApp Business API',
            providerType: 'hosted-api',
            lifecycle: 'future',
            targetMvpSequence: 2,
            v1Cost: 'low',
            v1CostJustification:
              'Consent cannot be backfilled — it must be captured at the moment it is given, so the consent record is owed in V1 even though nothing reads it.',
            invariants: [
              'Customer communication consent is recorded from V1',
              'No message is sent without an affirmative consent record',
            ],
            doNotBuild: ['BSP account integration', 'Automated send triggers', 'Delivery status webhook receiver'],
          },
        ],
        runtimeConfigurable: false,
        configScreenRequired: false,
        secretRefs: [],
        fallback: { kind: 'manual', description: 'The deep link IS the manual path; the bill stays printable.' },
        failureMode: 'degraded',
        decisionRefs: ['ADR-005'],
      },
      {
        id: 'cap-ai',
        kind: 'ai',
        name: 'AI Assistance',
        purpose: 'Measurement card OCR and anomaly detection, later.',
        port: 'AiProvider',
        portSurface: ['extractStructuredData', 'detectAnomaly'],
        bindings: [
          { id: 'ai-none', provider: 'None — AI disabled', providerType: 'none', lifecycle: 'current' },
          {
            id: 'ai-ocr',
            provider: 'Vision model for measurement card extraction',
            providerType: 'hosted-api',
            lifecycle: 'future',
            targetMvpSequence: 2,
            v1Cost: 'zero',
            v1CostJustification:
              'MeasurementSet.source and MeasurementValue.is_ai_derived are required by BR-M-11 in V1 regardless of whether any AI exists.',
            invariants: ['No measurement persists with is_ai_derived true and ai_confirmed_by null'],
            doNotBuild: [
              'Any AI provider client or SDK',
              'Image-to-text extraction pipeline',
              'Any AI configuration screen',
            ],
          },
          { id: 'ai-voice', provider: 'Voice measurement entry', providerType: 'hosted-api', lifecycle: 'deferred' },
        ],
        runtimeConfigurable: false,
        configScreenRequired: false,
        secretRefs: [],
        fallback: { kind: 'none', description: 'Nothing to fall back from — no AI runs in V1.' },
        failureMode: 'silent',
        decisionRefs: [],
      },
      {
        id: 'cap-tax',
        kind: 'external',
        name: 'Tax & Invoicing',
        purpose: 'GST-compliant invoicing for boutiques above the threshold.',
        port: 'TaxCalculator',
        portSurface: ['calculateTax', 'generateCompliantInvoice'],
        bindings: [
          { id: 'tax-none', provider: 'None — tax fields dormant', providerType: 'none', lifecycle: 'current' },
          {
            id: 'tax-gst',
            provider: 'GST calculation and e-invoice generation',
            providerType: 'hosted-api',
            lifecycle: 'future',
            targetMvpSequence: 2,
            v1Cost: 'low',
            v1CostJustification:
              'Seven nullable columns on the bill entity. Adding a tax dimension after bills exist requires backfilling attribution onto records never captured with it.',
            invariants: [
              'Bill line items are snapshotted at issue',
              'Tax fields are nullable and no code path assumes they are populated',
            ],
            doNotBuild: [
              'Any GST rate table or calculation',
              'Any tax field in the bill UI',
              'Any tax configuration screen',
            ],
          },
        ],
        runtimeConfigurable: false,
        configScreenRequired: false,
        secretRefs: [],
        fallback: { kind: 'none', description: 'No tax calculation in V1.' },
        failureMode: 'silent',
        decisionRefs: [],
      },
      {
        id: 'cap-storage',
        kind: 'storage',
        name: 'Object Storage',
        purpose: 'Logos and order reference images.',
        port: 'AssetStore',
        portSurface: ['put', 'getSignedUrl'],
        bindings: [
          {
            id: 'store-managed',
            provider: 'Managed object storage, India region',
            providerType: 'hosted-api',
            lifecycle: 'current',
          },
        ],
        runtimeConfigurable: false,
        configScreenRequired: false,
        secretRefs: ['sec-storage'],
        fallback: { kind: 'none', description: 'Upload failure surfaces to the user.' },
        failureMode: 'degraded',
        decisionRefs: [],
      },
    ],

    runtime: {
      target: 'Node.js 20 LTS',
      framework: 'Remix',
      language: 'TypeScript 5',
      buildOutput: 'server bundle + static client assets',
      bootSettings: ['DATABASE_URL', 'APP_REGION'],
    },

    configuration: {
      settings: [
        {
          key: 'boutique.timezone',
          description: 'Tenant timezone, drives every day-boundary query',
          scope: 'tenant',
          mutability: 'runtime-admin',
          valueType: 'string',
          defaultValue: 'Asia/Kolkata',
          screenRef: 'scr-boutique-profile',
          lifecycle: 'current',
        },
        {
          key: 'boutique.discountLimitPaise',
          description: 'Discount ceiling below which Reception needs no authorisation',
          scope: 'tenant',
          mutability: 'runtime-admin',
          valueType: 'number',
          defaultValue: '50000',
          screenRef: 'scr-billing-settings',
          lifecycle: 'current',
        },
        {
          key: 'LOG_LEVEL',
          description: 'Server log verbosity',
          scope: 'deployment',
          mutability: 'deploy-time',
          valueType: 'string',
          defaultValue: 'info',
          envVarRef: 'LOG_LEVEL',
          lifecycle: 'current',
        },
      ],
      environmentVariables: [
        {
          name: 'DATABASE_URL',
          description: 'Primary database connection string',
          owner: 'devops',
          scope: 'server',
          requiredAt: 'boot',
          hasSafeDefault: false,
          isSecret: true,
        },
        {
          name: 'STORAGE_ACCESS_KEY',
          description: 'Object storage credential',
          owner: 'devops',
          scope: 'server',
          requiredAt: 'first-use',
          hasSafeDefault: false,
          isSecret: true,
        },
        {
          name: 'LOG_LEVEL',
          description: 'Server log verbosity',
          owner: 'devops',
          scope: 'server',
          requiredAt: 'boot',
          hasSafeDefault: true,
          defaultValue: 'info',
          isSecret: false,
        },
      ],
      secrets: [
        {
          id: 'sec-db',
          name: 'DATABASE_URL',
          description: 'Primary database connection string',
          storage: 'platform-secret-store',
          clientExposed: false,
          rotationExpectation: 'on-compromise',
          scope: 'deployment',
        },
        {
          id: 'sec-storage',
          name: 'STORAGE_ACCESS_KEY',
          description: 'Object storage credential',
          capabilityRef: 'cap-storage',
          storage: 'platform-secret-store',
          clientExposed: false,
          rotationExpectation: 'periodic',
          scope: 'deployment',
        },
      ],
      screens: [
        {
          id: 'scr-boutique-profile',
          name: 'Boutique Profile',
          accessRole: 'owner',
          settingKeys: ['boutique.timezone'],
          hasConnectionTest: false,
          location: 'Settings > Boutique Profile',
        },
        {
          id: 'scr-billing-settings',
          name: 'Billing Settings',
          accessRole: 'owner',
          settingKeys: ['boutique.discountLimitPaise'],
          hasConnectionTest: false,
          location: 'Settings > Billing',
        },
      ],
    },

    security: {
      authentication: {
        method: 'Phone number plus OTP',
        identityField: 'phone',
        sessionMechanism: 'Signed session token',
        sessionExpiry: '12h idle, 30d absolute',
        revocation: 'Immediate on staff deactivation',
        credentialStorage: 'Hashed with a modern password-hashing algorithm',
        rateLimiting: 'Per identity and per IP with lockout',
      },
      authorization: {
        model: 'rbac',
        enforcementPoint: 'Server-side API middleware',
        roles: ['owner', 'reception', 'master_tailor', 'tailor'],
        permissionSource: 'Static role-permission map',
        serverSideEnforced: true,
      },
      boundaries: [
        {
          id: 'tb-public',
          name: 'Public bill share link',
          zone: 'public',
          entryPoints: ['GET /public/bills/{shareToken}'],
          doesNotTrust: ['The share token as proof of identity'],
          validation: 'High-entropy expiring token; exposes bill contents only',
        },
      ],
      publicSurfaces: [
        {
          id: 'ps-bill',
          description: 'Shared bill view',
          exposes: ['Bill line items and totals'],
          mustNotExpose: ['Measurements', 'Other orders', 'Customer contact details'],
          protection: 'High-entropy revocable token with expiry',
        },
      ],
    },

    tenancy: {
      model: 'shared-schema-row-scoped',
      scopeColumn: 'boutique_id',
      identitySource: 'authenticated session claim',
      enforcementLayers: [
        {
          layer: 'application',
          mechanism: 'Tenant scope applied in the data-access layer',
          guaranteeIfOthersFail: 'No application query can construct an unscoped read',
        },
        {
          layer: 'database',
          mechanism: 'Row-level security keyed on the session tenant claim',
          guaranteeIfOthersFail: 'Even a raw unscoped query returns zero foreign rows',
        },
      ],
      cacheKeyConvention: '{boutique_id}:{entity}:{id}',
      storagePathConvention: '{boutique_id}/{bucket}/{asset_id}.{ext}',
      levels: [
        { name: 'Single boutique', description: 'One boutique per tenant.', lifecycle: 'current' },
        {
          name: 'Multi-branch',
          description: 'A boutique operates several branches.',
          lifecycle: 'future',
          targetMvpSequence: 2,
          v1Cost: 'zero',
          v1CostJustification:
            'boutique_id non-null, indexed leading, session-derived is a V1 correctness requirement independently.',
          invariants: [
            'No query derives tenant scope from a request parameter',
            'No cache key omits the tenant prefix',
          ],
          dataShapeChange: 'Add nullable branch_id to Staff, Order and Stage',
          migrationSketch:
            'Existing rows keep null, resolving to the primary branch. The real cost is UI, not database.',
        },
        {
          name: 'Franchise network',
          description: 'A franchisor sees aggregated data across independently-owned boutiques.',
          lifecycle: 'deferred',
          migrationSketch: 'Requires a cross-tenant read path, which V1 isolation deliberately makes impossible.',
        },
      ],
      tenantStates: [
        { state: 'trial', access: 'full', description: 'Free trial' },
        { state: 'read_only', access: 'read-only', description: 'Grace expired; read and export only' },
      ],
    },

    crossCutting: {
      storage: {
        provider: 'Managed object storage, India region',
        buckets: [
          { name: 'boutique-logos', purpose: 'Logo for bills', publicRead: false, lifecycle: 'current' },
          { name: 'order-reference-images', purpose: 'Design references', publicRead: false, lifecycle: 'current' },
          {
            name: 'measurement-card-scans',
            purpose: 'Photo of the original paper card',
            publicRead: false,
            lifecycle: 'future',
            targetMvpSequence: 2,
            v1Cost: 'zero',
            v1CostJustification:
              'The Asset entity and its kind enum exist in V1; a bucket is a value, not a schema change.',
            invariants: ['Asset.storageKey is always tenant-prefixed'],
          },
        ],
        pathConvention: '{boutique_id}/{bucket}/{asset_id}.{ext}',
        accessModel: 'signed-url',
        maxFileSizeBytes: 10485760,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        virusScanning: true,
      },
      featureToggles: {
        evaluationPoint: 'Server-side settings resolver; the client receives resolved values',
        source: 'tenant-config',
        flags: [
          {
            key: 'feature.aiEnabled',
            description: 'Master AI switch',
            defaultState: false,
            scope: 'system',
            removalCondition: 'Removed when AI ships and is no longer optional',
            lifecycle: 'current',
          },
        ],
      },
      backgroundProcessing: {
        mechanism: 'Managed queue with dead-letter handling',
        jobs: [
          {
            id: 'job-export',
            name: 'Tenant data export',
            trigger: 'Owner requests an export',
            idempotencyKey: 'export_request_id',
            retryPolicy: 'Exponential backoff',
            maxAttempts: 3,
            userVisibleFailure: 'Export marked failed with a retry action',
            lifecycle: 'current',
          },
        ],
        deadLetterHandling: 'Failed jobs move to a dead-letter store and raise a monitoring alert',
      },
      scheduledJobs: {
        scheduler: 'Platform cron',
        jobs: [
          {
            id: 'sched-overdue',
            name: 'Overdue and aged-item recalculation',
            schedule: '0 1 * * *',
            timezone: 'Asia/Kolkata',
            overlapPolicy: 'skip',
            failureAlerting: 'Warning alert after two consecutive failures',
            lifecycle: 'current',
          },
        ],
      },
      caching: {
        layers: [
          {
            name: 'Dashboard aggregates',
            location: 'shared-store',
            cachedData: ['Outstanding balance', "Today's deliveries"],
            ttlSeconds: 60,
            invalidationTrigger: 'Order, item or payment mutation within the tenant',
            lifecycle: 'current',
          },
        ],
        keyConvention: '{boutique_id}:{layer}:{entity}:{id}',
        tenantPrefixed: true,
      },
      audit: {
        events: [
          {
            event: 'entity.mutated',
            entityTypes: ['customer', 'order', 'measurement_set', 'payment'],
            capturesFieldChanges: true,
            reasonRequired: false,
            lifecycle: 'current',
          },
          {
            event: 'payment.voided',
            entityTypes: ['payment'],
            capturesFieldChanges: true,
            reasonRequired: true,
            lifecycle: 'current',
          },
        ],
        sink: 'Append-only audit table in the primary database',
        immutabilityMechanism: 'No update or delete grant on the audit table for the application role',
        retentionPeriod: '7 years for financial events, 2 years otherwise',
        requiredFields: ['boutique_id', 'actor_staff_id', 'entity_type', 'action', 'occurred_at'],
      },
      logging: {
        levels: ['error', 'warn', 'info', 'debug'],
        sink: 'Platform log aggregation',
        format: 'structured-json',
        requiredContext: ['correlation_id', 'boutique_id', 'staff_id'],
        prohibitedContent: [
          'Customer measurement values',
          'Customer phone numbers, addresses, email addresses',
          'Payment reference numbers',
          'Session tokens or any secret value',
        ],
        retentionPeriod: '30 days',
      },
      monitoring: {
        signals: [
          {
            name: 'API error rate',
            type: 'error-rate',
            threshold: '>2% over 5 min',
            severity: 'critical',
            lifecycle: 'current',
          },
        ],
        alertRouting: 'On-call rotation',
        uptimeTarget: '99.5%',
      },
    },

    deployment: {
      hostingModel: 'Managed platform, stateless autoscaled web tier',
      region: 'ap-south-1 (Mumbai)',
      regionRationale: 'Data residency and latency — every user is in India',
      environments: [
        { name: 'staging', purpose: 'Pre-release verification', dataPolicy: 'synthetic' },
        { name: 'production', purpose: 'Live tenants', dataPolicy: 'production' },
      ],
      migrationStrategy: 'Expand-migrate-contract; backward-compatible only',
      zeroDowntimeRequired: true,
      rollbackStrategy: 'Automated rollback to the previous release',
      cicdGates: ['Unit tests', 'Cross-tenant isolation tests', 'Dependency scan'],
      scalability: {
        envelope: [
          { dimension: 'Tenants', expected: '200 at 12 months', designHeadroom: '2,000' },
          { dimension: 'Customers per tenant', expected: '300–5,000', designHeadroom: '50,000' },
        ],
        statelessTier: true,
        horizontalScaling: 'Autoscale on CPU and request concurrency',
        peakProfile: 'Festival season 4–6× baseline',
        reviewTrigger: 'Beyond 5,000 tenants, revisit the isolation model',
      },
    },

    evolution: {
      entries: [
        {
          sourceRef: 'capabilities.cap-payments.bindings.pay-razorpay',
          capability: 'Payments',
          currentState: 'Manual entry',
          futureState: 'Razorpay gateway',
          lifecycle: 'future',
          targetMvpSequence: 2,
          seamKind: 'interface',
          v1Cost: 'zero',
          v1CostJustification: 'The port and the Payment entity are V1 requirements independently.',
          invariants: ['No gateway SDK type outside the adapter'],
          migrationSketch: 'Add a second implementation behind the existing PaymentProvider port.',
        },
        {
          sourceRef: 'tenancy.levels.Franchise network',
          capability: 'Tenancy',
          currentState: 'Single boutique',
          futureState: 'Franchise network',
          lifecycle: 'deferred',
          seamKind: 'none',
          v1Cost: 'deferred',
          v1CostJustification:
            'A cross-tenant read seam would contradict the V1 isolation model, which is the product’s core safety property.',
          invariants: [],
          migrationSketch: 'A genuine re-architecture of the isolation boundary, not an extension of it.',
        },
      ],
      deliberatelyUnprepared: ['Cross-tenant read paths of any kind'],
    },

    nonGoals: [
      {
        id: 'ng-inventory',
        statement: 'The system will not track fabric inventory',
        reason: 'A separate problem domain; paper does not track it either',
      },
      {
        id: 'ng-offline',
        statement: 'The system will not support offline writes',
        reason: 'Conflict resolution on shared mutable orders is genuinely hard',
        revisitAtMvpSequence: 3,
      },
    ],

    doNotBuild: [
      {
        id: 'dnb-razorpay',
        statement: 'No Razorpay SDK integration or payment webhook endpoint',
        origin: 'derived',
        sourceRef: 'capabilities.cap-payments.bindings.pay-razorpay',
        verifiable: 'grep for the razorpay package outside node_modules returns zero matches',
      },
      {
        id: 'dnb-wallet',
        statement: 'No stored-value wallet ledger',
        origin: 'derived',
        sourceRef: 'capabilities.cap-payments.bindings.pay-wallet',
        verifiable: 'No wallet or stored-value entity exists in the schema',
      },
      {
        id: 'dnb-bsp',
        statement: 'No WhatsApp Business API client or automated send trigger',
        origin: 'derived',
        sourceRef: 'capabilities.cap-customer-messaging.bindings.msg-whatsapp-bsp',
        verifiable: 'No outbound message job or BSP client module exists',
      },
      {
        id: 'dnb-ai',
        statement: 'No AI provider client, extraction pipeline, or AI configuration screen',
        origin: 'derived',
        sourceRef: 'capabilities.cap-ai.bindings.ai-ocr',
        verifiable: 'No AI provider SDK appears in dependencies',
      },
      {
        id: 'dnb-ai-voice',
        statement: 'No voice capture or speech pipeline',
        origin: 'derived',
        sourceRef: 'capabilities.cap-ai.bindings.ai-voice',
        verifiable: 'No audio capture code exists',
      },
      {
        id: 'dnb-gst',
        statement: 'No GST rate table, calculation, tax UI, or tax configuration screen',
        origin: 'derived',
        sourceRef: 'capabilities.cap-tax.bindings.tax-gst',
        verifiable: 'Tax fields exist on the bill entity but no code reads or writes them',
      },
      {
        id: 'dnb-branch',
        statement: 'No branch entity, branch selector, or branch-scoped filter',
        origin: 'derived',
        sourceRef: 'tenancy.levels.Multi-branch',
        verifiable: 'No branch_id column or branch UI exists',
      },
      {
        id: 'dnb-franchise',
        statement: 'No cross-tenant read path of any kind',
        origin: 'derived',
        sourceRef: 'tenancy.levels.Franchise network',
        verifiable: 'Every query is tenant-scoped; the isolation test suite passes',
      },
      {
        id: 'dnb-card-scans',
        statement: 'No measurement card scan upload or OCR trigger',
        origin: 'derived',
        sourceRef: 'crossCutting.storage.buckets.measurement-card-scans',
        verifiable: 'No card-scan bucket is provisioned',
      },
    ],

    directives: [
      {
        id: 'TAS-PAY-01',
        appliesTo: ['backend', 'generator'],
        kind: 'boundary',
        directive: 'All payment recording routes through a single PaymentProvider adapter module',
        mustNot: 'Any payment gateway SDK type appears outside that module',
        verifiable: 'grep for a gateway package name outside the adapter path returns zero matches',
        sourceSection: 'capabilities.cap-payments',
        mvpSequence: 1,
        severity: 'must',
      },
      {
        id: 'TAS-MEAS-01',
        appliesTo: ['backend', 'database', 'generator'],
        kind: 'prohibition',
        directive: 'Measurement sets are created and read only',
        mustNot: 'Any update or delete path exists for a measurement set or value, at any layer including the API',
        verifiable:
          'No PATCH/PUT/DELETE route resolves to a measurement handler and no ORM update targets those entities',
        sourceSection: 'decisions.ADR-002',
        decisionRefs: ['ADR-002'],
        mvpSequence: 1,
        severity: 'must',
      },
      {
        id: 'TAS-TEN-01',
        appliesTo: ['backend', 'database', 'qa', 'generator'],
        kind: 'invariant',
        directive: 'Tenant scope is applied in the data-access layer and derived from the session',
        mustNot: 'Any query derives tenant scope from a request parameter, header, or body field',
        verifiable: 'A cross-tenant access test for every entity type returns an authorization error, never data',
        sourceSection: 'tenancy',
        decisionRefs: ['ADR-001'],
        mvpSequence: 1,
        severity: 'must',
      },
      {
        id: 'TAS-LOG-01',
        appliesTo: ['backend', 'generator'],
        kind: 'prohibition',
        directive: 'Measurement values and customer contact details never reach a log line',
        mustNot: 'Request bodies for measurement or customer endpoints are logged',
        verifiable: 'Log output for a measurement write contains no measurement value or phone number',
        sourceSection: 'crossCutting.logging',
        mvpSequence: 1,
        severity: 'must',
      },
    ],
  },
});

describe('BoutiquePro — Sprint 100B end-to-end validation', () => {
  const parsed = solutionArchitectEngine.parseDraft(BOUTIQUEPRO_RESPONSE);

  if (!parsed.ok) {
    throw new Error('The BoutiquePro fixture must parse');
  }

  const narrativeArtifact = solutionArchitectEngine.createDraftArtifact(parsed.draft, 1);
  const tasArtifact = solutionArchitectEngine.createTechnicalArchitectureArtifact(parsed.draft, 1);
  const narrative = parseArtifactContent<ArchitectureDraft>(narrativeArtifact.content)!;
  const tas = parseTechnicalArchitectureSpec(parseArtifactContent<unknown>(tasArtifact.content));

  it('produces both artifacts from ONE response', () => {
    expect(narrativeArtifact.type).toBe(ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
    expect(tasArtifact.type).toBe(ARTIFACT_TYPES.TECHNICAL_ARCHITECTURE_SPEC);
  });

  it('pairs the two artifacts at the same version', () => {
    expect(tasArtifact.version).toBe(narrativeArtifact.version);

    for (const version of [2, 5]) {
      expect(solutionArchitectEngine.createTechnicalArchitectureArtifact(parsed.draft, version).version).toBe(
        solutionArchitectEngine.createDraftArtifact(parsed.draft, version).version,
      );
    }
  });

  it('passes TAS validation with no errors', () => {
    const result = validateTechnicalArchitecture(tas);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('populates every mandatory TAS section', () => {
    expect(tas.systemOverview.summary).not.toBe('');
    expect(tas.systemOverview.modules.length).toBeGreaterThan(0);
    expect(tas.decisions.length).toBeGreaterThan(0);
    expect(tas.capabilities.length).toBeGreaterThan(0);
    expect(tas.runtime.target).not.toBe('');
    expect(tas.configuration.secrets.length).toBeGreaterThan(0);
    expect(tas.configuration.screens.length).toBeGreaterThan(0);
    expect(tas.security.authorization.enforcementPoint).not.toBe('');
    expect(tas.tenancy.scopeColumn).toBe('boutique_id');
    expect(tas.crossCutting.logging.prohibitedContent.length).toBeGreaterThan(0);
    expect(tas.deployment.region).not.toBe('');
    expect(tas.evolution.entries.length).toBeGreaterThan(0);
    expect(tas.nonGoals.length).toBeGreaterThan(0);
    expect(tas.doNotBuild.length).toBeGreaterThan(0);
    expect(tas.directives.length).toBeGreaterThan(0);
  });

  describe('narrative and TAS carry identical architectural intent', () => {
    it('payments: narrative says manual, TAS binds manual as current and Razorpay as future', () => {
      const payments = tas.capabilities.find((capability) => capability.kind === 'payment')!;
      const current = payments.bindings.find((binding) => binding.lifecycle === 'current')!;

      expect(current.providerType).toBe('manual');
      expect(narrative.paymentArchitecture?.toLowerCase()).toContain('no payment gateway');
      expect(payments.bindings.find((binding) => binding.provider === 'Razorpay')?.lifecycle).toBe('future');
    });

    it('tenancy: narrative says row-scoped by boutique_id, TAS binds shared-schema-row-scoped', () => {
      expect(tas.tenancy.model).toBe('shared-schema-row-scoped');
      expect(narrative.databaseArchitecture?.toLowerCase()).toContain('boutique_id');
      expect(narrative.architectureSummary?.toLowerCase()).toContain('row-scoped');
    });

    it('tax: narrative says dormant, TAS binds no tax provider as current', () => {
      const tax = tas.capabilities.find((capability) => capability.id === 'cap-tax')!;

      expect(tax.bindings.find((binding) => binding.lifecycle === 'current')?.providerType).toBe('none');
      expect(narrative.complianceArchitecture?.toLowerCase()).toContain('dormant');
    });

    it('authorization roles match the narrative role list', () => {
      expect(tas.security.authorization.roles).toHaveLength(narrative.authorizationRoles!.length);
    });
  });

  describe('MVP scope protection', () => {
    it('AI is declared with a current binding of "none" — declared, nothing built', () => {
      const ai = tas.capabilities.find((capability) => capability.kind === 'ai')!;

      expect(ai.bindings.find((binding) => binding.lifecycle === 'current')?.providerType).toBe('none');
      expect(ai.bindings.filter((binding) => binding.lifecycle === 'future')).toHaveLength(1);
      expect(ai.bindings.filter((binding) => binding.lifecycle === 'deferred')).toHaveLength(1);
    });

    it('multi-branch is future with a zero-cost seam; franchise is deferred with none', () => {
      const branch = tas.tenancy.levels.find((level) => level.name === 'Multi-branch')!;
      const franchise = tas.tenancy.levels.find((level) => level.name === 'Franchise network')!;

      expect(branch.lifecycle).toBe('future');
      expect(branch.v1Cost).toBe('zero');
      expect(branch.invariants?.length).toBeGreaterThan(0);

      expect(franchise.lifecycle).toBe('deferred');
      expect(franchise.invariants ?? []).toEqual([]);
    });

    it('WhatsApp automation is future with a justified low V1 cost — consent cannot be backfilled', () => {
      const messaging = tas.capabilities.find((capability) => capability.kind === 'notification')!;
      const bsp = messaging.bindings.find((binding) => binding.lifecycle === 'future')!;

      expect(bsp.v1Cost).toBe('low');
      expect(bsp.v1CostJustification).toContain('backfilled');
    });

    it('every non-current binding is covered by a doNotBuild entry', () => {
      const nonCurrent = tas.capabilities.flatMap((capability) =>
        capability.bindings.filter((binding) => binding.lifecycle !== 'current'),
      );

      expect(nonCurrent.length).toBeGreaterThan(0);
      expect(validateTechnicalArchitecture(tas).errors.filter((finding) => finding.rule === 'V5')).toEqual([]);
    });

    it('every doNotBuild entry carries a mechanical check', () => {
      for (const entry of tas.doNotBuild) {
        expect(entry.verifiable.trim()).not.toBe('');
      }
    });
  });

  describe('secrets and configuration', () => {
    it('declares exactly the V1 secret inventory, none client-exposed', () => {
      expect(tas.configuration.secrets.map((secret) => secret.name)).toEqual(['DATABASE_URL', 'STORAGE_ACCESS_KEY']);
      expect(tas.configuration.secrets.every((secret) => secret.clientExposed === false)).toBe(true);
    });

    it('derives a screen for every runtime-mutable setting and nothing else', () => {
      const runtimeMutable = tas.configuration.settings.filter((setting) =>
        ['runtime-admin', 'runtime-user'].includes(setting.mutability),
      );

      expect(runtimeMutable.every((setting) => Boolean(setting.screenRef))).toBe(true);
      expect(
        tas.configuration.settings
          .filter((setting) => setting.mutability === 'deploy-time')
          .every((setting) => !setting.screenRef),
      ).toBe(true);
    });
  });

  describe('retrieval', () => {
    it('is retrievable once approved, and absent for a legacy project', () => {
      const withTas = {
        id: 'p1',
        artifacts: [
          { ...narrativeArtifact, status: 'approved' },
          { ...tasArtifact, status: 'approved' },
        ],
      } as never;

      const legacy = { id: 'p2', artifacts: [{ ...narrativeArtifact, status: 'approved' }] } as never;

      expect(solutionArchitectEngine.getApprovedTechnicalArchitecture(withTas)?.tenancy.scopeColumn).toBe(
        'boutique_id',
      );
      expect(solutionArchitectEngine.getApprovedTechnicalArchitecture(legacy)).toBeUndefined();
    });
  });
});
