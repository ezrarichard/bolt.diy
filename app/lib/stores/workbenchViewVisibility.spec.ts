import { describe, expect, it } from 'vitest';
import { shouldHideSidebarForWorkbench } from './workbenchViewVisibility';

/**
 * Sidebar visibility while the Workbench is open — see `workbenchViewVisibility.ts` and
 * `Menu.client.tsx` (the sole caller). The sidebar's actual rendering condition is
 * `!shouldHideSidebarForWorkbench(showWorkbench)`, so these cases mirror it one-to-one:
 * visibility depends only on whether the Workbench panel is open at all, never on which
 * of Code/Diff/Preview is currently selected — the function doesn't even take a
 * `currentView` parameter, so switching between those three while the Workbench stays
 * open can't affect the result. It also takes no project-type parameter, so Quick Build
 * and Software Factory (both reading the same `workbenchStore.showWorkbench`) get
 * identical behavior with zero special-casing.
 */
describe('shouldHideSidebarForWorkbench', () => {
  it('shows the sidebar when the Workbench is closed, regardless of which view would be selected', () => {
    /*
     * currentView isn't even a parameter here — closed is closed, no matter which of
     * Code/Diff/Preview was last selected before the Workbench was closed.
     */
    expect(shouldHideSidebarForWorkbench(false)).toBe(false);
  });

  it('hides the sidebar when the Workbench is open in Code mode', () => {
    expect(shouldHideSidebarForWorkbench(true)).toBe(true);
  });

  it('hides the sidebar when the Workbench is open in Diff mode', () => {
    expect(shouldHideSidebarForWorkbench(true)).toBe(true);
  });

  it('hides the sidebar when the Workbench is open in Preview mode', () => {
    expect(shouldHideSidebarForWorkbench(true)).toBe(true);
  });

  it('restores the sidebar once the Workbench closes', () => {
    expect(shouldHideSidebarForWorkbench(true)).toBe(true);
    expect(shouldHideSidebarForWorkbench(false)).toBe(false);
  });

  it('never toggles visibility while switching between Code, Diff, and Preview with the Workbench held open', () => {
    /*
     * Same `showWorkbench` value across every view switch — the result can't change
     * mid-sequence, so there's no window where the sidebar could flicker back on.
     */
    const stillOpen = true;
    const resultsAcrossViewSwitches = [
      shouldHideSidebarForWorkbench(stillOpen), // Code
      shouldHideSidebarForWorkbench(stillOpen), // -> Diff
      shouldHideSidebarForWorkbench(stillOpen), // -> Preview
      shouldHideSidebarForWorkbench(stillOpen), // -> Code again
    ];

    expect(resultsAcrossViewSwitches).toEqual([true, true, true, true]);
  });
});
