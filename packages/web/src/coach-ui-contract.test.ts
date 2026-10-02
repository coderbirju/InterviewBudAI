/**
 * Contract check: REAL route responses through the UI clients' normalizers.
 *
 * Both normalizers are the REAL UI clients' (imported): `normalizeCheckResult`
 * from `lib/intuitionCheck.ts`, `normalizePractice` from `lib/api.ts`.
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
import { normalizeCheckResult } from '../web-ui/src/lib/intuitionCheck.js';
import type { IntuitionCheckErrorCode } from '../web-ui/src/lib/intuitionCheck.js';
import { normalizePractice } from '../web-ui/src/lib/api.js';

// ------------------------------- field lists --------------------------------

/** Every `IntuitionCheckErrorCode` of the check client. */
const ERROR_CODES: readonly IntuitionCheckErrorCode[] = [
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
