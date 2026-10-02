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
        content:
          'Use a hash map to find complement in O(1).\n\nMulti-line content here.',
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

  describe('completed field handling', () => {
    it('round-trips completed: true', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-200',
        content: 'Solved using sliding window',
        lastUpdated: '2026-09-15T10:00:00.000Z',
        completed: true,
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-200');

      expect(result).not.toBeNull();
      expect(result!.completed).toBe(true);
    });

    it('round-trips completed: false', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-201',
        content: 'Still working on it',
        lastUpdated: '2026-09-15T10:00:00.000Z',
        completed: false,
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-201');

      expect(result).not.toBeNull();
      expect(result!.completed).toBe(false);
    });

    it('omits completed line when undefined', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-202',
        content: 'No completion status',
        lastUpdated: '2026-09-15T10:00:00.000Z',
      };

      await adapter.writeIntuitionNote(note);

      const filePath = join(tempDir, 'notes', 'lc-202.md');
      const fileContent = await readFile(filePath, 'utf-8');
      expect(fileContent).not.toContain('completed:');

      const result = await adapter.readIntuitionNote('lc-202');
      expect(result!.completed).toBeUndefined();
    });
  });

  describe('complexity fields handling', () => {
    it('round-trips timeComplexity and spaceComplexity', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-300',
        content: 'Optimal solution found',
        lastUpdated: '2026-09-15T10:00:00.000Z',
        timeComplexity: 'O(n log n)',
        spaceComplexity: 'O(1)',
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-300');

      expect(result).not.toBeNull();
      expect(result!.timeComplexity).toBe('O(n log n)');
      expect(result!.spaceComplexity).toBe('O(1)');
    });

    it('handles complexity values with special chars (quotes)', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-301',
        content: 'Testing quotes',
        lastUpdated: '2026-09-15T10:00:00.000Z',
        timeComplexity: 'O(n) "amortized"',
        spaceComplexity: 'O(1) "in-place"',
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-301');

      expect(result).not.toBeNull();
      expect(result!.timeComplexity).toBe('O(n) "amortized"');
      expect(result!.spaceComplexity).toBe('O(1) "in-place"');
    });

    it('omits complexity lines when undefined', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-302',
        content: 'No complexity info',
        lastUpdated: '2026-09-15T10:00:00.000Z',
      };

      await adapter.writeIntuitionNote(note);

      const filePath = join(tempDir, 'notes', 'lc-302.md');
      const fileContent = await readFile(filePath, 'utf-8');
      expect(fileContent).not.toContain('timeComplexity:');
      expect(fileContent).not.toContain('spaceComplexity:');

      const result = await adapter.readIntuitionNote('lc-302');
      expect(result!.timeComplexity).toBeUndefined();
      expect(result!.spaceComplexity).toBeUndefined();
    });
  });

  describe('all new fields combined', () => {
    it('round-trips note with all fields', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-400',
        content: 'Full solution with all metadata',
        lastUpdated: '2026-09-15T12:00:00.000Z',
        attempts: 5,
        completed: true,
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)',
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-400');

      expect(result).not.toBeNull();
      expect(result!.problemId).toBe('lc-400');
      expect(result!.content).toBe('Full solution with all metadata');
      expect(result!.lastUpdated).toBe('2026-09-15T12:00:00.000Z');
      expect(result!.attempts).toBe(5);
      expect(result!.completed).toBe(true);
      expect(result!.timeComplexity).toBe('O(n)');
      expect(result!.spaceComplexity).toBe('O(n)');
    });
  });

  describe('status field handling', () => {
    it("round-trips status: 'done' (and keeps completed true)", async () => {
      const note: IntuitionNote = {
        problemId: 'lc-500',
        content: 'Solved cleanly',
        lastUpdated: '2026-09-20T10:00:00.000Z',
        status: 'done',
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-500');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('done');
      // status 'done' <=> completed true (consistency invariant)
      expect(result!.completed).toBe(true);
    });

    it("round-trips status: 'to_revisit' (completed false)", async () => {
      const note: IntuitionNote = {
        problemId: 'lc-501',
        content: 'Need another pass on the edge cases',
        lastUpdated: '2026-09-20T10:00:00.000Z',
        status: 'to_revisit',
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-501');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('to_revisit');
      expect(result!.completed).toBe(false);
    });

    it("round-trips status: 'did_not_understand'", async () => {
      const note: IntuitionNote = {
        problemId: 'lc-502',
        content: 'DP still confusing',
        lastUpdated: '2026-09-20T10:00:00.000Z',
        status: 'did_not_understand',
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-502');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('did_not_understand');
      expect(result!.completed).toBe(false);
    });

    it('omits status line and reads back undefined when status is undefined and completed undefined', async () => {
      const note: IntuitionNote = {
        problemId: 'lc-503',
        content: 'No status set',
        lastUpdated: '2026-09-20T10:00:00.000Z',
      };

      await adapter.writeIntuitionNote(note);

      const filePath = join(tempDir, 'notes', 'lc-503.md');
      const fileContent = await readFile(filePath, 'utf-8');
      expect(fileContent).not.toContain('status:');

      const result = await adapter.readIntuitionNote('lc-503');
      expect(result).not.toBeNull();
      expect(result!.status).toBeUndefined();
      expect(result!.completed).toBeUndefined();
    });

    it("keeps status and completed consistent: completed:true (no status) writes status 'done'", async () => {
      const note: IntuitionNote = {
        problemId: 'lc-504',
        content: 'Marked complete via legacy boolean',
        lastUpdated: '2026-09-20T10:00:00.000Z',
        completed: true,
      };

      await adapter.writeIntuitionNote(note);
      const result = await adapter.readIntuitionNote('lc-504');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('done');
      expect(result!.completed).toBe(true);
    });

    it('ignores an unknown/malformed status value (reads as undefined), no throw', async () => {
      const notesDir = join(tempDir, 'notes');
      await mkdir(notesDir, { recursive: true });
      await writeFile(
        join(notesDir, 'lc-badstatus.md'),
        '---\nid: lc-badstatus\nlastUpdated: 2026-09-20T00:00:00.000Z\nstatus: banana\n---\nContent\n',
        'utf-8',
      );

      const result = await adapter.readIntuitionNote('lc-badstatus');
      expect(result).not.toBeNull();
      expect(result!.status).toBeUndefined();
    });
  });

  describe('status back-compat', () => {
    it('old note with completed:true and no status resolves status to done', async () => {
      const notesDir = join(tempDir, 'notes');
      await mkdir(notesDir, { recursive: true });
      await writeFile(
        join(notesDir, 'lc-oldcomplete.md'),
        '---\nid: lc-oldcomplete\nlastUpdated: 2026-01-01T00:00:00.000Z\ncompleted: true\n---\nSolved long ago\n',
        'utf-8',
      );

      const result = await adapter.readIntuitionNote('lc-oldcomplete');

      expect(result).not.toBeNull();
      // Back-compat: legacy completed:true reads as status 'done'
      expect(result!.status).toBe('done');
      expect(result!.completed).toBe(true);
    });

    it('old note with completed:false and no status resolves status to undefined', async () => {
      const notesDir = join(tempDir, 'notes');
      await mkdir(notesDir, { recursive: true });
      await writeFile(
        join(notesDir, 'lc-oldincomplete.md'),
        '---\nid: lc-oldincomplete\nlastUpdated: 2026-01-01T00:00:00.000Z\ncompleted: false\n---\nNot done\n',
        'utf-8',
      );

      const result = await adapter.readIntuitionNote('lc-oldincomplete');

      expect(result).not.toBeNull();
      expect(result!.status).toBeUndefined();
      expect(result!.completed).toBe(false);
    });

    it('explicit status wins over a conflicting legacy completed value', async () => {
      // Hand-written note where completed and status disagree; status wins.
      const notesDir = join(tempDir, 'notes');
      await mkdir(notesDir, { recursive: true });
      await writeFile(
        join(notesDir, 'lc-conflict.md'),
        '---\nid: lc-conflict\nlastUpdated: 2026-01-01T00:00:00.000Z\nstatus: to_revisit\ncompleted: true\n---\nConflicting flags\n',
        'utf-8',
      );

      const result = await adapter.readIntuitionNote('lc-conflict');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('to_revisit');
    });
  });

  describe('backward compatibility', () => {
    it('reads old note file (only id+lastUpdated+body) without new fields', async () => {
      // Hand-write an OLD note file with only original frontmatter
      const notesDir = join(tempDir, 'notes');
      await mkdir(notesDir, { recursive: true });
      await writeFile(
        join(notesDir, 'lc-legacy.md'),
        '---\nid: lc-legacy\nlastUpdated: 2026-01-01T00:00:00.000Z\n---\nOld content before new fields existed\n',
        'utf-8',
      );

      const result = await adapter.readIntuitionNote('lc-legacy');

      expect(result).not.toBeNull();
      expect(result!.problemId).toBe('lc-legacy');
      expect(result!.content).toBe('Old content before new fields existed');
      expect(result!.lastUpdated).toBe('2026-01-01T00:00:00.000Z');
      // New fields should be undefined
      expect(result!.attempts).toBeUndefined();
      expect(result!.completed).toBeUndefined();
      expect(result!.timeComplexity).toBeUndefined();
      expect(result!.spaceComplexity).toBeUndefined();
    });

    it('reads old note with attempts but no new fields', async () => {
      const notesDir = join(tempDir, 'notes');
      await mkdir(notesDir, { recursive: true });
      await writeFile(
        join(notesDir, 'lc-oldattempts.md'),
        '---\nid: lc-oldattempts\nlastUpdated: 2026-05-01T00:00:00.000Z\nattempts: 2\n---\nContent with attempts\n',
        'utf-8',
      );

      const result = await adapter.readIntuitionNote('lc-oldattempts');

      expect(result).not.toBeNull();
      expect(result!.attempts).toBe(2);
      expect(result!.completed).toBeUndefined();
      expect(result!.timeComplexity).toBeUndefined();
      expect(result!.spaceComplexity).toBeUndefined();
    });
  });

  describe('legacy Reference approach section (ADR 0014 D1)', () => {
    const MARKER = '<!-- ibai:reference-approach -->';
    const FRONT =
      '---\nid: lc-1\nlastUpdated: 2026-09-30T10:00:00.000Z\nstatus: done\n---\n\n';

    async function writeRaw(text: string): Promise<string> {
      await mkdir(join(tempDir, 'notes'), { recursive: true });
      const path = join(tempDir, 'notes', 'lc-1.md');
      await writeFile(path, text, 'utf-8');
      return path;
    }

    /** read -> write the note back unchanged -> the file bytes. */
    async function resave(path: string): Promise<string> {
      const note = await adapter.readIntuitionNote('lc-1');
      await adapter.writeIntuitionNote(note!);
      return readFile(path, 'utf-8');
    }

    it('reads a marker note as plain text: only the marker line is dropped', async () => {
      await writeRaw(
        `${FRONT}My hash map idea.\n\n${MARKER}\n## Reference approach\n\nOne pass, store complements.\n`,
      );
      const note = await adapter.readIntuitionNote('lc-1');
      expect(note!.content).toBe(
        'My hash map idea.\n\n## Reference approach\n\nOne pass, store complements.',
      );
      expect(note!.content).not.toContain(MARKER);
      expect(note).not.toHaveProperty('referenceApproach');
      expect(note!.status).toBe('done');
    });

    it('the next save writes the text without the marker', async () => {
      const path = await writeRaw(
        `${FRONT}Mine.\n\n${MARKER}\n## Reference approach\n\nRef text.\n`,
      );
      const saved = await resave(path);
      expect(saved).not.toContain(MARKER);
      expect(saved).toContain('Mine.\n\n## Reference approach\n\nRef text.\n');
      // And it is stable from then on (byte-identical).
      expect(await resave(path)).toBe(saved);
    });

    it('drops a CRLF / trailing-whitespace marker line too', async () => {
      await writeRaw(
        `${FRONT}Line one.\r\n${MARKER} \t\r\n## Reference approach\r\nRef.\r\n`,
      );
      const note = await adapter.readIntuitionNote('lc-1');
      expect(note!.content).toBe(
        'Line one.\r\n## Reference approach\r\nRef.\r',
      );
    });

    it('drops a marker line in the middle of the body', async () => {
      await writeRaw(`${FRONT}Top.\n${MARKER}\nMiddle.\n\nBottom.\n`);
      expect((await adapter.readIntuitionNote('lc-1'))!.content).toBe(
        'Top.\nMiddle.\n\nBottom.',
      );
    });

    it('keeps a marker line inside a fenced code block (user content)', async () => {
      const content =
        `Idea.\n\n\`\`\`python\n# ${MARKER}\n${MARKER}\n\`\`\`\n\n` +
        `~~~~\n${MARKER}\n~~~\nstill fenced\n~~~~\n` +
        `${MARKER}\nafter the fences`;
      const path = await writeRaw(`${FRONT}${content}\n`);
      const read = (await adapter.readIntuitionNote('lc-1'))!.content;
      // The two fenced markers are kept; only the one after the fences goes.
      expect(read).toBe(content.replace(`${MARKER}\nafter`, 'after'));
      expect(read.split(MARKER)).toHaveLength(4);
      // Stable on the next save: fenced markers stay, byte-identical.
      const saved = await resave(path);
      expect(await resave(path)).toBe(saved);
      expect(saved).toContain(`\`\`\`python\n# ${MARKER}\n${MARKER}\n\`\`\``);
    });

    it('an unclosed fence keeps every marker line after it', async () => {
      const content = `Text.\n\`\`\`go\n${MARKER}\nfunc f() {}`;
      await writeRaw(`${FRONT}${content}\n`);
      expect((await adapter.readIntuitionNote('lc-1'))!.content).toBe(content);
    });

    it('keeps the marker text when it is not alone on its line', async () => {
      const content = `See ${MARKER} inline.\n  ${MARKER}`;
      const path = await writeRaw(`${FRONT}${content}\n`);
      expect((await adapter.readIntuitionNote('lc-1'))!.content).toBe(content);
      expect(await resave(path)).toContain(content);
    });

    it('a note without the marker round-trips byte-identical', async () => {
      await adapter.writeIntuitionNote({
        problemId: 'lc-1',
        content:
          'Body.\r\n\n## Reference approach\n\nNo marker here, so this is just text.\n  ',
        lastUpdated: '2026-09-30T10:00:00.000Z',
        status: 'to_revisit',
        timeComplexity: 'O(n)',
      });
      const path = join(tempDir, 'notes', 'lc-1.md');
      const before = await readFile(path, 'utf-8');
      expect(await resave(path)).toBe(before);
    });
  });
});
