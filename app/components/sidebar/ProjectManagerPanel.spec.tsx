// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';
import type { EngineeringStageStatus } from '~/lib/projects/projectManagerEngine';

function stage(id: EngineeringStageStatus['id'], status: EngineeringStageStatus['status']): EngineeringStageStatus {
  return { id, label: id, artifactType: id, status, detail: '' };
}

const { analyzeProjectMock } = vi.hoisted(() => ({ analyzeProjectMock: vi.fn() }));

vi.mock('~/lib/projects/projectManagerEngine', () => ({
  projectManagerEngine: { analyzeProject: analyzeProjectMock },
}));

vi.mock('~/lib/projects/autoEngineeringEngine', () => ({ AUTO_ENGINEERING_ESTIMATED_SECONDS: 30 }));

const { ProjectManagerPanel } = await import('./ProjectManagerPanel');

function makeProject(): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
  } as Project;
}

/** Requirements approved, nothing else generated yet — the exact state a fresh project is in right after Gate A's Product Owner draft is generated but not yet approved. */
function healthWithRequirementsApproved() {
  return {
    overallScore: 10,
    requirementsStatus: stage('requirements', 'approved'),
    architectureStatus: stage('architecture', 'not-generated'),
    databaseStatus: stage('database', 'not-generated'),
    uiuxStatus: stage('uiux', 'not-generated'),
    backendStatus: stage('backend', 'not-generated'),
    frontendStatus: stage('frontend', 'not-generated'),
    qaStatus: stage('qa', 'not-generated'),
    devopsStatus: stage('devops', 'not-generated'),
    missingArtifacts: [],
    missingApprovals: [],
    blockedTasks: [],
    warnings: [],
    recommendations: [],
    readyForGeneration: false,
    readinessBlockers: [],
    nextRecommendedAction: { message: 'Approve the MVP roadmap.' },
    roadmapStatus: { total: 0, completed: 0, percentComplete: 0 },
    taskStatus: { total: 0, completed: 0, percentComplete: 0 },
    reviewStatus: { pending: 0, approved: 0, rejected: 0 },
  };
}

describe('ProjectManagerPanel — Sprint 74 Product Readiness Audit fix', () => {
  it('shows "Engineering is in progress" when productOwnerApproved is not passed (unchanged prior behavior)', () => {
    analyzeProjectMock.mockReturnValue(healthWithRequirementsApproved());
    render(<ProjectManagerPanel project={makeProject()} />);

    expect(screen.getByText('Engineering is in progress')).toBeTruthy();
  });

  it('shows the MVP approval message instead of "Engineering is in progress" while Gate A is pending', () => {
    analyzeProjectMock.mockReturnValue(healthWithRequirementsApproved());
    render(<ProjectManagerPanel project={makeProject()} productOwnerApproved={false} />);

    expect(screen.getByText('Approve your MVP roadmap to begin engineering')).toBeTruthy();
    expect(screen.queryByText('Engineering is in progress')).toBeNull();
  });

  it('marks Approval Required as Yes while Gate A is pending', () => {
    analyzeProjectMock.mockReturnValue(healthWithRequirementsApproved());
    render(<ProjectManagerPanel project={makeProject()} productOwnerApproved={false} />);

    expect(screen.getByText('Yes')).toBeTruthy();
  });

  it('shows "Review MVP Roadmap" as the continue button label while Gate A is pending', () => {
    analyzeProjectMock.mockReturnValue(healthWithRequirementsApproved());
    render(<ProjectManagerPanel project={makeProject()} productOwnerApproved={false} onContinue={() => {}} />);

    expect(screen.getByText('Review MVP Roadmap')).toBeTruthy();
  });

  it('returns to normal Engineering-in-progress wording once Gate A is approved', () => {
    analyzeProjectMock.mockReturnValue(healthWithRequirementsApproved());
    render(<ProjectManagerPanel project={makeProject()} productOwnerApproved={true} />);

    expect(screen.getByText('Engineering is in progress')).toBeTruthy();
  });
});
