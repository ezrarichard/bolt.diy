# Builders Observability

Observability is where Builders reports on itself: what it ran, how long it took, what it cost,
and what failed. **AI Usage is its first module.** Performance, Infrastructure, Deployments and
Errors are planned and have a defined place in the architecture, but none of them are built yet.

Find it in **Control Panel → Observability → AI Usage**.

---

## 1. Module structure

| Module | Status | What it will cover |
|---|---|---|
| **AI Usage** | ✅ Available | AI requests, tokens, latency, estimated cost |
| Performance | Planned | Generation throughput, queue depth, stage timings |
| Infrastructure | Planned | Database, storage and API health |
| Deployments | Planned | Deployment frequency, duration, success rate |
| Errors | Planned | Failure rates, repair attempts, error clustering |

The registry lives in `app/lib/observability/observabilityModules.ts`. A planned module is a data
entry only — it imports no implementation, so it costs nothing at runtime.

### Adding a module later

1. Flip the module's `status` to `'available'` in the registry and give it a `tabId`.
2. Add that id to `TabType` (`app/components/@settings/core/types.ts`) and to `TAB_LABELS`,
   `TAB_ICONS`, `TAB_DESCRIPTIONS`, `DEFAULT_TAB_CONFIG` in `constants.tsx`.
3. Render its component from `getTabComponent` in `ControlPanel.tsx`.

The Control Panel's Observability section reads its tab list from `observabilityTabIds()`, so it
picks the new module up automatically — that section is never edited by hand.

---

## 2. AI Usage

### What gets recorded

Every AI request Builders makes writes one row to `builders_ai_usage_events`. That includes every
AI role — Business Analyst, Product Owner, Solution Architect, Database Engineer, UI/UX Engineer,
Backend Engineer, Frontend Engineer, QA Engineer, DevOps Engineer — plus chat, code generation,
code review and repair calls.

**A new AI role is recorded automatically.** Roles are identified by `role_key`, a plain `text`
column with no constraint, passed through from the call site. Adding a role needs no migration and
no change to the dashboard.

| Recorded | Column |
|---|---|
| Timestamp | `created_at` |
| Project | `project_id` |
| User | `user_id` (from `auth.uid()`, never client-supplied) |
| Provider | `provider` |
| Model | `api_model`, plus logical `model_key` |
| AI role | `role_key` |
| Operation | `request_type`, `operation_id`, `parent_operation_id` |
| Prompt tokens | `input_tokens` |
| Completion tokens | `output_tokens` |
| Cached tokens | `cached_input_tokens`, `cached_output_tokens` |
| Total tokens | `total_tokens` |
| Estimated cost | `input_cost_usd`, `output_cost_usd`, `estimated_cost_usd`, `pricing_version` |
| Latency | `duration_ms` |
| Success / failure | `status` (`success` / `failed` / `cancelled`) |
| Error | `error_code`, `error_message` (redacted and truncated) |
| Metadata | `metadata` (JSON, operational only) |

### Provider-agnostic by construction

Nothing in the pipeline is specific to one provider.

- **Write:** every call path goes through `recordAiUsage()` (`app/lib/ai-usage/recordAiUsage.ts`).
  The provider is stored as whatever the resolved provider reports its name to be.
- **Read:** the dashboard groups by whatever `provider` values it finds. Claude, Gemini, OpenAI,
  Kimi and anything added later all appear with no code change.

### What is never stored

Prompts, responses, API keys, tokens, headers and cookies are never written to the ledger.
`error_message` is passed through `sanitizeErrorMessage()`, which redacts anything resembling a
credential before truncating to 500 characters — and the table independently enforces a 1000
character ceiling.

---

## 3. Cost tracking

Cost is **estimated**, and Builders will not guess.

Pricing lives in exactly one place: `MODEL_PRICING_REGISTRY` in
`app/lib/ai-usage/modelPricingRegistry.ts`, keyed by logical model key so pricing survives a
provider changing its API model string.

