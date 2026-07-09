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
