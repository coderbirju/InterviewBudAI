/**
 * @ibai/core — Coach engine job.
 *
 * Closes the growth loop: reads progress via storage, runs a persona-driven
 * session via the LLM provider, then writes back a STRUCTURED SessionSummary
 * and updates the competency map + weakness register.
 *
 * Design decisions:
 * - Engine builds the prompt; provider only transports it to the model.
 * - SessionSummary + competency/weakness updates are derived DETERMINISTICALLY
 *   from the supplied outcomes, NOT parsed from model free text.
 * - The narrative field is the ONLY model-sourced content.
 * - Persona instructs the model to ELICIT the user's intuition; the engine
 *   NEVER authors interview answers/solutions/intuitions.
 * - All storage reads/writes go through the injected StorageAdapter interface.
 */

import type {
  StorageAdapter,
  SessionId,
  TopicId,
  IsoTimestamp,
  SessionSummary,
  CompetencyMap,
  CompetencyEntry,
  WeaknessRegister,
  WeaknessEntry,
  SessionContext,
} from '@ibai/storage';

import type {
  LlmProvider,
  CompletionRequest,
  PromptMessage,
} from '@ibai/providers';

import type { SessionPlan } from './plan.js';
import type { AssessmentView } from './assess.js';

// ---------------------------------------------------------------------------
// Core-owned types
// ---------------------------------------------------------------------------

/** Per-topic outcome the front-end/user supplies after the session. */
export interface TopicOutcome {
  readonly topicId: TopicId;
  /** true = handled well (strength), false = struggled (weakness). */
  readonly succeeded: boolean;
  /** Optional short note captured from the session for weakness register. */
  readonly note?: string;
}

/** Input to the coach function. */
export interface CoachInput {
  readonly sessionId: SessionId;
  readonly plan: SessionPlan;
  /** Deterministic per-topic outcomes supplied by the front-end/user (NOT parsed from model text). */
  readonly outcomes: readonly TopicOutcome[];
  /** Optional prior assessment view for richer prompt framing. */
  readonly assessment?: AssessmentView;
  /** completedAt timestamp; caller supplies for determinism/testability. */
  readonly completedAt: IsoTimestamp;
}

/** Result returned by the coach function. */
export interface CoachResult {
  readonly summary: SessionSummary;
  readonly competencyMap: CompetencyMap;
  readonly weaknessRegister: WeaknessRegister;
  /** The raw request sent to the provider (for observability/testing). */
  readonly request: CompletionRequest;
}

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

/** Step size for proficiency adjustments. */
const PROFICIENCY_STEP = 0.1;

/** Default proficiency for topics not in the competency map. */
const DEFAULT_PROFICIENCY = 0.5;

/** The coaching persona system prompt. */
const COACH_PERSONA = `You are an expert interview coach for software engineering candidates.

YOUR ROLE:
- Guide the candidate through a structured practice session
- ELICIT the candidate's own thinking, intuition, and problem-solving approach
- Ask probing questions to help them discover insights themselves
- Provide encouragement and structure, NOT answers

CRITICAL RULES - YOU MUST FOLLOW THESE:
- NEVER provide solutions, answers, or code implementations
- NEVER explain how to solve a problem step-by-step
- NEVER give hints that reveal the answer
- ALWAYS ask questions that help the candidate articulate their own thinking
- When they struggle, ask clarifying questions rather than giving answers
- Your job is to DRAW OUT their knowledge, not to FILL IN gaps

SESSION STRUCTURE:
1. WARM-UP: Start with a strength topic to build confidence
2. FOCUS: Probe their understanding of gap areas through questions
3. TWIST: Challenge them with a stretch topic to identify growth edges

At the end, summarize what the candidate demonstrated and articulated, focusing on THEIR insights and reasoning, not what you told them.`;

/** Instruction for eliciting user intuition. */
const ELICIT_INSTRUCTION =
  "Remember: Your role is to ELICIT the candidate's intuition through questioning, NEVER to provide answers or solutions.";

// ---------------------------------------------------------------------------
// Prompt construction (PURE)
// ---------------------------------------------------------------------------

