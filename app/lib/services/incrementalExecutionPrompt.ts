import { IMPACT_SECTION_LABELS } from '~/lib/evolution/impactTypes';
import { REVIEW_STAGE_LABELS } from '~/lib/evolution/engineeringScopeTypes';
import type { IncrementalRoleExecutionContext } from '~/lib/evolution/incrementalExecutionTypes';

/**
 * Scoped Incremental Instruction Layer — Sprint 97, Part 8.
 *
 * EXISTING PROMPT BUILDERS ARE REUSED, NOT REPLACED. Each role's `buildXPrompt(buildXContext(project))`
 * still produces the system and user prompt exactly as the normal pipeline does. This module adds
 * ONE extra block, passed to `generateRoleWithRecovery` through the same `contextBlock` slot that
 * carries the BuildersDB project context in a full run — so an incremental run substitutes the
 * scoped block for the full one rather than adding a second prompt path.
 *
 * WHAT THE BLOCK HAS TO ACHIEVE, in Part 8's own terms: the role must understand that this is an
 * existing released product, that it must not redesign unrelated areas, that backward compatibility
 * matters, that only the approved scope may change, that assumptions must be named, that impact
 * found outside scope must be REPORTED rather than acted on, that file paths must not be invented,
 * and that unrelated artifacts must not be overwritten.
 *
 * NO SECRET EVER ENTERS THIS BLOCK. Every value comes from the plan, the impact analysis or the
 * release baseline: identifiers, paths, table names and environment variable NAMES. The baseline
 * itself never carries an environment variable's value (see `evolutionBaseline.ts`), so there is
 * nothing sensitive available to leak here even by accident.
 */

/** How a role must report impact it finds outside the approved scope. Parsed by `parseDiscoveredImpacts`. */
const DISCOVERED_IMPACT_PROTOCOL = `If you find impact OUTSIDE the approved scope, do NOT act on it and do NOT widen your output to cover it. Report it instead: add a top-level "discoveredImpact" array to your JSON response, where each entry is
{"description": string, "category": one of business|technical|ui|backend|database|security|infrastructure|testing|deployment|documentation, "affectedArtifact": string, "reasoning": string, "severity": one of low|medium|high|critical, "recommendedAction": one of expand_scope|return_to_impact_analysis|monitor_only|no_action_required, "scopeChangeRequired": boolean}.
Omit the array entirely when you find nothing outside scope. An operator decides what happens to anything you report; you must not assume it will be approved.`;

function bullets(items: string[]): string {
  return items.length === 0 ? '  (none)' : items.map((item) => `  - ${item}`).join('\n');
}

/**
 * The scoped block for one role. Deterministic: the same context always produces the same text,
 * which is what makes prompt scoping testable rather than merely intended.
 */
export function buildIncrementalInstructionLayer(context: IncrementalRoleExecutionContext): string {
  const sections: string[] = [];

  sections.push(`## INCREMENTAL CHANGE TO A RELEASED PRODUCT

You are ${context.label}, working on an application that is ALREADY BUILT, ALREADY RELEASED and ALREADY IN USE${
    context.baseline.releaseVersion ? ` (release ${context.baseline.releaseVersion})` : ''
  }. You are not designing a new product and you are not reviewing the whole of this one.

RULES FOR THIS RUN — all of them bind:
  1. Change ONLY what the approved scope below names. Everything else in the product stays exactly as released.
  2. Do NOT redesign, restructure or "improve" any area outside that scope, however tempting.
  3. Preserve backward compatibility for everything already released. If the change genuinely cannot be made compatibly, say so explicitly in your output instead of breaking it silently.
  4. Do NOT invent file paths, table names, routes, components or environment variables. Use only the identifiers listed below; they come from the released application's own manifest.
  5. Do NOT restate or overwrite the parts of the released design you were not asked to change.
  6. State your assumptions explicitly rather than resolving ambiguity silently.

CHANGE REQUEST
  ${context.changeRequestSummary}`);

  if (context.relevantInstructions.length > 0) {
    sections.push(`APPROVED PLAN INSTRUCTIONS FOR YOU\n${bullets(context.relevantInstructions)}`);
  }

  if (context.relevantImpactFindings.length > 0) {
    sections.push(
      `IMPACT FINDINGS RELEVANT TO YOUR ROLE\n${bullets(
        context.relevantImpactFindings.map(
          (finding) =>
            `${IMPACT_SECTION_LABELS[finding.section] ?? finding.section} (${finding.confidence} confidence): ${finding.detail}`,
        ),
      )}`,
    );
  }

  sections.push(`APPROVED SCOPE — the complete list of what you may change
Features:
${bullets(context.affectedFeatures)}
Files:
${bullets(context.affectedFiles)}
Routes:
${bullets(context.affectedRoutes)}
Database objects:
${bullets(context.affectedDatabaseObjects)}
API surfaces:
${bullets(context.affectedApis)}
Environment requirements (names only):
${bullets(context.affectedEnvironment)}`);

  sections.push(`RELEASE BASELINE
  - Release: ${context.baseline.releaseVersion ?? context.baseline.releaseId ?? '(unversioned)'}
  - Manifest version: ${context.baseline.manifestVersion ?? 'unknown'}
  - The released application contains ${context.baseline.totalReleasedFiles} generated file(s); you are being shown only the ${context.affectedFiles.length} in scope.`);

  const excluded = [
    ...context.excludedAreas,
    ...context.unaffectedAreas.map((entry) => `${entry.area}: ${entry.detail}`),
  ];

  sections.push(`EXPLICITLY OUT OF SCOPE — do not modify, redesign or comment on these\n${bullets(excluded)}`);

  if (context.constraints.length > 0) {
    sections.push(`CONSTRAINTS FOR YOUR ROLE\n${bullets(context.constraints)}`);
  }

  if (context.relevantReviews.length > 0) {
    sections.push(
      `REVIEW GATES THIS OUTPUT MUST PASS\n${bullets(
        context.relevantReviews.map((stage) => REVIEW_STAGE_LABELS[stage] ?? stage),
      )}`,
    );
  }

  sections.push(`NEWLY DISCOVERED IMPACT\n${DISCOVERED_IMPACT_PROTOCOL}`);

  if (context.usedFullContextFallback) {
    /* Part 7 — a full-context run is labelled in the prompt itself, not only in the audit record. */
    sections.push(
      `NOTE — FULL CONTEXT FALLBACK IS IN FORCE. An operator approved showing you the complete project context because the reduced scope was judged insufficient. The scope rules above still bind: wider context is not wider permission.`,
    );
  }

  return sections.join('\n\n');
}

/** A one-line summary of the reduction, for logs and the dashboard. Contains no prompt text. */
export function describeReduction(context: IncrementalRoleExecutionContext): string {
  return `${context.label}: ${context.affectedFiles.length}/${context.baseline.totalReleasedFiles} file(s), ${
    context.affectedFeatures.length
  } feature(s), ${context.upstreamArtifactTypes.length} upstream artifact(s)${
    context.usedFullContextFallback ? ' — FULL CONTEXT FALLBACK' : ''
  }`;
}
