/**
 * Emphasis is a signal, and a signal that fires on one word in five is noise.
 *
 * ## What was measured
 *
 * The Investment Compass issued for 97 Poole Road, Kellyville on 20 Sep 2026,
 * read back out of the delivered PDF by font rather than from the source:
 *
 * ```
 * body copy (Inter, 14 device px)   41,773 chars regular
 *                                    9,570 chars BOLD   = 18.6%
 * 274 bold runs, median 26 chars, mean 35, longest 246
 * ```
 *
 * Nearly one character in five of the running text was set bold, at 7.2
 * emphasised spans per page. A well-set document runs at one to three per
 * cent. The five longest spans were 160-246 characters each — a complete
 * sentence apiece, in bold, inside a paragraph of the same words:
 *
 * > From an investor's perspective, **this part of Kellyville is best thought
 * > of as a mature, low-density family suburb where housing demand is
 * > supported by household stability and nearby job centres, rather than rapid
 * > local population expansion.**
 *
 * Nothing there is emphasised. The paragraph has been shouted.
 *
 * ## Why this is not the forbidden prose scrub
 *
 * `RUNTIME_CONSOLIDATION.md` §8 forbids regex-scrubbing prose, on read or on
 * write, and `neverAPlaceholder.spec.ts` enforces it. That rule is about
 * rewriting what a document SAYS. Nothing here reads, moves, adds or deletes a
 * single word: `**` and `__` are markup, and unwrapping a span changes the
 * typography of text that is already there. Run the output through a text
 * extractor and it is byte-identical to the input. A test asserts exactly that.
 *
 * ## The four rules, each measured on that document
 *
 * | rule | what it catches | share of the bold |
 * | --- | --- | ---: |
 * | 1 | a span that is a clause, not a phrase | 27.6% + the long tail |
 * | 2 | a span that is a figure | 13.6% |
 * | 3 | the second and later span in one paragraph | the balance |
 * | 4 | a span inside a table cell | — |
 *
 * **1. Emphasis never spans a clause.** Once a span carries its own comma,
 * semicolon, dashed aside or full stop it has stopped marking a phrase and
 * started competing with the paragraph it sits in. 43 of the 274 spans, 27.6%
 * of all the bold in the report. A clause with no punctuation in it is still a
 * clause, which is what {@link EMPHASIS_PHRASE_WORDS} is for.
 *
 * **2. A figure is not emphasised.** Digits among letters are the strongest
 * typographic contrast on the page and they carry it for free — `6.3%`,
 * `$1,808,000`, `241 new dwellings`, `450 m² minimum lot size`. Bolding a
 * number adds nothing and it is where 76 of the spans lived.
 *
 * **3. A paragraph carries at most one emphasis.** This is the load-bearing
 * one and the one no per-span test can reach: each of the remaining spans is
 * defensible on its own and there were 134 of them. A paragraph in which three
 * things are emphasised emphasises nothing. The FIRST survives, because it is
 * the one the writer reached for while the thought was still the point.
 *
 * **4. A table cell carries no emphasis.** A table is already a structure —
 * its header row, its rules and its columns do the work that emphasis does in
 * prose, and bolding cells inside one fights all three.
 *
 * ## What is deliberately kept
 *
 * A **run-in label** — a span at the head of a paragraph or list item closed
 * by a colon or a full stop, with no clause punctuation inside it. That is a
 * heading that happens to share a line with its text, it is centuries older
 * than the emphasis it looks like, and the register tables depend on it:
 *
 * > - **Local government area:** The Hills Shire Council
 * > - **Jurisdiction:** New South Wales
 *
 * 21 of the 274 spans, 3.5% of the bold. They are not counted against rule 3
 * either, because a list of labelled facts is a list of labels.
 *
 * Headings, fenced code, `{{directive}}` payloads and the `:::` fences are
 * never entered at all.
 *
 * ## Why the read path
 *
 * The same reason the placeholder scrub and the chart dedupe are here: an
 * instruction in a prompt is a request, and this is the guarantee. Every
 * report already in `investment_reports` was written under the old habit, and
 * a write-path rule reaches none of them. `presentStoredMarkdown` is the one
 * scrub all four renderers apply. `report_content` is untouched.
 */