/**
 * Build the coach prompt from the session plan and optional context.
 *
 * @param plan - The session plan with topics and roles.
 * @param context - Optional assessment and prior session context.
 * @returns A CompletionRequest with role-tagged messages.
 */
export function buildCoachPrompt(
  plan: SessionPlan,
  context?: { assessment?: AssessmentView; priorContext?: SessionContext },
): CompletionRequest {
  const messages: PromptMessage[] = [];

  // System message: persona + rules
  messages.push({
    role: 'system',
    content: COACH_PERSONA,
  });

  // Build session structure from plan
  const warmupTopics = plan.topics.filter((t) => t.role === 'warmup');
  const focusTopics = plan.topics.filter((t) => t.role === 'focus');
  const twistTopics = plan.topics.filter((t) => t.role === 'twist');

  let sessionStructure = 'SESSION PLAN:\n\n';
  sessionStructure += `Summary: ${plan.summary}\n\n`;

  if (warmupTopics.length > 0) {
    sessionStructure += 'WARM-UP ROUND (build confidence):\n';
    for (const topic of warmupTopics) {
      sessionStructure += `- Topic: ${topic.topicId} (proficiency: ${Math.round(topic.proficiency * 100)}%)\n`;
      sessionStructure += `  Framing: ${topic.rationale}\n`;
    }
    sessionStructure += '\n';
  }

  if (focusTopics.length > 0) {
    sessionStructure += 'FOCUS ROUND (probe gaps):\n';
    for (const topic of focusTopics) {
      sessionStructure += `- Topic: ${topic.topicId} (proficiency: ${Math.round(topic.proficiency * 100)}%)\n`;
      sessionStructure += `  Framing: ${topic.rationale}\n`;
    }
    sessionStructure += '\n';
  }

  if (twistTopics.length > 0) {
    sessionStructure += 'TWIST ROUND (stretch challenge):\n';
    for (const topic of twistTopics) {
      sessionStructure += `- Topic: ${topic.topicId} (proficiency: ${Math.round(topic.proficiency * 100)}%)\n`;
      sessionStructure += `  Framing: ${topic.rationale}\n`;
    }
    sessionStructure += '\n';
  }

  // Add assessment context if provided
  if (context?.assessment) {
    const assessment = context.assessment;
    sessionStructure += 'CANDIDATE CONTEXT:\n';

    if (assessment.focusAreas.length > 0) {
      sessionStructure += 'Focus areas (gaps to probe): ';
      sessionStructure += assessment.focusAreas
        .map((f) => f.topicId)
        .join(', ');
      sessionStructure += '\n';
    }

    if (assessment.recurringWeaknesses.length > 0) {
      sessionStructure += 'Recurring weaknesses to watch: ';
      sessionStructure += assessment.recurringWeaknesses
        .map((w) => w.topicId)
        .join(', ');
      sessionStructure += '\n';
    }
  }

  sessionStructure += `\n${ELICIT_INSTRUCTION}`;

  messages.push({
    role: 'user',
    content: sessionStructure,
  });

  return { messages };
}

// ---------------------------------------------------------------------------
// Write-back derivation helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a value to the [0, 1] range.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Guard/validate the provider response content.
 * Returns a safe, trimmed string or empty string fallback.
 */
function guardNarrative(content: unknown): string {
  if (typeof content !== 'string') {
    return '';
  }
  const trimmed = content.trim();
  return trimmed;
}

/**
 * Derive the updated competency map from outcomes.
 */
function deriveCompetencyMap(
  currentMap: CompetencyMap,
  plan: SessionPlan,
  outcomes: readonly TopicOutcome[],
  completedAt: IsoTimestamp,
): CompetencyMap {
  // Start with current entries
  const entries: Record<TopicId, CompetencyEntry> = { ...currentMap.entries };

  // Build a map of plan topic proficiencies for defaults
  const planProficiencies = new Map<TopicId, number>();
  for (const topic of plan.topics) {
    planProficiencies.set(topic.topicId, topic.proficiency);
  }

  // Apply outcomes
  for (const outcome of outcomes) {
    const existing = entries[outcome.topicId];
    const baseProficiency =
      existing?.proficiency ??
      planProficiencies.get(outcome.topicId) ??
      DEFAULT_PROFICIENCY;

    const delta = outcome.succeeded ? PROFICIENCY_STEP : -PROFICIENCY_STEP;
    const newProficiency = clamp01(baseProficiency + delta);

    entries[outcome.topicId] = {
      topicId: outcome.topicId,
      proficiency: newProficiency,
      lastUpdated: completedAt,
    };
  }

  return { entries };
}

