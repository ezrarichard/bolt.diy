import { webcontainer } from '~/lib/webcontainer';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import type { GeneratedProject } from './codeGenerationTypes';

/**
 * WebContainer Writer — Sprint 38.
 *
 * The only file in app/lib/code-generation/ that touches the live WebContainer/
 * workbench — everything upstream (generationPipeline.ts, projectGenerator.ts) only
 * ever produces an in-memory `GeneratedProject`. Reuses the exact same file-write path
 * every other file operation in this app already goes through
 * (`workbenchStore.createFile`, backed by `FilesStore.createFile` ->
 * `webcontainer.fs.writeFile`, see app/lib/stores/files.ts) — nothing here talks to
 * `@webcontainer/api` directly except spawning `npm install`/`npm run dev`, which has
 * no existing higher-level API to reuse (the chat-driven "shell action" path goes
 * through `ActionRunner`/`BoltShell`, which expects an in-progress LLM streaming
 * session and a mounted terminal; spawning directly via `webcontainer.spawn` is simpler
 * and produces identical `server-ready`/`port` events, since those come from the
 * WebContainer itself, not from whichever API happened to start the process — see
 * app/lib/stores/previews.ts).
 */

const GENERATED_FILES_STORAGE_KEY_PREFIX = 'builders_generated_project_files_';

function getStoredFilePaths(projectId: string): string[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(GENERATED_FILES_STORAGE_KEY_PREFIX + projectId);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

function setStoredFilePaths(projectId: string, paths: string[]): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(GENERATED_FILES_STORAGE_KEY_PREFIX + projectId, JSON.stringify(paths));
  } catch (error) {
    console.error('[CodeGeneration] Failed to persist generated file path list:', error);
  }
}

/**
 * Writes every file in `project` into the WebContainer, then removes whatever a
 * PREVIOUS generation for this same project wrote that the new generation no longer
 * includes ("Replace generated files safely" — the sprint's own requirement). New/
 * changed files are written FIRST and stale files deleted AFTER, so a failure partway
 * through this function never leaves the workspace with fewer files than it had before
 * the call — "keep previous project intact" on failure is satisfied by ordering, not by
 * a transaction this WebContainer API doesn't offer.
 */
export async function writeGeneratedProjectToWebContainer(project: GeneratedProject): Promise<void> {
  await webcontainer;

  const absolutePaths = project.files.map((file) => `${WORK_DIR}/${file.path}`);

  for (const file of project.files) {
    await workbenchStore.createFile(`${WORK_DIR}/${file.path}`, file.content);
  }

  const previousPaths = getStoredFilePaths(project.projectId);
  const staleFiles = previousPaths.filter((path) => !absolutePaths.includes(path));

  for (const stalePath of staleFiles) {
    try {
      await workbenchStore.deleteFile(stalePath);
    } catch (error) {
      // Best-effort cleanup — a stale file that fails to delete is a leftover, not a broken generation.
      console.error('[CodeGeneration] Failed to remove stale generated file:', stalePath, error);
    }
  }

  setStoredFilePaths(project.projectId, absolutePaths);
}

/**
 * Sprint 43B.1 — reads a file DIRECTLY from the live WebContainer filesystem, deliberately
 * bypassing `workbenchStore`'s in-memory `files` mirror (`FilesStore.getFile()`). That mirror
 * is updated by `FilesStore.createFile()` only after its own `webcontainer.fs.writeFile()`
 * await resolves, but it's also written to independently by the chat-streaming action-runner
 * path (`ActionRunner`/`onActionClose` in useMessageParser.ts) for the SAME files this
 * generation already wrote once during streaming. If that original, still-in-flight write
 * settles AFTER `writeGeneratedProjectToWebContainer`'s own (repaired) write for the same
 * path, the in-memory mirror silently reflects whichever one finished last — indistinguishable
 * from the repaired version by just reading `workbenchStore` again. Reading the actual
 * WebContainer disk is the only way to know what a real `npm run dev`/build will actually see.
 * Returns `null` if the file doesn't exist rather than throwing — a missing file is a
 * different, already-handled failure mode (see requiredFiles.ts).
 */
export async function readGeneratedFileFromWebContainer(relativePath: string): Promise<string | null> {
  const wc = await webcontainer;

  try {
    return await wc.fs.readFile(relativePath, 'utf-8');
  } catch {
    return null;
  }
}

export type InstallAndStartResult = { ok: true } | { ok: false; error: string };

/**
 * Runs `npm install` (awaited — a failure here is reported and stops the pipeline) then
 * starts `npm run dev` (deliberately NOT awaited — a dev server runs indefinitely).
 * Once the dev server opens a port, `app/lib/stores/previews.ts`'s existing
 * `server-ready`/`port` WebContainer event listeners populate `workbenchStore.previews`
 * automatically — nothing here needs to know the port number or preview URL itself.
 */
export async function installAndStartDevServer(onOutput?: (chunk: string) => void): Promise<InstallAndStartResult> {
  const wc = await webcontainer;

  let installOutput = '';
  const installProcess = await wc.spawn('npm', ['install']);

  installProcess.output
    .pipeTo(
      new WritableStream({
        write(chunk) {
          installOutput += chunk;
          onOutput?.(chunk);
        },
      }),
    )
    .catch(() => undefined);

  const installExitCode = await installProcess.exit;

  if (installExitCode !== 0) {
    return {
      ok: false,
      error: `npm install failed (exit code ${installExitCode}).\n${installOutput.slice(-2000)}`,
    };
  }

  const devProcess = await wc.spawn('npm', ['run', 'dev']);

  devProcess.output
    .pipeTo(
      new WritableStream({
        write(chunk) {
          onOutput?.(chunk);
        },
      }),
    )
    .catch(() => undefined);

  return { ok: true };
}

