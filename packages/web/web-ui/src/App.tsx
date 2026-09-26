import {
  BrainCircuit,
  Home as HomeIcon,
  MessageSquare,
  BarChart3,
  Database,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Home } from './components/Home';
import { Notes } from './components/Notes';
import { Analytics } from './components/Analytics';
import { Interview } from './components/Interview';
import { DataPage } from './components/DataPage';
import { DataFolderBanner } from './components/DataFolderBanner';
import {
  analyticsHref,
  dataHref,
  homeHref,
  interviewHref,
  isPlainClick,
  navigate,
  useRoute,
} from './lib/router';
import type { Route } from './lib/router';

/**
 * App shell (nav + wordmark, ADR 0006) hosting the SPA views.
 *
 * M2 rendered Home only; M3 added the notes editor at `/notes/<id>`; M4 added
 * the analytics/charts page at `/analytics`; M5 added the interview chat at
 * `/interview`. Views are selected by the tiny client-side router (`lib/router`,
 * React built-ins + History API only, no routing dependency).
 *
 * M6: the SPA is the whole app, served at the site root. Home, Interview, and
 * Analytics are all SPA routes (client-side nav, active-state from the current
 * route).
 */
interface NavLink {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly href: string;
  /** Whether this link participates in client-side SPA navigation. */
  readonly spa: boolean;
  /** Given the current route, is this link the active surface? */
  readonly isCurrent: (route: Route) => boolean;
}

const NAV_LINKS: readonly NavLink[] = [
  {
    label: 'Home',
    icon: HomeIcon,
    href: homeHref(),
    spa: true,
    isCurrent: (r) => r.kind === 'home' || r.kind === 'notes',
  },
  {
    label: 'Interview',
    icon: MessageSquare,
    href: interviewHref(),
    spa: true,
    isCurrent: (r) => r.kind === 'interview',
  },
  {
    label: 'Analytics',
    icon: BarChart3,
    href: analyticsHref(),
    spa: true,
    isCurrent: (r) => r.kind === 'analytics',
  },
  {
    label: 'Data',
    icon: Database,
    href: dataHref(),
    spa: true,
    isCurrent: (r) => r.kind === 'data',
  },
];

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
            href={homeHref()}
            onClick={(e) => {
              if (isPlainClick(e)) {
                e.preventDefault();
                navigate(homeHref());
              }
            }}
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <BrainCircuit className="h-6 w-6 text-emerald-500" aria-hidden />
            <span>
              Interview<span className="text-emerald-500">Bud</span>AI
            </span>
          </a>

          {/* Nav links */}
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map(({ label, icon: Icon, href, spa, isCurrent }) => {
              const current = isCurrent(route);
              return (
                <li key={label}>
                  <a
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    onClick={(e) => {
                      if (spa && isPlainClick(e)) {
                        e.preventDefault();
                        navigate(href);
                      }
                    }}
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
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {route.kind === 'notes' ? (
          <Notes problemId={route.problemId} />
        ) : route.kind === 'data' ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Your data</h1>
            <p className="mt-1 text-sm text-slate-400">
              Where InterviewBudAI keeps your notes and progress — a local
              folder you own. Nothing leaves your machine.
            </p>
            <div className="mt-8">
              <DataPage />
            </div>
          </>
        ) : route.kind === 'analytics' ? (
          <>
            <DataFolderBanner />
            <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            <p className="mt-1 text-sm text-slate-400">
              Your progress at a glance — status breakdown and per-topic
              completion, drawn from your tracked problems.
            </p>
            <div className="mt-8">
              <Analytics />
            </div>
          </>
        ) : route.kind === 'interview' ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Interview</h1>
            <p className="mt-1 text-sm text-slate-400">
              Quickfire Quiz Master — a rapid drill over the problems
              you&apos;ve marked done. Recognise the pattern, type your
              approach, and get a direction check. It won&apos;t hand you the
              answer.
            </p>
            <div className="mt-8">
              <Interview />
            </div>
          </>
        ) : (
          <>
            <DataFolderBanner />
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
