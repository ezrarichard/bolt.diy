// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuildersInput } from './BuildersInput';

describe('BuildersInput', () => {
  it('always has an accessible label associated with the input', () => {
    render(<BuildersInput label="Project name" />);

    const input = screen.getByLabelText('Project name');
    expect(input).toBeTruthy();
  });

  it('visually hides the label via sr-only while keeping it in the accessibility tree', () => {
    render(<BuildersInput label="Search" hideLabel />);

    const input = screen.getByLabelText('Search');
    expect(input).toBeTruthy();

    const label = screen.getByText('Search');
    expect(label.className).toContain('sr-only');
  });

  it('marks the input invalid and associates the error text via aria-describedby', () => {
    render(<BuildersInput label="Email" error="Enter a valid email" />);

    const input = screen.getByLabelText('Email') as HTMLInputElement;

    expect(input.getAttribute('aria-invalid')).toBe('true');

    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const errorEl = document.getElementById(describedBy!);
    expect(errorEl?.textContent).toBe('Enter a valid email');
  });

  it('does not mark the input invalid when there is no error', () => {
    render(<BuildersInput label="Email" />);

    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('respects the disabled prop', () => {
    render(<BuildersInput label="Email" disabled />);

    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
