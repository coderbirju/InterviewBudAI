import type { AssessmentView } from '@ibai/core';

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Render AssessmentView as JSON string.
 */
export function renderAssessmentJson(view: AssessmentView): string {
  return JSON.stringify(view, null, 2);
}

/**
 * Render AssessmentView as semantic HTML.
 */
export function renderAssessmentHtml(view: AssessmentView): string {
  const proficiencyPercent = (p: number): string => `${Math.round(p * 100)}%`;

  const strengthsHtml =
    view.topStrengths.length > 0
      ? `<ul>${view.topStrengths
          .map(
            (s) =>
              `<li>${escapeHtml(s.topicId)}: ${proficiencyPercent(s.proficiency)}</li>`,
          )
          .join('')}</ul>`
      : '<p>No strengths identified yet.</p>';

  const focusHtml =
    view.focusAreas.length > 0
      ? `<ul>${view.focusAreas
          .map(
            (f) =>
              `<li>${escapeHtml(f.topicId)}: ${proficiencyPercent(f.proficiency)}</li>`,
          )
          .join('')}</ul>`
      : '<p>No focus areas identified yet.</p>';

  const weaknessesHtml =
    view.recurringWeaknesses.length > 0
      ? `<ul>${view.recurringWeaknesses
          .map(
            (w) =>
              `<li>${escapeHtml(w.topicId)}: ${escapeHtml(w.note)} (${w.occurrences} occurrences)</li>`,
          )
          .join('')}</ul>`
      : '<p>No recurring weaknesses identified yet.</p>';

  let recentHtml: string;
  if (view.recentSession) {
    const rs = view.recentSession;
    recentHtml =
      `<p>Session: ${escapeHtml(rs.sessionId)}, ${rs.turnCount} turns` +
      (rs.lastRole ? `, last: ${escapeHtml(rs.lastRole)}` : '') +
      (rs.lastTimestamp ? ` at ${escapeHtml(rs.lastTimestamp)}` : '') +
      '</p>';
  } else {
    recentHtml = '<p>No recent session.</p>';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Where You Stand</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    h1, h2 { color: #333; }
    ul { padding-left: 1.5rem; }
    li { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>Where You Stand</h1>
  <p>Topics tracked: ${view.topicsTracked}</p>

  <h2>Top Strengths</h2>
  ${strengthsHtml}

  <h2>Focus Areas</h2>
  ${focusHtml}

  <h2>Recurring Weaknesses</h2>
  ${weaknessesHtml}

  <h2>Recent Session</h2>
  ${recentHtml}
</body>
</html>`;
}
