/**
 * Project Knowledge — Phase 2 Sprint 9.
 *
 * Structured product knowledge for a project, captured before any AI
 * generation happens. This is the layer between Blueprint (what kind of
 * product) and Roadmap/Design/Database/Frontend/Backend (how it gets
 * built):
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Design
 *     -> Database -> Frontend -> Backend -> GitHub -> Supabase -> Deployment
 *
 * Everything here is plain data. Nothing in this file calls an LLM,
 * generates code, or provisions anything — it only describes the shape of
 * what a human (via the Requirements dialog) can capture about a product,
 * for a future sprint's AI Project Manager to eventually read.
 */

/**
 * All fields are optional — a blueprint never forces knowledge to exist,
 * and no field here is required for every project. This shape is meant to
 * cover every blueprint in the registry (Business Website, LocalShop
 * India, Shopify App, AI Agent, SaaS Starter, Mobile App, Marketing
 * Website, Next.js SaaS, Blank Project) without needing per-blueprint
 * variants — blueprint-specific guidance is layered on top via
 * getProjectKnowledgeHints() below, as placeholder text only.
 */
export interface ProjectKnowledge {
  /** What is this product, in the founder's own words. */
  projectVision?: string;

  /** Who this product is for. */
  targetUsers?: string;

  /** How the product makes money / its business model, if relevant. */
  businessModel?: string;

  /** The industry/vertical this product operates in, e.g. "Construction", "Retail". */
  industry?: string;

  /** The product's core features. */
  coreFeatures?: string[];

  /** Pages or screens the product needs. */
  pagesOrScreens?: string[];

  /** Distinct user roles (e.g. Admin, Vendor, Customer). */
  userRoles?: string[];

  /** Third-party integrations the product needs (e.g. WhatsApp, Maps). */
  integrations?: string[];

  /**
   * Compliance needs. India-focused products may include things like GST
   * or invoice generation here — these are optional knowledge fields, not
   * requirements imposed on every project.
   */
  complianceNeeds?: string[];

  /**
   * Payment needs. For India-focused products this commonly includes
   * Razorpay, UPI, PhonePe, Paytm, or Cashfree — never assumed, always
   * whatever the user actually enters.
   */
  paymentNeeds?: string[];

  /** Shipping needs (e.g. Shiprocket, Delhivery), if the product ships goods. */
  shippingNeeds?: string[];

  /** Languages the product should support (e.g. Tamil, Malayalam, Hindi, English). */
  languages?: string[];

  /** Primary region/location the product targets. */
  location?: string;

  /** Brand tone/voice guidance. */
  brandTone?: string;

  /** Design preferences (free text). */
  designPreferences?: string;

  /** Technical preferences (free text). */
  technicalPreferences?: string;

  /** Anything else worth capturing. */
  notes?: string;
}

/**
 * Blueprint-aware placeholder hints for the Requirements dialog — Task 5.
 * These are never saved automatically; they only show as input
 * placeholders (grey hint text) so the user has a starting point for what
 * to write. Only a subset of fields have hints per blueprint; anything not
 * listed falls back to a generic placeholder in the dialog itself.
 */
export interface ProjectKnowledgeHints {
  targetUsers?: string;
  coreFeatures?: string;
  pagesOrScreens?: string;
  userRoles?: string;
  integrations?: string;
  paymentNeeds?: string;
  complianceNeeds?: string;
  shippingNeeds?: string;
  notes?: string;
}

