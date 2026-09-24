import {
  BrainCircuit,
  Home as HomeIcon,
  MessageSquare,
  BarChart3,
} from 'lucide-react';
import { Home } from './components/Home';
import { Notes } from './components/Notes';
import { useRoute } from './lib/router';

/**
 * App shell (nav + wordmark, ADR 0006) hosting the SPA views.
 *
 * M2 rendered the Home (catalog) view only. M3 adds a second view — the notes
 * editor at `/app/notes/<id>` — selected by a tiny client-side router
 * (`lib/router`, React built-ins + History API only, no routing dependency).
 *
 * The nav links point at the existing server-rendered surfaces for now
 * (Interview → /coach, Analytics → /analytics); later milestones (M4/M5) move
 * those into the SPA. M6 makes the SPA the real `/`.
 */
const NAV_LINKS = [
  { label: 'Home', icon: HomeIcon, href: '/app', current: true },
  { label: 'Interview', icon: MessageSquare, href: '/coach', current: false },
  { label: 'Analytics', icon: BarChart3, href: '/analytics', current: false },
] as const;

export default function App(): JSX.Element {
  const route = useRoute();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80">
        <nav
          className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4"
          aria-label="Primary"
        >
          {/* Wordmark (left) */}
          <a
            href="/app"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <BrainCircuit className="h-6 w-6 text-emerald-500" aria-hidden />
            <span>
              Interview<span className="text-emerald-500">Bud</span>AI
            </span>
          </a>

          {/* Nav links */}
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map(({ label, icon: Icon, href, current }) => (
              <li key={label}>
                <a
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 ${
                    current
                      ? 'bg-slate-800 text-emerald-400'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-emerald-400'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {route.kind === 'notes' ? (
          <Notes problemId={route.problemId} />
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Problems</h1>
            <p className="mt-1 text-sm text-slate-400">
              Track your progress across the catalog. Set a status on each
              problem; it saves as you go.
            </p>
            <div className="mt-8">
              <Home />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
