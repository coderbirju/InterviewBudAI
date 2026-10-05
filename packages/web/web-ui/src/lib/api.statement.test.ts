import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StatementApiError,
  fetchPreferences,
  fetchStatement,
  fetchStatementFromLeetcode,
  normalizeStatement,
  pasteStatement,
  savePreferences,
} from './api';
import ready from '../test/fixtures/statement/statement-ready.json';
import readyTruncated from '../test/fixtures/statement/statement-ready-truncated.json';
import notCached from '../test/fixtures/statement/statement-not-cached.json';
import disabled from '../test/fixtures/statement/statement-disabled.json';
import premium from '../test/fixtures/statement/statement-premium.json';
import unavailable from '../test/fixtures/statement/statement-unavailable.json';
import pasted from '../test/fixtures/statement/statement-pasted.json';
import custom from '../test/fixtures/statement/statement-custom.json';
import errDisabled from '../test/fixtures/statement/fetch-error-403-fetch_disabled.json';
import errNotFound from '../test/fixtures/statement/fetch-error-404-not_found.json';
import errRateLimited from '../test/fixtures/statement/fetch-error-429-rate_limited.json';
import errFailed from '../test/fixtures/statement/fetch-error-502-fetch_failed.json';
import errTimeout from '../test/fixtures/statement/fetch-error-504-fetch_timeout.json';
import prefsUnpinned from '../test/fixtures/statement/preferences-unpinned.json';
import prefsPinned from '../test/fixtures/statement/preferences-pinned.json';

/* ADR 0015 "API": the typed clients, tested against the ADR fixture list. */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<
  typeof vi.fn<[url: string, init?: RequestInit], Promise<Response>>
>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET statement fixtures', () => {
  it.each([
    ['ready', ready, 'ready', 'leetcode'],
    ['ready truncated', readyTruncated, 'ready', 'leetcode'],
    ['not-cached', notCached, 'not-cached', null],
    ['disabled', disabled, 'disabled', null],
    ['premium', premium, 'premium', null],
    ['unavailable', unavailable, 'unavailable', null],
    ['pasted', pasted, 'ready', 'pasted'],
    ['custom', custom, 'ready', 'custom'],
  ])('%s parses', async (_label, body, state, source) => {
    fetchMock.mockResolvedValue(json(body));
    const s = await fetchStatement(body.id);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/problems/${encodeURIComponent(body.id)}/statement`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(s.state).toBe(state);
    expect(s.source).toBe(source);
    expect(s.invalidTree).toBe(false);
    expect(s.truncated).toBe(body.truncated);
    expect(s.snippets).toEqual(body.snippets);
    expect(s.fetch).toEqual(body.fetch);
  });

  it('keeps the tree only when it passes isStatementTree', async () => {
    expect(normalizeStatement(ready)?.blocks).toEqual(ready.blocks);
    const hostile = normalizeStatement({
      ...ready,
      blocks: [{ t: 'script', c: [{ t: 'text', v: 'alert(1)' }] }],
    });
    expect(hostile?.blocks).toBeNull();
    expect(hostile?.invalidTree).toBe(true);
    expect(normalizeStatement({ ...ready, blocks: '<p>x</p>' })?.blocks).toBe(
      null,
    );
  });

  it('pasted keeps the fetched snippets', () => {
    const s = normalizeStatement(pasted);
    expect(s?.blocks).toBeNull();
    expect(s?.text).toBe(pasted.text);
    expect(s?.snippets.python).toBe(ready.snippets.python);
  });

  it('an unusable reply is a 502 StatementApiError', async () => {
    fetchMock.mockResolvedValue(json({ ...ready, state: 'weird' }));
    await expect(fetchStatement('lc-1')).rejects.toMatchObject({
      status: 502,
    });
    expect(normalizeStatement({ ...ready, fetch: null })).toBeNull();
    expect(normalizeStatement([])).toBeNull();
  });

  it('a network error is a StatementApiError with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await fetchStatement('lc-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StatementApiError);
    expect((err as StatementApiError).status).toBe(0);
  });
});

describe('POST …/statement/fetch', () => {
  it('sends refresh only when asked', async () => {
    fetchMock.mockImplementation(async () => json(ready));
    await fetchStatementFromLeetcode('lc-1');
    await fetchStatementFromLeetcode('lc-1', { refresh: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/problems/lc-1/statement/fetch',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: '{}',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"refresh":true}');
  });

  it.each([
    [errDisabled, 403, 'fetch_disabled', undefined],
    [errNotFound, 404, 'not_found', undefined],
    [errRateLimited, 429, 'rate_limited', errRateLimited.retryAfterMs],
    [errFailed, 502, 'fetch_failed', undefined],
    [errTimeout, 504, 'fetch_timeout', undefined],
  ])('error body %j (%i)', async (body, status, code, retry) => {
    fetchMock.mockResolvedValue(json(body, status));
    const err = await fetchStatementFromLeetcode('lc-1').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StatementApiError);
    const e = err as StatementApiError;
    expect(e.status).toBe(status);
    expect(e.fetchCode).toBe(code);
    expect(e.retryAfterMs).toBe(retry);
    expect(e.message).toBe(body.error);
  });

  it('an unknown code or a non-JSON body leaves fetchCode unset', async () => {
    fetchMock.mockResolvedValue(json({ error: 'x', code: 'nope' }, 500));
    const err = (await fetchStatementFromLeetcode('lc-1').catch(
      (e: unknown) => e,
    )) as StatementApiError;
    expect(err.fetchCode).toBeUndefined();
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }));
    const err2 = (await fetchStatementFromLeetcode('lc-1').catch(
      (e: unknown) => e,
    )) as StatementApiError;
    expect(err2.status).toBe(502);
    expect(err2.fetchCode).toBeUndefined();
  });
});

describe('PUT statement (paste)', () => {
  it('PUTs { text } and returns the pasted reply', async () => {
    fetchMock.mockResolvedValue(json(pasted));
    const s = await pasteStatement('lc-1', 'my text');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems/lc-1/statement',
      expect.objectContaining({ method: 'PUT', body: '{"text":"my text"}' }),
    );
    expect(s.source).toBe('pasted');
  });

  it('409 read-only is surfaced', async () => {
    fetchMock.mockResolvedValue(json({ error: 'read-only' }, 409));
    await expect(pasteStatement('lc-1', 'x')).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('preferences', () => {
  it('GET unpinned and pinned fixtures', async () => {
    fetchMock.mockResolvedValueOnce(json(prefsUnpinned));
    expect(await fetchPreferences()).toEqual(prefsUnpinned);
    fetchMock.mockResolvedValueOnce(json(prefsPinned));
    expect(await fetchPreferences()).toEqual({
      language: 'python',
      leetcodeFetch: { enabled: false, pinned: true },
    });
  });

  it('PUT sends only the patch', async () => {
    fetchMock.mockResolvedValue(json({ ...prefsUnpinned, language: 'go' }));
    const p = await savePreferences({ language: 'go' });
    expect(p.language).toBe('go');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/preferences',
      expect.objectContaining({ method: 'PUT', body: '{"language":"go"}' }),
    );
  });

  it('a bad reply or an error status throws', async () => {
    fetchMock.mockResolvedValueOnce(json({ language: 'rust' }));
    await expect(fetchPreferences()).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce(
      json({ error: 'Set by IBAI_LEETCODE_FETCH' }, 400),
    );
    await expect(savePreferences({ leetcodeFetch: true })).rejects.toThrow(
      'Set by IBAI_LEETCODE_FETCH',
    );
  });
});
