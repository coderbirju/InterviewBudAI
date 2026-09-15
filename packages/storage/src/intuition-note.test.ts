/**
 * Tests for IntuitionNote persistence in LocalFileStorageAdapter.
 *
 * All tests use temp directories, no network, and clean up after themselves.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileStorageAdapter } from './local-file-adapter.js';
import type { IntuitionNote } from './index.js';

describe('LocalFileStorageAdapter - IntuitionNote methods', () => {
  let tempDir: string;
  let adapter: LocalFileStorageAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ibai-storage-test-'));
    adapter = new LocalFileStorageAdapter(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('write -> read round-trip', () => {
    it('preserves content body and frontmatter exactly', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-1',
        content: 'Use a hash map to find complement in O(1).\n\nMulti-line content here.',
        lastUpdated: '2026-09-13T10:00:00.000Z',
        attempts: 3,
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-1');

      expect(result).not.toBeNull();
      expect(result!.problemId).toBe('lc-1');
      expect(result!.content).toBe(note.content);
      expect(result!.lastUpdated).toBe('2026-09-13T10:00:00.000Z');
      expect(result!.attempts).toBe(3);
    });
  });

  describe('read missing note', () => {
    it('returns null for non-existent problem', async () => {
      const result = await adapter.readIntuitionNote('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('overwrite/edit by same id', () => {
    it('second write updates content and lastUpdated', async () => {
      const note1: IntuitionNote = {
        problemId: 'lc-42',
        content: 'Original content',
        lastUpdated: '2026-09-01T10:00:00.000Z',
        attempts: 1,
      };

      const note2: IntuitionNote = {
        problemId: 'lc-42',
        content: 'Updated content with new insights',
        lastUpdated: '2026-09-13T15:30:00.000Z',
        attempts: 5,
      };

      await adapter.writeIntuitionNote(note1);
      await adapter.writeIntuitionNote(note2);

      const result = await adapter.readIntuitionNote('lc-42');

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Updated content with new insights');
      expect(result!.lastUpdated).toBe('2026-09-13T15:30:00.000Z');
      expect(result!.attempts).toBe(5);
    });
  });

  describe('path traversal protection', () => {
    it('neutralizes ../etc/passwd traversal attempt', async () => {
      const maliciousId = '../../etc/passwd';
      const note: IntuitionNote = {
        problemId: maliciousId,
        content: 'Malicious content',
        lastUpdated: '2026-09-13T10:00:00.000Z',
      };

      await adapter.writeIntuitionNote(note);

      // Verify file was written inside notes/ dir with sanitized name
      const sanitizedPath = join(tempDir, 'notes', 'etcpasswd.md');
      const fileContent = await readFile(sanitizedPath, 'utf-8');
      expect(fileContent).toContain('Malicious content');

      // Verify no file was created outside the temp dir
      // (if traversal worked, file would be at /etc/passwd or similar)
    });

    it('neutralizes ..\\..\\x Windows-style traversal', async () => {
      const maliciousId = '..\\..\\x';
      const note: IntuitionNote = {
        problemId: maliciousId,
        content: 'Windows traversal attempt',
        lastUpdated: '2026-09-13T10:00:00.000Z',
      };

      await adapter.writeIntuitionNote(note);

      // Should be sanitized and stored safely
      const result = await adapter.readIntuitionNote(maliciousId);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('Windows traversal attempt');
    });

    it('neutralizes a/b slash in problemId', async () => {
      const maliciousId = 'a/b';
      const note: IntuitionNote = {
        problemId: maliciousId,
        content: 'Slash in id',
        lastUpdated: '2026-09-13T10:00:00.000Z',
      };

      await adapter.writeIntuitionNote(note);

      // Should be sanitized to 'ab'
      const sanitizedPath = join(tempDir, 'notes', 'ab.md');
      const fileContent = await readFile(sanitizedPath, 'utf-8');
      expect(fileContent).toContain('Slash in id');
    });
  });

  describe('malformed file handling', () => {
    it('handles file with no frontmatter gracefully', async () => {
      // Pre-write a garbled .md file with no frontmatter
      const notesDir = join(tempDir, 'notes');
      await mkdir(notesDir, { recursive: true });
      await writeFile(
        join(notesDir, 'garbled.md'),
        'Just some content without any frontmatter\nMultiple lines here',
        'utf-8',
      );

      const result = await adapter.readIntuitionNote('garbled');

      // Should return best-effort note, not throw
      expect(result).not.toBeNull();
      expect(result!.problemId).toBe('garbled');
      expect(result!.content).toContain('Just some content');
    });

    it('handles file with broken frontmatter (no closing ---)', async () => {
      const notesDir = join(tempDir, 'notes');
      await mkdir(notesDir, { recursive: true });
      await writeFile(
        join(notesDir, 'broken.md'),
        '---\nid: broken\nlastUpdated: 2026-01-01\nThis line has no closing delimiter\nMore content',
        'utf-8',
      );

      const result = await adapter.readIntuitionNote('broken');

      // Should not throw, returns best-effort
      expect(result).not.toBeNull();
      expect(result!.problemId).toBe('broken');
    });

    it('handles empty file by returning null', async () => {
      const notesDir = join(tempDir, 'notes');
      await mkdir(notesDir, { recursive: true });
      await writeFile(join(notesDir, 'empty.md'), '', 'utf-8');

      const result = await adapter.readIntuitionNote('empty');
      expect(result).toBeNull();
    });
  });

  describe('attempts field handling', () => {
    it('omits attempts line when undefined and reads back as undefined', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-100',
        content: 'No attempts tracked',
        lastUpdated: '2026-09-13T10:00:00.000Z',
        // attempts is intentionally undefined
      };

      await adapter.writeIntuitionNote(note);

      // Verify file doesn't have attempts line
      const filePath = join(tempDir, 'notes', 'lc-100.md');
      const fileContent = await readFile(filePath, 'utf-8');
      expect(fileContent).not.toContain('attempts:');

      // Verify read returns undefined attempts
      const result = await adapter.readIntuitionNote('lc-100');
      expect(result).not.toBeNull();
      expect(result!.attempts).toBeUndefined();
    });
  });
});