/**
 * Sprint 44 — a bounded-timeout `npm install`, used only by the workspace resume
 * orchestrator (app/lib/quick-build/workspaceResumeOrchestrator.ts). Deliberately a
 * SEPARATE function from `installAndStartDevServer` above rather than adding a timeout
 * parameter there: that function is already relied on by the verified initial-generation
 * path (repairEngine.ts's runBuildRepairLoop, via errorCollector.ts's runBuildValidation)
 * and Sprint 44 must not risk changing its behavior. `installProcess.exit` alone can hang
 * forever if the spawned process never actually exits (confirmed live in the Sprint 44
 * audit — the previous resume attempt hung for 5+ minutes with zero output, most likely
 * because a concurrent, un-awaited legacy file-restore was still writing into the same
 * WebContainer while this awaited `npm install`) — `Promise.race` against a timer, with an
 * explicit `kill()` on timeout, is the only way to guarantee this can't happen again.
 *
 * Sprint 44.1 — `--no-audit --no-fund` (with `CI=true`) trims the two post-resolution
 * registry round-trips (`npm audit`, the funding lookup) that add network work without
 * affecting the installed dependency tree at all. The real resume install-hang was the
 * DUPLICATE installer racing this one (fixed in useChatHistory.ts — the replayed restore
 * artifact used to spawn its own `npx update-browserslist-db@latest && npm install`); these
 * flags are conservative hardening for the surviving single install, not the root-cause fix,
 * and deliberately do NOT disable lifecycle scripts. `installAndStartDevServer` (the verified
 * initial-generation path) is intentionally left on plain `npm install`.
 */
export async function installDependenciesWithTimeout(
  timeoutMs: number,
  onOutput?: (chunk: string) => void,
): Promise<InstallAndStartResult> {
  const wc = await webcontainer;

  let installOutput = '';
  const installProcess = await wc.spawn('npm', ['install', '--no-audit', '--no-fund'], {
    env: { CI: 'true' },
  });

  installProcess.output
    .pipeTo(
      new WritableStream({
        write(chunk) {
          installOutput += chunk;
          onOutput?.(chunk);
        },
      }),
    )
    .catch(() => undefined);

  let timedOut = false;
  const timeoutMarker = -1;

  const exitCode = await Promise.race([
    installProcess.exit,
    new Promise<number>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve(timeoutMarker);
      }, timeoutMs);
    }),
  ]);

  if (timedOut) {
    installProcess.kill();
    return {
      ok: false,
      error: `npm install did not finish within ${Math.round(timeoutMs / 1000)}s and was terminated.\n${installOutput.slice(-2000)}`,
    };
  }

  if (exitCode !== 0) {
    return { ok: false, error: `npm install failed (exit code ${exitCode}).\n${installOutput.slice(-2000)}` };
  }

  return { ok: true };
}

/**
 * Sprint 44 — spawns `npm run dev` on its own, deliberately NOT awaited (same reasoning as
 * `installAndStartDevServer`'s own dev-server spawn — it runs indefinitely). Paired with
 * `installDependenciesWithTimeout` above for the resume orchestrator, which needs the
 * install and dev-server-start as two separately-timed-out steps rather than one combined
 * call.
 */
export async function startDevServerOnly(onOutput?: (chunk: string) => void): Promise<void> {
  const wc = await webcontainer;
  const devProcess = await wc.spawn('npm', ['run', 'dev']);

  devProcess.output
    .pipeTo(
      new WritableStream({
        write(chunk) {
          onOutput?.(chunk);
        },
      }),
    )
    .catch(() => undefined);
}

/**
 * Sprint 44 — the REAL "is the dev server actually serving" signal: `workbenchStore.previews`
 * is populated exclusively by the WebContainer's own `server-ready`/`port` events (see
 * app/lib/stores/previews.ts) — never inferred from a fixed delay. Resolves as soon as any
 * preview reports `ready: true` (if one is already ready — e.g. a fast boot — this resolves
 * immediately without waiting for a new event), or fails clearly once `timeoutMs` elapses
 * with no ready preview, rather than hanging forever if the dev server never binds a port.
 */
export async function waitForDevServerReady(
  timeoutMs: number,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const alreadyReady = workbenchStore.previews.get().find((preview) => preview.ready);

  if (alreadyReady) {
    return { ok: true, url: alreadyReady.baseUrl };
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: { ok: true; url: string } | { ok: false; error: string }) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = workbenchStore.previews.listen((previews) => {
      const ready = previews.find((preview) => preview.ready);

      if (ready) {
        finish({ ok: true, url: ready.baseUrl });
      }
    });

    const timer = setTimeout(() => {
      finish({ ok: false, error: `Dev server did not report ready within ${Math.round(timeoutMs / 1000)}s.` });
    }, timeoutMs);
  });
}

/**
 * Sprint 44 — bounded wait for the WebContainer singleton (app/lib/webcontainer/index.ts) to
 * finish booting, rather than an unbounded `await webcontainer`. The singleton promise itself
 * never rejects on a normal boot, so without a timeout here a genuinely stuck boot (e.g. the
 * iframe/sandbox failing to initialize) would hang the resume orchestrator indefinitely with
 * no failure state — exactly the class of bug this sprint exists to close.
 */
export async function waitForWebContainerReady(timeoutMs: number) {
  return Promise.race([
    webcontainer,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`WebContainer did not become ready within ${Math.round(timeoutMs / 1000)}s.`)),
        timeoutMs,
      );
    }),
  ]);
}
