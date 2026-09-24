import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DifficultyBadge } from './DifficultyBadge';

describe('DifficultyBadge', () => {
  it('renders Easy in green tokens', () => {
    render(<DifficultyBadge difficulty="Easy" />);
    const el = screen.getByText('Easy');
    expect(el).toHaveClass('text-difficulty-easy');
  });

  it('renders Medium in amber tokens', () => {
    render(<DifficultyBadge difficulty="Medium" />);
    expect(screen.getByText('Medium')).toHaveClass('text-difficulty-medium');
  });

  it('renders Hard in red tokens', () => {
    render(<DifficultyBadge difficulty="Hard" />);
    expect(screen.getByText('Hard')).toHaveClass('text-difficulty-hard');
  });
});
