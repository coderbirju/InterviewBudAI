import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
} from 'lucide-react';
import { ApiError, fetchConfig, postChat } from '../lib/api';
import type { ChatMessage } from '../lib/api';

/**
 * The M5 Interview chat view (ADR 0006). A React SPA page at `/app/interview`
 * that moves the interview conversation into the SPA, replacing the Interview
 * nav link's old target (the server-rendered `/coach`, which stays until M6).
 *
 * It renders a running transcript (candidate vs coach turns) + a composer.
 * On Send it OPTIMISTICALLY appends the candidate's turn, POSTs the whole
 * transcript to `POST /api/chat`, and appends the model's `{ reply }`. The
 * MODEL is the only source of assistant text (charter §6.2) — this component
 * ships NO canned answers; a failed turn shows an inline banner and PRESERVES
 * the transcript rather than crashing or fabricating a reply.
 *
 * Provider is REQUIRED: if none is configured the page shows a "configure a
 * model" state (detected up-front via `GET /api/config`, and defensively again
 * if a send returns the provider-required `400`). All values render via JSX
 * (auto-escaped); no `dangerouslySetInnerHTML`.
 */

/** Whether the provider gate has been resolved yet, and its outcome. */
type ProviderState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly provider: string }
  | { readonly kind: 'no-provider' };

export function Interview(): JSX.Element {
  const [providerState, setProviderState] = useState<ProviderState>({
    kind: 'checking',
  });
  const [transcript, setTranscript] = useState<readonly ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  // Up-front provider gate. A config-fetch failure is treated as "unknown but
  // let them try" → ready with a neutral label, so a flaky /api/config never
  // hard-blocks the page (the send path re-checks and shows the same state).
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const config = await fetchConfig();
        if (cancelled) {
          return;
        }
        const configured =
          !!config.provider &&
          config.provider.toLowerCase() !== 'no model configured';
        setProviderState(
          configured
            ? { kind: 'ready', provider: config.provider }
            : { kind: 'no-provider' },
        );
      } catch {
        if (!cancelled) {
          setProviderState({ kind: 'ready', provider: '' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the newest turn / thinking indicator in view. Guarded because jsdom
  // (test env) does not implement scrollIntoView.
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ block: 'end' });
    }
  }, [transcript, sending]);

  const onSend = useCallback(async (): Promise<void> => {
    const content = draft.trim();
    if (!content || sending) {
      return;
    }

    // Optimistically append the candidate's turn and clear the composer.
    const withUser: readonly ChatMessage[] = [
      ...transcript,
      { role: 'user', content },
    ];
    setTranscript(withUser);
    setDraft('');
    setError(null);
    setSending(true);

    try {
      const { reply } = await postChat(withUser);
      // The MODEL is the only source of assistant text — append its reply.
      setTranscript((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      // Preserve the transcript (incl. the user's turn). Surface the server's
      // message; a provider-required 400 flips into the configure state.
      if (err instanceof ApiError && err.status === 400) {
        setProviderState({ kind: 'no-provider' });
      }
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the interview coach. Please try again.',
      );
    } finally {
      setSending(false);
    }
  }, [draft, sending, transcript]);

  // Provider-required state (up-front, before any transcript exists).
  if (providerState.kind === 'no-provider') {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold text-slate-100">
          Configure a model to start
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          The interview chat needs a language model. Set{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
            ANTHROPIC_API_KEY
          </code>{' '}
          +{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
            IBAI_ANTHROPIC_MODEL
          </code>{' '}
          or{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
            IBAI_OLLAMA_MODEL
          </code>
          , then restart the server and reload this page.
        </p>
      </div>
    );
  }

  if (providerState.kind === 'checking') {
    return (
      <div
        className="flex items-center gap-2 text-slate-400"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Preparing your interview…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Transcript. */}
      <div
        className="space-y-4"
        role="log"
        aria-label="Interview transcript"
        aria-live="polite"
      >
        {transcript.length === 0 && !sending && (
          <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
            <MessageSquare
              className="mx-auto h-10 w-10 text-emerald-500"
              aria-hidden
            />
            <h2 className="mt-4 text-xl font-semibold text-slate-100">
              Start the conversation
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
              Ask for a problem, talk through your reasoning, or request
              feedback. Your coach responds below.
            </p>
          </div>
        )}

        {transcript.map((turn, i) => (
          <ChatBubble key={i} role={turn.role} content={turn.content} />
        ))}

        {sending && (
          <div
            className="flex items-center gap-2 text-sm text-slate-400"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Your coach is thinking…
          </div>
        )}

        <div ref={scrollAnchorRef} />
      </div>

      {/* Inline error banner (preserves the transcript). */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-status-blocked/40 bg-status-blocked/10 p-4 text-slate-200"
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-status-blocked"
            aria-hidden
          />
          <div>
            <p className="font-semibold">Couldn&apos;t send that message</p>
            <p className="mt-1 text-sm text-slate-400">{error}</p>
          </div>
        </div>
      )}

      {/* Composer. */}
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSend();
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Your message
        </label>
        <textarea
          id="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          rows={2}
          placeholder="Talk through your reasoning, or ask for a problem…"
          className="min-h-[2.75rem] w-full resize-y rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          Send
        </button>
      </form>
    </div>
  );
}

/**
 * A single chat turn. Candidate turns align right (emerald), coach turns align
 * left (slate). Content renders via JSX (auto-escaped) and preserves the
 * model's line breaks with `whitespace-pre-wrap` — no `dangerouslySetInnerHTML`.
 */
function ChatBubble({
  role,
  content,
}: {
  readonly role: ChatMessage['role'];
  readonly content: string;
}): JSX.Element {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm transition-all duration-200 ${
          isUser
            ? 'bg-emerald-500 text-slate-900'
            : 'border border-slate-800 bg-slate-800/60 text-slate-100'
        }`}
      >
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide opacity-70">
          {isUser ? 'You' : 'Coach'}
        </span>
        {content}
      </div>
    </div>
  );
}
