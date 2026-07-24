// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

/**
 * Sprint 70 — Legacy Dark-Theme Token Remediation. `Badge`'s `default`/`secondary` variants
 * previously used the invalid `bg-bolt-elements-background` token, and its focus ring
 * referenced `bolt-elements-ring` (never defined). These tests lock in the fix.
 */
describe('Badge (remediated)', () => {
  it('default variant uses a deliberate Builders surface token, not the invalid bare background', () => {
    render(<Badge>Draft</Badge>);

    const badge = screen.getByText('Draft');

    expect(badge.className).toContain('bg-builders-surface-elevated');
    expect(badge.className).not.toMatch(/bg-bolt-elements-background(?!-depth)/);
  });

  it('keeps a valid focus ring token', () => {
    render(<Badge>Draft</Badge>);

    const badge = screen.getByText('Draft');

    expect(badge.className).toContain('focus:ring-builders-border-focus');
    expect(badge.className).not.toContain('bolt-elements-ring');
  });

  it('every variant renders without a dark-suffixed legacy token', () => {
    const variants = [
      'default',
      'secondary',
      'destructive',
      'outline',
      'primary',
      'success',
      'warning',
      'danger',
      'info',
      'subtle',
    ] as const;

    for (const variant of variants) {
      const { unmount } = render(<Badge variant={variant}>Status</Badge>);
      const badge = screen.getByText('Status');

      expect(badge.className).not.toMatch(/bolt-elements-[a-zA-Z0-9.-]*-dark\b/);
      unmount();
    }
  });

  it('preserves the existing icon prop', () => {
    render(<Badge icon="i-ph:check">Approved</Badge>);

    const badge = screen.getByText('Approved');
    expect(badge.querySelector('.i-ph\\:check')).toBeTruthy();
  });
});
