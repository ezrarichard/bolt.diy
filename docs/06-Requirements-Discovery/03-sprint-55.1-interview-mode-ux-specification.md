# Sprint 55.1 — Interview Mode UX & Product Experience Design

**Status: APPROVED (UX/product design only) — no code, files, migrations, or tests were
created or modified.** This is the implementation blueprint for a future build sprint,
building directly on [Sprint 55 — AI Business Interview Mode Architecture](./02-sprint-55-interview-mode-architecture.md).

**See also:** [06 — Requirements Discovery index](./00-index.md) ·
[Sprint 55 — Interview Mode Architecture](./02-sprint-55-interview-mode-architecture.md) ·
[Builders Discovery Experience — Master Specification](./04-builders-discovery-experience-master-spec.md)

---

## 0. Design Grounding

Before laying out screens, three constraints shape everything below:

1. **Reuse Builders' existing visual language** — dark theme, `bg-[#F7F7F8]/90 dark:bg-[#161616]/80` cards, purple (`purple-500`) as the single accent color, green/amber/red badge semantics already established by `BusinessDiscoveryCard` (Sprint 54.1) for READY/NEEDS_MORE_INFORMATION/INSUFFICIENT_INFORMATION. Interview Mode should look like it was born in Builders, not bolted onto it.
2. **"Explaining my business," not "answering software questions."** This means: no field labels, no progress-bar-as-hero, no visible jargon (`businessVision`, `coreFeatures`) anywhere in customer-facing copy — those stay internal. The chat reads like a consultant's notes, and the discovery panel translates everything into plain language (already true — `DIMENSION_LABELS` in `businessDiscoveryDisplay.ts` already converts `targetUsers` → "Target Users"; extend that same instinct to full sentences).
3. **Never a second product.** Interview Mode lives inside the same `ProjectDashboard` → Engineering Journey → Requirements & Knowledge surface Sprint 54.1 already built, not a separate app shell. It's a new *mode* of the same panel, reachable next to "Add Requirements" / "Edit Requirements."

---

## 1. Complete User Journey

```
┌──────────────────────────────────────────────────────────────────────┐
│                         END-TO-END JOURNEY                            │
└──────────────────────────────────────────────────────────────────────┘

  Requirements & Knowledge section (existing, Sprint 51/54.1)
  ┌────────────────────────────────────────────────────────┐
  │  No requirements captured yet.                          │
  │  [ ✎ Add Requirements ]   [ 💬 Talk it through instead ]│ ← NEW
  └────────────────────────────────────────────────────────┘
                          │
                click "Talk it through instead"
                          ▼
  ┌─── STATE: Loading (≤1s target) ──────────────────────────┐
  │  Skeleton chat bubble + skeleton discovery panel           │
  │  shimmer — never a blank white/black flash                │
  └──────────────────────────────────────────────────────────┘
                          ▼
  ┌─── STATE: Greeting ────────────────────────────────────────┐
  │  Assistant bubble, already warm — references the project    │
  │  name/description if one exists:                            │
  │  "Hi — I'm here to help you describe [Project Name].         │
  │   Just talk to me like you would a consultant. I'll ask      │
  │   what I need to know, and you can pause anytime."          │
  │  [ Text input, focused, cursor blinking ]                    │
  └──────────────────────────────────────────────────────────┘
                          ▼
  ┌─── STATE: Conversation (the main loop) ──────────────────────┐
  │  Assistant asks → user answers → (thinking) → next question  │
  │  Discovery panel updates live after every answer              │
  │  (see §3, §4, §5, §7 for full behavior)                       │
  └───────────────────────────────────────────────────────────────┘
                          ▼
       ┌──────────────────┴───────────────────┐
       │ user pauses                            │ decision reaches READY
       ▼                                         ▼
  ┌─ STATE: Paused ──────┐         ┌─ STATE: Discovery Complete ──────┐
  │ Session saved.         │         │ Celebration (see §8)              │
  │ "Continue Interview"   │         │ "Generate Project Definition"    │
  │ button on dashboard    │         │ button, same as Sprint 54.1's    │
  └────────┬───────────────┘         │ existing gate                    │
           │                          └────────────┬──────────────────┘
     (returns later, §9)                            │
           └──────────────► back into Conversation   │
                                                      ▼
                              Business Analyst → Approval → Product
                              Owner → Engineering
                              (existing pipeline, entirely unchanged —
                               Interview Mode only ever produces the
                               same BusinessUnderstandingModel the Form
                               already feeds into it)
```

