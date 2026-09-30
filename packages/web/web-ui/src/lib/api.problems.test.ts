import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ProblemApiError,
  createProblem,
  deleteProblem,
  updateProblem,
} from './api';

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

function lastCall(): { url: string; init: RequestInit } {
  const mock = vi.mocked(fetch);
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1] as [
    string,
    RequestInit,
  ];
  return { url, init };
}

const PROBLEM = {
  id: 'u-my-puzzle-abc123',
  title: 'My Puzzle',
  difficulty: 'easy',
  topics: ['arrays'],
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
  custom: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('problems API client (ADR 0010 D5)', () => {
  it('createProblem POSTs JSON and returns the problem; allowSimilarTitle only when asked', async () => {
    respond(201, { problem: PROBLEM });
    const input = {
      title: 'My Puzzle',
      difficulty: 'easy',
      topics: ['arrays'],
    } as const;
    await expect(createProblem(input)).resolves.toEqual(PROBLEM);
    expect(lastCall().url).toBe('/api/problems');
    expect(lastCall().init.method).toBe('POST');
    expect(JSON.parse(String(lastCall().init.body))).toEqual(input);
    await createProblem(input, { allowSimilarTitle: true });
    expect(JSON.parse(String(lastCall().init.body))).toMatchObject({
      allowSimilarTitle: true,
    });
  });

  it('a duplicate 409 carries the existing problem and overridable', async () => {
    respond(409, {
      error: 'a problem with a similar title already exists',
      duplicate: { problemId: 'lc-1', title: 'Two Sum', custom: false },
      overridable: true,
    });
    const err = await createProblem({
      title: 'two sum',
      difficulty: 'easy',
      topics: ['arrays'],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProblemApiError);
    expect(err).toMatchObject({
      status: 409,
      duplicate: { problemId: 'lc-1', title: 'Two Sum', custom: false },
      overridable: true,
      message: 'a problem with a similar title already exists',
    });
  });

  it('updateProblem PATCHes the encoded id; null clears', async () => {
    respond(200, { problem: PROBLEM });
    await updateProblem('u-my-puzzle-abc123', { url: null, title: 'X' });
    expect(lastCall().url).toBe('/api/problems/u-my-puzzle-abc123');
    expect(lastCall().init.method).toBe('PATCH');
    expect(JSON.parse(String(lastCall().init.body))).toEqual({
      url: null,
      title: 'X',
    });
  });

  it('deleteProblem: 409 hasNote, then deleteNote:true returns the backup', async () => {
    respond(409, { error: 'this problem has a note', hasNote: true });
    const err = await deleteProblem('u-a-abc123').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, hasNote: true });
    expect(JSON.parse(String(lastCall().init.body))).toEqual({});
    expect(lastCall().init.method).toBe('DELETE');

    respond(200, { deleted: true, noteDeleted: true, backup: '/d/.backups/x' });
    await expect(
      deleteProblem('u-a-abc123', { deleteNote: true }),
    ).resolves.toEqual({
      deleted: true,
      noteDeleted: true,
      backup: '/d/.backups/x',
    });
    expect(JSON.parse(String(lastCall().init.body))).toEqual({
      deleteNote: true,
    });
  });

  it('a non-JSON error body falls back to a generic message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('oops', { status: 500 })),
    );
    await expect(deleteProblem('u-a-abc123')).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining('500') as string,
    });
  });
});
