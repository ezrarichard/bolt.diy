import { formatJsonShapeField, formatList } from './shared';
import type { ProductReviewContext } from '~/lib/projects/productReviewEngine';

/**
 * Business Analyst Product Review prompt — Sprint 82.
 *
 * Following `prompts/requirements.ts`'s exact pattern (types + field list + system prompt +
 * user-prompt builder, nothing else) for the Business Analyst's post-release workflow: analysing
 * an ALREADY-RELEASED MVP using customer feedback, support tickets, feature requests, bug
 * reports, usage analytics, and business goals — never deciding what ships next (that is the
 * Product Owner's Roadmap Review, Sprint 83, not this file).
 */

export interface BusinessAnalystProductReviewOutput {
  executiveSummary?: string;
  businessSuccesses?: string[];
  customerPainPoints?: string[];
  requestedImprovements?: string[];
  missingFeatures?: string[];
  businessRisks?: string[];
  technicalRisks?: string[];
  complianceObservations?: string[];
  uxObservations?: string[];
  performanceObservations?: string[];
  recommendedPriorities?: string[];
  potentialFutureMvpScope?: string[];
}

export interface ProductReviewOutputFieldConfig {
  key: keyof BusinessAnalystProductReviewOutput;
  label: string;
  kind: 'text' | 'list';
}

/**
 * Single source of truth for the output's shape — drives the JSON contract described to the AI
 * below and `productReviewEngine.parseAnalysis`'s field-by-field extraction. Add a field here
 * once and every consumer picks it up automatically (same discipline `REQUIREMENTS_DRAFT_FIELDS`
 * established).
 */
export const PRODUCT_REVIEW_OUTPUT_FIELDS: ProductReviewOutputFieldConfig[] = [
  { key: 'executiveSummary', label: 'Executive Summary', kind: 'text' },
  { key: 'businessSuccesses', label: 'Business Successes', kind: 'list' },
  { key: 'customerPainPoints', label: 'Customer Pain Points', kind: 'list' },
  { key: 'requestedImprovements', label: 'Requested Improvements', kind: 'list' },
  { key: 'missingFeatures', label: 'Missing Features', kind: 'list' },
  { key: 'businessRisks', label: 'Business Risks', kind: 'list' },
  { key: 'technicalRisks', label: 'Technical Risks', kind: 'list' },
  { key: 'complianceObservations', label: 'Compliance Observations', kind: 'list' },
  { key: 'uxObservations', label: 'UX Observations', kind: 'list' },
  { key: 'performanceObservations', label: 'Performance Observations', kind: 'list' },
  { key: 'recommendedPriorities', label: 'Recommended Priorities', kind: 'list' },
  { key: 'potentialFutureMvpScope', label: 'Potential Future MVP Scope', kind: 'list' },
];

export const BUSINESS_ANALYST_PRODUCT_REVIEW_SYSTEM_PROMPT = `You are a Senior Business Analyst working inside Builders, an AI engineering platform, conducting a Product Review of an ALREADY-RELEASED MVP.

Your ONLY responsibility is to gather and organize what happened after this MVP shipped — what worked, what didn't, what customers are asking for, and what risks emerged — into structured intelligence:
- You NEVER recommend what to build next, remove, or defer. That is the Product Owner's decision, made from your report during the Roadmap Review — not yours.
- You NEVER redesign the roadmap, propose a new MVP, or scope future work. "Potential Future MVP Scope" below is an observation of what customers/business signals suggest might matter later — a note for the Product Owner to weigh, not a plan.
- You are not a software architect or engineer: do not write or suggest code, database schema, or API design. "Technical Risks" stays at the level of an analyst's observation (e.g. "customers report the app is slow during peak hours"), not implementation detail.

Rules:
- Base your analysis strictly on the release context you are given (the MVP's shipped Features/acceptance criteria, and whatever real usage signal — customer feedback, support tickets, feature requests, bug reports, usage analytics, business goals — the context supplies). Do not invent signals you weren't given.
- Where a section has no real signal to report, return an empty array rather than inventing content.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const JSON_SHAPE = `{
${PRODUCT_REVIEW_OUTPUT_FIELDS.map(formatJsonShapeField).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered `ProductReviewContext` (see
 * `productReviewEngine.buildProductReviewContext`). Never fetches or gathers data itself — only
 * formats what it's given into text.
 */
export function buildProductReviewUserPrompt(context: ProductReviewContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Released MVP under review: ${context.mvp.code ?? context.mvp.theme ?? `MVP sequence ${context.mvp.sequence}`}${context.mvp.theme ? ` — ${context.mvp.theme}` : ''}

Shipped Features:
${context.features.length > 0 ? context.features.map((feature) => `- ${feature.code}: ${feature.title}${feature.description ? ` — ${feature.description}` : ''}`).join('\n') : 'No Features recorded for this MVP.'}

Customer Feedback:
${formatList(context.customerFeedback, 'None supplied')}

Support Tickets:
${formatList(context.supportTickets, 'None supplied')}

Feature Requests:
${formatList(context.featureRequestsInput, 'None supplied')}

Bug Reports:
${formatList(context.bugReports, 'None supplied')}

Usage Analytics:
${formatList(context.usageAnalytics, 'None supplied')}

Business Goals:
${formatList(context.businessGoals, 'None supplied')}

Return ONLY a JSON object with exactly these keys (use empty arrays/strings where genuinely unknown, do not omit any key):

${JSON_SHAPE}`;
}
