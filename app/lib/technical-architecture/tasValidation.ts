/**
 * TAS validation — Sprint 100B.
 *
 * Implements the validation rules approved in Sprint 100A
 * (docs/architecture/TAS-Schema.md §9), which are the mechanical half of the
 * TAS review criteria: things a reviewer should never have to check by eye.
 *
 * DELIBERATELY SEPARATE FROM PARSING. `parseTechnicalArchitectureSpec` is
 * tolerant and never fails, so a malformed model response can never break the
 * narrative Architecture Draft's approval flow. This module answers the
 * different question — "is the parsed result actually complete and
 * self-consistent?" — and its answer is advisory in Sprint 100B: the panel shows
 * it, nothing blocks on it.
 *
 * NOTHING GATES ON THIS YET. Promoting errors to an approval gate is explicitly
 * out of scope here (Sprint 100B is additive only, and its brief forbids changing
 * the acceptance flow); see the Sprint 100B report's follow-up list.
 *
 * Rule ids below match docs/architecture/TAS-Schema.md §9 one-for-one, so a
 * finding can be traced straight back to the approved design. Rules that cannot
 * be checked without data this sprint does not wire up (V2/V31's `Mvp` and
 * Product Package id resolution, V35's diff against the previous version) are
 * listed as NOT-IMPLEMENTED at the bottom of this file rather than silently
 * omitted.
 */

import { SCREEN_REQUIRING_MUTABILITY, isEmptyTas, type TechnicalArchitectureSpecification } from './tasTypes';

export type TasFindingSeverity = 'error' | 'warning';

export interface TasFinding {
  /** Rule id from docs/architecture/TAS-Schema.md §9, e.g. 'V3'. */
  rule: string;
  severity: TasFindingSeverity;

  /** Human-readable, specific enough to act on without opening the schema doc. */
  message: string;

  /** Dotted path to the offending element, e.g. 'capabilities.payments'. */
  path?: string;
}

export interface TasValidationResult {
  /** True when there are no `error` findings. Warnings do not affect this. */
  ok: boolean;
  errors: TasFinding[];
  warnings: TasFinding[];
}

const TENANT_TOKENS = ['tenant', 'boutique', 'org', 'account', 'workspace', 'company'];

/** True when a key/path convention appears to include a per-tenant prefix (V19). */
function looksTenantPrefixed(convention: string): boolean {
  const lower = convention.toLowerCase();
  return TENANT_TOKENS.some((token) => lower.includes(token));
}

/** V20 — phrases that indicate tenant identity is taken from the request rather than the session. */
const REQUEST_SOURCED_IDENTITY = [
  'request parameter',
  'query param',
  'request body',
  'header',
  'url param',
  'path param',
];

/**
 * Validates a parsed TAS against the Sprint 100A rules.
 *
 * An EMPTY_TAS (legacy project, or a response with no `technicalArchitecture`
 * block at all) returns `ok: true` with no findings — "absent" is a valid,
 * expected state that backward compatibility depends on, not a validation
 * failure. Only a TAS with real content is held to the rules.
 */
