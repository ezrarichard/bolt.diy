# Project Lifecycle

Every Builders project is **Active**, **Archived**, or **Deleted**. Only Active projects appear by
default; everything else stays searchable and recoverable.

> [!IMPORTANT]
> **Nothing is ever destroyed automatically.** "Deleted" is a recycle bin — the project row is
> untouched and fully recoverable. The only irreversible action is *Permanent Delete*, which is
> behind its own confirmation and can never be reached by an automatic path.

---

## 1. The three states

| State | Where it appears | How to leave it |
|---|---|---|
| **Active** | Sidebar, home dashboard, everywhere | Archive, or move to bin |
| **Archived** | Only under the Archived filter — but always findable by search | Restore to Active, or move to bin |
| **Deleted** (recycle bin) | Only under the Recycle Bin filter | Restore to Active, or Permanent Delete |

A project restored from the bin always returns to **Active**, never silently back to Archived —
restoring something only to leave it hidden would be a trap.

A project with no recorded status — anything created before lifecycle existed — reads as
**Active**. No project can be hidden by an upgrade.

---

## 2. Where to manage projects

**Sidebar** — quick filter chips (Active / Archived / Bin / All) with live counts, search, and a
per-project delete that moves to the bin rather than destroying anything.

**Manage Projects** (the *Manage* link above the project list) — the full view:

| Column | |
|---|---|
| Project | Name, description and pin state |
| Type | Software Factory or Quick Build |
| Profile | Generation profile |
| Created / Updated | Dates |
| Status | Active / Archived / In bin |

From here you can select any number of projects and **Archive**, **Restore**, **Delete** (to bin)
or **Permanent Delete** them.

### Search reaches everything

Typing a query searches **every status**, not just the current filter. An archived project from
three months ago is always one search away.

---

## 3. Bulk actions and confirmation

Every bulk action shows a confirmation first, listing:

- how many projects are affected, and
- **the name of each one**

Permanent Delete additionally requires typing `DELETE`. It is the only action that removes data,
and the confirmation says so plainly.

---

## 4. Cleanup suggestions

Development clutter — sprint verification runs, throwaway tests, placeholder Quick Builds — is
detected and offered for archiving.

> [!WARNING]
> Suggestions are **pre-selected, never applied**. Builders proposes; a human confirms. No project
> is archived, deleted or modified without someone clicking through the confirmation above.

### What is detected

| Category | Matches |
|---|---|
| Sprint Verification | `Sprint 51 Verification`, `Sprint 64 Verify — …`, `Sprint 31.1 Real Claude Test` |
| Test | A name that is exactly `TEST` / `TEST1`; AI or Claude test runs |
| Quick Build | A project literally named `Quick Build` |
| Acceptance Test | `Acceptance Test — …`, `… Acceptance Round 2` |
| Debug / Prototype / Temporary | Names containing those words |

Duplicate active projects (same name) are also reported. Only the **later** copies are suggested,
so accepting every suggestion still leaves one of each.

### What is deliberately NOT detected

Classification is **name-only and deliberately conservative**. The cost of a false positive is a
real project hidden from the default view, so the rules err towards missing a temporary project
rather than catching a real one.

- **Project type is never a signal.** A `quick_build` project is often real customer work.
- A bare word `test` is not enough: `Test Kitchen Bakery` and `Contest Platform` are never flagged.
- Customer-style names are never flagged — `Riverside Dental Clinic`, `Kovai Trends`,
  `StyleHub Coimbatore`, `Plumber Coimbatore Website` and similar always stay Active.

Some genuinely temporary projects will therefore be missed (for example `Sprint 46D Validation
Clinic`, whose `46D` matches no numeric pattern). Archive those by hand — that is the intended
trade.

---

## 5. Pinned projects

Pin a project from the pin control in Manage Projects. Pinned projects sort first everywhere,
ahead of recency. Unpinned projects are ordered by last activity, falling back to creation date.

---

## 6. What the home dashboard shows

The home dashboard is **Active-only by construction** — Continue Working, Recent Projects, the
statistics row and the activity feed all filter through the same resolver. Archiving a project
removes it from the home screen immediately; restoring it brings it back.

---

## 7. How it is stored

**No migration was required.**

| Data | Stored in |
|---|---|
| Lifecycle state | `builders_projects.status` — the column already existed (`text not null default 'active'`, no check constraint) but was written as a hardcoded `'active'` and never read back |
| Pin flag, archive/delete timestamps | `builders_projects.metadata` (jsonb), the same convention `regionalSelection`, `packageSelection` and `databaseActivation` already use |

Timestamps are set on entry to a state and cleared on restore, so a restored project never carries
a stale archive date.

Every transition is mirrored to BuildersDB and written to the project activity log
(`project_archived`, `project_deleted`, `project_active`), so lifecycle changes appear in the
project's History tab.

---

## 8. Recovering a project

1. Open **Manage Projects**.
2. Choose the **Archived** or **Recycle Bin** filter — or just search for the name.
3. Select the project and choose **Restore**.

It returns to Active with its full history, artifacts and generated files intact. Nothing about a
project changes while it is archived or in the bin; only its visibility does.
