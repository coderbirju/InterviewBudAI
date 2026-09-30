import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, answerQuiz, isModelUnavailable } from './api';

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
