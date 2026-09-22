/**
 * @ibai/core — Coach engine job.
 *
 * Closes the growth loop: reads progress via storage, runs a persona-driven
 * session via the LLM provider, then writes back a STRUCTURED SessionSummary
 * and updates the competency map + weakness register.
 *
 * Design decisions (ADR 0005 D6 - AI-evaluation):
 * - Engine builds the prompt; provider only transports it to the model.
 * - The MODEL evaluates the candidate's own answers and returns structured verdicts.
 * - SessionSummary + competency/weakness updates are derived from MODEL verdicts.
 * - Parse model output as UNTRUSTED: fail closed on malformed output (no storage writes).
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
// Core-owned types (NEW AI-evaluation contract)
// ---------------------------------------------------------------------------

/** A candidate's typed answer for one planned topic (the model will evaluate it). */
export interface TopicAnswer {
  readonly topicId: TopicId;
  /** Optional prompt/question the candidate was responding to. */
  readonly question?: string;
  /** The candidate's own answer/reasoning text. */
  readonly answer: string;
}

/** The model's per-topic verdict (parsed from the model output; UNTRUSTED until validated). */
export interface TopicEvaluation {
  readonly topicId: TopicId;
  readonly succeeded: boolean;
  readonly feedback: string;
}

/** Input to the coach function. */
export interface CoachInput {
  readonly sessionId: SessionId;
  readonly plan: SessionPlan;
  /** Candidate answers the model will evaluate. */
  readonly answers: readonly TopicAnswer[];
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
  /** The parsed, validated per-topic evaluations from the model. */
  readonly evaluations: readonly TopicEvaluation[];
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

EVALUATION MANDATE:
After reviewing the candidate's answers, you MUST EVALUATE what THE CANDIDATE demonstrated in THEIR OWN answers. You assess their reasoning, NOT produce model/canned solutions. Focus on what they showed, gaps in their understanding, and areas for growth.

At the end, summarize what the candidate demonstrated and articulated, focusing on THEIR insights and reasoning, not what you told them.`;

/** Instruction for eliciting user intuition. */
const ELICIT_INSTRUCTION =
  "Remember: Your role is to ELICIT the candidate's intuition through questioning, NEVER to provide answers or solutions.";

/** Instruction for structured JSON output. */
const JSON_OUTPUT_INSTRUCTION = `
After your evaluation, you MUST end your reply with a single fenced code block labelled json containing EXACTLY this shape and NOTHING else inside the fence:

\`\`\`json
{
  "narrative": "<overall narrative of what the candidate demonstrated>",
  "evaluations": [
    { "topicId": "<id>", "succeeded": true, "feedback": "<assessment of the candidate's own answer>" }
  ]
}
\`\`\`

Requirements:
- Include one evaluation object PER planned topic
- "succeeded" is a strict boolean reflecting whether the candidate demonstrated competence
- "feedback" assesses the candidate's OWN answer (no canned solutions)
- Emit the JSON block LAST; do not wrap it in extra prose after the fence`;

// ---------------------------------------------------------------------------
// Prompt construction (PURE)
// ---------------------------------------------------------------------------

/**
 * Build the coach prompt from the session plan, candidate answers, and optional context.
 *
 * @param plan - The session plan with topics and roles.
 * @param answers - The candidate's answers to evaluate.
 * @param context - Optional assessment and prior session context.
 * @returns A CompletionRequest with role-tagged messages.
 */
export function buildCoachPrompt(
  plan: SessionPlan,
  answers: readonly TopicAnswer[],
  context?: { assessment?: AssessmentView; priorContext?: SessionContext },
): CompletionRequest {
  const messages: PromptMessage[] = [];

  // System message: persona + rules + evaluation mandate
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

  // Add candidate answers section
  sessionStructure += '\nCANDIDATE ANSWERS:\n';
  for (const answer of answers) {
    sessionStructure += `\n--- Topic: ${answer.topicId} ---\n`;
    if (answer.question) {
      sessionStructure += `Question: ${answer.question}\n`;
    }
    sessionStructure += `Answer: ${answer.answer}\n`;
  }

  sessionStructure += `\n${ELICIT_INSTRUCTION}`;
  sessionStructure += `\n${JSON_OUTPUT_INSTRUCTION}`;

  messages.push({
    role: 'user',
    content: sessionStructure,
  });

  return { messages };
}

// ---------------------------------------------------------------------------
// JSON extraction and validation helpers (UNTRUSTED parsing)
// ---------------------------------------------------------------------------

/** Expected shape of the model's JSON output. */
interface ModelEvaluationOutput {
  narrative: string;
  evaluations: Array<{
    topicId: string;
    succeeded: boolean;
    feedback: string;
  }>;
}

/**
 * Extract JSON from model output. Prefers the LAST fenced ```json block;
 * falls back to the last balanced { ... } object.
 */
function extractJson(text: string): string | null {
  // Try to find the last fenced JSON block
  const fencePattern = /```json\s*([\s\S]*?)```/g;
  let lastMatch: string | null = null;
  let match;
  while ((match = fencePattern.exec(text)) !== null) {
    lastMatch = match[1]?.trim() ?? null;
  }
  if (lastMatch) {
    return lastMatch;
  }

  // Fallback: find the last balanced { ... } object
  let depth = 0;
  let start = -1;
  let lastValidEnd = -1;
  let lastValidStart = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        lastValidStart = start;
        lastValidEnd = i + 1;
      }
    }
  }

  if (lastValidStart !== -1 && lastValidEnd !== -1) {
    return text.slice(lastValidStart, lastValidEnd);
  }

  return null;
}

