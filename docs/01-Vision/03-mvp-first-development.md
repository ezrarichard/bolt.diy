# MVP-First Development

## The Rule

Never generate everything at once. Every MVP produces a running application. MVP 1 is not a placeholder or a mockup — it is real, deployed, working software, deliberately small in scope.

A typical MVP 1: landing page, authentication, dashboard shell, navigation, responsive layout, mock data where real data isn't scoped yet. This is intentionally similar to what a human engineering team would demo in a first sprint review — not because it's impressive, but because it proves the foundation (routing, layout, auth, deploy path) works before any business logic is layered on top.

## Why the Current One-Pass Model Breaks Down at Scale

The current pipeline (`app/lib/projects/collaborationContext.ts::ROLE_ARTIFACT_CHAIN`) is not wrong — it correctly models role dependencies (Architecture depends on approved Requirements, Database depends on approved Architecture, and so on). The problem is that every stage in that chain reasons about **the entire product** in a single artifact. As product scope grows:

- Prompts grow with it — every role's context includes the full upstream chain (`buildersDbContextProvider.ts` appends prior role outputs to every prompt).
- LLM responses grow with it — large JSON role outputs have already been observed truncating mid-response, requiring the bounded-retry recovery logic built in Sprint 44.
- The generation plan (`GenerationPlan` in `codeGenerationTypes.ts`) grows with it — more pages, more entities, more API endpoints, more files to generate and validate in one pipeline run.
- Time-to-first-preview grows with it — the customer sees nothing until every role has run and the entire generation pipeline completes.

None of this is a bug in the current implementation. It is the direct, structural consequence of scope not being bounded before planning starts. MVP-first fixes this at the source: bound the scope first (Product Owner), and every downstream artifact and generation run is naturally smaller.

## What "Every MVP Compiles Independently" Actually Requires

This is the constraint that most changes the underlying engineering, and it deserves to be named plainly rather than treated as a UI slogan:

1. The generation engine must be able to **add to** an existing generated codebase, not just generate into an empty one. (Extension of the existing manifest engine — see [02-Architecture/03](../02-Architecture/03-generation-engine-create-modify-preserve.md).)
2. Files the customer has hand-edited in the Workbench between MVP N and MVP N+1 must not be silently overwritten. Nothing in the current file lifecycle (`ManifestFileStatus`) distinguishes "AI-generated, safe to regenerate" from "user-modified, must preserve or merge." This must be added before MVP-first ships past MVP 2, or the second MVP generation will destroy real customer work.
3. The running preview must survive across MVP boundaries, or "MVP 2 ready" will pay the same install/boot cost as a first generation — reintroducing the wait-time problem this whole vision exists to solve.

## What MVP-First Does Not Mean

- It does not mean generating a worse or fake version of the product. MVP 1 must be real, running code — not a mockup image or static screenshot.
- It does not mean the customer chooses arbitrary feature slices. The Product Owner determines MVP boundaries based on dependency order and risk, the same way a real product manager would refuse to ship a payments feature before authentication exists.
- It does not mean abandoning the existing 8-role pipeline. Every role still runs, just against a bounded scope per MVP instead of the whole product.
