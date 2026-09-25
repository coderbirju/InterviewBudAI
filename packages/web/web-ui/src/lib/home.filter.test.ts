import { describe, it, expect } from 'vitest';
import type { CatalogProblem, CatalogTopic } from './api';
import {
  DIFFICULTY_ORDER,
  EMPTY_FILTER,
  filterCatalog,
  filterFromSearch,
  isFilterActive,
  matchesFilter,
  searchWithFilter,
  toggleValue,
} from './home';
import type { CatalogFilter } from './home';

function p(
  id: string,
  title: string,
  difficulty: CatalogProblem['difficulty'],
  status: CatalogProblem['status'],
): CatalogProblem {
  return {
    id,
    title,
    url: `https://x/${id}`,
    difficulty,
    status,
    completed: status === 'done',
  };
}

const TWO_SUM = p('two-sum', 'Two Sum', 'Easy', 'done');
const THREE_SUM = p('3sum', '3Sum', 'Medium', 'to_revisit');
const ANAGRAM = p('valid-anagram', 'Valid Anagram', 'Easy', 'none');
const TRAP = p(
  'trapping-rain-water',
  'Trapping Rain Water',
  'Hard',
  'did_not_understand',
);

const TOPICS: CatalogTopic[] = [
  { topic: 'Arrays & Hashing', problems: [TWO_SUM, ANAGRAM] },
  { topic: 'Two Pointers', problems: [THREE_SUM, TRAP, TWO_SUM] },
  { topic: 'Stack', problems: [] },
];

const f = (over: Partial<CatalogFilter>): CatalogFilter => ({
  ...EMPTY_FILTER,
  ...over,
});

describe('isFilterActive', () => {
  it('is false for the empty filter and whitespace-only queries', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive(f({ query: '   ' }))).toBe(false);
  });

  it('is true for any query or chip', () => {
    expect(isFilterActive(f({ query: 'sum' }))).toBe(true);
    expect(isFilterActive(f({ difficulties: ['Hard'] }))).toBe(true);
    expect(isFilterActive(f({ statuses: ['none'] }))).toBe(true);
  });
});

describe('matchesFilter — search', () => {
  it('matches a case-insensitive title substring', () => {
    expect(matchesFilter(TWO_SUM, f({ query: 'SUM' }))).toBe(true);
    expect(matchesFilter(ANAGRAM, f({ query: 'sum' }))).toBe(false);
  });

  it('matches the problem id and trims the query', () => {
    expect(matchesFilter(TRAP, f({ query: ' rain-water ' }))).toBe(true);
    expect(matchesFilter(THREE_SUM, f({ query: '3sum' }))).toBe(true);
  });

  it('the empty filter matches everything', () => {
    for (const x of [TWO_SUM, THREE_SUM, ANAGRAM, TRAP]) {
      expect(matchesFilter(x, EMPTY_FILTER)).toBe(true);
    }
  });
});

describe('matchesFilter — chips', () => {
  it('ORs difficulties within the facet', () => {
    const filter = f({ difficulties: ['Easy', 'Hard'] });
    expect(matchesFilter(TWO_SUM, filter)).toBe(true);
    expect(matchesFilter(TRAP, filter)).toBe(true);
    expect(matchesFilter(THREE_SUM, filter)).toBe(false);
  });

  it('ORs statuses within the facet (including none)', () => {
    const filter = f({ statuses: ['to_revisit', 'none'] });
    expect(matchesFilter(THREE_SUM, filter)).toBe(true);
    expect(matchesFilter(ANAGRAM, filter)).toBe(true);
    expect(matchesFilter(TWO_SUM, filter)).toBe(false);
  });

  it('ANDs search, difficulty and status together', () => {
    const filter = f({
      query: 'sum',
      difficulties: ['Easy'],
      statuses: ['done'],
    });
    expect(matchesFilter(TWO_SUM, filter)).toBe(true);
    expect(matchesFilter(THREE_SUM, filter)).toBe(false);
    expect(
      matchesFilter(TWO_SUM, f({ query: 'sum', statuses: ['to_revisit'] })),
    ).toBe(false);
  });
});

