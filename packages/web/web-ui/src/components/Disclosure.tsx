import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/** Native `<summary>`: keyboard accessible (Enter/Space), custom chevron. */
export const SUMMARY =
  'flex cursor-pointer list-none items-center gap-2 rounded-md transition-all duration-200 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 [&::-webkit-details-marker]:hidden';
export const CHEVRON =
  'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-90';

/**
 * A collapsed-by-default native `<details>` for reference detail (env vars,
 * precedence, how to configure). Shared by /data and /settings (founder
 * feedback 2026-10-04 / 2026-10-05). Never used for warnings, errors, the
 * "not configured" state or Docker notices — those always stay visible.
 * The summary is plain text only (no heading inside: VoiceOver drops it).
 */
export function Disclosure({
  testId,
  summary,
  children,
}: {
  testId: string;
  summary: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <details className="group mt-4" data-testid={testId}>
      <summary className={`${SUMMARY} w-fit text-sm text-slate-400`}>
        <ChevronRight className={CHEVRON} aria-hidden />
        {summary}
      </summary>
      <div className="mt-3 space-y-2 rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
        {children}
      </div>
    </details>
  );
}
