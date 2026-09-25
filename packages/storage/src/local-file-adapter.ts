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
 *   ${basePath}/quiz-sessions/${sessionId}.json -> QuizSession (ADR 0007)
 *   ${basePath}/quiz-sessions/active.json    -> { sessionId } active pointer (ADR 0007)
 *   ${basePath}/competency-signals.json      -> CompetencySignals (ADR 0007)
 */

import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
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
  NoteStatus,
  IsoTimestamp,
  QuizSession,
  QuizSessionId,
  QuizAnswerRecord,
  QuizTranscriptEntry,
  QuizVerdict,
  QuizSessionStatus,
  QuizSessionSummary,
  CompetencySignals,
  TopicCompetency,
  PatternSignal,
  TopicStrength,
} from './index.js';
import { resolveNoteStatus, isNoteStatus } from './index.js';

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

function isQuizVerdict(value: unknown): value is QuizVerdict {
  return value === 'correct' || value === 'incorrect';
}

function isQuizSessionStatus(value: unknown): value is QuizSessionStatus {
  return value === 'active' || value === 'complete';
}

function isQuizAnswerRecord(value: unknown): value is QuizAnswerRecord {
  if (!isRecord(value)) return false;
  const { problemId, verdict, at } = value;
  return (
    typeof problemId === 'string' &&
    isQuizVerdict(verdict) &&
    typeof at === 'string'
  );
}

function isQuizTranscriptEntry(value: unknown): value is QuizTranscriptEntry {
  if (!isRecord(value)) return false;
  const { role, content, at } = value;
  return (
    (role === 'user' || role === 'assistant' || role === 'system') &&
    typeof content === 'string' &&
    typeof at === 'string'
  );
}

function isQuizSession(value: unknown): value is QuizSession {
  if (!isRecord(value)) return false;
  const {
    sessionId,
    createdAt,
    deck,
    currentIndex,
    answered,
    transcript,
    status,
  } = value;
  if (typeof sessionId !== 'string') return false;
  if (typeof createdAt !== 'string') return false;
  if (!Array.isArray(deck) || !deck.every((d) => typeof d === 'string')) {
    return false;
  }
  if (typeof currentIndex !== 'number' || !Number.isInteger(currentIndex)) {
    return false;
  }
  if (!Array.isArray(answered) || !answered.every(isQuizAnswerRecord)) {
    return false;
  }
  if (!Array.isArray(transcript) || !transcript.every(isQuizTranscriptEntry)) {
    return false;
  }
  return isQuizSessionStatus(status);
}

function isTopicStrength(value: unknown): value is TopicStrength {
  return (
    value === 'unknown' ||
    value === 'weak' ||
    value === 'improving' ||
    value === 'strong'
  );
}

function isTopicCompetency(value: unknown): value is TopicCompetency {
  if (!isRecord(value)) return false;
  const { topicId, correct, incorrect, lastSeen, strength } = value;
  return (
    typeof topicId === 'string' &&
    typeof correct === 'number' &&
    typeof incorrect === 'number' &&
    typeof lastSeen === 'string' &&
    isTopicStrength(strength)
  );
}

function isPatternSignal(value: unknown): value is PatternSignal {
  if (!isRecord(value)) return false;
  const { id, description, topics, occurrences, lastObserved } = value;
  return (
    typeof id === 'string' &&
    typeof description === 'string' &&
    Array.isArray(topics) &&
    topics.every((t) => typeof t === 'string') &&
    typeof occurrences === 'number' &&
    typeof lastObserved === 'string'
  );
}