/**
 * Validate the shape of parsed JSON strictly.
 * Returns the validated object or throws an error.
 */
function validateEvaluationShape(
  parsed: unknown,
  planTopicIds: Set<string>,
): ModelEvaluationOutput {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('coach: model returned non-object JSON');
  }

  const obj = parsed as Record<string, unknown>;

  // Validate narrative
  if (typeof obj.narrative !== 'string') {
    throw new Error('coach: model JSON missing or invalid "narrative" field');
  }

  // Validate evaluations array
  if (!Array.isArray(obj.evaluations)) {
    throw new Error('coach: model JSON missing or invalid "evaluations" array');
  }

  const seenTopicIds = new Set<string>();
  const validatedEvaluations: ModelEvaluationOutput['evaluations'] = [];

  for (const item of obj.evaluations) {
    if (typeof item !== 'object' || item === null) {
      throw new Error('coach: evaluation item is not an object');
    }

    const evalItem = item as Record<string, unknown>;

    // Validate topicId
    if (
      typeof evalItem.topicId !== 'string' ||
      evalItem.topicId.trim() === ''
    ) {
      throw new Error('coach: evaluation missing or invalid "topicId"');
    }

    // Validate succeeded (must be strict boolean)
    if (typeof evalItem.succeeded !== 'boolean') {
      throw new Error(
        `coach: evaluation for "${evalItem.topicId}" has invalid "succeeded" (must be boolean)`,
      );
    }

    // Validate feedback
    if (typeof evalItem.feedback !== 'string') {
      throw new Error(
        `coach: evaluation for "${evalItem.topicId}" missing or invalid "feedback"`,
      );
    }

    // Check for duplicate topicId
    if (seenTopicIds.has(evalItem.topicId)) {
      throw new Error(
        `coach: duplicate evaluation for topicId "${evalItem.topicId}"`,
      );
    }
    seenTopicIds.add(evalItem.topicId);

    validatedEvaluations.push({
      topicId: evalItem.topicId,
      succeeded: evalItem.succeeded,
      feedback: evalItem.feedback,
    });
  }

  // Verify topic coverage: every plan topic must have exactly one evaluation
  for (const planTopicId of planTopicIds) {
    if (!seenTopicIds.has(planTopicId)) {
      throw new Error(
        `coach: model evaluation missing required topicId "${planTopicId}"`,
      );
    }
  }

  // Verify no extra topics: every evaluation must reference a plan topic
  for (const evalTopicId of seenTopicIds) {
    if (!planTopicIds.has(evalTopicId)) {
      throw new Error(
        `coach: model evaluation references unknown topicId "${evalTopicId}"`,
      );
    }
  }

  return {
    narrative: obj.narrative,
    evaluations: validatedEvaluations,
  };
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
 * Guard/validate the narrative string.
 * Returns a safe, trimmed string.
 */
function guardNarrative(content: string): string {
  return content.trim();
}

/**
 * Derive the updated competency map from model evaluations.
 */
function deriveCompetencyMap(
  currentMap: CompetencyMap,
  plan: SessionPlan,
  evaluations: readonly TopicEvaluation[],
  completedAt: IsoTimestamp,
): CompetencyMap {
  // Start with current entries
  const entries: Record<TopicId, CompetencyEntry> = { ...currentMap.entries };

  // Build a map of plan topic proficiencies for defaults
  const planProficiencies = new Map<TopicId, number>();
  for (const topic of plan.topics) {
    planProficiencies.set(topic.topicId, topic.proficiency);
  }

  // Apply evaluations (model verdicts)
  for (const evaluation of evaluations) {
    const existing = entries[evaluation.topicId];
    const baseProficiency =
      existing?.proficiency ??
      planProficiencies.get(evaluation.topicId) ??
      DEFAULT_PROFICIENCY;

    const delta = evaluation.succeeded ? PROFICIENCY_STEP : -PROFICIENCY_STEP;
    const newProficiency = clamp01(baseProficiency + delta);

    entries[evaluation.topicId] = {
      topicId: evaluation.topicId,
      proficiency: newProficiency,
      lastUpdated: completedAt,
    };
  }

  return { entries };
}

