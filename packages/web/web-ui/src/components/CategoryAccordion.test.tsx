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

  it('shows the curriculum label (not the raw id) when the server sends one', () => {
    render(
      <CategoryAccordion
        topic={{ ...topic, topic: 'stack', label: 'Stack & Queue' }}
        busyIds={new Set()}
        onStatusChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Stack & Queue')).toBeInTheDocument();
    expect(screen.queryByText('stack')).not.toBeInTheDocument();
    expect(
      screen.getByLabelText('1 of 2 done in Stack & Queue'),
    ).toBeInTheDocument();
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

    // Title opens the problem's Notes page; a separate icon opens LeetCode.
    const link = screen.getByRole('link', { name: 'Two Sum' });
    expect(link).toHaveAttribute('href', '/notes/two-sum');
    expect(link).not.toHaveAttribute('target');
    const icon = screen.getByRole('link', { name: 'Open Two Sum on LeetCode' });
    expect(icon).toHaveAttribute('href', topic.problems[0].url);
    expect(icon).toHaveAttribute('target', '_blank');
    expect(icon).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('has Status / Problem / Difficulty headers and no Notes column', async () => {
    const user = userEvent.setup();
    render(
      <CategoryAccordion
        topic={topic}
        busyIds={new Set()}
        onStatusChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Arrays & Hashing/ }));
    expect(
      screen.getAllByRole('columnheader').map((h) => h.textContent),
    ).toEqual(['Status', 'Problem', 'Difficulty']);
    expect(screen.queryByRole('link', { name: /notes for/i })).toBeNull();
    // Every row has as many cells as there are headers.
    for (const row of screen.getAllByRole('row').slice(1)) {
      expect(row.querySelectorAll('td')).toHaveLength(3);
    }
  });

  it('a custom problem without a url: title opens Notes, no external icon', async () => {
    const user = userEvent.setup();
    render(
      <CategoryAccordion
        topic={{
          ...topic,
          problems: [
            {
              id: 'u-book-abc123',
              title: 'Book problem',
              difficulty: 'Medium',
              status: 'none',
              completed: false,
            },
          ],
        }}
        busyIds={new Set()}
        onStatusChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Arrays & Hashing/ }));
    expect(screen.getByRole('link', { name: 'Book problem' })).toHaveAttribute(
      'href',
      '/notes/u-book-abc123',
    );
    expect(screen.queryByRole('link', { name: /^Open / })).toBeNull();
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
  });
});
