import { EditorSelection, EditorState } from '@codemirror/state';
import { insertNewlineAndIndent } from '@codemirror/commands';
import { ensureSyntaxTree, indentUnit } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { markdownLanguage, resolveFenceLanguage } from './markdown';

/**
 * ADR 0014 D2 — pure (no DOM) guards for the custom Markdown wrapper. If a
 * `@lezer/markdown` / grammar bump breaks the nested parse, these fail CI.
 */

function stateFor(doc: string, cursor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdownLanguage, indentUnit.of('    ')],
  });
}

function fullTree(state: EditorState) {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (!tree) throw new Error('parse did not finish');
  return tree;
}

type SyntaxNode = ReturnType<ReturnType<typeof fullTree>['resolveInner']>;

/**
 * Node names (nested trees included) enclosing every position in [from, to).
 * `resolveInner` enters the mounted (overlay) trees of fenced code.
 */
function nodeNames(state: EditorState, from: number, to: number): string[] {
  const tree = fullTree(state);
  const names = new Set<string>();
  for (let pos = from; pos < to; pos++) {
    for (
      let n: SyntaxNode | null = tree.resolveInner(pos, 1);
      n;
      n = n.parent
    ) {
      names.add(n.name);
    }
  }
  return [...names];
}

/** Highlight classes for the text in [from, to). */
function tokenClasses(state: EditorState, from: number, to: number): string[] {
  const classes: string[] = [];
  highlightTree(
    fullTree(state),
    classHighlighter,
    (_f, _t, cls) => {
      classes.push(...cls.split(' '));
    },
    from,
    to,
  );
  return classes;
}

const DOC = [
  '# Two sum',
  '',
  '```python',
  'def two_sum(nums, target):',
  '    return []',
  '```',
  '',
  '```go',
  'func twoSum(nums []int) []int {',
  '\treturn nil',
  '}',
  '```',
  '',
  '```rust',
  'fn main() { let x = 1; }',
  '```',
].join('\n');

function range(fence: string): [number, number] {
  const from = DOC.indexOf('```' + fence + '\n');
  const close = DOC.indexOf('\n```', from + 3);
  return [from, close + 4];
}

describe('fence language resolution', () => {
  it.each([
    ['python', 'Python'],
    ['py', 'Python'],
    ['python3', 'Python'],
    ['Python', 'Python'],
    ['go', 'Go'],
    ['golang', 'Go'],
    ['python title="x"', 'Python'],
  ])('%s → %s', (info, name) => {
    expect(resolveFenceLanguage(info)?.name).toBe(name);
  });

  it.each(['rust', '', 'javascript', 'pythonic', 'gopher'])(
    '%j → plain',
    (info) => {
      expect(resolveFenceLanguage(info)).toBeNull();
    },
  );
});

describe('nested parse (guards the Markdown wrapper)', () => {
  const state = stateFor(DOC);

  it('a python fence holds Python nodes', () => {
    const names = nodeNames(state, ...range('python'));
    expect(names).toContain('FunctionDefinition');
    expect(names).not.toContain('FunctionDecl');
  });

  it('a go fence holds Go nodes', () => {
    const names = nodeNames(state, ...range('go'));
    expect(names).toContain('FunctionDecl');
    expect(names).not.toContain('FunctionDefinition');
  });

  it('an unknown fence is plain code text', () => {
    const names = nodeNames(state, ...range('rust'));
    expect(names).toContain('FencedCode');
    expect(names).toContain('CodeText');
    expect(names).not.toContain('FunctionDefinition');
    expect(names).not.toContain('FunctionDecl');
  });

  it('python and go fences get keyword tokens; the rust fence gets none', () => {
    const [pf, pt] = range('python');
    const pyBody = DOC.indexOf('def', pf);
    expect(tokenClasses(state, pyBody, pt)).toContain('tok-keyword');
    const [gf, gt] = range('go');
    expect(tokenClasses(state, DOC.indexOf('func', gf), gt)).toContain(
      'tok-keyword',
    );
    const [rf, rt] = range('rust');
    const rustBody = DOC.indexOf('fn main', rf);
    expect(tokenClasses(state, rustBody, rt - 3)).not.toContain('tok-keyword');
  });

  it('markdown itself is highlighted (heading)', () => {
    expect(tokenClasses(state, 0, 9)).toContain('tok-heading');
  });
});

describe('auto-indent', () => {
  function enter(doc: string): string {
    let state = stateFor(doc);
    fullTree(state);
    insertNewlineAndIndent({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
    return state.doc.toString();
  }

  it('Enter after `def f():` in a python fence indents', () => {
    expect(enter('```python\ndef f():')).toBe('```python\ndef f():\n    ');
  });

  it('Enter after `{` in a go fence indents', () => {
    expect(enter('```go\nfunc f() {')).toMatch(/^```go\nfunc f\(\) \{\n[\t ]+/);
  });
});
