# Builders

<div align="center">

**AI Product Engineering Platform**

[![License](https://img.shields.io/badge/License-MIT-green.svg)](#license)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](#technology-stack)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white)](#technology-stack)
[![Remix](https://img.shields.io/badge/Remix-2.15-000000?logo=remix&logoColor=white)](#technology-stack)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-Ready-F38020?logo=cloudflare&logoColor=white)](#technology-stack)
[![Electron](https://img.shields.io/badge/Electron-Desktop-47848F?logo=electron&logoColor=white)](#technology-stack)

> Logo placeholder: insert the Builders wordmark or icon here.

</div>

Builders is an AI product engineering platform that coordinates specialized AI engineers to turn an idea into a complete software product.

> [!NOTE]
> This README reflects the repository as implemented today. Items marked as future work are based on code comments and documentation in the repo, not on assumptions.

## Documentation

There are two levels of user documentation. Start with the first one.

### 1. [Getting Started Guide](docs/GETTING_STARTED.md) — recommended for new users

The friendly, non-technical introduction. Written for project managers, business analysts, sales,
product owners, and anyone evaluating Builders. No technical knowledge needed.

Takes you from signing in to a working application: creating a project, explaining your business,
reviewing requirements, generating the app, and what to do when something looks wrong — with
worked examples throughout.

### 2. [User Guide](docs/USER_GUIDE.md) — complete reference manual

The full detail, for when you need it. Every screen, every artifact, every setting: Business
Discovery, the Knowledge Ledger, the Product Package, the Technical Architecture Specification,
the generation pipeline, reviews, activity history, known limitations, troubleshooting, and
tester guidelines.

### Other documents

| Document | Audience | What it covers |
|---|---|---|
| [Observability](docs/10-Operations/Observability.md) | Operators, engineering | AI usage, token and cost tracking, and the Observability module architecture |
| [Project Lifecycle](docs/10-Operations/Project-Lifecycle.md) | All users | Active/Archived/Deleted projects, archiving, restoring and bulk management |
| [Executive Summary](docs/00-EXECUTIVE-SUMMARY.md) | Stakeholders | High-level overview of the platform |
| [Product Requirements](docs/00-PRODUCT-REQUIREMENTS.md) | Product and engineering | What Builders itself is required to do |
| [Documentation Roadmap](docs/DOCUMENTATION-ROADMAP.md) | Contributors | How the `docs/` tree is organised |
| [Contributing](CONTRIBUTING.md) | Contributors | Development setup and contribution workflow |

> [!TIP]
> Sending Builders to someone for the first time? Send them the
> [Getting Started Guide](docs/GETTING_STARTED.md) — it is written to be read on its own.
> Testers should also read [Section 17 — Tester Guidelines](docs/USER_GUIDE.md#17-tester-guidelines)
> and use the bug-report format described there.

## Vision

**Mission:** Build the platform once. Build unlimited products.

Builders is designed to work like a software engineering organization, not a single prompt box. It helps teams move from business intent to requirements, analysis, architecture, roadmapping, engineering, review, packaging, application generation, and deployment.

## What Is Builders?

Builders follows a complete product lifecycle:

```text
Business idea
  ↓
Requirements
  ↓
Analysis
  ↓
Architecture
  ↓
Roadmap
  ↓
Engineering
  ↓
Reviews
  ↓
Packaging
  ↓
Application generation
  ↓
Deployment
```

At a practical level, Builders combines:

- A browser-based development workspace
- An AI engineering team with role-specific outputs
- A product package that assembles the approved work from those roles
- A code generation pipeline that turns that package into runnable application files
- Preview, testing, version control, and deployment workflows

## Why Builders?

A single coding assistant can write code. Builders is structured to do more than that.

| Single assistant | Builders |
|---|---|
| Works on the whole task in one pass | Splits work into specialized engineering roles |
| Can drift across business, design, backend, and delivery concerns | Keeps each concern in its own artifact and review loop |
| Often produces code before the product is fully understood | Starts with requirements, analysis, and architecture |
| Makes review harder when everything is mixed together | Produces a product package that is easier to inspect, approve, and reuse |
| Best for ad hoc code help | Better suited for end-to-end product engineering |

The result is higher confidence, clearer handoffs, and better control over quality.

## Key Features

### AI Product Engineering

- Multi-role AI engineering pipeline
- Human-approved requirements at the front of the flow
- Role-specific artifacts for architecture, database, UI/UX, backend, frontend, QA, and DevOps
- Product package assembly from approved outputs
- Code generation pipeline that builds on the assembled package

### Development Workspace

- Browser-based workspace
- Code editor
- File tree
- Search
- Integrated terminal
- Live preview
- Diff view
- File locking to reduce conflicting edits

### Project Management

- Project and task tracking
- Engineering timeline and roadmap views
- Read-only readiness and health panels
- Snapshot and history support
- Draft approval and discard flows

### Code Generation

- Deterministic planning before generation
- Shared components and page generation
- Structured prompts built from approved artifacts
- Validation of generated files before assembly

### Reviews

- Draft review panels for each engineering role
- Manual approve/discard control
- AI decision history and context capture
- Review-aware generation gating

### Packaging

- Product package assembly
- Markdown summaries for approved work
- Source traceability for assembled files
- Missing-section handling when parts of the product are not ready yet

### Deployment

- Cloudflare Pages deployment
- Vercel deployment
- Netlify deployment
- GitHub Pages deployment
- Native desktop packaging with Electron

### GitHub and GitLab

- Repository import and cloning
- Git proxying
- GitHub integration
- GitLab integration
- Branch and deployment helpers

### Supabase

- Generated-app Supabase integration
- Query support
- Project and auth-related connection helpers
- Separate BuildersDB persistence seam documented for future cloud control-plane storage

### Browser IDE

- React-based interface
- Remix routes and server actions
- In-browser editing and preview
- Drag and drop support
- Toast notifications
- Theme persistence

### Templates

Current blueprints include:

- Blank Project
- Business Website
- LocalShop India
- Shopify App
- AI Agent
- SaaS Starter
- Mobile App
- Marketing Website
- Next.js SaaS

## AI Engineering Team

Builders currently implements an eight-role engineering chain.

| Role | Artifact | Responsibility |
|---|---|---|
| Business Analyst | Requirements Draft | Captures the business problem, goals, users, and core requirements |
| Solution Architect | Architecture Draft | Defines the system structure, modules, and technical direction |
| Database Engineer | Database Draft | Designs entities, relationships, and data model decisions |
| UX Engineer | UI/UX Draft | Defines the user experience, screens, and interaction patterns |
| Backend Engineer | Backend Draft | Defines APIs, business logic, and server-side behavior |
| Frontend Engineer | Frontend Draft | Defines pages, components, and client-side implementation |
| QA Engineer | QA Draft | Defines test coverage, validation approach, and quality checks |
| DevOps Engineer | DevOps Draft | Defines deployment, environment, and operational setup |

> [!IMPORTANT]
> The project manager view is implemented as a deterministic readiness layer, not as an AI role. It evaluates whether the project is ready for generation.

## Product Workflow

```text
Business idea
  ↓
Requirements
  ↓
Analysis
  ↓
Architecture
  ↓
Roadmap
  ↓
Engineering roles
  ↓
Reviews
  ↓
Product package
  ↓
Application generation
  ↓
Live preview
  ↓
Deployment
```

The internal engineering chain runs through the implemented roles in this order:

```text
Requirements
  ↓
Solution Architect
  ↓
Database Engineer
  ↓
UX Engineer
  ↓
Backend Engineer
  ↓
Frontend Engineer
  ↓
QA Engineer
  ↓
DevOps Engineer
```

## Architecture

### Frontend

- React 18 UI built with Remix
- Route-based application shell in `app/routes`
- Component system in `app/components`
- Shared state through nanostores and React hooks
- Editor, sidebar, chat, preview, and deployment panels

### Backend

- Remix loaders and actions
- Cloudflare Pages / Workers runtime
- API routes under `app/routes/api.*`
- GitHub, GitLab, Vercel, Netlify, MCP, and Supabase service adapters

### Database

- Supabase integration for generated applications
- Local persistence for the Builders workspace
- BuildersDB seam for future platform-level persistence
- Browser storage via localStorage and IndexedDB-backed helpers

### AI Layer

- AI SDK provider registry
- Provider-specific model adapters
- Prompt builders for chat, requirements, architecture, backend, frontend, QA, and DevOps
- Context builders that pass approved upstream work into the next role
- Engineering pipeline, planning, review, and assembly modules

### Storage

- Local project store
- Persistence helpers for chats, locks, and settings
- Import/export support
- Git-backed project workflows

### Execution

- WebContainer for in-browser execution
- Integrated terminal
- File writes and previews
- Generation pipeline and validation stages
- Electron desktop build path for native packaging

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Language | TypeScript 5.7 | Type-safe application and toolchain code |
| UI | React 18 | Component-based user interface |
| App framework | Remix 2.15 | Routed app shell, loaders, and actions |
| Build tooling | Vite 5 | Fast dev server and production bundling |
| Runtime | Node.js 20.18+ | Local development and tooling |
| Package manager | pnpm 9.14.4 | Dependency and script management |
| Styling | UnoCSS, SCSS, Tailwind reset | UI styling and theming |
| Editor | CodeMirror | Source editing experience |
| Terminal | xterm.js | In-browser terminal |
| LLM SDK | Vercel AI SDK 4.x | Model access and generation plumbing |
| AI providers | Anthropic, OpenAI, Google, and more | Multi-provider model support |
| State | Nano Stores, Zustand | Client and workspace state |
| Storage | localStorage, IndexedDB helpers, Supabase JS | Workspace persistence and generated-app data |
| Git | isomorphic-git, Octokit | Repository and GitHub workflows |
| Preview / sandbox | WebContainer API | In-browser execution and live preview |
| Desktop | Electron | Native desktop packaging |
| Deployment | Cloudflare Pages, Vercel, Netlify, GitHub Pages | Shipping generated applications |

## Supported AI Providers

The registry currently supports these providers:

| Provider | Notes |
|---|---|
| Anthropic | Static and dynamic Claude model support |
| OpenAI | Direct OpenAI API access |
| Google | Gemini models |
| Groq | Fast model inference |
| Mistral | Mistral and Codestral models |
| Cohere | Cohere models |
| Deepseek | DeepSeek chat, coder, and reasoning models |
| Together | OpenAI-compatible Together endpoint support |
| Perplexity | Perplexity Sonar models |
| Fireworks | Provider registered in the model registry |
| Cerebras | Provider registered in the model registry |
| HuggingFace | Provider registered in the model registry |
| Hyperbolic | OpenAI-compatible Hyperbolic endpoint support |
| Moonshot | Kimi and Moonshot models |
| Ollama | Local models via `OLLAMA_API_BASE_URL` |
| LM Studio | Local models via `LMSTUDIO_API_BASE_URL` |
| OpenRouter | Aggregated model marketplace access |
| OpenAI-compatible endpoints | Generic OpenAI-like providers |
| xAI | Grok models |
| GitHub Models | GitHub-hosted model access |
| Amazon Bedrock | AWS Bedrock model access |
| Z.ai | GLM models and dedicated coding endpoint |

> [!TIP]
> Many providers support dynamic model discovery when an API key is configured. Local providers use base URLs instead of hosted API keys.

## Screenshots

Replace these placeholders with real captures from the running app.

| Placeholder | Suggested capture |
|---|---|
| Workspace overview | Main chat, editor, file tree, and preview in one view |
| AI engineering team | Role pipeline with approvals and readiness state |
| Product package | Requirements, architecture, backend, frontend, QA, and DevOps artifacts |
| Deployment dialog | Vercel, Netlify, GitHub Pages, or Cloudflare deployment flow |

## Installation

### Requirements

- Node.js `>=20.18.0 <25.0.0`
- pnpm `9.14.4`
- Git

### Local Development

```bash
pnpm install
pnpm run dev
```

### Useful Scripts

```bash
pnpm run build
pnpm run preview
pnpm run test
pnpm run lint
pnpm run typecheck
```

### Docker

```bash
pnpm run dockerbuild
docker compose --profile development up
```

For a production-style container build, use:

```bash
pnpm run dockerbuild:prod
```

### Desktop App

```bash
pnpm electron:dev
pnpm electron:build:dist
```

Platform-specific Electron builds are also available:

```bash
pnpm electron:build:mac
pnpm electron:build:win
pnpm electron:build:linux
```

## Configuration

Configuration is driven primarily by environment variables in `.env.local`, `.env`, or the deployment environment.

For local development, copy the example file first:

```bash
cp .env.example .env.local
```

### AI Provider Variables

| Provider group | Variables |
|---|---|
| Hosted model APIs | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`, `PERPLEXITY_API_KEY`, `CEREBRAS_API_KEY`, `FIREWORKS_API_KEY`, `HYPERBOLIC_API_KEY`, `MOONSHOT_API_KEY`, `ZAI_API_KEY`, `GITHUB_API_KEY` |
| Local / custom endpoints | `OLLAMA_API_BASE_URL`, `LMSTUDIO_API_BASE_URL`, `OPENAI_LIKE_API_BASE_URL`, `OPENAI_LIKE_API_KEY`, `TOGETHER_API_BASE_URL`, `HYPERBOLIC_API_BASE_URL`, `ZAI_BASE_URL` |
| Provider selection / runtime | `DEFAULT_NUM_CTX`, `VITE_LOG_LEVEL`, `NODE_ENV`, `PORT` |

### Git And Deployment Variables

| Integration | Variables |
|---|---|
| GitHub | `VITE_GITHUB_ACCESS_TOKEN`, `VITE_GITHUB_TOKEN_TYPE` |
| GitLab | `VITE_GITLAB_ACCESS_TOKEN`, `VITE_GITLAB_URL`, `VITE_GITLAB_TOKEN_TYPE` |
| Vercel | `VITE_VERCEL_ACCESS_TOKEN` |
| Netlify | `VITE_NETLIFY_ACCESS_TOKEN` |

### Supabase And BuildersDB Variables

| Area | Variables |
|---|---|
| Generated-app Supabase | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_ACCESS_TOKEN` |
| Builders platform persistence | `BUILDERS_DB_SUPABASE_URL`, `BUILDERS_DB_SUPABASE_ANON_KEY` |

> [!IMPORTANT]
> `BUILDERS_DB_SUPABASE_URL` and `BUILDERS_DB_SUPABASE_ANON_KEY` are a separate control-plane seam for the Builders platform itself. They are different from the generated application's own Supabase connection.

### Provider Behavior

- Cloud providers are configured with API keys.
- Local providers use local base URLs.
- Some providers return static fallback models and can also discover dynamic models from their APIs.
- Provider settings can be managed in the app UI as well as through environment variables.

## Repository Structure

```text
.
├── app/
│   ├── components/        # Workspace UI, chat, sidebar, deploy, editor, and shared elements
│   ├── lib/               # AI, code generation, product assembly, persistence, stores, services
│   ├── routes/            # Remix pages and API routes
│   ├── styles/            # Global styling and animations
│   └── root.tsx           # App shell
├── assets/                # Static assets used by the app
├── docs/                  # Product and architecture documentation
├── electron/              # Electron main, preload, and renderer build config
├── functions/             # Serverless / edge function support files
├── icons/                 # App icons and related artwork
├── public/                # Public static files
├── scripts/               # Utility and maintenance scripts
├── supabase/              # Supabase-related local assets
├── Dockerfile             # Container build
├── docker-compose.yaml    # Local container workflows
├── package.json           # Scripts and dependencies
├── tsconfig.json          # TypeScript configuration
├── vite.config.ts         # Vite configuration
├── wrangler.toml          # Cloudflare deployment config
└── electron-builder.yml   # Electron packaging config
```

## Current Roadmap

> [!NOTE]
> This section reflects the current implementation status in the repository. It separates what is already shipped from what is still being worked on or planned.

### Completed

- Multi-provider AI registry
- Browser-based product engineering workspace
- Eight-role AI engineering team
- Project package assembly
- Code generation and live preview pipeline
- Integrated terminal and file editor
- Diff view and file locking
- GitHub and GitLab integration
- Supabase integration
- Deployment to Cloudflare Pages, Vercel, Netlify, and GitHub Pages
- Electron desktop app
- Project templates and blueprints
- MCP tool integration
- Data visualization and analysis tools

### In Progress

- Backend agent architecture
- Prompt optimization for smaller models
- Project planning documentation generation
- VS Code integration
- Document upload for knowledge and style guides
- Additional provider integrations

### Future

- BuildersDB cloud control-plane expansion
- Team workspaces and auth
- Secret management for Builders-owned data
- Generated Supabase project links and provisioning
- Broader generated-product automation
- More vertical templates and packaged product flows

## Contributing

We welcome focused improvements that make Builders more reliable, easier to use, and easier to extend.

Before opening a pull request:

1. Make your changes in a feature branch.
2. Run the relevant checks.
3. Include tests or validation when behavior changes.
4. Keep changes scoped and documented.

Recommended checks:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
```

If you are changing deployment, provider behavior, or generation workflows, include notes on what changed and how you verified it.

## License

MIT License

Copyright (c) 2024 StackBlitz, Inc. and bolt.diy contributors

The software is provided under the terms of the MIT License. See the `LICENSE` file for the full text.
