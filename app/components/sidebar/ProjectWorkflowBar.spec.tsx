// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectWorkflowBar, type WorkflowStage } from './ProjectWorkflowBar';

function makeStages(): WorkflowStage[] {
  return [
    { id: 'business', label: 'Business', status: 'complete' },
    { id: 'blueprint', label: 'Blueprint', status: 'complete' },
    { id: 'plan', label: 'MVP', status: 'active' },
    { id: 'engineering', label: 'Engineering', status: 'pending' },
    { id: 'application', label: 'Application', status: 'pending' },
  ];
}

describe('ProjectWorkflowBar', () => {
  it('renders every stage as a real, labeled button', () => {
    render(<ProjectWorkflowBar stages={makeStages()} activeTab="plan" onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Business/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Application/ })).toBeTruthy();
  });

  it('calls onSelect with the stage id when a node is clicked', () => {
    const onSelect = vi.fn();
    render(<ProjectWorkflowBar stages={makeStages()} activeTab="plan" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /Application/ }));
    expect(onSelect).toHaveBeenCalledWith('application');
  });

  /**
   * Sprint 84C (Part 6) — Sprint 84A's Finding UI-11 confirmed live that this row clips at 375px
   * because every node has `shrink-0`. The fix wraps the row in an `overflow-x-auto` container so
   * it degrades to a scroll instead — this asserts that wrapper exists rather than re-asserting a
   * pixel-clipping bug that only reproduces in a real narrow viewport, not jsdom's unconstrained
   * layout.
   */
  it('wraps the stage row in a horizontally scrollable container rather than a container that can clip', () => {
    const { container } = render(<ProjectWorkflowBar stages={makeStages()} activeTab="plan" onSelect={vi.fn()} />);

    const scrollWrapper = container.querySelector('.overflow-x-auto');
    expect(scrollWrapper).toBeTruthy();
    expect(scrollWrapper?.textContent).toContain('Application');
  });
});
