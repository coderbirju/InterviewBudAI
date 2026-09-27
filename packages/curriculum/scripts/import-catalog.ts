#!/usr/bin/env node
/**
 * ONE-OFF IMPORT SCRIPT - Development only, NOT shipped with the library.
 *
 * This script reads the founder's Notion export directory structure and derives
 * catalog identity data (id, title, url, difficulty, topics) from filenames ONLY.
 * It NEVER reads file contents - no notes, intuitions, or answers are processed.
 *
 * Location: packages/curriculum/scripts/import-catalog.ts
 * This is OUTSIDE src/ so it is excluded from:
 *   - The compiled dist/ output (tsconfig rootDir: src)
 *   - The vitest test includes (test files under each package src dir)
 *   - The shipped npm package
 *
 * Usage:
 *   npx tsx packages/curriculum/scripts/import-catalog.ts [source-path]
 *
 *   source-path: Root directory of the Notion export (default: founder's path)
 *
 * Output:
 *   Prints derived catalog data and a summary of skips/duplicates.
 *   To update the catalog: copy the output to src/catalog.ts or pipe to file.
 *
 * Topic mapping (13-topic taxonomy, ADR 0003 amendment 2026-09-26):
 *   See ./topic-mapping.ts — FOLDER_TOPIC_MAP (Notion folder -> topic id) plus
 *   PROBLEM_TOPIC_OVERRIDES (per-problem-id moves a folder cannot express,
 *   e.g. Recursion -> backtracking for lc-17/39/46/47/77/78, lc-79 Trees ->
 *   backtracking, and the six former `Problems`/miscellaneous re-homings).
 *   A problem found in several folders gets their topics merged (de-duplicated).
 *   src/import-mapping.test.ts proves the mapping reproduces the current
 *   catalog's `topics` for all 175 problems.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FOLDER_TOPIC_MAP, mapTopics } from './topic-mapping.js';

const NOTION_HASH_PATTERN = /\s+[a-f0-9]{32}$/i;

interface ParsedEntry {
  number: number;
  title: string;
  folderName: string;
}

interface CatalogEntry {
  number: number;
  title: string;
  folders: string[];
  topics: readonly string[];
}

interface SkippedEntry {
  filename: string;
  folder: string;
  reason: string;
}

function parseFilename(filename: string, folderName: string): ParsedEntry | SkippedEntry {
  if (!filename.endsWith('.md')) {
    return { filename, folder: folderName, reason: 'not-markdown' };
  }

  let name = filename.slice(0, -3);
  name = name.replace(NOTION_HASH_PATTERN, '');

  if (!name.trim() || name.toLowerCase() === 'untitled') {
    return { filename, folder: folderName, reason: 'empty-or-untitled' };
  }

  const match = name.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return { filename, folder: folderName, reason: 'no-leading-number' };
  }

  const number = parseInt(match[1], 10);
  const title = match[2].trim();

  return { number, title, folderName };
}

function main() {
  const sourcePath = process.argv[2] || process.env.IMPORT_SOURCE_PATH;

  if (!sourcePath) {
    console.error('Usage: npx tsx import-catalog.ts <source-path>');
    console.error('  or set IMPORT_SOURCE_PATH environment variable');
    process.exit(1);
  }

  if (!fs.existsSync(sourcePath)) {
    console.error(`Source path does not exist: ${sourcePath}`);
    process.exit(1);
  }

  const entries: ParsedEntry[] = [];
  const skipped: SkippedEntry[] = [];
  let totalFiles = 0;

  const topFolders = fs.readdirSync(sourcePath, { withFileTypes: true });

  for (const folder of topFolders) {
    if (!folder.isDirectory()) continue;
    if (!Object.prototype.hasOwnProperty.call(FOLDER_TOPIC_MAP, folder.name)) {
      console.warn(`Skipping unknown folder: ${folder.name}`);
      continue;
    }

    const folderPath = path.join(sourcePath, folder.name);
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
      totalFiles++;
      const result = parseFilename(file, folder.name);

      if ('reason' in result) {
        skipped.push(result);
      } else {
        entries.push(result);
      }
    }
  }

  // Group by problem number (a problem may sit in several folders), then map
  // its folder(s) to topics (per-id override first).
  const byNumber = new Map<number, { title: string; folders: string[] }>();
  for (const e of entries) {
    const g = byNumber.get(e.number) ?? { title: e.title, folders: [] };
    if (!g.folders.includes(e.folderName)) g.folders.push(e.folderName);
    byNumber.set(e.number, g);
  }
  const catalog: CatalogEntry[] = [];
  for (const [number, g] of byNumber) {
    const mapped = mapTopics(`lc-${number}`, g.folders);
    if (mapped.ok) {
      catalog.push({ number, title: g.title, folders: g.folders, topics: mapped.topics });
    } else {
      skipped.push({ filename: `lc-${number} ${g.title}`, folder: mapped.folder, reason: mapped.reason });
    }
  }

  console.log('\n=== IMPORT SUMMARY ===');
  console.log(`Total files scanned: ${totalFiles}`);
  console.log(`Entries parsed: ${entries.length}`);
  console.log(`Problems (merged by number): ${catalog.length}`);
  console.log(`Entries skipped: ${skipped.length}`);

  console.log('\n=== SKIPPED ENTRIES ===');
  for (const s of skipped) {
    console.log(`  [${s.reason}] ${s.folder}/${s.filename}`);
  }

  console.log('\n=== PROBLEMS (sorted by number) ===');
  catalog.sort((a, b) => a.number - b.number);
  for (const e of catalog) {
    const merged = e.folders.length > 1 ? ` (merged: ${e.folders.join(', ')})` : '';
    console.log(`  lc-${e.number}: ${e.title} [${e.topics.join(', ')}]${merged}`);
  }
}

main();
