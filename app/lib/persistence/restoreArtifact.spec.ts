import { describe, expect, it } from 'vitest';
import type { Snapshot } from './types';
import { buildRestoreArtifact } from './restoreArtifact';

const FILES: Snapshot['files'] = {
  '/home/project/package.json': { type: 'file', content: '{"scripts":{"dev":"vite"}}', isBinary: false },
  '/home/project/src/App.tsx': { type: 'file', content: 'export default () => null;', isBinary: false },
  '/home/project/src': { type: 'folder' },
};

// Mirrors createCommandActionsString()'s output for a Node project — the exact string that hangs a resume.
const COMMAND_ACTIONS =
  '\n<boltAction type="shell">export CI=true && npx update-browserslist-db@latest && npm install --yes --no-audit --no-fund --silent</boltAction>\n<boltAction type="start">npm run dev</boltAction>\n';

describe('buildRestoreArtifact', () => {
  it('returns an empty string when the resume orchestrator owns the workspace', () => {
    const artifact = buildRestoreArtifact(true, FILES, COMMAND_ACTIONS);
    expect(artifact).toBe('');
  });

  it('emits no executable actions at all when resume owns the workspace (no competing install/dev-server)', () => {
    const artifact = buildRestoreArtifact(true, FILES, COMMAND_ACTIONS);

    expect(artifact).not.toContain('boltAction');
    expect(artifact).not.toContain('npm install');
    expect(artifact).not.toContain('update-browserslist-db');
    expect(artifact).not.toContain('npm run dev');
  });

  it('emits the full artifact (file + command actions) for the legacy replay path', () => {
    const artifact = buildRestoreArtifact(false, FILES, COMMAND_ACTIONS);

    expect(artifact).toContain('<boltArtifact');
    expect(artifact).toContain('<boltAction type="file" filePath="/home/project/package.json">');
    expect(artifact).toContain('<boltAction type="file" filePath="/home/project/src/App.tsx">');

    // Folder entries are not written as file actions.
    expect(artifact).not.toContain('filePath="/home/project/src"');

    // Command actions are preserved for the legacy path.
    expect(artifact).toContain('npm install');
    expect(artifact).toContain('npm run dev');
  });

  it('handles an undefined/empty snapshot without throwing', () => {
    expect(buildRestoreArtifact(false, undefined, '')).toContain('<boltArtifact');
    expect(buildRestoreArtifact(true, undefined, '')).toBe('');
  });
});
