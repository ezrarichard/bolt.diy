// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';

const {
  generateDatabaseSchemaMock,
  validateDatabaseSchemaMock,
  provisionDatabaseMock,
  retryProvisionDatabaseMock,
  verifyDatabaseConnectionMock,
  connectSupabaseProjectMock,
  disconnectSupabaseProjectMock,
  connectSupabaseProvisioningSessionMock,
  sessionConnectedState,
} = vi.hoisted(() => ({
  generateDatabaseSchemaMock: vi.fn(),
  validateDatabaseSchemaMock: vi.fn(),
  provisionDatabaseMock: vi.fn(),
  retryProvisionDatabaseMock: vi.fn(),
  verifyDatabaseConnectionMock: vi.fn(),
  connectSupabaseProjectMock: vi.fn(),
  disconnectSupabaseProjectMock: vi.fn(),
  connectSupabaseProvisioningSessionMock: vi.fn(),
  sessionConnectedState: { current: false },
}));

vi.mock('~/lib/database-activation/databaseActivationService', () => ({
  generateDatabaseSchema: generateDatabaseSchemaMock,
  validateDatabaseSchema: validateDatabaseSchemaMock,
  provisionDatabase: provisionDatabaseMock,
  retryProvisionDatabase: retryProvisionDatabaseMock,
  verifyDatabaseConnection: verifyDatabaseConnectionMock,
  connectSupabaseProject: connectSupabaseProjectMock,
  disconnectSupabaseProject: disconnectSupabaseProjectMock,
}));

vi.mock('~/lib/database-activation/provisioning/supabaseSessionCredentials', () => ({
  connectSupabaseProvisioningSession: connectSupabaseProvisioningSessionMock,

  /*
   * Not a real nanostore atom — `useStore` is mocked below to read `sessionConnectedState.current`
   * directly, so this only needs to be a stable object identity for the mocked `useStore` to accept.
   */
  isSupabaseProvisioningConnected: {},
}));

