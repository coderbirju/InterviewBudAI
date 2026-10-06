import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  Copy,
  Cpu,
  Code2,
  FolderOpen,
  Info,
  Loader2,
  Lock,
  Plug,
  Terminal,
} from 'lucide-react';
import { Disclosure } from './Disclosure';
import {
  ApiError,
  fetchPreferences,
  fetchSettings,
  savePreferences,
  testProviderConnection,
} from '../lib/api';
import type {
  CodeLanguage,
  DataDirSource,
  Preferences,
  PreferencesPatch,
  ProviderKind,
  ProviderTestResult,
  SettingsResponse,
} from '../lib/api';
import { dataHref, isPlainClick, navigate } from '../lib/router';

/**
 * Settings (`/settings`, ADR 0008 Wave 2(c-lite)) — read-only provider status,
 * laid out at-a-glance first (founder feedback 2026-10-05):
 *
 *  1. AI provider — active provider, model, Ollama / OpenAI-compatible
 *     endpoint (origin only), key configured ✓/✗, connection status and an
 *     explicit "Test connection" (Anthropic: one tiny billable call). Provider
 *     hints (half-set config, plain-HTTP key, ignored OpenAI config) and the
 *     "not configured" state are always visible. A collapsed "How to change
 *     the provider" holds the precedence, restart note and the copyable
 *     `.env` snippet (placeholders only).
 *  2. Problems & code (ADR 0015 D1/D4) — the "Code language" select and the
 *     "Fetch problem statements from LeetCode" toggle (read-only when
 *     `IBAI_LEETCODE_FETCH` pins it), through GET/PUT /api/preferences.
 *  3. Data & app — the active folder (linking to `/data`), version and Node.
 *  4. Configuration reference — a collapsed "Environment variables (n)"
 *     table (set ✓/✗ only).
 *
 * Reference detail is in native `<details>` (collapsed); warnings, errors and
 * the not-configured state never are. Keys stay env-only (founder decision
 * D5.2 pending): this page has no key input, never receives a key and never
 * shows one. Everything is JSX text (escaped).
 */

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly settings: SettingsResponse };

type Test =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly result: ProviderTestResult }
  | { readonly kind: 'error'; readonly message: string };

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI-compatible',
  ollama: 'Ollama (local)',
  none: 'None configured',
};

const SOURCE_LABEL: Record<DataDirSource, string> = {
  flag: 'Pinned by the --data-dir flag',
  env: 'Pinned by IBAI_DATA_DIR',
  config: 'Chosen by you',
  default: 'Default location',
};

/** Placeholders only — never a real value. */
export const ENV_SNIPPET = `# InterviewBudAI — put this in the repo-root .env (or your shell).
# Placeholders only: never commit a real key.

# Option A — Anthropic
ANTHROPIC_API_KEY=<your-anthropic-api-key>
IBAI_ANTHROPIC_MODEL=<anthropic-model-name>

# Option B — OpenAI-compatible server, e.g. Docker Model Runner (local):
#   base URL like http://localhost:12434/engines/v1
IBAI_OPENAI_BASE_URL=<openai-compatible-base-url>
IBAI_OPENAI_MODEL=<model-id>
# Optional; only if your server needs one:
IBAI_OPENAI_API_KEY=<your-api-key>

# Option C — Ollama (local)
IBAI_OLLAMA_MODEL=<ollama-model-name>
IBAI_OLLAMA_URL=http://127.0.0.1:11434
`;

// Same spacing scale as Analytics / Your data (#93): cards padded 1.25rem →
// 1.5rem from `sm`, section body 1rem under its heading.
const CARD = 'rounded-xl border border-slate-800 bg-slate-800/40 p-5 sm:p-6';
const HEADING =
  'flex items-center gap-2 text-base font-semibold text-slate-100';
const HEADING_ICON = 'h-5 w-5 shrink-0 text-emerald-500';
const PRIMARY_BTN =
  'inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BTN =
  'inline-flex items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-emerald-500 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300';
const CODE = 'rounded bg-slate-800 px-1 py-0.5 text-slate-300';
/** Always-visible warning box (hints, not configured) — never in a disclosure. */
const WARNING_BOX =
  'mt-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200';

