import type { ProjectKnowledge } from '~/lib/projects/knowledge';

/**
 * Shared prompt-formatting helpers — Sprint 14.
 *
 * Small, pure string formatters used by every `prompts/*.ts` file
 * (requirements.ts, architecture.ts, and future AI-role prompt files) so
 * "how do we describe a list" and "how do we describe Project Knowledge to
 * an AI role" are defined exactly once. Nothing here calls an LLM or
 * gathers data itself — these only format values they're given.
 */

export function formatList(items: string[] | undefined, fallback = 'None specified'): string {
  return items && items.length > 0 ? items.join(', ') : fallback;
}

export function formatProjectKnowledge(knowledge: ProjectKnowledge | undefined): string {
  if (!knowledge) {
    return 'Nothing captured yet.';
  }

  const lines = [
    knowledge.projectVision && `Vision: ${knowledge.projectVision}`,
    knowledge.industry && `Industry: ${knowledge.industry}`,
    knowledge.businessModel && `Business model: ${knowledge.businessModel}`,
    knowledge.targetUsers && `Target users: ${knowledge.targetUsers}`,
    knowledge.location && `Region: ${knowledge.location}`,
    knowledge.coreFeatures?.length && `Core features: ${formatList(knowledge.coreFeatures)}`,
    knowledge.pagesOrScreens?.length && `Pages/screens: ${formatList(knowledge.pagesOrScreens)}`,
    knowledge.userRoles?.length && `User roles: ${formatList(knowledge.userRoles)}`,
    knowledge.integrations?.length && `Integrations: ${formatList(knowledge.integrations)}`,
    knowledge.paymentNeeds?.length && `Payments: ${formatList(knowledge.paymentNeeds)}`,
    knowledge.complianceNeeds?.length && `Compliance: ${formatList(knowledge.complianceNeeds)}`,
    knowledge.shippingNeeds?.length && `Shipping: ${formatList(knowledge.shippingNeeds)}`,
    knowledge.languages?.length && `Languages: ${formatList(knowledge.languages)}`,
    knowledge.brandTone && `Brand tone: ${knowledge.brandTone}`,
    knowledge.technicalPreferences && `Technical preferences: ${knowledge.technicalPreferences}`,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : 'Nothing captured yet.';
}