/** A span of emphasis found in a line, with the offsets that delimit it. */
export interface EmphasisSpan {
  /** Index of the opening marker. */
  readonly start: number;
  /** Index one past the closing marker. */
  readonly end: number;
  /** The marker itself — `**` or `__`. */
  readonly marker: string;
  /** The text between the markers. */
  readonly text: string;
}

export interface EmphasisReport {
  readonly markdown: string;
  /** How many spans were unwrapped, by the rule that unwrapped them. */
  readonly unwrapped: {
    readonly clause: number;
    readonly figure: number;
    readonly repeat: number;
    readonly table: number;
  };
  /** Spans left standing. */
  readonly kept: number;
}

/**
 * Clause punctuation INSIDE a span.
 *
 * A trailing one does not count — `**Minimum lot size.**` is a run-in label —
 * so callers test the span with its final character removed.
 */
const CLAUSE = /[,;:]\s|\.\s|\s[—–-]\s/u;

/**
 * A phrase is at most this many words; past it a span is a clause.
 *
 * Derived, not chosen. With the punctuation rule alone applied to the audited
 * document, the surviving spans fall into two populations with a clean gap
 * between them: 80% sit at eight words or fewer, **not one sits at nine**, and
 * every span from ten words up carries its own subject and verb —
 *
 * > **The Hills Shire shows a meaningful pipeline of new dwellings and
 * > substantial commercial and mixed-use projects in the planning registers**
 *
 * — which is a sentence that has been set bold, not a phrase that has been
 * marked. The comma test cannot see those: a long clause with no internal
 * punctuation reads as one span.
 */
export const EMPHASIS_PHRASE_WORDS = 8;

/** Does this span run past a phrase and into a clause? */
export function isClauseSpan(text: string): boolean {
  if (CLAUSE.test(text)) return true;
  return text.trim().split(/\s+/u).length > EMPHASIS_PHRASE_WORDS;
}

