/**
 * @ibai/web — thin, locally hosted web front-end.
 *
 * Same engine as the CLI (front-end parity): capabilities live in @ibai/core
 * and the web app exposes them. Concrete adapters are injected at startup.
 */

export const PACKAGE_NAME = '@ibai/web';

// Config
export { resolveDataDir, resolvePort, resolveHost } from './config.js';

// Render
export {
  escapeHtml,
  renderAssessmentHtml,
  renderAssessmentJson,
} from './render.js';

// Handler
export { createAssessHandler } from './handler.js';
export type {
  AssessHandlerDeps,
  HandlerRequest,
  HandlerResponse,
} from './handler.js';

// Server
export { startServer } from './server.js';
export type { ServerHandle, StartServerOptions } from './server.js';