function YesNo({
  yes,
  yesLabel = 'Set',
  noLabel = 'Not set',
}: {
  readonly yes: boolean;
  readonly yesLabel?: string;
  readonly noLabel?: string;
}): JSX.Element {
  return yes ? (
    <span className="inline-flex items-center gap-1 text-emerald-400">
      <CircleCheck className="h-4 w-4" aria-hidden />
      {yesLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-slate-400">
      <CircleX className="h-4 w-4" aria-hidden />
      {noLabel}
    </span>
  );
}

/**
 * The "Last test" row: derived from the last explicit test only, never a live
 * probe, so the label says so and a stale "Reachable" is not read as live.
 */
function ConnectionStatus({ test }: { readonly test: Test }): JSX.Element {
  switch (test.kind) {
    case 'idle':
      return <span className="text-slate-400">Not tested yet</span>;
    case 'running':
      return (
        <span className="inline-flex items-center gap-1 text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking
        </span>
      );
    case 'done':
      return test.result.ok ? (
        <span className="inline-flex items-center gap-1 text-emerald-400">
          <CircleCheck className="h-4 w-4" aria-hidden />
          Reachable
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-amber-200">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Failed
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-amber-200">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {"Test didn't run — see below"}
        </span>
      );
  }
}

type PrefsLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly prefs: Preferences };

