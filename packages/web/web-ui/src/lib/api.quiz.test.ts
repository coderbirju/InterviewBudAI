import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ApiError,
  answerQuiz,
  isModelUnavailable,
  newQuiz,
  startQuiz,
} from './api';

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quiz API client: model unavailable (ADR 0011 D4)', () => {
  it('a 503 model_unavailable carries code, detail and hint', async () => {
    respond(503, {
      error: 'model unavailable',
      code: 'model_unavailable',
      detail: 'starting',
      hint: 'enable DMR',
      extra: 42,
    });
    const err = await answerQuiz('x', 'lc-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isModelUnavailable(err)).toBe(true);
    const apiErr = err as ApiError;
    expect(apiErr.message).toBe('model unavailable');
    expect(apiErr.extra).toEqual({
      code: 'model_unavailable',
      detail: 'starting',
      hint: 'enable DMR',
    });
  });

  it('other errors are not "model unavailable"', async () => {
    respond(502, { error: 'The model returned an unusable verdict.' });
    const err = await answerQuiz('x').catch((e: unknown) => e);
    expect(isModelUnavailable(err)).toBe(false);
    expect((err as ApiError).extra).toEqual({});
    expect(isModelUnavailable(new ApiError('model unavailable', 503))).toBe(
      false,
    );
  });
});

describe('quiz API client: question count body', () => {
  function bodyOf(call: unknown[]): unknown {
    return JSON.parse(String((call[1] as RequestInit).body));
  }

  it('startQuiz(10) posts {"count":10} to /api/quiz/start', async () => {
    respond(200, { empty: true, message: 'x' });
    await startQuiz(10);
    const call = vi.mocked(fetch).mock.calls[0] as unknown[];
    expect(call[0]).toBe('/api/quiz/start');
    expect(bodyOf(call)).toEqual({ count: 10 });
  });

  it('newQuiz(5) posts {"count":5}; no count sends an empty body', async () => {
    respond(200, { empty: true, message: 'x' });
    await newQuiz(5);
    await startQuiz();
    const calls = vi.mocked(fetch).mock.calls as unknown[][];
    expect(calls[0]?.[0]).toBe('/api/quiz/new');
    expect(bodyOf(calls[0] ?? [])).toEqual({ count: 5 });
    expect(bodyOf(calls[1] ?? [])).toEqual({});
  });
});
