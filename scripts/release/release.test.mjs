import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  versionFromTag,
  extractSection,
  renderNotes,
  main,
} from './changelog.mjs';
import {
  forbiddenBundleInputs,
  releasePackageJson,
  bundleOptions,
  ROOT_FILES,
} from './build-zip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Next thing.

## [0.2.0] - 2026-10-04

### Breaking changes

None.

### Added

- The release zip.

## [0.1.0] - 2026-09-01

### Added

- First.
`;

describe('versionFromTag', () => {
  it('accepts vX.Y.Z only', () => {
    expect(versionFromTag('v0.2.0')).toBe('0.2.0');
    expect(versionFromTag('v10.20.30')).toBe('10.20.30');
    for (const bad of [
      '0.2.0',
      'v0.2',
      'v0.2.0-rc.1',
      'v0.2.0;rm',
      '',
      undefined,
    ]) {
      expect(() => versionFromTag(bad)).toThrow(/vX\.Y\.Z/);
    }
  });
});

describe('extractSection', () => {
  it('returns the section body up to the next ## heading', () => {
    expect(extractSection(CHANGELOG, '0.2.0')).toBe(
      '### Breaking changes\n\nNone.\n\n### Added\n\n- The release zip.\n',
    );
  });

  it('fails when the section is missing', () => {
    expect(() => extractSection(CHANGELOG, '0.3.0')).toThrow(
      /no "## \[0\.3\.0\]" section/,
    );
    // A prefix must not match ([0.2.0] vs [0.2.01]).
    expect(() =>
      extractSection('## [0.2.01]\n\n### Breaking changes\n', '0.2.0'),
    ).toThrow(/section/);
  });

  it('fails when the section has no ### Breaking changes heading', () => {
    expect(() => extractSection(CHANGELOG, '0.1.0')).toThrow(
      /Breaking changes/,
    );
    // A Breaking changes heading in ANOTHER section does not count.
    expect(() =>
      extractSection(
        '## [0.1.0]\n\n### Added\n\n## [0.0.9]\n\n### Breaking changes\n',
        '0.1.0',
      ),
    ).toThrow(/Breaking changes/);
  });

  it('handles CRLF line endings', () => {
    expect(extractSection(CHANGELOG.replace(/\n/g, '\r\n'), '0.2.0')).toMatch(
      /^### Breaking changes\n\nNone\./,
    );
  });
});

describe('release notes', () => {
  it('puts the Install block with the tag first, then the section', () => {
    const header = fs.readFileSync(path.join(HERE, 'notes-header.md'), 'utf8');
    const notes = renderNotes(
      header,
      'v0.2.0',
      extractSection(CHANGELOG, '0.2.0'),
    );
    expect(notes).toContain(
      'Download `interviewbudai-v0.2.0.zip`, unzip it, and run `node interviewbudai-v0.2.0/dist/server.js` (Node ≥ 20.12).',
    );
    expect(notes).not.toContain('{{TAG}}');
    expect(notes.indexOf('## Install')).toBe(0);
    expect(notes.indexOf('### Breaking changes')).toBeGreaterThan(
      notes.indexOf('dist/server.js'),
    );
  });

  describe('main', () => {
    let tmp;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-release-'));
      fs.mkdirSync(path.join(tmp, 'scripts/release'), { recursive: true });
      fs.copyFileSync(
        path.join(HERE, 'notes-header.md'),
        path.join(tmp, 'scripts/release/notes-header.md'),
      );
      fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), CHANGELOG);
    });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it('check passes, notes writes the file, a bad section fails', () => {
      expect(main(['check', '--tag', 'v0.2.0'], tmp)).toMatch(
        /Breaking changes/,
      );
      const out = path.join(tmp, 'notes.md');
      main(['notes', '--tag', 'v0.2.0', '--out', out], tmp);
      expect(fs.readFileSync(out, 'utf8')).toMatch(
        /^## Install[\s\S]*The release zip\./,
      );
      expect(() => main(['check', '--tag', 'v0.1.0'], tmp)).toThrow(
        /Breaking changes/,
      );
      expect(() => main(['check', '--tag', 'v9.9.9'], tmp)).toThrow(/section/);
    });
  });
});

describe('release bundle', () => {
  it('flags SPA-only packages among the bundle inputs', () => {
    expect(
      forbiddenBundleInputs([
        'packages/web/dist/server.js',
        'packages/core/dist/index.js',
        'node_modules/htmlparser2/lib/esm/index.js',
        'node_modules/react/index.js',
        'node_modules/react-dom/client.js',
        'node_modules/lucide-react/dist/esm/icons/x.js',
        'node_modules/@codemirror/view/dist/index.js',
        'node_modules\\@lezer\\common\\dist\\index.js',
        'node_modules/react-is/index.js',
      ]),
    ).toEqual([
      'node_modules/react/index.js',
      'node_modules/react-dom/client.js',
      'node_modules/lucide-react/dist/esm/icons/x.js',
      'node_modules/@codemirror/view/dist/index.js',
      'node_modules\\@lezer\\common\\dist\\index.js',
    ]);
  });

  it('bundles server-bin into one ESM file for Node 20.12 with the bundled flag', () => {
    const o = bundleOptions('/repo', '/out/dist/server.js');
    expect(o).toMatchObject({
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20.12',
      define: { __IBAI_BUNDLED__: 'true' },
      outfile: '/out/dist/server.js',
    });
    expect(o.entryPoints).toEqual([
      path.join('/repo', 'packages/web/dist/server-bin.js'),
    ]);
  });

  it('writes a package.json with the release version and copies no .env', () => {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    );
    expect(releasePackageJson('0.2.0', rootPkg)).toEqual({
      name: 'interviewbudai',
      version: '0.2.0',
      private: true,
      description: rootPkg.description,
      license: 'MIT',
      type: 'module',
      engines: { node: '>=20.12' },
    });
    expect(ROOT_FILES).not.toContain('.env');
    for (const f of ROOT_FILES)
      expect(fs.existsSync(path.join(REPO_ROOT, f))).toBe(true);
  });

  it('pins esbuild 0.21.5 exactly as a root devDependency', () => {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    );
    expect(rootPkg.devDependencies.esbuild).toBe('0.21.5');
  });
});