function isCompetencySignals(value: unknown): value is CompetencySignals {
  if (!isRecord(value)) return false;
  const { topics, patterns, lastUpdated } = value;
  if (!isRecord(topics)) return false;
  for (const key of Object.keys(topics)) {
    if (!isTopicCompetency(topics[key])) return false;
  }
  if (!Array.isArray(patterns) || !patterns.every(isPatternSignal)) {
    return false;
  }
  return typeof lastUpdated === 'string';
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
    // Resolve the effective status (back-compat: completed:true -> 'done').
    // status is the primary signal; keep the legacy `completed` boolean
    // consistent with it ('done' <=> completed true).
    const resolvedStatus = resolveNoteStatus(note);
    const resolvedCompleted =
      note.completed !== undefined || note.status !== undefined
        ? resolvedStatus === 'done'
        : undefined;
    if (resolvedStatus !== 'none') {
      frontmatter += `\nstatus: ${resolvedStatus}`;
    }
    if (resolvedCompleted !== undefined) {
      frontmatter += `\ncompleted: ${resolvedCompleted}`;
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

  // -------------------------------------------------------------------------
  // Quiz Session Methods (ADR 0007 — Quickfire Quiz Master)
  // -------------------------------------------------------------------------

  /**
   * Read the current active quiz session via the active-session pointer.
   *
   * Tolerant: a missing/malformed pointer, a dangling reference, or a
   * malformed session file all resolve to `null` (never throws).
   */
  async readActiveQuizSession(): Promise<QuizSession | null> {
    const pointerPath = safeJoin(this.basePath, 'quiz-sessions', 'active.json');

    let activeId: string;
    try {
      const content = await readFile(pointerPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (!isRecord(parsed) || typeof parsed.sessionId !== 'string') {
        return null;
      }
      activeId = parsed.sessionId;
    } catch {
      // No pointer (or unreadable) -> no active session.
      return null;
    }

    return this.readQuizSession(activeId);
  }

  /**
   * Read a specific quiz session by ID.
   *
   * Tolerant: file-not-found or malformed content resolve to `null`.
   */
  async readQuizSession(sessionId: QuizSessionId): Promise<QuizSession | null> {
    const safeId = sanitizeSessionId(sessionId);
    const filePath = safeJoin(this.basePath, 'quiz-sessions', `${safeId}.json`);

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (isQuizSession(parsed)) {
        return parsed;
      }
      // Malformed data -> null (never throw).
      return null;
    } catch {
      // File not found or read/parse error -> null.
      return null;
    }
  }

  /**
   * Persist a quiz session and maintain the active-session pointer.
   *
   * An `'active'` session becomes the current one (pointer updated). A
   * `'complete'` session clears the pointer if it referenced this session, so
   * a fresh session must be started next.
   */
  async writeQuizSession(session: QuizSession): Promise<void> {
    const safeId = sanitizeSessionId(session.sessionId);
    const filePath = safeJoin(this.basePath, 'quiz-sessions', `${safeId}.json`);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(session, null, 2) + '\n', 'utf-8');

    const pointerPath = safeJoin(this.basePath, 'quiz-sessions', 'active.json');

    if (session.status === 'active') {
      // Point at this session so it resumes.
      await writeFile(
        pointerPath,
        JSON.stringify({ sessionId: safeId }, null, 2) + '\n',
        'utf-8',
      );
    } else {
      // Session complete: clear the pointer only if it referenced this one.
      try {
        const content = await readFile(pointerPath, 'utf-8');
        const parsed: unknown = JSON.parse(content);
        if (isRecord(parsed) && parsed.sessionId === safeId) {
          await writeFile(
            pointerPath,
            JSON.stringify({ sessionId: null }, null, 2) + '\n',
            'utf-8',
          );
        }
      } catch {
        // No pointer to clear -> nothing to do.
      }
    }
  }

  // -------------------------------------------------------------------------
  // Quiz Session Management Methods (ADR 0007 — session management, quiz-fix-b)
  // -------------------------------------------------------------------------

  /**
   * List a lightweight summary of every persisted quiz session, newest-first.
   *
   * Scans `${basePath}/quiz-sessions/`, skipping the `active.json` pointer and
   * any non-`.json` or malformed session files. Each well-formed session yields
   * a {@link QuizSessionSummary} (created time, status, deck size, answered +
   * correct tallies, and whether it is the active/resumable one). Tolerant: a
   * missing store resolves to an empty list; unreadable/malformed files are
   * skipped — never throws.
   */
  async listQuizSessions(): Promise<QuizSessionSummary[]> {
    const dir = safeJoin(this.basePath, 'quiz-sessions');

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      // No quiz-session store yet -> empty list.
      return [];
    }

    // Resolve the active pointer once so summaries can flag the active session.
    const activeId = await this.readActivePointerId();

    const summaries: QuizSessionSummary[] = [];
    for (const name of entries) {
      // Skip the pointer and anything that is not a session JSON file.
      if (name === 'active.json' || !name.endsWith('.json')) {
        continue;
      }
      const stem = name.slice(0, -'.json'.length);
      const session = await this.readQuizSession(stem);
      if (!session) {
        // Malformed/unreadable -> skip.
        continue;
      }
      const correctCount = session.answered.filter(
        (a) => a.verdict === 'correct',
      ).length;
      summaries.push({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        status: session.status,
        deckSize: session.deck.length,
        answeredCount: session.answered.length,
        correctCount,
        isActive: activeId !== null && activeId === stem,
      });
    }

    // Newest-first by createdAt (fall back to sessionId for stability).
    summaries.sort((a, b) => {
      const byDate = b.createdAt.localeCompare(a.createdAt);
      return byDate !== 0 ? byDate : b.sessionId.localeCompare(a.sessionId);
    });
    return summaries;
  }

  /**
   * Delete a persisted quiz session by ID. If it was the active/resumable
   * session, clears the active pointer too. Path-safe and tolerant: deleting a
   * missing session is a no-op — never throws.
   */
  async deleteQuizSession(sessionId: QuizSessionId): Promise<void> {
    const safeId = sanitizeSessionId(sessionId);
    const filePath = safeJoin(this.basePath, 'quiz-sessions', `${safeId}.json`);

    try {
      await unlink(filePath);
    } catch {
      // Missing file (or unreadable) -> nothing to delete.
    }

    // If the active pointer referenced this session, clear it.
    const pointerPath = safeJoin(this.basePath, 'quiz-sessions', 'active.json');
    try {
      const content = await readFile(pointerPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (isRecord(parsed) && parsed.sessionId === safeId) {
        await writeFile(
          pointerPath,
          JSON.stringify({ sessionId: null }, null, 2) + '\n',
          'utf-8',
        );
      }
    } catch {
      // No pointer to clear -> nothing to do.
    }
  }

  /**
   * Read the sanitized active-session id from the pointer file, or `null` when
   * there is no (valid) pointer. Shared by {@link listQuizSessions}.
   */
  private async readActivePointerId(): Promise<string | null> {
    const pointerPath = safeJoin(this.basePath, 'quiz-sessions', 'active.json');
    try {
      const content = await readFile(pointerPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (isRecord(parsed) && typeof parsed.sessionId === 'string') {
        return parsed.sessionId;
      }
      return null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Competency Signal Methods (ADR 0007 — competency intelligence)
  // -------------------------------------------------------------------------

  /**
   * Read the competency-signals dataset (weak/strong topics + patterns).
   *
   * Tolerant: missing/malformed -> an empty dataset (never throws).
   */
  async readCompetencySignals(): Promise<CompetencySignals> {
    const emptySignals: CompetencySignals = {
      topics: {},
      patterns: [],
      lastUpdated: new Date(0).toISOString() as IsoTimestamp,
    };
    const filePath = safeJoin(this.basePath, 'competency-signals.json');

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (isCompetencySignals(parsed)) {
        return parsed;
      }
      // Malformed data -> empty.
      return emptySignals;
    } catch {
      // File not found or read/parse error -> empty.
      return emptySignals;
    }
  }

  /**
   * Persist the competency-signals dataset as human-readable/diffable JSON.
   */
  async writeCompetencySignals(signals: CompetencySignals): Promise<void> {
    const filePath = safeJoin(this.basePath, 'competency-signals.json');

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(signals, null, 2) + '\n', 'utf-8');
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
    let parsedStatus: NoteStatus | undefined;
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
            } else if (key === 'status' && value) {
              // Tolerant: only accept a known NoteStatus, else ignore.
              const stripped = stripQuotes(value);
              if (isNoteStatus(stripped)) {
                parsedStatus = stripped;
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

    // Resolve effective status with back-compat: an explicit parsed status
    // wins; otherwise a legacy completed:true resolves to 'done'. Only include
    // `status` when it is meaningful (not 'none') to keep notes minimal and to
    // read a truly-empty note as undefined.
    const effectiveStatus = resolveNoteStatus({
      status: parsedStatus,
      completed: parsedCompleted,
    });

    // Build result with all fields, only including optional fields when defined
    const result: IntuitionNote = {
      problemId: requestedId,
      content: body,
      lastUpdated: parsedLastUpdated,
      ...(parsedAttempts !== undefined && { attempts: parsedAttempts }),
      ...(parsedCompleted !== undefined && { completed: parsedCompleted }),
      ...(effectiveStatus !== 'none' && { status: effectiveStatus }),
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