```ts
'claude-sonnet-4.6': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, version: '2026-07-31' },
```

Rules the implementation follows:

- **A model with no registry entry produces `null` cost, not `0`.** Every cost column stays null,
  and the dashboard shows `—`. An unpriced model can never look free.
- **Cached input tokens** are billed at `cachedInputPerMillionUsd` when set, or treated as free,
  and excluded from the billable input count so they are never double-counted.
- **`pricing_version` is stored on every row**, so changing a price later never makes an old row
  look like it used a price it didn't.

> **The registry currently ships empty.** No published per-token price has been confirmed for the
> models in `MODEL_REGISTRY`, and inventing one would produce cost figures that look precise and
> aren't. Add a real entry with a real `version` the moment pricing is confirmed — nothing else
> needs to change, and historical rows keep whatever they were costed at.

The dashboard names the unpriced models it encountered, so the gap is visible rather than silent.

---

## 4. The dashboard

| Area | Shows |
|---|---|
| **Status bar** | Provider in use, current model, and health (derived from recent failures) |
| **Current Session** | Requests, tokens (in/out/cached), estimated cost since the app was opened |
| **Today** | Requests, tokens, cost for the current local day |
| **Current Project** | The same three for the open project |
| **Budget** | Daily and monthly progress — hidden entirely unless configured |
| **Provider Breakdown** | Requests, tokens and cost per provider |
| **Role Breakdown** | The same per AI role |
| **Recent Requests** | The last 100 calls: time, role, provider, model, tokens, cost, latency, status |

**Filters:** range (Session / Today / 7 Days / 30 Days), project, role and provider. Role and
provider options are built from the data itself, so new ones appear without a code change.

### Budgets

Optional and off by default. When nothing is set, the budget panel is not rendered at all. Set a
daily and/or monthly USD ceiling via **Set a budget**; each shows budget, used, remaining and
percentage. Budgets are stored per browser in `localStorage` — they are a personal reminder, not a
team policy, and they never block a request.

### Degrading gracefully

The dashboard is built so that missing data is visible rather than fabricated:

| Situation | What you see |
|---|---|
| Provider reports no token counts | `0` tokens, with `metadata.usage_source = "unavailable"` on the row |
| Provider reports no cached tokens | Cached shows `0` |
| Model has no configured price | Cost shows `—`, and the model is named in the footnote |
| No request in a period had a price | Period cost shows `—`, never `$0.00` |
| Ledger unreachable | An explicit "usage data is unavailable" panel — never an empty dashboard implying zero usage |

A failure to record usage, or to read it back, never affects AI generation. `recordAiUsage()`
never throws, and the read path resolves to an unavailable state instead of rejecting.

---

## 5. Security

- Row Level Security policy `builders_ai_usage_events_select_own` restricts reads to
  `user_id = auth.uid()`. The dashboard is scoped by Postgres, not by client-side filtering.
- There is **no INSERT policy** for `authenticated`. The only write path is the
  `builders_record_ai_usage()` SECURITY DEFINER function, which derives `user_id` from
  `auth.uid()` — there is no `p_user_id` parameter to spoof — and independently re-validates
  `project_id`.

---

## 6. Where the code lives

| Path | Responsibility |
|---|---|
| `app/lib/observability/observabilityModules.ts` | Module registry and extension point |
| `app/lib/observability/ai-usage/aiUsageQueries.ts` | Read path (RLS-scoped, never throws) |
| `app/lib/observability/ai-usage/aiUsageAggregations.ts` | Pure aggregation — all dashboard arithmetic |
| `app/lib/observability/ai-usage/aiUsageBudget.ts` | Optional budgets |
| `app/lib/ai-usage/` | Write path (pre-existing): `recordAiUsage`, pricing, cost, redaction |
| `app/components/@settings/tabs/observability/` | Dashboard and formatters |

The read side owns no schema. `builders_ai_usage_events` remains the single source of truth for
AI requests.
