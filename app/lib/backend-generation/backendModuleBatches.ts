/**
 * Backend module batching — Sprint 99, Checkpoint A.
 *
 * Sprint 79 generated all six files of a backend module in ONE AI call. The AR2-BUG-008
 * investigation proved that does not fit: a controlled call replicating the pipeline's own prompt
 * at its own `CODE_GENERATION_MAX_OUTPUT_TOKENS = 8192` ceiling came back `finishReason: "length"`,
 * cut off mid-string inside a `content` value. Every backend file in Acceptance Round 2 — 96 of
 * them, across three runs — was lost to that ceiling.
 *
 * The fix is to ask for less per call. Batches follow the module's own dependency order
 * (`backendModuleFilePathList`) and group files that genuinely need to be written together, so no
 * batch exceeds three files and the common case is two.
 */

import { backendModuleFilePaths } from '~/lib/backend-generation/backendModuleTypes';

export interface BackendModuleBatch {
  /** Stable id for logs, errors and the role key — e.g. "contract", "data", "surface". */
  id: string;

  /** Human label used in structured errors and the timeline. */
  label: string;

  /** The canonical paths this batch must return — the batch fails if it returns none of them. */
  paths: string[];
}

/**
 * Three batches of two, in dependency order. Each batch is a coherent unit:
 *
 * - `contract` — types + validators: the module's shape, needed by everything below.
 * - `data`     — repository + service: database access and the business logic over it.
 * - `surface`  — routes + api adapter: the thin HTTP layer and its one-line passthrough.
 *
 * Two files per call sits well inside the 8192-token ceiling even for a substantial module,
 * which is the whole point of the split.
 */
export function backendModuleBatches(moduleSlug: string): BackendModuleBatch[] {
  const paths = backendModuleFilePaths(moduleSlug);

  return [
    { id: 'contract', label: 'types & validators', paths: [paths.types, paths.validators] },
    { id: 'data', label: 'repository & service', paths: [paths.repository, paths.service] },
    { id: 'surface', label: 'routes & API adapter', paths: [paths.routes, paths.apiAdapter] },
  ];
}

/**
 * Splits a batch for the one permitted retry after a truncated response. Retrying the same batch
 * unchanged would simply truncate again at the same ceiling, so the retry must ask for less:
 * a two-file batch becomes two single-file batches. A batch already down to one file cannot be
 * split further — the caller then fails it rather than looping (bounded retry, per the design).
 */
export function splitBatch(batch: BackendModuleBatch): BackendModuleBatch[] | undefined {
  if (batch.paths.length <= 1) {
    return undefined;
  }

  return batch.paths.map((path, index) => ({
    id: `${batch.id}-${index + 1}`,
    label: path.split('/').pop() ?? batch.label,
    paths: [path],
  }));
}