/**
 * Derive the updated weakness register from model evaluations.
 */
function deriveWeaknessRegister(
  currentRegister: WeaknessRegister,
  evaluations: readonly TopicEvaluation[],
  completedAt: IsoTimestamp,
): WeaknessRegister {
  // Build a map of existing entries by topicId for easy lookup
  const entriesMap = new Map<TopicId, WeaknessEntry>();
  for (const entry of currentRegister.entries) {
    entriesMap.set(entry.topicId, entry);
  }

  // Process failed evaluations
  for (const evaluation of evaluations) {
    if (!evaluation.succeeded) {
      const existing = entriesMap.get(evaluation.topicId);
      if (existing) {
        // Increment existing entry
        entriesMap.set(evaluation.topicId, {
          topicId: evaluation.topicId,
          note: evaluation.feedback || existing.note,
          occurrences: existing.occurrences + 1,
          lastObserved: completedAt,
        });
      } else {
        // Add new entry
        entriesMap.set(evaluation.topicId, {
          topicId: evaluation.topicId,
          note: evaluation.feedback || '',
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
 * Run a coaching session: build prompt, call provider, parse UNTRUSTED model
 * output, validate strictly, and write back structured summary and
 * competency/weakness updates.
 *
 * FAIL CLOSED: On any parse/validation failure or provider error, throws an
 * error and performs NO storage writes.
 *
 * @param deps - Injected storage and LLM provider dependencies.
 * @param input - Coach input with session details and candidate answers.
 * @returns CoachResult with summary, updated maps, the raw request, and evaluations.
 */
export async function coach(
  deps: { storage: StorageAdapter; provider: LlmProvider },
  input: CoachInput,
): Promise<CoachResult> {
  // 1. Build request with candidate answers
  const request = buildCoachPrompt(input.plan, input.answers, {
    assessment: input.assessment,
  });

  // 2. Call provider (let rejection propagate - NO CATCH)
  const response = await deps.provider.complete(request);

  // 3. Parse model output as UNTRUSTED
  const jsonStr = extractJson(response.content);
  if (!jsonStr) {
    throw new Error(
      'coach: model returned malformed evaluation - no JSON found in response',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      'coach: model returned malformed evaluation - invalid JSON',
    );
  }

  // 4. Get unique plan topic IDs for validation
  const planTopicIds = new Set<string>();
  for (const topic of input.plan.topics) {
    planTopicIds.add(topic.topicId);
  }

  // 5. Validate shape strictly (throws on any issue)
  const validated = validateEvaluationShape(parsed, planTopicIds);

  // 6. Build validated evaluations
  const evaluations: TopicEvaluation[] = validated.evaluations.map((e) => ({
    topicId: e.topicId as TopicId,
    succeeded: e.succeeded,
    feedback: e.feedback,
  }));

  // 7. Guard narrative
  const narrative = guardNarrative(validated.narrative);

  // 8. Derive SessionSummary from MODEL verdicts
  const seenTopics = new Set<TopicId>();
  const topics: TopicId[] = [];
  for (const planTopic of input.plan.topics) {
    if (!seenTopics.has(planTopic.topicId)) {
      seenTopics.add(planTopic.topicId);
      topics.push(planTopic.topicId);
    }
  }

  const strengths = evaluations
    .filter((e) => e.succeeded)
    .map((e) => e.topicId);
  const weaknesses = evaluations
    .filter((e) => !e.succeeded)
    .map((e) => e.topicId);

  const summary: SessionSummary = {
    sessionId: input.sessionId,
    completedAt: input.completedAt,
    topics,
    narrative,
    strengths,
    weaknesses,
  };

  // 9. Derive competency map from MODEL verdicts
  const currentCompetencyMap = await deps.storage.readCompetencyMap();
  const updatedCompetencyMap = deriveCompetencyMap(
    currentCompetencyMap,
    input.plan,
    evaluations,
    input.completedAt,
  );

  // 10. Derive weakness register from MODEL verdicts
  const currentWeaknessRegister = await deps.storage.readWeaknessRegister();
  const updatedWeaknessRegister = deriveWeaknessRegister(
    currentWeaknessRegister,
    evaluations,
    input.completedAt,
  );

  // 11. Storage writes IN ORDER (only after successful parse/validate)
  await deps.storage.writeSessionSummary(summary);
  await deps.storage.updateCompetencyMap(updatedCompetencyMap);
  await deps.storage.updateWeaknessRegister(updatedWeaknessRegister);

  // 12. Return result
  return {
    summary,
    competencyMap: updatedCompetencyMap,
    weaknessRegister: updatedWeaknessRegister,
    request,
    evaluations,
  };
}
