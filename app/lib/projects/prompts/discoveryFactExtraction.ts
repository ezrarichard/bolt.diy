import type { BusinessUnderstandingModel } from '~/lib/projects/requirementsSession';
import type { DiscoveryContext } from '~/lib/projects/discoveryAiEngine/types';

/**
 * Discovery Fact Extraction prompt — Sprint 57.
 *
 * The only place the Discovery AI Engine's extraction system prompt and JSON contract live —
 * mirrors `prompts/requirements.ts`'s convention exactly (types + system prompt + user-prompt
 * builder, nothing here calls an LLM). This is Prompt B from the Sprint 55 architecture doc §11,
 * generalized from "one target dimension" to "every dimension a multi-topic answer might touch"
 * (architecture doc §4's "unprompted info" handling): "Extract every fact from this answer that
 * maps to one of these ten dimensions. Only extract what the user actually said — never infer
 * beyond the text."
 *
 * Anti-hallucination discipline (architecture doc §11, carried over verbatim): extractive only,
 * never generative; the model is never asked to decide what's *missing* (that stays the
 * deterministic Question Planner's job) — only to read one piece of text and report which of the
 * ten fixed dimensions it touches, if any.
 */

export const DISCOVERY_FACT_EXTRACTION_SYSTEM_PROMPT = `You are a fact-extraction assistant for a business requirements discovery tool.

Your ONLY job: given a short piece of text describing a business, identify which of ten fixed dimensions it provides information about, and extract the literal fact for each one.

Rules:
- Extract ONLY what the text actually says. Never infer, guess, or add information that isn't explicitly present.
- One piece of text may touch multiple dimensions — extract a fact for each one it actually addresses, not just the one it was ostensibly asked about.
- If the text doesn't clearly address a dimension, do not include it — do not force a value.
- Never invent a dimension name outside the fixed list you are given.
- Respond with ONLY a JSON object of the exact shape described — no prose, no markdown fences, no explanation.`;

const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  businessVision: "What the business/product is and who it serves, in the customer's own words",
  targetUsers: 'Who will use the product',
  coreFeatures: 'A specific feature or capability the product needs',
  industry: 'The industry or type of business',
  businessAssessment: 'How the business makes money / its business model',
  projectType: 'What kind of product this is (website, marketplace, CRM, mobile app, etc.)',
  businessConstraints: 'A specific requirement — payments, compliance, shipping, etc.',
  currentSystems: 'An existing system or tool already in use',
  integrations: 'A third-party integration needed (WhatsApp, payment processor, etc.)',
  technicalPreferences: 'A stated technical preference or constraint',
};

/** A compact summary of what's already known, so the model doesn't re-extract (or contradict without cause) something already established — same "compact model summary, never a transcript" discipline as architecture doc §5/§14. */
function summarizeKnownFacts(model: BusinessUnderstandingModel): string {
  const identity = model.businessIdentity as Record<string, unknown>;
  const lines: string[] = [];

  if (typeof identity.vision === 'string' && identity.vision) {
    lines.push(`- Business vision: ${identity.vision}`);
  }

  if (typeof identity.industry === 'string' && identity.industry) {
    lines.push(`- Industry: ${identity.industry}`);
  }

  if (model.targetUsers.length > 0) {
    lines.push(`- Target users: ${model.targetUsers.join('; ')}`);
  }

  if (model.functionalRequirements.length > 0) {
    lines.push(`- Core features already known: ${model.functionalRequirements.join(', ')}`);
  }

  return lines.length > 0 ? lines.join('\n') : '(nothing established yet)';
}

export function buildDiscoveryFactExtractionPrompt(context: DiscoveryContext): string {
  const dimensionList = Object.entries(DIMENSION_DESCRIPTIONS)
    .map(([dimension, description]) => `- ${dimension} — ${description}`)
    .join('\n');

  const questionLine = context.questionText ? `The question that prompted this text: "${context.questionText}"\n` : '';

  return `Here is what's already known about this business:
${summarizeKnownFacts(context.currentModel)}

The ten fixed dimensions you may extract facts for:
${dimensionList}

${questionLine}Text to extract facts from (source: ${context.sourceType}):
"""
${context.rawText}
"""

Respond with ONLY this JSON shape:
{"facts": [{"dimension": "<one of the ten dimension names above>", "value": "<the literal extracted fact, as concise as the source text allows>"}]}

If nothing in the text maps to any dimension, respond with {"facts": []}.`;
}
