// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from './Input';

/**
 * Sprint 70 — Legacy Dark-Theme Token Remediation. `Input` previously referenced
 * `bolt-elements-border` (never a real token), `bg-bolt-elements-background` (invalid, no
 * `-depth-N` suffix), and `bolt-elements-ring` (never defined) — meaning the field had no
 * deliberately-set border, background, or focus ring at all, and no explicit text color either.
 * These tests lock in the fix.
 */
describe('Input (remediated)', () => {
  it('uses a deliberate theme surface for its background, not native/invalid', () => {
    render(<Input placeholder="Name" />);

    const input = screen.getByPlaceholderText('Name');

    expect(input.className).toContain('bg-builders-surface-recessed');
    expect(input.className).not.toMatch(/bg-bolt-elements-background(?!-depth)/);
  });

  it('uses a deliberate, valid border token', () => {
    render(<Input placeholder="Name" />);

    const input = screen.getByPlaceholderText('Name');

    expect(input.className).toContain('border-builders-border-default');
    expect(input.className).not.toContain('bolt-elements-border ');
  });

  it('deliberately sets a text color (previously unset, risking invisible input text)', () => {
    render(<Input placeholder="Name" />);

    const input = screen.getByPlaceholderText('Name');
    expect(input.className).toContain('text-bolt-elements-textPrimary');
  });

  it('resets native appearance so no browser-default surface can leak through', () => {
    render(<Input placeholder="Name" />);

    const input = screen.getByPlaceholderText('Name');
    expect(input.className).toContain('appearance-none');
  });

  it('keeps a valid focus-visible ring token', () => {
    render(<Input placeholder="Name" />);

    const input = screen.getByPlaceholderText('Name');

    expect(input.className).toContain('focus-visible:ring-builders-border-focus');
    expect(input.className).not.toContain('bolt-elements-ring');
  });

  it('disabled state remains legible (opacity + cursor both present)', () => {
    render(<Input placeholder="Name" disabled />);

    const input = screen.getByPlaceholderText('Name') as HTMLInputElement;

    expect(input.disabled).toBe(true);
    expect(input.className).toContain('disabled:opacity-50');
    expect(input.className).toContain('disabled:cursor-not-allowed');
  });

  it('preserves existing value/onChange wiring', () => {
    const handleChange = vi.fn();
    render(<Input placeholder="Name" value="LocalShop India" onChange={handleChange} />);

    const input = screen.getByPlaceholderText('Name') as HTMLInputElement;
    expect(input.value).toBe('LocalShop India');
  });
});