/** ADR 0015: the code language and the LeetCode fetch setting. */
function PreferencesSection(): JSX.Element {
  const [load, setLoad] = useState<PrefsLoad>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPreferences()
      .then((prefs) => {
        if (!cancelled) setLoad({ kind: 'ready', prefs });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = async (patch: PreferencesPatch): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setLoad({ kind: 'ready', prefs: await savePreferences(patch) });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Your data folder is read-only, so this was not saved.'
          : err instanceof ApiError && err.status === 400
            ? err.message
            : 'Could not save. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD} aria-labelledby="settings-problems">
      <h2 id="settings-problems" className={HEADING}>
        <Code2 className={HEADING_ICON} aria-hidden />
        Problems &amp; code
      </h2>
      {load.kind === 'loading' && (
        <p className="mt-4 text-sm text-slate-400" role="status">
          Loading preferences…
        </p>
      )}
      {load.kind === 'error' && (
        <p className="mt-4 flex items-start gap-2 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Couldn&apos;t load your preferences from the local server.
        </p>
      )}
      {load.kind === 'ready' && (
        <div className="mt-4 space-y-5">
          <div>
            <label
              htmlFor="settings-language"
              className="block text-sm font-medium text-slate-200"
            >
              Code language
            </label>
            <select
              id="settings-language"
              aria-describedby="settings-language-hint"
              value={load.prefs.language}
              disabled={busy}
              onChange={(e) =>
                void update({ language: e.target.value as CodeLanguage })
              }
              className="mt-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="python">Python</option>
              <option value="go">Go</option>
            </select>
            <p
              id="settings-language-hint"
              className="mt-1 text-xs text-slate-500"
            >
              New notes start as starter code in this language.
            </p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                aria-describedby="settings-fetch-hint"
                checked={load.prefs.leetcodeFetch.enabled}
                disabled={busy || load.prefs.leetcodeFetch.pinned}
                onChange={(e) =>
                  void update({ leetcodeFetch: e.target.checked })
                }
                className="h-4 w-4 accent-emerald-500"
              />
              Fetch problem statements from LeetCode
            </label>
            <p id="settings-fetch-hint" className="mt-1 text-xs text-slate-500">
              {load.prefs.leetcodeFetch.pinned ? (
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Set by <code className={CODE}>IBAI_LEETCODE_FETCH</code>.
                  </span>
                </span>
              ) : (
                'When you open a problem, the local server fetches that one problem from LeetCode and keeps it in your data folder. Off: no request to LeetCode at all.'
              )}
            </p>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-amber-200">
          {error}
        </p>
      )}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 py-2 sm:flex-nowrap">
      <dt className="w-40 shrink-0 text-sm text-slate-400">{label}</dt>
      <dd className="min-w-0 break-all text-sm text-slate-100">{children}</dd>
    </div>
  );
}

export function SettingsPage(): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [test, setTest] = useState<Test>({ kind: 'idle' });
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((settings) => {
        if (!cancelled) setLoad({ kind: 'ready', settings });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error' });
      });
    return () => {
      cancelled = true;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const onTest = useCallback(async (): Promise<void> => {
    setTest({ kind: 'running' });
    try {
      setTest({ kind: 'done', result: await testProviderConnection() });
    } catch (err) {
      setTest({
        kind: 'error',
        message:
          err instanceof ApiError
            ? err.message
            : 'Could not reach the local server. Please try again.',
      });
    }
  }, []);

  const onCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(ENV_SNIPPET);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied('idle'), 3000);
  }, []);

  if (load.kind === 'loading') {
    return (
      <p
        className="flex items-center gap-2 text-sm text-slate-400"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading settings…
      </p>
    );
  }
  if (load.kind === 'error') {
    return (
      <p
        className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        role="alert"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Couldn&apos;t load settings from the local server. Is it still running?
      </p>
    );
  }

  const { provider, dataDir, app, envHelp } = load.settings;
  const configured = provider.kind !== 'none';

  return (
    <div className="space-y-6">
      {/* 1. AI provider — what is active and whether it answers. */}
      <section className={CARD} aria-labelledby="settings-provider">
        <h2 id="settings-provider" className={HEADING}>
          <Cpu className={HEADING_ICON} aria-hidden />
          AI provider
        </h2>

        {/* Warnings stay outside every disclosure: never collapsed. */}
        {provider.hint !== undefined && (
          <p className={WARNING_BOX} data-testid="provider-hint">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{provider.hint}</span>
          </p>
        )}

        <dl className="mt-4 divide-y divide-slate-800">
          <Row label="Provider">
            {provider.kind === 'openai' && provider.label
              ? provider.label
              : PROVIDER_LABEL[provider.kind]}
          </Row>
          <Row label="Model">
            {provider.model ?? <span className="text-slate-400">—</span>}
          </Row>
          {provider.kind === 'ollama' && (
            <Row label="Endpoint">
              {provider.endpoint ?? (
                <span className="text-amber-200">Invalid IBAI_OLLAMA_URL</span>
              )}
            </Row>
          )}
          {provider.kind === 'openai' && (
            <Row label="Endpoint">
              {provider.endpoint ?? (
                <span className="text-amber-200">
                  Invalid IBAI_OPENAI_BASE_URL
                </span>
              )}
            </Row>
          )}
          <Row
            label={
              provider.kind === 'openai'
                ? 'API key (optional)'
                : 'Anthropic API key'
            }
          >
            <YesNo
              yes={provider.keyConfigured}
              yesLabel="Configured"
              noLabel="Not configured"
            />
          </Row>
          {configured && (
            <Row label="Last test">
              <ConnectionStatus test={test} />
            </Row>
          )}
        </dl>

        {configured ? (
          <div className="mt-4">
            {provider.kind === 'anthropic' && (
              <p className="mb-3 flex items-start gap-2 text-sm text-slate-400">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Testing sends one tiny request (1 output token) to Anthropic
                with your key — a billable call of a fraction of a cent.
              </p>
            )}
            <button
              type="button"
              className={PRIMARY_BTN}
              onClick={() => void onTest()}
              disabled={test.kind === 'running'}
            >
              {test.kind === 'running' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plug className="h-4 w-4" aria-hidden />
              )}
              {test.kind === 'running' ? 'Testing…' : 'Test connection'}
            </button>
            <div className="mt-3" aria-live="polite" data-testid="test-result">
              {test.kind === 'done' &&
                (test.result.ok ? (
                  <p className="flex items-start gap-2 text-sm text-emerald-300">
                    <CircleCheck
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden
                    />
                    <span>
                      Connected in {test.result.latencyMs} ms —{' '}
                      {test.result.detail}
                    </span>
                  </p>
                ) : (
                  <p className="flex items-start gap-2 text-sm text-amber-200">
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden
                    />
                    <span>
                      Connection failed ({test.result.latencyMs} ms) —{' '}
                      {test.result.detail}
                    </span>
                  </p>
                ))}
              {test.kind === 'error' && (
                <p className="flex items-start gap-2 text-sm text-amber-200">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden
                  />
                  <span>{test.message}</span>
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className={WARNING_BOX} data-testid="not-configured">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              No model is configured, so the Quiz Master is off. Set one up with
              environment variables — open{' '}
              <strong className="font-semibold">
                How to change the provider
              </strong>{' '}
              below.
            </span>
          </p>
        )}

        <Disclosure
          testId="provider-howto"
          summary="How to change the provider"
        >
          <p>
            InterviewBudAI reads its model settings from environment variables
            (or the repo-root <code className={CODE}>.env</code>). Keys never go
            through this page. Changes take effect after you{' '}
            <strong className="text-slate-100">restart the server</strong>.
          </p>
          <p>When more than one is set, the first complete one wins:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Anthropic — an API key and{' '}
              <code className={CODE}>IBAI_ANTHROPIC_MODEL</code>
            </li>
            <li>
              OpenAI-compatible (e.g. Docker Model Runner) —{' '}
              <code className={CODE}>IBAI_OPENAI_BASE_URL</code> and{' '}
              <code className={CODE}>IBAI_OPENAI_MODEL</code> (key optional)
            </li>
            <li>
              Ollama — <code className={CODE}>IBAI_OLLAMA_MODEL</code>
            </li>
          </ol>
          <p>
            With <code className={CODE}>docker compose up</code>, Compose sets
            the OpenAI-compatible variables for the bundled local model.
          </p>
          <div className="pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-200">
                Example <code className={CODE}>.env</code>
              </h3>
              <button
                type="button"
                className={SECONDARY_BTN}
                onClick={() => void onCopy()}
              >
                <Copy className="h-4 w-4" aria-hidden />
                Copy snippet
              </button>
            </div>
            <pre
              className="mt-2 overflow-x-auto rounded-md border border-slate-800 bg-slate-900 p-4 text-xs text-slate-300"
              aria-label="Example .env file with placeholders"
            >
              {ENV_SNIPPET}
            </pre>
            <p className="mt-1 h-5 text-xs text-slate-400" aria-live="polite">
              {copied === 'copied' && 'Copied to the clipboard.'}
              {copied === 'failed' &&
                'Could not copy — select the text and copy it manually.'}
            </p>
          </div>
        </Disclosure>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {/* 2. Problems & code */}
        <PreferencesSection />

        {/* 3. Data & app */}
        <section className={CARD} aria-labelledby="settings-data">
          <h2 id="settings-data" className={HEADING}>
            <FolderOpen className={HEADING_ICON} aria-hidden />
            Data &amp; app
          </h2>
          <dl className="mt-4 divide-y divide-slate-800">
            <Row label="Folder">{dataDir.path}</Row>
            <Row label="Source">{SOURCE_LABEL[dataDir.source]}</Row>
            <Row label="Version">{app.version}</Row>
            <Row label="Node">{app.node}</Row>
          </dl>
          <a
            href={dataHref()}
            onClick={(e) => {
              if (isPlainClick(e)) {
                e.preventDefault();
                navigate(dataHref());
              }
            }}
            className="mt-4 inline-flex text-sm font-medium text-emerald-400 hover:text-emerald-300 focus:outline-none focus-visible:underline"
          >
            Manage your data →
          </a>
        </section>
      </div>

      {/* 4. Configuration reference — collapsed. */}
      <section className={CARD} aria-labelledby="settings-reference">
        <h2 id="settings-reference" className={HEADING}>
          <Terminal className={HEADING_ICON} aria-hidden />
          Configuration reference
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Every environment variable the server reads at startup. Only whether
          each one is set is shown — never its value.
        </p>
        <Disclosure
          testId="env-vars"
          summary={`Environment variables (${envHelp.length})`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Environment variables the server reads
              </caption>
              <thead className="text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Variable
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Purpose
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {envHelp.map((e) => (
                  <tr key={e.var}>
                    <th scope="row" className="py-2 pr-4 font-normal">
                      <code className={CODE}>{e.var}</code>
                    </th>
                    <td className="py-2 pr-4 text-slate-300">{e.purpose}</td>
                    <td className="whitespace-nowrap py-2">
                      <YesNo yes={e.set} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      </section>
    </div>
  );
}
