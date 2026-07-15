/**
 * Sidebar visibility while the Workbench is open — pure predicate, deliberately its own
 * dependency-free module rather than living in `workbench.ts` itself: that file's
 * runtime imports pull in the WebContainer client, which makes it awkward to unit-test
 * in isolation.
 *
 * The icon sidebar has no useful function once the Workbench is open — it consumes
 * width and makes Code, Diff, and Preview all feel cramped alike, not just Preview — so
 * visibility depends only on `workbenchStore.showWorkbench`, never on which of the three
 * views (`currentView`) is currently selected. Switching between Code/Diff/Preview while
 * the Workbench stays open must never toggle the sidebar back on, even momentarily.
 *
 * Shared, global logic — `showWorkbench` is the same nanostore for Quick Build and
 * Software Factory, so this function has no project-type awareness at all; both flows
 * get identical sidebar behavior.
 */
export function shouldHideSidebarForWorkbench(showWorkbench: boolean): boolean {
  return showWorkbench;
}
