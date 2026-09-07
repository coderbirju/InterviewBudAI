import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveDataDir, resolvePort, resolveHost } from './config.js';

describe('resolveDataDir', () => {
  it('returns default homedir path when no config', () => {
    const result = resolveDataDir({});
    expect(result).toBe(path.join(os.homedir(), '.interviewbudai', 'data'));
  });

  it('uses IBAI_DATA_DIR env var when set', () => {
    const result = resolveDataDir({ IBAI_DATA_DIR: '/custom/path' });
    expect(result).toBe('/custom/path');
  });

  it('uses --data-dir flag over env var', () => {
    const result = resolveDataDir({ IBAI_DATA_DIR: '/env/path' }, [
      '--data-dir=/flag/path',
    ]);
    expect(result).toBe('/flag/path');
  });

  it('resolves relative paths to absolute', () => {
    const result = resolveDataDir({ IBAI_DATA_DIR: './relative' });
    expect(path.isAbsolute(result)).toBe(true);
  });
});

describe('resolvePort', () => {
  it('returns default 4173 when no config', () => {
    expect(resolvePort({})).toBe(4173);
  });

  it('uses IBAI_WEB_PORT env var when set', () => {
    expect(resolvePort({ IBAI_WEB_PORT: '8080' })).toBe(8080);
  });

  it('uses --port flag over env var', () => {
    expect(resolvePort({ IBAI_WEB_PORT: '8080' }, ['--port=9000'])).toBe(9000);
  });

  it('throws on invalid port string', () => {
    expect(() => resolvePort({ IBAI_WEB_PORT: 'invalid' })).toThrow(
      /Invalid port/,
    );
  });

  it('throws on port out of range', () => {
    expect(() => resolvePort({ IBAI_WEB_PORT: '0' })).toThrow(/Invalid port/);
    expect(() => resolvePort({ IBAI_WEB_PORT: '70000' })).toThrow(
      /Invalid port/,
    );
  });
});

describe('resolveHost', () => {
  it('always returns 127.0.0.1', () => {
    expect(resolveHost()).toBe('127.0.0.1');
  });
});
