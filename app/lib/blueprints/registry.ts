import type { ProjectBlueprint } from './types';

/**
 * Blueprint Engine — registry.
 *
 * The raw data. This is intentionally NOT exported from
 * app/lib/blueprints/index.ts — everything outside this module reads
 * blueprint data through blueprintEngine (engine.ts), never this array
 * directly, so the registry's storage shape can change later without
 * touching any consumer.
 *
 * Data is unchanged from Sprint 3/4 — same 9 blueprints, same fields,
 * same India-first payment guidance (Razorpay/UPI/PhonePe/Paytm/Cashfree,
 * no Stripe).
 *
 * Sprint 59 (Blueprint Foundation) gives this array a second role: it is now also the seed
 * data inserted into BuildersDB's `builders_blueprints` table (see
 * supabase/migrations/20260729100000_blueprint_foundation.sql — every field/value below is
 * duplicated there verbatim). This array remains `blueprintEngine`'s permanent fallback —
 * `engine.ts`'s `activeBlueprints` cache starts as this exact array and only ever swaps to
 * BuildersDB-sourced data after a successful `hydrateBlueprints()`, never removing this as the
 * safety net for an unconfigured/unreachable BuildersDB.
 */
export const PROJECT_BLUEPRINTS: ProjectBlueprint[] = [
  {
    id: 'blank-project',
    name: 'Blank Project',
    icon: '⭐',
    description: 'Start from a clean workspace with no assumptions.',
    category: 'General',
    productType: 'Unopinionated Workspace',
    recommendedStack: [],
    recommendedIntegrations: [],
    recommendedNextSteps: ['Describe what you want to build', 'Pick a stack as you go'],
    roadmap: [
      { key: 'requirements', title: 'Requirements', description: 'Describe what you want to build.' },
      { key: 'planning', title: 'Planning', description: 'Pick a stack and approach as you go.' },
      { key: 'deployment', title: 'Deployment', description: 'Deploy the project once it is ready.' },
    ],
    targetUsers: 'Anyone starting from scratch',
    defaultStatus: 'Planning',
    enabled: true,
  },
  {
    id: 'business-website',
    name: 'Business Website',
    icon: '🏪',
    description: 'Perfect for local businesses, corporate websites and landing pages.',
    category: 'Website',
    productType: 'Marketing / Service Website',
    recommendedStack: ['Next.js', 'Tailwind CSS', 'Supabase (optional)', 'WhatsApp CTA'],
    recommendedIntegrations: ['WhatsApp', 'Google Maps', 'Contact Form', 'SEO'],
    recommendedNextSteps: [
      'Create homepage',
      'Add services section',
      'Add contact section',
      'Add WhatsApp CTA',
      'Add SEO metadata',
    ],
    roadmap: [
      { key: 'requirements', title: 'Requirements', description: 'Define business requirements.' },
      { key: 'homepage', title: 'Homepage', description: 'Design and build the homepage.' },
      { key: 'navigation', title: 'Navigation', description: 'Set up site navigation and structure.' },
      { key: 'services', title: 'Services', description: 'Add a services section.' },
      { key: 'about', title: 'About', description: 'Add an About section.' },
      { key: 'contact', title: 'Contact', description: 'Add a contact section and form.' },
      { key: 'seo', title: 'SEO', description: 'Add SEO metadata.' },
      {
        key: 'responsive-design',
        title: 'Responsive Design',
        description: 'Ensure the site works on all screen sizes.',
      },
      { key: 'deployment', title: 'Deployment', description: 'Deploy the website.' },
    ],
    targetUsers: 'Local businesses and service providers',
    defaultStatus: 'Planning',
    enabled: true,
    content: {
      schemaVersion: 1,
      executiveSummary: {
        summary:
          'A marketing and lead-generation website for a local business or service provider — the digital front door that establishes credibility, communicates services, and converts visitors into enquiries.',
        valueProposition:
          'Gives a business a professional, trustworthy online presence without the cost or complexity of a custom-built site, optimized for the one thing that matters most to a local business: getting the phone to ring or the WhatsApp message to arrive.',
      },
      businessDomain: {
        industry: 'Local Services & Small Business',
        category: 'Marketing / Service Website',
        description:
          'Businesses that sell their expertise, service, or in-person experience rather than shippable goods — service providers, clinics, salons, contractors, consultancies, and similar.',
      },
      typicalCustomers: [
        'Local service providers (salons, clinics, repair shops, contractors)',
        'Small professional practices (consultants, accountants, law firms)',
        'Single-location retail or hospitality businesses wanting an online presence',
        'Franchise or multi-location businesses needing a consistent brand site',
        'Solo entrepreneurs and freelancers establishing credibility',
      ],
      customerPersonas: [
        {
          name: 'Priya, Salon Owner',
          role: 'Business Owner / Operator',
          description:
            'Runs a single-location salon, wants more walk-ins and easier appointment enquiries, not tech-savvy.',
          goals: [
            'Look professional online',
            'Make it easy for customers to find hours, services, and location',
            'Receive enquiries via WhatsApp without checking email',
          ],
          painPoints: [
            'No time to maintain a complex website',
            "Doesn't know what content to put where",
            'Worried about ongoing costs',
          ],
        },
        {
          name: 'Arjun, Marketing Manager',
          role: 'Marketing Manager at a small firm',
          description:
            "Manages a small business's brand online, needs a site that reflects the business's positioning.",
          goals: [
            'Consistent branding across channels',
            'SEO visibility for local search',
            'Easy way to update content without a developer',
          ],
          painPoints: ['Limited budget for ongoing dev work', 'Needs analytics to prove marketing impact'],
        },
      ],
      businessGoals: [
        {
          goal: 'Establish credibility',
          description:
            'Convince a first-time visitor the business is legitimate and professional within seconds of landing on the site.',
          priority: 'high',
        },
        {
          goal: 'Generate enquiries',
          description: 'Convert visitors into phone calls, WhatsApp messages, or contact-form submissions.',
          priority: 'high',
        },
        {
          goal: 'Rank in local search',
          description: "Appear for 'near me' and service+location searches.",
          priority: 'medium',
        },
        {
          goal: 'Reduce repetitive questions',
          description:
            'Answer common questions (hours, pricing, location) on the site so staff spend less time on the phone.',
          priority: 'medium',
        },
      ],
      coreBusinessProcesses: [
        {
          name: 'Visitor enquiry',
          description: 'A visitor lands on the site, browses services, and submits an enquiry.',
          steps: [
            'Visitor arrives via search, social, or referral',
            'Visitor reviews services/about/testimonials',
            'Visitor clicks Contact or WhatsApp CTA',
            'Enquiry is sent to the business owner',
            'Business follows up (call, message, or booking)',
          ],
        },
        {
          name: 'Content update',
          description: 'The business updates hours, offers, or service details.',
          steps: [
            'Owner or marketing manager identifies a change',
            'Update is made to the relevant section',
            'Change goes live immediately',
          ],
        },
      ],
      functionalModules: [
        {
          name: 'Homepage',
          description: 'First impression: hero message, key services, and primary call-to-action.',
          features: ['Hero banner with tagline', 'Highlighted services', 'Primary CTA (Call/WhatsApp/Book)'],
        },
        {
          name: 'Services',
          description: 'Detailed breakdown of what the business offers.',
          features: ['Service list with descriptions', 'Pricing (optional)', 'Per-service CTA'],
        },
        {
          name: 'About',
          description: 'Builds trust: story, team, credentials.',
          features: ['Business story', 'Team profiles', 'Certifications/awards'],
        },
        {
          name: 'Contact',
          description: 'Every way a visitor can reach the business.',
          features: ['Contact form', 'Map/location embed', 'Phone/WhatsApp/Email links', 'Business hours'],
        },
      ],
      standardFeatures: [
        {
          name: 'Responsive design',
          description: 'Looks correct on mobile, tablet, and desktop — most local-search traffic is mobile.',
        },
        {
          name: 'WhatsApp CTA',
          description: 'One-tap enquiry via WhatsApp, the primary contact channel for most local businesses.',
        },
        { name: 'Contact form', description: 'Structured enquiry capture with name/phone/message.' },
        {
          name: 'SEO metadata',
          description: 'Page titles, descriptions, and structured data for local search visibility.',
        },
        { name: 'Google Maps embed', description: 'Shows exact location and supports directions.' },
      ],
      optionalFeatures: [
        { name: 'Online booking/appointment widget', description: 'Lets customers self-schedule instead of calling.' },
        { name: 'Testimonials/reviews section', description: 'Displays customer feedback to build trust.' },
        { name: 'Blog/News section', description: 'Supports content marketing and SEO.' },
        { name: 'Multi-language support', description: 'Serves customers in regional languages.' },
        { name: 'Live chat widget', description: 'Real-time visitor engagement.' },
      ],
      userRoles: [
        {
          name: 'Visitor',
          description: 'Anonymous public user browsing the site.',
          permissions: ['View pages', 'Submit enquiry form'],
        },
        {
          name: 'Business Owner/Admin',
          description: 'Manages site content.',
          permissions: ['Edit page content', 'View enquiries', 'Update hours/services'],
        },
      ],
      businessRules: [
        {
          rule: 'Contact information must be visible on every page.',
          rationale: 'Local business visitors expect to find how to reach the business without hunting.',
        },
        {
          rule: 'Business hours displayed must reflect actual operating hours, including holidays.',
          rationale: 'Incorrect hours are one of the most common causes of customer frustration for local businesses.',
        },
        {
          rule: 'All CTAs should route to the lowest-friction contact method the business supports (WhatsApp before email).',
          rationale: 'Local customers overwhelmingly prefer WhatsApp/call over email for this business category.',
        },
      ],
      dataEntities: [
        {
          name: 'Enquiry',
          description: 'A visitor-submitted contact request.',
          keyFields: ['name', 'phone', 'email', 'message', 'submittedAt'],
          relationships: ['Belongs to Business'],
        },
        {
          name: 'Service',
          description: 'One service the business offers.',
          keyFields: ['name', 'description', 'price (optional)'],
          relationships: ['Belongs to Business'],
        },
        {
          name: 'BusinessProfile',
          description: "The business's own identity/settings.",
          keyFields: ['name', 'hours', 'location', 'contactMethods'],
          relationships: [],
        },
      ],
      integrations: [
        { name: 'WhatsApp Business', purpose: 'Primary customer contact channel.', required: true },
        { name: 'Google Maps', purpose: 'Location display and directions.', required: true },
        { name: 'Google Analytics', purpose: 'Traffic and conversion tracking.', required: false },
        { name: 'Google Business Profile', purpose: 'Local search presence and reviews.', required: false },
      ],
      compliance: [
        {
          name: 'Privacy notice for contact form data',
          description: 'Visitors submitting contact details should be informed how their data is used.',
          region: 'Global',
        },
      ],
      uiPatterns: [
        {
          name: 'Sticky CTA',
          description: 'A persistent call-to-action (Call/WhatsApp) visible while scrolling on mobile.',
        },
        {
          name: 'Above-the-fold value proposition',
          description: 'The core offer is understandable without scrolling.',
        },
        { name: 'Trust badges', description: 'Certifications, years-in-business, or review counts near the CTA.' },
      ],
      navigation: [
        { label: 'Home', description: 'Landing page.' },
        { label: 'Services', description: 'What the business offers.' },
        { label: 'About', description: 'Business story and team.' },
        { label: 'Contact', description: 'Contact form, map, hours.' },
      ],
      dashboardSuggestions: [
        {
          name: 'Enquiry Volume',
          description: 'Track how many enquiries come in over time.',
          metrics: ['Enquiries this week', 'Enquiries by source'],
        },
      ],
      reports: [
        {
          name: 'Monthly Enquiry Summary',
          description: 'Enquiry count and source breakdown.',
          audience: 'Business Owner',
        },
      ],
      notifications: [
        { name: 'New enquiry received', trigger: 'Visitor submits contact form', channel: 'Email' },
        { name: 'New enquiry received (WhatsApp)', trigger: 'Visitor clicks WhatsApp CTA', channel: 'WhatsApp' },
      ],
      security: [
        { concern: 'Spam form submissions', mitigation: 'CAPTCHA or honeypot field on the contact form.' },
        {
          concern: 'Content tampering by unauthorized editors',
          mitigation: 'Single authenticated admin/editor role, no public write access.',
        },
      ],
      performanceExpectations: [
        { metric: 'Largest Contentful Paint (mobile)', target: 'Under 2.5 seconds on 4G' },
        { metric: 'Page weight', target: 'Under 1.5MB per page for fast mobile loading' },
      ],
      testingScenarios: [
        {
          scenario: 'Visitor submits contact form with valid data',
          expectedOutcome: 'Enquiry is recorded and business receives a notification',
        },
        {
          scenario: 'Visitor submits contact form with missing required field',
          expectedOutcome: 'Form shows validation error, no submission recorded',
        },
        {
          scenario: 'Visitor taps WhatsApp CTA on mobile',
          expectedOutcome: 'WhatsApp opens with a pre-filled message to the business number',
        },
        {
          scenario: 'Visitor views site on a small mobile viewport',
          expectedOutcome: 'Layout remains readable, CTA remains reachable without horizontal scrolling',
        },
      ],
      deploymentConsiderations: [
        {
          consideration: 'Custom domain',
          detail: 'Most local businesses expect their own domain rather than a subdomain, for credibility.',
        },
        { consideration: 'SSL/HTTPS', detail: 'Required for both trust and SEO ranking.' },
      ],
      futureEnhancements: [
        {
          idea: 'Online booking integration',
          description: 'Let customers book appointments directly instead of calling.',
        },
        { idea: 'Multi-location support', description: 'Support businesses that expand to multiple branches.' },
      ],
    },
  },
  {
    id: 'localshop-india',
    name: 'LocalShop India',
    icon: '🛍️',
    description: 'A commerce storefront built for Indian MSMEs.',
    category: 'Commerce',
    productType: 'Shopify-like MSME ecommerce platform',
    recommendedStack: ['Next.js', 'Supabase', 'Tailwind CSS', 'Razorpay', 'UPI', 'WhatsApp'],
    recommendedIntegrations: [
      'Supabase Auth',
      'Product Catalog',
      'Orders',
      'Razorpay / UPI Payments',
      'WhatsApp Notifications',
      'Admin Dashboard',
    ],
    recommendedNextSteps: [
      'Define vendor onboarding',
      'Create product catalog',
      'Design storefront',
      'Add cart and checkout',
      'Plan order management',
      'Plan payments with Razorpay/UPI',
    ],
    roadmap: [
      { key: 'requirements', title: 'Requirements', description: 'Define business requirements.' },
      { key: 'vendor-model', title: 'Vendor Model', description: 'Define vendor onboarding and structure.' },
      { key: 'product-catalog', title: 'Product Catalog', description: 'Build the product catalog.' },
      { key: 'authentication', title: 'Authentication', description: 'Set up customer/vendor authentication.' },
      { key: 'shopping-cart', title: 'Shopping Cart', description: 'Add cart functionality.' },
      { key: 'checkout', title: 'Checkout', description: 'Build the checkout flow.' },
      {
        key: 'razorpay-upi-payments',
        title: 'Razorpay / UPI Payments',
        description: 'Integrate Razorpay and UPI payments.',
      },
      { key: 'order-management', title: 'Order Management', description: 'Plan order management and fulfillment.' },
      { key: 'notifications', title: 'Notifications', description: 'Add order and vendor notifications.' },
      { key: 'deployment', title: 'Deployment', description: 'Deploy the storefront.' },
    ],
    targetUsers: 'Indian MSMEs and local shop owners',
    defaultStatus: 'Planning',
    enabled: true,
    content: {
      schemaVersion: 1,
      executiveSummary: {
        summary:
          'A multi-vendor or single-store e-commerce storefront built for Indian MSMEs — enabling local shop owners to sell products online with India-specific payments, logistics, and communication built in from day one.',
        valueProposition:
          'Removes the biggest barriers Indian small retailers face going online: complex payment integration, unreliable shipping coordination, and customer communication — by defaulting to the tools Indian shoppers and shop owners already trust (UPI, WhatsApp, Razorpay).',
      },
      businessDomain: {
        industry: 'Retail & E-commerce (India)',
        category: 'Commerce',
        description:
          'MSMEs (Micro, Small & Medium Enterprises) selling physical products — clothing, groceries, general retail — moving from in-person or WhatsApp-based selling to a structured online storefront.',
      },
      typicalCustomers: [
        'Local shop owners digitizing an existing offline store',
        'Small clothing/apparel retailers',
        'Grocery and kirana stores expanding to delivery',
        'Home-based/small-batch product sellers (food, crafts, beauty)',
        'Regional multi-vendor marketplace operators',
      ],
      customerPersonas: [
        {
          name: 'Ramesh, Shop Owner',
          role: 'Owner of a local clothing store',
          description:
            'Has sold in-store for years, wants to reach customers beyond walking distance, sells mostly via WhatsApp today.',
          goals: [
            'List products online without technical skill',
            'Accept UPI payments customers already use',
            'Get order/customer notifications on WhatsApp',
          ],
          painPoints: [
            'Manually tracking orders via WhatsApp chats is chaotic',
            'No visibility into inventory across channels',
            'Customers ask about order status constantly',
          ],
        },
        {
          name: 'Divya, Customer',
          role: 'Online shopper',
          description: 'Prefers to shop from known local sellers, values fast delivery and UPI/COD payment options.',
          goals: [
            'Browse the catalog easily on mobile',
            'Pay with UPI, not just card',
            'Track order status without calling the shop',
          ],
          painPoints: [
            'Distrust of unfamiliar payment methods',
            'Wants shipping cost/timeline clarity before checkout',
          ],
        },
      ],
      businessGoals: [
        {
          goal: 'Digitize the storefront',
          description:
            'Move product discovery and ordering from informal WhatsApp chats to a structured catalog and checkout.',
          priority: 'high',
        },
        {
          goal: 'Enable India-native payments',
          description: 'Accept UPI and cards without requiring customers to trust an unfamiliar gateway.',
          priority: 'high',
        },
        {
          goal: 'Streamline order fulfillment',
          description: 'Give the shop owner one place to see, manage, and update orders.',
          priority: 'high',
        },
        {
          goal: 'Reduce customer-support load',
          description: 'Let customers self-serve order status instead of messaging the shop directly.',
          priority: 'medium',
        },
      ],
      coreBusinessProcesses: [
        {
          name: 'Vendor onboarding',
          description: 'A shop owner sets up their store and product catalog.',
          steps: [
            'Register as vendor',
            'Complete store profile (name, logo, address)',
            'Add products with photos, price, stock',
            'Configure payment and shipping options',
            'Go live',
          ],
        },
        {
          name: 'Customer purchase',
          description: 'A customer discovers and buys a product.',
          steps: [
            'Browse or search product catalog',
            'Add to cart',
            'Enter delivery address',
            'Choose payment method (UPI/Card/COD)',
            'Complete checkout',
            'Receive order confirmation',
          ],
        },
        {
          name: 'Order fulfillment',
          description: 'The vendor fulfills a placed order.',
          steps: [
            'Vendor receives new-order notification',
            'Vendor confirms stock and prepares order',
            'Vendor marks order as shipped, adds tracking if available',
            'Customer receives shipping notification',
            'Order marked delivered',
          ],
        },
      ],
      functionalModules: [
        {
          name: 'Product Catalog',
          description: 'Browsable, searchable product listings.',
          features: ['Categories and filters', 'Product detail pages with images', 'Stock/availability indicator'],
        },
        {
          name: 'Cart & Checkout',
          description: 'The purchase flow.',
          features: [
            'Cart management',
            'Address capture',
            'Payment method selection',
            'Order summary and confirmation',
          ],
        },
        {
          name: 'Order Management',
          description: 'Vendor-facing order tracking.',
          features: [
            'Order list with status',
            'Status updates (confirmed/shipped/delivered)',
            'Order detail view with customer info',
          ],
        },
        {
          name: 'Vendor Dashboard',
          description: 'Store-level overview for the shop owner.',
          features: ['Sales summary', 'Low-stock alerts', 'Recent orders'],
        },
      ],
      standardFeatures: [
        { name: 'UPI payments', description: 'Accept payments via UPI, the dominant Indian payment method.' },
        { name: 'Razorpay integration', description: 'Card, netbanking, and wallet payments via a single gateway.' },
        {
          name: 'WhatsApp order notifications',
          description: 'Order confirmations and status updates sent via WhatsApp.',
        },
        { name: 'Product catalog with categories', description: 'Organized, filterable product browsing.' },
        {
          name: 'Cash on Delivery (COD)',
          description:
            "Supports customers who don't trust prepaid online payment yet — still common in Tier 2/3 India.",
        },
      ],
      optionalFeatures: [
        {
          name: 'GST invoice generation',
          description: 'Auto-generates GST-compliant invoices for registered businesses.',
        },
        {
          name: 'Multi-vendor marketplace mode',
          description: 'Supports multiple independent sellers on one storefront.',
        },
        {
          name: 'Delivery partner integration (Shiprocket/Delhivery)',
          description: 'Automated shipping label and tracking.',
        },
        {
          name: 'Regional language support',
          description: 'Catalog and checkout in Hindi, Tamil, and other regional languages.',
        },
        {
          name: 'Loyalty/repeat-customer discounts',
          description: 'Encourage repeat purchases from existing customers.',
        },
      ],
      userRoles: [
        {
          name: 'Customer',
          description: 'Browses and purchases products.',
          permissions: ['Browse catalog', 'Place orders', 'View own order history'],
        },
        {
          name: 'Vendor',
          description: "Manages their own store's products and orders.",
          permissions: ['Manage own product catalog', 'View and update own orders', 'View own sales data'],
        },
        {
          name: 'Admin',
          description: 'Platform-level operator (relevant in multi-vendor mode).',
          permissions: ['Approve/manage vendors', 'View platform-wide orders', 'Manage platform settings'],
        },
      ],
      businessRules: [
        {
          rule: "An order cannot be marked 'shipped' without available stock at time of confirmation.",
          rationale: 'Prevents overselling out-of-stock items, a common source of customer complaints.',
        },
        {
          rule: 'COD orders above a configurable threshold may require phone confirmation.',
          rationale: 'Reduces fake/prank COD orders, a known pain point for Indian D2C sellers.',
        },
        {
          rule: 'GST invoices are only generated for vendors who have provided a valid GSTIN.',
          rationale: 'Invoice generation without a GSTIN would be non-compliant.',
        },
      ],
      dataEntities: [
        {
          name: 'Product',
          description: 'An item for sale.',
          keyFields: ['name', 'price', 'stock', 'images', 'category'],
          relationships: ['Belongs to Vendor', 'Has many OrderItems'],
        },
        {
          name: 'Order',
          description: 'A customer purchase.',
          keyFields: ['customer', 'items', 'status', 'paymentMethod', 'total'],
          relationships: ['Belongs to Customer', 'Belongs to Vendor', 'Has many OrderItems'],
        },
        {
          name: 'Vendor',
          description: 'A shop/seller on the platform.',
          keyFields: ['storeName', 'gstin (optional)', 'address', 'payoutDetails'],
          relationships: ['Has many Products', 'Has many Orders'],
        },
        {
          name: 'Customer',
          description: 'A buyer.',
          keyFields: ['name', 'phone', 'addresses'],
          relationships: ['Has many Orders'],
        },
      ],
      integrations: [
        { name: 'Razorpay', purpose: 'Card, UPI, netbanking, and wallet payment processing.', required: true },
        { name: 'WhatsApp Business API', purpose: 'Order and status notifications.', required: true },
        {
          name: 'Shiprocket or Delhivery',
          purpose: 'Shipping label generation and delivery tracking.',
          required: false,
        },
        { name: 'SMS gateway', purpose: 'Order updates for customers without WhatsApp.', required: false },
      ],
      compliance: [
        {
          name: 'GST invoicing',
          description: 'GST-registered vendors must issue GST-compliant invoices for taxable sales.',
          region: 'India',
        },
        {
          name: 'Consumer Protection (E-Commerce) Rules',
          description: 'Requires clear seller identity, return/refund policy, and grievance contact on the storefront.',
          region: 'India',
        },
      ],
      uiPatterns: [
        {
          name: 'Sticky add-to-cart',
          description: 'Add-to-cart action remains reachable while scrolling product details, especially on mobile.',
        },
        {
          name: 'Trust signals at checkout',
          description: 'Payment security badges and clear COD/return policy shown before payment step.',
        },
        {
          name: 'Low-stock urgency indicator',
          description: "'Only 2 left' style indicators to reflect real stock and encourage purchase.",
        },
      ],
      navigation: [
        { label: 'Home', description: 'Featured products and categories.' },
        {
          label: 'Catalog',
          description: 'Full product listing with filters.',
          children: ['Category pages', 'Search results'],
        },
        { label: 'Cart', description: 'Current cart contents.' },
        { label: 'Orders', description: "Customer's own order history." },
        { label: 'Vendor Dashboard', description: 'Vendor-only store management area.' },
      ],
      dashboardSuggestions: [
        {
          name: 'Sales Overview',
          description: 'Revenue and order count trends.',
          metrics: ["Today's sales", 'Orders this week', 'Average order value'],
        },
        {
          name: 'Inventory Health',
          description: 'Stock-level visibility.',
          metrics: ['Low-stock products', 'Out-of-stock products'],
        },
      ],
      reports: [
        { name: 'Sales Report', description: 'Revenue and order volume by period.', audience: 'Vendor / Shop Owner' },
        {
          name: 'GST Sales Summary',
          description: 'Taxable sales summary for filing.',
          audience: 'Vendor / Accountant',
        },
      ],
      notifications: [
        { name: 'Order confirmation', trigger: 'Customer completes checkout', channel: 'WhatsApp' },
        { name: 'New order alert', trigger: 'Order placed', channel: 'WhatsApp' },
        { name: 'Order shipped', trigger: 'Vendor marks order shipped', channel: 'WhatsApp' },
        { name: 'Low stock alert', trigger: 'Product stock falls below threshold', channel: 'In-app' },
      ],
      security: [
        {
          concern: 'Payment data exposure',
          mitigation:
            'Payment details are handled entirely by Razorpay; the platform never stores card/UPI credentials directly.',
        },
        {
          concern: "Vendor accessing another vendor's orders/products",
          mitigation: "Row-level access scoping so a vendor only ever sees their own store's data.",
        },
      ],
      performanceExpectations: [
        { metric: 'Product catalog load time', target: 'Under 2 seconds on 4G for a 100-product catalog' },
        { metric: 'Checkout completion', target: 'Under 90 seconds from cart to payment confirmation' },
      ],
      testingScenarios: [
        {
          scenario: 'Customer completes a UPI payment',
          expectedOutcome: "Order status updates to 'confirmed' and WhatsApp confirmation is sent",
        },
        {
          scenario: 'Customer selects COD at checkout',
          expectedOutcome: "Order is created without requiring upfront payment, marked 'pending confirmation'",
        },
        {
          scenario: "Vendor updates stock to zero while item is in another customer's cart",
          expectedOutcome: 'Checkout blocks the purchase with an out-of-stock message',
        },
        {
          scenario: "Vendor attempts to view another vendor's orders",
          expectedOutcome: 'Access is denied',
        },
      ],
      deploymentConsiderations: [
        {
          consideration: 'Payment gateway KYC',
          detail:
            'Razorpay account activation requires vendor KYC/business documents — plan onboarding time accordingly.',
        },
        {
          consideration: 'Regional hosting/latency',
          detail: 'Hosting close to the target customer base (India) improves catalog and checkout performance.',
        },
      ],
      futureEnhancements: [
        {
          idea: 'Regional marketplace expansion',
          description: 'Support multiple vendors under one shared storefront brand.',
        },
        { idea: 'Subscription/repeat-order support', description: 'Recurring orders for consumables like groceries.' },
      ],
    },
  },
  {
    id: 'shopify-app',
    name: 'Shopify App',
    icon: '🛒',
    description: 'Custom apps and extensions for Shopify stores.',
    category: 'Commerce',
    productType: 'Shopify App / Extension',
    recommendedStack: ['Next.js', 'Shopify App Bridge', 'Shopify Admin API', 'Webhooks'],
    recommendedIntegrations: ['Shopify OAuth', 'Shopify Webhooks', 'Shopify Billing API'],
    recommendedNextSteps: [
      'Register app with Shopify Partners',
      'Set up OAuth flow',
      'Define required webhooks',
      'Plan billing via Shopify Billing API',
    ],
    roadmap: [
      { key: 'requirements', title: 'Requirements', description: 'Define business requirements.' },
      { key: 'app-structure', title: 'App Structure', description: 'Register the app and define its structure.' },
      { key: 'authentication', title: 'Authentication', description: 'Set up the Shopify OAuth flow.' },
      { key: 'polaris-ui', title: 'Polaris UI', description: 'Build the UI with Shopify Polaris.' },
      { key: 'app-bridge', title: 'App Bridge', description: 'Integrate Shopify App Bridge.' },
      { key: 'webhooks', title: 'Webhooks', description: 'Define required Shopify webhooks.' },
      { key: 'billing', title: 'Billing', description: 'Plan billing via the Shopify Billing API.' },
      { key: 'testing', title: 'Testing', description: 'Test the app against a development store.' },
      { key: 'deployment', title: 'Deployment', description: 'Submit and deploy the app.' },
    ],
    targetUsers: 'Shopify merchants and app developers',
    defaultStatus: 'Planning',
    enabled: true,
  },
  {
    id: 'ai-agent',
    name: 'AI Agent',
    icon: '🤖',
    description: 'An autonomous or assistant-style AI agent product.',
    category: 'AI',
    productType: 'AI Agent / Assistant',
    recommendedStack: ['MCP Servers', 'Tool Calling', 'Vector Knowledge Base', 'Agent Memory'],
    recommendedIntegrations: ['MCP Servers', 'Browser Automation', 'Knowledge Base', 'Memory Store'],
    recommendedNextSteps: [
      'Define the agent’s goal and tools',
      'Connect MCP servers',
      'Set up knowledge base',
      'Design memory and workflow steps',
    ],
    roadmap: [
      { key: 'requirements', title: 'Requirements', description: 'Define business requirements.' },
      { key: 'architecture', title: 'Architecture', description: "Define the agent's goal, tools, and architecture." },
      { key: 'memory', title: 'Memory', description: 'Design agent memory and state.' },
      { key: 'knowledge-base', title: 'Knowledge Base', description: 'Set up the knowledge base.' },
      { key: 'tool-calling', title: 'Tool Calling', description: 'Define and wire up tool calling.' },
      { key: 'mcp', title: 'MCP', description: 'Connect MCP servers.' },
      { key: 'browser-automation', title: 'Browser Automation', description: 'Set up browser automation, if needed.' },
      { key: 'testing', title: 'Testing', description: 'Test agent behavior end-to-end.' },
      { key: 'deployment', title: 'Deployment', description: 'Deploy the agent.' },
    ],
    targetUsers: 'Teams building AI-driven automation',
    defaultStatus: 'Planning',
    enabled: true,
    content: {
      schemaVersion: 1,
      executiveSummary: {
        summary:
          "An autonomous or assistant-style AI agent product — a system that uses an LLM plus tools, memory, and knowledge to accomplish tasks on a user's behalf, rather than a traditional request/response app.",
        valueProposition:
          'Lets a team turn a repetitive or expert-driven workflow into an always-available AI teammate that can reason, use tools, and remember context across interactions.',
      },
      businessDomain: {
        industry: 'AI / Software Automation',
        category: 'AI Product',
        description:
          'Teams building an AI-driven assistant or autonomous agent — internal productivity tools, customer-facing support agents, or task-automation systems.',
      },
      typicalCustomers: [
        'Internal teams automating repetitive workflows',
        'Startups building an AI-native product feature',
        'Customer support teams deploying an AI assistant',
        'Operations teams automating multi-step processes across tools',
      ],
      customerPersonas: [
        {
          name: 'Karthik, Product Manager',
          role: 'Product Manager',
          description: 'Wants to ship an AI agent feature that actually completes tasks, not just answers questions.',
          goals: [
            'Agent reliably completes multi-step tasks',
            'Clear visibility into what the agent did and why',
            'Safe failure modes when the agent is uncertain',
          ],
          painPoints: [
            'AI hallucination undermining user trust',
            'Hard to debug why an agent made a decision',
            'Unclear cost/latency tradeoffs of tool calls',
          ],
        },
        {
          name: 'Meera, Operations Lead',
          role: 'End user of an internal agent',
          description: 'Uses the agent daily to handle a repetitive workflow (e.g. ticket triage, data lookups).',
          goals: [
            'Save time on repetitive tasks',
            'Trust the agent enough to act without double-checking everything',
            'Easily correct the agent when it is wrong',
          ],
          painPoints: [
            "Doesn't trust automation with important decisions",
            'Wants an easy way to intervene or override',
          ],
        },
      ],
      businessGoals: [
        {
          goal: 'Reliable task completion',
          description: 'The agent should complete the tasks it is given, not just produce plausible-sounding text.',
          priority: 'high',
        },
        {
          goal: 'Transparent reasoning',
          description: 'Users and operators should be able to see what the agent did and why.',
          priority: 'high',
        },
        {
          goal: 'Safe tool use',
          description:
            "The agent should only take actions it's authorized for, with guardrails against destructive mistakes.",
          priority: 'high',
        },
        {
          goal: 'Continuous improvement via memory',
          description:
            'The agent should get better/more personalized over time using memory, not just a static prompt.',
          priority: 'medium',
        },
      ],
      coreBusinessProcesses: [
        {
          name: 'Task execution',
          description: 'A user gives the agent a goal and the agent works toward it.',
          steps: [
            'User states a goal or task',
            'Agent plans required steps',
            'Agent calls tools/APIs as needed',
            'Agent evaluates results and iterates if needed',
            'Agent reports outcome to the user',
          ],
        },
        {
          name: 'Knowledge retrieval',
          description: 'The agent answers a question using its knowledge base.',
          steps: [
            'User asks a question',
            'Agent searches the knowledge base',
            'Agent synthesizes an answer with sources',
            "Agent flags if it's uncertain or found nothing relevant",
          ],
        },
        {
          name: 'Human handoff',
          description: "The agent escalates when it can't or shouldn't proceed alone.",
          steps: [
            'Agent detects it is out of scope, low-confidence, or a high-stakes action',
            'Agent pauses and explains why',
            'A human reviews and approves, corrects, or takes over',
          ],
        },
      ],
      functionalModules: [
        {
          name: 'Tool Calling',
          description: "The agent's ability to invoke external functions/APIs.",
          features: [
            'Tool registry/definitions',
            'Structured tool-call execution',
            'Result parsing back into agent context',
          ],
        },
        {
          name: 'Knowledge Base',
          description: 'Retrieval-augmented knowledge the agent can draw on.',
          features: ['Document ingestion', 'Vector search/retrieval', 'Source citation in responses'],
        },
        {
          name: 'Memory',
          description: 'Persistent context across sessions.',
          features: [
            'Short-term (session) memory',
            'Long-term (persistent) memory',
            'Memory retrieval relevant to current task',
          ],
        },
        {
          name: 'MCP Servers',
          description: 'Standardized connections to external tools and data sources.',
          features: ['MCP server registration', 'Tool/resource discovery', 'Secure credential handling per server'],
        },
      ],
      standardFeatures: [
        { name: 'Tool calling', description: 'Structured function calls the agent can use to take real actions.' },
        { name: 'Conversation memory', description: 'Retains context within a session.' },
        {
          name: 'Knowledge base retrieval',
          description: 'Grounds answers in real, indexed source material rather than model memory alone.',
        },
        { name: 'Action logging/audit trail', description: 'Records what the agent did, with what inputs, and why.' },
      ],
      optionalFeatures: [
        {
          name: 'Persistent long-term memory',
          description: 'Remembers user preferences/history across sessions, not just within one.',
        },
        { name: 'Browser automation', description: 'Lets the agent interact with web UIs that have no API.' },
        {
          name: 'Multi-agent orchestration',
          description: 'Coordinates multiple specialized agents for complex workflows.',
        },
        {
          name: 'Human-in-the-loop approval gates',
          description: 'Requires explicit human approval before high-stakes actions.',
        },
        {
          name: 'Custom voice/channel interfaces',
          description: 'Voice, Slack, or WhatsApp front-ends to the same agent.',
        },
      ],
      userRoles: [
        {
          name: 'End User',
          description: 'Interacts with the agent to accomplish tasks or get answers.',
          permissions: ['Send requests to the agent', 'View agent responses and action history'],
        },
        {
          name: 'Agent Operator/Admin',
          description: "Configures the agent's tools, knowledge base, and guardrails.",
          permissions: [
            'Manage tool access',
            'Manage knowledge base content',
            'Review agent action logs',
            'Configure approval gates',
          ],
        },
      ],
      businessRules: [
        {
          rule: 'The agent must not take an irreversible or high-stakes action without explicit confirmation, unless pre-authorized.',
          rationale:
            'Irreversible mistakes (e.g. sending an email, deleting data) are the highest-cost failure mode for an autonomous agent.',
        },
        {
          rule: 'Every tool call and its result must be logged.',
          rationale: 'Debuggability and trust both depend on being able to reconstruct exactly what the agent did.',
        },
        {
          rule: 'The agent must explicitly state uncertainty rather than presenting a guess as fact.',
          rationale: 'Silent hallucination is the primary trust-breaking failure mode for AI agents.',
        },
      ],
      dataEntities: [
        {
          name: 'Conversation',
          description: 'A session between a user and the agent.',
          keyFields: ['user', 'messages', 'startedAt'],
          relationships: ['Has many Messages', 'Has many ActionLogs'],
        },
        {
          name: 'ActionLog',
          description: 'A record of one tool call/action the agent took.',
          keyFields: ['tool', 'input', 'output', 'timestamp', 'outcome'],
          relationships: ['Belongs to Conversation'],
        },
        {
          name: 'KnowledgeDocument',
          description: 'A source document indexed for retrieval.',
          keyFields: ['title', 'content', 'source', 'embeddings'],
          relationships: [],
        },
        {
          name: 'MemoryRecord',
          description: 'A persisted fact or preference about a user/context.',
          keyFields: ['subject', 'fact', 'confidence', 'recordedAt'],
          relationships: ['Belongs to User'],
        },
      ],
      integrations: [
        { name: 'MCP Servers', purpose: 'Standardized tool/resource access to external systems.', required: true },
        { name: 'Vector database', purpose: 'Knowledge base storage and semantic retrieval.', required: true },
        { name: 'LLM provider API', purpose: 'The underlying reasoning/generation model.', required: true },
        { name: 'Browser automation service', purpose: 'Interacting with web UIs lacking an API.', required: false },
      ],
      compliance: [
        {
          name: 'Data handling for user conversations',
          description:
            'Conversation and memory data should be handled per applicable privacy regulations, with a clear retention/deletion policy.',
          region: 'Global',
        },
        {
          name: 'AI transparency disclosure',
          description: 'Users should be informed they are interacting with an AI agent, not a human.',
          region: 'Global',
        },
      ],
      uiPatterns: [
        {
          name: 'Streaming responses',
          description:
            'Agent output streams incrementally rather than appearing all at once, reducing perceived latency.',
        },
        {
          name: 'Visible reasoning/action trace',
          description: 'Shows the user what tools the agent used and why, not just the final answer.',
        },
        {
          name: 'Inline confirmation prompts',
          description: 'For high-stakes actions, the agent asks for confirmation inline before proceeding.',
        },
      ],
      navigation: [
        { label: 'Chat', description: 'Primary conversational interface with the agent.' },
        { label: 'Action History', description: 'Log of past agent actions and outcomes.' },
        { label: 'Knowledge Base', description: 'Manage documents the agent can retrieve from.' },
        { label: 'Settings', description: 'Tool access, guardrails, and integration configuration.' },
      ],
      dashboardSuggestions: [
        {
          name: 'Agent Activity',
          description: 'Overview of agent usage and outcomes.',
          metrics: ['Tasks completed', 'Tasks escalated to human', 'Average response time'],
        },
        {
          name: 'Tool Usage',
          description: 'Which tools the agent relies on most.',
          metrics: ['Calls per tool', 'Tool success/failure rate'],
        },
      ],
      reports: [
        {
          name: 'Agent Performance Report',
          description: 'Task completion rate and escalation rate over time.',
          audience: 'Agent Operator/Admin',
        },
        {
          name: 'Action Audit Log Export',
          description: 'Full record of agent actions for a given period.',
          audience: 'Compliance/Admin',
        },
      ],
      notifications: [
        {
          name: 'Task escalated to human',
          trigger: 'Agent hits a low-confidence or high-stakes decision point',
          channel: 'In-app',
        },
        { name: 'Tool call failure', trigger: 'A tool call errors or times out', channel: 'In-app' },
      ],
      security: [
        {
          concern: 'Prompt injection via retrieved content or tool output',
          mitigation:
            "Treat retrieved/tool content as untrusted data, not instructions; sanitize before re-inserting into the agent's context.",
        },
        {
          concern: 'Over-privileged tool access',
          mitigation:
            "Scope each tool's credentials/permissions to the minimum required, per the principle of least privilege.",
        },
        {
          concern: 'Sensitive data leakage via memory or logs',
          mitigation: 'Redact or exclude sensitive fields before persisting to memory or action logs.',
        },
      ],
      performanceExpectations: [
        { metric: 'First-token latency', target: 'Under 2 seconds for a typical request' },
        {
          metric: 'Tool call timeout',
          target: 'Configurable per tool, with a sane default (e.g. 10-30 seconds) and graceful failure',
        },
      ],
      testingScenarios: [
        {
          scenario: 'Agent is given a task requiring three chained tool calls',
          expectedOutcome: 'Agent completes all three steps in order and reports the final outcome accurately',
        },
        {
          scenario: 'A tool call fails mid-task',
          expectedOutcome: 'Agent surfaces the failure rather than fabricating a success',
        },
        {
          scenario: 'Agent is asked something outside its knowledge base and tools',
          expectedOutcome: "Agent states it doesn't know rather than guessing",
        },
        {
          scenario: 'Agent is about to take an irreversible action',
          expectedOutcome: 'Agent requests confirmation before proceeding',
        },
      ],
      deploymentConsiderations: [
        {
          consideration: 'LLM provider selection',
          detail:
            'Choice of model affects cost, latency, and tool-calling reliability — should be configurable, not hardcoded.',
        },
        {
          consideration: 'Rate limiting and cost control',
          detail: 'Agent usage should be rate-limited and monitored to avoid runaway API costs from loops or misuse.',
        },
      ],
      futureEnhancements: [
        {
          idea: 'Multi-agent collaboration',
          description: 'Specialized sub-agents handling different parts of a complex task.',
        },
        {
          idea: 'Self-improving memory curation',
          description: 'Agent periodically reviews and consolidates its own long-term memory.',
        },
      ],
    },
  },
  {
    id: 'saas-starter',
    name: 'SaaS Starter',
    icon: '🚀',
    description: 'A foundation for subscription-based software products.',
    category: 'SaaS',
    productType: 'Subscription SaaS Product',
    recommendedStack: ['Next.js', 'Supabase', 'Tailwind CSS', 'Razorpay', 'UPI', 'Cashfree'],
    recommendedIntegrations: ['Supabase Auth', 'Razorpay Subscriptions', 'UPI', 'Cashfree', 'Email Notifications'],
    recommendedNextSteps: [
      'Define pricing plans',
      'Set up authentication',
      'Plan billing with Razorpay/UPI/Cashfree',
      'Design onboarding flow',
    ],
    roadmap: [
      { key: 'requirements', title: 'Requirements', description: 'Define business requirements.' },
      { key: 'pricing-plans', title: 'Pricing Plans', description: 'Define subscription pricing plans.' },
      { key: 'authentication', title: 'Authentication', description: 'Set up user authentication.' },
      {
        key: 'billing',
        title: 'Billing',
        description: 'Plan billing with Razorpay, UPI, or Cashfree.',
      },
      { key: 'onboarding', title: 'Onboarding', description: 'Design the onboarding flow.' },
      { key: 'testing', title: 'Testing', description: 'Test core flows end-to-end.' },
      { key: 'deployment', title: 'Deployment', description: 'Deploy the product.' },
    ],
    targetUsers: 'Teams building subscription software',
    defaultStatus: 'Planning',
    enabled: true,
  },
  {
    id: 'mobile-app',
    name: 'Mobile App',
    icon: '📱',
    description: 'A companion or standalone mobile application.',
    category: 'Mobile',
    productType: 'Mobile Application',
    recommendedStack: ['React Native', 'Expo'],
    recommendedIntegrations: ['Push Notifications', 'Supabase Auth'],
    recommendedNextSteps: ['Define core screens', 'Set up navigation', 'Plan app store release'],
    roadmap: [
      { key: 'requirements', title: 'Requirements', description: 'Define business requirements.' },
      { key: 'core-screens', title: 'Core Screens', description: 'Define the app’s core screens.' },
      { key: 'navigation', title: 'Navigation', description: 'Set up app navigation.' },
      { key: 'authentication', title: 'Authentication', description: 'Set up user authentication.' },
      { key: 'push-notifications', title: 'Push Notifications', description: 'Add push notifications.' },
      { key: 'app-store-release', title: 'App Store Release', description: 'Plan the app store release.' },
      { key: 'deployment', title: 'Deployment', description: 'Deploy/publish the app.' },
    ],
    targetUsers: 'Teams building a mobile companion app',
    defaultStatus: 'Planning',
    enabled: true,
  },
  {
    id: 'marketing-website',
    name: 'Marketing Website',
    icon: '🌐',
    description: 'A marketing site focused on conversion and brand.',
    category: 'Website',
    productType: 'Marketing / Brand Website',
    recommendedStack: ['Next.js', 'Tailwind CSS'],
    recommendedIntegrations: ['SEO', 'Analytics', 'Contact Form'],
    recommendedNextSteps: ['Define brand sections', 'Add SEO metadata', 'Add analytics'],
    roadmap: [
      { key: 'requirements', title: 'Requirements', description: 'Define business requirements.' },
      { key: 'brand-sections', title: 'Brand Sections', description: 'Define the site’s brand sections.' },
      { key: 'seo', title: 'SEO', description: 'Add SEO metadata.' },
      { key: 'analytics', title: 'Analytics', description: 'Add analytics tracking.' },
      { key: 'contact-form', title: 'Contact Form', description: 'Add a contact form.' },
      { key: 'deployment', title: 'Deployment', description: 'Deploy the website.' },
    ],
    targetUsers: 'Marketing and brand teams',
    defaultStatus: 'Planning',
    enabled: true,
  },
  {
    id: 'nextjs-saas',
    name: 'Next.js SaaS',
    icon: '⚡',
    description: 'A Next.js-flavored foundation for SaaS products.',
    category: 'SaaS',
    productType: 'Next.js SaaS Product',
    recommendedStack: ['Next.js', 'Supabase', 'Tailwind CSS', 'Razorpay', 'UPI'],
    recommendedIntegrations: ['Supabase Auth', 'Razorpay', 'UPI', 'Email Notifications'],
    recommendedNextSteps: ['Set up authentication', 'Plan billing with Razorpay/UPI', 'Design dashboard'],
    roadmap: [
      { key: 'requirements', title: 'Requirements', description: 'Define business requirements.' },
      { key: 'authentication', title: 'Authentication', description: 'Set up user authentication.' },
      { key: 'billing', title: 'Billing', description: 'Plan billing with Razorpay/UPI.' },
      { key: 'dashboard', title: 'Dashboard', description: 'Design the product dashboard.' },
      { key: 'testing', title: 'Testing', description: 'Test core flows end-to-end.' },
      { key: 'deployment', title: 'Deployment', description: 'Deploy the product.' },
    ],
    targetUsers: 'Teams building a Next.js-based SaaS product',
    defaultStatus: 'Planning',
    enabled: true,
  },
];

/** id of the blueprint used when a project has none, or an unrecognized one. */
export const DEFAULT_BLUEPRINT_ID = 'blank-project';