describe('filterCatalog', () => {
  it('inactive filter keeps all non-empty topics in order', () => {
    const all = filterCatalog(TOPICS, EMPTY_FILTER);
    expect(all.topics.map((t) => t.topic.topic)).toEqual([
      'Arrays & Hashing',
      'Two Pointers',
    ]);
    expect(all.matched).toBe(4); // two-sum de-duplicated across topics
  });

  it('returns per-topic matches and a de-duplicated count', () => {
    const r = filterCatalog(TOPICS, f({ query: 'sum' }));
    expect(
      r.topics.map((t) => [t.topic.topic, t.matches.map((m) => m.id)]),
    ).toEqual([
      ['Arrays & Hashing', ['two-sum']],
      ['Two Pointers', ['3sum', 'two-sum']],
    ]);
    expect(r.matched).toBe(2);
  });

  it('a combined filter narrows to a single topic', () => {
    const r = filterCatalog(
      TOPICS,
      f({ query: 'water', difficulties: ['Hard'] }),
    );
    expect(r.topics).toHaveLength(1);
    expect(r.topics[0].matches).toEqual([TRAP]);
    expect(r.matched).toBe(1);
  });

  it('no matches → no topics and a zero count', () => {
    const r = filterCatalog(TOPICS, f({ query: 'zzz-nothing' }));
    expect(r.topics).toEqual([]);
    expect(r.matched).toBe(0);
  });

  it('keeps pinned ids visible even when they no longer match', () => {
    const r = filterCatalog(
      TOPICS,
      f({ statuses: ['to_revisit'] }),
      new Set(['valid-anagram']),
    );
    expect(
      r.topics.map((t) => [t.topic.topic, t.matches.map((m) => m.id)]),
    ).toEqual([
      ['Arrays & Hashing', ['valid-anagram']],
      ['Two Pointers', ['3sum']],
    ]);
    expect(r.matched).toBe(2);
  });

  it('handles an empty catalog', () => {
    expect(filterCatalog([], f({ query: 'x' }))).toEqual({
      topics: [],
      matched: 0,
    });
  });
});

describe('toggleValue', () => {
  it('adds/removes a value and keeps the canonical order', () => {
    expect(toggleValue(['Hard'], 'Easy', DIFFICULTY_ORDER)).toEqual([
      'Easy',
      'Hard',
    ]);
    expect(toggleValue(['Easy', 'Hard'], 'Easy', DIFFICULTY_ORDER)).toEqual([
      'Hard',
    ]);
  });
});

describe('URL query round-trip', () => {
  it('parses q/difficulty/status and ignores unknown values', () => {
    expect(
      filterFromSearch(
        '?q=Two%20Sum&difficulty=Hard,Easy,Bogus&status=to_revisit,nope',
      ),
    ).toEqual({
      query: 'Two Sum',
      difficulties: ['Easy', 'Hard'],
      statuses: ['to_revisit'],
    });
    expect(filterFromSearch('')).toEqual(EMPTY_FILTER);
  });

  it('parses facet values case-insensitively', () => {
    expect(filterFromSearch('?difficulty=easy,HARD&status=TO_REVISIT')).toEqual(
      {
        query: '',
        difficulties: ['Easy', 'Hard'],
        statuses: ['to_revisit'],
      },
    );
  });

  it('writes list values with readable (unescaped) commas', () => {
    expect(
      searchWithFilter(
        '',
        f({ difficulties: ['Easy', 'Hard'], statuses: ['done'] }),
      ),
    ).toBe('?difficulty=Easy,Hard&status=done');
    // Commas typed into the search text round-trip too.
    expect(
      filterFromSearch(searchWithFilter('', f({ query: 'a,b' }))).query,
    ).toBe('a,b');
  });

  it('serializes, drops empty facets, and preserves unrelated params', () => {
    expect(searchWithFilter('', EMPTY_FILTER)).toBe('');
    expect(searchWithFilter('?q=old&x=1', EMPTY_FILTER)).toBe('?x=1');
    const s = searchWithFilter(
      '',
      f({ query: 'sum', difficulties: ['Easy', 'Hard'], statuses: ['done'] }),
    );
    expect(filterFromSearch(s)).toEqual({
      query: 'sum',
      difficulties: ['Easy', 'Hard'],
      statuses: ['done'],
    });
  });
});
