import { atom } from 'nanostores';

/**
 * Sprint 41.1 — Sidebar Layout Refresh.
 *
 * Persists whether the desktop/tablet sidebar is collapsed (72px, icons only) or expanded
 * (320px). Mobile's overlay drawer is unaffected by this store — it has no collapsed state,
 * only open/closed (see Menu.client.tsx).
 */

const STORAGE_KEY = 'bolt_sidebar_collapsed';
const TABLET_MIN_WIDTH = 768;
const TABLET_MAX_WIDTH = 1024;

function readInitialCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored !== null) {
      return stored === 'true';
    }
  } catch {
    // localStorage unavailable (e.g. private browsing) — fall through to the viewport default.
  }

  // No explicit preference yet: tablet-sized viewports default to collapsed, desktop to expanded.
  return window.innerWidth >= TABLET_MIN_WIDTH && window.innerWidth < TABLET_MAX_WIDTH;
}

export const sidebarCollapsedStore = atom<boolean>(readInitialCollapsed());

export function setSidebarCollapsed(collapsed: boolean): void {
  sidebarCollapsedStore.set(collapsed);

  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Persistence is a nice-to-have — never block the UI toggle on it failing.
  }
}

export function toggleSidebarCollapsed(): void {
  setSidebarCollapsed(!sidebarCollapsedStore.get());
}
