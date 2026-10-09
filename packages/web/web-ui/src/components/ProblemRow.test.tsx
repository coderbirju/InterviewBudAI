import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProblemRow } from './ProblemRow';
import type { CatalogProblem } from '../lib/api';

const LC: CatalogProblem = {
  id: 'two-sum',
  title: 'Two Sum',
  url: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'Easy',
  status: 'none',
  completed: false,
};

function renderRow(problem: CatalogProblem): void {
  render(
    <table>
      <tbody>
        <ProblemRow problem={problem} onStatusChange={vi.fn()} />
      </tbody>
    </table>,
  );
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

describe('ProblemRow — title opens Notes', () => {
  it('the title href is the Notes page, same tab', () => {
    renderRow(LC);
    const title = screen.getByRole('link', { name: 'Two Sum' });
    expect(title).toHaveAttribute('href', '/notes/two-sum');
    expect(title).not.toHaveAttribute('target');
  });

  it('a plain click navigates in-app (History API, no reload)', async () => {
    const user = userEvent.setup();
    const onPop = vi.fn();
    window.addEventListener('popstate', onPop);
    renderRow(LC);
    await user.click(screen.getByRole('link', { name: 'Two Sum' }));
    expect(window.location.pathname).toBe('/notes/two-sum');
    expect(onPop).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', onPop);
  });

  it('modifier and middle clicks are left to the browser', () => {
    renderRow(LC);
    const title = screen.getByRole('link', { name: 'Two Sum' });
    for (const init of [
      { button: 0, ctrlKey: true },
      { button: 0, metaKey: true },
      { button: 0, shiftKey: true },
      { button: 0, altKey: true },
      { button: 1 },
    ]) {
      const ev = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      title.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
      expect(window.location.pathname).toBe('/');
    }
  });
});

describe('ProblemRow — LeetCode icon', () => {
  it('is its own link with the external href, target, rel and label', () => {
    renderRow(LC);
    const icon = screen.getByRole('link', { name: 'Open Two Sum on LeetCode' });
    expect(icon).toHaveAttribute('href', LC.url);
    expect(icon).toHaveAttribute('target', '_blank');
    expect(icon).toHaveAttribute('rel', 'noopener noreferrer');
    expect(icon).toHaveAttribute('aria-label', 'Open Two Sum on LeetCode');
    // Not nested inside the title link (and vice versa).
    const title = screen.getByRole('link', { name: 'Two Sum' });
    expect(title.contains(icon)).toBe(false);
    expect(icon.contains(title)).toBe(false);
    expect(icon.closest('a')).toBe(icon);
  });

  it('a custom problem with a non-LeetCode url gets an icon named for its link', () => {
    renderRow({
      ...LC,
      id: 'u-mine-abc123',
      title: 'My puzzle',
      url: 'https://example.com/p',
      custom: true,
    });
    expect(screen.getByRole('link', { name: 'My puzzle' })).toHaveAttribute(
      'href',
      '/notes/u-mine-abc123',
    );
    const icon = screen.getByRole('link', {
      name: 'Open the link for My puzzle in a new tab',
    });
    expect(icon).toHaveAttribute('href', 'https://example.com/p');
    expect(icon).toHaveAttribute('target', '_blank');
    expect(icon).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('a custom problem with no url: title opens Notes, no icon', () => {
    const custom: CatalogProblem = {
      id: 'u-book-abc123',
      title: 'Book problem',
      difficulty: 'Medium',
      status: 'none',
      completed: false,
      custom: true,
    };
    renderRow(custom);
    expect(screen.getByRole('link', { name: 'Book problem' })).toHaveAttribute(
      'href',
      '/notes/u-book-abc123',
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
  });
});

describe('ProblemRow — no Notes column', () => {
  it('renders Status / Problem / Difficulty cells only, no Notes link', () => {
    renderRow(LC);
    expect(document.querySelectorAll('td')).toHaveLength(3);
    expect(screen.queryByRole('link', { name: /notes for/i })).toBeNull();
    expect(screen.queryByText('Notes')).toBeNull();
  });
});
