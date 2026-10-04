import { describe, expect, it } from 'vitest';
import {
  GENERIC_TEMPLATES,
  buildTemplate,
  extractCode,
  fencedStarter,
  isEmptyNote,
  noteEditorMode,
  signatureKey,
  starterFor,
} from './noteTemplate';

/* ADR 0015 D3 — the code-first template rules (pure). Snippets follow the
 * shape LeetCode returns (4-space indent; Python body one indented blank
 * line, Go body `{\n    \n}`), with made-up names. */

const PY_SNIPPET =
  'class Solution:\n    def pairSum(self, nums: List[int], goal: int) -> List[int]:\n        ';
const GO_SNIPPET = 'func pairSum(nums []int, goal int) []int {\n    \n}';

const PY_DESIGN = [
  'class Counter:',
  '',
  '    def __init__(self, limit: int):',
  '        ',
  '',
  '    def hit(self, key: int) -> int:',
  '        ',
  '',
  '    def reset(self) -> None:',
  '        ',
  '',
  '',
  '# Your Counter object will be instantiated and called as such:',
  '# obj = Counter(limit)',
  '# param_1 = obj.hit(key)',
].join('\n');

const PY_LINKED = [
  '# Definition for singly-linked list.',
  '# class ListNode:',
  '#     def __init__(self, val=0, next=None):',
  '#         self.val = val',
  'class Solution:',
  '    def flip(self, head: Optional[ListNode]) -> Optional[ListNode]:',
  '        ',
].join('\n');

const GO_DESIGN = [
  'type Counter struct {',
  '    ',
  '}',
  '',
  '',
  'func Constructor(limit int) Counter {',
  '    ',
  '}',
  '',
  '',
  'func (this *Counter) Hit(key int) int {',
  '    ',
  '}',
  '',
  '',
  '/**',
  ' * Your Counter object will be instantiated and called as such:',
  ' * func example() {',
  ' * obj := Constructor(limit);',
  ' */',
].join('\n');

describe('buildTemplate — Python', () => {
  it('puts the prompts in the function and ends the body with pass (ADR example)', () => {
    expect(buildTemplate(PY_SNIPPET, 'python')).toBe(
      [
        'class Solution:',
        '    def pairSum(self, nums: List[int], goal: int) -> List[int]:',
        '        # Intuition:',
        '        #',
        '        # Approach:',
        '        #',
        '        # Complexity: time O(?), space O(?)',
        '        pass',
      ].join('\n'),
    );
  });

  it('design class: comments in the first method only, pass in EVERY empty method, one blank line kept between methods', () => {
    const out = buildTemplate(PY_DESIGN, 'python');
    // No whitespace-only body line survives.
    expect(out.split('\n').some((l) => l !== '' && l.trim() === '')).toBe(
      false,
    );
    expect(out).toBe(
      [
        'class Counter:',
        '',
        '    def __init__(self, limit: int):',
        '        # Intuition:',
        '        #',
        '        # Approach:',
        '        #',
        '        # Complexity: time O(?), space O(?)',
        '        pass',
        '',
        '    def hit(self, key: int) -> int:',
        '        pass',
        '',
        '    def reset(self) -> None:',
        '        pass',
        '',
        '',
        '# Your Counter object will be instantiated and called as such:',
        '# obj = Counter(limit)',
        '# param_1 = obj.hit(key)',
      ].join('\n'),
    );
  });

  it('separators stay outside bodies: a method with code keeps its blank line before the next def', () => {
    const snippet = [
      'class Box:',
      '    def __init__(self):',
      '        self.items = []',
      '',
      '    def add(self, x: int) -> None:',
      '        ',
      '',
      '    def size(self) -> int:',
      '        ',
    ].join('\n');
    expect(buildTemplate(snippet, 'python')).toBe(
      [
        'class Box:',
        '    def __init__(self):',
        '        # Intuition:',
        '        #',
        '        # Approach:',
        '        #',
        '        # Complexity: time O(?), space O(?)',
        '        self.items = []',
        '',
        '    def add(self, x: int) -> None:',
        '        pass',
        '',
        '    def size(self) -> int:',
        '        pass',
      ].join('\n'),
    );
  });

  it('keeps a leading comment block unchanged; a commented def is not the signature', () => {
    const out = buildTemplate(PY_LINKED, 'python').split('\n');
    expect(out.slice(0, 4)).toEqual(PY_LINKED.split('\n').slice(0, 4));
    expect(out[5]).toBe(
      '    def flip(self, head: Optional[ListNode]) -> Optional[ListNode]:',
    );
    expect(out[6]).toBe('        # Intuition:');
    expect(out.at(-1)).toBe('        pass');
    // The commented-out __init__ got no pass.
    expect(out.filter((l) => l.trim() === 'pass')).toHaveLength(1);
  });

  it('a method that already has code gets no pass', () => {
    const out = buildTemplate(
      'class Solution:\n    def f(self):\n        return 1',
      'python',
    );
    expect(out).not.toContain('pass');
    expect(out).toContain('        # Intuition:\n');
  });

  it('no signature line: the comments go at the end of the snippet', () => {
    expect(buildTemplate('x = 1', 'python')).toBe(
      'x = 1\n# Intuition:\n#\n# Approach:\n#\n# Complexity: time O(?), space O(?)',
    );
  });
});

