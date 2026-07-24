// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

/**
 * Sprint 70 — Legacy Dark-Theme Token Remediation. `Button`'s `default` variant previously
 * referenced the invalid `bg-bolt-elements-background` token (no matching CSS var existed),
 * silently exposing the browser's native button surface. These tests lock in the fix: a real
 * background class must be present, and existing public props/behavior are unchanged.
 */
describe('Button (remediated)', () => {
  it('the default variant resolves to a real, non-native background token', () => {
    render(<Button>Click me</Button>);

    const button = screen.getByRole('button', { name: 'Click me' });

    expect(button.className).toContain('bg-bolt-elements-background-depth-1');
    expect(button.className).not.toContain('bg-bolt-elements-background ');
    expect(button.className).not.toMatch(/bg-bolt-elements-background(?!-depth)/);
  });

  it('keeps a visible focus-visible ring', () => {
    render(<Button>Click me</Button>);

    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button.className).toContain('focus-visible:ring-bolt-elements-borderColor');
  });

  it('disabled state remains understandable (pointer-events and opacity both present)', () => {
    render(<Button disabled>Click me</Button>);

    const button = screen.getByRole('button', { name: 'Click me' }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.className).toContain('disabled:opacity-50');
    expect(button.className).toContain('disabled:pointer-events-none');
  });

  it('every variant renders without throwing and contains no invalid legacy token', () => {
    const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;

    for (const variant of variants) {
      const { unmount, container } = render(<Button variant={variant}>Go</Button>);
      const button = container.querySelector('button')!;

      expect(button.className).not.toMatch(/bolt-elements-[a-zA-Z0-9.-]*-dark\b/);
      expect(button.className).not.toMatch(/bolt-elements-ring\b/);
      unmount();
    }
  });

  it('preserves the existing public props contract (variant, size, className passthrough)', () => {
    render(
      <Button variant="outline" size="lg" className="my-extra-class">
        Go
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Go' });

    expect(button.className).toContain('my-extra-class');
    expect(button.className).toContain('h-10'); // size="lg"
  });
});
