/**
 * The one-off importer's topic mapping (scripts/topic-mapping.ts) reproduces
 * the shipped catalog's `topics` for every problem. The founder's Notion export
 * is not in the repo, so the importer's SOURCE data is captured below as each
 * problem's Notion folder(s) — derived from the catalog as imported (pre-#69
 * topics, inverted through the original folder map; `DP` and `DP - HARD` both
 * mapped to dynamic-programming, so `DP` stands for either). Identity data only.
 */

import { describe, it, expect } from 'vitest';
import { CATALOG } from './catalog.js';
import { TOPIC_ORDER } from './topic-order.js';
import {
  FOLDER_TOPIC_MAP,
  PROBLEM_TOPIC_OVERRIDES,
  mapTopics,
} from '../scripts/topic-mapping.js';

/** Problem id -> Notion folder(s) it was imported from. */
const SOURCE_FOLDERS: Readonly<Record<string, readonly string[]>> = {
  'lc-3': ['Sliding Window'],
  'lc-4': ['Problems'],
  'lc-11': ['Sliding Window'],
  'lc-17': ['Recursion'],
  'lc-19': ['Linked List'],
  'lc-21': ['Linked List'],
  'lc-23': ['Heap'],
  'lc-25': ['Linked List'],
  'lc-26': ['Binary Search'],
  'lc-31': ['Problems'],
  'lc-32': ['Stack and Queue'],
  'lc-33': ['Binary Search'],
  'lc-34': ['Binary Search'],
  'lc-36': ['Hashing'],
  'lc-39': ['Recursion'],
  'lc-42': ['Two Pointers'],
  'lc-44': ['Recursion'],
  'lc-46': ['Recursion'],
  'lc-47': ['Recursion'],
  'lc-53': ['Arrays 2D'],
  'lc-54': ['Arrays 2D'],
  'lc-62': ['DP'],
  'lc-70': ['DP'],
  'lc-72': ['DP'],
  'lc-74': ['Binary Search'],
  'lc-75': ['Sorting'],
  'lc-77': ['Recursion'],
  'lc-78': ['Recursion'],
  'lc-79': ['Trees'],
  'lc-84': ['Stack and Queue'],
  'lc-91': ['DP'],
  'lc-92': ['Linked List'],
  'lc-100': ['Trees'],
  'lc-102': ['Trees'],
  'lc-104': ['Trees'],
  'lc-105': ['Trees'],
  'lc-106': ['Trees'],
  'lc-110': ['Trees'],
  'lc-112': ['Trees'],
  'lc-113': ['Trees'],
  'lc-118': ['Arrays 2D'],
  'lc-121': ['DP'],
  'lc-122': ['DP'],
  'lc-123': ['DP'],
  'lc-127': ['Graphs'],
  'lc-128': ['Hashing'],
  'lc-132': ['DP'],
  'lc-135': ['Greedy'],
  'lc-141': ['Linked List'],
  'lc-142': ['Linked List'],
  'lc-148': ['Linked List'],
  'lc-149': ['Hashing'],
  'lc-150': ['Stack and Queue'],
  'lc-155': ['Stack and Queue'],
  'lc-162': ['Binary Search'],
  'lc-167': ['Two Pointers'],
  'lc-172': ['Binary Search'],
  'lc-188': ['DP'],
  'lc-199': ['Trees'],
  'lc-203': ['Linked List'],
  'lc-206': ['Linked List'],
  'lc-207': ['Graphs'],
  'lc-208': ['Trees'],
  'lc-209': ['Arrays 2D', 'Sliding Window'],
  'lc-210': ['Graphs'],
  'lc-211': ['Trees'],
  'lc-212': ['Trees'],
  'lc-215': ['Sorting'],
  'lc-219': ['Sliding Window'],
  'lc-224': ['Stack and Queue'],
  'lc-225': ['Stack and Queue'],
  'lc-226': ['Trees'],
  'lc-232': ['Stack and Queue'],
  'lc-234': ['Linked List'],
  'lc-235': ['Trees'],
  'lc-237': ['Linked List'],
  'lc-239': ['Stack and Queue'],
  'lc-242': ['Hashing'],
  'lc-253': ['Heap'],
  'lc-264': ['Hashing'],
  'lc-269': ['Graphs'],
  'lc-272': ['Trees'],
  'lc-295': ['Heap'],
  'lc-300': ['DP'],
  'lc-304': ['Arrays 2D'],
  'lc-307': ['Trees'],
  'lc-309': ['DP'],
  'lc-312': ['DP'],
  'lc-319': ['Greedy'],
  'lc-322': ['DP'],
  'lc-336': ['Hashing'],
  'lc-347': ['Heap'],
  'lc-354': ['DP'],
  'lc-368': ['DP'],
  'lc-373': ['Heap'],
  'lc-402': ['Stack and Queue'],
  'lc-403': ['DP'],
  'lc-404': ['Trees'],
  'lc-406': ['Trees'],
  'lc-416': ['DP'],
  'lc-424': ['Sliding Window'],
  'lc-435': ['Greedy'],
  'lc-437': ['Trees'],
  'lc-474': ['DP'],
  'lc-493': ['Problems'],
  'lc-503': ['Stack and Queue'],
  'lc-516': ['DP'],
  'lc-518': ['DP'],
  'lc-525': ['Hashing'],
  'lc-532': ['Two Pointers'],
  'lc-540': ['Binary Search'],
  'lc-542': ['Arrays 2D'],
  'lc-547': ['Graphs'],
  'lc-560': ['Hashing'],
  'lc-628': ['Greedy'],
  'lc-658': ['Two Pointers'],
  'lc-669': ['Trees'],
  'lc-670': ['Greedy'],
  'lc-682': ['Stack and Queue'],
  'lc-684': ['Graphs'],
  'lc-700': ['Trees'],
  'lc-714': ['DP'],
  'lc-721': ['Graphs'],
  'lc-728': ['Problems'],
  'lc-739': ['Stack and Queue'],
  'lc-743': ['Graphs'],
  'lc-769': ['Sorting'],
  'lc-787': ['Graphs'],
  'lc-793': ['Binary Search'],
  'lc-802': ['Graphs'],
  'lc-814': ['Trees'],
  'lc-844': ['Stack and Queue'],
  'lc-847': ['DP'],
  'lc-867': ['Arrays 2D'],
  'lc-875': ['Binary Search'],
  'lc-876': ['Linked List'],
  'lc-907': ['Stack and Queue'],
  'lc-918': ['Arrays 2D'],
  'lc-973': ['Heap'],
  'lc-978': ['Arrays 2D'],
  'lc-994': ['Graphs'],
  'lc-1005': ['Greedy'],
  'lc-1011': ['Binary Search'],
  'lc-1020': ['Graphs'],
  'lc-1048': ['DP'],
  'lc-1049': ['DP'],
  'lc-1091': ['Graphs'],
  'lc-1106': ['DP'],
  'lc-1130': ['Trees'],
  'lc-1135': ['Graphs'],
  'lc-1143': ['DP'],
  'lc-1200': ['Sorting'],
  'lc-1231': ['Binary Search'],
  'lc-1249': ['Stack and Queue'],
  'lc-1290': ['Linked List'],
  'lc-1310': ['Arrays 2D'],
  'lc-1312': ['DP'],
  'lc-1334': ['Graphs'],
  'lc-1343': ['Sliding Window'],
  'lc-1351': ['Problems'],
  'lc-1382': ['Trees'],
  'lc-1462': ['Graphs'],
  'lc-1480': ['Arrays 2D'],
  'lc-1482': ['Binary Search'],
  'lc-1489': ['Graphs'],
  'lc-1582': ['Arrays 2D'],
  'lc-1584': ['Graphs'],
  'lc-1654': ['DP'],
  'lc-1870': ['Binary Search'],
  'lc-1922': ['Recursion'],
  'lc-1976': ['Graphs'],
  'lc-2130': ['Linked List'],
  'lc-2407': ['Trees'],
  'lc-2594': ['Binary Search'],
  'lc-3532': ['Problems'],
};

