#!/usr/bin/env node
/**
 * Usage metrics for the repo (ADR 0016 D1). Node built-ins only.
 *
 *   node scripts/metrics/merge-metrics.mjs fetch-traffic --out <api-dir>
 *     Reads METRICS_TOKEN and GITHUB_REPOSITORY from the environment and
 *     writes <api-dir>/clones.json and <api-dir>/views.json. A missing token
 *     prints a notice, a 401/403 prints a warning; both skip traffic and exit
 *     0 (no files written). Any other error exits 1.
 *
 *   node scripts/metrics/merge-metrics.mjs merge --data-dir <dir> \
 *       --api-dir <api-dir> --date <YYYY-MM-DD>
 *     Merges <api-dir>/{clones,views,releases}.json into <dir>/traffic.csv
 *     and <dir>/downloads.csv and writes <dir>/README.md. Idempotent.
 *
 * The app itself never reports anything (ADR 0016 D3); this runs only in the
 * repo's own GitHub Actions workflow. Only aggregate counts are stored.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export const TRAFFIC_HEADER = [
  'date',
  'clones',
  'unique_clones',
  'views',
  'unique_views',
];
export const DOWNLOADS_HEADER = ['date', 'tag', 'asset', 'download_count'];
const TRAFFIC_FIELDS = TRAFFIC_HEADER.slice(1);

export const MISSING_TOKEN_NOTICE =
  '::notice::METRICS_TOKEN is not set; skipping traffic';

export const DATA_README = `# InterviewBudAI usage metrics

This branch holds data only and is never merged into \`main\`. The nightly
\`metrics\` workflow (ADR 0016) appends to it: \`traffic.csv\` has one row per
UTC day with GitHub's clone and view counts (\`date,clones,unique_clones,views,unique_views\`),
kept past GitHub's 14-day window; \`downloads.csv\` has one snapshot per day of
each release asset's cumulative download count (\`date,tag,asset,download_count\`).
Aggregate counts only: no user names, IPs or referrers.
`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// ---------------------------------------------------------------- CSV

function csvField(value) {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize rows (arrays of fields) with a header; LF line endings. */
export function toCsv(header, rows) {
  return (
    [header, ...rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n'
  );
}

/** Parse RFC 4180 CSV into arrays of strings. Empty input gives []. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += c;
    }
    i += 1;
  }
  if (quoted) throw new Error('CSV: unterminated quoted field');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function isCount(n) {
  return Number.isSafeInteger(n) && n >= 0;
}

function parseCount(s, where) {
  if (!/^\d+$/.test(s))
    throw new Error(`${where}: not a count: ${JSON.stringify(s)}`);
  const n = Number(s);
  if (!isCount(n)) throw new Error(`${where}: count out of range`);
  return n;
}

function checkHeader(rows, header, file) {
  if (rows.length === 0) return [];
  if (rows[0].join(',') !== header.join(',')) {
    throw new Error(
      `${file}: unexpected header ${JSON.stringify(rows[0].join(','))}`,
    );
  }
  return rows.slice(1);
}

/** Parse stored traffic.csv text into row objects. Throws on bad data. */
export function parseTrafficCsv(text) {
  return checkHeader(parseCsv(text), TRAFFIC_HEADER, 'traffic.csv').map(
    (r, i) => {
      const where = `traffic.csv line ${i + 2}`;
      if (r.length !== TRAFFIC_HEADER.length || !DATE_RE.test(r[0])) {
        throw new Error(`${where}: malformed row`);
      }
      const row = { date: r[0] };
      TRAFFIC_FIELDS.forEach((f, j) => {
        row[f] = parseCount(r[j + 1], where);
      });
      return row;
    },
  );
}

/** Parse stored downloads.csv text into row objects. Throws on bad data. */
export function parseDownloadsCsv(text) {
  return checkHeader(parseCsv(text), DOWNLOADS_HEADER, 'downloads.csv').map(
    (r, i) => {
      const where = `downloads.csv line ${i + 2}`;
      if (
        r.length !== DOWNLOADS_HEADER.length ||
        !DATE_RE.test(r[0]) ||
        !r[1] ||
        !r[2]
      ) {
        throw new Error(`${where}: malformed row`);
      }
      return {
        date: r[0],
        tag: r[1],
        asset: r[2],
        download_count: parseCount(r[3], where),
      };
    },
  );
}

export function trafficToCsv(rows) {
  return toCsv(
    TRAFFIC_HEADER,
    rows.map((r) => [r.date, ...TRAFFIC_FIELDS.map((f) => r[f])]),
  );
}

export function downloadsToCsv(rows) {
  return toCsv(
    DOWNLOADS_HEADER,
    rows.map((r) => [r.date, r.tag, r.asset, r.download_count]),
  );
}

// ---------------------------------------------------------------- API → rows

function utcDate(timestamp, where) {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : null;
  if (!d || Number.isNaN(d.getTime())) {
    throw new Error(`${where}: bad timestamp ${JSON.stringify(timestamp)}`);
  }
  return d.toISOString().slice(0, 10);
}

function dailyCounts(json, key) {
  const list = json && typeof json === 'object' ? json[key] : undefined;
  if (!Array.isArray(list))
    throw new Error(`traffic/${key}: missing "${key}" array`);
  const byDate = new Map();
  for (const e of list) {
    const where = `traffic/${key}`;
    if (
      !e ||
      typeof e !== 'object' ||
      !isCount(e.count) ||
      !isCount(e.uniques)
    ) {
      throw new Error(`${where}: malformed entry`);
    }
    byDate.set(utcDate(e.timestamp, where), {
      count: e.count,
      uniques: e.uniques,
    });
  }
  return byDate;
}

/**
 * Combine the clones and views responses (`?per=day`) into one row per UTC
 * date. A date in only one of them gets 0 for the other's two fields.
 */
export function trafficRowsFromApi(clonesJson, viewsJson) {
  const clones = dailyCounts(clonesJson, 'clones');
  const views = dailyCounts(viewsJson, 'views');
  const dates = [...new Set([...clones.keys(), ...views.keys()])].sort();
  return dates.map((date) => {
    const c = clones.get(date) ?? { count: 0, uniques: 0 };
    const v = views.get(date) ?? { count: 0, uniques: 0 };
    return {
      date,
      clones: c.count,
      unique_clones: c.uniques,
      views: v.count,
      unique_views: v.uniques,
    };
  });
}

/**
 * Flatten `gh api --paginate --slurp` output (an array of pages) or a single
 * page into release-asset snapshot rows for `date`. Drafts are skipped (not
 * downloadable).
 */
export function downloadRowsFromReleases(releasesJson, date) {
  if (!DATE_RE.test(date)) throw new Error(`bad date ${JSON.stringify(date)}`);
  if (!Array.isArray(releasesJson)) throw new Error('releases: not an array');
  const releases = releasesJson.every(Array.isArray)
    ? releasesJson.flat()
    : releasesJson;
  const rows = [];
  for (const rel of releases) {
    if (
      !rel ||
      typeof rel !== 'object' ||
      typeof rel.tag_name !== 'string' ||
      !rel.tag_name
    ) {
      throw new Error('releases: malformed release');
    }
    if (rel.draft === true) continue;
    if (!Array.isArray(rel.assets))
      throw new Error(`releases/${rel.tag_name}: no assets array`);
    for (const a of rel.assets) {
      if (
        !a ||
        typeof a.name !== 'string' ||
        !a.name ||
        !isCount(a.download_count)
      ) {
        throw new Error(`releases/${rel.tag_name}: malformed asset`);
      }
      rows.push({
        date,
        tag: rel.tag_name,
        asset: a.name,
        download_count: a.download_count,
      });
    }
  }
  return sortDownloads(dedupeDownloads(rows));
}

// ---------------------------------------------------------------- merge

const downloadKey = (r) => `${r.date}\u0000${r.tag}\u0000${r.asset}`;

function dedupeDownloads(rows) {
  const m = new Map();
  for (const r of rows) m.set(downloadKey(r), r);
  return [...m.values()];
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortDownloads(rows) {
  return rows.sort(
    (x, y) => cmp(x.date, y.date) || cmp(x.tag, y.tag) || cmp(x.asset, y.asset),
  );
}

/**
 * Merge fetched traffic rows into stored ones, keyed by date. A fetched row
 * replaces the stored row for its date (GitHub's latest days are partial),
 * except on the OLDEST fetched date, where the 14-day window may start
 * mid-day: there each field keeps the max of stored and fetched. Older stored
 * rows are kept. Sorted by date; idempotent.
 */
export function mergeTraffic(stored, fetched) {
  const byDate = new Map(stored.map((r) => [r.date, r]));
  const oldest = fetched.reduce(
    (min, r) => (min === null || r.date < min ? r.date : min),
    null,
  );
  for (const r of fetched) {
    const prev = byDate.get(r.date);
    if (prev && r.date === oldest) {
      const merged = { date: r.date };
      for (const f of TRAFFIC_FIELDS) merged[f] = Math.max(prev[f], r[f]);
      byDate.set(r.date, merged);
    } else {
      byDate.set(r.date, { ...r });
    }
  }
  return [...byDate.values()].sort((x, y) => cmp(x.date, y.date));
}

/** Merge download snapshots keyed by date,tag,asset (fetched replaces). */
export function mergeDownloads(stored, fetched) {
  return sortDownloads(dedupeDownloads([...stored, ...fetched]));
}

// ---------------------------------------------------------------- traffic fetch

/** What to do with a traffic endpoint's HTTP status. */
export function classifyTrafficStatus(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'skip';
  return 'fail';
}

/**
 * Fetch clones and views with the token as a Bearer header only. Returns
 * `{ status: 'skipped', reason: 'missing-token' }`, `{ status: 'skipped',
 * reason: 'unauthorized', httpStatus }`, or `{ status: 'ok', clones, views }`.
 * Throws on any other failure. The token is never logged or returned.
 */
export async function fetchTraffic({
  token,
  repo,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof token !== 'string' || token.trim() === '') {
    return { status: 'skipped', reason: 'missing-token' };
  }
  if (!REPO_RE.test(repo ?? ''))
    throw new Error(`bad repository ${JSON.stringify(repo)}`);
  const out = {};
  for (const kind of ['clones', 'views']) {
    const res = await fetchImpl(
      `https://api.github.com/repos/${repo}/traffic/${kind}?per=day`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token.trim()}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    const verdict = classifyTrafficStatus(res.status);
    if (verdict === 'skip') {
      return {
        status: 'skipped',
        reason: 'unauthorized',
        httpStatus: res.status,
      };
    }
    if (verdict === 'fail') {
      throw new Error(`traffic/${kind}: HTTP ${res.status}`);
    }
    out[kind] = await res.json();
  }
  // Validate shape now so a bad response fails this step, not the merge.
  trafficRowsFromApi(out.clones, out.views);
  return { status: 'ok', clones: out.clones, views: out.views };
}

/** The annotation + job-summary line for a skipped traffic fetch. */
export function skipMessages(result) {
  if (result.reason === 'missing-token') {
    return {
      annotation: MISSING_TOKEN_NOTICE,
      summary:
        'Traffic skipped: `METRICS_TOKEN` is not set. Release downloads were still recorded.',
    };
  }
  return {
    annotation: `::warning::Traffic API returned ${result.httpStatus}; METRICS_TOKEN may be expired or lack Administration: Read. Skipping traffic`,
    summary: `Traffic skipped: the traffic API returned ${result.httpStatus} (renew \`METRICS_TOKEN\` or check it has Administration: Read). Release downloads were still recorded.`,
  };
}

// ---------------------------------------------------------------- files

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/**
 * Merge the API files in `apiDir` into the CSVs in `dataDir`. Traffic is
 * merged only when both clones.json and views.json exist (fetch skipped
 * otherwise); releases.json is required.
 */
export function runMerge({ dataDir, apiDir, date }) {
  if (!DATE_RE.test(date ?? ''))
    throw new Error(`bad --date ${JSON.stringify(date)}`);
  const clonesFile = path.join(apiDir, 'clones.json');
  const viewsFile = path.join(apiDir, 'views.json');
  const hasClones = fs.existsSync(clonesFile);
  const hasViews = fs.existsSync(viewsFile);
  if (hasClones !== hasViews)
    throw new Error('only one of clones.json / views.json exists');

  const trafficFile = path.join(dataDir, 'traffic.csv');
  const downloadsFile = path.join(dataDir, 'downloads.csv');
  const storedTraffic = parseTrafficCsv(readIfExists(trafficFile));
  const storedDownloads = parseDownloadsCsv(readIfExists(downloadsFile));

  const fetchedTraffic = hasClones
    ? trafficRowsFromApi(readJson(clonesFile), readJson(viewsFile))
    : [];
  const fetchedDownloads = downloadRowsFromReleases(
    readJson(path.join(apiDir, 'releases.json')),
    date,
  );

  const traffic = mergeTraffic(storedTraffic, fetchedTraffic);
  const downloads = mergeDownloads(storedDownloads, fetchedDownloads);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(trafficFile, trafficToCsv(traffic));
  fs.writeFileSync(downloadsFile, downloadsToCsv(downloads));
  fs.writeFileSync(path.join(dataDir, 'README.md'), DATA_README);
  return {
    trafficRows: traffic.length,
    fetchedTrafficDays: fetchedTraffic.length,
    downloadRows: downloads.length,
    fetchedAssets: fetchedDownloads.length,
  };
}

// ---------------------------------------------------------------- CLI

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('--'))
      throw new Error(`unexpected argument ${JSON.stringify(a)}`);
    const eq = a.indexOf('=');
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else flags[a.slice(2)] = args[(i += 1)];
  }
  return flags;
}

