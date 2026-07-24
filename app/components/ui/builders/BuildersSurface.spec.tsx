// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuildersSurface } from './BuildersSurface';
import { BuildersCard, BuildersCardHeader, BuildersCardTitle } from './BuildersCard';

describe('BuildersSurface', () => {
  it('defaults to the elevated surface token, default border, and large radius', () => {
    render(<BuildersSurface data-testid="surface">content</BuildersSurface>);

    const surface = screen.getByTestId('surface');

    expect(surface.className).toContain('bg-builders-surface-elevated');
    expect(surface.className).toContain('border-builders-border-default');
    expect(surface.className).toContain('builders-radius-lg');
  });

  it('switches elevation, border, and radius via variant props', () => {
    render(
      <BuildersSurface data-testid="surface" elevation="recessed" border="selected" radius="sm">
        content
      </BuildersSurface>,
    );

    const surface = screen.getByTestId('surface');

    expect(surface.className).toContain('bg-builders-surface-recessed');
    expect(surface.className).toContain('border-builders-border-selected');
    expect(surface.className).toContain('builders-radius-sm');
  });
});

describe('BuildersCard', () => {
  it('composes into a card with a header and title, matching the existing Card composition shape', () => {
    render(
      <BuildersCard>
        <BuildersCardHeader>
          <BuildersCardTitle>Current Stage</BuildersCardTitle>
        </BuildersCardHeader>
      </BuildersCard>,
    );

    expect(screen.getByText('Current Stage')).toBeTruthy();
  });
});
