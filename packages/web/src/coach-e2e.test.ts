/**
 * End to end (ADR 0013 D2/D3/D5): the REAL coach route handler behind the
 * REAL UI client and panel. `fetch` is routed straight into `handleApiRoute`
 * with a fake provider, so the request the panel builds, the server's reply
 * and the client's normalizer are all exercised together. GET /api/practice
 * through the real `fetchPractice` client then shows the check was counted
 * (first check true, then false).
 *
 * Node environment with a hand-installed jsdom window: vitest's jsdom
 * environment replaces the global `URL`, which breaks the server's
 * `fileURLToPath(new URL(..., import.meta.url))` at import time. Only the
 * DOM globals Node lacks are added, so Node's URL/fetch/Response stay.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createElement } from 'react';
import { JSDOM } from 'jsdom';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import type { LlmProvider } from '@ibai/providers';
import { handleApiRoute } from './api.js';
import type { ApiDeps } from './api.js';
import { createCoachLimiter } from './coach-routes.js';
import { checkIntuition } from '../web-ui/src/lib/intuitionCheck.js';
import { fetchPractice } from '../web-ui/src/lib/api.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
const win = dom.window as unknown as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(win)) {
  if (!(key in globalThis)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: win[key],
    });
  }
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Imported after the DOM exists (Testing Library binds `screen` on import).
const { act, cleanup, fireEvent, render, screen, waitFor } = await import(
  '@testing-library/react'
);
const { IntuitionCheck } = await import(
  '../web-ui/src/components/IntuitionCheck.js'
);

const CATALOG = createCatalogSource();
const PROBLEM = CATALOG.list()[0]!;
const NOW = new Date('2026-10-01T12:00:00.000Z');

let tmpDir: string;
let deps: ApiDeps;
let prompts: string[];

function provider(reply: Record<string, unknown>): LlmProvider {
  return {
    complete: async (req) => {
      prompts.push(JSON.stringify(req));
      return { content: JSON.stringify(reply) };
    },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-coach-e2e-'));
  prompts = [];
  let clock = 0;
  deps = {
    catalog: CATALOG,
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    storage: new LocalFileStorageAdapter(tmpDir),
    dataDir: tmpDir,
    now: () => NOW,
    coachLimiter: createCoachLimiter({ clock: () => (clock += 10_000) }),
    provider: provider({
      assessment: 'partial',
      questions: ['What does n ≤ 1e5 suggest you can afford?'],
      readyToCode: false,
      note: 'The pairing idea is clear.',
      miss: 'complexity',
    }),
  };
  // Route the UI's same-origin fetches into the real server handler.
  vi.stubGlobal(
    'fetch',
    async (url: string, init?: RequestInit): Promise<Response> => {
      const res = await handleApiRoute(
        init?.method ?? 'GET',
        new URL(url, 'http://localhost').pathname,
        deps,
        typeof init?.body === 'string' ? init.body : undefined,
      );
      return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': res.contentType, ...res.headers },
      });
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('coach end to end: real handler + real UI client/panel', () => {
  it('panel check renders the reply; practice counts first and later checks', async () => {
    render(
      createElement(IntuitionCheck, {
        problemId: PROBLEM.id,
        content: 'Two loops over all pairs.',
        timeComplexity: 'O(n^2)',
        spaceComplexity: '',
        status: 'none',
      }),
    );
    const btn = await screen.findByRole('button', {
      name: 'Check my intuition',
    });
    await waitFor(() => expect(btn.hasAttribute('disabled')).toBe(false));
    await act(async () => {
      fireEvent.click(btn);
    });
    await screen.findByText('Partly there');
    expect(
      screen.getByText('What does n ≤ 1e5 suggest you can afford?'),
    ).toBeTruthy();
    expect(screen.getByText('The pairing idea is clear.')).toBeTruthy();
    expect(screen.getByText('First check')).toBeTruthy();
    // The panel's request carried the editor text, and no Reference block
    // (ADR 0014 D1).
    expect(prompts.join('\n')).toContain('Two loops over all pairs.');
    expect(prompts.join('\n')).not.toContain('Reference');

    const first = await fetchPractice();
    expect(first.state).toBe('ready');
    expect(first.totals).toMatchObject({ checks: 1, problems: 1 });
    expect(first.firstCheck).toEqual({ on_track: 0, partial: 1, off_track: 0 });

    // A second check of the same problem through the real client.
    const second = await checkIntuition(PROBLEM.id, {
      content: 'Two loops over all pairs, then a hash map.',
    });
    expect(second.firstCheck).toBe(false);
    expect(second.assessment).toBe('partial');
    const after = await fetchPractice();
    expect(after.totals).toMatchObject({ checks: 2, problems: 1 });
    // Only the first check of a problem feeds the first-check split.
    expect(after.firstCheck).toEqual({ on_track: 0, partial: 1, off_track: 0 });
  });
});
