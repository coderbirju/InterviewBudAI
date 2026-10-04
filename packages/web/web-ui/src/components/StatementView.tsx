import { createElement } from 'react';
import type { ReactNode } from 'react';
import { isStatementTree } from '../../../src/statement-tree.js';
import type {
  StatementNode,
  StatementTag,
} from '../../../src/statement-tree.js';

/**
 * Renders a sanitized statement tree (ADR 0015 D2) with React elements. Each
 * tag maps to the same element with a fixed Tailwind class (no inline
 * styles, fits the CSP); text goes in as React children, so it is always
 * escaped. There is no HTML string and no `dangerouslySetInnerHTML`.
 *
 * The tree is checked again with the shared `isStatementTree()`; a tree that
 * fails it is not rendered and `fallback` is shown instead.
 */

const CLASS: Readonly<Record<StatementTag, string>> = {
  p: 'my-3 leading-relaxed',
  pre: 'my-3 overflow-x-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-900 p-3 font-mono text-xs text-slate-200',
  code: 'rounded bg-slate-800 px-1 py-0.5 font-mono text-[0.85em] text-slate-200',
  strong: 'font-semibold text-slate-100',
  em: 'italic',
  ul: 'my-3 list-disc space-y-1 pl-6',
  ol: 'my-3 list-decimal space-y-1 pl-6',
  li: 'leading-relaxed',
  sup: 'align-super text-[0.75em]',
  sub: 'align-sub text-[0.75em]',
};

function renderNodes(nodes: readonly StatementNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.t === 'text') return node.v;
    if (node.t === 'br') return <br key={i} />;
    return createElement(
      node.t,
      { key: i, className: CLASS[node.t] },
      ...renderNodes(node.c),
    );
  });
}

export function StatementView({
  blocks,
  fallback,
}: {
  readonly blocks: unknown;
  readonly fallback: ReactNode;
}): JSX.Element {
  if (!isStatementTree(blocks)) return <>{fallback}</>;
  return (
    <div className="break-words text-sm text-slate-300" data-testid="statement">
      {renderNodes(blocks)}
    </div>
  );
}
