/**
 * Generation Lock — Sprint 43B.
 *
 * A small, generic idempotency primitive: `run(id, fn)` executes `fn` at most once per `id`,
 * however many times it's called — every caller (concurrent or later) for the same `id` gets
 * back the exact same promise, never a second execution. This is the mechanism Sprint 43B's
 * audit concluded Quick Build actually needs: the live investigation traced the observed
 * "~8 finalize calls for one send" not to a bug in the send button, form submission, route
 * mounting, or React StrictMode (all specifically ruled out — see quickBuildOrchestrator.ts's
 * header comment), but to `@ai-sdk/react`'s own multi-step tool-call continuation
 * (`useChat({ maxSteps })`, driven by `mcpSettings.maxLLMSteps`, default 5 — see
 * node_modules/.pnpm/@ai-sdk+react.../dist/index.js's `shouldResubmitMessages`): each
 * automatically-resubmitted step is a genuine, separate HTTP request that legitimately fires
 * its own `onFinish`. That's correct, intentional AI SDK behavior other MCP tool-calling flows
 * may depend on — not something to suppress. What was missing is treating every one of those
 * `onFinish` firings as "the generation is done" and re-running install/build/repair for each.
 *
 * Deliberately NOT a single shared boolean (that would serialize unrelated projects/chats
 * behind each other) and NOT keyed by project id alone (a project can have more than one
 * generation over its lifetime — a retry must be a new, independent run). Keyed by whatever
 * the caller considers this specific generation's stable identity.
 */

const DEFAULT_MAX_TRACKED = 20;

export interface GenerationLock<T> {
  /** Runs `fn` for `id` at most once. A concurrent or later call with the same `id` gets the same promise back — including after it has already resolved, so a late duplicate is a no-op, not a re-run. */
  run(id: string, fn: () => Promise<T>): Promise<T>;

  /** Whether `id` already has a run in flight or completed (bounded — see maxTracked). */
  has(id: string): boolean;
}

/** `maxTracked` bounds memory for long-lived sessions — oldest entries are evicted once the cap is exceeded (insertion order, via `Map`'s own iteration order). Not a correctness concern: eviction only ever affects very old ids a real duplicate callback wouldn't still be arriving for. */
export function createGenerationLock<T>(maxTracked: number = DEFAULT_MAX_TRACKED): GenerationLock<T> {
  const runs = new Map<string, Promise<T>>();

  function run(id: string, fn: () => Promise<T>): Promise<T> {
    const existing = runs.get(id);

    if (existing) {
      return existing;
    }

    const promise = fn();
    runs.set(id, promise);

    if (runs.size > maxTracked) {
      const oldestKey = runs.keys().next().value;

      if (oldestKey !== undefined) {
        runs.delete(oldestKey);
      }
    }

    return promise;
  }

  function has(id: string): boolean {
    return runs.has(id);
  }

  return { run, has };
}