describe('buildTemplate — Go', () => {
  it('puts the prompts in the function and removes the blank body line (no return)', () => {
    expect(buildTemplate(GO_SNIPPET, 'go')).toBe(
      [
        'func pairSum(nums []int, goal int) []int {',
        '    // Intuition:',
        '    //',
        '    // Approach:',
        '    //',
        '    // Complexity: time O(?), space O(?)',
        '}',
      ].join('\n'),
    );
  });

  it('design: comments in the first func (Constructor); bodies keep no blank lines; a func in a block comment is ignored', () => {
    const out = buildTemplate(GO_DESIGN, 'go');
    expect(out).toBe(
      [
        'type Counter struct {',
        '}',
        '',
        '',
        'func Constructor(limit int) Counter {',
        '    // Intuition:',
        '    //',
        '    // Approach:',
        '    //',
        '    // Complexity: time O(?), space O(?)',
        '}',
        '',
        '',
        'func (this *Counter) Hit(key int) int {',
        '}',
        '',
        '',
        '/**',
        ' * Your Counter object will be instantiated and called as such:',
        ' * func example() {',
        ' * obj := Constructor(limit);',
        ' */',
      ].join('\n'),
    );
    expect(out).not.toContain('return');
  });
});

describe('generic template (custom problems, no snippet)', () => {
  it.each([null, undefined, '', '   \n'])('%j → the generic template', (s) => {
    expect(buildTemplate(s, 'python')).toBe(GENERIC_TEMPLATES.python);
    expect(buildTemplate(s, 'go')).toBe(GENERIC_TEMPLATES.go);
  });

  it('matches the ADR text exactly', () => {
    expect(GENERIC_TEMPLATES.python).toBe(
      'class Solution:\n    def solve(self):\n        # Intuition:\n        #\n        # Approach:\n        #\n        # Complexity: time O(?), space O(?)\n        pass',
    );
    expect(GENERIC_TEMPLATES.go).toBe(
      'func solve() {\n    // Intuition:\n    //\n    // Approach:\n    //\n    // Complexity: time O(?), space O(?)\n}',
    );
  });

  it('signature keys are def solve( / func solve(', () => {
    expect(signatureKey(null, 'python')).toBe('def solve(');
    expect(signatureKey(null, 'go')).toBe('func solve(');
  });
});

