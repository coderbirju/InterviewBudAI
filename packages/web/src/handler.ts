import type { StorageAdapter, SessionId, IsoTimestamp } from '@ibai/storage';
import type { LlmProvider, CompletionRequest } from '@ibai/providers';
import { assess, plan, coach } from '@ibai/core';
import type {
  AssessmentView,
  SessionPlan,
  PlanTopic,
  CoachResult,
  TopicOutcome,
} from '@ibai/core';
import {
  renderAssessmentJson,
  renderPlanJson,
  renderDashboardHtml,
  renderHomeHtml,
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
  escapeHtml,
} from './render.js';
import type { CompletedProblem } from './render.js';
import { createCatalogSource } from '@ibai/curriculum';
import type { CurriculumSource } from '@ibai/curriculum';
import {
  parseCookies,
  expandTilde,
  directoryExists,
  resolveDataDir,
  resolveDataDirWithCookie,
} from './config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Minimal response shape, decoupled from Node http types. */
export interface HandlerResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  /** Optional headers to include in response (e.g., Set-Cookie, Location). */
  readonly headers?: Record<string, string>;
}

/** Dependencies for the assess handler (DI). */
export interface AssessHandlerDeps {
  readonly storage: StorageAdapter;
}

/**
 * Dependencies for the coach handler (DI).
 * Extends AssessHandlerDeps with an optional provider for coach operations.
 */
export interface CoachHandlerDeps extends AssessHandlerDeps {
  readonly provider?: LlmProvider;
  /** Human-readable label for the active provider (shown in UI). */
  readonly providerLabel?: string;
  /** Curriculum catalog source for problem lookup. */
  readonly catalog?: CurriculumSource;
  /** Factory to create storage adapter for a given data directory. */
  readonly createStorage?: (dataDir: string) => StorageAdapter;
  /** Default data directory (from config). */
  readonly defaultDataDir?: string;
  /** Environment variables for config resolution. */
  readonly env?: NodeJS.ProcessEnv;
  /** CLI argv for config resolution. */
  readonly argv?: string[];
}

/**
 * Minimal request shape for the handler.
 * Extended to support POST bodies and headers for cookie-based routing.
 */
export interface HandlerRequest {
  readonly method: string;
  readonly url: string;
  /** Optional request body (for POST requests). */
  readonly body?: string;
  /** Optional content-type header. */
  readonly contentType?: string;
  /** Optional headers map for cookie parsing and other header access. */
  readonly headers?: Record<string, string | string[] | undefined>;
}

/**
 * A single entry in the interview transcript.
 * Tracks the interviewer question, user answer, and outcome for each topic.
 */
export interface InterviewTranscriptEntry {
  readonly topicId: string;
  readonly question: string;
  readonly answer: string;
  readonly succeeded: boolean;
}

/**
 * Parsed state from an interview POST form.
 * State is carried forward in hidden fields to maintain statelessness.
 */
interface InterviewState {
  readonly sessionId: string;
  readonly step: number;
  readonly transcript: InterviewTranscriptEntry[];
}

/**
 * Parse JSON outcomes from POST body.
 * Expected shape: { sessionId?: string, outcomes: Array<{ topicId, succeeded, note? }> }
 */
function parseJsonOutcomes(body: string): {
  sessionId?: string;
  outcomes: TopicOutcome[];
} {
  const parsed = JSON.parse(body);
  const outcomes: TopicOutcome[] = [];

  if (Array.isArray(parsed.outcomes)) {
    for (const o of parsed.outcomes) {
      if (typeof o.topicId === 'string' && typeof o.succeeded === 'boolean') {
        outcomes.push({
          topicId: o.topicId,
          succeeded: o.succeeded,
          note:
            typeof o.note === 'string' && o.note.trim()
              ? o.note.trim()
              : undefined,
        });
      }
    }
  }

  return {
    sessionId:
      typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
    outcomes,
  };
}

/**
 * Check if an error looks like a connection refused error (Ollama not running).
 */
function isConnectionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('fetch failed') ||
      msg.includes('connection refused') ||
      msg.includes('network error')
    );
  }
  return false;
}