const BLUEPRINT_KNOWLEDGE_HINTS: Record<string, ProjectKnowledgeHints> = {
  'business-website': {
    targetUsers: 'e.g. local customers, service seekers',
    coreFeatures: 'e.g. Services, Contact, WhatsApp CTA',
    pagesOrScreens: 'e.g. Home, Services, About, Contact',
    integrations: 'e.g. WhatsApp, Google Maps, SEO',
    notes: 'e.g. brand tone, location, business hours',
  },
  'localshop-india': {
    targetUsers: 'e.g. vendors, local shoppers',
    coreFeatures: 'e.g. Vendor onboarding, Product catalog, Cart, Checkout',
    userRoles: 'e.g. Vendor, Customer, Admin',
    integrations: 'e.g. WhatsApp notifications',
    paymentNeeds: 'e.g. Razorpay, UPI',
    complianceNeeds: 'e.g. GST, Invoice generation',
    shippingNeeds: 'e.g. Shiprocket, Delhivery',
  },
  'shopify-app': {
    targetUsers: 'e.g. Shopify merchants',
    coreFeatures: 'e.g. App structure, Polaris UI, App Bridge',
    integrations: 'e.g. Shopify Webhooks',
    notes: 'e.g. required OAuth scopes, billing model',
  },
  'ai-agent': {
    targetUsers: 'e.g. internal team, end customers',
    coreFeatures: 'e.g. Tools, Knowledge base, Memory, MCP, Browser automation, Workflows',
    integrations: 'e.g. MCP servers, external APIs',
    notes: 'e.g. agent goals, guardrails',
  },
  'saas-starter': {
    targetUsers: 'e.g. small teams, freelancers',
    coreFeatures: 'e.g. Subscription model, Dashboard, Usage limits',
    userRoles: 'e.g. Owner, Member',
    paymentNeeds: 'e.g. Razorpay, UPI, Cashfree',
    notes: 'e.g. pricing tiers, trial length',
  },
  'nextjs-saas': {
    targetUsers: 'e.g. small teams, freelancers',
    coreFeatures: 'e.g. Dashboard, Usage limits',
    paymentNeeds: 'e.g. Razorpay, UPI',
    notes: 'e.g. pricing tiers, trial length',
  },
  'mobile-app': {
    targetUsers: 'e.g. mobile-first customers',
    coreFeatures: 'e.g. Core screens, Push notifications',
    integrations: 'e.g. Push notifications, Auth',
    notes: 'e.g. platforms (iOS/Android), offline support',
  },
  'marketing-website': {
    targetUsers: 'e.g. prospective customers, investors',
    coreFeatures: 'e.g. Brand sections, SEO, Analytics',
    pagesOrScreens: 'e.g. Home, About, Contact',
    notes: 'e.g. brand tone, campaign goals',
  },
  'blank-project': {
    notes: 'Describe what you want to build — anything helps.',
  },
};

/**
 * Returns whatever hints exist for a blueprint id (or an empty object if
 * none are defined). Never throws, never returns saved values — purely
 * static placeholder text.
 */
export function getProjectKnowledgeHints(blueprintId: string | undefined): ProjectKnowledgeHints {
  if (!blueprintId) {
    return {};
  }

  return BLUEPRINT_KNOWLEDGE_HINTS[blueprintId] ?? {};
}

/**
 * Sprint 9 (Phase 2) — whether a project has any meaningful requirements
 * captured yet. Used to show "Requirements captured" vs "Requirements
 * missing" in the Project Dashboard (Task 7) and to decide whether to show
 * the empty state vs the summary view (Task 3). Intentionally lenient: any
 * one meaningful field is enough — this is not a validation gate.
 */
export function isRequirementsCaptured(knowledge: ProjectKnowledge | undefined): boolean {
  if (!knowledge) {
    return false;
  }

  const hasText = (value: string | undefined) => Boolean(value && value.trim().length > 0);
  const hasList = (value: string[] | undefined) => Boolean(value && value.length > 0);

  return (
    hasText(knowledge.projectVision) ||
    hasText(knowledge.targetUsers) ||
    hasText(knowledge.businessModel) ||
    hasText(knowledge.industry) ||
    hasList(knowledge.coreFeatures) ||
    hasList(knowledge.pagesOrScreens) ||
    hasList(knowledge.userRoles) ||
    hasList(knowledge.integrations) ||
    hasList(knowledge.complianceNeeds) ||
    hasList(knowledge.paymentNeeds) ||
    hasList(knowledge.shippingNeeds) ||
    hasList(knowledge.languages) ||
    hasText(knowledge.location) ||
    hasText(knowledge.brandTone) ||
    hasText(knowledge.designPreferences) ||
    hasText(knowledge.technicalPreferences) ||
    hasText(knowledge.notes)
  );
}
