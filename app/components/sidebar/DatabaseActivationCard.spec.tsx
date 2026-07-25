// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';

const { generateDatabaseSchemaMock, validateDatabaseSchemaMock, provisionDatabaseMock, verifyDatabaseConnectionMock } =
  vi.hoisted(() => ({
    generateDatabaseSchemaMock: vi.fn(),
    validateDatabaseSchemaMock: vi.fn(),
    provisionDatabaseMock: vi.fn(),
    verifyDatabaseConnectionMock: vi.fn(),
  }));

vi.mock('~/lib/database-activation/databaseActivationService', () => ({
  generateDatabaseSchema: generateDatabaseSchemaMock,
  validateDatabaseSchema: validateDatabaseSchemaMock,
  provisionDatabase: provisionDatabaseMock,
  verifyDatabaseConnection: verifyDatabaseConnectionMock,
}));

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { DatabaseActivationCard } = await import('./DatabaseActivationCard');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    ...overrides,
  } as Project;
}

describe('DatabaseActivationCard — Sprint 75', () => {
  beforeEach(() => {
    generateDatabaseSchemaMock.mockReset();
    validateDatabaseSchemaMock.mockReset();
    provisionDatabaseMock.mockReset();
    verifyDatabaseConnectionMock.mockReset();
  });

  it('renders "Not started" statuses and only enables Generate Schema when nothing has run yet', () => {
    render(<DatabaseActivationCard project={makeProject()} />);

    expect(screen.getAllByText('Not started').length).toBe(2);
    expect(screen.getByText('Not generated')).toBeTruthy();

    expect((screen.getByText('Generate Schema') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText('Validate') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Provision (mock)') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Verify Connection') as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Validate once a schema has been generated', () => {
    render(
      <DatabaseActivationCard
        project={makeProject({
          databaseActivation: {
            schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 3, schemaSql: 'x', migrationSql: 'y' },
          },
        })}
      />,
    );

    expect(screen.getByText('3 table(s) generated')).toBeTruthy();
    expect((screen.getByText('Validate') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText('Provision (mock)') as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Provision only after validation passed', () => {
    render(
      <DatabaseActivationCard
        project={makeProject({
          databaseActivation: {
            schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 2, schemaSql: 'x', migrationSql: 'y' },
            validation: {
              validatedAt: '2026-07-25T00:00:00.000Z',
              report: { passed: true, errors: [], warnings: [] },
            },
          },
        })}
      />,
    );

    expect(screen.getByText('Passed')).toBeTruthy();
    expect((screen.getByText('Provision (mock)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps Provision disabled when validation failed', () => {
    render(
      <DatabaseActivationCard
        project={makeProject({
          databaseActivation: {
            schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 2, schemaSql: 'x', migrationSql: 'y' },
            validation: {
              validatedAt: '2026-07-25T00:00:00.000Z',
              report: {
                passed: false,
                errors: [{ code: 'missing-primary-key', message: 'no pk' }],
                warnings: [],
              },
            },
          },
        })}
      />,
    );

    expect(screen.getByText('Failed (1)')).toBeTruthy();
    expect((screen.getByText('Provision (mock)') as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Verify Connection only once provisioning succeeded', () => {
    render(
      <DatabaseActivationCard
        project={makeProject({
          databaseActivation: {
            schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
            validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },
            provisioning: { provider: 'mock', status: 'succeeded', startedAt: '2026-07-25T00:00:00.000Z' },
          },
        })}
      />,
    );

    expect(screen.getByText('Provisioned')).toBeTruthy();
    expect((screen.getByText('Verify Connection') as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking Generate Schema calls generateDatabaseSchema with the project', async () => {
    generateDatabaseSchemaMock.mockReturnValue({ ok: true, message: 'Schema generated for 1 table(s).' });

    const project = makeProject();
    render(<DatabaseActivationCard project={project} />);

    fireEvent.click(screen.getByText('Generate Schema'));

    await waitFor(() => expect(generateDatabaseSchemaMock).toHaveBeenCalledWith(project));
  });

  it('shows "Connected" as the overall status once the connection is verified', () => {
    render(
      <DatabaseActivationCard
        project={makeProject({
          databaseActivation: {
            schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
            validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },
            provisioning: { provider: 'mock', status: 'succeeded', startedAt: '2026-07-25T00:00:00.000Z' },
            connection: { verified: true, verifiedAt: '2026-07-25T00:00:00.000Z', message: 'ok' },
          },
        })}
      />,
    );

    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('renders safely for a project with no database activation data at all', () => {
    expect(() => render(<DatabaseActivationCard project={makeProject()} />)).not.toThrow();
  });
});
