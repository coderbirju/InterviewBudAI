import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  Copy,
  Cpu,
  FolderOpen,
  Info,
  Loader2,
  Plug,
  Terminal,
} from 'lucide-react';
import { ApiError, fetchSettings, testProviderConnection } from '../lib/api';
import type {
  DataDirSource,
  ProviderKind,
  ProviderTestResult,
  SettingsResponse,
} from '../lib/api';
import { dataHref, isPlainClick, navigate } from '../lib/router';

/**
 * Settings (`/settings`, ADR 0008 Wave 2(c-lite)) — read-only provider status:
 *
 *  1. Model — active provider, model, Ollama endpoint, key configured ✓/✗ and
 *     an explicit "Test connection" (Anthropic: one tiny billable call).
 *  2. How to configure — the env vars the server reads (set ✓/✗) and a
 *     copyable `.env` snippet with placeholders only.
 *  3. Data — the active folder, linking to `/data`.
 *  4. App — version and Node.
 *
 * Keys stay env-only (founder decision D5.2 pending): this page has no input,
 * never receives a key and never shows one. Everything is JSX text (escaped).
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

# Option B — Ollama (local)
IBAI_OLLAMA_MODEL=<ollama-model-name>
IBAI_OLLAMA_URL=http://127.0.0.1:11434
`;

const CARD = 'rounded-xl border border-slate-800 bg-slate-800/40 p-6';
const PRIMARY_BTN =
  'inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BTN =
  'inline-flex items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-emerald-500 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300';
const CODE = 'rounded bg-slate-800 px-1 py-0.5 text-slate-300';

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
      {/* 1. Model */}
      <section className={CARD} aria-labelledby="settings-model">
        <h2
          id="settings-model"
          className="flex items-center gap-2 text-lg font-semibold text-slate-100"
        >
          <Cpu className="h-5 w-5 text-emerald-500" aria-hidden />
          Model
        </h2>
        <dl className="mt-3 divide-y divide-slate-800">
          <Row label="Provider">{PROVIDER_LABEL[provider.kind]}</Row>
          <Row label="Model">
            {provider.model ?? <span className="text-slate-400">—</span>}
          </Row>
          {provider.kind === 'ollama' && (
            <Row label="Endpoint">
              {provider.endpoint ?? (
                <span className="text-slate-400">Invalid IBAI_OLLAMA_URL</span>
              )}
            </Row>
          )}
          <Row label="Anthropic API key">
            <YesNo
              yes={provider.keyConfigured}
              yesLabel="Configured"
              noLabel="Not configured"
            />
          </Row>
        </dl>

        {provider.hint !== undefined && (
          <p className="mt-3 flex items-start gap-2 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {provider.hint}
          </p>
        )}

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
          <p className="mt-4 text-sm text-slate-400">
            No model is configured, so the Quiz Master is off. Set one up with
            the environment variables below.
          </p>
        )}
      </section>

      {/* 2. How to configure */}
      <section className={CARD} aria-labelledby="settings-configure">
        <h2
          id="settings-configure"
          className="flex items-center gap-2 text-lg font-semibold text-slate-100"
        >
          <Terminal className="h-5 w-5 text-emerald-500" aria-hidden />
          How to configure
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          InterviewBudAI reads its model settings from environment variables (or
          the repo-root <code className={CODE}>.env</code>). Keys never go
          through this page. Changes take effect after you{' '}
          <strong className="text-slate-200">restart the server</strong>.
        </p>
        <div className="mt-4 overflow-x-auto">
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
                  <td className="py-2">
                    <YesNo yes={e.set} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between">
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
      </section>

      {/* 3. Data */}
      <section className={CARD} aria-labelledby="settings-data">
        <h2
          id="settings-data"
          className="flex items-center gap-2 text-lg font-semibold text-slate-100"
        >
          <FolderOpen className="h-5 w-5 text-emerald-500" aria-hidden />
          Data
        </h2>
        <dl className="mt-3 divide-y divide-slate-800">
          <Row label="Folder">{dataDir.path}</Row>
          <Row label="Source">{SOURCE_LABEL[dataDir.source]}</Row>
        </dl>
        <a
          href={dataHref()}
          onClick={(e) => {
            if (isPlainClick(e)) {
              e.preventDefault();
              navigate(dataHref());
            }
          }}
          className="mt-3 inline-flex text-sm font-medium text-emerald-400 hover:text-emerald-300 focus:outline-none focus-visible:underline"
        >
          Manage your data →
        </a>
      </section>

      {/* 4. App */}
      <section className={CARD} aria-labelledby="settings-app">
        <h2 id="settings-app" className="text-lg font-semibold text-slate-100">
          App
        </h2>
        <dl className="mt-3 divide-y divide-slate-800">
          <Row label="Version">{app.version}</Row>
          <Row label="Node">{app.node}</Row>
        </dl>
      </section>
    </div>
  );
}
