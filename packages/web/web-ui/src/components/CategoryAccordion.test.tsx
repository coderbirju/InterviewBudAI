import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryAccordion } from './CategoryAccordion';
import type { CatalogTopic } from '../lib/api';

const topic: CatalogTopic = {
  topic: 'Arrays & Hashing',
  problems: [
    {
      id: 'two-sum',
      title: 'Two Sum',
      url: 'https://leetcode.com/problems/two-sum/',
      difficulty: 'Easy',
      status: 'done',
      completed: true,
    },
    {
      id: 'group-anagrams',
      title: 'Group Anagrams',
      url: 'https://leetcode.com/problems/group-anagrams/',
      difficulty: 'Medium',
      status: 'none',
      completed: false,
    },
  ],
};

describe('CategoryAccordion', () => {
  it('renders the topic name and a per-category fraction badge', () => {
    render(
      <CategoryAccordion
        topic={topic}
        busyIds={new Set()}
        onStatusChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Arrays & Hashing')).toBeInTheDocument();
    // 1 of 2 done.
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('is collapsed by default and expands on click to show the table', async () => {
    const user = userEvent.setup();
    render(
      <CategoryAccordion
        topic={topic}
        busyIds={new Set()}
        onStatusChange={vi.fn()}
      />,
    );
    // Collapsed: problem rows not shown.
    expect(screen.queryByText('Two Sum')).not.toBeInTheDocument();

    const header = screen.getByRole('button', { name: /Arrays & Hashing/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await user.click(header);

    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Two Sum')).toBeInTheDocument();
    expect(screen.getByText('Group Anagrams')).toBeInTheDocument();

    // Title links out to LeetCode in a new tab with noopener.
    const link = screen.getByRole('link', { name: 'Two Sum' });
    expect(link).toHaveAttribute('href', topic.problems[0].url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