vi.mock('@nanostores/react', () => ({
  useStore: () => sessionConnectedState.current,
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

describe('DatabaseActivationCard — Sprint 75/76', () => {
  beforeEach(() => {
    generateDatabaseSchemaMock.mockReset();
    validateDatabaseSchemaMock.mockReset();
    provisionDatabaseMock.mockReset();
    retryProvisionDatabaseMock.mockReset();
    verifyDatabaseConnectionMock.mockReset();
    connectSupabaseProjectMock.mockReset();
    disconnectSupabaseProjectMock.mockReset();
    connectSupabaseProvisioningSessionMock.mockReset();
    sessionConnectedState.current = false;

    /*
     * Mirrors the real supabaseSessionCredentials module's behavior: connecting flips the
     * reactive "is a session connected" flag `useStore` reads (mocked above).
     */
    connectSupabaseProvisioningSessionMock.mockImplementation(() => {
      sessionConnectedState.current = true;
    });
    vi.unstubAllGlobals();
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

  it('shows the schema version once a schema with a version has been generated', () => {
    render(
      <DatabaseActivationCard
        project={makeProject({
          databaseActivation: {
            schema: {
              generatedAt: '2026-07-25T00:00:00.000Z',
              tableCount: 2,
              schemaSql: 'x',
              migrationSql: 'y',
              schemaVersion: 3,
            },
          },
        })}
      />,
    );

    expect(screen.getByText('(v3)')).toBeTruthy();
  });

  it('shows a Retry button only when provisioning has failed', () => {
    const { rerender } = render(
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
    expect(screen.queryByText('Retry')).toBeNull();

    rerender(
      <DatabaseActivationCard
        project={makeProject({
          databaseActivation: {
            schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
            validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },
            provisioning: { provider: 'mock', status: 'failed', startedAt: '2026-07-25T00:00:00.000Z' },
          },
        })}
      />,
    );
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('clicking Retry calls retryProvisionDatabase with the project', async () => {
    retryProvisionDatabaseMock.mockResolvedValue({ ok: true, message: 'retried' });

    const project = makeProject({
      databaseActivation: {
        schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
        validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },
        provisioning: { provider: 'mock', status: 'failed', startedAt: '2026-07-25T00:00:00.000Z' },
      },
    });
    render(<DatabaseActivationCard project={project} />);

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => expect(retryProvisionDatabaseMock).toHaveBeenCalledWith(project));
  });

  it('shows the Verify button as "Refresh" once a connection has already been checked', () => {
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

    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.queryByText('Verify Connection')).toBeNull();
  });

  describe('Supabase provider selection and connect flow (Sprint 76)', () => {
    it('defaults to the "mock" provider and hides the connect UI', () => {
      render(<DatabaseActivationCard project={makeProject()} />);

      expect((screen.getByRole('combobox', { name: 'Provider' }) as unknown as HTMLSelectElement).value).toBe('mock');
      expect(screen.queryByPlaceholderText('Supabase Management personal access token')).toBeNull();
    });

    it('selecting "supabase" reveals the token input when no project is connected yet', () => {
      render(<DatabaseActivationCard project={makeProject()} />);

      fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), { target: { value: 'supabase' } });

      expect(screen.getByPlaceholderText('Supabase Management personal access token')).toBeTruthy();
    });

    it('fetching projects stores the token in the session-scoped holder, never in component/project state', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ stats: { projects: [{ id: 'proj-abc', name: 'My Project' }] } }),
        }),
      );

      render(<DatabaseActivationCard project={makeProject()} />);
      fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), { target: { value: 'supabase' } });
      fireEvent.change(screen.getByPlaceholderText('Supabase Management personal access token'), {
        target: { value: 'fixture-pat' },
      });
      fireEvent.click(screen.getByText('Fetch my projects'));

      await waitFor(() => expect(connectSupabaseProvisioningSessionMock).toHaveBeenCalledWith('fixture-pat'));
      expect(await screen.findByText('My Project (proj-abc)')).toBeTruthy();
    });

    it('selecting a fetched project and clicking "Use this project" calls connectSupabaseProject with only the public project id', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ stats: { projects: [{ id: 'proj-abc', name: 'My Project' }] } }),
        }),
      );
      connectSupabaseProjectMock.mockReturnValue({ ok: true, message: 'connected' });
      sessionConnectedState.current = true;

      const project = makeProject();
      render(<DatabaseActivationCard project={project} />);
      fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), { target: { value: 'supabase' } });
      fireEvent.change(screen.getByPlaceholderText('Supabase Management personal access token'), {
        target: { value: 'fixture-pat' },
      });
      fireEvent.click(screen.getByText('Fetch my projects'));
      await screen.findByText('My Project (proj-abc)');

      fireEvent.change(screen.getByRole('combobox', { name: 'Select Supabase project' }), {
        target: { value: 'proj-abc' },
      });
      fireEvent.click(screen.getByText('Use this project'));

      /*
       * Sprint 89 — name/region are non-secret, carried over from the already-fetched project list
       * so the Deployment domain can persist them; the Management PAT itself is still never passed.
       */
      expect(connectSupabaseProjectMock).toHaveBeenCalledWith(project, 'proj-abc', {
        projectName: 'My Project',
        region: undefined,
      });
    });

    it('shows the connected project id and a Disconnect button once connectionConfig is set', () => {
      render(
        <DatabaseActivationCard
          project={makeProject({
            databaseActivation: {
              connectionConfig: {
                provider: 'supabase',
                projectId: 'proj-abc',
                connectedAt: '2026-07-25T00:00:00.000Z',
              },
            },
          })}
        />,
      );

      fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), { target: { value: 'supabase' } });

      expect(screen.getByText('proj-abc')).toBeTruthy();
      expect(screen.getByText('Disconnect')).toBeTruthy();
    });

    it('clicking Disconnect calls disconnectSupabaseProject with the project', () => {
      disconnectSupabaseProjectMock.mockReturnValue({ ok: true, message: 'disconnected' });

      const project = makeProject({
        databaseActivation: {
          connectionConfig: { provider: 'supabase', projectId: 'proj-abc', connectedAt: '2026-07-25T00:00:00.000Z' },
        },
      });
      render(<DatabaseActivationCard project={project} />);
      fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), { target: { value: 'supabase' } });

      fireEvent.click(screen.getByText('Disconnect'));

      expect(disconnectSupabaseProjectMock).toHaveBeenCalledWith(project);
    });

    it('disables Provision for the "supabase" provider until a project is connected, even if validation passed', () => {
      render(
        <DatabaseActivationCard
          project={makeProject({
            databaseActivation: {
              schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
              validation: {
                validatedAt: '2026-07-25T00:00:00.000Z',
                report: { passed: true, errors: [], warnings: [] },
              },
            },
          })}
        />,
      );

      fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), { target: { value: 'supabase' } });

      expect((screen.getByText('Provision (supabase)') as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
