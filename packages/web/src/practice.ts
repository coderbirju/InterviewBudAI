/**
 * Practice trends (ADR 0013 D3): the PURE builder behind the read-only
 * `GET /api/practice`. Computed from the practice log only — quiz files and
 * `/api/insights` are never read here, and nothing here feeds them.
 */

import type {
  CoachAssessment,
  IsoTimestamp,
  MissCode,
  PracticeEvent,
  PracticeSignals,
} from '@ibai/storage';
import { PRACTICE_EVENTS_MAX } from '@ibai/storage';
import { compareTopics, topicLabel } from '@ibai/curriculum';
import { MISS_LABELS } from './miss-labels.js';

/** `no_db` (no data folder), `empty` (no events), `ready`. */
export type PracticeState = 'no_db' | 'empty' | 'ready';

/** Top slip codes and topics per slip (as ADR 0012). */
export const PRACTICE_MAX_SLIPS = 3;
export const PRACTICE_MAX_SLIP_TOPICS = 3;

export interface ApiPracticeSlip {
  readonly code: MissCode;
  readonly label: string;
  readonly count: number;
  readonly topics: readonly {
    readonly topicId: string;
    readonly label: string;
    readonly count: number;
  }[];
}

export interface ApiPracticeRatio {
  readonly count: number;
  readonly of: number;
}

/** `GET /api/practice` (ADR 0013 D3). */
export interface ApiPracticeResponse {
  readonly state: PracticeState;
  readonly generatedAt: IsoTimestamp;
  readonly totals: {
    readonly checks: number;
    readonly problems: number;
    readonly windowEvents: number;
    readonly windowCap: number;
  };
  readonly firstCheck: Readonly<Record<CoachAssessment, number>>;
  readonly slips: readonly ApiPracticeSlip[];
  readonly fixedAfterRecheck: ApiPracticeRatio;
  readonly readyToCodeFirstTry: ApiPracticeRatio;
  readonly since: IsoTimestamp | null;
}

/**
 * Build the practice response. `signals === undefined` means no data folder
 * (`no_db`); `null` means no (readable) log (`empty`). Pure.
 *
 * - `totals.problems` is the all-time `seen` size; the rest is the window.
 * - `fixedAfterRecheck` anchors on each problem's `first: true` event in the
 *   window when it was `partial`/`off_track`; it counts the problems with a
 *   LATER `on_track`. Problems whose first event rotated out are not counted.
 * - `readyToCodeFirstTry`: first checks with `readyToCode` / all first checks.
 * - `slips`: top 3 codes by count, then by latest; up to 3 topics each by
 *   count, then curriculum order.
 */
export function buildPractice(
  signals: PracticeSignals | null | undefined,
  now: IsoTimestamp,
): ApiPracticeResponse {
  const events: readonly PracticeEvent[] = signals?.events ?? [];
  const state: PracticeState =
    signals === undefined ? 'no_db' : events.length === 0 ? 'empty' : 'ready';

  const firstCheck: Record<CoachAssessment, number> = {
    on_track: 0,
    partial: 0,
    off_track: 0,
  };
  let firstChecks = 0;
  let readyFirst = 0;
  let fixedOf = 0;
  let fixedCount = 0;
  const anchored = new Set<string>();
  const slipStats = new Map<
    MissCode,
    { count: number; latest: string; topics: Map<string, number> }
  >();

  events.forEach((e, i) => {
    if (e.first) {
      firstCheck[e.assessment] += 1;
      firstChecks += 1;
      if (e.readyToCode) readyFirst += 1;
      if (e.assessment !== 'on_track' && !anchored.has(e.problemId)) {
        anchored.add(e.problemId);
        fixedOf += 1;
        if (
          events
            .slice(i + 1)
            .some(
              (later) =>
                later.problemId === e.problemId &&
                later.assessment === 'on_track',
            )
        ) {
          fixedCount += 1;
        }
      }
    }
    if (e.miss !== undefined) {
      const s = slipStats.get(e.miss) ?? {
        count: 0,
        latest: '',
        topics: new Map<string, number>(),
      };
      s.count += 1;
      if (e.at > s.latest) s.latest = e.at;
      for (const t of e.topics) s.topics.set(t, (s.topics.get(t) ?? 0) + 1);
      slipStats.set(e.miss, s);
    }
  });

  const slips: ApiPracticeSlip[] = [...slipStats]
    .sort(
      ([, a], [, b]) =>
        b.count - a.count ||
        (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0),
    )
    .slice(0, PRACTICE_MAX_SLIPS)
    .map(([code, s]) => ({
      code,
      label: MISS_LABELS[code],
      count: s.count,
      topics: [...s.topics]
        .sort(([ta, ca], [tb, cb]) => cb - ca || compareTopics(ta, tb))
        .slice(0, PRACTICE_MAX_SLIP_TOPICS)
        .map(([topicId, count]) => ({
          topicId,
          label: topicLabel(topicId),
          count,
        })),
    }));

  return {
    state,
    generatedAt: now,
    totals: {
      checks: events.length,
      problems: state === 'ready' ? signals?.seen.length ?? 0 : 0,
      windowEvents: events.length,
      windowCap: PRACTICE_EVENTS_MAX,
    },
    firstCheck,
    slips,
    fixedAfterRecheck: { count: fixedCount, of: fixedOf },
    readyToCodeFirstTry: { count: readyFirst, of: firstChecks },
    since: events[0]?.at ?? null,
  };
}
