/**
 * Contract check: REAL route responses through the UI clients' normalizers.
 *
 * The clients live on unmerged branches, so they cannot be imported yet. The
 * normalizers and the field/code lists below are copied VERBATIM (types
 * trimmed) from:
 *   - origin/feature/intuition-check-ui:
 *       packages/web/web-ui/src/lib/intuitionCheck.ts  (normalizeCheckResult,
 *       ERROR_CODES)
 *   - origin/feature/practice-analytics-ui:
 *       packages/web/web-ui/src/lib/api.ts  (normalizePractice, resetPractice)
 * When those land, replace this copy with imports from `../web-ui/src/lib`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import type { LlmProvider } from '@ibai/providers';
import { handleApiRoute } from './api.js';
import type { ApiDeps } from './api.js';
import { createCoachLimiter } from './coach-routes.js';

// --------------------------- copied client code ----------------------------

type CoachAssessment = 'on_track' | 'partial' | 'off_track';
const ASSESSMENTS: readonly CoachAssessment[] = [
  'on_track',
  'partial',
  'off_track',
];
/** `IntuitionCheckErrorCode` of the check client. */
const ERROR_CODES = [
  'empty_note',
  'invalid_body',
  'no_provider',
  'rate_limited',
  'model_unavailable',
];
/** Every field `IntuitionCheckResult` declares. */
const CHECK_RESULT_FIELDS = [
  'assessment',
  'questions',
  'readyToCode',
  'note',
  'miss',
  'missLabel',
  'firstCheck',
  'truncated',
  'checkedAt',
  'recorded',
];
/** Every field `PracticeResponse` declares. */
const PRACTICE_FIELDS = [
  'state',
  'generatedAt',
  'totals',
  'firstCheck',
  'slips',
  'fixedAfterRecheck',
  'readyToCodeFirstTry',
  'since',
];

function normalizeCheckResult(raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const assessment = data.assessment;
  if (
    typeof assessment !== 'string' ||
    !ASSESSMENTS.includes(assessment as CoachAssessment)
  ) {
    return null;
  }
  const questions = Array.isArray(data.questions)
    ? data.questions
        .filter((q): q is string => typeof q === 'string' && q.trim() !== '')
        .slice(0, 3)
    : [];
  const truncatedRaw =
    typeof data.truncated === 'object' && data.truncated !== null
      ? (data.truncated as Record<string, unknown>)
      : {};
  const hasMiss =
    typeof data.miss === 'string' && typeof data.missLabel === 'string';
  return {
    assessment: assessment as CoachAssessment,
    questions,
    readyToCode: assessment === 'on_track' && data.readyToCode === true,
    note: typeof data.note === 'string' ? data.note : '',
    ...(hasMiss && {
      miss: data.miss as string,
      missLabel: data.missLabel as string,
    }),
    firstCheck: data.firstCheck === true,
    truncated: {
      note: truncatedRaw.note === true,
      reference: truncatedRaw.reference === true,
      statement: truncatedRaw.statement === true,
    },
    checkedAt: typeof data.checkedAt === 'string' ? data.checkedAt : '',
    recorded: data.recorded === true,
  };
}

function countOf(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}
function ratioOf(raw: unknown) {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return { count: countOf(o.count), of: countOf(o.of) };
}
function isPracticeSlip(s: unknown): s is Record<string, unknown> & {
  code: string;
} {
  if (typeof s !== 'object' || s === null) {
    return false;
  }
  const o = s as Record<string, unknown>;
  return typeof o.code === 'string' && o.code !== '';
}
function isSlipTopic(t: unknown): t is Record<string, unknown> & {
  topicId: string;
} {
  return (
    typeof t === 'object' &&
    t !== null &&
    typeof (t as Record<string, unknown>).topicId === 'string' &&
    (t as Record<string, unknown>).topicId !== ''
  );
}
function normalizePractice(raw: unknown) {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const state = o.state === 'ready' || o.state === 'no_db' ? o.state : 'empty';
  const ready = state === 'ready';
  const t = (
    typeof o.totals === 'object' && o.totals !== null ? o.totals : {}
  ) as Record<string, unknown>;
  const fc = (
    typeof o.firstCheck === 'object' && o.firstCheck !== null
      ? o.firstCheck
      : {}
  ) as Record<string, unknown>;
  const slips =
    ready && Array.isArray(o.slips)
      ? o.slips.filter(isPracticeSlip).map((s) => ({
          code: s.code,
          label: typeof s.label === 'string' ? s.label : '',
          count: countOf(s.count),
          topics: Array.isArray(s.topics)
            ? s.topics.filter(isSlipTopic).map((tp) => ({
                topicId: tp.topicId,
                label: typeof tp.label === 'string' ? tp.label : '',
                count: countOf(tp.count),
              }))
            : [],
        }))
      : [];
  return {
    state,
    generatedAt: typeof o.generatedAt === 'string' ? o.generatedAt : '',
    totals: {
      checks: countOf(t.checks),
      problems: countOf(t.problems),
      windowEvents: countOf(t.windowEvents),
      windowCap: countOf(t.windowCap),
    },
    firstCheck: {
      on_track: countOf(fc.on_track),
      partial: countOf(fc.partial),
      off_track: countOf(fc.off_track),
    },
    slips,
    fixedAfterRecheck: ratioOf(o.fixedAfterRecheck),
    readyToCodeFirstTry: ratioOf(o.readyToCodeFirstTry),
    since: typeof o.since === 'string' && o.since !== '' ? o.since : null,
  };
}

