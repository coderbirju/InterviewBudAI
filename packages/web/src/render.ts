import type {
  AssessmentView,
  SessionPlan,
  PlanTopic,
  CoachResult,
} from '@ibai/core';
import type { Problem } from '@ibai/curriculum';

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
export function getCommonStyles(): string {
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

    /* Navigation styles */
    .main-nav {
      background-color: var(--bg-secondary);
      padding: 0.75rem 1rem;
      margin-bottom: 2rem;
      border-radius: 8px;
      display: flex;
      justify-content: center;
      gap: 2rem;
    }

    .main-nav a {
      color: var(--text-secondary);
      text-decoration: none;
      font-weight: 500;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      transition: color 0.15s ease, background-color 0.15s ease;
    }

    .main-nav a:hover {
      color: var(--text-primary);
      background-color: var(--bg-card);
    }

    .main-nav a.active {
      color: var(--accent-blue);
      background-color: var(--bg-card);
    }

    /* Home page styles */
    .hero {
      text-align: center;
      margin-bottom: 3rem;
    }

    .hero h1 {
      font-size: 3rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }

    .hero .tagline {
      color: var(--text-secondary);
      font-size: 1.25rem;
    }

    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      max-width: 400px;
      margin: 0 auto 3rem auto;
    }

    @media (min-width: 640px) {
      .action-buttons {
        flex-direction: row;
        max-width: 500px;
      }
    }

    .action-btn {
      display: block;
      flex: 1;
      padding: 1rem;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 1.1rem;
      font-weight: 600;
      text-decoration: none;
      text-align: center;
      cursor: pointer;
      transition: opacity 0.15s ease;
    }

    .action-btn:hover {
      opacity: 0.9;
    }

    .action-btn.secondary {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
    }

    .progress-summary {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .progress-summary h2 {
      font-size: 1.25rem;
      margin-bottom: 1rem;
      color: var(--text-primary);
    }

    .progress-cards {
      display: grid;
      gap: 1rem;
    }

    @media (min-width: 640px) {
      .progress-cards {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    .progress-card {
      background-color: var(--bg-card);
      border-radius: 8px;
      padding: 1rem;
    }

    .progress-card .label {
      color: var(--text-secondary);
      font-size: 0.875rem;
      margin-bottom: 0.25rem;
    }

    .progress-card .value {
      color: var(--text-primary);
      font-weight: 600;
      font-size: 1.1rem;
    }

    .empty-state-cta {
      text-align: center;
      padding: 2rem;
      background-color: var(--bg-secondary);
      border-radius: 12px;
      margin-bottom: 2rem;
    }

    .empty-state-cta p {
      color: var(--text-secondary);
      margin-bottom: 1rem;
    }

    .empty-state-cta .setup-link {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      border-radius: 8px;
      color: white;
      text-decoration: none;
      font-weight: 500;
    }

    .interview-note {
      color: var(--text-muted);
      font-size: 0.875rem;
      text-align: center;
      margin-top: 0.5rem;
    }
  `;
}

/**
 * Render the main navigation bar.
 * @param activeRoute The current route path to mark as active
 */
export function renderNav(activeRoute: string): string {
  const links = [
    { href: '/', label: 'Home' },
    { href: '/catalog', label: 'Catalog' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/coach', label: 'Interview' },
  ];

  return `<nav class="main-nav" role="navigation" aria-label="Main navigation">
    ${links
      .map((link) => {
        const isActive = link.href === activeRoute;
        return `<a href="${link.href}"${isActive ? ' class="active" aria-current="page"' : ''}>${escapeHtml(link.label)}</a>`;
      })
      .join('')}
  </nav>`;
}

/**
 * Render the home/landing page HTML.
 * @param view AssessmentView or null for empty/error state
 */
export function renderHomeHtml(view: AssessmentView | null): string {
  const hasData = view !== null && view.topicsTracked > 0;

  const progressSection = hasData
    ? `<div class="progress-summary">
        <h2>Your Progress</h2>
        <div class="progress-cards">
          <div class="progress-card">
            <div class="label">Topics tracked</div>
            <div class="value">${view.topicsTracked}</div>
          </div>
          ${
            view.topStrengths.length > 0
              ? `
          <div class="progress-card">
            <div class="label">Top strength</div>
            <div class="value">${escapeHtml(view.topStrengths[0]?.topicId ?? '')}</div>
          </div>`
              : ''
          }
          ${
            view.focusAreas.length > 0
              ? `
          <div class="progress-card">
            <div class="label">Focus area</div>
            <div class="value">${escapeHtml(view.focusAreas[0]?.topicId ?? '')}</div>
          </div>`
              : ''
          }
        </div>
      </div>`
    : `<div class="empty-state-cta">
        <p>Create your database to start tracking progress</p>
        <a href="/setup" class="setup-link">Create your database</a>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <div class="container">
    ${renderNav('/')}

    <div class="hero">
      <h1>InterviewBudAI</h1>
      <p class="tagline">Your AI-powered interview preparation companion</p>
    </div>

    <div class="action-buttons">
      <a href="/catalog" class="action-btn">Continue practicing</a>
      <a href="/coach" class="action-btn secondary">Interview with AI</a>
    </div>
    <p class="interview-note">AI interview requires a configured model</p>

    ${progressSection}

    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
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
    ${renderNav('/dashboard')}
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
    ${renderNav('/coach')}
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
    ${renderNav('/coach')}
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
    ${renderNav('/coach')}
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Interview Session</p>
    </header>
    
    ${renderProviderBanner(providerLabel)}
    
    <section class="dashboard-section no-topics-state">
      <div class="icon">📚</div>
      <h2>No Topics Yet</h2>
      <p>Build up your practice history first to get personalized interview questions. Start by using the dashboard to track your progress.</p>
      <a href="/dashboard" class="dashboard-link">Go to Dashboard</a>
    </section>
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Convert a topic string to a URL-safe anchor slug.
 */
function topicToSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Get color for difficulty badge.
 */
function difficultyColor(difficulty: string): string {
  switch (difficulty) {
    case 'easy':
      return '#22c55e'; // green
    case 'medium':
      return '#eab308'; // amber/yellow
    case 'hard':
      return '#ef4444'; // red
    default:
      return '#6b7280'; // gray
  }
}

/**
 * Render the catalog page grouped by topic.
 */
export function renderCatalogHtml(
  problems: readonly Problem[],
  hasCookie: boolean,
  defaultDataDir: string,
): string {
  // Group problems by topic
  const byTopic = new Map<string, Problem[]>();
  for (const problem of problems) {
    for (const topic of problem.topics) {
      const list = byTopic.get(topic) ?? [];
      list.push(problem);
      byTopic.set(topic, list);
    }
  }

  // Sort topics alphabetically
  const sortedTopics = Array.from(byTopic.keys()).sort();

  // Build navigation links
  const navLinks = sortedTopics
    .map(
      (topic) =>
        `<a href="#topic-${escapeHtml(topicToSlug(topic))}">${escapeHtml(topic)}</a>`,
    )
    .join(' | ');

  // Build topic sections
  const topicSections = sortedTopics
    .map((topic) => {
      const topicProblems = byTopic.get(topic) ?? [];
      const slug = topicToSlug(topic);

      const rows = topicProblems
        .map((p) => {
          const badgeColor = difficultyColor(p.difficulty);
          return `
        <tr>
          <td>${escapeHtml(p.title)}</td>
          <td><span class="difficulty-badge" style="background-color: ${badgeColor}">${escapeHtml(p.difficulty)}</span></td>
          <td><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">LeetCode</a></td>
          <td><a href="/notes/${escapeHtml(p.id)}">Notes</a></td>
        </tr>`;
        })
        .join('');

      return `
      <section class="topic-section" id="topic-${escapeHtml(slug)}">
        <h3>${escapeHtml(topic)} <span class="problem-count">(${topicProblems.length})</span></h3>
        <table class="catalog-table">
          <thead>
            <tr>
              <th>Problem</th>
              <th>Difficulty</th>
              <th>Link</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>`;
    })
    .join('');

  // Build CTA for new users
  const ctaHtml = hasCookie
    ? `<div class="cta-banner"><a href="/dashboard" class="cta-link">Go to Dashboard</a></div>`
    : `<div class="cta-banner highlight">
        <strong>New here?</strong> 
        <a href="/setup" class="cta-link">Create your database</a> to start tracking your progress!
        <p class="cta-note">Your data will be stored at: <code>${escapeHtml(defaultDataDir)}</code></p>
       </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Problem Catalog</title>
  <style>
    ${getCommonStyles()}

    /* Hide main-nav .catalog-link underline - topic-nav is different */
    .topic-nav {
      background-color: var(--bg-secondary);
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 2rem;
      line-height: 1.8;
    }
    
    .topic-nav a {
      color: var(--accent-blue);
      text-decoration: none;
      margin: 0 0.25rem;
    }
    
    .topic-nav a:hover {
      text-decoration: underline;
    }
    
    .topic-section {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    
    .topic-section h3 {
      margin-bottom: 1rem;
      color: var(--text-primary);
    }
    
    .problem-count {
      color: var(--text-muted);
      font-weight: normal;
      font-size: 0.9rem;
    }
    
    .catalog-table {
      width: 100%;
      border-collapse: collapse;
    }
    
    .catalog-table th,
    .catalog-table td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    
    .catalog-table th {
      color: var(--text-secondary);
      font-weight: 500;
    }
    
    .catalog-table a {
      color: var(--accent-blue);
      text-decoration: none;
    }
    
    .catalog-table a:hover {
      text-decoration: underline;
    }
    
    .difficulty-badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 500;
      color: white;
      text-transform: capitalize;
    }
    
    .cta-banner {
      background-color: var(--bg-secondary);
      padding: 1.5rem;
      border-radius: 12px;
      margin-bottom: 2rem;
      text-align: center;
    }
    
    .cta-banner.highlight {
      border: 2px solid var(--accent-blue);
      background-color: rgba(59, 130, 246, 0.1);
    }
    
    .cta-link {
      display: inline-block;
      background-color: var(--accent-blue);
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
      margin: 0.5rem;
    }
    
    .cta-link:hover {
      opacity: 0.9;
    }
    
    .cta-note {
      margin-top: 0.75rem;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    
    .cta-note code {
      background-color: var(--bg-card);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    ${renderNav('/catalog')}
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Problem Catalog - ${problems.length} curated problems</p>
    </header>
    
    ${ctaHtml}
    
    <nav class="topic-nav">
      <strong>Topics:</strong> ${navLinks}
    </nav>
    
    ${topicSections}
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Options for rendering the notes editor.
 */
export interface NotesEditorOptions {
  /** If true, show a 'Saved' confirmation banner. */
  readonly saved?: boolean;
}

/**
 * Render the notes/intuition editor page for a curriculum problem.
 * Full page with nav, styles, title, LeetCode link, prefilled+escaped textarea, Save button.
 */
export function renderNotesEditorHtml(
  problem: Problem,
  existingContent: string,
  opts?: NotesEditorOptions,
): string {
  const badgeColor = difficultyColor(problem.difficulty);
  const savedBanner = opts?.saved
    ? `<div class="saved-banner">✓ Saved successfully</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Notes: ${escapeHtml(problem.title)}</title>
  <style>
    ${getCommonStyles()}

    .notes-header {
      margin-bottom: 2rem;
    }
    
    .problem-title {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    
    .problem-meta {
      display: flex;
      gap: 1rem;
      align-items: center;
      color: var(--text-secondary);
    }
    
    .difficulty-badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 500;
      color: white;
      text-transform: capitalize;
    }
    
    .notes-form {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 2rem;
    }
    
    .notes-textarea {
      width: 100%;
      min-height: 300px;
      padding: 1rem;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 1rem;
      line-height: 1.6;
      resize: vertical;
      box-sizing: border-box;
    }
    
    .notes-textarea:focus {
      outline: none;
      border-color: var(--accent-blue);
    }
    
    .form-actions {
      margin-top: 1rem;
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    
    .save-button {
      padding: 0.75rem 1.5rem;
      background-color: var(--accent-blue);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    
    .save-button:hover {
      background-color: #2563eb;
    }
    
    .back-link {
      color: var(--text-secondary);
      text-decoration: none;
    }
    
    .back-link:hover {
      text-decoration: underline;
    }
    
    .saved-banner {
      background-color: #22c55e;
      color: white;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      text-align: center;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="container">
    ${renderNav('/catalog')}
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Your Intuition Notes</p>
    </header>
    
    ${savedBanner}
    
    <div class="notes-header">
      <h2 class="problem-title">${escapeHtml(problem.title)}</h2>
      <div class="problem-meta">
        <span class="difficulty-badge" style="background-color: ${badgeColor}">${escapeHtml(problem.difficulty)}</span>
        <a href="${escapeHtml(problem.url)}" target="_blank" rel="noopener">View on LeetCode</a>
      </div>
    </div>
    
    <div class="notes-form">
      <form method="POST" action="/notes/${encodeURIComponent(problem.id)}">
        <textarea name="content" class="notes-textarea" placeholder="Write your intuition, approach, and notes for this problem...">${escapeHtml(existingContent)}</textarea>
        <div class="form-actions">
          <button type="submit" class="save-button">Save</button>
          <a href="/catalog" class="back-link">&larr; Back to Catalog</a>
        </div>
      </form>
    </div>
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Render a page indicating the user needs to create a database first.
 * Friendly page with nav, dark theme, and a link/button to /setup.
 */
export function renderNotesNoDatabaseHtml(problem: Problem): string {
  const badgeColor = difficultyColor(problem.difficulty);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Notes: ${escapeHtml(problem.title)}</title>
  <style>
    ${getCommonStyles()}

    .notes-header {
      margin-bottom: 2rem;
    }
    
    .problem-title {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    
    .problem-meta {
      display: flex;
      gap: 1rem;
      align-items: center;
      color: var(--text-secondary);
    }
    
    .difficulty-badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 500;
      color: white;
      text-transform: capitalize;
    }
    
    .setup-cta {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 2rem;
      text-align: center;
    }
    
    .setup-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    
    .setup-text {
      color: var(--text-secondary);
      margin-bottom: 1rem;
    }
    
    .setup-button {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      background-color: var(--accent-blue);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-size: 1rem;
      transition: background-color 0.2s;
    }
    
    .setup-button:hover {
      background-color: #2563eb;
    }
    
    .back-link {
      display: block;
      color: var(--accent-blue);
      text-decoration: none;
      margin-top: 1rem;
    }
    
    .back-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    ${renderNav('/catalog')}
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Your Intuition Notes</p>
    </header>
    
    <div class="notes-header">
      <h2 class="problem-title">${escapeHtml(problem.title)}</h2>
      <div class="problem-meta">
        <span class="difficulty-badge" style="background-color: ${badgeColor}">${escapeHtml(problem.difficulty)}</span>
        <a href="${escapeHtml(problem.url)}" target="_blank" rel="noopener">View on LeetCode</a>
      </div>
    </div>
    
    <div class="setup-cta">
      <div class="setup-icon">🗄️</div>
      <p class="setup-text">To save your intuition notes, you need to create a database first.</p>
      <p class="setup-text">Your notes are stored locally on your machine — never uploaded anywhere.</p>
      <a href="/setup" class="setup-button">Create Database</a>
      <a href="/catalog" class="back-link">&larr; Back to Catalog</a>
    </div>
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Render the setup page for creating/selecting a data directory.
 */
export function renderSetupHtml(defaultPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Setup</title>
  <style>
    ${getCommonStyles()}

    .setup-form {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 2rem;
    }
    
    .form-group {
      margin-bottom: 1.5rem;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 0.5rem;
      color: var(--text-primary);
      font-weight: 500;
    }
    
    .form-group input[type="text"] {
      width: 100%;
      padding: 0.75rem;
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      color: var(--text-primary);
      font-size: 1rem;
    }
    
    .form-group input[type="text"]:focus {
      outline: none;
      border-color: var(--accent-blue);
    }
    
    .form-help {
      margin-top: 0.5rem;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    
    .submit-btn {
      background-color: var(--accent-blue);
      color: white;
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
    }
    
    .submit-btn:hover {
      opacity: 0.9;
    }
    
    .info-box {
      background-color: rgba(59, 130, 246, 0.1);
      border: 1px solid var(--accent-blue);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1.5rem;
    }
    
    .info-box h4 {
      margin-bottom: 0.5rem;
      color: var(--accent-blue);
    }
    
    .info-box p {
      color: var(--text-secondary);
      font-size: 0.9rem;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    ${renderNav('/setup')}
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Setup Your Progress Database</p>
    </header>
    
    <div class="setup-form">
      <div class="info-box">
        <h4>Local-First Storage</h4>
        <p>Your progress data stays on your machine. The server will create the directory if it doesn't exist and remember your choice via a browser cookie.</p>
      </div>
      
      <form method="POST" action="/setup">
        <div class="form-group">
          <label for="dataDir">Data Directory Path</label>
          <input type="text" id="dataDir" name="dataDir" value="${escapeHtml(defaultPath)}" required>
          <p class="form-help">Use ~ for your home directory (e.g., ~/.interviewbudai/data)</p>
        </div>
        
        <button type="submit" class="submit-btn">Create Database</button>
      </form>
    </div>
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Render a success page after creating the database.
 */
export function renderSetupSuccessHtml(dataDir: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Setup Complete</title>
  <style>
    ${getCommonStyles()}
    
    .success-box {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 2rem;
      text-align: center;
    }
    
    .success-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    
    .success-text {
      color: var(--accent-green);
      font-size: 1.2rem;
      margin-bottom: 1rem;
    }
    
    .path-display {
      background-color: var(--bg-card);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin: 1rem 0;
      font-family: monospace;
      color: var(--text-secondary);
    }
    
    .continue-link {
      display: inline-block;
      background-color: var(--accent-blue);
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
      margin-top: 1rem;
    }
    
    .continue-link:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    ${renderNav('/setup')}
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Setup Complete!</p>
    </header>
    
    <div class="success-box">
      <div class="success-icon">✅</div>
      <p class="success-text">Your database has been created successfully!</p>
      <p>Your progress data will be stored at:</p>
      <div class="path-display">${escapeHtml(dataDir)}</div>
      <p>This path has been saved in a browser cookie and will be remembered for future visits.</p>
      <a href="/dashboard" class="continue-link">Go to Dashboard</a>
    </div>
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Render an error page for setup failures.
 */
export function renderSetupErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Setup Error</title>
  <style>
    ${getCommonStyles()}
    
    .error-box {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 2rem;
      text-align: center;
      border: 2px solid var(--accent-red);
    }
    
    .error-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    
    .error-text {
      color: var(--accent-red);
      font-size: 1.1rem;
      margin-bottom: 1rem;
    }
    
    .error-details {
      background-color: var(--bg-card);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin: 1rem 0;
      color: var(--text-secondary);
    }
    
    .back-link {
      display: inline-block;
      color: var(--accent-blue);
      text-decoration: none;
      margin-top: 1rem;
    }
    
    .back-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    ${renderNav('/setup')}
    <header>
      <h1>InterviewBudAI</h1>
      <p class="tagline">Setup Error</p>
    </header>
    
    <div class="error-box">
      <div class="error-icon">❌</div>
      <p class="error-text">Could not create the database directory</p>
      <div class="error-details">${escapeHtml(message)}</div>
      <a href="/setup" class="back-link">&larr; Try Again</a>
    </div>
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Render a 404 Not Found page.
 */
export function render404Html(message?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - Not Found</title>
  <style>
    ${getCommonStyles()}
    
    .error-box {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 2rem;
      text-align: center;
    }
    
    .error-code {
      font-size: 4rem;
      font-weight: bold;
      color: var(--text-muted);
      margin-bottom: 1rem;
    }
    
    .error-text {
      color: var(--text-secondary);
      margin-bottom: 1rem;
    }
    
    .home-link {
      display: inline-block;
      color: var(--accent-blue);
      text-decoration: none;
    }
    
    .home-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    ${renderNav('')}
    <header>
      <h1>InterviewBudAI</h1>
    </header>
    
    <div class="error-box">
      <div class="error-code">404</div>
      <p class="error-text">${message ? escapeHtml(message) : 'The page you are looking for does not exist.'}</p>
      <a href="/catalog" class="home-link">Go to Catalog</a>
    </div>
    
    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}
