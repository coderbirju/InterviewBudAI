/**
 * Server-side HTML/JSON rendering for @ibai/web.
 *
 * M6 (ADR 0006) retired the server-rendered product pages — the React SPA is
 * now the whole UI (home/catalog/notes/analytics/interview all live in the
 * SPA). What remains here is the small surface the server still renders:
 *   - the `/setup` create-database flow (form / success / error), and
 *   - a shared 404 page for the rare unmatched route.
 * Plus the shared helpers they use (`escapeHtml`, `getCommonStyles`,
 * `renderNav`) and `computeStatusCounts`, which the JSON API (`api.ts`) reuses.
 */

import type { NoteStatus } from '@ibai/storage';

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
 * Counts of problems by resolved {@link NoteStatus}. The four keys always
 * exist (default 0) so callers render deterministically. Consumed by the JSON
 * API (`/api/catalog`, `/api/progress`).
 */
export interface StatusCounts {
  readonly done: number;
  readonly to_revisit: number;
  readonly did_not_understand: number;
  readonly none: number;
}

/**
 * Tally resolved note statuses into a {@link StatusCounts}. Input is the list
 * of already-resolved statuses (one per problem the caller iterated). Pure and
 * sync; the caller does the storage reads and resolution.
 */
export function computeStatusCounts(
  statuses: readonly NoteStatus[],
): StatusCounts {
  const counts = { done: 0, to_revisit: 0, did_not_understand: 0, none: 0 };
  for (const s of statuses) {
    counts[s] += 1;
  }
  return counts;
}

/**
 * Shared CSS for the remaining server-rendered pages (`/setup`, 404). The dark
 * theme + design tokens match the SPA so the create-database flow feels part of
 * the same app.
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

    /* Navigation (wordmark only — the SPA owns product nav) */
    .main-nav {
      background-color: var(--bg-secondary);
      padding: 0.75rem 1rem;
      margin-bottom: 2rem;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .nav-wordmark {
      font-weight: 700;
      font-size: 1.25rem;
      text-decoration: none;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
  `;
}

/**
 * Render the minimal navigation bar for the remaining server-rendered pages.
 *
 * M6: the SPA owns all product navigation (Home / Interview / Analytics via
 * client-side routing). The `/setup` and 404 pages only need the wordmark,
 * which links back to the SPA at the site root.
 */
export function renderNav(): string {
  return `<nav class="main-nav" role="navigation" aria-label="Main navigation">
    <a href="/" class="nav-wordmark">InterviewBudAI</a>
  </nav>`;
}

/**
 * Render the setup form page for creating the progress database. When a
 * `csrfToken` is given it is embedded as a hidden field; `POST /setup` rejects
 * submissions that do not echo the server's per-process token.
 */
export function renderSetupHtml(
  defaultPath: string,
  csrfToken?: string,
): string {
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
    ${renderNav()}
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
        ${csrfToken !== undefined ? `<input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">` : ''}
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
 * Render a success page after creating the database. Links back to the SPA at
 * the site root (M6).
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
    ${renderNav()}
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
      <a href="/" class="continue-link">Go to InterviewBudAI</a>
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
    ${renderNav()}
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
 * Render a 404 Not Found page. Links back to the SPA at the site root (M6).
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
    ${renderNav()}
    <header>
      <h1>InterviewBudAI</h1>
    </header>

    <div class="error-box">
      <div class="error-code">404</div>
      <p class="error-text">${message ? escapeHtml(message) : 'The page you are looking for does not exist.'}</p>
      <a href="/" class="home-link">Go to InterviewBudAI</a>
    </div>

    <footer>
      <p>InterviewBudAI &mdash; Local-first, privacy-focused interview prep</p>
    </footer>
  </div>
</body>
</html>`;
}
