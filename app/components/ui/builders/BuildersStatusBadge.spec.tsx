// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuildersStatusBadge } from './BuildersStatusBadge';
import { BUILDERS_STATUS_META, type BuildersStatus } from './statusMeta';

const ALL_STATUSES = Object.keys(BUILDERS_STATUS_META) as BuildersStatus[];

describe('BuildersStatusBadge', () => {
  it('renders every status variant with its default label visible as text', () => {
    for (const status of ALL_STATUSES) {
      const { unmount } = render(<BuildersStatusBadge status={status} />);
      expect(screen.getByText(BUILDERS_STATUS_META[status].label)).toBeTruthy();
      unmount();
    }
  });

  it('never communicates status by color alone — every variant renders an icon alongside its label', () => {
    for (const status of ALL_STATUSES) {
      const { container, unmount } = render(<BuildersStatusBadge status={status} />);
      const icon = container.getElementsByClassName(BUILDERS_STATUS_META[status].icon)[0];
      expect(icon).toBeTruthy();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });

  it('accepts a custom label while keeping the status-derived icon and color', () => {
    render(<BuildersStatusBadge status="error" label="Changes Requested" />);
    expect(screen.getByText('Changes Requested')).toBeTruthy();
    expect(screen.queryByText('Error')).toBeNull();
  });

  it('in compact mode, keeps the label reachable by assistive tech via sr-only text', () => {
    render(<BuildersStatusBadge status="success" compact />);

    const label = screen.getByText('Success');
    expect(label.className).toContain('sr-only');
  });

  it('gives the "working" status an animated icon that respects prefers-reduced-motion', () => {
    const { container } = render(<BuildersStatusBadge status="working" />);
    const icon = container.getElementsByClassName(BUILDERS_STATUS_META.working.icon)[0];
    expect(icon?.className).toContain('animate-spin');
    expect(icon?.className).toContain('motion-reduce:animate-none');
  });
});
