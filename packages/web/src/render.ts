import type { AssessmentView, SessionPlan, PlanTopic } from '@ibai/core';

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
  <style>
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
  </style>
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
      <p><a href="/assess.json">View as JSON (assess)</a> &bull; <a href="/plan.json">View as JSON (plan)</a></p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Render AssessmentView as semantic HTML (legacy, kept for backwards compatibility).
 * @deprecated Use renderDashboardHtml instead
 */
export function renderAssessmentHtml(view: AssessmentView): string {
  // Create an empty plan for backwards compatibility
  const emptyPlan: SessionPlan = { topics: [], summary: 'No plan available.' };
  return renderDashboardHtml(view, emptyPlan);
}
