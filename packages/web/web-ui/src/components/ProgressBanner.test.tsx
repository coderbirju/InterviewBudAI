import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBanner } from './ProgressBanner';

describe('ProgressBanner', () => {
  it('renders the fraction and an emerald bar sized to the percentage', () => {
    render(
      <ProgressBanner
        progress={{
          completed: 12,
          total: 175,
          byStatus: {
            none: 160,
            done: 12,
            to_revisit: 2,
            did_not_understand: 1,
          },
        }}
      />,
    );

    expect(screen.getByText('12 / 175')).toBeInTheDocument();

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '12');
    expect(bar).toHaveAttribute('aria-valuemax', '175');

    // The inner emerald fill is width: (12/175)*100%.
    const fill = bar.querySelector('div');
    expect(fill).not.toBeNull();
    expect(fill).toHaveClass('bg-emerald-500');
    expect((fill as HTMLElement).style.width).toBe(`${(12 / 175) * 100}%`);
  });

  it('shows the status breakdown counts', () => {
    render(
      <ProgressBanner
        progress={{
          completed: 3,
          total: 10,
          byStatus: {
            none: 4,
            done: 3,
            to_revisit: 2,
            did_not_understand: 1,
          },
        }}
      />,
    );
    // Labels present.
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('To revisit')).toBeInTheDocument();
    expect(screen.getByText("Didn't understand")).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });
});
