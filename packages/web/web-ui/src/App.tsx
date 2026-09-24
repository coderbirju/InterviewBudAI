import { BrainCircuit, Home, MessageSquare, BarChart3 } from 'lucide-react';

/**
 * M0 shell only (ADR 0006). No product features/pages yet — this is the
 * toolchain de-risking scaffold: React + Vite + Tailwind + lucide-react.
 *
 * The nav links are placeholders (href="#") for M0; later milestones (M2–M5)
 * wire real routes/pages behind them.
 */
const NAV_LINKS = [
  { label: 'Home', icon: Home },
  { label: 'Interview', icon: MessageSquare },
  { label: 'Analytics', icon: BarChart3 },
] as const;

export default function App(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80">
        <nav
          className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4"
          aria-label="Primary"
        >
          {/* Wordmark (left) */}
          <a
            href="#"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <BrainCircuit className="h-6 w-6 text-emerald-500" aria-hidden />
            <span>
              Interview<span className="text-emerald-500">Bud</span>AI
            </span>
          </a>

          {/* Nav links */}
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map(({ label, icon: Icon }) => (
              <li key={label}>
                <a
                  href="#"
                  className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-emerald-400"
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">
          Web React scaffold is live
        </h1>
        <p className="mt-3 max-w-2xl text-slate-400">
          M0 toolchain scaffold — React + Vite + Tailwind + lucide-react, served
          locally by the existing Node server. No product features yet; later
          milestones move Home, Notes, Analytics, and the interview chat here.
        </p>

        {/* Design-token proof: status + difficulty swatches from the theme. */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Design tokens
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-status-done/15 px-3 py-1 text-sm text-status-done">
              Done
            </span>
            <span className="rounded-full bg-status-revisit/15 px-3 py-1 text-sm text-status-revisit">
              To revisit
            </span>
            <span className="rounded-full bg-status-blocked/15 px-3 py-1 text-sm text-status-blocked">
              Did not understand
            </span>
            <span className="rounded-full bg-difficulty-easy/15 px-3 py-1 text-sm text-difficulty-easy">
              Easy
            </span>
            <span className="rounded-full bg-difficulty-medium/15 px-3 py-1 text-sm text-difficulty-medium">
              Medium
            </span>
            <span className="rounded-full bg-difficulty-hard/15 px-3 py-1 text-sm text-difficulty-hard">
              Hard
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
