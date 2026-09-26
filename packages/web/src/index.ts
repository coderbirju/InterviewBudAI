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
  resolveServerDataDir,
  readLocalConfig,
  writeLocalConfig,
  localConfigPathFor,
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
  renderNav,
  computeStatusCounts,
  renderSetupHtml,
  renderSetupSuccessHtml,
  renderSetupErrorHtml,
  render404Html,
} from './render.js';
export type { StatusCounts } from './render.js';

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

// SPA (React bundle served at the site root — ADR 0006 M6)
export { isSpaRequest, bundleExists, handleSpaRequest } from './spa.js';

// JSON API (served under /api — ADR 0006 D4, M1)
export { isApiRoute, handleApiRoute } from './api.js';
export type {
  ApiDeps,
  ApiCatalogProblem,
  ApiCatalogTopic,
  ApiCatalogResponse,
  ApiProgressResponse,
  ApiCompetencyTopic,
  ApiCompetencyPattern,
  ApiCompetencyResponse,
  ApiNoteResponse,
  ApiConfigResponse,
  ApiDataDirResponse,
} from './api.js';

// Server-owned data dir + legacy-cookie recovery (ADR 0009 D1)
export { DataDirControl, countNotes } from './data-dir-control.js';
export type {
  DataDirStatus,
  LegacyCandidate,
  ChooseResult,
} from './data-dir-control.js';