export async function main(
  argv,
  { env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {},
) {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  if (command === 'fetch-traffic') {
    if (!flags.out) throw new Error('fetch-traffic needs --out <dir>');
    const result = await fetchTraffic({
      token: env.METRICS_TOKEN,
      repo: env.GITHUB_REPOSITORY,
      fetchImpl,
    });
    if (result.status === 'skipped') {
      const msg = skipMessages(result);
      log(msg.annotation);
      if (env.GITHUB_STEP_SUMMARY)
        fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${msg.summary}\n`);
      return result;
    }
    fs.mkdirSync(flags.out, { recursive: true });
    fs.writeFileSync(
      path.join(flags.out, 'clones.json'),
      JSON.stringify(result.clones),
    );
    fs.writeFileSync(
      path.join(flags.out, 'views.json'),
      JSON.stringify(result.views),
    );
    log('Fetched traffic (clones, views).');
    return result;
  }
  if (command === 'merge') {
    if (!flags['data-dir'] || !flags['api-dir']) {
      throw new Error(
        'merge needs --data-dir <dir> --api-dir <dir> --date <YYYY-MM-DD>',
      );
    }
    const r = runMerge({
      dataDir: flags['data-dir'],
      apiDir: flags['api-dir'],
      date: flags.date,
    });
    const line = `Metrics: ${r.fetchedTrafficDays} traffic day(s) fetched, ${r.trafficRows} stored; ${r.fetchedAssets} asset(s) snapshotted, ${r.downloadRows} download row(s) stored.`;
    log(line);
    if (env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
    return r;
  }
  throw new Error('usage: merge-metrics.mjs fetch-traffic|merge [flags]');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(
      `::error::${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
