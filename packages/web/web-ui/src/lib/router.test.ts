import { describe, it, expect } from 'vitest';
import {
  parseRoute,
  notesHref,
  analyticsHref,
  interviewHref,
  homeHref,
  APP_BASE,
  currentSearch,
  replaceSearch,
} from './router';

describe('router query helpers', () => {
  it('replaceSearch swaps the query in place; currentSearch reads it', () => {
    window.history.replaceState({}, '', '/');
    const before = window.history.length;
    replaceSearch('?q=sum');
    expect(window.location.pathname).toBe('/');
    expect(currentSearch()).toBe('?q=sum');
    replaceSearch('');
    expect(currentSearch()).toBe('');
    // Replace, not push — the back stack does not grow.
    expect(window.history.length).toBe(before);
  });
});

describe('router.parseRoute', () => {
  it('resolves the root and trailing slash to home', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('')).toEqual({ kind: 'home' });
  });

  it('parses a notes route with a problem id', () => {
    expect(parseRoute('/notes/two-sum')).toEqual({
      kind: 'notes',
      problemId: 'two-sum',
    });
  });

  it('parses the analytics route', () => {
    expect(parseRoute('/analytics')).toEqual({ kind: 'analytics' });
    expect(parseRoute('/analytics/')).toEqual({ kind: 'analytics' });
  });

  it('parses the interview route', () => {
    expect(parseRoute('/interview')).toEqual({ kind: 'interview' });
    expect(parseRoute('/interview/')).toEqual({ kind: 'interview' });
  });

  it('falls back to home for an interview path with extra segments', () => {
    expect(parseRoute('/interview/extra')).toEqual({ kind: 'home' });
  });

  it('falls back to home for an analytics path with extra segments', () => {
    expect(parseRoute('/analytics/extra')).toEqual({ kind: 'home' });
  });

  it('decodes an encoded problem id segment', () => {
    expect(parseRoute('/notes/a%2Fb')).toEqual({
      kind: 'notes',
      problemId: 'a/b',
    });
  });

  it('falls back to home for a notes path with no id or an unknown path', () => {
    expect(parseRoute('/notes')).toEqual({ kind: 'home' });
    expect(parseRoute('/notes/')).toEqual({ kind: 'home' });
    expect(parseRoute('/something-else')).toEqual({ kind: 'home' });
  });
});

describe('router href helpers', () => {
  it('builds a root-relative, encoded notes href', () => {
    expect(notesHref('two-sum')).toBe('/notes/two-sum');
    expect(notesHref('a/b')).toBe('/notes/a%2Fb');
  });

  it('builds the root-relative analytics href', () => {
    expect(analyticsHref()).toBe('/analytics');
  });

  it('builds the root-relative interview href', () => {
    expect(interviewHref()).toBe('/interview');
  });

  it('homeHref is the site root and APP_BASE is empty', () => {
    expect(homeHref()).toBe('/');
    expect(APP_BASE).toBe('');
  });
});
