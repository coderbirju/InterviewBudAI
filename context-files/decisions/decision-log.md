# Decision Log

- **cookie-persistence**: Session cookie was root cause of path not surviving browser restart; fixed by adding Max-Age=31536000 for ~1 year persistence.

- **ai-eval-engine**: ADR 0005 D6 implementation: coach()/CoachInput contract changed to AI-evaluation (model evaluates candidate's typed answers, returns structured per-topic verdicts, fail-closed on malformed output). EchoDemoProvider removed (supersedes ADR 0004). Provider now REQUIRED (Anthropic or Ollama).
