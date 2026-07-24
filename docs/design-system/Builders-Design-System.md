# Builders Design System

**Sprint 69 — Design System Foundation. Sprint 70 — Legacy Dark-Theme Token Remediation.** This
document describes what actually exists in the codebase today: real tokens, real components,
real adoption sites. Nothing here is aspirational — if a component or token isn't listed, it
hasn't been built yet.

Status: **Foundation established, limited adoption proven, legacy `app/components/ui/**` token
layer corrected and guarded against regression.** Most of the app still uses its pre-existing
styling and is completely unaffected by these sprints — see [Remaining Adoption
Work](#remaining-adoption-work).

## 0. Legacy Token Rule (Sprint 70)

**Rule: a `-dark`-suffixed `bolt-elements-*` class is always invalid in this codebase and must
never be introduced.** This app's theming is CSS-custom-property + `[data-theme]`-attribute
based (`app/styles/variables.scss`, `uno.config.ts`'s `presetUno({ dark: { light:
'[data-theme="light"]', dark: '[data-theme="dark"]' } })`) — a token like
`bg-bolt-elements-background-depth-1` already resolves correctly in both themes on its own.
There is no parallel `-dark`-suffixed token family and there never has been one; any class
shaped like `text-bolt-elements-textPrimary-dark` compiles (UnoCSS silently emits nothing for an
unknown utility) but resolves to no CSS, exposing whatever the browser's native surface/text
color is underneath.

Sprint 69's audit found roughly 175 such occurrences, concentrated in `app/components/ui/**`
(plus a handful of dependent Bolt-token bugs: bare `bolt-elements-background`/`-border`/`-ring`
references with no matching CSS var, and one invalid `background-depth-0`). Sprint 70 fixed
every occurrence found in `app/components/ui/**` and added a permanent regression guard —
see §18.

**A handful of files outside `app/components/ui/**` still have this bug** (found but not fixed
in Sprint 70, since it scoped strictly to the shared primitives directory) — see §17.

---

## 1. Design Principles

Builders should read as a premium AI software factory — restrained, hierarchical, dark-surfaced,
quietly polished. Inspiration (never copied) from Linear, Vercel, Cursor, Raycast, Notion,
Framer: restraint over decoration, clear hierarchy, subtle borders, compact density, purposeful
motion, unambiguous status communication.

Builders should **not** read as: a generic admin dashboard, a gaming interface, a neon
cyberpunk UI, a loose collection of unrelated cards, an AI chat demo, or a developer-only IDE.

Concretely:

- **Tokens over hardcoded values.** A color, radius, or spacing value used more than once should
  come from a token, not be retyped.
- **Additive, not disruptive.** Every token and component in this system is new. Nothing
  existing was renamed or removed — see [Backward Compatibility](#backward-compatibility).
- **Status is never color-only.** Every status pairs color with an icon and/or text label.
- **Two densities, one token set.** Business Mode (comfortable) and Engineering Mode (compact)
  should be achievable by varying spacing/sizing choices at the call site — not by forking the
  token system itself.

---

## 2. Existing UI Audit (Summary)

A full audit preceded implementation. Key findings that shaped this system's design:

- **The token *architecture* was already sound** — primitive palette (`uno.config.ts`) → themed
  CSS custom properties (`app/styles/variables.scss`, keyed by `[data-theme]`) → semantic UnoCSS
  classes (`bg-bolt-elements-*`). This sprint extends that same pattern rather than replacing it.
- **A meaningful subset of `app/components/ui/*` primitives reference tokens that don't
  exist** — `bg-bolt-elements-background` (no `-depth-N`), `bolt-elements-border`,
  `bolt-elements-ring`, and ~175 occurrences of `-dark`-suffixed classes across 17 files (a
  theming convention this codebase never actually uses — theming is done via `[data-theme]`
  attribute selectors, not parallel `-dark` class names). These are silently unstyled today.
  **Not fixed in this sprint** — fixing them is a separate, larger undertaking; this system is
  additive alongside them.
- **Status coloring was hand-rolled independently at least five times**: `ProjectDashboard.tsx`'s
  `ROADMAP_STATUS_META`, `ProjectTaskCard.tsx`'s `TASK_STATUS_META`, `ReviewComponents.tsx`'s
  inline map, `ProjectWorkflowBar.tsx`'s `STATUS_META`, and `app/components/ui/StatusIndicator.tsx`'s
  `STATUS_COLORS` — each picking its own shade of green/red with no shared token or icon.
  `BUILDERS_STATUS_META` (§7) is the fix; `ReviewComponents.tsx`'s map is migrated onto it in
  this sprint (§12), the other four are not yet.
- **Purple is the de facto brand color** (`purple-500`/`#A855F7`, matching Tailwind/UnoCSS's
  default palette) despite `uno.config.ts`'s own `accent` palette actually being a blue-gray —
  a naming trap. `--builders-brand-primary` (§4) formalizes purple as the real, named brand
  token.
- **No `prefers-reduced-motion` handling existed anywhere.** Fixed globally in
  `app/styles/animations.scss` (§9) — every existing decorative animation, not just new ones.
- **No component test convention or Storybook/gallery existed.** This sprint establishes
  `.spec.tsx` + Vitest + React Testing Library as the pattern (§13); a Storybook-like internal
  showcase was evaluated and skipped (§14) per the sprint's own "skip if no safe convention
  exists" instruction.
- **Radius was inconsistent at scale**: `rounded-lg` (524 uses), `rounded-full` (230),
  `rounded-xl` (114), `rounded-md` (100), `rounded-2xl` (12), `rounded-sm` (3) — five scales in
  use with no documented rule. The new `builders-radius-*` scale (§8) is the documented answer
  going forward; existing usages are unchanged.

---

## 3. Token Architecture

All new tokens live in **`app/styles/builders-tokens.scss`**, imported once from
`app/styles/index.scss`, additive alongside (never replacing) `app/styles/variables.scss`'s
existing `--bolt-elements-*` tokens.

Two kinds of definitions:

1. **Theme-agnostic aliases** (`:root`) — point at an already-correct `--bolt-elements-*` value
   (e.g. `--builders-text-primary: var(--bolt-elements-textPrimary)`), so they never need their
   own light/dark split.
2. **New concepts** (`:root[data-theme='light']` / `:root[data-theme='dark']`) — status colors,
   brand color, focus/selected states, muted/disabled/inverse text, translucent surfaces. These
   need an explicit value per theme. Translucent brand/status surfaces use CSS `color-mix()`
   (already used elsewhere in this codebase — see `index.scss`'s `.modern-scrollbar-invert`)
   rather than requiring a new generated alpha palette.

Every token is also exposed as a UnoCSS utility class via `theme.colors.builders.*` in
`uno.config.ts` (a passthrough block, same pattern as the existing `theme.colors.bolt.elements.*`
block) — so tokens are used as ordinary classes (`bg-builders-surface-elevated`,
`text-builders-status-error-text`) rather than raw `[var(--builders-...)]` arbitrary values.

---

## 4. Token Reference

### Background / Surface

| Token | Class | Notes |
|---|---|---|
| App background | `bg-builders-bg-app` | Alias of `--bolt-elements-bg-depth-1` |
| Sidebar background | `bg-builders-bg-sidebar` | Alias of `--bolt-elements-bg-depth-2` |
| Primary surface | `bg-builders-surface-primary` | |
| Elevated surface | `bg-builders-surface-elevated` | Default for `BuildersCard`/`BuildersSurface` |
| Recessed surface | `bg-builders-surface-recessed` | Inputs, insets |
| Interactive surface | `bg-builders-surface-interactive` | Barely-there tint before hover |
| Hover surface | `bg-builders-surface-hover` | |
| Selected surface | `bg-builders-surface-selected` | Brand-tinted via `color-mix()` |
| Overlay backdrop | `bg-builders-overlay-backdrop` | Modal/dialog scrims |

### Text

| Token | Class |
|---|---|
| Primary | `text-builders-text-primary` |
| Secondary | `text-builders-text-secondary` |
| Tertiary | `text-builders-text-tertiary` |
| Muted | `text-builders-text-muted` |
| Disabled | `text-builders-text-disabled` |
| Inverse (on brand-filled surfaces) | `text-builders-text-inverse` |
| Link | `text-builders-text-link` |

### Borders

| Token | Class |
|---|---|
| Subtle | `border-builders-border-subtle` |
| Default | `border-builders-border-default` |
| Strong | `border-builders-border-strong` |
| Focus | `border-builders-border-focus` (used by `builders-focus-ring`) |
| Selected | `border-builders-border-selected` |

### Brand

| Token | Class | Value (dark) |
|---|---|---|
| Primary | `bg`/`text`/`border-builders-brand-primary` | `purple-500` (`#A855F7`) — matches the hue already used by the workflow-bar glow animation |
| Secondary | `-builders-brand-secondary` | `accent-400` |
| Hover | `-builders-brand-hover` | `purple-400` |
| Active | `-builders-brand-active` | `purple-300` |
| Subtle surface | `bg-builders-brand-subtleSurface` | `color-mix()` of primary at 14% |

### Status

Each of the 10 statuses has a `text` / `border` / `bg` trio (`text-builders-status-{name}-text`,
etc.):

`success`, `warning`, `error`, `info`, `active`, `pending`, `completed`, `blocked`, `approval`,
`working`.

Notes: `completed` deliberately reuses the `success` hue (same "finished" meaning) but has its
own token trio so call sites name their real intent. `blocked` is a deeper, more saturated red
than `error` so the two never look interchangeable at a glance. `active`/`working` both use the
brand purple (in-progress = brand color, matching the app's existing convention). See
`app/components/ui/builders/statusMeta.ts` for the icon/label pairing every status also carries
— **color is never the only signal**.

---

## 5. Typography

No new font family was introduced (per the sprint's own instruction). The scale below is what
the adopted components actually use; it is a *documented convention*, not a new CSS token system
(UnoCSS's existing `text-*` utilities already cover the sizes needed):

| Step | Size / weight | Used by |
|---|---|---|
| Page title | `text-lg font-semibold tracking-tight` | `BuildersPageHeader` |
| Section title | `text-sm font-semibold tracking-tight` | `BuildersSectionHeader` |
| Card title | `text-base font-semibold tracking-tight` | `BuildersCardTitle` |
| Body | `text-sm` | Card content, alert body |
| Body small / Label | `text-xs font-medium` | Input labels, `BuildersBadge` |
| Caption / Metadata | `text-xs text-builders-text-tertiary` | Hints, timestamps |

---

## 6. Spacing

No new spacing scale was introduced — UnoCSS's default 4px-based scale (`p-1` = 4px, `p-2` =
8px, ...) is used throughout, matching the sprint's "prefer a consistent 4px or 8px-based system"
instruction and the app's existing convention. Components document their own spacing choices
inline (e.g. `BuildersCard`'s `p-5` = 20px card padding, `BuildersSectionHeader`'s `mb-3` = 12px).

**Density is a call-site decision, not a token fork**: Business Mode areas (e.g. the "Current
Stage" hero) use generous padding (`p-5 sm:p-6`); Engineering Mode / dense list areas should use
tighter values (`p-2`/`p-3`) with the *same* tokens for color/border/radius. No component in
this sprint hardcodes a single density — every spacing prop is a plain `className` override.

---

## 7. Surface Hierarchy

`BuildersSurface` (and `BuildersCard`, built on it) expose exactly three elevation steps:

- **`primary`** — the base app/page background level.
- **`elevated`** (default) — a card or panel sitting above the page.
- **`recessed`** — an inset area (form inputs, code blocks).

Combined with `border` (`none` / `subtle` / `default` / `selected`) and `radius` (`sm` / `md` /
`lg`), this covers the surface vocabulary the sprint's Part 2 calls for without inventing a
fourth "interactive" surface component — `surface-interactive`/`surface-hover` exist as tokens
for call sites that need a clickable-row treatment, without a dedicated component wrapping them
yet.

---

## 8. Borders, Radii, Shadows

**Radius** (UnoCSS shortcuts in `uno.config.ts`, fixed pixel values rather than borrowing Uno's
own scale, so the 4-step scale is explicit):

| Shortcut | Value |
|---|---|
| `builders-radius-sm` | 6px |
| `builders-radius-md` | 10px |
| `builders-radius-lg` | 16px |
| `builders-radius-pill` | `rounded-full` |

**Borders**: `subtle` for barely-visible separators, `default` for standard cards/inputs,
`strong` for emphasis, `focus`/`selected` tie to the brand color.

**Shadows** — restrained, only for floating/elevated elements (never large page surfaces):

| Shortcut | Value |
|---|---|
| `builders-shadow-sm` | `0 1px 2px rgba(0,0,0,0.24)` |
| `builders-shadow-md` | `0 4px 16px rgba(0,0,0,0.32)` |
| `builders-shadow-lg` | `0 12px 32px rgba(0,0,0,0.40)` |

`BuildersSurface`'s `shadow` prop defaults to `none` — a card is not elevated with a shadow by
default, only dropdowns/popovers/modals should opt in.

---

## 9. Motion

- `builders-transition` (UnoCSS shortcut) — the one hover/focus/state-change transition every
  interactive primitive uses: `transition-all duration-150 bolt-ease-cubic-bezier
  motion-reduce:transition-none`.
- **Global `prefers-reduced-motion: reduce` handling** added to `app/styles/animations.scss` —
  previously absent from the entire codebase. Neutralizes every existing decorative/continuous
  animation (the workflow-bar glow/ping, dropdown/hero entrances), not just new ones — state
  changes still happen instantly, only the decorative transition is removed.
- Loading spinners (`BuildersButton`'s `isLoading`, `BuildersStatusBadge`'s `working` status) use
  `animate-spin motion-reduce:animate-none` individually as well, since a spinner is core to
  conveying "in progress" and needs its own explicit reduced-motion opt-out.

---

## 10. Accessibility

- **`focus-visible`, never plain `focus`** — the `builders-focus-ring` shortcut only shows a
  ring for keyboard/AT navigation, never for a mouse click.
- **Status is never color-only** — `BuildersStatusBadge` always renders an icon (`aria-hidden`)
  alongside a text label; `compact` mode keeps the label in an `sr-only` span rather than
  dropping it.
- **Required accessible labels**: `BuildersIconButton.ariaLabel` and `BuildersInput.label` are
  required props, not optional — an icon-only button or unlabeled input can't ship through these
  primitives.
- **Loading semantics**: `BuildersButton.isLoading` sets `aria-busy` and disables the control
  without changing its width (no layout shift) or removing its visible label.
- **Error semantics**: `BuildersInput.error` sets `aria-invalid` and associates the error text
  via `aria-describedby`.
- **Native control resets**: `BuildersInput` neutralizes native autofill's light-blue background
  (`-webkit-autofill` override) so no browser-default light surface can leak through in dark
  mode — the exact class of bug (native `buttonface` surfaces) the audit found had already
  caused a real regression in `ProjectWorkflowBar` (see that file's own Sprint UX-2.1 comment).
- **Reduced motion** — see §9.

---

## 11. Foundational Components

All in `app/components/ui/builders/`, exported from `app/components/ui/builders/index.ts`.
**New components, not rewrites** of the existing `app/components/ui/*` primitives — those are
untouched and still used everywhere they were before; `Builders*` components only appear at the
handful of adoption sites in §12.

| Component | Purpose |
|---|---|
| `BuildersButton` | Primary interactive button — `primary`/`secondary`/`outline`/`ghost`/`danger` variants, `isLoading` state |
| `BuildersIconButton` | Icon-only button, requires `ariaLabel` |
| `BuildersSurface` | Base surface primitive (elevation/border/radius/shadow variants) |
| `BuildersCard` (+ `Header`/`Title`/`Description`/`Content`/`Footer`) | Card composition built on `BuildersSurface`, mirrors the existing `Card` composition shape |
| `BuildersBadge` | Generic, non-status chip |
| `BuildersStatusBadge` | The shared status pill — icon + label + color, never color-only |
| `BuildersAlert` | Inline notice block (`success`/`warning`/`error`/`info`) |
| `BuildersInput` | Token-driven text input, required `label`, optional `error`/`hint` |
| `BuildersSectionHeader` | Section-level heading with optional trailing action |
| `BuildersPageHeader` | Page-level heading, one typography step above `BuildersSectionHeader` |
| `BuildersDivider` | Horizontal/vertical divider |

Not built this sprint (explicitly out of scope or not yet needed): `BuildersTextarea`,
`BuildersSelect`, `BuildersTabs`, `BuildersTooltip`, `BuildersProgress`, `BuildersSkeleton`,
`BuildersEmptyState`, `BuildersModalSurface` — the existing `app/components/ui/*` equivalents
remain in use for these.

**Shared status vocabulary** — `app/components/ui/builders/statusMeta.ts`'s `BUILDERS_STATUS_META`
is the single source of truth `BuildersStatusBadge`, `BuildersAlert`, and any future migration
of the audit's other four status maps should read from.

---

## 12. Existing Components/Areas Migrated (Limited Adoption)

Exactly five areas, per the sprint's "smallest set that proves the system works" instruction.
**None of these were visually redesigned** — every change is a token/primitive swap that
preserves the existing appearance and behavior:

1. **Project workflow header** (`app/components/sidebar/ProjectWorkflowBar.tsx`) — `STATUS_META`
   and the hardcoded `purple-500`/`green-500` hover/focus/fill classes now read from
   `--builders-*` status and brand tokens. Same sizes, same layout, same animation names.
2. **Current Stage card** (`app/components/sidebar/ProjectDashboard.tsx`'s hero panel) — now a
   `BuildersSurface` (`radius="lg"` = 16px, identical to the previous `rounded-2xl`); its bespoke
   glass background/border are kept as an explicit `className` override for now (not yet a
   token) so appearance is pixel-identical.
3. **Shared button in the Business workflow** (`ProjectManagerPanel.tsx`'s "Continue" CTA) — now
   a `BuildersButton`, replacing a hand-rolled `bg-purple-500` button.
4. **Status badges** (`app/components/sidebar/ReviewComponents.tsx`'s `ReviewBadge`, used by
   `TaskDetailsDialog` and `ProjectDashboard`) — now sources its Pending/Approved/Changes
   Requested colors from `BUILDERS_STATUS_META` instead of its own hardcoded map. Same pill
   shape, same three labels, same public `ReviewBadge` API — every call site is unaffected.
5. **One representative form control group** (`app/components/sidebar/NewProjectDialog.tsx`'s
   Project Name / Description fields) — now `BuildersInput`, replacing two hand-rolled
   `<label>` + `<input>` pairs that hardcoded `bg-gray-50 dark:bg-gray-900` /
   `focus:ring-purple-500`.

Verified live (see the final report's Visual Verification section) at desktop, tablet, and
mobile widths — the workflow bar's complete/active/pending states, the Current Stage hero, the
Continue button, and the New Project dialog's focus ring all render identically to their
pre-sprint appearance.

---

## 13. Component Testing

`.spec.tsx` + Vitest + `@testing-library/react` is the established convention going forward — the
audit found zero rendered-component tests existed anywhere in the repo before this sprint. Two
pieces of test infrastructure were added to make this possible:

- **`vitest-setup.ts`** (registered via `vite.config.ts`'s `test.setupFiles`) — calls React
  Testing Library's `cleanup()` after every test, so multiple `it()` blocks in one `.spec.tsx`
  file don't leak DOM nodes into each other.
- **`vite.config.ts`'s `plugins` array** — Remix's Vite plugin fails ("Remix Vite plugin can't
  detect preamble") when Vitest transforms a `.tsx` file directly. Test mode
  (`config.mode === 'test'`) now uses the plain `@vitejs/plugin-react` JSX transform instead
  (already an installed dependency, previously unused); dev/build modes are completely
  unaffected and still use the real Remix plugin.

Every foundational component with meaningful behavior has a spec file
(`app/components/ui/builders/*.spec.tsx` / `.spec.ts`) — 23 tests covering variants, disabled/
loading states, `focus-visible` classes, accessible labeling, non-color-only status rendering,
and reduced-motion classes. See the final report for the full count.

---

## 14. Internal Component Showcase

**Skipped**, per the sprint's own instruction ("If no safe internal showcase convention exists,
skip this and rely on tests plus documentation"). The audit found no Storybook config and no
dev-only gallery route anywhere in the repo — introducing one from scratch would be new
tooling/infrastructure beyond this sprint's foundation scope. Component behavior is proven by
the `.spec.tsx` suite (§13) and real appearance is proven by the limited-adoption sites (§12),
which are live in the actual app.

---

## 15. Business Mode vs. Engineering Mode Density

Both modes share the exact same token set — density is expressed through spacing/sizing choices
at the call site, not a separate theme or token fork:

- **Business Mode** (e.g. the "Current Stage" hero, `ProjectManagerPanel.tsx`): generous padding
  (`p-5 sm:p-6`), larger touch targets, `BuildersButton size="md"` or `"lg"`.
- **Engineering Mode** (e.g. dense diagnostic lists, the collapsed "Project details" grid):
  tighter padding (`p-3`/`p-4`), `BuildersButton size="sm"`, `BuildersBadge` for compact chips.

No component in this sprint hardcodes one density — every spacing/size prop is overridable via
`className` or the component's own `size` variant.

---

## 16. Do / Do Not

**Do:**
- Use `text-builders-status-{name}-{text|border|bg}` for any new status indicator.
- Use `builders-focus-ring` on any new interactive element.
- Use `BuildersStatusBadge` instead of a new hand-rolled status color map.
- Add a new `Builders*` component only when a pattern is genuinely repeated, has meaningful
  shared behavior, and reduces real inconsistency — not "for the sake of abstraction."
- Keep new tokens/components additive — never rename or remove an existing `--bolt-elements-*`
  token or `app/components/ui/*` primitive as part of an unrelated change.

**Do not:**
- Hardcode `purple-500`/`green-500`/etc. in new code — use the brand/status tokens.
- Use plain `focus:` (only `focus-visible:`) on a new interactive element.
- Communicate status with color alone — always pair with an icon or text.
- Migrate a whole screen "while you're in there" — adoption is deliberate and incremental (see
  §17).
- Introduce a new spacing/radius/shadow scale outside the ones documented here without updating
  this document.

---

## 17. Remaining Adoption Work

The vast majority of the app — Sidebar (93 files), Chat, Workbench, the remaining ~90% of
`ProjectDashboard.tsx`, every other status-color map (`ProjectDashboard.tsx`'s
`ROADMAP_STATUS_META`, `ProjectTaskCard.tsx`'s `TASK_STATUS_META`), the Business/Engineering tab
content beyond the hero, forms, modals, and popovers elsewhere in the app — is **untouched and
continues to use its pre-existing styling**, exactly as both sprints' scope required.

**Sprint 70 fixed the dead `-dark`-suffixed tokens in `app/components/ui/**` (see §0, §18) — that
item from Sprint 69's list is done.** Four files outside that directory still have the same bug
(found during Sprint 70's audit but out of its stated scope, which was `app/components/ui/**`
only): `app/components/@settings/tabs/gitlab/components/GitLabAuthDialog.tsx`,
`app/components/@settings/tabs/mcp/McpTab.tsx`, `app/components/deploy/GitLabDeploymentDialog.tsx`,
`app/components/deploy/GitHubDeploymentDialog.tsx`.

Future sprints could:
- Fix the 4 remaining dead `-dark`-suffixed occurrences outside `app/components/ui/**` (above).
- Migrate the other status-color maps onto `BUILDERS_STATUS_META`.
- Build the remaining suggested primitives (`BuildersTextarea`, `BuildersSelect`, `BuildersTabs`,
  `BuildersEmptyState`, ...) as real repeated patterns are identified.
- Consider a lightweight internal showcase route once/if the team wants one (§14).

## 18. Legacy Token Validation Guard (Sprint 70)

`app/components/ui/legacyTokenGuard.ts` is a pure, synchronous scanner
(`findInvalidLegacyTokenReferences(source: string)`) checking source text against 5 known-invalid
patterns: `-dark`-suffixed `bolt-elements-*` tokens, bare `bolt-elements-background` (no
`-depth-N`), bare `bolt-elements-border` (not `-borderColor`), `bolt-elements-ring` (never
defined), and `background-depth-0` (only 1–4 exist).

`app/components/ui/legacyTokenGuard.spec.ts` runs it two ways, as part of the normal
`npm test` suite:
1. **Pattern self-tests** — synthetic bad/good strings, proving each pattern catches what it
   should and doesn't false-positive on valid Bolt/Builders/plain-Tailwind classes.
2. **Real source scan** — globs every `.ts`/`.tsx` file in `app/components/ui/**` (excluding
   specs and the guard module itself) and asserts zero unresolved matches outside
   `LEGACY_TOKEN_ALLOWLIST` (empty today — every Sprint 70 finding was fixed, not allowlisted).

If a future change reintroduces a `-dark`-suffixed or otherwise invalid legacy token anywhere in
`app/components/ui/**`, this test fails with the exact file, line, and matched string.
