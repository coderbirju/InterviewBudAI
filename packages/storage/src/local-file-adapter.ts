/**
 * `LocalFileStorageAdapter` — git-backed local file storage for InterviewBudAI.
 *
 * Persists user progress to human-readable, diffable JSON files under a
 * user-configured directory. Designed for version control (git) workflows.
 *
 * On-disk layout:
 *   ${basePath}/sessions/${sessionId}.json  -> SessionContext
 *   ${basePath}/summaries/${sessionId}.json -> SessionSummary
 *   ${basePath}/competency.json             -> CompetencyMap
 *   ${basePath}/weaknesses.json             -> WeaknessRegister
 *   ${basePath}/notes/${problemId}.md       -> IntuitionNote (ADR 0005)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, normalize, isAbsolute } from 'node:path';
import type {
  StorageAdapter,
  SessionId,
  SessionContext,
  SessionSummary,
  CompetencyMap,
  WeaknessRegister,
  SessionHistoryEntry,
  CompetencyEntry,
  WeaknessEntry,
  IntuitionNote,
  IsoTimestamp,
} from './index.js';

// ---------------------------------------------------------------------------
// Type Guards (validate untrusted JSON)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSessionHistoryEntry(value: unknown): value is SessionHistoryEntry {
  if (!isRecord(value)) return false;
  const { role, content, timestamp } = value;
  return (
    (role === 'user' || role === 'assistant' || role === 'system') &&
    typeof content === 'string' &&
    typeof timestamp === 'string'
  );
}

function isSessionContext(value: unknown): value is SessionContext {
  if (!isRecord(value)) return false;
  const { sessionId, history } = value;
  if (typeof sessionId !== 'string') return false;
  if (!Array.isArray(history)) return false;
  return history.every(isSessionHistoryEntry);
}

function isCompetencyEntry(value: unknown): value is CompetencyEntry {
  if (!isRecord(value)) return false;
  const { topicId, proficiency, lastUpdated } = value;
  return (
    typeof topicId === 'string' &&
    typeof proficiency === 'number' &&
    typeof lastUpdated === 'string'
  );
}

function isCompetencyMap(value: unknown): value is CompetencyMap {
  if (!isRecord(value)) return false;
  const { entries } = value;
  if (!isRecord(entries)) return false;
  for (const key of Object.keys(entries)) {
    if (!isCompetencyEntry(entries[key])) return false;
  }
  return true;
}

function isWeaknessEntry(value: unknown): value is WeaknessEntry {
  if (!isRecord(value)) return false;
  const { topicId, note, occurrences, lastObserved } = value;
  return (
    typeof topicId === 'string' &&
    typeof note === 'string' &&
    typeof occurrences === 'number' &&
    typeof lastObserved === 'string'
  );
}

function isWeaknessRegister(value: unknown): value is WeaknessRegister {
  if (!isRecord(value)) return false;
  const { entries } = value;
  if (!Array.isArray(entries)) return false;
  return entries.every(isWeaknessEntry);
}

// ---------------------------------------------------------------------------
// Path Sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a sessionId to prevent path traversal attacks.
 * Rejects or strips dangerous characters: `/`, `\`, `..`
 * Returns a safe filename component.
 */
function sanitizeSessionId(sessionId: string): string {
  // Remove any path separators and parent directory references
  let sanitized = sessionId
    .replace(/\.{2,}/g, '') // Remove .. sequences
    .replace(/[/\\]/g, ''); // Remove path separators

  // If completely empty after sanitization, use a placeholder
  if (sanitized.length === 0) {
    sanitized = '_invalid_';
  }

  return sanitized;
}

/**
 * Sanitize a problemId for use in filenames.
 * Uses the same logic as sanitizeSessionId to prevent path traversal.
 */
function sanitizeProblemId(problemId: string): string {
  return sanitizeSessionId(problemId);
}

/**
 * Validate that a resolved path stays within the basePath.
 * Returns the safe path or throws if traversal detected.
 */