/**
 * Parse interview state from POST form body.
 * Hidden fields carry: sessionId, step, question_<topicId>, answer_<topicId>, outcome_<topicId>
 */
function parseInterviewState(body: string): InterviewState {
  const params = new URLSearchParams(body);
  const sessionId = params.get('sessionId') ?? generateSessionId();
  const step = parseInt(params.get('step') ?? '0', 10);

  const transcript: InterviewTranscriptEntry[] = [];

  // Collect all completed topic entries (have question, answer, and outcome)
  for (const [key, value] of params.entries()) {
    if (key.startsWith('question_')) {
      const topicId = key.slice('question_'.length);
      const answer = params.get(`answer_${topicId}`);
      const outcomeVal = params.get(`outcome_${topicId}`);

      // Only include if we have all required fields
      if (answer !== null && (outcomeVal === 'pass' || outcomeVal === 'fail')) {
        transcript.push({
          topicId,
          question: value,
          answer,
          succeeded: outcomeVal === 'pass',
        });
      }
    }
  }

  return { sessionId, step, transcript };
}

/**
 * Build a CompletionRequest for the interviewer to ask a question about a topic.
 * The provider ONLY asks probing questions — NEVER provides answers or solutions.
 */
function buildInterviewQuestion(topic: PlanTopic): CompletionRequest {
  const roleDescription =
    topic.role === 'warmup'
      ? 'warm-up (confidence builder)'
      : topic.role === 'twist'
        ? 'stretch/challenge'
        : 'focus area';

  return {
    messages: [
      {
        role: 'system',
        content: `You are a technical interviewer conducting a practice interview session. Your role is to ask ONE clear, focused question about the topic "${topic.topicId}" (this is a ${roleDescription} topic). 

RULES:
- Ask ONE question only
- Be conversational but professional
- Do NOT provide answers, hints, or solutions
- Do NOT explain what a good answer would be
- Keep the question concise (1-3 sentences)
- Match difficulty to the role: ${topic.role === 'warmup' ? 'easier, confidence-building' : topic.role === 'twist' ? 'challenging, edge cases' : 'moderate, core concepts'}`,
      },
      {
        role: 'user',
        content: 'Please ask me an interview question.',
      },
    ],
  };
}

/**
 * Create the assess handler with injected dependencies.
 * Supports both assess-only routes (GET) and coach routes (GET form, POST execute).
 */
export function createAssessHandler(
  deps: AssessHandlerDeps,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  return createCoachHandler(deps);
}

/**
 * Create the full handler with optional coach support.
 * If provider is not supplied, coach POST routes return an error instructing
 * the user to configure IBAI_OLLAMA_MODEL.
 */
