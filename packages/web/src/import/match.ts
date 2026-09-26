/**
 * Server-side catalog matching for imported rows (ADR 0009 D2). Pure. Problem
 * ids come ONLY from here — never from the client.
 *
 * Order (first hit wins):
 *  1. LeetCode slug from the `URL` cell, else a URL inside the title cell
 *     (`leetcode.com/problems/<slug>/…`; trailing segments such as
 *     `/description/` or `/editorial/`, query and hash ignored).
 *  2. Leading `NNN.` in the title → `lc-NNN` if that id is in the catalog.
 *  3. Normalized title equality.
 */

import type { Problem } from '@ibai/curriculum';

/** How a row was matched. */
export type MatchedBy = 'url' | 'number' | 'title';

/** A catalog match. */
export interface CatalogMatch {
  readonly problemId: string;
  readonly title: string;
  readonly by: MatchedBy;
}

/** Hosts whose `/problems/<slug>` paths identify a LeetCode problem. */
const LEETCODE_HOSTS = new Set(['leetcode.com', 'www.leetcode.com']);

/**
 * Extract the LeetCode problem slug from a URL-ish string, or null. Accepts a
 * missing scheme (`leetcode.com/problems/two-sum/`).
 */
export function leetcodeSlug(raw: string): string | null {
  const candidate = raw.trim();
  if (candidate === '') return null;
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`,
    );
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!LEETCODE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const segments = url.pathname.split('/').filter((s) => s !== '');
  if (segments[0]?.toLowerCase() !== 'problems') return null;
  const slug = segments[1]?.toLowerCase();
  if (slug === undefined || !/^[a-z0-9-]+$/.test(slug)) return null;
  return slug;
}

/** First `http(s)://…` token inside free text (e.g. a title cell), or null. */
function urlInText(text: string): string | null {
  const m = /\bhttps?:\/\/[^\s<>"')\]]+/i.exec(text);
  if (m) return m[0];
  const bare = /\b(?:www\.)?leetcode\.com\/problems\/[^\s<>"')\]]+/i.exec(text);
  return bare ? bare[0] : null;
}

/**
 * Normalize a title for equality: lowercase, strip a leading `NNN.`, drop
 * punctuation, collapse whitespace.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\s*\d+\s*\.\s*/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A matcher over a catalog. */
export interface CatalogMatcher {
  match(title: string, url: string): CatalogMatch | null;
}

/** Build a matcher (indexes built once) over the catalog's problems. */
export function createCatalogMatcher(
  problems: readonly Problem[],
): CatalogMatcher {
  const bySlug = new Map<string, Problem>();
  const byId = new Map<string, Problem>();
  const byTitle = new Map<string, Problem>();
  for (const p of problems) {
    byId.set(p.id, p);
    const slug = leetcodeSlug(p.url);
    if (slug !== null && !bySlug.has(slug)) bySlug.set(slug, p);
    const key = normalizeTitle(p.title);
    if (key !== '' && !byTitle.has(key)) byTitle.set(key, p);
  }
  const hit = (p: Problem, by: MatchedBy): CatalogMatch => ({
    problemId: p.id,
    title: p.title,
    by,
  });
  return {
    match(title: string, url: string): CatalogMatch | null {
      for (const source of [url, urlInText(title) ?? '']) {
        const slug = leetcodeSlug(source);
        const p = slug === null ? undefined : bySlug.get(slug);
        if (p) return hit(p, 'url');
      }
      const num = /^\s*(\d+)\s*\./.exec(title);
      if (num) {
        const p = byId.get(`lc-${Number(num[1])}`);
        if (p) return hit(p, 'number');
      }
      const key = normalizeTitle(title);
      const p = key === '' ? undefined : byTitle.get(key);
      return p ? hit(p, 'title') : null;
    },
  };
}
