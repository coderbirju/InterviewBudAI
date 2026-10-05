#!/usr/bin/env node
/**
 * Release notes from CHANGELOG.md (ADR 0016 D2, ADR 0009 D5). Node built-ins only.
 *
 *   node scripts/release/changelog.mjs check --tag vX.Y.Z
 *     Fails unless CHANGELOG.md has a `## [X.Y.Z]` section that contains a
 *     `### Breaking changes` heading.
 *
 *   node scripts/release/changelog.mjs notes --tag vX.Y.Z --out notes.md
 *     Same check, then writes notes.md: notes-header.md with {{TAG}}
 *     replaced, followed by the CHANGELOG section.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

/** `vX.Y.Z` → `X.Y.Z`; throws on any other tag shape. */
export function versionFromTag(tag) {
  const m = TAG_RE.exec(tag ?? '');
  if (!m)
    throw new Error(`tag must look like vX.Y.Z, got ${JSON.stringify(tag)}`);
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * The body of `## [version]` (heading excluded) up to the next `## ` heading.
 * Throws when the section is missing or has no `### Breaking changes`.
 */
export function extractSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = `## [${version}]`;
  const start = lines.findIndex(
    (l) =>
      l === heading || (l.startsWith(heading) && /\s/.test(l[heading.length])),
  );
  if (start === -1) {
    throw new Error(
      `CHANGELOG.md has no "${heading}" section; rename [Unreleased] first`,
    );
  }
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end);
  if (!body.some((l) => /^### Breaking changes\s*$/.test(l))) {
    throw new Error(
      `CHANGELOG.md "${heading}" has no "### Breaking changes" heading (write "None." if empty)`,
    );
  }
  return body.join('\n').trim() + '\n';
}

/** Install block (with {{TAG}} filled in) followed by the CHANGELOG section. */
export function renderNotes(headerTemplate, tag, section) {
  versionFromTag(tag);
  return `${headerTemplate.replaceAll('{{TAG}}', tag).trimEnd()}\n\n${section}`;
}

function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

export function main(argv, root = REPO_ROOT) {
  const [command, ...rest] = argv;
  const tag = flag(rest, 'tag');
  const version = versionFromTag(tag);
  const section = extractSection(
    fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
    version,
  );
  if (command === 'check') return section;
  if (command === 'notes') {
    const out = flag(rest, 'out');
    if (!out) throw new Error('notes needs --out <file>');
    const header = fs.readFileSync(
      path.join(root, 'scripts/release/notes-header.md'),
      'utf8',
    );
    const notes = renderNotes(header, tag, section);
    fs.writeFileSync(out, notes);
    return notes;
  }
  throw new Error(
    'usage: changelog.mjs check|notes --tag vX.Y.Z [--out notes.md]',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2));
    console.log('CHANGELOG section OK.');
  } catch (err) {
    console.error(
      `::error::${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}
