import { workbenchStore } from '~/lib/stores/workbench';
import type { InstallAndStartResult } from '~/lib/code-generation/webcontainerWriter';
import type { BuildErrorInfo } from './codeReviewTypes';

/**
 * Error Collector — Sprint 39 (Build Validator role).
 *
 * Turns raw WebContainer output into a structured `BuildErrorInfo` instead of a screenshot
 * or a raw log dump, per the sprint's "use real error text/logs whenever possible"
 * requirement. Two sources, both observed from the SAME `installAndStartDevServer` call
 * (webcontainerWriter.ts) — never a second `npm run dev` spawn of our own, which would
 * start a duplicate dev server:
 *
 *  - `npm install` failing outright (`installAndStartDevServer`'s own `{ ok: false, error }`
 *    already carries the exit code + log tail).
 *  - A short bounded window right after `npm run dev` starts, since Vite's own compile
 *    errors (e.g. "Failed to resolve import", this sprint's motivating example) don't exit
 *    the process — they show up in the dev server's stdout (passed through the same
 *    `onOutput` callback `installAndStartDevServer` already accepts) and/or as an uncaught
 *    exception the WebContainer forwards from the preview iframe
 *    (`workbenchStore.actionAlert`, wired up in app/lib/webcontainer/index.ts). Waiting for
 *    a full, stable page load and watching the console indefinitely is Sprint 40's job
 *    ("capture Vite overlay errors directly", "capture browser console errors from the
 *    preview iframe") — this is deliberately just the practical minimum: watch for a known
 *    fatal-error signature or an immediate preview alert for a few seconds, then treat
 *    silence as success.
 */

const DEV_SERVER_OBSERVATION_WINDOW_MS = 4000;
const DEV_SERVER_POLL_INTERVAL_MS = 250;

const FATAL_DEV_SERVER_PATTERNS = [
  /Failed to resolve import/i,
  /does not provide an export named/i,
  /Cannot find module/i,
  /\[vite\]\s*Internal server error/i,
  /SyntaxError/i,
  /error during build/i,
];

export function buildInstallErrorInfo(error: string): BuildErrorInfo {
  return { message: error, source: 'installing', rawLog: error };
}

function findFatalPattern(output: string): string | undefined {
  for (const pattern of FATAL_DEV_SERVER_PATTERNS) {
    const match = output.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return undefined;
}

/**
 * Runs `installAndStartDevServer` (the exact function useCodeGeneration.ts already calls),
 * then watches its combined install+dev-server output plus `workbenchStore.actionAlert` for
 * `DEV_SERVER_OBSERVATION_WINDOW_MS`. Resolves `null` (no error observed) once that window
 * elapses without a fatal signature — the caller then proceeds to show the preview.
 */
export async function runBuildValidation(
  installAndStartDevServer: (onOutput?: (chunk: string) => void) => Promise<InstallAndStartResult>,
): Promise<BuildErrorInfo | null> {
  let output = '';

  const installResult = await installAndStartDevServer((chunk) => {
    output += chunk;
  });

  if (!installResult.ok) {
    return buildInstallErrorInfo(installResult.error);
  }

  return new Promise<BuildErrorInfo | null>((resolve) => {
    let resolved = false;

    const finish = (result: BuildErrorInfo | null) => {
      if (resolved) {
        return;
      }

      resolved = true;
      clearInterval(pollId);
      clearTimeout(timeoutId);
      unsubscribeAlert();
      resolve(result);
    };

    const pollId = setInterval(() => {
      const pattern = findFatalPattern(output);

      if (pattern) {
        finish({ message: `Dev server reported: ${pattern}`, source: 'dev-server', rawLog: output.slice(-2000) });
      }
    }, DEV_SERVER_POLL_INTERVAL_MS);

    const unsubscribeAlert = workbenchStore.actionAlert.listen((alert) => {
      if (alert?.source === 'preview') {
        finish({
          message: alert.description || alert.title,
          stack: alert.content,
          source: 'runtime',
          rawLog: alert.content,
        });
      }
    });

    const timeoutId = setTimeout(() => finish(null), DEV_SERVER_OBSERVATION_WINDOW_MS);
  });
}
