# UI Philosophy

## The Customer Should Always Be Inside One Workspace

The long-term direction is a single workspace (Factory / Code / Preview) rather than the current collection of separate dialogs and panels (Project Dashboard, Product Package, Generation Dashboard). See [02-Architecture/05-workspace-migration.md](../02-Architecture/05-workspace-migration.md) for why this is a consolidation of existing, working panels rather than new capability, and why it should be sequenced *after* the MVP data model exists rather than before.

## The Customer Should Always Have Something to See

This is the philosophy's real test, and it's a UI consequence of the MVP-first generation principle, not a separate initiative: from MVP 1 onward, there must always be a running, previewable application. A UI that shows "planning in progress" with nothing to look at for an extended period is exactly the failure mode this whole architecture exists to eliminate. Every screen in the future workspace should be built around the assumption that a live preview is available from very early in the process, and should surface it prominently rather than hiding it behind a "Generate Application" button that isn't pressed until the end.

## Progress Should Be Legible at the MVP Level First, File Level Second

The existing `GenerationDashboard.tsx` shows file-level progress (files by status, files by category) — this is valuable detail for engineers but not the primary signal a business customer needs. The unified workspace should lead with MVP-level status ("MVP 2: Generating — Backend Engineer running") and make file-level detail available on drill-down, not as the default view. This is a straightforward reordering of information hierarchy on top of data that already exists; no new instrumentation is required.

## Package Tab Evolution

"Generate Application" becomes "Generate MVP N." The Package tab's content model doesn't need to change (it already assembles role outputs into sections); its framing changes from "here is the whole product's documentation" to "here is what's in scope for this MVP, and here's what MVP N+1 already knows it needs."

## What Not to Change

- The Workbench's core interaction model (editor, file tree, diff, terminal) is not part of this philosophy shift and should not be touched as part of this migration.
- Quick Build's UI is explicitly out of scope — it serves a different, frozen product line.
