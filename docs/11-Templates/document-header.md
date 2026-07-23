# Standard Document Header

Copy this block to the top of every new design, architecture, or decision document (below the
`# Title` line). See [../DOCUMENTATION-STANDARDS.md](../DOCUMENTATION-STANDARDS.md) for what
each field means and the allowed values for `Status`.

```markdown
# <Document Title>

| | |
|---|---|
| **Status** | 🟡 Draft |
| **Version** | 1.0 |
| **Owner** | <name or team> |
| **Created** | <YYYY-MM-DD> |
| **Last Updated** | <YYYY-MM-DD> |
| **Related Documents** | [<Doc A>](../path/to/doc-a.md) · [<Doc B>](../path/to/doc-b.md) |
| **Related Sprint** | Sprint <NN> |
| **Depends On** | [<Prerequisite Doc>](../path/to/prereq.md) |
| **Supersedes** | *(none)* |
| **Implementation Status** | Not started |
```

**Notes:**
- Omit a row entirely rather than leaving it blank/"N/A" where it clearly doesn't apply (e.g. a
  brand-new document has no `Supersedes`) — an omitted row is cleaner than a placeholder.
- `Related Documents` should link **both directions**: if Document A lists Document B, edit
  Document B to also list Document A back, where the relationship genuinely runs both ways
  (see [../DOCUMENTATION-STANDARDS.md](../DOCUMENTATION-STANDARDS.md) — Cross References).
- This header block only — never rewrite the rest of an existing document's content just to
  retrofit this header onto it. Apply it to new documents going forward, and to existing
  documents only during a deliberate documentation-maintenance pass.
