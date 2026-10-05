import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseCsv,
  toCsv,
  parseTrafficCsv,
  parseDownloadsCsv,
  trafficRowsFromApi,
  downloadRowsFromReleases,
  mergeTraffic,
  mergeDownloads,
  classifyTrafficStatus,
  fetchTraffic,
  skipMessages,
  runMerge,
  main,
  MISSING_TOKEN_NOTICE,
  DATA_README,
} from './merge-metrics.mjs';

// Canned API JSON (shapes as returned by GitHub's REST API).
const day = (d) => `2026-10-${String(d).padStart(2, '0')}T00:00:00Z`;
const clonesJson = (entries) => ({
  count: entries.reduce((s, e) => s + e[1], 0),
  uniques: 0,
  clones: entries.map(([d, count, uniques]) => ({
    timestamp: day(d),
    count,
    uniques,
  })),
});
const viewsJson = (entries) => ({
  count: entries.reduce((s, e) => s + e[1], 0),
  uniques: 0,
  views: entries.map(([d, count, uniques]) => ({
    timestamp: day(d),
    count,
    uniques,
  })),
});
const row = (d, clones, uc, views, uv) => ({
  date: `2026-10-${String(d).padStart(2, '0')}`,
  clones,
  unique_clones: uc,
  views,
  unique_views: uv,
});

function jsonResponse(status, body) {
  return { status, json: async () => body };
}

describe('CSV', () => {
  it('round-trips quoted fields', () => {
    const text = toCsv(
      ['a', 'b'],
      [
        ['x,y', 'say "hi"'],
        ['plain', ''],
      ],
    );
    expect(text).toBe('a,b\n"x,y","say ""hi"""\nplain,\n');
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x,y', 'say "hi"'],
      ['plain', ''],
    ]);
  });

  it('parses CRLF and empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('rejects a bad header, a malformed row and a negative count', () => {
    expect(() => parseTrafficCsv('date,clones\n')).toThrow(/header/);
    expect(() =>
      parseTrafficCsv(
        'date,clones,unique_clones,views,unique_views\n2026-10-01,1,1\n',
      ),
    ).toThrow(/line 2/);
    expect(() =>
      parseDownloadsCsv(
        'date,tag,asset,download_count\n2026-10-01,v0.1.0,a.zip,-1\n',
      ),
    ).toThrow(/count/);
  });
});

describe('trafficRowsFromApi', () => {
  it('combines clones and views per UTC date', () => {
    const rows = trafficRowsFromApi(
      clonesJson([
        [1, 5, 2],
        [2, 3, 1],
      ]),
      viewsJson([
        [1, 10, 4],
        [2, 7, 3],
      ]),
    );
    expect(rows).toEqual([row(1, 5, 2, 10, 4), row(2, 3, 1, 7, 3)]);
  });

  it('zero-fills a date that has only clones or only views', () => {
    const rows = trafficRowsFromApi(
      clonesJson([[1, 5, 2]]),
      viewsJson([[2, 7, 3]]),
    );
    expect(rows).toEqual([row(1, 5, 2, 0, 0), row(2, 0, 0, 7, 3)]);
  });

  it('rejects malformed responses', () => {
    expect(() => trafficRowsFromApi({}, viewsJson([]))).toThrow(/clones/);
    expect(() =>
      trafficRowsFromApi(
        { clones: [{ timestamp: 'nope', count: 1, uniques: 1 }] },
        viewsJson([]),
      ),
    ).toThrow(/timestamp/);
    expect(() =>
      trafficRowsFromApi(clonesJson([]), {
        views: [{ timestamp: day(1), count: -1, uniques: 0 }],
      }),
    ).toThrow(/malformed/);
  });
});

