# Builders Vision

## What Builders Is Becoming

Builders is not another AI coding assistant and is not competing to be a better Bolt clone. Quick Build — the original chat-driven, single-shot code generation experience — is frozen, not deleted, and remains available for users who want a lightweight, disposable prototype. It is not where Builders is investing.

The primary product is the **Software Factory**: an experience where a business user brings an idea, and Builders behaves like hiring a small, disciplined software company rather than chatting with a code generator.

```
Business user → AI Company → Incremental Software Delivery → Production Application
```

The distinction that matters: a coding assistant produces code when asked. A software company produces a *plan*, gets it reviewed, and only then produces code — and it produces working software in increments, not as one final delivery at the end.

## Why This Is a Change, Not an Addition

Today, Builders' 8-role engineering pipeline (`app/lib/projects/*Engine.ts`) already behaves like a software company in miniature — Business Analyst, Solution Architect, Database Designer, UI/UX Designer, Backend Engineer, Frontend Engineer, QA Engineer, DevOps Engineer, each gated on the previous role's approval. What it does not yet do is **scope**. Every role today designs for the entire product in a single pass, and "Generate Application" then attempts to build all of it at once.

This is the concrete failure mode already observed in production use (see [02-Architecture/01-current-state-gap-analysis.md](../02-Architecture/01-current-state-gap-analysis.md)): oversized prompts, truncated LLM responses on large role outputs, generation runs that take too long before the customer sees anything, and repair cycles fighting structural drift introduced by trying to generate too much code in one pass. The manifest and resumable-generation work already underway (Sprint 44.2) treats the symptom — it makes a large generation run resumable and repair-capable. This vision addresses the cause — stop asking the system to plan and generate the whole product before the customer has seen anything.

## Non-Negotiable Product Principle

**Every MVP must produce a running application, including MVP 1.** Landing page, login, a dashboard shell, navigation, and mock data are a legitimate and sufficient MVP 1. The customer should never wait through a full planning-and-generation cycle for the *whole* product before seeing anything real. Software grows visibly, in front of the customer, one reviewed increment at a time.

## What Does Not Change

- The 8 engineering roles are not replaced. They are re-scoped to operate per-MVP instead of per-product.
- BuildersDB remains the control plane. Its schema grows by one dimension (MVP), it is not replaced.
- The Workbench (editor, preview, file tree, terminal) is not replaced. It becomes the place where an MVP's generated app is inspected and lived in between reviews.
- Quick Build remains available and untouched, per existing product-split direction — it serves a different user need (disposable prototyping) and is out of scope for this migration.
