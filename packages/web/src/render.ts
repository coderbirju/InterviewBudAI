import type {
  AssessmentView,
  SessionPlan,
  PlanTopic,
  CoachResult,
} from '@ibai/core';

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
 * Render SessionPlan as JSON string.
 */
export function renderPlanJson(plan: SessionPlan): string {
  return JSON.stringify(plan, null, 2);
}

/**
 * Format proficiency as percentage string.
 */
function proficiencyPercent(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/**
 * Get color for proficiency level.
 */
function proficiencyColor(p: number): string {
  if (p >= 0.7) return '#22c55e'; // green
  if (p >= 0.4) return '#eab308'; // yellow
  return '#ef4444'; // red
}

/**
 * Get badge color for plan role.
 */
function roleBadgeColor(role: string): string {
  switch (role) {
    case 'warmup':
      return '#3b82f6'; // blue
    case 'focus':
      return '#ef4444'; // red
    case 'twist':
      return '#8b5cf6'; // purple
    default:
      return '#6b7280'; // gray
  }
}

/**
 * Render a single plan topic card.
 */
function renderTopicCard(topic: PlanTopic): string {
  const pct = Math.round(topic.proficiency * 100);
  const barColor = proficiencyColor(topic.proficiency);
  const badgeColor = roleBadgeColor(topic.role);

  return `
    <div class="topic-card">
      <div class="card-header">
        <span class="topic-name">${escapeHtml(topic.topicId)}</span>
        <span class="role-badge" style="background-color: ${badgeColor}">${escapeHtml(topic.role)}</span>
      </div>
      <div class="proficiency-bar-container">
        <div class="proficiency-bar" style="width: ${pct}%; background-color: ${barColor}"></div>
      </div>
      <div class="proficiency-label">${pct}% proficiency</div>
      <div class="rationale">${escapeHtml(topic.rationale)}</div>
    </div>`;
}

/**
 * Render the "Where You Stand" section.
 */
function renderWhereYouStand(view: AssessmentView): string {
  const strengthsHtml =
    view.topStrengths.length > 0
      ? `<div class="stat-list">${view.topStrengths
          .map(
            (s) => `
            <div class="stat-item strength">
              <span class="stat-name">${escapeHtml(s.topicId)}</span>
              <span class="stat-value">${proficiencyPercent(s.proficiency)}</span>
            </div>`,
          )
          .join('')}</div>`
      : '<p class="empty-state">No strengths identified yet. Complete some sessions to see your progress.</p>';

  const focusHtml =
    view.focusAreas.length > 0
      ? `<div class="stat-list">${view.focusAreas
          .map(
            (f) => `
            <div class="stat-item focus">
              <span class="stat-name">${escapeHtml(f.topicId)}</span>
              <span class="stat-value">${proficiencyPercent(f.proficiency)}</span>
            </div>`,
          )
          .join('')}</div>`
      : '<p class="empty-state">No focus areas identified yet.</p>';

  const weaknessesHtml =
    view.recurringWeaknesses.length > 0
      ? `<div class="stat-list">${view.recurringWeaknesses
          .map(
            (w) => `
            <div class="stat-item weakness">
              <div class="weakness-header">
                <span class="stat-name">${escapeHtml(w.topicId)}</span>
                <span class="occurrence-badge">${w.occurrences}x</span>
              </div>
              <div class="weakness-note">${escapeHtml(w.note)}</div>
            </div>`,
          )
          .join('')}</div>`
      : '<p class="empty-state">No recurring weaknesses identified yet.</p>';

  let recentHtml: string;
  if (view.recentSession) {
    const rs = view.recentSession;
    recentHtml = `
      <div class="recent-session">
        <div class="session-id">Session: ${escapeHtml(rs.sessionId)}</div>
        <div class="session-stats">
          <span>${rs.turnCount} turns</span>
          ${rs.lastRole ? `<span>Last: ${escapeHtml(rs.lastRole)}</span>` : ''}
          ${rs.lastTimestamp ? `<span>${escapeHtml(rs.lastTimestamp)}</span>` : ''}
        </div>
      </div>`;
  } else {
    recentHtml = '<p class="empty-state">No recent session.</p>';
  }

  return `
  <section class="dashboard-section">
    <h2>Where You Stand</h2>
    <div class="topics-tracked">Topics tracked: <strong>${view.topicsTracked}</strong></div>
    
    <div class="subsection">
      <h3>Top Strengths</h3>
      ${strengthsHtml}
    </div>
    
    <div class="subsection">
      <h3>Focus Areas</h3>
      ${focusHtml}
    </div>
    
    <div class="subsection">
      <h3>Recurring Weaknesses</h3>
      ${weaknessesHtml}
    </div>
    
    <div class="subsection">
      <h3>Recent Session</h3>
      ${recentHtml}
    </div>
  </section>`;
}

/**
 * Render the "Your Next Session" section.
 */
function renderYourNextSession(plan: SessionPlan): string {
  if (plan.topics.length === 0) {
    return `
    <section class="dashboard-section">
      <h2>Your Next Session</h2>
      <div class="plan-summary empty">${escapeHtml(plan.summary)}</div>
      <p class="empty-state">Start practicing to get personalized session recommendations.</p>
    </section>`;
  }

  // Group topics by role for display order: warmup -> focus -> twist
  const warmup = plan.topics.filter((t) => t.role === 'warmup');
  const focus = plan.topics.filter((t) => t.role === 'focus');
  const twist = plan.topics.filter((t) => t.role === 'twist');

  const orderedTopics = [...warmup, ...focus, ...twist];

  return `
  <section class="dashboard-section">
    <h2>Your Next Session</h2>
    <div class="plan-summary">${escapeHtml(plan.summary)}</div>
    <div class="topic-cards">
      ${orderedTopics.map(renderTopicCard).join('')}
    </div>
  </section>`;
}

/**
 * Common CSS styles shared across all HTML pages.
 */
function getCommonStyles(): string {
  return `
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-card: #334155;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-green: #22c55e;
      --accent-yellow: #eab308;
      --accent-red: #ef4444;
      --accent-blue: #3b82f6;
      --accent-purple: #8b5cf6;
      --border-color: #475569;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
    }
    
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }
    
    header {
      text-align: center;
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--border-color);
    }
    
    header h1 {
      font-size: 2.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }
    
    header .tagline {
      color: var(--text-secondary);
      font-size: 1.1rem;
    }
    
    .dashboard-section {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    
    .dashboard-section h2 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
      color: var(--text-primary);
    }
    
    .dashboard-section h3 {
      font-size: 1.1rem;
      margin-bottom: 0.75rem;
      color: var(--text-secondary);
    }
    
    .subsection {
      margin-bottom: 1.5rem;
    }
    
    .subsection:last-child {
      margin-bottom: 0;
    }
    
    .topics-tracked {
      color: var(--text-secondary);
      margin-bottom: 1.5rem;
      font-size: 0.95rem;
    }
    
    .topics-tracked strong {
      color: var(--text-primary);
    }
    
    .empty-state {
      color: var(--text-muted);
      font-style: italic;
      padding: 0.5rem 0;
    }
    
    .stat-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .stat-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      background-color: var(--bg-card);
      border-radius: 8px;
      border-left: 3px solid transparent;
    }
    
    .stat-item.strength {
      border-left-color: var(--accent-green);
    }
    
    .stat-item.focus {
      border-left-color: var(--accent-yellow);
    }
    
    .stat-item.weakness {
      flex-direction: column;
      align-items: flex-start;
      border-left-color: var(--accent-red);
    }
    
    .stat-name {
      font-weight: 500;
    }
    
    .stat-value {
      color: var(--text-secondary);
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }
    
    .weakness-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      margin-bottom: 0.25rem;
    }
    
    .weakness-note {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    
    .occurrence-badge {
      background-color: var(--accent-red);
      color: white;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    
    .recent-session {
      padding: 0.75rem 1rem;
      background-color: var(--bg-card);
      border-radius: 8px;
    }
    
    .session-id {
      font-weight: 500;
      margin-bottom: 0.25rem;
    }
    
    .session-stats {
      display: flex;
      gap: 1rem;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    
    .plan-summary {
      padding: 1rem;
      background-color: var(--bg-card);
      border-radius: 8px;
      margin-bottom: 1.5rem;
      font-size: 1.05rem;
      border-left: 3px solid var(--accent-blue);
    }
    
    .plan-summary.empty {
      border-left-color: var(--text-muted);
      color: var(--text-secondary);
    }
    
    .topic-cards {
      display: grid;
      gap: 1rem;
    }
    
    @media (min-width: 640px) {
      .topic-cards {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    
    .topic-card {
      background-color: var(--bg-card);
      border-radius: 8px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .topic-name {
      font-weight: 600;
      font-size: 1.1rem;
    }
    
    .role-badge {
      color: white;
      padding: 0.125rem 0.625rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.025em;
    }
    
    .proficiency-bar-container {
      height: 6px;
      background-color: var(--bg-secondary);
      border-radius: 3px;
      overflow: hidden;
    }
    
    .proficiency-bar {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    
    .proficiency-label {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    
    .rationale {
      font-size: 0.9rem;
      color: var(--text-muted);
      font-style: italic;
    }
    
    footer {
      text-align: center;
      padding: 2rem 1rem;
      color: var(--text-muted);
      font-size: 0.875rem;
      border-top: 1px solid var(--border-color);
      margin-top: 2rem;
    }
    
    footer a {
      color: var(--accent-blue);
      text-decoration: none;
    }
    
    footer a:hover {
      text-decoration: underline;
    }
    
    /* Coach form styles */
    .coach-form {
      margin-top: 1rem;
    }
    
    .outcome-card {
      background-color: var(--bg-card);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    
    .outcome-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    
    .outcome-controls {
      display: flex;
      gap: 0.5rem;
    }
    
    .outcome-btn {
      padding: 0.375rem 0.75rem;
      border: 2px solid var(--border-color);
      border-radius: 6px;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 0.875rem;
      transition: all 0.15s ease;
    }
    
    .outcome-btn:hover {
      border-color: var(--text-secondary);
    }
    
    .outcome-btn.pass {
      border-color: var(--accent-green);
      color: var(--accent-green);
    }
    
    .outcome-btn.fail {
      border-color: var(--accent-red);
      color: var(--accent-red);
    }
    
    .outcome-btn.selected {
      background-color: currentColor;
      color: white;
    }
    
    .outcome-btn.pass.selected {
      background-color: var(--accent-green);
    }
    
    .outcome-btn.fail.selected {
      background-color: var(--accent-red);
    }
    
    .note-input {
      width: 100%;
      padding: 0.5rem;
      margin-top: 0.5rem;
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 0.875rem;
      resize: vertical;
    }
    
    .note-input::placeholder {
      color: var(--text-muted);
    }
    
    .submit-btn {
      display: block;
      width: 100%;
      padding: 1rem;
      margin-top: 1.5rem;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 1.1rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s ease;
    }
    
    .submit-btn:hover {
      opacity: 0.9;
    }
    
    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    /* Coach result styles */
    .coach-narrative {
      background-color: var(--bg-card);
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      white-space: pre-wrap;
      line-height: 1.8;
    }
    
    .coach-confirmation {
      background-color: var(--bg-card);
      border-left: 3px solid var(--accent-green);
      border-radius: 8px;
      padding: 1rem;
      margin-top: 1.5rem;
    }
    
    .coach-confirmation h4 {
      color: var(--accent-green);
      margin-bottom: 0.5rem;
    }
    
    .coach-confirmation ul {
      list-style: none;
      color: var(--text-secondary);
    }
    
    .coach-confirmation li::before {
      content: "✓ ";
      color: var(--accent-green);
    }
    
    .strength-weakness-grid {
      display: grid;
      gap: 1rem;
    }
    
    @media (min-width: 640px) {
      .strength-weakness-grid {
        grid-template-columns: 1fr 1fr;
      }
    }
    
    .sw-section {
      background-color: var(--bg-card);
      border-radius: 8px;
      padding: 1rem;
    }
    
    .sw-section h4 {
      margin-bottom: 0.75rem;
    }
    
    .sw-section.strengths h4 {
      color: var(--accent-green);
    }
    
    .sw-section.weaknesses h4 {
      color: var(--accent-red);
    }
    
    .sw-list {
      list-style: none;
    }
    
    .sw-list li {
      padding: 0.25rem 0;
      color: var(--text-secondary);
    }

    /* Interview UI styles */
    .provider-banner {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .provider-banner .provider-icon {
      color: var(--accent-blue);
    }
    
    .provider-banner .provider-label {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    
    .progress-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      padding: 0.75rem 1rem;
      background-color: var(--bg-card);
      border-radius: 8px;
    }
    
    .progress-step {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    
    .progress-step.completed {
      color: var(--accent-green);
    }
    
    .progress-step.current {
      color: var(--accent-blue);
      font-weight: 600;
    }
    
    .progress-arrow {
      color: var(--text-muted);
      font-size: 0.75rem;
    }
    
    .progress-counter {
      margin-left: auto;
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    
    .transcript {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    
    .transcript-turn {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .transcript-question {
      background-color: var(--bg-card);
      border-radius: 8px;
      padding: 1rem;
      border-left: 3px solid var(--accent-purple);
    }
    
    .transcript-question-label {
      font-size: 0.75rem;
      color: var(--accent-purple);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    
    .transcript-answer {
      background-color: var(--bg-secondary);
      border-radius: 8px;
      padding: 1rem;
      margin-left: 1rem;
      border-left: 3px solid var(--accent-blue);
    }
    
    .transcript-answer-label {
      font-size: 0.75rem;
      color: var(--accent-blue);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    
    .transcript-outcome {
      display: inline-block;
      font-size: 0.75rem;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      margin-left: 0.5rem;
    }
    
    .transcript-outcome.pass {
      background-color: var(--accent-green);
      color: white;
    }
    
    .transcript-outcome.fail {
      background-color: var(--accent-red);
      color: white;
    }
    
    .current-question {
      background-color: var(--bg-card);
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border-left: 3px solid var(--accent-purple);
    }
    
    .current-question-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    
    .current-question-label {
      font-size: 0.75rem;
      color: var(--accent-purple);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .current-topic-badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .current-question-text {
      font-size: 1.1rem;
      line-height: 1.6;
    }
    
    .answer-section {
      margin-bottom: 1.5rem;
    }
    
    .answer-textarea {
      width: 100%;
      min-height: 150px;
      padding: 1rem;
      background-color: var(--bg-card);
      border: 2px solid var(--border-color);
      border-radius: 8px;
      color: var(--text-primary);
      font-size: 1rem;
      font-family: inherit;
      line-height: 1.6;
      resize: vertical;
      transition: border-color 0.15s ease;
    }
    
    .answer-textarea:focus {
      outline: none;
      border-color: var(--accent-blue);
    }
    
    .answer-textarea::placeholder {
      color: var(--text-muted);
    }
    
    .outcome-section {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    
    .outcome-label {
      color: var(--text-secondary);
      font-size: 0.95rem;
    }
    
    .outcome-buttons {
      display: flex;
      gap: 0.5rem;
    }
    
    .outcome-btn-interview {
      padding: 0.5rem 1.25rem;
      border: 2px solid var(--border-color);
      border-radius: 6px;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    
    .outcome-btn-interview:hover {
      border-color: var(--text-secondary);
    }
    
    .outcome-btn-interview.pass-btn {
      border-color: var(--accent-green);
      color: var(--accent-green);
    }
    
    .outcome-btn-interview.pass-btn:hover,
    .outcome-btn-interview.pass-btn.selected {
      background-color: var(--accent-green);
      color: white;
    }
    
    .outcome-btn-interview.fail-btn {
      border-color: var(--accent-red);
      color: var(--accent-red);
    }
    
    .outcome-btn-interview.fail-btn:hover,
    .outcome-btn-interview.fail-btn.selected {
      background-color: var(--accent-red);
      color: white;
    }
    
    .interview-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .back-link {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 0.95rem;
    }
    
    .back-link:hover {
      color: var(--text-primary);
    }
    
    .next-btn {
      padding: 0.875rem 2rem;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s ease;
    }
    
    .next-btn:hover {
      opacity: 0.9;
    }
    
    .next-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .no-topics-state {
      text-align: center;
      padding: 3rem 1rem;
    }
    
    .no-topics-state .icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    
    .no-topics-state h2 {
      color: var(--text-primary);
      margin-bottom: 0.75rem;
    }
    
    .no-topics-state p {
      color: var(--text-secondary);
      margin-bottom: 1.5rem;
      max-width: 400px;
      margin-left: auto;
      margin-right: auto;
    }
    
    .no-topics-state .dashboard-link {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      border-radius: 8px;
      color: white;
      text-decoration: none;
      font-weight: 500;
    }
    
    .no-topics-state .dashboard-link:hover {
      opacity: 0.9;
    }
  `;
}

/**
 * Render the full dashboard HTML with both AssessmentView and SessionPlan.
 */
export function renderDashboardHtml(
  view: AssessmentView,
  plan: SessionPlan,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Dashboard</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Your AI-powered interview preparation companion</p>
    </header>
    
    ${renderWhereYouStand(view)}
    ${renderYourNextSession(plan)}
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
      <p><a href="/assess.json">View as JSON (assess)</a> &bull; <a href="/plan.json">View as JSON (plan)</a> &bull; <a href="/coach">Start Coaching Session</a></p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Render AssessmentView as a standalone HTML page.
 * @deprecated Use renderDashboardHtml for the full dashboard.
 */
export function renderAssessmentHtml(view: AssessmentView): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Assessment</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Your AI-powered interview preparation companion</p>
    </header>
    
    ${renderWhereYouStand(view)}
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
      <p><a href="/assess.json">View as JSON</a></p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Render the coaching session form (GET /coach).
 * Displays the current plan topics with controls to mark outcomes.
 * This is READ-ONLY: no write-back occurs until the form is submitted.
 *
 * Behavior: Only topics with explicitly submitted outcomes are included
 * in the POST. Topics without an outcome selection are omitted (no fabrication).
 */
export function renderCoachForm(
  plan: SessionPlan,
  _view: AssessmentView,
): string {
  const topicsHtml =
    plan.topics.length > 0
      ? plan.topics
          .map(
            (topic) => `
        <div class="outcome-card">
          <div class="outcome-header">
            <div>
              <span class="topic-name">${escapeHtml(topic.topicId)}</span>
              <span class="role-badge" style="background-color: ${roleBadgeColor(topic.role)}">${escapeHtml(topic.role)}</span>
            </div>
            <div class="outcome-controls">
              <button type="button" class="outcome-btn pass" data-topic="${escapeHtml(topic.topicId)}" onclick="selectOutcome(this, 'pass')">Pass</button>
              <button type="button" class="outcome-btn fail" data-topic="${escapeHtml(topic.topicId)}" onclick="selectOutcome(this, 'fail')">Fail</button>
            </div>
          </div>
          <div class="rationale">${escapeHtml(topic.rationale)}</div>
          <input type="hidden" name="outcome_${escapeHtml(topic.topicId)}" id="outcome_${escapeHtml(topic.topicId)}" value="">
          <textarea class="note-input" name="note_${escapeHtml(topic.topicId)}" placeholder="Optional note (what went well or needs work)..."></textarea>
        </div>`,
          )
          .join('')
      : '<p class="empty-state">No topics in your plan yet. Build up your practice history first.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Coaching Session</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Coaching Session</p>
    </header>
    
    <section class="dashboard-section">
      <h2>Practice Session</h2>
      <div class="plan-summary">${escapeHtml(plan.summary)}</div>
      
      <form class="coach-form" method="POST" action="/coach">
        ${topicsHtml}
        ${plan.topics.length > 0 ? '<button type="submit" class="submit-btn">Complete Session & Get Feedback</button>' : ''}
      </form>
    </section>
    
    <footer>
      <p><a href="/">← Back to Dashboard</a></p>
    </footer>
  </div>
  
  <script>
    function selectOutcome(btn, outcome) {
      const topicId = btn.dataset.topic;
      const hiddenInput = document.getElementById('outcome_' + topicId);
      const passBtn = btn.parentElement.querySelector('.pass');
      const failBtn = btn.parentElement.querySelector('.fail');
      
      // Toggle selection
      if (btn.classList.contains('selected')) {
        btn.classList.remove('selected');
        hiddenInput.value = '';
      } else {
        passBtn.classList.remove('selected');
        failBtn.classList.remove('selected');
        btn.classList.add('selected');
        hiddenInput.value = outcome;
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Render the coaching result page (POST /coach response).
 * Shows the AI-generated narrative, identified strengths/weaknesses,
 * and confirmation of write-back operations.
 */
export function renderCoachResult(
  sessionId: string,
  _plan: SessionPlan,
  result: CoachResult,
): string {
  const narrative =
    result.summary.narrative ?? 'No coaching narrative generated.';
  const strengths = result.summary.strengths ?? [];
  const weaknesses = result.summary.weaknesses ?? [];

  const strengthsHtml =
    strengths.length > 0
      ? `<ul class="sw-list">${strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
      : '<p class="empty-state">None identified this session.</p>';

  const weaknessesHtml =
    weaknesses.length > 0
      ? `<ul class="sw-list">${weaknesses.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
      : '<p class="empty-state">None identified this session.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Coaching Feedback</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Coaching Feedback</p>
    </header>
    
    <section class="dashboard-section">
      <h2>Session Complete: ${escapeHtml(sessionId)}</h2>
      <div class="topics-tracked">Topics practiced: <strong>${result.summary.topics?.length ?? 0}</strong></div>
      
      <div class="subsection">
        <h3>Coaching Narrative</h3>
        <div class="coach-narrative">${escapeHtml(narrative)}</div>
      </div>
      
      <div class="subsection">
        <h3>Session Analysis</h3>
        <div class="strength-weakness-grid">
          <div class="sw-section strengths">
            <h4>Strengths</h4>
            ${strengthsHtml}
          </div>
          <div class="sw-section weaknesses">
            <h4>Areas for Improvement</h4>
            ${weaknessesHtml}
          </div>
        </div>
      </div>
      
      <div class="coach-confirmation">
        <h4>Progress Saved</h4>
        <ul>
          <li>Session summary written</li>
          <li>Competency map updated</li>
          <li>Weakness register updated</li>
        </ul>
      </div>
    </section>
    
    <footer>
      <p><a href="/">← Back to Dashboard</a> &bull; <a href="/coach">Start New Session</a></p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Render CoachResult as JSON string.
 */
export function renderCoachJson(result: CoachResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Transcript entry for prior interview turns.
 */
export interface TranscriptEntry {
  topicId: string;
  question: string;
  answer: string;
  succeeded: boolean;
}

/**
 * Render a provider banner showing which LLM/demo provider is active.
 */
function renderProviderBanner(providerLabel?: string): string {
  if (!providerLabel) return '';
  return `
    <div class="provider-banner">
      <span class="provider-icon">🤖</span>
      <span class="provider-label">${escapeHtml(providerLabel)}</span>
    </div>`;
}

/**
 * Render the progress indicator for interview steps.
 */
function renderProgressIndicator(
  step: number,
  totalSteps: number,
  currentRole: string,
): string {
  const roles = ['warmup', 'focus', 'twist'];
  const roleIndex = roles.indexOf(currentRole);

  return `
    <div class="progress-indicator">
      ${roles
        .map((role, idx) => {
          let className = 'progress-step';
          if (
            idx < roleIndex ||
            (idx === roleIndex && step === totalSteps - 1)
          ) {
            className += ' completed';
          } else if (role === currentRole) {
            className += ' current';
          }
          return `<span class="${className}">${escapeHtml(role)}</span>`;
        })
        .join('<span class="progress-arrow">→</span>')}
      <span class="progress-counter">Step ${step + 1} of ${totalSteps}</span>
    </div>`;
}

/**
 * Render the transcript of prior interview turns.
 */
function renderTranscript(transcript: TranscriptEntry[]): string {
  if (transcript.length === 0) return '';

  return `
    <div class="transcript">
      ${transcript
        .map(
          (entry) => `
        <div class="transcript-turn">
          <div class="transcript-question">
            <div class="transcript-question-label">Interviewer (${escapeHtml(entry.topicId)})</div>
            ${escapeHtml(entry.question)}
          </div>
          <div class="transcript-answer">
            <div class="transcript-answer-label">
              Your Answer
              <span class="transcript-outcome ${entry.succeeded ? 'pass' : 'fail'}">${entry.succeeded ? 'Pass' : 'Fail'}</span>
            </div>
            ${escapeHtml(entry.answer)}
          </div>
        </div>`,
        )
        .join('')}
    </div>`;
}

/**
 * Render hidden fields carrying interview state forward.
 */
function renderHiddenStateFields(
  sessionId: string,
  step: number,
  transcript: TranscriptEntry[],
  currentQuestion: string,
): string {
  const fields = [
    `<input type="hidden" name="sessionId" value="${escapeHtml(sessionId)}">`,
    `<input type="hidden" name="step" value="${step}">`,
    `<input type="hidden" name="current_question" value="${escapeHtml(currentQuestion)}">`,
  ];

  // Carry forward all prior answers and outcomes
  for (const entry of transcript) {
    fields.push(
      `<input type="hidden" name="answer_${escapeHtml(entry.topicId)}" value="${escapeHtml(entry.answer)}">`,
    );
    fields.push(
      `<input type="hidden" name="outcome_${escapeHtml(entry.topicId)}" value="${entry.succeeded ? 'pass' : 'fail'}">`,
    );
    fields.push(
      `<input type="hidden" name="question_${escapeHtml(entry.topicId)}" value="${escapeHtml(entry.question)}">`,
    );
  }

  return fields.join('\n        ');
}

/**
 * Render a single interview step with question, answer input, and outcome buttons.
 */
export function renderInterviewStep(
  step: number,
  totalSteps: number,
  topic: PlanTopic,
  questionText: string,
  priorTranscript: TranscriptEntry[],
  sessionId: string,
  providerLabel?: string,
): string {
  const isLastStep = step === totalSteps - 1;
  const buttonText = isLastStep ? 'Finish Interview' : 'Next Question';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Interview Session</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Interview Session</p>
    </header>
    
    ${renderProviderBanner(providerLabel)}
    ${renderProgressIndicator(step, totalSteps, topic.role)}
    
    <section class="dashboard-section">
      ${renderTranscript(priorTranscript)}
      
      <div class="current-question">
        <div class="current-question-header">
          <span class="current-question-label">Interviewer</span>
          <div class="current-topic-badge">
            <span class="topic-name">${escapeHtml(topic.topicId)}</span>
            <span class="role-badge" style="background-color: ${roleBadgeColor(topic.role)}">${escapeHtml(topic.role)}</span>
          </div>
        </div>
        <div class="current-question-text">${escapeHtml(questionText)}</div>
      </div>
      
      <form method="POST" action="/coach">
        ${renderHiddenStateFields(sessionId, step, priorTranscript, questionText)}
        
        <div class="answer-section">
          <textarea 
            class="answer-textarea" 
            name="current_answer" 
            placeholder="Type your answer here..."
            required
          ></textarea>
        </div>
        
        <div class="outcome-section">
          <span class="outcome-label">How did you do?</span>
          <div class="outcome-buttons">
            <button type="button" class="outcome-btn-interview pass-btn" onclick="selectOutcomeInterview(this, 'pass')">Pass</button>
            <button type="button" class="outcome-btn-interview fail-btn" onclick="selectOutcomeInterview(this, 'fail')">Fail</button>
          </div>
          <input type="hidden" name="current_outcome" id="currentOutcome" value="">
        </div>
        
        <div class="interview-nav">
          <a href="/" class="back-link">← Exit Interview</a>
          <button type="submit" class="next-btn">${buttonText}</button>
        </div>
      </form>
    </section>
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
  
  <script>
    function selectOutcomeInterview(btn, outcome) {
      const hiddenInput = document.getElementById('currentOutcome');
      const passBtn = document.querySelector('.pass-btn');
      const failBtn = document.querySelector('.fail-btn');
      
      passBtn.classList.remove('selected');
      failBtn.classList.remove('selected');
      btn.classList.add('selected');
      hiddenInput.value = outcome;
    }
  </script>
</body>
</html>`;
}

/**
 * Render a friendly state when there are no topics in the plan.
 */
export function renderNoTopicsState(providerLabel?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - No Topics Yet</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Interview Session</p>
    </header>
    
    ${renderProviderBanner(providerLabel)}
    
    <section class="dashboard-section no-topics-state">
      <div class="icon">📚</div>
      <h2>No Topics Yet</h2>
      <p>Build up your practice history first to get personalized interview questions. Start by using the dashboard to track your progress.</p>
      <a href="/" class="dashboard-link">Go to Dashboard</a>
    </section>
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}
