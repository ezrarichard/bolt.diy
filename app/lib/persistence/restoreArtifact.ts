import type { Snapshot } from './types';

/**
 * Workspace Resume Lifecycle — Sprint 44.1.
 *
 * Builds the `<boltArtifact>` embedded in the synthetic "restored from snapshot" assistant
 * message (see useChatHistory.ts). Pulled out of that effect into a pure, directly-testable
 * function for the same reason authoritativeRestoreSource.ts was: the decision it encodes is
 * exactly what caused the resume install-hang.
 *
 * When `resumeOwnsWorkspace` is true (a quick_build project whose BuildersDB snapshot the
 * workspace-resume orchestrator is about to restore itself), this returns an EMPTY string —
 * no file actions and, critically, no command actions. The message parser replays whatever
 * `<boltAction>`s this artifact contains on load (useMessageParser.ts); the command actions
 * produced by createCommandActionsString run `npx update-browserslist-db@latest && npm install`
 * + `npm run dev`, which — left intact during a resume — is a SECOND installer and dev server
 * racing the orchestrator's own inside one WebContainer (the real resume install-hang, not
 * npm/network). Every other case returns the full artifact so the legacy replay path restores
 * files and starts the dev server exactly as before.
 */
export function buildRestoreArtifact(
  resumeOwnsWorkspace: boolean,
  snapshotFiles: Snapshot['files'] | undefined,
  commandActionsString: string,
): string {
  if (resumeOwnsWorkspace) {
    return '';
  }

  const fileActions = Object.entries(snapshotFiles || {})
    .map(([key, value]) => {
      if (value?.type === 'file') {
        return `
                      <boltAction type="file" filePath="${key}">
${value.content}
                      </boltAction>
                      `;
      }

      return ``;
    })
    .join('\n');

  return `<boltArtifact id="restored-project-setup" title="Restored Project & Setup" type="bundled">
                  ${fileActions}
                  ${commandActionsString}
                  </boltArtifact>`;
}
