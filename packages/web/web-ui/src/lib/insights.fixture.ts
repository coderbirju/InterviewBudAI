/**
 * Test fixtures for `GET /api/insights` (ADR 0012 D3), in the ADR's exact
 * shape. Test-only: imported by specs, never by app code.
 */
import type { InsightsResponse, InsightsTopic } from './api';

/** The 13 curriculum topics in `TOPIC_ORDER` with their `TOPIC_LABELS`. */
export const TOPIC_FIXTURE: readonly [string, string][] = [
  ['arrays', 'Arrays'],
  ['binary-search', 'Binary Search'],
  ['sorting', 'Sorting'],
  ['hashing', 'Hashing'],
  ['linked-list', 'Linked List'],
  ['stack', 'Stack & Queue'],
  ['heap', 'Heap'],
  ['recursion', 'Recursion'],
  ['backtracking', 'Backtracking'],
  ['trees', 'Trees'],
  ['graphs', 'Graphs'],
  ['greedy', 'Greedy'],
  ['dynamic-programming', 'Dynamic Programming'],
];

const TOPICS: readonly InsightsTopic[] = TOPIC_FIXTURE.map(
  ([topicId, label], i) => ({ topicId, label, done: i % 4, total: 10 + i }),
);

export const INSIGHTS_LOCKED: InsightsResponse = {
  state: 'locked',
  generatedAt: '2026-09-30T12:00:00.000Z',
  sessions: { counted: 1, required: 2 },
  status: {
    done: 12,
    toRevisit: 3,
    didNotUnderstand: 1,
    notStarted: 140,
    total: 156,
  },
  topics: TOPICS,
  focus: [],
  slips: [],
  strengths: [],
};

export const INSIGHTS_UNLOCKED: InsightsResponse = {
  ...INSIGHTS_LOCKED,
  state: 'unlocked',
  sessions: { counted: 3, required: 2 },
  focus: [
    {
      topicId: 'graphs',
      label: 'Graphs',
      band: 'weak',
      reason: '4 of 6 quiz answers missed · 2 to revisit',
    },
    {
      topicId: 'trees',
      label: 'Trees',
      band: 'improving',
      reason: '1 to revisit',
    },
  ],
  slips: [
    {
      code: 'edge',
      label: 'Missed edge cases',
      count: 5,
      lastSeen: '2026-09-29T18:00:00.000Z',
      topics: [
        { topicId: 'trees', label: 'Trees', count: 3 },
        { topicId: 'graphs', label: 'Graphs', count: 2 },
      ],
    },
  ],
  strengths: [{ topicId: 'arrays', label: 'Arrays', correct: 7, incorrect: 1 }],
};

export const INSIGHTS_NO_DB: InsightsResponse = {
  state: 'no_db',
  generatedAt: '2026-09-30T12:00:00.000Z',
  sessions: { counted: 0, required: 2 },
  status: {
    done: 0,
    toRevisit: 0,
    didNotUnderstand: 0,
    notStarted: 0,
    total: 0,
  },
  topics: TOPICS.map((t) => ({ ...t, done: 0, total: 0 })),
  focus: [],
  slips: [],
  strengths: [],
};