/** Letters outside the markers we manage, so `m²` and `$1,808,000` read as one token. */
const WORD = /[A-Za-z][A-Za-z'’-]*/gu;

/**
 * Is this span a figure rather than a phrase?
 *
 * It carries a digit and at most four words of unit or noun around it. Four
 * because the longest legitimate figure in the measured corpus is
 * `450 m² minimum lot size` — three words plus a unit — and admitting a fifth
 * starts catching sentences with a year in them.
 */
export function isFigureSpan(text: string): boolean {
  if (!/\d/u.test(text)) return false;
  return (text.match(WORD) ?? []).length <= 4;
}

/**
 * Is this span a run-in label?
 *
 * Closed by a colon or a full stop, and a PHRASE before that close — no clause
 * punctuation and no more words than {@link EMPHASIS_PHRASE_WORDS}. A label is
 * a short noun phrase standing in for a heading (`Minimum lot size.`,
 * `Local government area:`); a sentence is a sentence however it is punctuated,
 * and `The register was queried at this coordinate and answered.` is one.
 *
 * The word ceiling does the work a character ceiling used to do badly: the
 * measured labels on the audited document run one to six words, and the
 * shortest bold span that is really a sentence runs nine.
 */
export function isRunInLabel(text: string): boolean {
  const t = text.trimEnd();
  if (!/[:.]$/u.test(t)) return false;
  const body = t.slice(0, -1).trim();
  if (!body) return false;
  if (body.split(/\s+/u).length > EMPHASIS_PHRASE_WORDS) return false;
  return !CLAUSE.test(body);
}

/**
 * Find every `**…**` / `__…__` span in one line.
 *
 * Deliberately simple and deliberately conservative: an unbalanced marker, a
 * span containing a newline, and a marker inside backticks are all left alone.
 * The cost of missing one is a bold phrase; the cost of mangling one is a
 * broken document.
 */
export function findEmphasis(line: string): EmphasisSpan[] {
  const spans: EmphasisSpan[] = [];
  // Blank out inline code so a marker inside it is invisible to the scan.
  const masked = line.replace(/`[^`]*`/gu, (m) => ' '.repeat(m.length));
  for (const marker of ['**', '__']) {
    let i = 0;
    while (i < masked.length) {
      const open = masked.indexOf(marker, i);
      if (open < 0) break;
      const close = masked.indexOf(marker, open + marker.length);
      if (close < 0) break;
      const text = line.slice(open + marker.length, close);
      // `****` is not emphasis of anything, and `***bold***` is bold-italic:
      // a stray marker on either edge means the scan has landed inside a
      // construct it does not own, and mangling one is worse than missing it.
      if (text.trim() && !/^[*_]|[*_]$/u.test(text)) {
        spans.push({ start: open, end: close + marker.length, marker, text });
      }
      i = close + marker.length;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  // Drop anything that overlaps a span already accepted, so applying the
  // decisions right to left can never cut through a neighbour.
  const clear: EmphasisSpan[] = [];
  for (const s of spans) {
    if (!clear.length || s.start >= clear[clear.length - 1].end) clear.push(s);
  }
  return clear;
}

/** Replace a span with its own text, markers gone. Not one character moves. */
function unwrap(line: string, span: EmphasisSpan): string {
  return line.slice(0, span.start) + span.text + line.slice(span.end);
}

type Verdict = 'keep' | 'clause' | 'figure' | 'repeat' | 'table';

function judge(text: string, isTableRow: boolean, paragraphSpent: boolean): Verdict {
  // A run-in label is read first, because it is the one form whose closing
  // full stop would otherwise read as a clause boundary.
  if (isRunInLabel(text)) return 'keep';
  if (isTableRow) return 'table';
  if (isClauseSpan(text)) return 'clause';
  if (isFigureSpan(text)) return 'figure';
  if (paragraphSpent) return 'repeat';
  return 'keep';
}

/**
 * Apply the four rules to a stored document.
 *
 * Paragraph state resets on a blank line, a heading, a fence, a blockquote and
 * a list item, because each of those starts a unit the reader takes in on its
 * own. A list of labelled facts is therefore one paragraph per item, which is
 * what lets a register list keep every one of its run-in labels.
 *
 * Within a line the spans are JUDGED left to right, so rule 3 spends the
 * paragraph's one emphasis on the first span a reader meets, and APPLIED right
 * to left, so unwrapping one cannot move the offsets of another.
 */
export function limitEmphasis(markdown: string): EmphasisReport {
  if (!markdown) {
    return { markdown: '', unwrapped: { clause: 0, figure: 0, repeat: 0, table: 0 }, kept: 0 };
  }

  const lines = markdown.split('\n');
  const out: string[] = [];
  const tally = { clause: 0, figure: 0, repeat: 0, table: 0 };
  let kept = 0;
  let inFence = false;
  // Has the paragraph currently being read already spent its one emphasis?
  let paragraphSpent = false;

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (/^(```|~~~)/u.test(trimmed)) {
      inFence = !inFence;
      out.push(raw);
      paragraphSpent = false;
      continue;
    }
    if (inFence) { out.push(raw); continue; }

    // Structure, not prose: a blank line, a heading, a `{{directive}}` payload
    // and one of the generator's own `:::` fences. A `:::` BODY is ordinary
    // prose and is read normally — only the fence line itself is skipped.
    if (!trimmed
      || /^#{1,6}\s/u.test(trimmed)
      || /^\{\{/u.test(trimmed)
      || /^:::/u.test(trimmed)) {
      out.push(raw);
      paragraphSpent = false;
      continue;
    }

    const isTableRow = /^\|/u.test(trimmed);
    if (isTableRow || /^(\s*)([-*+]|\d+[.)])\s/u.test(raw) || /^>/u.test(trimmed)) {
      paragraphSpent = false;
    }

    const spans = findEmphasis(raw);
    const decisions: Array<{ span: EmphasisSpan; verdict: Verdict }> = [];
    for (const span of spans) {
      const verdict = judge(span.text, isTableRow, paragraphSpent);
      decisions.push({ span, verdict });
      // A run-in label is a heading sharing a line with its text, so it does
      // not spend the paragraph's one emphasis.
      if (verdict === 'keep' && !isRunInLabel(span.text)) paragraphSpent = true;
    }

    let line = raw;
    for (let i = decisions.length - 1; i >= 0; i -= 1) {
      const { span, verdict } = decisions[i];
      if (verdict === 'keep') { kept += 1; continue; }
      line = unwrap(line, span);
      tally[verdict] += 1;
    }
    out.push(line);
  }

  return { markdown: out.join('\n'), unwrapped: tally, kept };
}
