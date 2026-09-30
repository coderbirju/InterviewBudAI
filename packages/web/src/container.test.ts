import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { resolveHost, resolvePublicPort, isContainer } from './config.js';
import {
  checkDataDirWritable,
  dockerDataInfo,
  hostMismatchText,
  normalizeHostPath,
  readHostConfig,
  sameHostPath,
} from './container.js';
import { createCoachHandler, precheckRequest } from './handler.js';
import type { HandlerRequest, HandlerResponse } from './handler.js';
import { hostPolicyFor } from './security.js';
import { formatStartupBanner, startServer } from './server.js';
import type { DataDirStatus } from './data-dir-control.js';

/**
 * ADR 0011 PR B — running in the Docker image: the bind-host guard, the
 * public-port Host/Origin policy, the /data writability check, the read-only
 * host config.json reader and the mismatch detection.
 */

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-container-'));
});

afterEach(() => {
  // Undo any chmod a test made so the temp dir can be removed.
  try {
    fs.chmodSync(tmp, 0o700);
  } catch {
    // ignore
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('resolveHost (IBAI_BIND_HOST guard)', () => {
  it('defaults to 127.0.0.1 and accepts ::1', () => {
    expect(resolveHost({})).toBe('127.0.0.1');
    expect(resolveHost({ IBAI_BIND_HOST: ' ' })).toBe('127.0.0.1');
    expect(resolveHost({ IBAI_BIND_HOST: '127.0.0.1' })).toBe('127.0.0.1');
    expect(resolveHost({ IBAI_BIND_HOST: '::1' })).toBe('::1');
  });

  it('accepts 0.0.0.0 only with IBAI_CONTAINER=1', () => {
    expect(
      resolveHost({ IBAI_BIND_HOST: '0.0.0.0', IBAI_CONTAINER: '1' }),
    ).toBe('0.0.0.0');
    expect(() => resolveHost({ IBAI_BIND_HOST: '0.0.0.0' })).toThrow(
      /only allowed inside the Docker image/,
    );
    expect(() =>
      resolveHost({ IBAI_BIND_HOST: '0.0.0.0', IBAI_CONTAINER: 'true' }),
    ).toThrow(/IBAI_CONTAINER=1/);
  });

  it('refuses any other value, even inside the container', () => {
    for (const value of ['192.168.1.5', 'localhost', '::', '0.0.0.0:80']) {
      expect(() =>
        resolveHost({ IBAI_BIND_HOST: value, IBAI_CONTAINER: '1' }),
      ).toThrow(/Invalid IBAI_BIND_HOST/);
    }
  });

  it('isContainer is exact', () => {
    expect(isContainer({ IBAI_CONTAINER: '1' })).toBe(true);
    expect(isContainer({ IBAI_CONTAINER: '0' })).toBe(false);
    expect(isContainer({})).toBe(false);
  });

  it('startServer refuses to start on 0.0.0.0 outside the container', async () => {
    await expect(
      startServer({
        env: { IBAI_BIND_HOST: '0.0.0.0', IBAI_DATA_DIR: tmp },
        argv: [],
        homeDir: tmp,
        log: () => undefined,
      }),
    ).rejects.toThrow(/only allowed inside the Docker image/);
  });
});

describe('resolvePublicPort', () => {
  it('defaults to the listen port; validates the value', () => {
    expect(resolvePublicPort({}, 4173)).toBe(4173);
    expect(resolvePublicPort({ IBAI_PUBLIC_PORT: '8080' }, 4173)).toBe(8080);
    for (const bad of ['0', '65536', 'abc', '80.5', '-1']) {
      expect(() => resolvePublicPort({ IBAI_PUBLIC_PORT: bad }, 4173)).toThrow(
        /IBAI_PUBLIC_PORT/,
      );
    }
  });
});

describe('Host / Origin policy with public ≠ listen port', () => {
  const LISTEN = 4173;
  const PUBLIC = 8080;
  const policy = hostPolicyFor(LISTEN, PUBLIC);
  const req = (
    method: string,
    headers: Record<string, string>,
  ): Parameters<typeof precheckRequest>[0] => ({
    method,
    url: '/api/notes/x',
    contentType: 'application/json',
    headers,
  });

  it('public port: loopback hosts allowed for every method', () => {
    for (const host of [
      `localhost:${PUBLIC}`,
      `127.0.0.1:${PUBLIC}`,
      `[::1]:${PUBLIC}`,
    ]) {
      expect(precheckRequest(req('GET', { host }), policy)).toBeNull();
      expect(
        precheckRequest(
          req('POST', { host, origin: `http://${host}` }),
          policy,
        ),
      ).toBeNull();
    }
  });

  it('listen port: GET allowed (healthcheck), mutations 403', () => {
    const host = `127.0.0.1:${LISTEN}`;
    expect(precheckRequest(req('GET', { host }), policy)).toBeNull();
    const res = precheckRequest(
      req('POST', { host, origin: `http://${host}` }),
      policy,
    );
    expect(res?.status).toBe(403);
    // Even with no Origin at all (curl) — the listen port is read-only.
    expect(precheckRequest(req('DELETE', { host }), policy)?.status).toBe(403);
  });

  it('Origin is accepted only on the public port', () => {
    const res = precheckRequest(
      req('POST', {
        host: `localhost:${PUBLIC}`,
        origin: `http://localhost:${LISTEN}`,
      }),
      policy,
    );
    expect(res?.status).toBe(403);
  });

  it('non-loopback or other-port Host → 421', () => {
    for (const host of [
      'evil.example',
      `evil.example:${PUBLIC}`,
      'localhost:9',
    ]) {
      expect(precheckRequest(req('GET', { host }), policy)?.status).toBe(421);
    }
  });

  it('equal ports: behaves exactly like the single allowlist', () => {
    const same = hostPolicyFor(LISTEN);
    expect(same.readOnlyHosts.size).toBe(0);
    const host = `localhost:${LISTEN}`;
    expect(
      precheckRequest(req('POST', { host, origin: `http://${host}` }), same),
    ).toBeNull();
  });
});

describe('checkDataDirWritable', () => {
  it('writable dir: chmods to 0700 and leaves no probe file', () => {
    fs.chmodSync(tmp, 0o755);
    const result = checkDataDirWritable(tmp);
    expect(result).toEqual({ writable: true });
    if (process.platform !== 'win32') {
      expect(fs.statSync(tmp).mode & 0o777).toBe(0o700);
    }
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('missing dir → not writable, never created', () => {
    const dir = path.join(tmp, 'nope');
    const result = checkDataDirWritable(dir);
    expect(result.writable).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it.skipIf(isRoot || process.platform === 'win32')(
    'a dir we do not own (chmod and write both fail) → not writable',
    () => {
      // `/` is root-owned: chmod fails (EPERM) and the probe write fails.
      const result = checkDataDirWritable('/');
      expect(result.writable).toBe(false);
      expect(result.writable === false && result.error).toMatch(/^E[A-Z]+$/);
    },
  );
});

describe('readHostConfig (/host-config/config.json)', () => {
  const file = (): string => path.join(tmp, 'config.json');

  it('missing file (or missing parent) → absent', () => {
    expect(readHostConfig(file())).toEqual({ status: 'absent' });
    expect(readHostConfig(path.join(tmp, 'no', 'config.json'))).toEqual({
      status: 'absent',
    });
  });

  it('valid POSIX and Windows host paths', () => {
    fs.writeFileSync(file(), JSON.stringify({ dataDir: '/Users/a/notes/' }));
    expect(readHostConfig(file())).toEqual({
      status: 'ok',
      dataDir: '/Users/a/notes',
    });
    fs.writeFileSync(
      file(),
      JSON.stringify({ dataDir: 'C:\\Users\\a\\Notes' }),
    );
    expect(readHostConfig(file())).toEqual({
      status: 'ok',
      dataDir: 'C:\\Users\\a\\Notes',
    });
  });

  it.skipIf(process.platform === 'win32')(
    'symlink → invalid, never followed',
    () => {
      const target = path.join(tmp, 'real.json');
      fs.writeFileSync(target, JSON.stringify({ dataDir: '/x/y' }));
      fs.symlinkSync(target, file());
      expect(readHostConfig(file())).toEqual({
        status: 'invalid',
        error: 'is a symbolic link',
      });
    },
  );

  it('oversize (> 64 KiB) → invalid', () => {
    fs.writeFileSync(
      file(),
      JSON.stringify({ dataDir: '/x/y', pad: 'a'.repeat(70 * 1024) }),
    );
    expect(readHostConfig(file())).toEqual({
      status: 'invalid',
      error: 'file is too large',
    });
  });

  it('directory → invalid', () => {
    fs.mkdirSync(file());
    expect(readHostConfig(file()).status).toBe('invalid');
  });

  it('invalid content → invalid (same validation as config.json)', () => {
    const cases: [string, RegExp][] = [
      ['not json', /not valid JSON/],
      ['[1]', /JSON object/],
      ['{"dataDir": 5}', /non-empty string/],
      ['{"dataDir": "relative/path"}', /absolute/],
      ['{"dataDir": "/"}', /root/],
      ['{"dataDir": "C:\\\\"}', /root/],
      [JSON.stringify({ dataDir: '/a\0b' }), /NUL/],
    ];
    for (const [text, error] of cases) {
      fs.writeFileSync(file(), text);
      const read = readHostConfig(file());
      expect(read.status, text).toBe('invalid');
      expect(read.status === 'invalid' && read.error, text).toMatch(error);
    }
  });
});

describe('mismatch detection normalization', () => {
  it('trailing slashes, dot segments and duplicate separators', () => {
    expect(sameHostPath('/home/a/notes', '/home/a/notes/')).toBe(true);
    expect(sameHostPath('/home/a/./x/../notes', '/home/a//notes')).toBe(true);
    expect(sameHostPath('/home/a/notes', '/home/a/other')).toBe(false);
  });

  it('case-insensitive for macOS home/volume paths and Windows paths', () => {
    expect(sameHostPath('/Users/A/Notes', '/users/a/notes/')).toBe(true);
    expect(sameHostPath('/Volumes/Ext/n', '/volumes/ext/N')).toBe(true);
    expect(sameHostPath('C:\\Users\\A\\Notes\\', 'c:/users/a/notes')).toBe(
      true,
    );
  });

  it('case-sensitive for other POSIX (Linux) paths', () => {
    expect(sameHostPath('/home/a/Notes', '/home/a/notes')).toBe(false);
  });

  it('relative or empty paths cannot be judged', () => {
    expect(normalizeHostPath('notes')).toBeUndefined();
    expect(normalizeHostPath('')).toBeUndefined();
    expect(sameHostPath('notes', 'notes')).toBe(false);
  });
});

describe('dockerDataInfo', () => {
  const env = {
    IBAI_CONTAINER: '1',
    IBAI_HOST_DATA_DIR: '/Users/a/.interviewbudai/data',
  };

  it('undefined outside the container', () => {
    expect(
      dockerDataInfo({ env: {}, writable: { writable: true } }),
    ).toBeUndefined();
  });

  it('no banner when the host config is absent or points at the same folder', () => {
    expect(
      dockerDataInfo({
        env,
        writable: { writable: true },
        hostConfig: { status: 'absent' },
      }),
    ).toEqual({ hostDataDir: env.IBAI_HOST_DATA_DIR, writable: true });
    expect(
      dockerDataInfo({
        env,
        writable: { writable: true },
        hostConfig: { status: 'ok', dataDir: '/users/A/.interviewbudai/data/' },
      })?.hostConfigDataDir,
    ).toBeUndefined();
  });

  it('banner when the host config points elsewhere', () => {
    const info = dockerDataInfo({
      env,
      writable: { writable: true },
      hostConfig: { status: 'ok', dataDir: '/Users/a/Desktop/testBuai' },
    });
    expect(info?.hostConfigDataDir).toBe('/Users/a/Desktop/testBuai');
    expect(hostMismatchText('/Users/a/Desktop/testBuai')).toBe(
      'Your non-Docker setup uses /Users/a/Desktop/testBuai. To use the same notes in Docker, set IBAI_HOST_DATA_DIR=/Users/a/Desktop/testBuai in .env and restart.',
    );
  });

  it('invalid host config → no banner', () => {
    expect(
      dockerDataInfo({
        env,
        writable: { writable: true },
        hostConfig: { status: 'invalid', error: 'x' },
      })?.hostConfigDataDir,
    ).toBeUndefined();
  });

  it('not writable → help text naming the host folder', () => {
    const info = dockerDataInfo({
      env,
      writable: { writable: false, error: 'EACCES' },
      hostConfig: { status: 'absent' },
    });
    expect(info?.writable).toBe(false);
    expect(info?.writableHelp).toContain(
      'mkdir -p -m 700 /Users/a/.interviewbudai/data',
    );
  });
});

describe('handler under Docker (/api/data-dir, /setup)', () => {
  const PORT = 4173;
  const docker = {
    hostDataDir: '/Users/a/.interviewbudai/data',
    writable: true,
    hostConfigDataDir: '/Users/a/Desktop/testBuai',
  };
  const makeHandler = (): ((req: HandlerRequest) => Promise<HandlerResponse>) =>
    createCoachHandler({
      storage: new LocalFileStorageAdapter(tmp),
      catalog: createCatalogSource(),
      createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
      dataDir: tmp,
      dataDirSource: 'env',
      homeDir: tmp,
      env: {},
      argv: [],
      port: PORT,
      docker,
    });

  it('GET /api/data-dir carries the docker block', async () => {
    const res = await makeHandler()({
      method: 'GET',
      url: '/api/data-dir',
      headers: { host: `localhost:${PORT}` },
    });
    const body = JSON.parse(res.body) as DataDirStatus;
    expect(body.pinned).toBe(true);
    expect(body.docker).toEqual(docker);
  });

  it('switching is refused with the Docker copy; no config.json written', async () => {
    const res = await makeHandler()({
      method: 'POST',
      url: '/api/data-dir',
      contentType: 'application/json',
      body: JSON.stringify({ path: path.join(tmp, 'other') }),
      headers: { host: `localhost:${PORT}` },
    });
    expect(res.status).toBe(400);
    const { error } = JSON.parse(res.body) as { error: string };
    expect(error).toContain(
      'Pinned by Docker (IBAI_HOST_DATA_DIR=/Users/a/.interviewbudai/data)',
    );
    expect(error).toContain('set IBAI_HOST_DATA_DIR=<path> in .env');
    expect(fs.existsSync(path.join(tmp, '.interviewbudai'))).toBe(false);
  });

  it('banner lines name the Docker pin and the mismatch', () => {
    const lines = formatStartupBanner({
      url: 'http://localhost:4173',
      data: {
        dataDir: '/data',
        source: 'env',
        explicit: true,
        created: false,
        exists: true,
      },
      provider: { kind: 'none' },
      docker,
    });
    expect(lines[1]).toContain(
      '(pinned by Docker: IBAI_HOST_DATA_DIR=/Users/a/.interviewbudai/data)',
    );
    expect(lines[2]).toContain(
      'set IBAI_HOST_DATA_DIR=/Users/a/Desktop/testBuai',
    );
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function request(
  port: number,
  opts: { method: string; path: string; host: string; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        headers: {
          host: opts.host,
          ...(opts.body !== undefined && {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(opts.body),
          }),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

describe('startServer in container mode (loopback bind for the test)', () => {
  it('pins /data, checks writability, honours IBAI_PUBLIC_PORT', async () => {
    const listen = await freePort();
    const publicPort = listen === 65535 ? listen - 1 : listen + 1;
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { mode: 0o755 });
    const lines: string[] = [];
    const handle = await startServer({
      env: {
        IBAI_CONTAINER: '1',
        IBAI_BIND_HOST: '127.0.0.1',
        IBAI_DATA_DIR: dataDir,
        IBAI_WEB_PORT: String(listen),
        IBAI_PUBLIC_PORT: String(publicPort),
        IBAI_HOST_DATA_DIR: '/home/me/.interviewbudai/data',
      },
      argv: [],
      homeDir: tmp,
      log: (line) => lines.push(line),
    });
    try {
      expect(lines[0]).toBe(
        `InterviewBudAI is running at http://localhost:${publicPort}/`,
      );
      expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);

      // Healthcheck-style GET on the listen port works.
      const health = await request(listen, {
        method: 'GET',
        path: '/api/config',
        host: `127.0.0.1:${listen}`,
      });
      expect(health.status).toBe(200);

      // A write via the listen-port Host is refused (403) …
      const viaListen = await request(listen, {
        method: 'POST',
        path: '/api/data-dir/legacy/dismiss',
        host: `127.0.0.1:${listen}`,
        body: '{}',
      });
      expect(viaListen.status).toBe(403);

      // … and allowed via the public-port Host the browser sends.
      const viaPublic = await request(listen, {
        method: 'GET',
        path: '/api/data-dir',
        host: `localhost:${publicPort}`,
      });
      expect(viaPublic.status).toBe(200);
      const status = JSON.parse(viaPublic.body) as DataDirStatus;
      expect(status.docker).toEqual({
        hostDataDir: '/home/me/.interviewbudai/data',
        writable: true,
      });
    } finally {
      await handle.close();
    }
  });

  it.skipIf(isRoot || process.platform === 'win32')(
    'missing / unwritable /data → logs a clear error and reports it (no fallback)',
    async () => {
      // The bind source is missing (Docker Engine without create_host_path).
      const port = await freePort();
      const lines: string[] = [];
      const handle = await startServer({
        env: {
          IBAI_CONTAINER: '1',
          IBAI_DATA_DIR: path.join(tmp, 'missing'),
          IBAI_WEB_PORT: String(port),
        },
        argv: [],
        homeDir: tmp,
        log: (line) => lines.push(line),
      });
      try {
        expect(lines.some((l) => l.startsWith('Error: data folder'))).toBe(
          true,
        );
        const res = await request(port, {
          method: 'GET',
          path: '/api/data-dir',
          host: `localhost:${port}`,
        });
        const status = JSON.parse(res.body) as DataDirStatus;
        expect(status.docker?.writable).toBe(false);
        expect(status.docker?.writableHelp).toContain('not writable');
        expect(fs.existsSync(path.join(tmp, 'missing'))).toBe(false);
      } finally {
        await handle.close();
      }
    },
  );
});
