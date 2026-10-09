import { ExternalLink } from 'lucide-react';
import { isPlainClick, navigate, notesHref } from '../lib/router';

/** True when `url` points at leetcode.com (catalog problems always do). */
function isLeetCodeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'leetcode.com' || host.endsWith('.leetcode.com');
  } catch {
    return false;
  }
}

/**
 * A problem title for a list (Home table rows, "Next up" items).
 *
 *  - The title opens our own Notes page (`notesHref(id)`), where the user
 *    works on the problem. A plain left click navigates in-app (History API,
 *    no reload); modified or middle clicks keep the browser default (open in
 *    a new tab, etc.), and without JS it is still a normal link.
 *  - When the problem has a url, a small external-link icon next to the title
 *    opens it in a new tab. It is a separate sibling `<a>`, never nested
 *    inside the title link. No url, no icon. Its accessible name says
 *    "on LeetCode" for a LeetCode url; a custom problem's link to another
 *    site is named for what it is.
 *
 * Everything renders as JSX text (auto-escaped), charter §7.3.
 */
export function ProblemTitleLink({
  problemId,
  title,
  url,
}: {
  problemId: string;
  title: string;
  url?: string | null;
}): JSX.Element {
  const href = notesHref(problemId);
  const leetcode = url ? isLeetCodeUrl(url) : false;
  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={href}
        onClick={(e) => {
          if (isPlainClick(e)) {
            e.preventDefault();
            navigate(href);
          }
        }}
        className="font-medium text-slate-100 transition-all duration-200 hover:text-emerald-400"
      >
        {title}
      </a>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            leetcode
              ? `Open ${title} on LeetCode`
              : `Open the link for ${title} in a new tab`
          }
          title={leetcode ? 'Open on LeetCode' : 'Open link in a new tab'}
          className="inline-flex items-center rounded text-slate-500 transition-all duration-200 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </span>
  );
}
