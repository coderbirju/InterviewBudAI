/**
 * Pure formatter for AssessmentView output.
 *
 * NO fs, NO process, NO side effects. Just string formatting.
 * All derivation/sorting done by core; this only presents the data.
 */

import type { AssessmentView, SessionPlan, CoachResult } from '@ibai/core';

/**
 * Formats a proficiency value as a percentage string.
 */
function formatProficiency(proficiency: number): string {
  return `${Math.round(proficiency * 100)}%`;
}

/**
 * Formats AssessmentView as a human-readable terminal output.
 *
 * @param view - The assessment view from core
 * @returns Formatted string for terminal display
 */
export function formatAssessment(view: AssessmentView): string {
  const lines: string[] = [];

  // Header
  lines.push('=== Where You Stand ===');
  lines.push('');
  lines.push(`Topics tracked: ${view.topicsTracked}`);
  lines.push('');

  // Top strengths section
  lines.push('Top Strengths:');
  if (view.topStrengths.length === 0) {
    lines.push('  No strengths recorded yet.');
  } else {
    for (const strength of view.topStrengths) {
      lines.push(
        `  - ${strength.topicId}: ${formatProficiency(strength.proficiency)}`,
      );
    }
  }
  lines.push('');

  // Focus areas section
  lines.push('Focus Areas:');
  if (view.focusAreas.length === 0) {
    lines.push('  No focus areas identified yet.');
  } else {
    for (const area of view.focusAreas) {
      lines.push(`  - ${area.topicId}: ${formatProficiency(area.proficiency)}`);
    }
  }
  lines.push('');

  // Recurring weaknesses section
  lines.push('Recurring Weaknesses:');
  if (view.recurringWeaknesses.length === 0) {
    lines.push('  No recurring weaknesses noted.');
  } else {
    for (const weakness of view.recurringWeaknesses) {
      lines.push(
        `  - ${weakness.topicId} (${weakness.occurrences}x): ${weakness.note}`,
      );
    }
  }

  // Recent session block (only if present)
  if (view.recentSession !== null) {
    lines.push('');
    lines.push('Recent Session:');
    lines.push(`  Session ID: ${view.recentSession.sessionId}`);
    lines.push(`  Turns: ${view.recentSession.turnCount}`);
    if (view.recentSession.lastRole !== null) {
      lines.push(`  Last role: ${view.recentSession.lastRole}`);
    }
    if (view.recentSession.lastTimestamp !== null) {
      lines.push(`  Last activity: ${view.recentSession.lastTimestamp}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats SessionPlan as a human-readable terminal output.
 *
 * @param plan - The session plan from core
 * @returns Formatted string for terminal display
 */
export function formatPlan(plan: SessionPlan): string {
  const lines: string[] = [];

  // Header
  lines.push('=== Your Next Session ===');
  lines.push('');

  // Empty state
  if (plan.topics.length === 0) {
    lines.push(
      'No session history yet — complete a practice session to get a personalized plan.',
    );
    lines.push('');
    lines.push(`Summary: ${plan.summary}`);
    return lines.join('\n');
  }

  // Topics list
  for (const topic of plan.topics) {
    const rolePadded = topic.role.padStart(6);
    const profPct = Math.round(topic.proficiency * 100);
    const profStr = String(profPct).padStart(3);
    lines.push(
      `  ${rolePadded}  ${topic.topicId}  (${profStr}%)  ${topic.rationale}`,
    );
  }

  lines.push('');
  lines.push(`Summary: ${plan.summary}`);

  return lines.join('\n');
}

/**
 * Formats CoachResult as a human-readable terminal output.
 *
 * @param sessionId - The session identifier
 * @param plan - The session plan used for this coaching session
 * @param result - The coach result from core
 * @returns Formatted string for terminal display
 */
export function formatCoach(
  sessionId: string,
  plan: SessionPlan,
  result: CoachResult,
): string {
  const lines: string[] = [];

  // Header
  lines.push('=== Coaching Session ===');
  lines.push('');
  lines.push(`Session ID: ${sessionId}`);
  lines.push('');

  // Session framing from plan
  lines.push(`Topics covered: ${plan.topics.length}`);
  lines.push(`Plan summary: ${plan.summary}`);
  lines.push('');

  // Coach narrative
  lines.push('Session Recap:');
  if (result.summary.narrative) {
    lines.push(result.summary.narrative);
  } else {
    lines.push('  (No narrative generated)');
  }
  lines.push('');

  // Write-back confirmation
  lines.push('--- Persistence ---');
  lines.push('Saved session summary');
  const competencyCount = Object.keys(result.competencyMap.entries).length;
  lines.push(`Competency entries: ${competencyCount}`);
  const weaknessCount = result.weaknessRegister.entries.length;
  lines.push(`Weakness entries: ${weaknessCount}`);

  return lines.join('\n');
}