export function createCoachHandler(
  deps: CoachHandlerDeps,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  return async (req: HandlerRequest): Promise<HandlerResponse> => {
    // Parse URL
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // Determine route
    const isGet = req.method === 'GET';
    const isPost = req.method === 'POST';

    // GET routes
    const isAssessJson = isGet && pathname === '/assess.json';
    const isPlanJson = isGet && pathname === '/plan.json';
    const isHome = isGet && pathname === '/';
    const isDashboard = isGet && pathname === '/dashboard';
    const isHtml = isGet && pathname === '/assess';
    const isCoachForm = isGet && pathname === '/coach';
    const isCatalog = isGet && pathname === '/catalog';
    const isNotesGet = isGet && pathname.startsWith('/notes/');
    const isNotesPost = isPost && pathname.startsWith('/notes/');
    const isSetupForm = isGet && pathname === '/setup';

    // POST routes
    const isCoachPost = isPost && pathname === '/coach';
    const isCoachJsonPost = isPost && pathname === '/coach.json';
    const isSetupPost = isPost && pathname === '/setup';

    // Known paths (for 405 vs 404 distinction)
    const knownPaths = [
      '/',
      '/assess',
      '/assess.json',
      '/plan.json',
      '/coach',
      '/coach.json',
      '/catalog',
      '/setup',
      '/dashboard',
    ];
    // Also handle /notes/<id> routes
    const isKnownPath =
      knownPaths.includes(pathname) || pathname.startsWith('/notes/');

    // 405 for unsupported methods on known paths
    if (isKnownPath && !isGet && !isPost) {
      return {
        status: 405,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // 405 for POST on GET-only paths
    if (
      isPost &&
      (pathname === '/' ||
        pathname === '/assess' ||
        pathname === '/assess.json' ||
        pathname === '/plan.json' ||
        pathname === '/dashboard')
    ) {
      return {
        status: 405,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // 404 for unknown paths
    if (
      !isAssessJson &&
      !isPlanJson &&
      !isHome &&
      !isDashboard &&
      !isHtml &&
      !isCoachForm &&
      !isCoachPost &&
      !isCoachJsonPost &&
      !isCatalog &&
      !isNotesGet &&
      !isNotesPost &&
      !isSetupForm &&
      !isSetupPost
    ) {
      return {
        status: 404,
        contentType: 'text/html; charset=utf-8',
        body: render404Html(),
      };
    }

    // Get catalog source (default to static catalog)
    const catalog = deps.catalog ?? createCatalogSource();

    // Parse cookies for dataDir resolution
    const cookieHeader =
      typeof req.headers?.cookie === 'string' ? req.headers.cookie : undefined;
    const cookies = parseCookies(cookieHeader);
    const cookieDataDir = cookies['ibai_data_dir'];
    const hasCookie = !!cookieDataDir;

    // Resolve default data directory (for display in forms)
    const defaultDataDir =
      deps.defaultDataDir ?? resolveDataDir(deps.env, deps.argv);

    // Handle /catalog (GET) - gather completed IDs from storage if available
    if (isCatalog) {
      const problems = catalog.list();

      // Gather completed problem IDs (read-only, safe to fail)
      const completedIds = new Set<string>();
      const resolvedDir = resolveDataDirWithCookie(
        cookieDataDir,
        deps.env,
        deps.argv,
      );
      const catalogStorage =
        directoryExists(resolvedDir) && deps.createStorage
          ? deps.createStorage(resolvedDir)
          : null;

      if (catalogStorage?.readIntuitionNote) {
        for (const problem of problems) {
          try {
            const note = await catalogStorage.readIntuitionNote(problem.id);
            if (note?.completed) {
              completedIds.add(problem.id);
            }
          } catch {
            // Ignore errors - safe empty state
          }
        }
      }

      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: renderCatalogHtml(
          problems,
          hasCookie,
          defaultDataDir,
          completedIds,
        ),
      };
    }

    // Handle /notes/<id> (GET and POST)
    if (isNotesGet || isNotesPost) {
      const problemId = pathname.slice('/notes/'.length);
      const problem = catalog.getById(problemId);

      if (!problem) {
        return {
          status: 404,
          contentType: 'text/html; charset=utf-8',
          body: render404Html(`Problem "${problemId}" not found in catalog.`),
        };
      }

      // Check if database exists (same detection used elsewhere)
      // Cookie dir takes precedence if it exists
      const defaultDir = resolveDataDir(deps.env, deps.argv);
      const hasCookieDir =
        cookieDataDir && directoryExists(expandTilde(cookieDataDir));
      const hasDefaultDir = directoryExists(defaultDir);
      const hasDatabaseDir = hasCookieDir || hasDefaultDir;

      if (!hasDatabaseDir) {
        // No database exists - render friendly CTA page
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderNotesNoDatabaseHtml(problem),
        };
      }

      // Database exists - resolve the data dir and create storage
      const notesDataDir = resolveDataDirWithCookie(
        cookieDataDir,
        deps.env,
        deps.argv,
      );
      const notesStorage = deps.createStorage
        ? deps.createStorage(notesDataDir)
        : deps.storage;

      if (isNotesPost) {
        // POST: Save the note content
        const formParams = new URLSearchParams(req.body ?? '');
        const content = formParams.get('content') ?? '';
        // Checkbox: present in form data = true, absent = false
        const completed = formParams.has('completed');
        const timeComplexity = formParams.get('timeComplexity') || undefined;
        const spaceComplexity = formParams.get('spaceComplexity') || undefined;

        // Read existing note to preserve attempts
        const existingNote = await notesStorage.readIntuitionNote?.(problemId);

        // Write the note
        await notesStorage.writeIntuitionNote?.({
          problemId,
          content,
          lastUpdated: new Date().toISOString() as IsoTimestamp,
          attempts: existingNote?.attempts,
          completed,
          timeComplexity,
          spaceComplexity,
        });

        // Re-render the editor with 'Saved' banner and new values
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderNotesEditorHtml(problem, content, {
            saved: true,
            completed,
            timeComplexity,
            spaceComplexity,
          }),
        };
      }

      // GET: Read the note and render editor
      const note = await notesStorage.readIntuitionNote?.(problemId);
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: renderNotesEditorHtml(problem, note?.content ?? '', {
          completed: note?.completed,
          timeComplexity: note?.timeComplexity,
          spaceComplexity: note?.spaceComplexity,
        }),
      };
    }

    // Handle /setup (GET) - show form
    if (isSetupForm) {
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: renderSetupHtml(defaultDataDir),
      };
    }

    // Handle /setup (POST) - create database directory
    if (isSetupPost) {
      const formParams = new URLSearchParams(req.body ?? '');
      let rawPath = formParams.get('dataDir') ?? defaultDataDir;

      // Normalize path: expand ~, resolve to absolute
      rawPath = expandTilde(rawPath);
      const resolvedPath = path.resolve(rawPath);

      try {
        // Create directory (recursive, like mkdir -p)
        fs.mkdirSync(resolvedPath, { recursive: true });

        // Set cookie and return success
        const cookieValue = encodeURIComponent(resolvedPath);
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderSetupSuccessHtml(resolvedPath),
          headers: {
            'Set-Cookie': `ibai_data_dir=${cookieValue}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`,
          },
        };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unknown error creating directory';
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderSetupErrorHtml(message),
        };
      }
    }

    // For routes that need storage, resolve dataDir with cookie precedence
    const resolvedDataDir = resolveDataDirWithCookie(
      cookieDataDir,
      deps.env,
      deps.argv,
    );

    // Create storage adapter for resolved directory
    // Use createStorage factory if provided, otherwise use deps.storage
    const storage = deps.createStorage
      ? deps.createStorage(resolvedDataDir)
      : deps.storage;

    // Handle / (home page) - works for all users, shows empty state if no data
    if (isHome) {
      try {
        const view = await assess(storage);
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderHomeHtml(view),
        };
      } catch {
        // On any error (no data, missing dir, etc), show empty state
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderHomeHtml(null),
        };
      }
    }

    // Extract optional sessionId from query
    const sessionIdParam = url.searchParams.get('sessionId');
    const sessionId: SessionId | undefined = sessionIdParam ?? undefined;

    try {
      // Get assessment view (reads storage once)
      const view: AssessmentView = await assess(storage, sessionId);

      // Derive session plan (pure, sync - no storage read)
      const sessionPlan: SessionPlan = plan(view);

      // Handle GET routes
      if (isAssessJson) {
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: renderAssessmentJson(view),
        };
      }

      if (isPlanJson) {
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: renderPlanJson(sessionPlan),
        };
      }

      if (isHtml || isDashboard) {
        // Gather completed problems for display
        const completedProblems: CompletedProblem[] = [];
        const problems = catalog.list();

        if (storage.readIntuitionNote) {
          for (const problem of problems) {
            try {
              const note = await storage.readIntuitionNote(problem.id);
              if (note?.completed) {
                completedProblems.push({
                  id: problem.id,
                  title: problem.title,
                });
              }
            } catch {
              // Ignore errors - safe empty state
            }
          }
        }

        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderDashboardHtml(view, sessionPlan, completedProblems),
        };
      }

      if (isCoachForm) {
        // GET /coach - start interactive interview at step 0
        // Handle zero topics case
        if (sessionPlan.topics.length === 0) {
          return {
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: renderNoTopicsState(deps.providerLabel),
          };
        }

        // Check if provider is configured
        if (!deps.provider) {
          return {
            status: 400,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml(
              'Configuration Error',
              'Interview requires a provider. Please configure IBAI_OLLAMA_MODEL.',
            ),
          };
        }

        // Start at step 0 with a new session
        const newSessionId = sessionId ?? generateSessionId();
        const firstTopic = sessionPlan.topics[0];

        // TypeScript narrowing: we already checked topics.length > 0 above
        if (!firstTopic) {
          return {
            status: 500,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml(
              'Error',
              'No topics available for interview.',
            ),
          };
        }

        // Get interviewer question for first topic
        let questionText: string;
        try {
          const questionRequest = buildInterviewQuestion(firstTopic);
          const response = await deps.provider.complete(questionRequest);
          questionText = response.content;
        } catch (providerError) {
          if (isConnectionError(providerError)) {
            return {
              status: 502,
              contentType: 'text/html; charset=utf-8',
              body: renderErrorHtml(
                'Connection Error',
                "Could not connect to Ollama. Is Ollama running? Start it with 'ollama serve'.",
              ),
            };
          }
          throw providerError;
        }

        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderInterviewStep(
            0,
            sessionPlan.topics.length,
            firstTopic,
            questionText,
            [],
            newSessionId,
            deps.providerLabel,
          ),
        };
      }

      // Handle POST /coach.json (unchanged - receives outcomes, runs coach)
      if (isCoachJsonPost) {
        // Check if provider is configured
        if (!deps.provider) {
          return {
            status: 400,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({
              error:
                'Coach requires IBAI_OLLAMA_MODEL to be set. Please configure the model environment variable.',
            }),
          };
        }

        // Parse outcomes from body
        let outcomes: TopicOutcome[];
        let bodySessionId: string | undefined;

        try {
          const parsed = parseJsonOutcomes(req.body ?? '');
          outcomes = parsed.outcomes;
          bodySessionId = parsed.sessionId;
        } catch (parseError) {
          return {
            status: 400,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({
              error:
                parseError instanceof Error
                  ? parseError.message
                  : 'Invalid request body',
            }),
          };
        }

        const coachSessionId =
          bodySessionId ?? sessionId ?? generateSessionId();

        const input = {
          sessionId: coachSessionId,
          plan: sessionPlan,
          outcomes,
          assessment: view,
          completedAt: new Date().toISOString() as IsoTimestamp,
        };

        let result: CoachResult;
        try {
          result = await coach({ storage, provider: deps.provider }, input);
        } catch (coachError) {
          if (isConnectionError(coachError)) {
            return {
              status: 502,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({
                error:
                  "Could not connect to Ollama. Is Ollama running? Start it with 'ollama serve'.",
              }),
            };
          }
          throw coachError;
        }

        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: renderCoachJson(result),
        };
      }

      // Handle POST /coach (interactive interview step progression)
      if (isCoachPost) {
        // Check if provider is configured
        if (!deps.provider) {
          return {
            status: 400,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml(
              'Configuration Error',
              'Interview requires a provider. Please configure IBAI_OLLAMA_MODEL.',
            ),
          };
        }

        // Parse interview state from form
        let interviewState: InterviewState;
        try {
          interviewState = parseInterviewState(req.body ?? '');
        } catch (parseError) {
          return {
            status: 400,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml(
              'Parse Error',
              parseError instanceof Error
                ? parseError.message
                : 'Invalid form data',
            ),
          };
        }

        // Get current answer from form (for the topic that was just answered)
        const formParams = new URLSearchParams(req.body ?? '');
        const currentAnswer = formParams.get('current_answer') ?? '';
        const currentOutcome = formParams.get('current_outcome');
        const currentQuestion = formParams.get('current_question') ?? '';

        // Validate current answer (must have answer and outcome)
        if (
          !currentAnswer.trim() ||
          (currentOutcome !== 'pass' && currentOutcome !== 'fail')
        ) {
          return {
            status: 400,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml(
              'Incomplete Response',
              'Please provide an answer and select Pass or Fail before continuing.',
            ),
          };
        }

        // Get the current topic
        const currentStep = interviewState.step;
        if (currentStep >= sessionPlan.topics.length) {
          return {
            status: 400,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml(
              'Invalid Step',
              'Interview step out of range.',
            ),
          };
        }

        const currentTopic = sessionPlan.topics[currentStep];

        // TypeScript narrowing: step is validated above but array access still returns T | undefined
        if (!currentTopic) {
          return {
            status: 400,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml('Invalid Step', 'Current topic not found.'),
          };
        }

        // Build updated transcript with current answer
        const updatedTranscript: InterviewTranscriptEntry[] = [
          ...interviewState.transcript,
          {
            topicId: currentTopic.topicId,
            question: currentQuestion,
            answer: currentAnswer.trim(),
            succeeded: currentOutcome === 'pass',
          },
        ];

        const nextStep = currentStep + 1;

        // Check if interview is complete
        if (nextStep >= sessionPlan.topics.length) {
          // Interview complete - convert transcript to outcomes and run coach
          const outcomes: TopicOutcome[] = updatedTranscript.map((entry) => ({
            topicId: entry.topicId,
            succeeded: entry.succeeded,
            note: entry.answer, // Store the answer as the note
          }));

          const input = {
            sessionId: interviewState.sessionId,
            plan: sessionPlan,
            outcomes,
            assessment: view,
            completedAt: new Date().toISOString() as IsoTimestamp,
          };

          let result: CoachResult;
          try {
            result = await coach({ storage, provider: deps.provider }, input);
          } catch (coachError) {
            if (isConnectionError(coachError)) {
              return {
                status: 502,
                contentType: 'text/html; charset=utf-8',
                body: renderErrorHtml(
                  'Connection Error',
                  "Could not connect to Ollama. Is Ollama running? Start it with 'ollama serve'.",
                ),
              };
            }
            throw coachError;
          }

          return {
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: renderCoachResult(
              interviewState.sessionId,
              sessionPlan,
              result,
            ),
          };
        }

        // More topics remain - get next question
        const nextTopic = sessionPlan.topics[nextStep];

        // TypeScript narrowing: nextStep is validated above but array access still returns T | undefined
        if (!nextTopic) {
          return {
            status: 500,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml('Error', 'Next topic not found.'),
          };
        }

        let questionText: string;
        try {
          const questionRequest = buildInterviewQuestion(nextTopic);
          const response = await deps.provider.complete(questionRequest);
          questionText = response.content;
        } catch (providerError) {
          if (isConnectionError(providerError)) {
            return {
              status: 502,
              contentType: 'text/html; charset=utf-8',
              body: renderErrorHtml(
                'Connection Error',
                "Could not connect to Ollama. Is Ollama running? Start it with 'ollama serve'.",
              ),
            };
          }
          throw providerError;
        }

        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderInterviewStep(
            nextStep,
            sessionPlan.topics.length,
            nextTopic,
            questionText,
            updatedTranscript,
            interviewState.sessionId,
            deps.providerLabel,
          ),
        };
      }

      // Should not reach here
      return {
        status: 500,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Internal routing error' }),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Internal server error';
      const isJson = isAssessJson || isPlanJson || isCoachJsonPost;
      const contentType = isJson
        ? 'application/json; charset=utf-8'
        : 'text/html; charset=utf-8';
      const body = isJson
        ? JSON.stringify({ error: message })
        : renderErrorHtml('Error', message);

      return {
        status: 500,
        contentType,
        body,
      };
    }
  };
}

/**
 * Render a simple error HTML page with the dark theme.
 */
function renderErrorHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - ${escapeHtml(title)}</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent-red: #ef4444;
      --border-color: #475569;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .error-card {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 2rem;
      max-width: 500px;
      text-align: center;
      border-left: 4px solid var(--accent-red);
    }
    h1 {
      color: var(--accent-red);
      margin-bottom: 1rem;
    }
    p {
      color: var(--text-secondary);
    }
    a {
      color: #3b82f6;
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="error-card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <p style="margin-top: 1rem;"><a href="/">← Back to Dashboard</a></p>
  </div>
</body>
</html>`;
}

/**
 * Generate a simple session ID based on timestamp.
 */
function generateSessionId(): string {
  return `session-${Date.now()}`;
}
