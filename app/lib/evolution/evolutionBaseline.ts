import type { ApplicationManifestFile } from '~/lib/application-manifest/manifestTypes';
import type { DeliveryPackage } from '~/lib/deployment/deliveryPackageTypes';
import type { ReleaseBaseline } from '~/lib/deployment/releaseTypes';

/**
 * Product Baseline Snapshot & Diff Engine — Sprint 95, Part 7.
 *
 * THE BASELINE IS THE RELEASE, NEVER THE LATEST DEPLOYMENT. That is the whole point of Sprint 94's
 * `ReleaseBaseline`: a Deployment keeps moving (a redeploy, a re-verification, a regenerated
 * package), while a Release is frozen. Every function here takes a `ReleaseBaseline` plus the
 * artifacts it references, and nothing in this module ever reads "current" state.
 *
 * Two responsibilities:
 *
 *  1. `buildBaselineSnapshot` — assembles the released product's own identifiers into one flat,
 *     comparable shape. It COPIES NOTHING that isn't already in the referenced artifacts; it just
 *     puts feature codes, route paths, file paths, table names, environment variable names and
 *     service names side by side so they can be matched and diffed.
 *  2. `diffBaselineSnapshots` — a reusable, pure diff between two snapshots.
 *
 * PREPARED, NOT CONSUMED (Part 7's explicit instruction): nothing in this sprint calls
 * `diffBaselineSnapshots` in a production path — a change request is a description of intended
 * change, not a second built product, so there is no second snapshot to diff against yet. Sprint 96
 * will build a candidate snapshot from a re-planned manifest and diff it against the release. The
 * engine exists and is tested now so that sprint adds a caller, not an engine.
 */

/** One identifiable thing in the released product, in the form impact analysis matches against. */
export interface BaselineFeature {
  code: string;
  title: string;
  state: string;
  moduleSlug?: string;
}

export interface BaselineRoute {
  path: string;
  name: string;
}

export interface BaselineFile {
  path: string;
  category: string;
  componentName?: string;
  displayName?: string;

  /** Which features this file was generated under — the Manifest's own per-file ownership. */
  featureIds: string[];
}

/** The released product, flattened for comparison. Every entry traces to a released artifact. */
export interface ProductBaselineSnapshot {
  releaseId?: string;
  semanticVersion?: string;
  capturedAt: string;

  manifestVersion?: number;
  manifestPlanChecksum?: string;

  features: BaselineFeature[];
  routes: BaselineRoute[];
  files: BaselineFile[];

  /** Table names read from the generated schema SQL — see `extractTableNames`. */
  databaseTables: string[];

  /** Environment variable NAMES only. Never a value; nothing upstream carries one. */
  environmentVariables: string[];
  requiredServices: string[];

  /** Backend API adapter paths from the Manifest's own file plan, never inferred from a route name. */
  apiSurfaces: string[];
  documentationSections: string[];

  repositoryFullName?: string;
  deploymentUrl?: string;
  supabaseProjectRef?: string;
  schemaVersion?: number;
  blueprintId?: string;
  mvpCode?: string;
}

/**
 * Reads `create table` names out of generated schema SQL. Deliberately a narrow, documented regex
 * over SQL Builders itself generated (see `databaseActivationTypes.ts`'s `schema.schemaSql`) rather
 * than a general SQL parser — it only has to understand the one shape this platform emits, and a
 * name it cannot read is simply absent rather than guessed at.
 */
export function extractTableNames(schemaSql: string | undefined): string[] {
  if (!schemaSql) {
    return [];
  }

  const names = new Set<string>();

  for (const match of schemaSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-zA-Z_][\w$]*)["`]?/gi)) {
    names.add(match[1].toLowerCase());
  }

  return [...names].sort();
}

export interface BuildBaselineSnapshotInput {
  /** Sprint 94's frozen release references — the ONLY acceptable baseline. */
  releaseBaseline: ReleaseBaseline;
  releaseId?: string;
  semanticVersion?: string;

  /** The delivery package the release attests to (`releaseBaseline.deliveryPackageId`). */
  deliveryPackage: DeliveryPackage | null;

  /** The manifest file rows for `releaseBaseline.manifestId`. */
  manifestFiles: ApplicationManifestFile[];

  /** The generated schema SQL current at release time. */
  schemaSql?: string;
  capturedAt: string;
}