describe('mergeTraffic', () => {
  it('replaces rows with the same date and keeps every older row', () => {
    const stored = [row(1, 1, 1, 1, 1), row(2, 2, 2, 2, 2), row(3, 3, 3, 3, 3)];
    // New window starts at day 2 (oldest), day 3 changed, day 4 is new.
    const fetched = [
      row(2, 2, 2, 2, 2),
      row(3, 9, 4, 1, 1),
      row(4, 4, 4, 4, 4),
    ];
    expect(mergeTraffic(stored, fetched)).toEqual([
      row(1, 1, 1, 1, 1),
      row(2, 2, 2, 2, 2),
      row(3, 9, 4, 1, 1),
      row(4, 4, 4, 4, 4),
    ]);
  });

  it('keeps the per-field max on the oldest fetched date only', () => {
    const stored = [row(1, 10, 5, 3, 1), row(2, 8, 4, 8, 4)];
    const fetched = [row(1, 4, 6, 2, 2), row(2, 1, 1, 1, 1)];
    expect(mergeTraffic(stored, fetched)).toEqual([
      row(1, 10, 6, 3, 2), // oldest: max per field
      row(2, 1, 1, 1, 1), // not oldest: replaced, even though smaller
    ]);
  });

  it('takes the fetched oldest row as-is when nothing is stored for it', () => {
    expect(mergeTraffic([], [row(5, 1, 1, 0, 0)])).toEqual([
      row(5, 1, 1, 0, 0),
    ]);
  });

  it('is idempotent and sorted', () => {
    const stored = [row(3, 3, 3, 3, 3), row(1, 1, 1, 1, 1)];
    const fetched = [row(4, 4, 4, 4, 4), row(2, 2, 2, 2, 2)];
    const once = mergeTraffic(stored, fetched);
    expect(once.map((r) => r.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(mergeTraffic(once, fetched)).toEqual(once);
  });

  it('leaves stored rows unchanged when traffic was skipped', () => {
    const stored = [row(1, 1, 1, 1, 1)];
    expect(mergeTraffic(stored, [])).toEqual(stored);
  });
});

describe('downloads', () => {
  const releasesPage1 = [
    {
      tag_name: 'v0.2.0',
      draft: false,
      assets: [{ name: 'interviewbudai-v0.2.0.zip', download_count: 7 }],
    },
    {
      tag_name: 'v0.3.0-draft',
      draft: true,
      assets: [{ name: 'x.zip', download_count: 0 }],
    },
  ];
  const releasesPage2 = [
    {
      tag_name: 'v0.1.0',
      draft: false,
      assets: [{ name: 'interviewbudai-v0.1.0.zip', download_count: 40 }],
    },
  ];

  it('flattens paginated (--slurp) releases and skips drafts', () => {
    expect(
      downloadRowsFromReleases([releasesPage1, releasesPage2], '2026-10-04'),
    ).toEqual([
      {
        date: '2026-10-04',
        tag: 'v0.1.0',
        asset: 'interviewbudai-v0.1.0.zip',
        download_count: 40,
      },
      {
        date: '2026-10-04',
        tag: 'v0.2.0',
        asset: 'interviewbudai-v0.2.0.zip',
        download_count: 7,
      },
    ]);
  });

  it('accepts a single page and an empty list', () => {
    expect(downloadRowsFromReleases(releasesPage2, '2026-10-04')).toHaveLength(
      1,
    );
    expect(downloadRowsFromReleases([], '2026-10-04')).toEqual([]);
    expect(downloadRowsFromReleases([[]], '2026-10-04')).toEqual([]);
  });

  it('rejects malformed releases', () => {
    expect(() => downloadRowsFromReleases({}, '2026-10-04')).toThrow();
    expect(() =>
      downloadRowsFromReleases(
        [{ tag_name: 'v1', assets: [{ name: 'a' }] }],
        '2026-10-04',
      ),
    ).toThrow(/asset/);
  });

  it('replaces a same-day snapshot and keeps older days', () => {
    const stored = [
      { date: '2026-10-03', tag: 'v0.1.0', asset: 'a.zip', download_count: 1 },
      { date: '2026-10-04', tag: 'v0.1.0', asset: 'a.zip', download_count: 2 },
    ];
    const fetched = [
      { date: '2026-10-04', tag: 'v0.1.0', asset: 'a.zip', download_count: 3 },
    ];
    const merged = mergeDownloads(stored, fetched);
    expect(merged).toEqual([stored[0], fetched[0]]);
    expect(mergeDownloads(merged, fetched)).toEqual(merged);
  });
});

describe('traffic token handling', () => {
  it('classifies statuses: 2xx ok, 401/403 skip, others fail', () => {
    expect(classifyTrafficStatus(200)).toBe('ok');
    expect(classifyTrafficStatus(401)).toBe('skip');
    expect(classifyTrafficStatus(403)).toBe('skip');
    expect(classifyTrafficStatus(404)).toBe('fail');
    expect(classifyTrafficStatus(500)).toBe('fail');
  });

  it('skips without calling the API when the token is missing or empty', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return jsonResponse(200, {});
    };
    for (const token of [undefined, '', '  ']) {
      expect(await fetchTraffic({ token, repo: 'o/r', fetchImpl })).toEqual({
        status: 'skipped',
        reason: 'missing-token',
      });
    }
    expect(calls).toEqual([]);
  });

  it('skips on 401/403 and fails on other errors', async () => {
    for (const status of [401, 403]) {
      expect(
        await fetchTraffic({
          token: 't',
          repo: 'o/r',
          fetchImpl: async () => jsonResponse(status, {}),
        }),
      ).toEqual({
        status: 'skipped',
        reason: 'unauthorized',
        httpStatus: status,
      });
    }
    await expect(
      fetchTraffic({
        token: 't',
        repo: 'o/r',
        fetchImpl: async () => jsonResponse(502, {}),
      }),
    ).rejects.toThrow(/HTTP 502/);
  });

  it('sends the token only as a Bearer header to the traffic endpoints', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      return jsonResponse(
        200,
        url.includes('/clones')
          ? clonesJson([[1, 1, 1]])
          : viewsJson([[1, 2, 1]]),
      );
    };
    const result = await fetchTraffic({
      token: 'secret',
      repo: 'o/r',
      fetchImpl,
    });
    expect(result.status).toBe('ok');
    expect(calls).toEqual([
      {
        url: 'https://api.github.com/repos/o/r/traffic/clones?per=day',
        auth: 'Bearer secret',
      },
      {
        url: 'https://api.github.com/repos/o/r/traffic/views?per=day',
        auth: 'Bearer secret',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('prints the notice for a missing token and a warning for 401/403', () => {
    expect(skipMessages({ reason: 'missing-token' }).annotation).toBe(
      MISSING_TOKEN_NOTICE,
    );
    expect(
      skipMessages({ reason: 'unauthorized', httpStatus: 401 }).annotation,
    ).toMatch(/^::warning::.*401/);
  });
});

describe('files (runMerge / main)', () => {
  let tmp;
  let apiDir;
  let dataDir;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-metrics-'));
    apiDir = path.join(tmp, 'api');
    dataDir = path.join(tmp, 'data');
    fs.mkdirSync(apiDir);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const writeApi = (name, body) =>
    fs.writeFileSync(path.join(apiDir, name), JSON.stringify(body));
  const releases = [
    [{ tag_name: 'v0.1.0', assets: [{ name: 'a.zip', download_count: 3 }] }],
  ];

  it('creates the files on the first run and is idempotent', () => {
    writeApi('clones.json', clonesJson([[1, 2, 1]]));
    writeApi('views.json', viewsJson([[2, 5, 2]]));
    writeApi('releases.json', releases);
    runMerge({ dataDir, apiDir, date: '2026-10-04' });
    const read = (f) => fs.readFileSync(path.join(dataDir, f), 'utf8');
    const traffic = read('traffic.csv');
    expect(traffic).toBe(
      'date,clones,unique_clones,views,unique_views\n2026-10-01,2,1,0,0\n2026-10-02,0,0,5,2\n',
    );
    expect(read('downloads.csv')).toBe(
      'date,tag,asset,download_count\n2026-10-04,v0.1.0,a.zip,3\n',
    );
    expect(read('README.md')).toBe(DATA_README);
    runMerge({ dataDir, apiDir, date: '2026-10-04' });
    expect(read('traffic.csv')).toBe(traffic);
  });

  it('records downloads only when traffic was skipped', () => {
    writeApi('releases.json', releases);
    runMerge({ dataDir, apiDir, date: '2026-10-04' });
    expect(fs.readFileSync(path.join(dataDir, 'traffic.csv'), 'utf8')).toBe(
      'date,clones,unique_clones,views,unique_views\n',
    );
  });

  it('fails when only one traffic file exists or the date is bad', () => {
    writeApi('releases.json', releases);
    expect(() => runMerge({ dataDir, apiDir, date: '2026-13' })).toThrow(
      /date/,
    );
    writeApi('clones.json', clonesJson([]));
    expect(() => runMerge({ dataDir, apiDir, date: '2026-10-04' })).toThrow(
      /only one/,
    );
  });

  it('fetch-traffic: notice + job summary and no files when the token is missing', async () => {
    const summary = path.join(tmp, 'summary.md');
    const lines = [];
    const r = await main(['fetch-traffic', '--out', apiDir], {
      env: { GITHUB_REPOSITORY: 'o/r', GITHUB_STEP_SUMMARY: summary },
      fetchImpl: async () => {
        throw new Error('no network in tests');
      },
      log: (l) => lines.push(l),
    });
    expect(r.status).toBe('skipped');
    expect(lines).toEqual([MISSING_TOKEN_NOTICE]);
    expect(fs.readFileSync(summary, 'utf8')).toMatch(/METRICS_TOKEN/);
    expect(fs.readdirSync(apiDir)).toEqual([]);
  });

  it('fetch-traffic: writes clones.json and views.json on success', async () => {
    await main(['fetch-traffic', '--out', apiDir], {
      env: { METRICS_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' },
      fetchImpl: async (url) =>
        jsonResponse(
          200,
          url.includes('/clones') ? clonesJson([[1, 1, 1]]) : viewsJson([]),
        ),
      log: () => {},
    });
    expect(fs.readdirSync(apiDir).sort()).toEqual([
      'clones.json',
      'views.json',
    ]);
  });
});
