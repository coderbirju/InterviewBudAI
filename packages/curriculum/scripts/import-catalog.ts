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
 *   - The vitest test includes (src/**/*.test.ts)
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
 * Topic mapping (folder name -> topic id):
 *   Arrays 2D -> arrays-2d
 *   Binary Search -> binary-search
 *   DP -> dynamic-programming
 *   DP - HARD -> dynamic-programming
 *   Graphs -> graphs
 *   Greedy -> greedy
 *   Hashing -> hashing
 *   Heap -> heap
 *   Linked List -> linked-list
 *   Problems -> miscellaneous
 *   Recursion -> recursion
 *   Sliding Window -> sliding-window
 *   Sorting -> sorting
 *   Stack and Queue -> stack
 *   Trees -> trees
 *   Two Pointers -> two-pointers
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const TOPIC_MAP: Record<string, string> = {
  'Arrays 2D': 'arrays-2d',
  'Binary Search': 'binary-search',
  'DP': 'dynamic-programming',
  'DP - HARD': 'dynamic-programming',
  'Graphs': 'graphs',
  'Greedy': 'greedy',
  'Hashing': 'hashing',
  'Heap': 'heap',
  'Linked List': 'linked-list',
  'Problems': 'miscellaneous',
  'Recursion': 'recursion',
  'Sliding Window': 'sliding-window',
  'Sorting': 'sorting',
  'Stack and Queue': 'stack',
  'Trees': 'trees',
  'Two Pointers': 'two-pointers',
};

const NOTION_HASH_PATTERN = /\s+[a-f0-9]{32}$/i;

interface ParsedEntry {
  number: number;
  title: string;
  topicId: string;
  folderName: string;
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

  const topicId = TOPIC_MAP[folderName];
  if (!topicId) {
    return { filename, folder: folderName, reason: 'unknown-topic-folder' };
  }

  return { number, title, topicId, folderName };
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
    if (!TOPIC_MAP[folder.name]) {
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

  console.log('\n=== IMPORT SUMMARY ===');
  console.log(`Total files scanned: ${totalFiles}`);
  console.log(`Entries parsed: ${entries.length}`);
  console.log(`Entries skipped: ${skipped.length}`);

  console.log('\n=== SKIPPED ENTRIES ===');
  for (const s of skipped) {
    console.log(`  [${s.reason}] ${s.folder}/${s.filename}`);
  }

  console.log('\n=== PARSED ENTRIES (sorted by number) ===');
  entries.sort((a, b) => a.number - b.number);
  for (const e of entries) {
    console.log(`  lc-${e.number}: ${e.title} [${e.topicId}]`);
  }
}

main();
