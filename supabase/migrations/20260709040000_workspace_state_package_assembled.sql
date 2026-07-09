-- Workspace State: add missing product_package_assembled column — Sprint 38.5 (fix).
--
-- Found via direct verification: `ProjectWorkspaceState.productPackageAssembled` (see
-- app/lib/projects/workspaceState.ts) was added to the TypeScript type and read by
-- projectManagerEngine.ts's next-action calculator and written by
-- ProductPackagePanel.tsx's handleAssemble — but the column was never added to
-- 20260709030000_project_workspace_state.sql, and workspaceStateRepository.ts's
-- fromRow()/upsertWorkspaceState() never actually mapped it. The field silently never
-- persisted or read back, so the "Package missing → Assemble Product Package" next-action
-- rule could never observe a real "assembled" state. Additive, idempotent — the original
-- migration was already applied, so this is a follow-up ALTER rather than an edit to it.

alter table builders_project_workspace_state
  add column if not exists product_package_assembled boolean not null default false;
