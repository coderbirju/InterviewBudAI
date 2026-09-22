# Decision Log

- **cookie-persistence**: Session cookie was root cause of path not surviving browser restart; fixed by adding Max-Age=31536000 for ~1 year persistence.

- **ai-eval-engine**: ADR 0005 D6 implementation: coach()/CoachInput contract changed to AI-evaluation (model evaluates candidate's typed answers, returns structured per-topic verdicts, fail-closed on malformed output). EchoDemoProvider removed (supersedes ADR 0004). Provider now REQUIRED (Anthropic or Ollama).

- **ai-interview-ui**: Step 5b complete. Self-assess Pass/Fail removed (charter 6.2: model evaluates, not user). Turn-by-turn AI interview feeding coach() answers→evaluations. POST /coach + /coach.json ungated. Provider-required friendly state (200 config page, not 4xx error). Fail-closed friendly error handling (isConnectionError, isAuthError, malformed output → 502 with helpful message, no writes). README updated: removed zero-config/demo references, documented provider requirement (Anthropic or Ollama). Last deferred roadmap item: bulk-import of founder's Notion intuitions.
