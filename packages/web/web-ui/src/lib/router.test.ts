import { describe, it, expect } from 'vitest';
import {
  parseRoute,
  notesHref,
  analyticsHref,
  homeHref,
  APP_BASE,
} from './router';

describe('router.parseRoute', () => {
  it('resolves the app base and trailing slash to home', () => {
    expect(parseRoute('/app')).toEqual({ kind: 'home' });
    expect(parseRoute('/app/')).toEqual({ kind: 'home' });
  });

  it('parses a notes route with a problem id', () => {
    expect(parseRoute('/app/notes/two-sum')).toEqual({
      kind: 'notes',
      problemId: 'two-sum',
    });
  });

  it('parses the analytics route', () => {
    expect(parseRoute('/app/analytics')).toEqual({ kind: 'analytics' });
    expect(parseRoute('/app/analytics/')).toEqual({ kind: 'analytics' });
  });

  it('falls back to home for an analytics path with extra segments', () => {
    expect(parseRoute('/app/analytics/extra')).toEqual({ kind: 'home' });
  });

  it('decodes an encoded problem id segment', () => {
    expect(parseRoute('/app/notes/a%2Fb')).toEqual({
      kind: 'notes',
      problemId: 'a/b',
    });
  });

  it('falls back to home for a notes path with no id or an unknown path', () => {
    expect(parseRoute('/app/notes')).toEqual({ kind: 'home' });
    expect(parseRoute('/app/notes/')).toEqual({ kind: 'home' });
    expect(parseRoute('/app/something-else')).toEqual({ kind: 'home' });
  });
});

describe('router href helpers', () => {
  it('builds an /app-based, encoded notes href', () => {
    expect(notesHref('two-sum')).toBe('/app/notes/two-sum');
    expect(notesHref('a/b')).toBe('/app/notes/a%2Fb');
  });

  it('builds the /app-based analytics href', () => {
    expect(analyticsHref()).toBe('/app/analytics');
  });

  it('homeHref is the app base', () => {
    expect(homeHref()).toBe(APP_BASE);
    expect(APP_BASE).toBe('/app');
  });
});