describe('importer topic mapping (13-topic taxonomy)', () => {
  it('source snapshot covers exactly the 175 catalog problems', () => {
    expect(CATALOG).toHaveLength(175);
    expect(Object.keys(SOURCE_FOLDERS).sort()).toEqual(
      CATALOG.map((p) => p.id).sort(),
    );
  });

  it('reproduces the current catalog topics for every problem', () => {
    const mismatches: string[] = [];
    for (const problem of CATALOG) {
      const mapped = mapTopics(problem.id, SOURCE_FOLDERS[problem.id] ?? []);
      const got = mapped.ok ? mapped.topics.join(',') : `ERR:${mapped.reason}`;
      if (got !== problem.topics.join(',')) {
        mismatches.push(`${problem.id}: ${got} != ${problem.topics.join(',')}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('maps only to taxonomy topics', () => {
    const allowed = new Set(TOPIC_ORDER);
    for (const t of Object.values(FOLDER_TOPIC_MAP)) {
      if (t !== null) expect(allowed.has(t)).toBe(true);
    }
    for (const ts of Object.values(PROBLEM_TOPIC_OVERRIDES)) {
      for (const t of ts) expect(allowed.has(t)).toBe(true);
    }
  });

  it('every override is in the catalog and differs from its folder mapping', () => {
    const ids = new Set(CATALOG.map((p) => p.id));
    for (const [id, topics] of Object.entries(PROBLEM_TOPIC_OVERRIDES)) {
      expect(ids.has(id)).toBe(true);
      const byFolder = (SOURCE_FOLDERS[id] ?? []).map(
        (f) => FOLDER_TOPIC_MAP[f],
      );
      expect(byFolder.join(',')).not.toBe(topics.join(','));
    }
  });

  it('merges a problem found in several folders (lc-209) into one topic', () => {
    expect(mapTopics('lc-209', ['Arrays 2D', 'Sliding Window'])).toEqual({
      ok: true,
      topics: ['arrays'],
    });
  });

  it('reports an unknown folder and a topic-less folder without an override', () => {
    expect(mapTopics('lc-1', ['Mystery'])).toEqual({
      ok: false,
      reason: 'unknown-topic-folder',
      folder: 'Mystery',
    });
    expect(mapTopics('lc-1', ['Problems'])).toEqual({
      ok: false,
      reason: 'needs-override',
      folder: 'Problems',
    });
    expect(mapTopics('lc-4', ['Problems'])).toEqual({
      ok: true,
      topics: ['binary-search'],
    });
  });
});