/**
 * Derive the updated weakness register from outcomes.
 */
function deriveWeaknessRegister(
  currentRegister: WeaknessRegister,
  outcomes: readonly TopicOutcome[],
  completedAt: IsoTimestamp,
): WeaknessRegister {
  // Build a map of existing entries by topicId for easy lookup
  const entriesMap = new Map<TopicId, WeaknessEntry>();
  for (const entry of currentRegister.entries) {
    entriesMap.set(entry.topicId, entry);
  }

  // Process failed outcomes
  for (const outcome of outcomes) {
    if (!outcome.succeeded) {
      const existing = entriesMap.get(outcome.topicId);
      if (existing) {
        // Increment existing entry
        entriesMap.set(outcome.topicId, {
          topicId: outcome.topicId,
          note: outcome.note ?? existing.note,
          occurrences: existing.occurrences + 1,
          lastObserved: completedAt,
        });
      } else {
        // Add new entry
        entriesMap.set(outcome.topicId, {
          topicId: outcome.topicId,
          note: outcome.note ?? '',
          occurrences: 1,
          lastObserved: completedAt,
        });
      }
    }
  }

  return { entries: Array.from(entriesMap.values()) };
}

// ---------------------------------------------------------------------------
// Main coach function (ASYNC ORCHESTRATION)
// ---------------------------------------------------------------------------

/**
 * Run a coaching session: build prompt, call provider, write back structured
 * summary and competency/weakness updates.
 *
 * @param deps - Injected storage and LLM provider dependencies.
 * @param input - Coach input with session details and outcomes.
 * @returns CoachResult with summary, updated maps, and the raw request.
 */
export async function coach(
  deps: { storage: StorageAdapter; provider: LlmProvider },
  input: CoachInput,
): Promise<CoachResult> {
  // 1. Build request
  const request = buildCoachPrompt(input.plan, {
    assessment: input.assessment,
  });

  // 2. Call provider (let rejection propagate)
  const response = await deps.provider.complete(request);

  // 3. Guard the completion - derive safe narrative
  const narrative = guardNarrative(response.content);

  // 4. Derive SessionSummary DETERMINISTICALLY
  // Topics from plan (in order, de-duped)
  const seenTopics = new Set<TopicId>();
  const topics: TopicId[] = [];
  for (const planTopic of input.plan.topics) {
    if (!seenTopics.has(planTopic.topicId)) {
      seenTopics.add(planTopic.topicId);
      topics.push(planTopic.topicId);
    }
  }

  // Strengths and weaknesses from outcomes
  const strengths = input.outcomes
    .filter((o) => o.succeeded)
    .map((o) => o.topicId);
  const weaknesses = input.outcomes
    .filter((o) => !o.succeeded)
    .map((o) => o.topicId);

  const summary: SessionSummary = {
    sessionId: input.sessionId,
    completedAt: input.completedAt,
    topics,
    narrative,
    strengths,
    weaknesses,
  };

  // 5. Write session summary
  await deps.storage.writeSessionSummary(summary);

  // 6. Update competency map
  const currentCompetencyMap = await deps.storage.readCompetencyMap();
  const updatedCompetencyMap = deriveCompetencyMap(
    currentCompetencyMap,
    input.plan,
    input.outcomes,
    input.completedAt,
  );
  await deps.storage.updateCompetencyMap(updatedCompetencyMap);

  // 7. Update weakness register
  const currentWeaknessRegister = await deps.storage.readWeaknessRegister();
  const updatedWeaknessRegister = deriveWeaknessRegister(
    currentWeaknessRegister,
    input.outcomes,
    input.completedAt,
  );
  await deps.storage.updateWeaknessRegister(updatedWeaknessRegister);

  // 8. Return result
  return {
    summary,
    competencyMap: updatedCompetencyMap,
    weaknessRegister: updatedWeaknessRegister,
    request,
  };
}
