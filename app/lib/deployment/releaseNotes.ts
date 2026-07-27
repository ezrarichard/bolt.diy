import type { DeliveryPackage } from '~/lib/deployment/deliveryPackageTypes';
import type { ReleaseNoteEntry, ReleaseNotes } from '~/lib/deployment/releaseTypes';

/**
 * Release Notes — Sprint 94, Part 4.
 *
 * Generated entirely from the Sprint 93 Delivery Package, which has already done the grounded
 * collection work (feature inventory from the Feature registry, limitations from real artifacts,
 * verification summary from the live report). Re-collecting any of it here would create a second
 * source of truth for the same facts; instead this module is a pure PROJECTION of one package into
 * release-note shape.
 *
 * DOES NOT INVENT IMPROVEMENTS. There is no adjective, no "performance enhancements", no
 * "various fixes". Every line traces to a package entry and carries the artifact that produced it:
 *
 *   New Features       delivered features (`implemented`/`verified`) from the feature inventory
 *   Improvements       always empty — see `buildReleaseNotes`'s own comment
 *   Bug Fixes          always empty — see `buildReleaseNotes`'s own comment
 *   Infrastructure     the connected/configured capabilities the package recorded
 *   Known Limitations  the package's own limitations, minus the ones that are really issues
 *   Future Scope       `future` inventory entries (deferred MVP scope)
 *   Known Issues       limitations sourced from verification — something that failed or warned
 *
 * Pure, total, deterministic.
 */

function entry(id: string, title: string, source: string, detail?: string): ReleaseNoteEntry {
  return { id, title, detail, source };
}

export function buildReleaseNotes(pkg: DeliveryPackage, semanticVersion: string): ReleaseNotes {
  const inventory = pkg.featureInventory?.features ?? [];
  const limitations = pkg.knownLimitations ?? [];

  const newFeatures = inventory
    .filter((feature) => feature.state === 'implemented' || feature.state === 'verified')
    .map((feature) =>
      entry(
        `feature:${feature.code}`,
        feature.title,
        feature.source === 'feature_registry' ? 'Feature registry' : 'Application Manifest',
        feature.description,
      ),
    );

  const infrastructure = inventory
    .filter((feature) => feature.state === 'connected' || feature.state === 'configured')
    .map((feature) => entry(`infra:${feature.code}`, feature.title, 'Deployment providers', feature.description));

  const futureScope = inventory
    .filter((feature) => feature.state === 'future')
    .map((feature) => entry(`future:${feature.code}`, feature.title, 'Deferred MVP scope', feature.description));

  /*
   * A limitation sourced from verification describes something that FAILED or WARNED on the live
   * application — that is an issue, not a scope decision. Everything else is a genuine limitation.
   */
  const knownIssues = limitations
    .filter((limitation) => limitation.source === 'verification')
    .map((limitation) => entry(`issue:${limitation.id}`, limitation.title, 'Verification report', limitation.detail));

  const knownLimitations = limitations
    .filter((limitation) => limitation.source !== 'verification')
    .map((limitation) =>
      entry(
        `limitation:${limitation.id}`,
        limitation.title,
        `Delivery package (${limitation.source})`,
        limitation.detail,
      ),
    );

  /*
   * Improvements and Bug Fixes are structurally empty in this sprint, and that is the honest
   * answer rather than a gap: both require knowing what CHANGED since the previous release, which
   * needs a baseline comparison (Sprint 95's change management). Builders has no record of a fix —
   * nothing tracks defects — so any entry here would be invented. The categories are still emitted
   * so the notes' shape is stable across releases and a later sprint fills them in without
   * changing this model.
   */
  const categories: ReleaseNotes['categories'] = [
    { category: 'new_features', entries: newFeatures },
    { category: 'improvements', entries: [] },
    { category: 'bug_fixes', entries: [] },
    { category: 'infrastructure', entries: infrastructure },
    { category: 'known_limitations', entries: knownLimitations },
    { category: 'future_scope', entries: futureScope },
  ];

  return {
    summary: buildSummary(pkg, semanticVersion, newFeatures.length, knownIssues.length),
    categories,

    /* See `ReleaseNotes.breakingChanges` — derivable only against a previous baseline. */
    breakingChanges: [],
    knownIssues,
  };
}

/** Counts and states only — never an adjective about quality. */
function buildSummary(pkg: DeliveryPackage, semanticVersion: string, featureCount: number, issueCount: number): string {
  const name = pkg.projectInformation?.projectName ?? 'This application';
  const verification = pkg.verificationSummary;

  const verificationSentence = !verification?.verified
    ? 'The live application has not been verified.'
    : verification.status === 'passed'
      ? `Live verification passed (${verification.requiredPassed}/${verification.requiredTotal} required checks).`
      : verification.status === 'warning'
        ? `Live verification passed with ${verification.warnings} advisory item(s) (${verification.requiredPassed}/${verification.requiredTotal} required checks).`
        : `Live verification finished as "${verification.status}".`;

  const issueSentence = issueCount > 0 ? ` ${issueCount} known issue(s) are listed below.` : '';

  return `${name} ${semanticVersion} delivers ${featureCount} feature(s). ${verificationSentence}${issueSentence}`;
}

/** Total entry count across every category plus issues and breaking changes — what the dashboard shows without walking the structure. */
export function countReleaseNoteEntries(notes: ReleaseNotes): number {
  return (
    notes.categories.reduce((sum, group) => sum + group.entries.length, 0) +
    notes.knownIssues.length +
    notes.breakingChanges.length
  );
}