export function validateTechnicalArchitecture(tas: TechnicalArchitectureSpecification): TasValidationResult {
  const findings: TasFinding[] = [];

  if (isEmptyTas(tas)) {
    return { ok: true, errors: [], warnings: [] };
  }

  const error = (rule: string, message: string, path?: string) =>
    findings.push({ rule, severity: 'error', message, path });
  const warn = (rule: string, message: string, path?: string) =>
    findings.push({ rule, severity: 'warning', message, path });

  // --- V1: schema version -------------------------------------------------
  if (tas.tasVersion !== '1.0') {
    error('V1', `Unsupported tasVersion "${tas.tasVersion}".`, 'tasVersion');
  }

  const secretIds = new Set(tas.configuration.secrets.map((secret) => secret.id));
  const settingKeys = new Set(tas.configuration.settings.map((setting) => setting.key));
  const screenIds = new Set(tas.configuration.screens.map((screen) => screen.id));
  const doNotBuildText = tas.doNotBuild.map((entry) => `${entry.statement} ${entry.sourceRef ?? ''}`.toLowerCase());

  // --- Capabilities: V3, V4, V5, V6, V7, V8, V16, V17, V18 ----------------
  for (const capability of tas.capabilities) {
    const path = `capabilities.${capability.id}`;
    const currentBindings = capability.bindings.filter((binding) => binding.lifecycle === 'current');

    if (currentBindings.length > 1) {
      error(
        'V3',
        `${capability.name} has ${currentBindings.length} bindings marked "current"; at most one is allowed.`,
        path,
      );
    }

    for (const binding of currentBindings) {
      if (
        /^(a|an|the)\s|gateway$|provider$|service$/i.test(binding.provider.trim()) &&
        binding.providerType !== 'none'
      ) {
        warn(
          'V4',
          `${capability.name}'s current binding "${binding.provider}" reads as a category, not a concrete provider.`,
          `${path}.${binding.id}`,
        );
      }
    }

    for (const binding of capability.bindings) {
      const bindingPath = `${path}.${binding.id}`;

      if (binding.lifecycle === 'current') {
        continue;
      }

      /*
       * V5 — every non-current binding must be covered by doNotBuild, either by carrying its own
       * `doNotBuild` list or by a top-level entry that points back at it.
       *
       * The binding's ID is matched as well as its provider name and SDK package because that is
       * what a top-level entry's `sourceRef` conventionally carries
       * ("capabilities.cap-payments.bindings.pay-wallet"). Matching only the provider name misses
       * the normal case where an entry's statement is written in the product's own words ("No
       * stored-value wallet ledger") rather than echoing the provider string verbatim — which is
       * how a human would naturally write it.
       */
      const bindingTokens = [binding.id, binding.provider, binding.sdkPackage]
        .filter((token): token is string => Boolean(token))
        .map((token) => token.toLowerCase());

      const covered =
        (binding.doNotBuild?.length ?? 0) > 0 ||
        doNotBuildText.some((text) => bindingTokens.some((token) => text.includes(token)));

      if (!covered) {
        error(
          'V5',
          `${capability.name}'s "${binding.provider}" binding is ${binding.lifecycle} but nothing in doNotBuild covers it.`,
          bindingPath,
        );
      }

      if (binding.lifecycle === 'future') {
        // V6 — a future binding owes a full seam declaration.
        if (binding.targetMvpSequence === undefined) {
          error('V6', `Future binding "${binding.provider}" has no targetMvpSequence.`, bindingPath);
        }

        if (!binding.v1Cost) {
          error('V6', `Future binding "${binding.provider}" has no v1Cost.`, bindingPath);
        }

        if (!binding.v1CostJustification?.trim()) {
          error('V6', `Future binding "${binding.provider}" has no v1CostJustification.`, bindingPath);
        }

        if (!binding.invariants || binding.invariants.length === 0) {
          error(
            'V6',
            `Future binding "${binding.provider}" declares no invariants — a future binding earns a seam, and the seam is the invariants.`,
            bindingPath,
          );
        }
      }

      // V7 — a deferred binding owes nothing, so invariants are a smell.
      if (binding.lifecycle === 'deferred' && (binding.invariants?.length ?? 0) > 0) {
        warn(
          'V7',
          `Deferred binding "${binding.provider}" declares invariants; deferred work owes no V1 seam.`,
          bindingPath,
        );
      }
    }

    // V8 — secret references resolve.
    for (const ref of capability.secretRefs) {
      if (!secretIds.has(ref)) {
        error(
          'V8',
          `${capability.name} references secret "${ref}", which is not declared in configuration.secrets.`,
          path,
        );
      }
    }

    // V16 — runtime-configurable capabilities need a connection test.
    if (capability.runtimeConfigurable && !capability.connectionTest) {
      error('V16', `${capability.name} is runtimeConfigurable but declares no connectionTest.`, path);
    }

    // V17 — fallback must be explicit (the parser guarantees an object; an empty kind is the real gap).
    if (!capability.fallback.kind) {
      error('V17', `${capability.name} declares no fallback; "none" is a valid answer but must be stated.`, path);
    }

    // V18 — secondary-provider fallback needs a second current binding.
    if (capability.fallback.kind === 'secondary-provider' && currentBindings.length < 2) {
      error(
        'V18',
        `${capability.name} declares a secondary-provider fallback but has ${currentBindings.length} current binding(s).`,
        path,
      );
    }

    // V15 — configScreenRequired is a derivation, not an opinion.
    if (capability.configScreenRequired && !capability.configScreenRef) {
      error('V15', `${capability.name} requires a config screen but references none.`, path);
    }

    if (capability.configScreenRef && !screenIds.has(capability.configScreenRef)) {
      error(
        'V15',
        `${capability.name} references config screen "${capability.configScreenRef}", which does not exist.`,
        path,
      );
    }
  }

  // --- Configuration: V9, V10, V11, V12, V13, V14 -------------------------
  for (const secret of tas.configuration.secrets) {
    if (secret.clientExposed !== false) {
      error('V9', `Secret "${secret.name}" is marked client-exposed.`, `configuration.secrets.${secret.id}`);
    }
  }

  for (const envVar of tas.configuration.environmentVariables) {
    const path = `configuration.environmentVariables.${envVar.name}`;

    if (envVar.isSecret && envVar.scope === 'client') {
      error('V10', `Environment variable "${envVar.name}" is a secret but has client scope.`, path);
    }

    if (envVar.isSecret && !tas.configuration.secrets.some((secret) => secret.name === envVar.name)) {
      error(
        'V10',
        `Environment variable "${envVar.name}" is a secret but is not declared in configuration.secrets.`,
        path,
      );
    }

    if (!envVar.hasSafeDefault && envVar.defaultValue) {
      warn('V14', `Environment variable "${envVar.name}" declares no safe default but supplies a defaultValue.`, path);
    }
  }

  for (const setting of tas.configuration.settings) {
    const path = `configuration.settings.${setting.key}`;

    // V11 — runtime-mutable settings need a screen.
    if (SCREEN_REQUIRING_MUTABILITY.includes(setting.mutability)) {
      if (!setting.screenRef) {
        error('V11', `Setting "${setting.key}" is ${setting.mutability} but references no screen.`, path);
      } else if (!screenIds.has(setting.screenRef)) {
        error('V11', `Setting "${setting.key}" references screen "${setting.screenRef}", which does not exist.`, path);
      }
    }

    // V13 — deployment-scoped settings map to an env var.
    if (setting.scope === 'deployment' && !setting.envVarRef) {
      error('V13', `Setting "${setting.key}" is deployment-scoped but references no environment variable.`, path);
    }
  }

  // V12 — screens must be backed by real settings.
  for (const screen of tas.configuration.screens) {
    const path = `configuration.screens.${screen.id}`;

    if (screen.settingKeys.length === 0) {
      error('V12', `Config screen "${screen.name}" exposes no settings.`, path);
      continue;
    }

    for (const key of screen.settingKeys) {
      if (!settingKeys.has(key)) {
        error('V12', `Config screen "${screen.name}" exposes "${key}", which is not a declared setting.`, path);
      }
    }
  }

  // --- Tenancy: V19, V20, V21, V22 ----------------------------------------
  const isMultiTenant = tas.tenancy.model !== 'single-tenant';

  if (isMultiTenant) {
    if (!tas.tenancy.scopeColumn) {
      error('V19', 'Multi-tenant model declares no scopeColumn.', 'tenancy.scopeColumn');
    }

    if (!looksTenantPrefixed(tas.tenancy.cacheKeyConvention)) {
      error(
        'V19',
        'Multi-tenant cacheKeyConvention does not appear to include a tenant prefix.',
        'tenancy.cacheKeyConvention',
      );
    }

    if (!looksTenantPrefixed(tas.tenancy.storagePathConvention)) {
      error(
        'V19',
        'Multi-tenant storagePathConvention does not appear to include a tenant prefix.',
        'tenancy.storagePathConvention',
      );
    }

    if (!tas.crossCutting.caching.tenantPrefixed) {
      error(
        'V19',
        'Multi-tenant architecture has crossCutting.caching.tenantPrefixed set to false.',
        'crossCutting.caching.tenantPrefixed',
      );
    }

    if (tas.tenancy.enforcementLayers.length < 2) {
      warn(
        'V21',
        `Multi-tenant architecture declares ${tas.tenancy.enforcementLayers.length} enforcement layer(s); defence in depth expects at least 2.`,
        'tenancy.enforcementLayers',
      );
    }
  }

  const identity = tas.tenancy.identitySource.toLowerCase();

  if (REQUEST_SOURCED_IDENTITY.some((phrase) => identity.includes(phrase))) {
    error(
      'V20',
      `Tenant identity is sourced from the request ("${tas.tenancy.identitySource}"); it must come from the authenticated session.`,
      'tenancy.identitySource',
    );
  }

  // V22 — a single enforcement point.
  const enforcementPoint = tas.security.authorization.enforcementPoint;

  if (!enforcementPoint.trim()) {
    error('V22', 'Authorization declares no enforcement point.', 'security.authorization.enforcementPoint');
  } else if (/\band\b|,|\+/.test(enforcementPoint)) {
    warn(
      'V22',
      `Authorization enforcementPoint "${enforcementPoint}" names more than one layer; it must name exactly one.`,
      'security.authorization.enforcementPoint',
    );
  }

  // --- Cross-cutting: V23, V24, V25, V26, V27 -----------------------------
  for (const job of tas.crossCutting.backgroundProcessing.jobs) {
    if (!job.idempotencyKey.trim()) {
      error(
        'V23',
        `Background job "${job.name}" declares no idempotency key.`,
        `crossCutting.backgroundProcessing.jobs.${job.id}`,
      );
    }
  }

  for (const job of tas.crossCutting.scheduledJobs.jobs) {
    if (!job.timezone.trim()) {
      error('V24', `Scheduled job "${job.name}" declares no timezone.`, `crossCutting.scheduledJobs.jobs.${job.id}`);
    }
  }

  for (const flag of tas.crossCutting.featureToggles.flags) {
    if (!flag.removalCondition.trim()) {
      error(
        'V25',
        `Feature toggle "${flag.key}" declares no removal condition.`,
        `crossCutting.featureToggles.flags.${flag.key}`,
      );
    }
  }

  if (tas.crossCutting.logging.prohibitedContent.length === 0) {
    error('V26', 'Logging declares no prohibited content.', 'crossCutting.logging.prohibitedContent');
  }

  if (tas.crossCutting.audit.events.length > 0 && !tas.crossCutting.audit.immutabilityMechanism.trim()) {
    error('V27', 'Audit declares events but no immutability mechanism.', 'crossCutting.audit.immutabilityMechanism');
  }

  // --- Directives & decisions: V28, V29, V30, V32, V33, V34 ---------------
  const sectionRoots = new Set([
    'systemOverview',
    'decisions',
    'capabilities',
    'runtime',
    'configuration',
    'security',
    'tenancy',
    'crossCutting',
    'deployment',
    'evolution',
    'nonGoals',
    'doNotBuild',
  ]);

  for (const directive of tas.directives) {
    const path = `directives.${directive.id}`;

    if (!directive.verifiable.trim()) {
      error('V28', `Directive "${directive.id}" has no verifiable; a directive that cannot be checked is prose.`, path);
    }

    const root = directive.sourceSection.split('.')[0];

    if (!sectionRoots.has(root)) {
      error(
        'V29',
        `Directive "${directive.id}" cites sourceSection "${directive.sourceSection}", which is not a TAS section.`,
        path,
      );
    }
  }

  const decisionIds = new Set(tas.decisions.map((decision) => decision.id));

  for (const decision of tas.decisions) {
    if (decision.alternativesRejected.length === 0) {
      warn(
        'V30',
        `Decision "${decision.id}" rejects no alternatives; a decision with no alternative was not a decision.`,
        `decisions.${decision.id}`,
      );
    }

    if (decision.supersededBy && !decisionIds.has(decision.supersededBy)) {
      warn(
        'V32',
        `Decision "${decision.id}" is superseded by "${decision.supersededBy}", which does not exist.`,
        `decisions.${decision.id}`,
      );
    }
  }

  for (const capability of tas.capabilities) {
    for (const ref of capability.decisionRefs) {
      if (!decisionIds.has(ref)) {
        warn(
          'V32',
          `${capability.name} cites decision "${ref}", which does not exist.`,
          `capabilities.${capability.id}`,
        );
      }
    }
  }

  // V33 — module dependency cycles.
  const moduleCycle = findModuleCycle(tas);

  if (moduleCycle) {
    error('V33', `Module dependency cycle: ${moduleCycle.join(' → ')}.`, 'systemOverview.modules');
  }

  // V34 — evolution entries point at real non-current elements.
  const nonCurrentRefs = new Set<string>();

  for (const capability of tas.capabilities) {
    for (const binding of capability.bindings) {
      if (binding.lifecycle !== 'current') {
        nonCurrentRefs.add(binding.provider.toLowerCase());
        nonCurrentRefs.add(binding.id.toLowerCase());
      }
    }
  }

  for (const level of tas.tenancy.levels) {
    if (level.lifecycle !== 'current') {
      nonCurrentRefs.add(level.name.toLowerCase());
    }
  }

  for (const entry of tas.evolution.entries) {
    const ref = entry.sourceRef.toLowerCase();
    const matches =
      nonCurrentRefs.size === 0 ||
      Array.from(nonCurrentRefs).some((known) => ref.includes(known) || known.includes(entry.capability.toLowerCase()));

    if (!matches) {
      warn(
        'V34',
        `Evolution entry "${entry.capability}" cites sourceRef "${entry.sourceRef}", which matches no non-current element.`,
        'evolution.entries',
      );
    }
  }

  return {
    ok: findings.every((finding) => finding.severity !== 'error'),
    errors: findings.filter((finding) => finding.severity === 'error'),
    warnings: findings.filter((finding) => finding.severity === 'warning'),
  };
}