describe('signatureKey', () => {
  it('is the first non-comment signature line, trimmed', () => {
    expect(signatureKey(PY_SNIPPET, 'python')).toBe(
      'def pairSum(self, nums: List[int], goal: int) -> List[int]:',
    );
    expect(signatureKey(PY_LINKED, 'python')).toBe(
      'def flip(self, head: Optional[ListNode]) -> Optional[ListNode]:',
    );
    expect(signatureKey(GO_DESIGN, 'go')).toBe(
      'func Constructor(limit int) Counter {',
    );
  });
});

describe('starterFor — prefill and append', () => {
  it('an empty or whitespace-only note becomes the template itself (no fences)', () => {
    expect(isEmptyNote(' \n\t')).toBe(true);
    expect(starterFor('', PY_SNIPPET, 'python')).toBe(
      buildTemplate(PY_SNIPPET, 'python'),
    );
    expect(starterFor('  \n', null, 'go')).toBe(GENERIC_TEMPLATES.go);
  });

  it('a note without the signature key gets a fenced block after one blank line', () => {
    expect(starterFor('My idea.\n\n\n', GO_SNIPPET, 'go')).toBe(
      `My idea.\n\n${fencedStarter(buildTemplate(GO_SNIPPET, 'go'), 'go')}`,
    );
    expect(starterFor('My idea.', PY_SNIPPET, 'python')).toBe(
      'My idea.\n\n```python\n' + buildTemplate(PY_SNIPPET, 'python') + '\n```',
    );
  });

  it('appends only if the signature key is missing', () => {
    const note =
      'Notes\n```python\nclass Solution:\n    def pairSum(self, nums: List[int], goal: int) -> List[int]:\n        return []\n```';
    expect(starterFor(note, PY_SNIPPET, 'python')).toBeNull();
    // Another language's key is not this one: Go still appends.
    expect(starterFor(note, GO_SNIPPET, 'go')).not.toBeNull();
    // The generic key is a plain substring test.
    expect(starterFor('see def solve(self)', null, 'python')).toBeNull();
    expect(starterFor('func solve() {}', null, 'go')).toBeNull();
  });

  it('a snippet with no signature line never appends (would repeat each open)', () => {
    expect(starterFor('My idea.', 'x = 1', 'python')).toBeNull();
  });
});

describe('noteEditorMode', () => {
  it.each([
    ['```python\nx\n```', 'go', 'markdown'],
    ['  ~~~\nx', 'python', 'markdown'],
    ['', 'go', 'go'],
    ['  \n', 'python', 'python'],
    [GENERIC_TEMPLATES.python, 'go', 'python'],
    [GENERIC_TEMPLATES.go, 'python', 'go'],
    ['Just words.', 'python', 'markdown'],
  ] as const)('%j (preferred %s) → %s', (text, preferred, mode) => {
    expect(noteEditorMode(text, preferred)).toBe(mode);
  });
});

describe('extractCode ("Copy code")', () => {
  it('a code-only note (no fence line) is copied whole', () => {
    expect(extractCode(GENERIC_TEMPLATES.go, 'python')).toBe(
      GENERIC_TEMPLATES.go,
    );
  });

  it('copies the LAST fence in the preferred language', () => {
    const note =
      'a\n```python\none\n```\n```go\ngo1\n```\n```py\ntwo\n```\n```golang\ngo2\n```';
    expect(extractCode(note, 'python')).toBe('two');
    expect(extractCode(note, 'go')).toBe('go2');
  });

  it('falls back to the last Python or Go fence, then to the whole note', () => {
    expect(extractCode('```go\ng\n```\n```rust\nr\n```', 'python')).toBe('g');
    const plain = 'x\n```rust\nr\n```';
    expect(extractCode(plain, 'python')).toBe(plain);
  });

  it('an unclosed fence runs to the end; tildes work', () => {
    expect(extractCode('t\n~~~python3\nx = 1\ny = 2', 'python')).toBe(
      'x = 1\ny = 2',
    );
  });
});
