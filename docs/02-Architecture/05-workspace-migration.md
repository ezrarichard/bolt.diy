# Workspace Migration: Toward a Unified Factory

## The Vision's Ask

A single workspace — Factory, Code, Preview — replacing today's collection of separate panels (Project Dashboard, Product Package, Generation Dashboard, Workbench), with the Dashboard eventually disappearing.

## What's Already There, Named Differently

The audit shows the vision's "Factory" contents largely already exist as separate, working panels:

| Vision's "Factory" Contains | Current Equivalent |
|---|---|
| Product Owner | Does not exist yet (see [02-ai-product-owner.md](02-ai-product-owner.md)) |
| MVP Roadmap | Does not exist yet |
| Current AI Engineer | `ProjectDefinitionWorkspace.tsx` / `useAutoEngineeringPipeline.ts` state |
| Timeline | `ProjectHistoryPanel.tsx` — already reads BuildersDB activity |
| Deliverables | `ProductPackagePanel.tsx` |
| Customer Review | `TaskDetailsDialog.tsx`, `ReviewComponents.tsx` |
| Release History | `ProjectHistoryPanel.tsx` (repair attempts + activity, already grouped) |
| Activity | `builders_project_activity`, rendered in `ProjectHistoryPanel.tsx` |

This means "unify into one workspace" is substantially an **information-architecture consolidation** — combining panels that already read from the same BuildersDB source of truth — not new capability. The risk in the vision's phrasing ("the Dashboard will eventually disappear... create a migration strategy") is treating this as a rewrite rather than a relabel-and-regroup.

## Recommended Migration Strategy (Additive, Not Destructive)

1. **Do not touch `GenerationDashboard.tsx` or `ProjectHistoryPanel.tsx` yet.** They are days old, already correct, and already BuildersDB-backed. Breaking them to build a new "Factory" shell would be pure regression risk for no user-facing gain until the MVP dimension exists.
2. **Once `builders_mvps` exists (Architecture Phase 1) and the Product Owner role exists (Phase 2):** add a new top-level panel, "MVP Roadmap," sitting where `ProjectDashboard.tsx` currently sits. This shows the ordered list of MVPs, their status, and the currently active one.
3. **Fold, don't delete:** once the MVP Roadmap panel exists, move (not duplicate) the existing Generation Dashboard and Project History views to render *inside the context of the selected MVP* — i.e., the same components, now filtered by `mvp_id`, presented as tabs under the MVP Roadmap rather than as separate top-level dialogs.
4. **Package tab relabels to Release Plan:** `ProductPackagePanel.tsx`'s assembly logic (`productAssembler.ts`) does not need to change — it already groups content into named sections. Add MVP as a grouping dimension alongside its existing 10 sections, and rename the "Generate Application" action to "Generate MVP N" once scope-aware generation exists (Phase 3).
5. **Only after step 4 has shipped and been used for at least one full MVP cycle** should the standalone "Project Dashboard" entry point be removed in favor of the unified MVP Roadmap becoming the default landing view for a project.

## Why Sequencing Matters Here Specifically

Every one of the panels being "unified" currently reads live from BuildersDB with no MVP dimension. If the UI consolidation is attempted before the schema and generation engine gain that dimension (Architecture Phases 1-3), the new "Factory" workspace has nothing meaningfully different to show than what exists today — it would just be a relabeling exercise disconnected from the actual capability the vision wants (seeing MVP-scoped progress, approving MVP-scoped deliverables). Doing the UI work last, once there's real MVP-scoped data to render, is not a conservative hedge — it's the only ordering in which the UI work has a payoff.

## Workbench: No Change Required

The vision does not ask for Workbench changes beyond the workspace containing it, and the audit confirms the Workbench (editor, file tree, diff, terminal, preview) is orthogonal to the MVP concept — it operates on whatever code currently exists, regardless of which MVP generated it. No architecture change is recommended here beyond the user-edit-protection flag described in [03-generation-engine-create-modify-preserve.md](03-generation-engine-create-modify-preserve.md), which affects the generation engine, not the Workbench itself.
