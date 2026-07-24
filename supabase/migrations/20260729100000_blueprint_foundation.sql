-- Blueprint Foundation — Sprint 59.
--
-- Infrastructure only. Persists the existing hardcoded Blueprint registry
-- (app/lib/blueprints/registry.ts) into BuildersDB as seed data, behind a new repository
-- layer, so a future sprint's Blueprint Resolution/Industry Detection/Regional Overlay/Package
-- Level work (explicitly OUT of scope here — see the Sprint 59 brief) has somewhere real to
-- read and write. This migration does not change what any blueprint means or how one is
-- chosen — `blueprintEngine`'s public, synchronous API and its output are unchanged; see
-- app/lib/blueprints/engine.ts's own header comment for how the cache/hydration split keeps
-- every existing call site (all synchronous — Requirements dialog, New Project dialog,
-- Project Dashboard, every AI role's `buildContext()`) working exactly as before.
--
-- Ownership model: NOT project-scoped. A Blueprint is shared catalog data, not owned by any
-- one project or user — same precedent as `builders_ai_roles` (see
-- 20260710100000_project_ownership_and_rls.sql's own note on catalog tables): row level
-- security grants `select` to any `authenticated` user with `using (true)`, and grants no
-- insert/update/delete policy at all. The only writer is this migration's own seed INSERT
-- below; a future Blueprint Studio sprint is what introduces an actual write path (and would
-- add its own, narrower policy then — not assumed here).
--
-- Versioning: `(slug, version)` is unique, `is_latest` marks the current version per slug (at
-- most one true per slug, enforced by the partial unique index below), and `status` is one of
-- draft/active/deprecated — the same versioning vocabulary the Blueprint Architecture Proposal
-- calls for, modeled here exactly like `builders_role_outputs`' own artifact-version pattern
-- (stable identity + incrementing version + a "this one is current" marker), not a new
-- invention. Every seeded row below is version 1, status 'active', is_latest true.
--
-- Extensibility columns (`industry`, `parent_blueprint_id`, `metadata`, `content`) are included
-- now, per the Sprint 59 brief's "prepare support for" list, but are deliberately unpopulated
-- (null / empty-object default) and read by nothing yet — Blueprint Resolution, Industry
-- Detection, Regional Overlays, and structured Blueprint Content are later sprints' work, not
-- this one's.

-- ============================================================================
-- builders_blueprints
-- ============================================================================
create table if not exists builders_blueprints (
  id uuid primary key default gen_random_uuid(),

  -- Stable, human-chosen identifier — matches today's `ProjectBlueprint.id` / `project.blueprintId`
  -- values verbatim (e.g. 'business-website'), constant across every version of the same blueprint.
  slug text not null,
  version integer not null default 1,
  is_latest boolean not null default true,
  status text not null default 'active',

  -- Base -> Industry -> Regional hierarchy the Blueprint Architecture Proposal describes.
  -- Nullable and unused this sprint — every seeded row is a standalone base blueprint.
  parent_blueprint_id uuid references builders_blueprints (id),

  -- Display order matching the existing registry array's declaration order, so a caller that
  -- lists all blueprints sees the identical ordering it does today.
  sort_order integer not null default 0,

  name text not null,
  icon text not null,
  description text not null,
  category text not null,
  product_type text,

  -- Reserved for Industry Detection (later sprint) — unpopulated by this migration's seed data.
  industry text,

  target_users text,
  default_status text,

  recommended_stack jsonb not null default '[]'::jsonb,
  recommended_integrations jsonb not null default '[]'::jsonb,
  recommended_next_steps jsonb not null default '[]'::jsonb,
  roadmap jsonb not null default '[]'::jsonb,

  enabled boolean not null default true,
  coming_soon boolean not null default false,

  -- Free-form extensibility bag for future blueprint-intelligence fields (package tiers,
  -- confidence scoring inputs, etc.) — empty and unread this sprint.
  metadata jsonb not null default '{}'::jsonb,

  -- Structured Blueprint Content (Standard Workflows, Business Rules, Pages & Screens, QA
  -- Scenarios, AI Role Guidance, ...) per the Blueprint Architecture Proposal — empty and
  -- unread this sprint; no AI role consumes this column yet.
  content jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint builders_blueprints_status_check
    check (status in ('draft', 'active', 'deprecated')),
  unique (slug, version)
);

create index if not exists builders_blueprints_slug_idx
  on builders_blueprints (slug);

create index if not exists builders_blueprints_parent_blueprint_id_idx
  on builders_blueprints (parent_blueprint_id);

-- At most one "latest" row per slug — enforced at the database level, not just by convention.
create unique index if not exists builders_blueprints_slug_latest_idx
  on builders_blueprints (slug) where is_latest;

drop trigger if exists set_updated_at on builders_blueprints;
create trigger set_updated_at before update on builders_blueprints
  for each row execute function builders_set_updated_at();

-- ============================================================================
-- Row Level Security — shared catalog, same precedent as builders_ai_roles.
-- ============================================================================
alter table builders_blueprints enable row level security;

drop policy if exists "builders_blueprints_select" on builders_blueprints;
create policy "builders_blueprints_select" on builders_blueprints
  for select to authenticated
  using (true);

-- ============================================================================
-- Seed data — the existing 9 hardcoded blueprints (app/lib/blueprints/registry.ts),
-- verbatim. Idempotent: re-running this migration is a no-op once seeded.
-- ============================================================================
insert into builders_blueprints
  (slug, version, is_latest, status, sort_order, name, icon, description, category, product_type,
   target_users, default_status, recommended_stack, recommended_integrations, recommended_next_steps, roadmap)
values
  (
    'blank-project', 1, true, 'active', 0,
    'Blank Project', '⭐', 'Start from a clean workspace with no assumptions.', 'General', 'Unopinionated Workspace',
    'Anyone starting from scratch', 'Planning',
    '[]'::jsonb,
    '[]'::jsonb,
    '["Describe what you want to build", "Pick a stack as you go"]'::jsonb,
    '[
      {"key": "requirements", "title": "Requirements", "description": "Describe what you want to build."},
      {"key": "planning", "title": "Planning", "description": "Pick a stack and approach as you go."},
      {"key": "deployment", "title": "Deployment", "description": "Deploy the project once it is ready."}
    ]'::jsonb
  ),
  (
    'business-website', 1, true, 'active', 1,
    'Business Website', '🏪', 'Perfect for local businesses, corporate websites and landing pages.', 'Website', 'Marketing / Service Website',
    'Local businesses and service providers', 'Planning',
    '["Next.js", "Tailwind CSS", "Supabase (optional)", "WhatsApp CTA"]'::jsonb,
    '["WhatsApp", "Google Maps", "Contact Form", "SEO"]'::jsonb,
    '["Create homepage", "Add services section", "Add contact section", "Add WhatsApp CTA", "Add SEO metadata"]'::jsonb,
    '[
      {"key": "requirements", "title": "Requirements", "description": "Define business requirements."},
      {"key": "homepage", "title": "Homepage", "description": "Design and build the homepage."},
      {"key": "navigation", "title": "Navigation", "description": "Set up site navigation and structure."},
      {"key": "services", "title": "Services", "description": "Add a services section."},
      {"key": "about", "title": "About", "description": "Add an About section."},
      {"key": "contact", "title": "Contact", "description": "Add a contact section and form."},
      {"key": "seo", "title": "SEO", "description": "Add SEO metadata."},
      {"key": "responsive-design", "title": "Responsive Design", "description": "Ensure the site works on all screen sizes."},
      {"key": "deployment", "title": "Deployment", "description": "Deploy the website."}
    ]'::jsonb
  ),
  (
    'localshop-india', 1, true, 'active', 2,
    'LocalShop India', '🛍️', 'A commerce storefront built for Indian MSMEs.', 'Commerce', 'Shopify-like MSME ecommerce platform',
    'Indian MSMEs and local shop owners', 'Planning',
    '["Next.js", "Supabase", "Tailwind CSS", "Razorpay", "UPI", "WhatsApp"]'::jsonb,
    '["Supabase Auth", "Product Catalog", "Orders", "Razorpay / UPI Payments", "WhatsApp Notifications", "Admin Dashboard"]'::jsonb,
    '["Define vendor onboarding", "Create product catalog", "Design storefront", "Add cart and checkout", "Plan order management", "Plan payments with Razorpay/UPI"]'::jsonb,
    '[
      {"key": "requirements", "title": "Requirements", "description": "Define business requirements."},
      {"key": "vendor-model", "title": "Vendor Model", "description": "Define vendor onboarding and structure."},
      {"key": "product-catalog", "title": "Product Catalog", "description": "Build the product catalog."},
      {"key": "authentication", "title": "Authentication", "description": "Set up customer/vendor authentication."},
      {"key": "shopping-cart", "title": "Shopping Cart", "description": "Add cart functionality."},
      {"key": "checkout", "title": "Checkout", "description": "Build the checkout flow."},
      {"key": "razorpay-upi-payments", "title": "Razorpay / UPI Payments", "description": "Integrate Razorpay and UPI payments."},
      {"key": "order-management", "title": "Order Management", "description": "Plan order management and fulfillment."},
      {"key": "notifications", "title": "Notifications", "description": "Add order and vendor notifications."},
      {"key": "deployment", "title": "Deployment", "description": "Deploy the storefront."}
    ]'::jsonb
  ),
  (
    'shopify-app', 1, true, 'active', 3,
    'Shopify App', '🛒', 'Custom apps and extensions for Shopify stores.', 'Commerce', 'Shopify App / Extension',
    'Shopify merchants and app developers', 'Planning',
    '["Next.js", "Shopify App Bridge", "Shopify Admin API", "Webhooks"]'::jsonb,
    '["Shopify OAuth", "Shopify Webhooks", "Shopify Billing API"]'::jsonb,
    '["Register app with Shopify Partners", "Set up OAuth flow", "Define required webhooks", "Plan billing via Shopify Billing API"]'::jsonb,
    '[
      {"key": "requirements", "title": "Requirements", "description": "Define business requirements."},
      {"key": "app-structure", "title": "App Structure", "description": "Register the app and define its structure."},
      {"key": "authentication", "title": "Authentication", "description": "Set up the Shopify OAuth flow."},
      {"key": "polaris-ui", "title": "Polaris UI", "description": "Build the UI with Shopify Polaris."},
      {"key": "app-bridge", "title": "App Bridge", "description": "Integrate Shopify App Bridge."},
      {"key": "webhooks", "title": "Webhooks", "description": "Define required Shopify webhooks."},
      {"key": "billing", "title": "Billing", "description": "Plan billing via the Shopify Billing API."},
      {"key": "testing", "title": "Testing", "description": "Test the app against a development store."},
      {"key": "deployment", "title": "Deployment", "description": "Submit and deploy the app."}
    ]'::jsonb
  ),
  (
    'ai-agent', 1, true, 'active', 4,
    'AI Agent', '🤖', 'An autonomous or assistant-style AI agent product.', 'AI', 'AI Agent / Assistant',
    'Teams building AI-driven automation', 'Planning',
    '["MCP Servers", "Tool Calling", "Vector Knowledge Base", "Agent Memory"]'::jsonb,
    '["MCP Servers", "Browser Automation", "Knowledge Base", "Memory Store"]'::jsonb,
    '["Define the agent’s goal and tools", "Connect MCP servers", "Set up knowledge base", "Design memory and workflow steps"]'::jsonb,
    '[
      {"key": "requirements", "title": "Requirements", "description": "Define business requirements."},
      {"key": "architecture", "title": "Architecture", "description": "Define the agent''s goal, tools, and architecture."},
      {"key": "memory", "title": "Memory", "description": "Design agent memory and state."},
      {"key": "knowledge-base", "title": "Knowledge Base", "description": "Set up the knowledge base."},
      {"key": "tool-calling", "title": "Tool Calling", "description": "Define and wire up tool calling."},
      {"key": "mcp", "title": "MCP", "description": "Connect MCP servers."},
      {"key": "browser-automation", "title": "Browser Automation", "description": "Set up browser automation, if needed."},
      {"key": "testing", "title": "Testing", "description": "Test agent behavior end-to-end."},
      {"key": "deployment", "title": "Deployment", "description": "Deploy the agent."}
    ]'::jsonb
  ),
  (
    'saas-starter', 1, true, 'active', 5,
    'SaaS Starter', '🚀', 'A foundation for subscription-based software products.', 'SaaS', 'Subscription SaaS Product',
    'Teams building subscription software', 'Planning',
    '["Next.js", "Supabase", "Tailwind CSS", "Razorpay", "UPI", "Cashfree"]'::jsonb,
    '["Supabase Auth", "Razorpay Subscriptions", "UPI", "Cashfree", "Email Notifications"]'::jsonb,
    '["Define pricing plans", "Set up authentication", "Plan billing with Razorpay/UPI/Cashfree", "Design onboarding flow"]'::jsonb,
    '[
      {"key": "requirements", "title": "Requirements", "description": "Define business requirements."},
      {"key": "pricing-plans", "title": "Pricing Plans", "description": "Define subscription pricing plans."},
      {"key": "authentication", "title": "Authentication", "description": "Set up user authentication."},
      {"key": "billing", "title": "Billing", "description": "Plan billing with Razorpay, UPI, or Cashfree."},
      {"key": "onboarding", "title": "Onboarding", "description": "Design the onboarding flow."},
      {"key": "testing", "title": "Testing", "description": "Test core flows end-to-end."},
      {"key": "deployment", "title": "Deployment", "description": "Deploy the product."}
    ]'::jsonb
  ),
  (
    'mobile-app', 1, true, 'active', 6,
    'Mobile App', '📱', 'A companion or standalone mobile application.', 'Mobile', 'Mobile Application',
    'Teams building a mobile companion app', 'Planning',
    '["React Native", "Expo"]'::jsonb,
    '["Push Notifications", "Supabase Auth"]'::jsonb,
    '["Define core screens", "Set up navigation", "Plan app store release"]'::jsonb,
    '[
      {"key": "requirements", "title": "Requirements", "description": "Define business requirements."},
      {"key": "core-screens", "title": "Core Screens", "description": "Define the app’s core screens."},
      {"key": "navigation", "title": "Navigation", "description": "Set up app navigation."},
      {"key": "authentication", "title": "Authentication", "description": "Set up user authentication."},
      {"key": "push-notifications", "title": "Push Notifications", "description": "Add push notifications."},
      {"key": "app-store-release", "title": "App Store Release", "description": "Plan the app store release."},
      {"key": "deployment", "title": "Deployment", "description": "Deploy/publish the app."}
    ]'::jsonb
  ),
  (
    'marketing-website', 1, true, 'active', 7,
    'Marketing Website', '🌐', 'A marketing site focused on conversion and brand.', 'Website', 'Marketing / Brand Website',
    'Marketing and brand teams', 'Planning',
    '["Next.js", "Tailwind CSS"]'::jsonb,
    '["SEO", "Analytics", "Contact Form"]'::jsonb,
    '["Define brand sections", "Add SEO metadata", "Add analytics"]'::jsonb,
    '[
      {"key": "requirements", "title": "Requirements", "description": "Define business requirements."},
      {"key": "brand-sections", "title": "Brand Sections", "description": "Define the site’s brand sections."},
      {"key": "seo", "title": "SEO", "description": "Add SEO metadata."},
      {"key": "analytics", "title": "Analytics", "description": "Add analytics tracking."},
      {"key": "contact-form", "title": "Contact Form", "description": "Add a contact form."},
      {"key": "deployment", "title": "Deployment", "description": "Deploy the website."}
    ]'::jsonb
  ),
  (
    'nextjs-saas', 1, true, 'active', 8,
    'Next.js SaaS', '⚡', 'A Next.js-flavored foundation for SaaS products.', 'SaaS', 'Next.js SaaS Product',
    'Teams building a Next.js-based SaaS product', 'Planning',
    '["Next.js", "Supabase", "Tailwind CSS", "Razorpay", "UPI"]'::jsonb,
    '["Supabase Auth", "Razorpay", "UPI", "Email Notifications"]'::jsonb,
    '["Set up authentication", "Plan billing with Razorpay/UPI", "Design dashboard"]'::jsonb,
    '[
      {"key": "requirements", "title": "Requirements", "description": "Define business requirements."},
      {"key": "authentication", "title": "Authentication", "description": "Set up user authentication."},
      {"key": "billing", "title": "Billing", "description": "Plan billing with Razorpay/UPI."},
      {"key": "dashboard", "title": "Dashboard", "description": "Design the product dashboard."},
      {"key": "testing", "title": "Testing", "description": "Test core flows end-to-end."},
      {"key": "deployment", "title": "Deployment", "description": "Deploy the product."}
    ]'::jsonb
  )
on conflict (slug, version) do nothing;
