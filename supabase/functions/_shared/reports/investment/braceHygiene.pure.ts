/**
 * Markup in braces that no renderer can resolve, and what to do with it.
 *
 * ## The defect
 *
 * Read off the Investment Compass delivered for 9 Hollow Street, Golden Square
 * on 21 Sep 2026 — the PDF, 39 pages — three pages printed template markup to
 * the client:
 *
 *     p25   {{stat label="Crime data coverage" unit="" sub="Recorded-crime …"
 *     p26   {{stat label="Registered major public projects" unit="" sub="…"
 *     p30   {{stat label="Golden Square house median" unit="$" sub="…" 567500
 *
 * The stored source counts **26 `{{` against 23 `}}`**, and the difference is
 * exactly those three.
 *
 * `stat` is a FENCE kind, not a directive kind. `FENCE_KINDS` is
 * `pullquote | quote-page | sidenote | stat | divider`, opened with
 * `::: stat label="…"` and closed with a bare `:::`; `VIZ_DIRECTIVE_KINDS` is
 * a different list of twelve, written `{{bars: …}}` with a colon. The model
 * wrote the fence's KIND and ATTRIBUTES with the DIRECTIVE's delimiter, then
 * closed it correctly with `:::`:
 *
 *     {{stat label="Crime data coverage" unit="" sub="…"
 *
 *     Crime register not integrated
 *
 *     :::
 *
 * So it matches nothing. `VIZ_DIRECTIVE_RE` needs a colon. `VIZ_DIRECTIVE_EMPTY_RE`
 * admits `{{stat block}}` but only letters and spaces, so an attribute list
 * with `=` and `"` in it is not an empty directive either. Nothing claims the
 * line, nothing strips it, and it falls through to the page as body copy.
 *
 * ## Repair before strip
 *
 * The body and the closing fence are already correct, so the cheap fix —
 * delete it — would throw away three figures the model composed, one of which
 * is `$567,500`, the Golden Square house median. **Only the delimiter is
 * wrong.** Rewriting `{{stat …` to `::: stat …` hands a well-formed fence to
 * the renderer that already knows how to draw it, and everything downstream —
 * `stripEmptyStatCards`, `statCardHasValue`, the geometry charge — applies
 * unchanged.
 *
 * That is the same choice `presentStoredMarkdown` makes for a scaffolding
 * pointer: substitute rather than delete, because deleting leaves the reader
 * worse off than the defect did.
 *
 * ## Three rules
 *
 * **A repair is bounded by the section it sits in.** Measured on that
 * document, the three openers do not end the same way: two are closed by a
 * bare `:::`, and the third — the `$567,500` median — is followed by a blank
 * line, its value, and then `---`, the rule before the next heading. So the
 * body ends at the FIRST of a bare `:::`, a horizontal rule, a heading, or a
 * short line budget, and where that terminator is not already a `:::` one is
 * inserted. Simply stripping that third opener would leave `567500` standing
 * alone as a paragraph, which is worse than the defect. Past the bound there
 * is no repair: rewriting an opener with no end in sight would open a fence
 * that swallows the rest of the document.
 *
 * **What cannot be repaired is stripped, never printed.** This is the
 * guarantee half, and it is the rule the template renderer already holds for
 * its own bindings: an unresolved `{{…}}` renders as the empty string, never
 * as a visible one. A model's instruction to draw something is not prose and
 * has no business on a client's page.
 *
 * **A legitimate directive is left alone, including a multi-line one.**
 * `VIZ_DIRECTIVE_RE`'s body is `[^}]*`, which matches newlines, so a long
 * `{{bars: …}}` may legally span lines. The scan therefore looks forward for
 * `}}` to the end of the BLOCK rather than to the end of the line, and a
 * template binding — anything carrying a dot, `{{financials.weeklyRent}}` —
 * is never touched, because the renderer that owns it resolves it later.
 */

import { FENCE_KINDS } from '../markdown.pure.ts';

export interface BraceScrubResult {
  readonly markdown: string;
  /** Fence kinds whose opener was rewritten from `{{kind …` to `::: kind …`. */
  readonly repaired: readonly string[];
  /** Openers that could not be repaired and were removed, as written. */
  readonly stripped: readonly string[];
}

