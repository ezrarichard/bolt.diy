import { describe, expect, it } from 'vitest';
import { databaseDesignerEngine } from './databaseDesignerEngine';
import { ARTIFACT_TYPES, type ProjectArtifact } from './artifacts';
import type { Project } from '~/lib/stores/projects';

/**
 * Sprint 75 — unit coverage for the Database Engineer's structured-schema extension: parseDraft
 * pulls `structuredSchema` out of the same JSON response as the narrative fields, and the two
 * artifact constructors (createDraftArtifact/createSchemaArtifact) split that single parsed draft
 * into the narrative-only DATABASE_DRAFT content and the schema-only DATABASE_SCHEMA content. See
 * useDraftPanel.spec.ts for the lockstep version-pairing behavior this feeds into.
 */

const VALID_RESPONSE = JSON.stringify({
  databaseOverview: 'A simple blog.',
  entities: ['Posts table'],
  structuredSchema: {
    tables: [
      {
        name: 'posts',
        columns: [{ name: 'id', type: 'uuid', nullable: false }],
        primaryKey: ['id'],
      },
    ],
  },
});

describe('databaseDesignerEngine.parseDraft — Sprint 75', () => {
  it('parses both the narrative fields and structuredSchema from one JSON response', () => {
    const result = databaseDesignerEngine.parseDraft(VALID_RESPONSE);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.draft.databaseOverview).toBe('A simple blog.');
    expect(result.draft.structuredSchema?.tables).toHaveLength(1);
    expect(result.draft.structuredSchema?.tables[0].name).toBe('posts');
  });

  it('degrades gracefully to an empty structured schema when structuredSchema is missing (legacy response shape)', () => {
    const legacyResponse = JSON.stringify({ databaseOverview: 'Legacy draft, no schema field.' });
    const result = databaseDesignerEngine.parseDraft(legacyResponse);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.draft.structuredSchema?.tables).toEqual([]);
  });

  it('degrades gracefully when structuredSchema is malformed rather than failing the whole draft', () => {
    const malformedResponse = JSON.stringify({
      databaseOverview: 'Draft with a broken schema block.',
      structuredSchema: { tables: 'not-an-array' },
    });
    const result = databaseDesignerEngine.parseDraft(malformedResponse);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.draft.structuredSchema?.tables).toEqual([]);
  });

  it('still fails when the narrative JSON itself is invalid, independent of structuredSchema', () => {
    const result = databaseDesignerEngine.parseDraft('not json at all');

    expect(result.ok).toBe(false);
  });
});

describe('databaseDesignerEngine.createDraftArtifact / createSchemaArtifact — Sprint 75', () => {
  it('createDraftArtifact strips structuredSchema out of the narrative artifact content', () => {
    const parsed = databaseDesignerEngine.parseDraft(VALID_RESPONSE);

    if (!parsed.ok) {
      throw new Error('expected parse to succeed');
    }

    const artifact = databaseDesignerEngine.createDraftArtifact(parsed.draft, 1);
    const content = JSON.parse(artifact.content);

    expect(content.databaseOverview).toBe('A simple blog.');
    expect(content.structuredSchema).toBeUndefined();
  });

  it('createSchemaArtifact persists only the structured schema, at the requested version', () => {
    const parsed = databaseDesignerEngine.parseDraft(VALID_RESPONSE);

    if (!parsed.ok) {
      throw new Error('expected parse to succeed');
    }

    const artifact = databaseDesignerEngine.createSchemaArtifact(parsed.draft, 3);
    const content = JSON.parse(artifact.content);

    expect(artifact.version).toBe(3);
    expect(content.tables).toHaveLength(1);
    expect(content.tables[0].name).toBe('posts');
  });

  it('createSchemaArtifact falls back to an empty schema when the draft has none', () => {
    const artifact = databaseDesignerEngine.createSchemaArtifact({ databaseOverview: 'x' }, 1);
    const content = JSON.parse(artifact.content);

    expect(content.tables).toEqual([]);
  });
});

describe('databaseDesignerEngine — Sprint 75 backward compatibility with pre-Sprint-75 projects', () => {
  function legacyDatabaseDraftArtifact(): ProjectArtifact {
    return {
      id: 'legacy-database-draft',
      taskId: 'requirements',
      title: 'Database Design Draft v1',
      type: ARTIFACT_TYPES.DATABASE_DRAFT,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'approved',

      // Real pre-Sprint-75 content — no `structuredSchema` field anywhere, and no sibling DATABASE_SCHEMA artifact.
      content: JSON.stringify({ databaseOverview: 'A legacy blog.', entities: ['Posts table'] }),
      generatedBy: 'AI Database Designer',
      version: 1,
    };
  }

  function legacyProject(): Project {
    return {
      id: 'legacy-proj-1',
      name: 'Legacy Project',
      icon: '🚀',
      color: 'purple',
      createdAt: '2026-01-01T00:00:00.000Z',
      projectType: 'guided_engineering',
      createdFrom: 'guided_engineering',
      artifacts: [legacyDatabaseDraftArtifact()],
    } as Project;
  }

  it('getApprovedStructuredSchema returns undefined (not a throw) for a project with only a legacy DATABASE_DRAFT', () => {
    const project = legacyProject();

    expect(() => databaseDesignerEngine.getApprovedStructuredSchema(project)).not.toThrow();
    expect(databaseDesignerEngine.getApprovedStructuredSchema(project)).toBeUndefined();
  });

  it('canGenerateDatabase and the approved DATABASE_DRAFT content itself are unaffected by the missing DATABASE_SCHEMA sibling', () => {
    const project = legacyProject();
    const draft = legacyDatabaseDraftArtifact();

    expect(JSON.parse(draft.content).databaseOverview).toBe('A legacy blog.');
    expect(project.artifacts?.some((a) => a.type === ARTIFACT_TYPES.DATABASE_SCHEMA)).toBe(false);
  });
});
