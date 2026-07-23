import type { BusinessUnderstandingModelPatch } from '~/lib/builders-db/requirementsSessionDbTypes';
import type { BusinessUnderstandingModel } from '~/lib/projects/requirementsSession';
import type { ExtractedFact } from './types';

/**
 * Patch Generator — Sprint 57, Part 9.
 *
 * Generalizes Sprint 56's `buildInterviewPatch` (one dimension per call) to accept every
 * accepted fact from a single turn at once — architecture doc §4's "one answer can populate
 * multiple dimensions" now genuinely works, instead of Sprint 56's mock which could only ever
 * write the one dimension the question targeted. Only ever called with `contradictionDetector.ts`'s
 * `accepted` list — a fact that was flagged as a contradiction never reaches here, so this
 * function never needs its own conflict-resolution logic.
 *
 * Merge-not-replace semantics carried over exactly from Sprint 56: list-shaped dimensions APPEND
 * to the current model's existing values (never overwrite), singular dimensions REPLACE (already
 * guaranteed non-conflicting by `contradictionDetector.ts`), and `projectType` folds into
 * `businessIdentity.vision` as an addition — preserved verbatim from Sprint 56's rationale: the
 * deterministic Business Assessment Engine's keyword rules read `vision`/`functionalRequirements`
 * text, so a stated project type still steers classification even though there's no dedicated
 * model field for "raw project type statement" (`assessment.projectType` is *derived*, not
 * stored input).
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
}

export function generatePatch(
  model: BusinessUnderstandingModel,
  acceptedFacts: ExtractedFact[],
): BusinessUnderstandingModelPatch {
  const businessIdentity = asRecord(model.businessIdentity);
  const formSnapshot = asRecord(businessIdentity.formSnapshot);

  const targetUsers = [...model.targetUsers];
  const functionalRequirements = [...model.functionalRequirements];
  const currentSystems = [...model.currentSystems];
  const businessConstraints = [...model.businessConstraints];

  for (const fact of acceptedFacts) {
    switch (fact.dimension) {
      case 'businessVision':
        businessIdentity.vision = fact.value;
        break;
      case 'targetUsers':
        targetUsers.push(fact.value);
        break;
      case 'coreFeatures':
        functionalRequirements.push(fact.value);
        break;
      case 'industry':
        businessIdentity.industry = fact.value;
        break;
      case 'businessAssessment':
        businessIdentity.businessModel = fact.value;
        break;
      case 'projectType':
        businessIdentity.vision = businessIdentity.vision
          ? `${businessIdentity.vision as string} ${fact.value}`
          : fact.value;
        break;
      case 'businessConstraints':
        businessConstraints.push(fact.value);
        break;
      case 'currentSystems':
      case 'integrations':
        currentSystems.push(fact.value);
        break;
      case 'technicalPreferences':
        formSnapshot.technicalPreferences = fact.value;
        businessIdentity.formSnapshot = formSnapshot;
        break;
      default:
        break;
    }
  }

  return {
    businessIdentity,
    targetUsers,
    functionalRequirements,
    currentSystems,
    businessConstraints,
  };
}
