/**
 * The Reference approach section of a note body (ADR 0013 D4).
 *
 * A note's optional, user-authored Reference approach is stored as a marked
 * trailing section of the Markdown body (not frontmatter, not a sidecar):
 *
 * ```markdown
 * …the user's note…
 *
 * <!-- ibai:reference-approach -->
 * ## Reference approach
 *
 * …the user's reference text…
 * ```
 *
 * {@link splitReferenceSection} and {@link joinReferenceSection} are the ONE
 * place this format lives: the local-file adapter's read and write, the notes
 * API and any future Markdown importer MUST use them, so a marked section
 * always becomes `referenceApproach`.
 *
 * Back-compat: an older build shows the section (marker included) as part of
 * the body text and saves it back verbatim, so nothing is lost.
 */

/** The marker line that opens the Reference approach section. */
export const REFERENCE_MARKER = '<!-- ibai:reference-approach -->';

/** The heading written under the marker (readable in any Markdown viewer). */
export const REFERENCE_HEADING = '## Reference approach';

/**
 * Strip a trailing `\r` and trailing spaces/tabs (CRLF-tolerant compare).
 * A linear index scan — NOT `/[ \t\r]+$/`, which backtracks quadratically on
 * long inner whitespace runs (note text and CSV cells are untrusted).
 */
function rtrimLine(line: string): string {
  let end = line.length;
  while (end > 0) {
    const c = line.charCodeAt(end - 1);
    if (c !== 0x20 && c !== 0x09 && c !== 0x0d) break;
    end--;
  }
  return end === line.length ? line : line.slice(0, end);
}

/** True when `line` is the marker, ignoring trailing `\r`/spaces/tabs. */
export function isReferenceMarkerLine(line: string): boolean {
  return rtrimLine(line) === REFERENCE_MARKER;
}

/** True when any line of `text` is a marker line. */
export function containsReferenceMarker(text: string): boolean {
  return text.split('\n').some(isReferenceMarkerLine);
}

function isBlank(line: string): boolean {
  return rtrimLine(line) === '';
}

/** Result of {@link splitReferenceSection}. */
export interface ReferenceSplit {
  /** The body before the section (trailing blank lines trimmed). */
  readonly content: string;
  /** The section's text, or `undefined` when there is no non-empty section. */
  readonly referenceApproach?: string;
}

/**
 * Split a note body into its content and its Reference approach (ADR 0013 D4).
 *
 * Finds the LAST marker line. Everything after it, minus one leading
 * `## Reference approach` heading line and surrounding blank lines, is the
 * reference; everything before it is the content, with trailing blank lines
 * trimmed. No marker ⇒ the body is returned unchanged and there is no
 * reference (every old note reads as before). Pure.
 */
export function splitReferenceSection(body: string): ReferenceSplit {
  const lines = body.split('\n');
  let markerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isReferenceMarkerLine(lines[i]!)) {
      markerIndex = i;
      break;
    }
  }
  if (markerIndex < 0) return { content: body };

  const before = lines.slice(0, markerIndex);
  while (before.length > 0 && isBlank(before[before.length - 1]!)) before.pop();

  const after = lines.slice(markerIndex + 1);
  while (after.length > 0 && isBlank(after[0]!)) after.shift();
  if (after.length > 0 && rtrimLine(after[0]!) === REFERENCE_HEADING) {
    after.shift();
    while (after.length > 0 && isBlank(after[0]!)) after.shift();
  }
  while (after.length > 0 && isBlank(after[after.length - 1]!)) after.pop();

  const reference = after.join('\n');
  return {
    content: before.join('\n'),
    ...(reference.trim().length > 0 && { referenceApproach: reference }),
  };
}

/**
 * Join content and an optional reference into one note body (ADR 0013 D4);
 * the inverse of {@link splitReferenceSection}.
 *
 * The section is written when the trimmed reference is non-empty. It is also
 * written (empty) when the CONTENT already holds a marker line — a hand-edited
 * file — so the next read still returns that content unchanged instead of
 * mistaking part of it for a reference.
 *
 * @throws RangeError when the reference holds a marker line (it would not
 *   round-trip). Callers validate first (the API returns 400
 *   `marker_in_text`; the importer strips the line with a warning).
 */
export function joinReferenceSection(
  content: string,
  referenceApproach?: string,
): string {
  const reference = referenceApproach ?? '';
  if (containsReferenceMarker(reference)) {
    throw new RangeError(
      'referenceApproach must not contain the reference-approach marker line',
    );
  }
  const hasReference = reference.trim().length > 0;
  if (!hasReference && !containsReferenceMarker(content)) return content;
  const head = content.length > 0 ? `${content}\n\n` : '';
  return hasReference
    ? `${head}${REFERENCE_MARKER}\n${REFERENCE_HEADING}\n\n${reference}`
    : `${head}${REFERENCE_MARKER}`;
}

/** Remove every marker line from `text` (importer sanitising). Pure. */
export function stripReferenceMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isReferenceMarkerLine(line))
    .join('\n');
}
