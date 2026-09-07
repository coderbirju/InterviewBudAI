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
}
