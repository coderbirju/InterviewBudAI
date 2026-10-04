import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatementView } from './StatementView';
import ready from '../test/fixtures/statement/get-ready.json';

/* ADR 0015 D2: the tree is rendered with React elements; text is escaped;
 * a tree that fails isStatementTree shows the fallback instead. */

const FALLBACK = <p>fallback shown</p>;

describe('StatementView', () => {
  it('renders the fixture tree as elements with fixed classes and no attributes from data', () => {
    const { container } = render(
      <StatementView blocks={ready.blocks} fallback={FALLBACK} />,
    );
    const root = screen.getByTestId('statement');
    expect(root.querySelectorAll('p').length).toBe(3);
    expect(root.querySelector('pre')).toHaveTextContent('nums = [1,4,6]');
    expect(root.querySelector('sup')).toHaveTextContent('4');
    expect(root.querySelectorAll('li')).toHaveLength(2);
    expect(screen.queryByText('fallback shown')).toBeNull();
    // Only the class attribute is ever set, from the fixed map.
    for (const el of Array.from(root.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name).toBe('class');
      }
    }
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('markup inside text stays text', () => {
    const { container } = render(
      <StatementView
        blocks={[
          {
            t: 'p',
            c: [{ t: 'text', v: '<img src=x onerror="alert(1)"><script>' }],
          },
        ]}
        fallback={FALLBACK}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it.each([
    ['a script node', [{ t: 'script', c: [{ t: 'text', v: 'alert(1)' }] }]],
    ['an attribute', [{ t: 'p', c: [], onclick: 'alert(1)' }]],
    ['an HTML string', '<p onclick="x">hi</p>'],
    ['null', null],
  ])('rejects %s and shows the fallback', (_l, blocks) => {
    const { container } = render(
      <StatementView blocks={blocks} fallback={FALLBACK} />,
    );
    expect(screen.getByText('fallback shown')).toBeInTheDocument();
    expect(screen.queryByTestId('statement')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
  });
});