**Key journey principle:** the loading→greeting→conversation→completion arc has exactly one hard exit (Pause) and one hard success (Discovery Complete). Everything else (errors, resume, form-switch) is a *modifier* on this same arc, not a separate journey — detailed in later sections.

---

## 2. Page Layout

### Desktop (≥1280px) — primary target

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Plumber Coimbatore Website          Active Project   ⭐ Blank Project    │
│  ────────────────────────────────────────────────────────────────────────│
│  Overview │ Engineering │ Package │ Workspace │ History                   │
│  ────────────────────────────────────────────────────────────────────────│
│                                                                              │
│  ┌─────────────────────────────────────┐  ┌────────────────────────────┐ │
│  │  💬 Interview with Discovery Agent    │  │  Business Discovery         │ │
│  │  ─────────────────────────────────── │  │  ────────────────────────  │ │
│  │                                        │  │  [NEEDS MORE INFO]          │ │
│  │  🤖 Tell me about who this product     │  │                            │ │
│  │     is for.                            │  │  Discovery Completeness     │ │
│  │                                        │  │  ▓▓▓▓▓▓░░░░░░░░  49%       │ │
│  │              Local shop owners in  👤  │  │                            │ │
│  │              Coimbatore                │  │  Business Assessment        │ │
│  │                                        │  │  Classification: Retail     │ │
│  │  🤖 Got it. What are the core          │  │  Industry: Retail           │ │
│  │     features they'll need?             │  │  Digital Maturity: Unknown  │ │
│  │                                        │  │  Project Type: Website      │ │
│  │  ● ● ●  (thinking)                     │  │                            │ │
│  │                                        │  │  Missing Areas               │ │
│  │  ┌──────────────────────────────────┐ │  │  [Integrations] [Tech Prefs]│ │
│  │  │ Type your answer...          [→] │ │  │                            │ │
│  │  └──────────────────────────────────┘ │  │  Partial Areas               │ │
│  │  [⏸ Pause]        [✎ Switch to Form]  │  │  [Core Features]            │ │
│  └─────────────────────────────────────┘  └────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────┘
     ~62% width chat                              ~38% width panel
