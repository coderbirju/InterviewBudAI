#!/usr/bin/env node
/**
 * Build the release zip (ADR 0016 D2).
 *
 *   node scripts/release/build-zip.mjs --tag vX.Y.Z --out <dir>
 *
 * Needs `npm run build` first (packages/web/dist and dist-ui). Bundles
 * packages/web/dist/server-bin.js and its runtime dependencies into one ESM
 * file with esbuild (pinned devDependency), then writes
 * <dir>/interviewbudai-vX.Y.Z.zip with this layout:
 *
 *   interviewbudai-vX.Y.Z/
 *     dist/server.js  dist-ui/  package.json  .env.example
 *     README.md  LICENSE  CHANGELOG.md
 *
 * The zip holds no user data, no .env and no LeetCode text.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { versionFromTag } from './changelog.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** Packages that may only appear in the built SPA, never in the server bundle. */
export const SPA_ONLY_PACKAGES = [
  'react',
  'react-dom',
  'lucide-react',
  '@codemirror/',
  '@lezer/',
];

/** Files copied from the repo root into the zip folder. */
export const ROOT_FILES = [
  '.env.example',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
];

/** The zip's package.json: what settings.ts reads for the version. */
export function releasePackageJson(version, rootPkg) {
  return {
    name: 'interviewbudai',
    version,
    private: true,
    description: rootPkg.description,
    license: rootPkg.license,
    type: 'module',
    engines: rootPkg.engines,
  };
}

/**
 * Bundle inputs (esbuild metafile keys) that must not be in the server
 * bundle: SPA-only packages. Returns the offending inputs.
 */
export function forbiddenBundleInputs(inputs) {
  return inputs.filter((file) => {
    const norm = file.replace(/\\/g, '/');
    const i = norm.lastIndexOf('node_modules/');
    if (i === -1) return false;
    const pkgPath = norm.slice(i + 'node_modules/'.length);
    return SPA_ONLY_PACKAGES.some((p) =>
      p.endsWith('/')
        ? pkgPath.startsWith(p)
        : pkgPath === p || pkgPath.startsWith(`${p}/`),
    );
  });
}

/** The esbuild options for the one-file server bundle. */
export function bundleOptions(root, outfile) {
  return {
    absWorkingDir: root,
    entryPoints: [path.join(root, 'packages/web/dist/server-bin.js')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    define: { __IBAI_BUNDLED__: 'true' },
    metafile: true,
    logLevel: 'warning',
  };
}

export async function buildZip({ tag, out, root = REPO_ROOT }) {
  const version = versionFromTag(tag);
  const name = `interviewbudai-${tag}`;
  const outDir = path.resolve(out);
  const stage = path.join(outDir, name);
  const zipFile = path.join(outDir, `${name}.zip`);
  for (const required of [
    'packages/web/dist/server-bin.js',
    'packages/web/dist-ui/index.html',
  ]) {
    if (!fs.existsSync(path.join(root, required))) {
      throw new Error(`${required} is missing; run \`npm run build\` first`);
    }
  }
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(zipFile, { force: true });
  fs.mkdirSync(path.join(stage, 'dist'), { recursive: true });

  const esbuild = await import('esbuild');
  const result = await esbuild.build(
    bundleOptions(root, path.join(stage, 'dist', 'server.js')),
  );
  const bad = forbiddenBundleInputs(Object.keys(result.metafile.inputs));
  if (bad.length > 0) {
    throw new Error(
      `SPA-only packages ended up in the server bundle: ${bad.join(', ')}`,
    );
  }

  fs.cpSync(
    path.join(root, 'packages/web/dist-ui'),
    path.join(stage, 'dist-ui'),
    {
      recursive: true,
    },
  );
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  fs.writeFileSync(
    path.join(stage, 'package.json'),
    `${JSON.stringify(releasePackageJson(version, rootPkg), null, 2)}\n`,
  );
  for (const f of ROOT_FILES)
    fs.copyFileSync(path.join(root, f), path.join(stage, f));

  const zip = spawnSync('zip', ['-r', '-X', '-q', zipFile, name], {
    cwd: outDir,
    stdio: 'inherit',
  });
  if (zip.error) throw zip.error;
  if (zip.status !== 0) throw new Error(`zip exited with ${zip.status}`);
  return { zipFile, stage };
}

function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  buildZip({ tag: flag(args, 'tag'), out: flag(args, 'out') ?? '.' })
    .then(({ zipFile }) => console.log(`Built ${zipFile}`))
    .catch((err) => {
      console.error(
        `::error::${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    });
}
