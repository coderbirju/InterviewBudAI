import { describe, it, expect } from 'vitest';
import {
  fieldForServerError,
  normalizeTitleInput,
  normalizeUrlInput,
  validateProblemForm,
} from './problemForm';
import type { ProblemFormValues } from './problemForm';

const KNOWN = new Set(['arrays', 'stack', 'heap', 'trees']);
const BASE: ProblemFormValues = {
  title: 'My Puzzle',
  url: '',
  statement: '',
  difficulty: 'medium',
  topics: ['arrays'],
};

describe('validateProblemForm (mirrors the server limits, ADR 0010 D5)', () => {
  it('accepts a minimal problem and normalises it', () => {
    expect(
      validateProblemForm(
        {
          ...BASE,
          title: '  My \n  Puzzle\t ',
          statement: '  line 1\nline 2  ',
        },
        KNOWN,
      ),
    ).toEqual({
      ok: true,
      input: {
        title: 'My Puzzle',
        statement: 'line 1\nline 2',
        difficulty: 'medium',
        topics: ['arrays'],
      },
    });
  });

  it('title: required, at most 200 characters (after normalising)', () => {
    const empty = validateProblemForm({ ...BASE, title: ' \n ' }, KNOWN);
    expect(empty.ok ? null : empty.errors.title).toMatch(/enter a title/i);
    const long = validateProblemForm(
      { ...BASE, title: 'x'.repeat(201) },
      KNOWN,
    );
    expect(long.ok ? null : long.errors.title).toMatch(/200/);
    expect(
      validateProblemForm({ ...BASE, title: 'x'.repeat(200) }, KNOWN).ok,
    ).toBe(true);
  });

  it('url: optional, http(s) only, at most 2048 characters', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://x.test/a',
      'not a url',
      `https://x.test/${'a'.repeat(2048)}`,
    ]) {
      const r = validateProblemForm({ ...BASE, url: bad }, KNOWN);
      expect(r.ok ? null : r.errors.url, bad).toMatch(/http/);
    }
    const ok = validateProblemForm(
      { ...BASE, url: ' https://example.com/p ' },
      KNOWN,
    );
    expect(ok.ok && ok.input.url).toBe('https://example.com/p');
    expect(normalizeUrlInput('')).toBe('');
  });

  it('statement: at most 2000 characters', () => {
    const r = validateProblemForm(
      { ...BASE, statement: 's'.repeat(2001) },
      KNOWN,
    );
    expect(r.ok ? null : r.errors.statement).toMatch(/2000/);
  });

  it('topics: 1–3 known topics', () => {
    for (const topics of [[], ['nope'], ['arrays', 'stack', 'heap', 'trees']]) {
      const r = validateProblemForm({ ...BASE, topics }, KNOWN);
      expect(r.ok ? null : r.errors.topics, topics.join()).toMatch(/1–3/);
    }
  });

  it('title normaliser strips controls like the server', () => {
    expect(normalizeTitleInput('a\u0000b\u007f c')).toBe('ab c');
  });

  it('maps server 400 messages to fields', () => {
    expect(fieldForServerError('title must be 1–200 characters')).toBe('title');
    expect(fieldForServerError('url must be an http(s) link')).toBe('url');
    expect(fieldForServerError('unknown topic: x')).toBe('topics');
    expect(fieldForServerError('at most 1000 custom problems')).toBeNull();
  });
});
