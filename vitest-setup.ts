/**
 * Builders Design System (Sprint 69) — shared Vitest setup for component tests. Unconditionally
 * unmounts and removes any React Testing Library render after each test, so one `.spec.tsx`
 * file's multiple `it()` blocks (or a loop of `render()` calls within one test) never leak DOM
 * nodes into the next assertion. No-op for the repo's existing non-component `.spec.ts` files —
 * `cleanup()` is a no-op when nothing was rendered.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
