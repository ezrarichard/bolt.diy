# Product Owner JSON Schema

This is the JSON Schema (draft-07) for the artifact described in [02-artifact-specification.md](02-artifact-specification.md). This is a specification document, not a runtime file — Sprint 46B is responsible for translating this into an actual TypeScript type and, if useful, a runtime validator (following the same pattern as every other artifact type in `app/lib/projects/artifacts.ts`).

**Sprint 46C update:** `id` fields added to `roadmapSkeleton` items, `currentMvp`, and each feature — all assigned by the application after parsing, never requested from or produced by the AI (see [08-identity-and-traceability.md](08-identity-and-traceability.md)). `EngineeringHandoff.featurePriority` (a name-keyed record) is replaced by `EngineeringHandoff.features` (an array of `{ id, name, priority }`), since a name-keyed lookup is exactly the "titles are not reliable" problem this sprint exists to fix.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ProductOwnerArtifact",
  "type": "object",
  "required": [
    "productVision",
    "businessObjectives",
    "productScope",
    "roadmapSkeleton",
    "currentMvp",
    "version",
    "generationType",
    "approvalStatus",
    "createdAt",
    "updatedAt"
  ],
  "properties": {
    "productVision": {
      "type": "string",
      "description": "One paragraph. What the product is and why it matters, derived from Requirements."
    },
    "businessObjectives": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1
    },
    "productScope": {
      "type": "object",
      "required": ["inScope", "outOfScope"],
      "properties": {
        "inScope": { "type": "array", "items": { "type": "string" } },
        "outOfScope": { "type": "array", "items": { "type": "string" } }
      }
    },
    "roadmapSkeleton": {
      "type": "array",
      "description": "Ordered, lightweight future-MVP list. No feature-level detail here — see currentMvp for the only fully-elaborated MVP.",
      "items": {
        "type": "object",
        "required": ["id", "sequence", "theme"],
        "properties": {
          "id": {
            "type": "string",
            "description": "Sprint 46C — permanent identifier (e.g. 'MVP-001'), assigned by the application from `sequence`, never by the AI. See 08-identity-and-traceability.md.",
            "pattern": "^MVP-\\d{3,}$"
          },
          "sequence": { "type": "integer", "minimum": 1 },
          "theme": { "type": "string" },
          "targetRelease": {
            "type": "string",
            "description": "Optional semantic-version-like label (e.g. 'v0.1', 'v1.0'). See 06-buildersdb-recommendations.md.",
            "pattern": "^v\\d+\\.\\d+(\\.\\d+)?$"
          },
          "estimatedEffort": {
            "type": "string",
            "enum": ["small", "medium", "large"],
            "description": "Coarse T-shirt sizing for roadmap planning only — never a numeric estimate. See 06-buildersdb-recommendations.md."
          }
        }
      }
    },
    "currentMvp": {
      "type": "object",
      "required": [
        "id",
        "sequence",
        "features",
        "acceptanceCriteria",
        "risks",
        "assumptions",
        "openQuestions",
        "engineeringHandoff"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "Sprint 46C — same permanent identifier as this MVP's roadmapSkeleton entry (both derived from sequence)."
        },
        "sequence": {
          "type": "integer",
          "description": "Must match an entry in roadmapSkeleton."
        },
        "features": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["id", "name", "description", "priority", "dependsOn", "customerValue"],
            "properties": {
              "id": {
                "type": "string",
                "description": "Sprint 46C — permanent identifier (e.g. 'FEAT-001'). Carried forward across regenerations by matching `name` against the previous draft — never derived from array position or from name itself. See 08-identity-and-traceability.md.",
                "pattern": "^FEAT-\\d{3,}$"
              },
              "name": { "type": "string" },
              "description": { "type": "string" },
              "priority": {
                "type": "string",
                "enum": ["Must Have", "Should Have", "Could Have", "Won't Have"]
              },
              "dependsOn": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Feature names this depends on, from this MVP or a prior approved MVP. Validated against the dependency graph — see 02-artifact-specification.md's Validation Rules."
              },
              "customerValue": {
                "type": "string",
                "description": "One-line justification for this feature's priority — the load-bearing 'why' a human reviewer checks first."
              }
            }
          }
        },
        "acceptanceCriteria": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1,
          "description": "Business-readable, testable statements of 'this MVP is done when...'."
        },
        "risks": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["description", "severity"],
            "properties": {
              "description": { "type": "string" },
              "severity": { "type": "string", "enum": ["Critical", "High", "Medium", "Low"] },
              "mitigation": { "type": "string" }
            }
          }
        },
        "assumptions": {
          "type": "array",
          "items": { "type": "string" }
        },
        "openQuestions": {
          "type": "array",
          "items": { "type": "string" }
        },
        "technicalConstraints": {
          "type": "array",
          "items": { "type": "string" }
        },
        "businessConstraints": {
          "type": "array",
          "items": { "type": "string" }
        },
        "engineeringHandoff": {
          "$ref": "#/definitions/EngineeringHandoff"
        }
      }
    },
    "futureEnhancements": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Lightweight, unordered. Deliberately NOT structured with priority/dependencies/acceptance criteria — see 01-responsibilities-and-decision-framework.md, Section 5."
    },
    "version": { "type": "integer", "minimum": 1 },
    "generationType": { "type": "string", "enum": ["manual", "automatic"] },
    "approvalStatus": {
      "type": "string",
      "enum": ["draft", "pending_review", "approved", "changes_requested"]
    },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" }
  },
  "definitions": {
    "EngineeringHandoff": {
      "type": "object",
      "description": "See 04-engineering-handoff.md — the machine-consumable block Solution Architect actually reads, distinct from the customer-facing narrative sections above.",
      "required": [
        "scope",
        "constraints",
        "architectureGoals",
        "successCriteria",
        "acceptanceCriteria",
        "features",
        "outOfScopeFeatures"
      ],
      "properties": {
        "scope": { "type": "array", "items": { "type": "string" } },
        "constraints": { "type": "array", "items": { "type": "string" } },
        "architectureGoals": { "type": "array", "items": { "type": "string" } },
        "successCriteria": { "type": "array", "items": { "type": "string" } },
        "acceptanceCriteria": { "type": "array", "items": { "type": "string" } },
        "features": {
          "type": "array",
          "description": "Sprint 46C — replaces the original featurePriority (a name-keyed record). Mechanically derived from currentMvp.features (already carrying its own id and priority) rather than parsed from the AI's response a second time — every engineering role can now cite a feature unambiguously by id instead of by name.",
          "items": {
            "type": "object",
            "required": ["id", "name", "priority"],
            "properties": {
              "id": { "type": "string" },
              "name": { "type": "string" },
              "priority": { "type": "string", "enum": ["Must Have", "Should Have", "Could Have", "Won't Have"] }
            }
          }
        },
        "outOfScopeFeatures": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

## Notes on Field Choices

- **No numeric estimate fields anywhere in the schema.** `estimatedEffort` is a three-value enum, deliberately — see [06-buildersdb-recommendations.md](06-buildersdb-recommendations.md) for why story points/engineering-weeks were rejected.
- **`engineeringHandoff` is a nested object with its own `$ref`, not inlined**, so Sprint 46B can extract and pass just that block to Solution Architect's prompt-building step without serializing the entire artifact (including customer-facing narrative it doesn't need) — directly serving the "keep prompts small" motivation behind this whole initiative.
- **`roadmapSkeleton` entries intentionally have almost no fields.** Adding `features`/`risks`/`acceptanceCriteria` to skeleton entries would be the single easiest way to accidentally recreate full-upfront-planning — resist the temptation in Sprint 46B even if it looks like "just being thorough."
