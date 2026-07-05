import { describe, expect, it } from 'vitest';
import { parseGeneratedFiles } from './generationRunner';

const VALID_FILE = {
  path: 'README.md',
  purpose: 'Explains the project.',
  language: 'markdown',
  content: '# Hello',
};

describe('parseGeneratedFiles', () => {
  it('parses a raw JSON object with no fences', () => {
    const result = parseGeneratedFiles(JSON.stringify({ files: [VALID_FILE] }));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('README.md');
    }
  });

  it('parses JSON inside ```json fences', () => {
    const raw = '```json\n' + JSON.stringify({ files: [VALID_FILE] }) + '\n```';
    const result = parseGeneratedFiles(raw);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files).toHaveLength(1);
    }
  });

  it('parses JSON inside plain ``` fences', () => {
    const raw = '```\n' + JSON.stringify({ files: [VALID_FILE] }) + '\n```';
    const result = parseGeneratedFiles(raw);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files).toHaveLength(1);
    }
  });

  it('ignores explanation text before and after a fenced JSON object', () => {
    const raw =
      'Sure, here are the foundation files:\n\n```json\n' +
      JSON.stringify({ files: [VALID_FILE] }) +
      '\n```\n\nLet me know if you need anything else!';
    const result = parseGeneratedFiles(raw);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files).toHaveLength(1);
    }
  });

  it('parses a file whose own content contains a nested code fence without truncating the JSON', () => {
    const fileWithFence = {
      path: 'README.md',
      purpose: 'Explains setup.',
      language: 'markdown',
      content: '# Setup\n\n```bash\nnpm install\n```\n\nDone.',
    };
    const raw = '```json\n' + JSON.stringify({ files: [fileWithFence] }) + '\n```';
    const result = parseGeneratedFiles(raw);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files).toHaveLength(1);
      expect(result.files[0].content).toContain('```bash');
    }
  });

  it('prefers the JSON object that contains a top-level "files" array over stray braces in surrounding prose', () => {
    const raw =
      'Note: the config { "not": "this one" } is unrelated.\n\n```json\n' +
      JSON.stringify({ files: [VALID_FILE] }) +
      '\n```';
    const result = parseGeneratedFiles(raw);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('README.md');
    }
  });

  it('returns invalid-response-shape for truly invalid JSON', () => {
    const result = parseGeneratedFiles('this is not json at all, no braces here');

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe('invalid-response-shape');
    }
  });

  it('returns truncated-response for a response cut off mid-generation', () => {
    const truncated = '```json\n' + JSON.stringify({ files: [VALID_FILE] }).slice(0, -10);
    const result = parseGeneratedFiles(truncated);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe('truncated-response');
      expect(result.error.message).toMatch(/incomplete/i);
    }
  });

  it('discards a file with missing content and keeps a warning, without failing the whole parse', () => {
    const missingContent = { path: 'a.md', purpose: 'x', language: 'markdown' };
    const result = parseGeneratedFiles(JSON.stringify({ files: [missingContent, VALID_FILE] }));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('README.md');
      expect(result.warnings.some((warning) => warning.includes('content'))).toBe(true);
    }
  });

  it('discards a file with a path traversal attempt and keeps a warning', () => {
    const dangerous = { ...VALID_FILE, path: '../../etc/passwd' };
    const result = parseGeneratedFiles(JSON.stringify({ files: [dangerous] }));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files).toHaveLength(0);
      expect(result.warnings.some((warning) => warning.includes('..'))).toBe(true);
    }
  });

  it('discards a file with an absolute path and keeps a warning', () => {
    const dangerous = { ...VALID_FILE, path: '/etc/passwd' };
    const result = parseGeneratedFiles(JSON.stringify({ files: [dangerous] }));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files).toHaveLength(0);
      expect(result.warnings.some((warning) => warning.includes('absolute'))).toBe(true);
    }
  });
});
