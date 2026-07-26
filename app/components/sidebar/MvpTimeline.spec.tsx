// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ProductEvolutionMvpEntry } from '~/lib/projects/productEvolutionView';
import { MvpTimeline } from './MvpTimeline';

function makeEntry(overrides: Partial<ProductEvolutionMvpEntry> = {}): ProductEvolutionMvpEntry {
  return {
    kind: 'committed',
    sequence: 1,
    code: 'MVP-001',
    theme: 'Core booking flow',
    status: 'released',
    isLive: true,
    isActive: true,
    ...overrides,
  };
}

describe('MvpTimeline', () => {
  it('renders every entry as a real button, not a clickable div', () => {
    render(<MvpTimeline entries={[makeEntry()]} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: /MVP1/ }).tagName).toBe('BUTTON');
  });

  it('marks the selected entry with aria-current', () => {
    const entries = [
      makeEntry({ sequence: 1 }),
      makeEntry({ sequence: 2, code: 'MVP-002', isLive: false, isActive: false, status: 'planned' }),
    ];

    render(<MvpTimeline entries={entries} selectedSequence={2} onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0].getAttribute('aria-current')).toBeNull();
    expect(buttons[1].getAttribute('aria-current')).toBe('true');
  });

  it('calls onSelect with the entry sequence when clicked', () => {
    const onSelect = vi.fn();
    const entries = [makeEntry({ sequence: 1 }), makeEntry({ sequence: 2, code: 'MVP-002' })];

    render(<MvpTimeline entries={entries} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /MVP-002/ }));

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('renders a skeleton-only future entry distinctly, labeled "Future"', () => {
    const entries = [
      makeEntry({ kind: 'skeleton', sequence: 2, code: 'MVP-002', status: undefined, isLive: false, isActive: false }),
    ];

    render(<MvpTimeline entries={entries} onSelect={vi.fn()} />);

    expect(screen.getByText('Future')).toBeTruthy();
  });

  it('never shows status by color alone — every entry has a visible text label alongside its badge', () => {
    render(<MvpTimeline entries={[makeEntry()]} onSelect={vi.fn()} />);

    expect(screen.getByText('Live · Released')).toBeTruthy();
  });

  it('renders nothing for an empty timeline', () => {
    const { container } = render(<MvpTimeline entries={[]} onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