// ------------------------------- the checks --------------------------------

const CATALOG = createCatalogSource();
const PROBLEM = CATALOG.list()[0]!;
const NOW = new Date('2026-10-01T12:00:00.000Z');
let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-coach-ui-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function provider(reply: string): LlmProvider {
  return { complete: async () => ({ content: reply }) };
}
let clock = 0;
function deps(extra: Partial<ApiDeps> = {}): ApiDeps {
  return {
    catalog: CATALOG,
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    storage: new LocalFileStorageAdapter(tmpDir),
    dataDir: tmpDir,
    now: () => NOW,
    coachLimiter: createCoachLimiter({ clock: () => (clock += 10_000) }),
    ...extra,
  };
}
const post = (d: ApiDeps, body: unknown) =>
  handleApiRoute(
    'POST',
    `/api/notes/${PROBLEM.id}/check`,
    d,
    JSON.stringify(body),
  );

describe('server ↔ UI client contract (ADR 0013 D2/D3)', () => {
  it('check 200 bodies survive normalizeCheckResult unchanged', async () => {
    const replies = [
      {
        assessment: 'partial',
        questions: ['What does n ≤ 1e5 suggest?'],
        readyToCode: false,
        note: 'Close.',
        miss: 'edge',
      },
      { assessment: 'on_track', questions: [], readyToCode: true, note: '' },
      {
        assessment: 'off_track',
        questions: ['Is O(n^2) fast enough?', 'What about empty input?'],
        note: 'Too slow.',
        miss: 'complexity',
      },
    ];
    for (const r of replies) {
      const res = await post(deps({ provider: provider(JSON.stringify(r)) }), {
        content: 'n'.repeat(3000),
        referenceApproach: 'mine',
      });
      expect(res.status).toBe(200);
      const raw = JSON.parse(res.body) as Record<string, unknown>;
      for (const key of Object.keys(raw)) {
        expect(CHECK_RESULT_FIELDS).toContain(key);
      }
      expect(normalizeCheckResult(raw)).toEqual(raw);
    }
  });

  it('every check error code is one the client knows', async () => {
    const bodies = [
      await post(deps({ provider: provider('{}') }), { content: '' }),
      await post(deps({ provider: provider('{}') }), { content: 3 }),
      await post(deps(), { content: 'a' }),
    ];
    const rateLimited = deps({
      provider: provider('{}'),
      coachLimiter: createCoachLimiter({ clock: () => 0 }),
    });
    await post(rateLimited, { content: 'a' });
    bodies.push(await post(rateLimited, { content: 'a' }));
    bodies.push(
      await post(
        deps({
          provider: {
            complete: async () => {
              throw new Error('fetch failed');
            },
          },
        }),
        { content: 'a' },
      ),
    );
    const codes = bodies.map((b) => {
      const parsed = JSON.parse(b.body) as { code?: string; error: unknown };
      expect(typeof parsed.error).toBe('string');
      return parsed.code;
    });
    expect(codes).toEqual([
      'empty_note',
      'invalid_body',
      'no_provider',
      'rate_limited',
      'model_unavailable',
    ]);
    for (const c of codes) expect(ERROR_CODES).toContain(c);
  });

  it('practice bodies survive normalizePractice unchanged (no_db, empty, ready)', async () => {
    const get = async (d: ApiDeps) =>
      JSON.parse(
        (await handleApiRoute('GET', '/api/practice', d, undefined)).body,
      ) as Record<string, unknown>;
    const noDb = await get(deps({ dataDir: path.join(tmpDir, 'missing') }));
    const empty = await get(deps());
    await post(
      deps({
        provider: provider(
          JSON.stringify({
            assessment: 'partial',
            questions: ['Why?'],
            miss: 'vague',
          }),
        ),
      }),
      { content: 'a' },
    );
    const ready = await get(deps());
    expect([noDb.state, empty.state, ready.state]).toEqual([
      'no_db',
      'empty',
      'ready',
    ]);
    for (const raw of [noDb, empty, ready]) {
      expect(Object.keys(raw).sort()).toEqual([...PRACTICE_FIELDS].sort());
      expect(normalizePractice(raw)).toEqual(raw);
    }
  });

  it('reset bodies carry what resetPractice reads (backup, error, code)', async () => {
    const ok = await handleApiRoute(
      'POST',
      '/api/practice/reset',
      deps({ backup: async () => '/b/1' }),
      JSON.stringify({ confirm: 'reset-practice' }),
    );
    expect(JSON.parse(ok.body)).toEqual({ reset: true, backup: '/b/1' });
    const bad = await handleApiRoute(
      'POST',
      '/api/practice/reset',
      deps(),
      JSON.stringify({ confirm: 'x' }),
    );
    const body = JSON.parse(bad.body) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect(body.code).toBe('invalid_body');
  });
});