export function buildBaselineSnapshot(input: BuildBaselineSnapshotInput): ProductBaselineSnapshot {
  const { releaseBaseline, deliveryPackage } = input;
  const application = deliveryPackage?.applicationSummary;

  /*
   * Only DELIVERED items become part of the baseline. A `future`/`optional` inventory entry
   * describes something that was explicitly not built, so matching a request against it would
   * report impact on something that does not exist.
   */
  const features = (deliveryPackage?.featureInventory?.features ?? [])
    .filter((feature) => feature.state !== 'future')
    .map((feature) => ({ code: feature.code, title: feature.title, state: feature.state }));

  const files = input.manifestFiles.map((file) => ({
    path: file.path,
    category: file.category,
    componentName: file.componentName,
    displayName: file.displayName,
    featureIds: file.featureIds ?? [],
  }));

  return {
    releaseId: input.releaseId,
    semanticVersion: input.semanticVersion,
    capturedAt: input.capturedAt,
    manifestVersion: releaseBaseline.manifestVersion,
    manifestPlanChecksum: releaseBaseline.manifestPlanChecksum,
    features,
    routes: (application?.routes ?? []).map((route) => ({ path: route.path, name: route.name })),
    files,
    databaseTables: extractTableNames(input.schemaSql),
    environmentVariables: (deliveryPackage?.environmentSummary?.variables ?? []).map((variable) => variable.name),
    requiredServices: application?.requiredServices ?? [],
    apiSurfaces: files.filter((file) => file.path.startsWith('api/')).map((file) => file.path),
    documentationSections: (deliveryPackage?.documentation?.sections ?? []).map((section) => section.label),
    repositoryFullName: releaseBaseline.repositoryFullName,
    deploymentUrl: releaseBaseline.deploymentUrl,
    supabaseProjectRef: releaseBaseline.supabaseProjectRef,
    schemaVersion: releaseBaseline.schemaVersion,
    blueprintId: releaseBaseline.blueprintId,
    mvpCode: releaseBaseline.mvpCode,
  };
}

// ── Diff engine (prepared for Sprint 96) ────────────────────────────────────

export interface BaselineDiffSet<T> {
  added: T[];
  removed: T[];

  /** Present in both, but with at least one differing field. Empty for collections keyed by identity alone. */
  changed: Array<{ before: T; after: T }>;
  unchanged: T[];
}

export interface BaselineDiff {
  features: BaselineDiffSet<BaselineFeature>;
  routes: BaselineDiffSet<BaselineRoute>;
  files: BaselineDiffSet<BaselineFile>;
  databaseTables: BaselineDiffSet<string>;
  environmentVariables: BaselineDiffSet<string>;
  requiredServices: BaselineDiffSet<string>;

  /** True when the manifest plan checksum moved — the strongest single signal that the file plan changed. */
  manifestChanged: boolean;
  hasChanges: boolean;
}

function diffCollection<T>(
  previous: T[],
  next: T[],
  key: (item: T) => string,
  equal: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b),
): BaselineDiffSet<T> {
  const previousByKey = new Map(previous.map((item) => [key(item), item]));
  const nextByKey = new Map(next.map((item) => [key(item), item]));

  const added = next.filter((item) => !previousByKey.has(key(item)));
  const removed = previous.filter((item) => !nextByKey.has(key(item)));
  const changed: BaselineDiffSet<T>['changed'] = [];
  const unchanged: T[] = [];

  for (const item of previous) {
    const counterpart = nextByKey.get(key(item));

    if (!counterpart) {
      continue;
    }

    if (equal(item, counterpart)) {
      unchanged.push(item);
    } else {
      changed.push({ before: item, after: counterpart });
    }
  }

  return { added, removed, changed, unchanged };
}

/** Pure, total, and reusable. Nothing in Sprint 95 calls this in a production path — see this file's header. */
export function diffBaselineSnapshots(previous: ProductBaselineSnapshot, next: ProductBaselineSnapshot): BaselineDiff {
  const features = diffCollection(previous.features, next.features, (feature) => feature.code);
  const routes = diffCollection(previous.routes, next.routes, (route) => route.path);
  const files = diffCollection(previous.files, next.files, (file) => file.path);
  const databaseTables = diffCollection(previous.databaseTables, next.databaseTables, (table) => table);
  const environmentVariables = diffCollection(
    previous.environmentVariables,
    next.environmentVariables,
    (variable) => variable,
  );
  const requiredServices = diffCollection(previous.requiredServices, next.requiredServices, (service) => service);

  const manifestChanged =
    previous.manifestPlanChecksum !== undefined &&
    next.manifestPlanChecksum !== undefined &&
    previous.manifestPlanChecksum !== next.manifestPlanChecksum;

  const sets = [features, routes, files, databaseTables, environmentVariables, requiredServices];
  const hasChanges =
    manifestChanged || sets.some((set) => set.added.length > 0 || set.removed.length > 0 || set.changed.length > 0);

  return {
    features,
    routes,
    files,
    databaseTables,
    environmentVariables,
    requiredServices,
    manifestChanged,
    hasChanges,
  };
}