/** `{{stat label="…"` — a fence kind opened with the directive delimiter. */
const BRACE_OPENER = /^(\s*)\{\{\s*([A-Za-z][\w-]*)\s*(.*)$/;

/** The bare line that closes a fence. */
const FENCE_CLOSE = /^:::\s*$/;

const isFenceKind = (k: string): boolean =>
  (FENCE_KINDS as readonly string[]).includes(k.toLowerCase());

/**
 * Is the `{{` at `[line, col]` closed by a `}}` before its block ends?
 *
 * A block ends at a blank line. Looking only at the current line would break
 * a legitimate multi-line directive; looking to the end of the document would
 * let one stray opener adopt a `}}` belonging to a directive three paragraphs
 * away and conclude, wrongly, that it was fine.
 */
function closedWithinBlock(lines: readonly string[], line: number, col: number): boolean {
  if (lines[line].indexOf('}}', col) !== -1) return true;
  for (let i = line + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') return false;
    if (lines[i].includes('}}')) return true;
    if (lines[i].includes('{{')) return false;
  }
  return false;
}

/**
 * A stat card's body is a value, not an essay. Twelve lines is far more than
 * one needs and still far less than a section, so an opener with no end
 * inside it is debris rather than a fence somebody mis-typed.
 */
const FENCE_BODY_MAX_LINES = 12;

interface FenceEnd {
  /** Index of the terminator line. */
  readonly at: number;
  /** True when that line is already a bare `:::`. */
  readonly closed: boolean;
}

/**
 * Where this opener's body ends, if it ends inside its own section.
 *
 * A bare `:::` closes it outright. A horizontal rule or a heading ends the
 * section, so the body stops there and a closer is owed. Another opener, or
 * running past the line budget, means there is nothing to repair.
 */
function fenceEnd(lines: readonly string[], from: number): FenceEnd | null {
  const limit = Math.min(lines.length, from + 1 + FENCE_BODY_MAX_LINES);
  for (let i = from + 1; i < limit; i++) {
    const t = lines[i].trim();
    if (FENCE_CLOSE.test(t)) return { at: i, closed: true };
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return { at: i, closed: false };
    if (/^#{1,6}\s/.test(t)) return { at: i, closed: false };
    if (/^:::\s*[A-Za-z]/.test(t)) return null;
    if (BRACE_OPENER.test(lines[i]) && !lines[i].includes('}}')) return null;
  }
  return null;
}

/**
 * Repair what can be repaired, remove what cannot, print neither.
 *
 * Byte-identical when the document carries no unresolved brace, which is what
 * lets every caller adopt it without a diff on a clean report.
 */
export function scrubUnresolvedBraces(markdown: string): BraceScrubResult {
  const src = String(markdown ?? '');
  if (!src.includes('{{')) return { markdown: src, repaired: [], stripped: [] };

  const lines = src.split('\n');
  const repaired: string[] = [];
  const stripped: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const at = line.indexOf('{{');
    if (at === -1) continue;
    if (closedWithinBlock(lines, i, at)) continue;

    const m = BRACE_OPENER.exec(line);
    // An unclosed `{{` that does not open a line is debris inside prose: the
    // opener is removed and the words around it are left exactly as written.
    if (!m) {
      stripped.push(line.slice(at).trim());
      lines[i] = line.slice(0, at).replace(/\s+$/, '');
      continue;
    }

    const [, indent, kind, rest] = m;
    const end = isFenceKind(kind) ? fenceEnd(lines, i) : null;
    if (end) {
      lines[i] = `${indent}::: ${kind.toLowerCase()}${rest.trim() ? ` ${rest.trim()}` : ''}`;
      // The body ran into the next section rather than into a closer, so the
      // fence is closed where the section ends and the terminator is kept.
      if (!end.closed) lines[end.at] = `:::\n\n${lines[end.at]}`;
      repaired.push(kind.toLowerCase());
      continue;
    }

    stripped.push(line.trim());
    lines[i] = '';
  }

  if (!repaired.length && !stripped.length) return { markdown: src, repaired: [], stripped: [] };
  // Only blank runs this pass created are collapsed; a stripped opener that
  // stood alone would otherwise leave a three-line gap where a block was.
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  return { markdown: out, repaired, stripped };
}

/**
 * Every unresolved brace still standing, for a test or a gate to assert on.
 *
 * Reads the document rather than trusting the pass that cleaned it, which is
 * the same reason `headingSequence` is exported beside the placement module.
 */
export function unresolvedBraces(markdown: string): string[] {
  const lines = String(markdown ?? '').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf('{{');
    if (at === -1) continue;
    if (!closedWithinBlock(lines, i, at)) out.push(lines[i].slice(at).trim());
  }
  return out;
}
