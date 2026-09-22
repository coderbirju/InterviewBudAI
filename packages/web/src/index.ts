/**
 * @ibai/web — thin, locally hosted web front-end.
 *
 * Same engine as the CLI (front-end parity): capabilities live in @ibai/core
 * and the web app exposes them. Concrete adapters are injected at startup.
 */

export const PACKAGE_NAME = '@ibai/web';

// Config
export {
  resolveDataDir,
  resolveDataDirWithCookie,
  resolvePort,
  resolveHost,
  resolveOllamaUrl,
  resolveOllamaModel,
  parseCookies,
  expandTilde,
  directoryExists,
} from './config.js';

// Render
export {
  escapeHtml,
  getCommonStyles,
  renderAssessmentHtml,
  renderAssessmentJson,
  renderPlanJson,
  renderDashboardHtml,
  renderCoachResult,
  renderCoachJson,
  renderInterviewStep,
  renderNoTopicsState,
  renderCatalogHtml,
  renderNotesEditorHtml,
  renderNotesNoDatabaseHtml,
  renderSetupHtml,
  renderSetupSuccessHtml,
  renderSetupErrorHtml,
  render404Html,
} from './render.js';

// Handler
export { createAssessHandler, createCoachHandler } from './handler.js';
export type {
  AssessHandlerDeps,
  CoachHandlerDeps,
  HandlerRequest,
  HandlerResponse,
} from './handler.js';

// Server
export { startServer } from './server.js';
export type { ServerHandle, StartServerOptions } from './server.js';