/** Depth-first cycle search over `systemOverview.modules[].dependsOn` (V33). Returns the cycle path, or undefined. */
function findModuleCycle(tas: TechnicalArchitectureSpecification): string[] | undefined {
  const edges = new Map(tas.systemOverview.modules.map((module) => [module.id, module.dependsOn]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  let cycle: string[] | undefined;

  const walk = (id: string, trail: string[]) => {
    if (cycle || done.has(id)) {
      return;
    }

    if (visiting.has(id)) {
      cycle = [...trail.slice(trail.indexOf(id)), id];
      return;
    }

    visiting.add(id);

    for (const next of edges.get(id) ?? []) {
      if (edges.has(next)) {
        walk(next, [...trail, id]);
      }
    }

    visiting.delete(id);
    done.add(id);
  };

  for (const id of edges.keys()) {
    walk(id, []);
  }

  return cycle;
}

/**
 * Rules from docs/architecture/TAS-Schema.md §9 that are NOT implemented here,
 * and why — listed rather than silently dropped so Sprint 100C knows exactly what
 * is outstanding:
 *
 *   V2  — `mvpSequence` resolves to a real `Mvp` record. Needs the Mvp repository
 *         in the validator's inputs; Sprint 100B does not wire project data into
 *         validation, only the parsed artifact.
 *   V31 — `satisfies[]` ids resolve to Product Package rules. Package rule ids are a
 *         document convention today, not stable identifiers (Sprint 100A finding F4).
 *   V35 — `changeClass` consistency with the previous version's diff. Needs the prior
 *         artifact version; belongs with the invalidation work in Sprint 100C.
 */
export const UNIMPLEMENTED_TAS_RULES = ['V2', 'V31', 'V35'] as const;