```

- **Chat** and **Business Discovery panel** side by side, roughly 60/40 — mirrors the existing `Requirements & Knowledge` two-column pattern already used elsewhere in `ProjectDashboard.tsx` (e.g. `grid grid-cols-1 md:grid-cols-2`).
- **Question Queue, Progress, Timeline** are *not* separate panels — they're absorbed **into** the Business Discovery panel as sub-sections (Missing/Partial Areas chips already double as a queue — see §6), keeping the layout to exactly two columns rather than three or four. A three-panel layout (chat + queue + discovery) would visually compete with the chat, undermining "feels like a conversation."
- **Quick Actions** (Pause, Switch to Form) live as a slim action bar under the chat input, always visible, never buried in a menu.
- **Requirements Summary** — not a third panel; it's what the Business Discovery panel's "Business Assessment" section already is, plus a final full summary shown only at Discovery Completion (§8).

### Tablet (768–1279px)

```
┌───────────────────────────────────────┐
│  Plumber Coimbatore Website             │
│  Overview │ Engineering │ ...           │
│  ───────────────────────────────────── │
│  [ 💬 Chat ]  [ 📊 Discovery ]  ← tabs   │
│  ───────────────────────────────────── │
│                                          │
│   (selected tab fills full width,       │
│    same components as desktop,          │
│    just single-column)                  │
│                                          │
└───────────────────────────────────────┘
```

- Panel collapses into a **tab switcher** above the content, not a stacked scroll — stacking chat above/below a live-updating panel means the user loses sight of one while scrolling the other, which defeats "Business Discovery should remain visible" for exactly the users most likely to be on tablet (on-site, walking around).
- A small **badge on the "Discovery" tab** (e.g. a pulsing dot) fires when the panel updates while the user is on the Chat tab — so nothing is silently missed.

### Mobile (<768px)

```
┌───────────────────────┐
│ ← Plumber Coimbatore    │
│ ─────────────────────  │
│ [NEEDS MORE INFO ▾]     │ ← collapsed discovery
│  49% complete            │    summary strip, tap
│ ─────────────────────  │    to expand full panel
│                          │    as a bottom sheet
│ 🤖 Tell me about who     │
│    this is for.          │
│                          │
│         Shop owners  👤 │
│                          │
│ 🤖 What features...      │
│                          │
│ ┌──────────────────────┐│
│ │ Type your answer...  ││
│ └──────────────────────┘│
│ [⏸]            [✎ Form] │
└───────────────────────┘
```

- Chat is the **only** full-screen surface on mobile. The Business Discovery panel becomes a **collapsed status strip** at the top (state badge + completeness %) that expands into a bottom sheet on tap — never permanently splits screen real estate on a small viewport, but is always one tap away, satisfying "should remain visible" without sacrificing chat usability.
- Input bar is sticky to the keyboard, standard mobile chat convention.

---

## 3. Chat Experience

| Element | Design |
|---|---|
| **Assistant bubble** | Left-aligned, `bg-bolt-elements-background-depth-2`, small robot/spark icon (reuse `i-ph:sparkle`, already used for AI actions elsewhere in Builders), no avatar photo — keep it understated, not cartoonish. |
| **User bubble** | Right-aligned, `bg-purple-500/10` with `border-purple-500/20` (same purple family used for every other primary action in Builders), no avatar. |
| **Typing (assistant composing)** | Three-dot pulse (`i-svg-spinners:90-ring-with-bg` equivalent, or a simple animated ellipsis) inside an otherwise-empty assistant bubble — exact same spinner token already used in `RequirementsDraftPanel`'s "AI Project Manager is drafting…" state. Never a generic full-panel spinner; keep it *inline*, in the chat, where the eye already is. |
| **Thinking (post-answer, pre-question)** | Same three-dot bubble, but the copy underneath the input area briefly reads "Updating what I know…" — this is also the cue that the Discovery panel is about to update, tying chat and panel together explicitly rather than leaving the panel's live update unexplained. |
| **Streaming** | Assistant question text streams token-by-token (reuse the existing streaming text pattern from Chat's main message rendering) — makes the agent feel responsive even though the *decision* of what to ask was already made deterministically before generation started. |
| **Error states** | Inline, non-modal — a small red-bordered bubble in place of the assistant's next message: "I couldn't process that — mind trying again?" with a `[Retry]` chip. Never a toast that disappears before the user can act. |
| **Loading (initial)** | Skeleton bubbles (2–3 grey rounded rectangles of varying width) — same shimmer treatment as any other Builders loading skeleton, not a spinner over blank space. |
| **Retry** | Chip button directly under the failed exchange, not a page-level "reload" — retry re-sends just that turn. |
| **Continue / Pause / Resume** | Persistent action bar under the input (desktop/tablet) or below the input (mobile) — always visible, never scrolled out of view, never nested in a menu (§7's "always show pause" principle from the architecture doc). |
| **History / scrolling** | Standard reverse-chronological scroll, auto-scrolls to newest message on new content **unless** the user has manually scrolled up (then show a "↓ New message" pill instead of yanking their scroll position — standard, expected chat behavior). |
| **Animations** | Subtle only: new bubbles fade+slide in over ~150ms, no bounce, no confetti mid-conversation (confetti is reserved for §8 completion only, and even there kept professional). |
| **Empty state** | Never truly empty — the Greeting message (§1) *is* the empty state; there's no "no messages yet" placeholder because the assistant always speaks first. |

---

## 4. Business Discovery Panel

**Design goal: this is the same `BusinessDiscoveryCard` from Sprint 54.1, made live and slightly denser, not a new component.**

```
┌────────────────────────────────┐
│  Business Discovery              │
│                    [NEEDS MORE ▸]│ ← state badge (existing colors)
│  ────────────────────────────── │
│  Discovery Completeness           │
│  ▓▓▓▓▓▓░░░░░░░░  49%    ↑12%    │ ← delta shown briefly after
│                             ⤷ animates smoothly over 400ms
│  ────────────────────────────── │
│  Business Assessment              │
│    Classification   Retail        │
│    Industry          Retail        │
│    Digital Maturity   Unknown  ⟳ ← subtle pulse when a field
│    Project Type       Website     just changed this turn
│  ────────────────────────────── │
│  Missing Areas                    │
│    ⬤ Integrations                │ ← chips, existing style,
│    ⬤ Technical Preferences       │   newly-resolved chips
│  Partial Areas                    │   animate out (fade+shrink)
│    ⬤ Core Features               │   rather than snap-disappear
│  ────────────────────────────── │
│  Overall Confidence     Medium    │
│  Ready for Draft         No       │
└────────────────────────────────┘
```

**What's live / what animates:**
- **Completeness bar**: animates smoothly to its new value (already a CSS `transition-all duration-300` in the existing `CompletenessBar` — extend to also flash a small `+12%` delta indicator for ~2s after an update, then fade).
- **Missing/Partial chips**: a chip that resolves (moves from Missing → Partial → gone) doesn't just vanish — it fades and collapses over ~300ms so the user visually registers "that got addressed."
- **State badge** (color): when it changes tier (e.g. `INSUFFICIENT_INFORMATION` → `NEEDS_MORE_INFORMATION`), briefly ring-pulse the badge once — this is the one moment worth calling extra attention to, since it's a milestone.
- **Business Assessment fields**: a field that just changed this turn gets a brief highlight ring (subtle, ~1s, no color change) so users notice "oh, it picked that up" without needing to compare before/after mentally.
- **What does NOT change on every keystroke**: nothing updates while the user is *typing* — only after their answer is submitted and processed, matching the existing turn-based update cadence from the architecture doc (§6 of Sprint 55).
- **Open Questions / Recommendations**: not shown in Interview Mode's panel — those are Sprint-54-later-scope concepts (`Recommendation`/`OpenQuestion` types exist in the domain model but are explicitly out of scope per the Sprint 54 brief's "no recommendations" rule, carried forward here). Keep the panel to Assessment + Decision only, exactly what already exists and is tested.

---

## 5. Question Experience

| Type | Presentation |
|---|---|
| **Open-ended** | Plain assistant bubble, plain text input — no special chrome. This is the default and should be the *most common* visual state, since it's the most conversational. |
| **Yes/No** | Assistant bubble followed by two inline chip buttons (`[ Yes ]` `[ No ]`) directly under the message, still allowing free-text override (user can just type "yes" too — chips are a shortcut, never the only path). |
| **Multiple choice** | Assistant bubble + a small vertical stack of chip buttons for each option, plus an implicit "something else" — typing always remains available. Never a native `<select>` — chips keep it feeling conversational, not form-like. |
| **Examples-prompt** | Same as open-ended, but the assistant message itself includes the examples inline ("...like online booking or inventory tracking") — no separate UI, examples are just better copy. |
| **Clarification** | Visually distinguished with a subtle amber-tinted bubble border (same amber token as `NEEDS_MORE_INFORMATION`) — signals "this one's about resolving something," not just gathering new info. |
| **Confirmation** | Bubble phrased as a statement with `[ That's right ]` `[ Not quite ]` chips — confirming promotes a fact from inferred→confirmed (per architecture doc §3); the UI should make "confirm" feel like a quick tap, not a full answer. |
| **Priority ranking** | Deferred — per the architecture doc, this type is explicitly out of MVP scope (§16 roadmap). Not designed further here; when it lands, a simple drag-to-reorder chip list is the likely direction, reusing the same chip visual language. |

**General rule:** chips are always *shortcuts layered on top of* free text, never a replacement for it — the user should always be able to just type a full sentence regardless of question type, because "explaining my business" beats "picking an option" as the primary mode. This is the single most important interaction principle in this section.

---

## 6. Question Queue

**Recommendation: show it, but folded into the Business Discovery panel — not a separate "upcoming questions" list.**

Reasoning: a literal upcoming-questions queue (`Next: Core Features, Integrations, Payments...`) directly contradicts "adapt dynamically" from the architecture doc — the actual next question depends on what the *previous* answer contained, so showing a fixed-looking queue would either be misleading (it reorders unpredictably) or require constant re-shuffling animation that reads as buggy rather than intelligent.

Instead:

```
┌────────────────────────────────┐
│  Covered                         │
│    ✓ Business Vision             │
│    ✓ Industry                    │
│                                   │
│  Currently discussing            │
│    ▸ Target Users                │  ← matches the live question
│                                   │
│  Still to cover                  │
│    Core Features · Integrations  │  ← unordered chip cloud, not
│    · Payments · Tech Prefs        │    a numbered/sequenced list
└────────────────────────────────┘
```

- **"Covered"** and **"Currently discussing"** are ordered (they reflect what already happened). **"Still to cover"** is an unordered chip cloud, deliberately — it's honest about the fact the order isn't fixed, while still answering "what's left" (satisfying the brief's ask without overpromising a script).
- **Should users see this?** Yes — it's motivating and answers "how much longer," a top anxiety in any interview-style flow.
- **Should they reorder?** No — reordering implies the system will honor a fixed sequence, undermining adaptivity. Instead:
- **Should they skip?** Yes — tapping a chip in "Still to cover" surfaces a small inline option: *"Jump to this topic"* or *"Skip for now"* — the user can steer, but the system still decides *how* to ask once steered there.
- **Return later?** Skipped topics stay visible in "Still to cover" indefinitely (not hidden), so nothing is silently dropped.

---

## 7. Live Progress

- **Updates after every answer** — not every section, not only on confirmation. This matches the architecture doc's §6 (recompute every turn) exactly; showing progress less often than the underlying data changes would make the UI feel stale/untrustworthy.
- **Animation**: the completeness bar fill animates over ~400ms ease-out on each update (already the exact transition class used in Builders' other progress bars — `transition-all duration-300 ease-out`, extend slightly to 400ms for this specific bar since jumps can be larger than typical form-completion ticks).
- A **milestone toast is NOT used** for every point gained — too noisy over a 15–20 question interview. Reserve any celebratory animation for tier changes (state badge color change) and for Discovery Completion only (§8). This keeps "professional, not childish" consistent throughout, not just at the end.

---

## 8. Discovery Completion

**When `decision.state` reaches READY, mid-conversation, seamlessly:**

```
┌──────────────────────────────────────────────────────────┐
│                                                              │
│   ✓  You're ready.                                          │
│                                                              │
│   We've got enough to put together a solid first draft       │
│   of your Project Definition.                                │
│                                                              │
│   ┌────────────────────────────────────────────────────┐  │
│   │  Business Assessment                                  │  │
│   │  Retail · Website · Growing Digital                   │  │
│   │                                                        │  │
│   │  What we've captured                                   │  │
│   │  • A simple online store for a boutique clothing        │  │
│   │    retailer in Coimbatore                              │  │
│   │  • Target users: Shoppers                              │  │
│   │  • Core features: Product catalog, ...                 │  │
│   └────────────────────────────────────────────────────┘  │
│                                                              │
│   [ Generate Project Definition ]     [ Keep talking ]      │
│                                                              │
└──────────────────────────────────────────────────────────┘
```

- **Delivered as the assistant's final chat message** (not a jarring modal takeover) — the celebration lives in the same conversational flow, e.g.: *"That's everything I need for now — want me to put together the Project Definition, or is there more you'd like to add?"* — followed by the summary card and two clear actions.
- **"Do not make it childish. Professional."** → a single checkmark icon, no confetti, no bouncy animation — a calm fade-in of the summary card is the entire celebratory gesture. The *emotional* payoff comes from the copy ("You're ready") and the clean summary, not from decoration.
- **"Keep talking" always offered** — READY is a floor, not a ceiling; some users will want to add more (matches architecture doc §7 — READY stops the *system* from asking, but never blocks the user from volunteering more).
- **`[Generate Project Definition]`** triggers exactly the same existing action Sprint 54.1 already built in `RequirementsDraftPanel` — no new generation logic, just a new entry point into it.

---

## 9. Pause & Resume

**Customer leaves mid-interview:**
- No modal, no "are you sure" — Pause is a single tap, always safe (everything's already durably saved per-turn, per the architecture doc's §6).
- Session card on the main dashboard now shows a **"Continue Interview"** affordance instead of the generic "Continue Project" — surfaced via the existing `CONTINUE WORKING` / `RECENT PROJECTS` dashboard sections already present, just with interview-specific copy and icon (💬 instead of 🚀ⁿᵉᵃʳᵉˢᵗ existing pattern) so it's recognizable at a glance.

**Customer returns (same session, days later):**

```
┌──────────────────────────────────────────────────────────┐
│  🤖  Welcome back. Here's where we left off:                │
│                                                              │
│      We've covered your business vision and target users.  │
│      Still need to talk about payments and integrations.    │
│                                                              │
│      [ NEEDS MORE INFO · 49% ]                               │
│                                                              │
│      What are the core features your customers will need?  │
│                                                              │
└──────────────────────────────────────────────────────────┘
```

- **No notification/badge system for Sprint 55.1 scope** — a session simply waits, visible on the dashboard, until the user comes back on their own. (Proactive notifications — email/push reminders — are a reasonable *future* feature but out of scope here; flag as a roadmap candidate, not a Sprint 55/56 requirement.)
- **Recap + immediate continuation in one message** — no separate "ready to continue?" gate (matches architecture doc §8 exactly: don't add friction on top of the recap itself).
- **Dashboard, not a popup** — resuming always happens by the user navigating back into the project, never via an interstitial screen forced on load elsewhere in the app.

---

## 10. Form + Interview

**Switching mid-flow should feel like changing the *view* of one thing, not switching products.**

```
   Interview Mode                          Requirements Form
  ┌─────────────────┐   [✎ Switch to Form]  ┌─────────────────┐
  │  🤖 Tell me...    │  ───────────────────►  │  Project Vision: │
  │  👤 Shop owners...│                         │  "Local shop..." │ ← pre-filled from
  │                    │  ◄───────────────────  │  Target Users:   │   what Interview
  │  [⏸] [✎ Form]     │   [💬 Switch to        │  "Shop owners"   │   Mode already
  └─────────────────┘    Interview]           │  ...             │   extracted
                                                └─────────────────┘
```

- **Both read/write the same `BusinessUnderstandingModel`** (architecture doc §0/§13) — switching to the Form shows fields **already pre-filled** with whatever Interview Mode has extracted so far. Nothing is lost, nothing needs re-entry.
- **Switching feels instant** — no loading spinner, no "are you sure," a simple slide/cross-fade transition (~200ms) between the two views within the same dialog, since both already share the same underlying data fetch.
- **Conflicts**: if the user edits a field in the Form that Interview Mode already asked about, there's no error or warning dialog — the Form's edit simply wins (last-write-wins, per architecture doc), and if they switch back to Interview Mode, the *next* AI message naturally reflects the change (e.g., "I see you updated your target users to include wholesale buyers too — tell me more about them?") rather than a silent overwrite. **The conflict resolution IS the next question** — no separate conflict UI needed.
- **Updates sync** the same way both directions: whichever surface is currently open re-fetches/re-renders via the same live-refresh mechanism already built in Sprint 54.1 (`discoveryRefreshKey` pattern) — no new sync mechanism required.

---

## 11. Document Upload (Future)

**Where it appears, designed now so nothing needs restructuring later:**

```
┌──────────────────────────────────────────────────────────┐
│  💬 Interview with Discovery Agent                          │
│  ──────────────────────────────────────────────────────── │
│   🤖 Tell me about who this is for.                         │
│                                                              │
│  ┌──────────────────────────────────────────────┐          │
│  │ Type your answer...                    [📎] [→] │ ← attach
│  └──────────────────────────────────────────────┘   icon reserved
│  [⏸ Pause]                    [✎ Switch to Form]           │   from day one,
└──────────────────────────────────────────────────────────┘   disabled/hidden
                                                                  until Sprint 61
```

- The chat input already visually reserves a `📎` attach affordance from the very first ship of Interview Mode (kept disabled/hidden via feature flag, not literally invisible-but-absent-from-layout) — this means Sprint 61's Document Adapter (per the architecture roadmap) only needs to **enable** an already-designed slot, not redesign the input bar.
- When enabled: an uploaded document appears as a distinct message type in the chat (a small file-card bubble, not inline text), and its extracted facts flow into the Business Discovery panel exactly like a spoken answer would — **no new panel, no new visual language**, because the Document Adapter produces the same `BusinessUnderstandingModelPatch` contract as chat (architecture doc §15).
- This satisfies "without redesigning Interview Mode" literally — the design work here *is* the reservation of that slot now.

---

## 12. Accessibility

| Area | Requirement |
|---|---|
| **Keyboard** | Full tab order: input → send → chip options (if present) → pause/switch actions → discovery panel (as a landmark region, tab-skippable via a "skip to discovery" link for screen reader users). Enter submits; Shift+Enter for newline. Chip buttons are real `<button>` elements, not styled `<div>`s. |
| **Screen readers** | Each new assistant message is announced via an `aria-live="polite"` region (not `assertive` — don't interrupt whatever the user is doing). The Discovery panel's live updates use a *separate*, less chatty `aria-live="polite"` region that announces only state-tier changes and completion (not every field pulse) — over-announcing live regions is a common, real accessibility anti-pattern to explicitly avoid here. |
| **Color** | Never color-alone for state (READY/NEEDS_MORE_INFO/INSUFFICIENT) — always paired with the text label, exactly as `BusinessDiscoveryCard` already does (`Ready`, `Needs More Information`, `Insufficient Information` text alongside the badge color). Chip resolution (missing→partial→gone) is also conveyed by position/text, not color change alone. |
| **Focus** | Focus returns to the chat input after every assistant message completes streaming — never left stranded on a chip that just disappeared. Modal-like states (e.g. mobile bottom sheet for the discovery panel) trap focus correctly and restore it on close. |
| **Contrast** | All chip/badge combinations must meet WCAG AA against both the light and dark card backgrounds already in use — audit the existing green/amber/red tokens (`text-green-600 dark:text-green-400` etc.) specifically in the chat-bubble context, since bubble backgrounds differ from the card backgrounds they were originally designed against. |
| **Animations** | Respect `prefers-reduced-motion` — bubble fade/slide, bar fill animation, and badge pulse all collapse to instant/near-instant state changes when the user has that preference set. Streaming text itself should still render (it's functional, not decorative) but without added flourish. |

---

## 13. Responsive Design — Summary Layouts

(Full wireframes already given in §2; consolidated here for reference.)

| Breakpoint | Chat | Discovery Panel | Queue |
|---|---|---|---|
| **Desktop** (≥1280px) | ~60% width, left | ~40% width, right, always visible | Folded into panel (§6) |
| **Tablet** (768–1279px) | Full width, tab 1 | Full width, tab 2 (badge on tab when updated) | Folded into panel |
| **Mobile** (<768px) | Full width, primary surface | Collapsed strip → bottom sheet on tap | Folded into panel, inside sheet |

---

## 14. Micro-interactions

| Interaction | Design |
|---|---|
| **Hover** (desktop) | Chip options lift 1px with a subtle shadow on hover; send button brightens; discovery panel field rows get a faint background highlight on hover (affordance that they're inspectable, even though not clickable in v1). |
| **Typing** (user, in input) | Standard — no special effects; send button transitions from disabled/grey to purple/active the moment there's non-whitespace content. |
| **Streaming** (assistant) | Token-by-token reveal, cursor-blink at the end of the visible text while streaming (same convention as Builders' main chat). |
| **Completion** (per-turn) | The instant an answer is submitted, it locks (no longer editable in-place — matches how chat generally behaves) and the input clears with a quick fade, ready for the next turn. |
| **Saving** | No explicit "saving..." indicator needed for individual turns — since save is fire-and-forget-but-fast (matches the architecture's per-turn update design) and errors are surfaced distinctly (§15), a persistent save spinner would be more noise than signal. |
| **Thinking** | Covered in §3 — three-dot bubble. |
| **Loading** | Covered in §3 — skeleton bubbles. |
| **Progress** | Covered in §7 — animated bar fill. |
| **Badges** | State badge pulses once (ring animation, ~600ms) only on tier change, never on every update (§4). |
| **Transitions** | Form↔Interview switch: 200ms cross-fade (§10). Tablet tab switch: 150ms slide. Mobile sheet open/close: 250ms slide-up/down with backdrop fade. |

---

## 15. Error States

| Error | UX |
|---|---|
| **BuildersDB unavailable** | Chat still works locally in the sense that the conversation continues to render, but a small, persistent, non-blocking banner appears above the input: *"Your answers aren't saving right now — you can keep going, but refresh with caution."* — mirrors the exact "no customer-facing error toast, subtle unavailable state" philosophy already established for `BusinessDiscoveryCard` in Sprint 54.1 (its `unavailable` status renders nothing scary, just hides). Discovery panel shows its existing neutral empty-state copy. |
| **Network error** (single request failed) | Inline retry chip on the affected message only (§3) — never a full-page error. |
| **AI timeout** | After a reasonable wait (~15–20s), the thinking indicator is replaced with: *"That's taking longer than expected — [Try again] or [Type your answer while I catch up]"* — never leave the user staring at an infinite spinner with no recourse. |
| **Cancelled** (user navigates away mid-request) | Silent — the in-flight request is abandoned client-side; nothing is shown, because the turn simply wasn't recorded (consistent with the durable, per-turn commit model — nothing is left half-written). |
| **Refresh** (user hard-reloads) | Same as Resume (§9) — the session reloads from durable state, picks up exactly where the last *completed* turn left off, with the recap message. |
| **Expired session** | Rare (sessions don't expire by design — they're just "created"/"active" until explicitly completed/abandoned), but if the underlying project/session was deleted externally: a clear, calm message replacing the chat area — *"This interview session is no longer available. You can start a new one."* — with a single `[Start New Interview]` action, never a raw error dump. |

---

## 16. Future Features — Designed Without Redesigning the Interface

| Feature | How it fits without a redesign |
|---|---|
| **Voice** | The input bar gains a microphone toggle next to the reserved attach icon (§11) — voice-to-text fills the same text input, so every downstream piece (bubbles, Discovery panel, question flow) is unchanged. |
| **Multi-user** | User bubbles gain a small name/initial tag when more than one participant is present (currently omitted since it's always "you") — no layout change, just a label appearing on an already-existing bubble type. |
| **Co-pilot** (an internal team member observing/assisting) | A read-only "watching" indicator in the header, plus an optional internal-only side note thread — deliberately not designed in detail here since it's a distinct, later capability, but the two-column layout already has room for a third, narrower observer rail on very wide screens without touching the chat/discovery split. |
| **Meeting Mode** (multi-turn live transcript ingestion) | Same Chat Adapter pipeline as Voice, per the architecture doc §15 — visually, a meeting transcript just produces a rapid sequence of "answers" the same UI already knows how to render, batched with a "Processing meeting notes…" thinking state instead of a single-turn one. |
| **Screen Sharing** | Out of visual scope for this spec — would likely be a separate modal/tool entirely, not a Discovery panel concern; flagged as needing its own design pass later, not pre-designed here. |
| **Website Analysis** | Same as Document Upload (§11) — appears as an alternate attach action ("Analyze a website" alongside "Upload a document"), producing chat-visible extraction results the same way. |
| **Document Analysis** | Fully covered in §11. |

The unifying reason none of these require a redesign: **every future input modality terminates in the same `BusinessUnderstandingModelPatch` → Business Discovery panel update cycle** the chat already uses. The UI's job was never "handle chat" — it was "render facts arriving over time and show what's still missing," which is modality-agnostic by construction.

---

## 17. Implementation Order

Small, independently shippable UI milestones — sequenced so each is demoable on its own and de-risks the next:

| Milestone | Scope | Depends on |
|---|---|---|
| **M1 — Static chat shell** | Chat layout (desktop only), bubble styles, input bar, greeting message — wired to a stubbed/mocked question source, no live Discovery Agent yet. Proves the visual language. | Sprint 56 (session plumbing) |
| **M2 — Business Discovery panel, live** | Wire the existing `BusinessDiscoveryCard`/`useDiscoveryIntelligence` into the new layout with per-turn refresh. Proves the "always visible, live" requirement end-to-end with real data. | M1 + Sprint 57 (Question Planner) |
| **M3 — Question types & chips** | Yes/No, multiple-choice, confirmation chip interactions (§5). | M2 |
| **M4 — Question Queue (Covered/Current/Still-to-cover)** | §6, folded into the panel. | M2 |
| **M5 — Pause/Resume + dashboard entry point** | §9, including the recap message and dashboard "Continue Interview" affordance. | M2 |
| **M6 — Discovery Completion screen** | §8, wired to real `READY` detection and the existing "Generate Project Definition" action. | M2 |
| **M7 — Form ↔ Interview switching** | §10, cross-fade transition and shared-model pre-fill. | M2, M5 |
| **M8 — Responsive (tablet, mobile)** | §2, §13 layouts. | M1–M7 stable on desktop |
| **M9 — Accessibility pass** | §12, applied across all prior milestones. | M8 |
| **M10 — Error states & polish** | §15, micro-interactions (§14) refinement. | M8 |
| **M11 — Document upload slot (reserved, disabled)** | §11's attach-icon reservation, inactive. | M1 |

Desktop-first, accessibility and responsive as dedicated *later* passes rather than interleaved — this matches how Sprint 54.1 itself was verified (desktop live-verified first) and keeps each milestone's demo unambiguous.

---

**This is a UX specification only.** No code, files, migrations, or tests were created or modified as part of Sprint 55.1.
