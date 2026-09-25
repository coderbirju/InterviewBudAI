import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  prepareBootDataDir,
  resolveProviderStatus,
  loadDotEnv,
  defaultDataDirFor,
} from './config.js';
import {
  startServer,
  formatStartupBanner,
  NO_PROVIDER_MESSAGE,
} from './server.js';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-boot-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
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

describe('prepareBootDataDir', () => {
  it('creates the default data dir (0700) on first run', () => {
    const expected = defaultDataDirFor(tmpHome);
    expect(fs.existsSync(expected)).toBe(false);

    const result = prepareBootDataDir({}, [], tmpHome);

    expect(result).toEqual({
      dataDir: expected,
      explicit: false,
      created: true,
      exists: true,
    });
    expect(fs.statSync(expected).isDirectory()).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(expected).mode & 0o777).toBe(0o700);
    }
  });

  it('does not re-create or report creation when the default exists', () => {
    fs.mkdirSync(defaultDataDirFor(tmpHome), { recursive: true });
    const result = prepareBootDataDir({}, [], tmpHome);
    expect(result.created).toBe(false);
    expect(result.exists).toBe(true);
  });

  it('does NOT create an explicit IBAI_DATA_DIR that is missing', () => {
    const explicitDir = path.join(tmpHome, 'custom', 'data');
    const result = prepareBootDataDir(
      { IBAI_DATA_DIR: explicitDir },
      [],
      tmpHome,
    );
    expect(result).toEqual({
      dataDir: explicitDir,
      explicit: true,
      created: false,
      exists: false,
    });
    expect(fs.existsSync(explicitDir)).toBe(false);
    // Nor the default.
    expect(fs.existsSync(defaultDataDirFor(tmpHome))).toBe(false);
  });

  it('does NOT create a missing --data-dir flag path', () => {
    const flagDir = path.join(tmpHome, 'flag-dir');
    const result = prepareBootDataDir({}, [`--data-dir=${flagDir}`], tmpHome);
    expect(result.explicit).toBe(true);
    expect(result.created).toBe(false);
    expect(fs.existsSync(flagDir)).toBe(false);
  });
});

describe('resolveProviderStatus', () => {
  it('reports Anthropic when key + model are set', () => {
    expect(
      resolveProviderStatus({
        ANTHROPIC_API_KEY: 'sk-ant-secret',
        IBAI_ANTHROPIC_MODEL: 'claude-x',
      }),
    ).toEqual({ kind: 'anthropic', model: 'claude-x' });
  });

  it('reports Ollama when only the Ollama model is set', () => {
    expect(resolveProviderStatus({ IBAI_OLLAMA_MODEL: 'llama3' })).toEqual({
      kind: 'ollama',
      model: 'llama3',
    });
  });

  it('reports none with a hint when the key is set but model missing', () => {
    const status = resolveProviderStatus({ ANTHROPIC_API_KEY: 'sk-secret' });
    expect(status.kind).toBe('none');
    expect(JSON.stringify(status)).not.toContain('sk-secret');
  });
});

describe('formatStartupBanner', () => {
  const data = {
    dataDir: '/tmp/x',
    explicit: false,
    created: true,
    exists: true,
  };

  it('shows the URL, data dir, and the no-model message', () => {
    const text = formatStartupBanner({
      url: 'http://127.0.0.1:4173',
      data,
      provider: { kind: 'none' },
    }).join('\n');
    expect(text).toContain('http://127.0.0.1:4173/');
    expect(text).toContain('/tmp/x (created on first run)');
    expect(text).toContain(NO_PROVIDER_MESSAGE);
  });

  it('flags a missing explicit data dir', () => {
    const text = formatStartupBanner({
      url: 'http://127.0.0.1:4173',
      data: { ...data, explicit: true, created: false, exists: false },
      provider: { kind: 'ollama', model: 'llama3' },
    }).join('\n');
    expect(text).toContain('does not exist yet');
    expect(text).toContain('Ollama (model: llama3)');
  });
});

describe('startServer boot', () => {
  it('binds 127.0.0.1, creates the default dir, and never logs secrets', async () => {
    const port = await freePort();
    const lines: string[] = [];
    const secret = 'sk-ant-TOPSECRET-123';
    const handle = await startServer({
      env: { ANTHROPIC_API_KEY: secret, IBAI_ANTHROPIC_MODEL: 'claude-test' },
      argv: [`--port=${port}`],
      homeDir: tmpHome,
      log: (line) => lines.push(line),
    });
    try {
      expect(handle.url).toBe(`http://127.0.0.1:${port}`);
      expect(fs.existsSync(defaultDataDirFor(tmpHome))).toBe(true);
      const text = lines.join('\n');
      expect(text).toContain(`http://127.0.0.1:${port}/`);
      expect(text).toContain('Anthropic (model: claude-test)');
      expect(text).not.toContain(secret);
      expect(text).not.toContain('TOPSECRET');
    } finally {
      await handle.close();
    }
  });

  it('prints the no-model message when no provider is configured', async () => {
    const port = await freePort();
    const lines: string[] = [];
    const dataDir = path.join(tmpHome, 'explicit');
    const handle = await startServer({
      env: { IBAI_DATA_DIR: dataDir },
      argv: [`--port=${port}`],
      homeDir: tmpHome,
      log: (line) => lines.push(line),
    });
    try {
      expect(lines.join('\n')).toContain(NO_PROVIDER_MESSAGE);
      expect(fs.existsSync(dataDir)).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it('rejects instead of hanging when the port is taken', async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', r));
    try {
      await expect(
        startServer({
          env: {},
          argv: [`--port=${port}`],
          homeDir: tmpHome,
          log: () => undefined,
        }),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});

describe('loadDotEnv', () => {
  it('is a no-op when the file is absent', () => {
    expect(loadDotEnv(path.join(tmpHome, '.env'))).toBe('absent');
  });

  it('loads via process.loadEnvFile when present', () => {
    const file = path.join(tmpHome, '.env');
    fs.writeFileSync(file, 'X=1\n');
    const loaded: string[] = [];
    expect(loadDotEnv(file, { loadEnvFile: (p) => loaded.push(p) })).toBe(
      'loaded',
    );
    expect(loaded).toEqual([file]);
  });

  it('reports unsupported on Node versions without loadEnvFile', () => {
    const file = path.join(tmpHome, '.env');
    fs.writeFileSync(file, 'X=1\n');
    expect(loadDotEnv(file, {})).toBe('unsupported');
  });
});
