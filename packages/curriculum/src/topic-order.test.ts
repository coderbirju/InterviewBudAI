import { describe, it, expect } from 'vitest';
import {
  CATALOG,
  TOPIC_ALIASES,
  TOPIC_LABELS,
  TOPIC_ORDER,
  canonicalTopicId,
  compareTopics,
  sortTopics,
  topicLabel,
} from './index.js';

describe('topic taxonomy', () => {
  it('is exactly the 13 curriculum topics in learning order', () => {
    expect(TOPIC_ORDER).toEqual([
      'arrays',
      'binary-search',
      'sorting',
      'hashing',
      'linked-list',
      'stack',
      'heap',
      'recursion',
      'backtracking',
      'trees',
      'graphs',
      'greedy',
      'dynamic-programming',
    ]);
  });

  it('every catalog topic is in TOPIC_ORDER (add new topics there)', () => {
    const catalogTopics = new Set(CATALOG.flatMap((p) => p.topics));
    const missing = [...catalogTopics].filter((t) => !TOPIC_ORDER.includes(t));
    expect(missing).toEqual([]);
  });

  it('every TOPIC_ORDER topic has at least one catalog problem', () => {
    const catalogTopics = new Set(CATALOG.flatMap((p) => p.topics));
    const empty = TOPIC_ORDER.filter((t) => !catalogTopics.has(t));
    expect(empty).toEqual([]);
  });

  it('every topic has a label and no label is orphaned', () => {
    expect(Object.keys(TOPIC_LABELS).sort()).toEqual([...TOPIC_ORDER].sort());
    expect(topicLabel('stack')).toBe('Stack & Queue');
    expect(topicLabel('future-topic')).toBe('future-topic');
    expect(topicLabel('constructor')).toBe('constructor');
  });

  it('aliases point only at current topics (or null) and are never current ids', () => {
    for (const [from, to] of Object.entries(TOPIC_ALIASES)) {
      expect(TOPIC_ORDER).not.toContain(from);
      if (to !== null) expect(TOPIC_ORDER).toContain(to);
    }
    expect(canonicalTopicId('arrays-2d')).toBe('arrays');
    expect(canonicalTopicId('two-pointers')).toBe('arrays');
    expect(canonicalTopicId('sliding-window')).toBe('arrays');
    expect(canonicalTopicId('miscellaneous')).toBeNull();
    expect(canonicalTopicId('trees')).toBe('trees');
    expect(canonicalTopicId('toString')).toBe('toString');
  });
});

describe('compareTopics / sortTopics', () => {
  it('sorts known topics in learning order', () => {
    expect(
      sortTopics(['dynamic-programming', 'trees', 'arrays', 'hashing']),
    ).toEqual(['arrays', 'hashing', 'trees', 'dynamic-programming']);
    expect(sortTopics([...TOPIC_ORDER].reverse())).toEqual([...TOPIC_ORDER]);
  });

  it('puts unknown topics after known ones, alphabetically', () => {
    expect(
      sortTopics(['zeta', 'dynamic-programming', 'alpha', 'arrays']),
    ).toEqual(['arrays', 'dynamic-programming', 'alpha', 'zeta']);
    expect(compareTopics('x', 'x')).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = ['trees', 'arrays'];
    sortTopics(input);
    expect(input).toEqual(['trees', 'arrays']);
  });
});