function safeJoin(basePath: string, ...parts: string[]): string {
  const resolved = normalize(join(basePath, ...parts));
  const normalizedBase = normalize(basePath);

  // Ensure the resolved path starts with the base path
  if (!resolved.startsWith(normalizedBase)) {
    // Path traversal attempt - return a safe fallback within basePath
    return join(basePath, '_invalid_', parts[parts.length - 1] ?? 'file');
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// LocalFileStorageAdapter
// ---------------------------------------------------------------------------

export class LocalFileStorageAdapter implements StorageAdapter {
  /**
   * Create a new LocalFileStorageAdapter.
   * @param basePath - The root directory for storing progress files.
   *                   Must be an absolute path or will be resolved relative to cwd.
   */
  constructor(private readonly basePath: string) {
    // Normalize the base path
    this.basePath = isAbsolute(basePath) ? basePath : normalize(basePath);
  }

  // -------------------------------------------------------------------------
  // Session Methods
  // -------------------------------------------------------------------------

  async readSessionContext(sessionId: SessionId): Promise<SessionContext> {
    const emptyContext: SessionContext = { sessionId, history: [] };

    const safeId = sanitizeSessionId(sessionId);
    const filePath = safeJoin(this.basePath, 'sessions', `${safeId}.json`);

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      if (isSessionContext(parsed)) {
        return parsed;
      }
      // Malformed data - return empty
      return emptyContext;
    } catch {
      // File not found or read error - return empty
      return emptyContext;
    }
  }

  async writeSessionSummary(summary: SessionSummary): Promise<void> {
    const safeId = sanitizeSessionId(summary.sessionId);
    const filePath = safeJoin(this.basePath, 'summaries', `${safeId}.json`);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  }

  // -------------------------------------------------------------------------
  // Competency Methods
  // -------------------------------------------------------------------------

  async readCompetencyMap(): Promise<CompetencyMap> {
    const emptyMap: CompetencyMap = { entries: {} };
    const filePath = safeJoin(this.basePath, 'competency.json');

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      if (isCompetencyMap(parsed)) {
        return parsed;
      }
      // Malformed data - return empty
      return emptyMap;
    } catch {
      // File not found or read error - return empty
      return emptyMap;
    }
  }

  async updateCompetencyMap(map: CompetencyMap): Promise<void> {
    const filePath = safeJoin(this.basePath, 'competency.json');

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(map, null, 2) + '\n', 'utf-8');
  }

  // -------------------------------------------------------------------------
  // Weakness Methods
  // -------------------------------------------------------------------------

  async readWeaknessRegister(): Promise<WeaknessRegister> {
    const emptyRegister: WeaknessRegister = { entries: [] };
    const filePath = safeJoin(this.basePath, 'weaknesses.json');

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      if (isWeaknessRegister(parsed)) {
        return parsed;
      }
      // Malformed data - return empty
      return emptyRegister;
    } catch {
      // File not found or read error - return empty
      return emptyRegister;
    }
  }

  async updateWeaknessRegister(register: WeaknessRegister): Promise<void> {
    const filePath = safeJoin(this.basePath, 'weaknesses.json');

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify(register, null, 2) + '\n',
      'utf-8',
    );
  }

  // -------------------------------------------------------------------------
  // Intuition Note Methods (ADR 0005)
  // -------------------------------------------------------------------------

  /**
   * Read a user's intuition note for a specific curriculum problem.
   *
   * Stored at `${basePath}/notes/<problemId>.md` as markdown with YAML-style
   * frontmatter (id, lastUpdated, optional attempts) followed by free-text body.
   *
   * @param problemId - Curriculum problem ID (e.g. 'lc-1', 'sysd-url-shortener')
   * @returns The intuition note if found, or `null` if none exists
   */
  async readIntuitionNote(problemId: string): Promise<IntuitionNote | null> {
    const safeId = sanitizeProblemId(problemId);
    const filePath = safeJoin(this.basePath, 'notes', `${safeId}.md`);

    try {
      const content = await readFile(filePath, 'utf-8');

      // Empty file -> return null
      if (content.trim().length === 0) {
        return null;
      }

      return this.parseIntuitionNote(content, safeId);
    } catch (err: unknown) {
      // ENOENT = file not found -> return null
      if (isNodeError(err) && err.code === 'ENOENT') {
        return null;
      }
      // Other errors -> return null (never throw)
      return null;
    }
  }

  /**
   * Persist a user's intuition note for a curriculum problem.
   *
   * Stored at `${basePath}/notes/<problemId>.md` as markdown with YAML-style
   * frontmatter (id, lastUpdated, optional attempts) followed by free-text body.
   *
   * @param note - The intuition note to persist, including problemId and content
   */
  async writeIntuitionNote(note: IntuitionNote): Promise<void> {
    const safeId = sanitizeProblemId(note.problemId);
    const filePath = safeJoin(this.basePath, 'notes', `${safeId}.md`);

    // Build frontmatter
    let frontmatter = `---\nid: ${safeId}\nlastUpdated: ${note.lastUpdated}`;
    if (note.attempts !== undefined) {
      frontmatter += `\nattempts: ${note.attempts}`;
    }
    if (note.completed !== undefined) {
      frontmatter += `\ncompleted: ${note.completed}`;
    }
    if (note.timeComplexity !== undefined) {
      // Quote the value and escape embedded quotes/newlines
      const escaped = note.timeComplexity
        .replace(/"/g, '\\"')
        .replace(/\n/g, ' ');
      frontmatter += `\ntimeComplexity: "${escaped}"`;
    }
    if (note.spaceComplexity !== undefined) {
      // Quote the value and escape embedded quotes/newlines
      const escaped = note.spaceComplexity
        .replace(/"/g, '\\"')
        .replace(/\n/g, ' ');
      frontmatter += `\nspaceComplexity: "${escaped}"`;
    }
    frontmatter += '\n---\n';

    // Combine frontmatter + body + trailing newline
    const fileContent = frontmatter + note.content + '\n';

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, fileContent, 'utf-8');
  }

  /**
   * Parse an intuition note from file content.
   * Hand-rolled parser for YAML-style frontmatter (no external deps).
   */
  private parseIntuitionNote(
    content: string,
    requestedId: string,
  ): IntuitionNote {
    let body = content;
    let parsedLastUpdated: IsoTimestamp =
      new Date().toISOString() as IsoTimestamp;
    let parsedAttempts: number | undefined;
    let parsedCompleted: boolean | undefined;
    let parsedTimeComplexity: string | undefined;
    let parsedSpaceComplexity: string | undefined;

    // Check for frontmatter
    if (content.startsWith('---\n')) {
      const lines = content.split('\n');
      let frontmatterEndIndex = -1;

      // Find closing ---
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
          frontmatterEndIndex = i;
          break;
        }
      }

      if (frontmatterEndIndex > 0) {
        // Parse frontmatter key: value pairs
        for (let i = 1; i < frontmatterEndIndex; i++) {
          const line = lines[i];
          if (line === undefined) continue;
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.slice(0, colonIndex).trim();
            const value = line.slice(colonIndex + 1).trim();

            if (key === 'lastUpdated' && value) {
              parsedLastUpdated = value as IsoTimestamp;
            } else if (key === 'attempts' && value) {
              const num = Number(value);
              if (!Number.isNaN(num)) {
                parsedAttempts = num;
              }
            } else if (key === 'completed') {
              // Parse boolean: 'true' -> true, 'false' -> false, else undefined
              if (value === 'true') {
                parsedCompleted = true;
              } else if (value === 'false') {
                parsedCompleted = false;
              }
            } else if (key === 'timeComplexity' && value) {
              // Strip surrounding quotes if present
              parsedTimeComplexity = stripQuotes(value) || undefined;
            } else if (key === 'spaceComplexity' && value) {
              // Strip surrounding quotes if present
              parsedSpaceComplexity = stripQuotes(value) || undefined;
            }
            // Note: we ignore 'id' from file, always use requestedId
          }
        }

        // Body is everything after the closing ---
        body = lines.slice(frontmatterEndIndex + 1).join('\n');
        // Trim a single leading newline if present
        if (body.startsWith('\n')) {
          body = body.slice(1);
        }
      }
    }

    // Trim trailing newline that we add on write
    if (body.endsWith('\n')) {
      body = body.slice(0, -1);
    }

    // Build result with all fields, only including optional fields when defined
    const result: IntuitionNote = {
      problemId: requestedId,
      content: body,
      lastUpdated: parsedLastUpdated,
      ...(parsedAttempts !== undefined && { attempts: parsedAttempts }),
      ...(parsedCompleted !== undefined && { completed: parsedCompleted }),
      ...(parsedTimeComplexity !== undefined && {
        timeComplexity: parsedTimeComplexity,
      }),
      ...(parsedSpaceComplexity !== undefined && {
        spaceComplexity: parsedSpaceComplexity,
      }),
    };

    return result;
  }
}

// ---------------------------------------------------------------------------
// Utility type guard for Node.js errors
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Strip surrounding double quotes from a string value if present.
 * Returns the inner content, or the original value if not quoted.
 */
function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}
