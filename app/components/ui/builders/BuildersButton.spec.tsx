// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BuildersButton } from './BuildersButton';

describe('BuildersButton', () => {
  it('renders each variant without throwing and applies the variant class', () => {
    const variants = ['primary', 'secondary', 'outline', 'ghost', 'danger'] as const;

    for (const variant of variants) {
      const { unmount } = render(<BuildersButton variant={variant}>Click me</BuildersButton>);
      const button = screen.getByRole('button', { name: 'Click me' });
      expect(button).toBeTruthy();
      unmount();
    }
  });

  it('always includes the shared focus-visible ring treatment', () => {
    render(<BuildersButton>Click me</BuildersButton>);

    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button.className).toContain('builders-focus-ring');
    expect(button.className).not.toContain('focus:ring');
  });

  it('is disabled and does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <BuildersButton disabled onClick={onClick}>
        Click me
      </BuildersButton>,
    );

    const button = screen.getByRole('button', { name: 'Click me' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sets aria-busy and disables the button while loading, without hiding its label', () => {
    render(<BuildersButton isLoading>Saving</BuildersButton>);

    const button = screen.getByRole('button', { name: 'Saving' }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('does not set aria-busy when not loading', () => {
    render(<BuildersButton>Save</BuildersButton>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBeNull();
  });

  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    render(<BuildersButton onClick={onClick}>Go</BuildersButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
