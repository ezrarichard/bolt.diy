# Builders Observability

Observability is where Builders reports on itself: what it ran, how long it took, what it cost,
and what failed. **AI Usage and Performance are built.** Infrastructure, Deployments and Errors are
planned and have a defined place in the architecture, but none of them are built yet.

Find it in **Control Panel → Observability**.

> [!IMPORTANT]
> **The ledger table must exist before any of this shows data.** The AI usage ledger was originally
> appended to a migration that had already been applied, so Supabase never ran it and the table was
> never created — and because `recordAiUsage()` is deliberately non-blocking, that failed silently
> for weeks. `supabase/migrations/20260813100000_ai_usage_ledger_repair.sql` re-declares it in a new
> version. Builders now detects this itself: see [§7 Telemetry self-monitoring](#7-telemetry-self-monitoring).

---

## 1. Module structure

| Module | Status | What it covers |
|---|---|---|
| **AI Usage** | ✅ Available | AI requests, tokens, latency, estimated cost, projects, generations |
| **Performance** | ✅ Available | Latency, success/failure rates, retries, repairs, throughput |
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

## 4a. Project analytics

The **Projects** table rolls usage up per project: requests, tokens, estimated cost, average
latency and last activity, ordered by usage. Selecting a row filters the whole dashboard to that
project; selecting it again clears the filter.

Requests with no `project_id` (a chat message sent outside any project, for example) are excluded
rather than bucketed under a placeholder.

---

## 4b. Generation analytics

Builders is a software factory: one application generation is many AI requests. The
**Generations** panel groups them back together and shows each stage — Business Analyst, Solution
Architect, Database Engineer and so on — with its own requests, tokens, cost and duration, plus
the generation's totals, elapsed time and overall status.

### Exact grouping

Every AI request now carries an `operation_id` identifying the generation it belongs to, minted by
`app/lib/observability/aiOperationScope.ts`:

- The autonomous role pipeline opens a scope when a run starts and closes it when the run ends, so
  **every role in one run shares one id**. A run that resumes mid-way rejoins the same scope rather
  than starting a second generation.
- A role regenerated by hand joins the open scope when one exists, and otherwise mints a
  standalone id — so it is a one-request generation rather than an ungrouped orphan.

These generations are labelled **exact** and are never split by a time gap, however long the pause
between stages.

### Inferred grouping (historical data)

`operation_id` is null on every request recorded before this instrumentation existed. Those cannot
be grouped exactly, so they are **inferred**:

1. Requests are bucketed by `project_id`. A request with neither an operation nor a project is
   excluded entirely — there is nothing reliable to group it on.
2. Within a project, requests are sorted by time and split wherever consecutive requests are more
   than **10 minutes** apart (`INFERRED_GENERATION_GAP_MS`). Roles in a real run follow each other
   in seconds, so the threshold sits well above a within-run gap and well below separate sittings.
3. Every generation produced this way is tagged **Inferred** in the UI, with a tooltip explaining
   why.

**Exact and inferred never mix.** An exact generation is never extended by a nearby legacy row, so
instrumented data can never be contaminated by a guess.

> The view transitions on its own. As new generations run they arrive exact; older ones stay
> inferred. There is no migration and no backfill — and none is possible, because the information
> needed to group historical rows exactly was never recorded.

---

## 4c. Request inspector

Every row in Recent Requests opens a right-hand drawer showing everything the ledger holds for that
call: timestamp, project, role, operation, request type, provider, model and model key, the full
token breakdown, estimated cost, latency, status and any error message.

Prompts and responses are **never recorded** (see the DO NOT STORE list), so they cannot appear
here. The drawer says so explicitly rather than leaving an unexplained gap.

---

## 4d. Performance module

The second Observability module. It stores nothing of its own and issues no extra query — every
figure derives from the same ledger rows AI Usage reads.

| Metric | Notes |
|---|---|
| Average response time | Over requests that reported a duration |
| Fastest / slowest role | By average latency |
| Average tokens per request | |
| Average cost per request | Averaged over **priced** requests only, so a partial cost is not understated |
| Success / failure rate | `—` for an empty set, never a confident 100% |
| Retry count | The same role repeating inside one generation |
| Repair count | Requests of type `repair` |
| Timeout count | Failures whose error text reports a timeout — there is no distinct timeout status |
| Cancelled count | Operator stops |
| Requests per minute | Over the observed span; `—` when the span is zero |

---

## 4e. System health

A compact widget derived from state the app already maintains. **Nothing here polls a provider or
opens a connection**, so opening the dashboard cannot cause load or rate limiting.

| Component | Source |
|---|---|
| AI Provider | Recent request outcomes in the ledger |
| BuildersDB | Configuration plus whether the ledger read succeeded |
| Supabase | The project database connection store |
| GitHub | The GitHub connection store |
| Deployment | Vercel or Netlify connection store, whichever is connected |
| Storage | A real write probe, not just a `typeof` check |

Statuses are 🟢 Healthy, 🟡 Warning, 🔴 Offline and a neutral **Not configured**. An integration
the user chose not to set up is never coloured as a failure and never drags the overall indicator
down — colouring it red trains people to ignore the indicator.

---

## 4f. Live status widget

A compact header widget showing the current model, today's request count, today's estimated cost
and an overall health dot. Clicking it opens the Control Panel directly on AI Usage.

It queries once on mount and refreshes on a slow (60s) interval — it is a status line, not a live
feed. It renders **nothing at all** when BuildersDB is unconfigured or no request has been
recorded; an empty widget in the header is worse than no widget.

---

## 5. Security

- Row Level Security policy `builders_ai_usage_events_select_own` restricts reads to
  `user_id = auth.uid()`. The dashboard is scoped by Postgres, not by client-side filtering.
- There is **no INSERT policy** for `authenticated`. The only write path is the
  `builders_record_ai_usage()` SECURITY DEFINER function, which derives `user_id` from
  `auth.uid()` — there is no `p_user_id` parameter to spoof — and independently re-validates
  `project_id`.

---

## 7. Telemetry self-monitoring

Telemetry is **fail-open**: a logging problem must never break an AI generation. It used to be
fail-*silent* too, which is why a completely missing ledger went unnoticed. It is now fail-open and
loud.

### Status values

| Status | Meaning | Where it comes from |
|---|---|---|
| 🟢 **Healthy** | Schema verified, no failures observed | Startup check passed |
| 🟡 **Degraded** | Ledger exists but reads/writes are failing | A runtime failure was reported |
| 🔴 **Unavailable** | Ledger objects are missing — nothing is being recorded | Startup check found them absent |
| ⚪ **Not checked** | The check has not run yet. Never shown as a problem | Initial state |

A missing schema object **outranks everything**: no number of successful reads can make a
non-existent ledger look healthy.

### Where it surfaces

- **Header widget** — a red/amber chip appears whenever telemetry is Unavailable or Degraded, even
  with no usage data at all. Clicking it opens AI Usage.
- **Observability → System Health** — a first-class `Telemetry` row alongside AI Provider,
  BuildersDB and the rest.
- **Banner** at the top of AI Usage and Performance, naming the missing objects, the migration to
  apply, and the last error with its source and timestamp.
- **Console** — every failure logs a structured `[Builders][telemetry]` warning, client-side; the
  server logs a structured `[telemetry]` warning from `recordAiUsage()` with the request type,
  role, provider, model and a pointer to this document.

The last error and its timestamp are retained even after recovery — "recovered, and here is what
went wrong" is more useful than a status that erases its own history.

### The startup health check

Runs once per page load, read-only, and validates:

| Object | How | Certainty |
|---|---|---|
| `builders_ai_usage_events` | `select('*').limit(0)` | Definitive |
| `builders_ai_usage_daily` | `select('*').limit(0)` | Definitive |
| `builders_record_ai_usage()` | Inferred from the table | See below |

> [!WARNING]
> Two probe forms look correct and are not. `{ head: true, count: 'exact' }` returns **204 with no
> error for a table that does not exist**, so it reports every missing relation as present —
> silently defeating the check. Selecting a named column (`select('id')`) fails with `42703` on a
> view whose shape differs, conflating "wrong columns" with "missing relation". Only
> `select('*').limit(0)` distinguishes the cases (404 `PGRST205` vs 200). `limit(0)` transfers no
> rows, and RLS only ever hides rows — never the relation — so this stays a schema check, not a
> permission check.

**The write RPC cannot be verified directly from the browser**, and the UI never pretends
otherwise. PostgREST reports "no such function" and "function exists with a different signature"
with the same `PGRST202` code, its OpenAPI listing requires a `service_role` key that must never
reach the browser, and calling the function for real would write a ledger row. So it is reported
`unverifiable` when the table is present, and `missing` when the table is missing — both objects
come from the same migration, which makes that inference sound.

---

## 8. Troubleshooting

### "AI Usage telemetry is not configured"

Telemetry is **Unavailable** — the ledger objects do not exist and nothing is being recorded.

1. Apply migrations: `supabase db push` (or apply
   `supabase/migrations/20260813100000_ai_usage_ledger_repair.sql`).
2. Reload Builders. The startup check re-runs and the banner clears.
3. Confirm in **Observability → System Health** that `Telemetry` reads Healthy.

If it persists, verify in the SQL editor:

```sql
select to_regclass('public.builders_ai_usage_events');   -- expect a name, not null
select to_regclass('public.builders_ai_usage_daily');    -- expect a name, not null
select proname from pg_proc where proname = 'builders_record_ai_usage';
```

> Never "fix" this by editing an already-applied migration file. Supabase tracks migrations by
> version, not content, so the edit will never run — that is the exact mistake that caused this.
> Always add a new migration.

### "Telemetry Degraded"

The ledger exists but a read or write failed. The banner shows the source, timestamp and error.

| Error | Likely cause |
|---|---|
| `PGRST205` | A ledger object is missing — this should read Unavailable; re-run the check by reloading |
| `42501` / RLS | The `builders_ai_usage_events_select_own` policy is missing or altered |
| `PGRST301` / 401 | The session expired — sign in again |
| Network / 5xx | Supabase unreachable; transient, and clears itself on the next successful read |

Degraded clears automatically after one successful read.

### The dashboard is empty but telemetry is Healthy

Expected when no AI request has run since the ledger was created. Run a generation and reload.
Historical requests made while the ledger was missing are **gone** — they were never written, and
nothing can reconstruct them.

### Costs all show "—"

Not a telemetry fault. No pricing is configured for those models; the dashboard names them. See
[§3 Cost tracking](#3-cost-tracking).

### Generations show "Inferred"

Expected for requests recorded before generation tracking existed. See
[§4b](#4b-generation-analytics). New generations are exact.

---

## 9. Where the code lives

| Path | Responsibility |
|---|---|
| `app/lib/observability/observabilityModules.ts` | Module registry and extension point |
| `app/lib/observability/ai-usage/aiUsageQueries.ts` | Read path (RLS-scoped, never throws) |
| `app/lib/observability/ai-usage/aiUsageAggregations.ts` | Pure aggregation — all dashboard arithmetic |
| `app/lib/observability/ai-usage/aiUsageBudget.ts` | Optional budgets |
| `app/lib/observability/aiOperationScope.ts` | Mints the `operation_id` that groups a generation |
| `app/lib/observability/ai-usage/aiUsageAnalytics.ts` | Project, generation and performance analytics |
| `app/lib/observability/pricing/pricingOverrides.ts` | Configurable pricing on top of the registry |
| `app/lib/observability/health/systemHealth.ts` | Pure health resolution |
| `app/lib/observability/telemetry/telemetryStatus.ts` | Telemetry state machine and failure recording |
| `app/lib/observability/telemetry/telemetrySchemaCheck.ts` | Startup validation of the ledger objects |
| `app/lib/ai-usage/` | Write path (pre-existing): `recordAiUsage`, pricing, cost, redaction |
| `app/components/@settings/tabs/observability/` | Dashboard and formatters |

The read side owns no schema. `builders_ai_usage_events` remains the single source of truth for
AI requests.
