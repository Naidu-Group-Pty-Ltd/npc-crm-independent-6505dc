/**
 * W4.8 — a character no face on the page can draw.
 *
 * ## Measured, not assumed
 *
 * `fontTools` over every face `weasyprint-service/fonts/` ships, 21 Sep 2026:
 *
 * | code point | Cinzel (2) | Playfair (4) | IBM Plex Mono (3) |
 * | --- | --- | --- | --- |
 * | `U+2011` non-breaking hyphen | absent | absent | absent |
 * | `U+2010` hyphen | absent | present | absent |
 * | `U+2013` en dash | present | present | present |
 * | `U+2014` em dash | present | present | present |
 * | `U+002D` hyphen-minus | present | present | present |
 *
 * **Nine of nine lack `U+2011`; five of nine lack `U+2010`.** So a
 * non-breaking hyphen anywhere in a heading, a display line or a figure run is
 * drawn by whatever fontconfig reaches for — measured on the delivered
 * document as a substituted face on three pages, which sets one hyphen in a
 * different typeface from the words on either side of it. The body face comes
 * from Debian's `fonts-inter` rather than this repository, so it is not
 * measured here; it does not need to be, because the three families above are
 * what set every heading, every display line and every figure in the document.
 *
 * ## Why this is not the prose scrub §8 forbids
 *
 * Two reasons, both checkable rather than argued.
 *
 * **It changes no word.** `U+2011` and `U+002D` are the same character to a
 * reader — a hyphen. What differs is a LINE-BREAKING instruction, and that
 * instruction is already lost: a glyph the face does not hold is not set by
 * that face, so the typography the author asked for is not what prints.
 * Substituting restores the intended appearance rather than altering it, and
 * `printableGlyphs.spec.ts` asserts that the text is identical once both sides
 * are folded onto `U+002D`.
 *
 * **It is a closed set of five code points**, listed here and nowhere else, and
 * every one of them is a dash. Nothing about meaning, claim, figure or source
 * is examined, so there is no sentence this pass can change and no rule it can
 * be extended into. The em dash and the en dash are deliberately NOT in it:
 * every face holds both, this repository's prose uses them constantly, and
 * flattening them is what `documentText.pure.ts`'s `asciiPunctuation` option
 * does for a DIFFERENT purpose — extracting text out of somebody's PDF, where
 * losing a dash's shape costs nothing.
 *
 * ## What it deliberately does not do
 *
 * It does not touch a fenced code block or inline code. `IBMPlexMono` is
 * exactly the family missing `U+2010` as well, so the substitution matters
 * most there — but a code span is a quotation of something else's bytes, and
 * silently editing one is the class of change this programme refuses
 * everywhere else. A code span carrying an undrawable dash is left as written
 * and counted, so it can be reported rather than repaired.
 */

/**
 * The dashes no face in the print stack can draw, each with the character it
 * is drawn as. Both map to `U+002D`, which all nine faces hold.
 *
 * `U+2012` (figure dash) and `U+2015` (horizontal bar) are here because they
 * are the same case and a reader cannot tell them from a hyphen or an em dash
 * at text size; `U+2212` (minus sign) is here because a model writing a
 * negative figure reaches for it and Cinzel and IBM Plex Mono hold neither it
 * nor a fallback anyone would choose.
 */
export const UNDRAWABLE_DASHES: Readonly<Record<string, string>> = {
  '‐': '-', // hyphen
  '‑': '-', // non-breaking hyphen
  '‒': '-', // figure dash
  '―': '—', // horizontal bar → em dash, which every face holds
  '−': '-', // minus sign
};

const UNDRAWABLE_RE = new RegExp(`[${Object.keys(UNDRAWABLE_DASHES).join('')}]`, 'gu');

/** One code point, how often it appeared, and what it was set as. */
export interface GlyphSubstitution {
  readonly from: string;
  readonly codePoint: string;
  readonly to: string;
  readonly count: number;
}

export interface PrintableGlyphResult {
  readonly markdown: string;
  readonly substituted: GlyphSubstitution[];
  /** Occurrences inside a code span or fence, left exactly as written. */
  readonly inCode: number;
}

const codePointOf = (ch: string): string =>
  `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Split a document into alternating prose and code regions.
 *
 * Fences first, then inline spans inside what is left, so a backtick inside a
 * fenced block cannot open an inline span. Returns `[text, isCode]` pairs in
 * document order; concatenating the texts reproduces the input exactly.
 */
export function partitionCode(markdown: string): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = [];
  const FENCE = /^(?:```|~~~).*$/;
  const lines = markdown.split('\n');
  let buffer: string[] = [];
  let inFence = false;

  const flush = (isCode: boolean) => {
    if (!buffer.length) return;
    const text = buffer.join('\n');
    if (isCode) { out.push([text, true]); buffer = []; return; }
    // Inline spans inside prose. A run of N backticks closes on a run of N.
    let last = 0;
    const re = /(`+)(?:[\s\S]*?)\1/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push([text.slice(last, m.index), false]);
      out.push([m[0], true]);
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push([text.slice(last), false]);
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE.test(line.trim())) {
      flush(inFence);
      buffer.push(line);
      if (inFence) { flush(true); inFence = false; } else { inFence = true; }
      continue;
    }
    buffer.push(line);
  }
  flush(inFence);

  // The split above drops the newline that joined a flushed region to the next.
  // Rebuild by walking the original instead where anything was emitted.
  const joined = out.map(([t]) => t).join('');
  if (joined === markdown) return out;
  return rejoin(markdown, out);
}

/**
 * Reconcile a partition against the source when `\n` separators were lost.
 *
 * Walks the original string and re-slices it at the same boundaries, so the
 * concatenation is byte-identical by construction rather than by care.
 *
 * ## The fallback fails CLOSED, and its first draft did not
 *
 * When a part cannot be located this returns the whole document as ONE region,
 * and that region is marked **code** — so nothing is substituted and the
 * document comes back byte-identical.
 *
 * It first returned `[[markdown, false]]`: the whole document as PROSE, which
 * would have let the substitution run inside every fence and code span in it.
 * That is failing open on the one bound this module's header states as a
 * rule — *"Code is a quotation and is never edited"* — and it would have done
 * so silently, because the result still looks like an ordinary clean pass.
 *
 * The branch is defensive and, as far as the partition's own construction
 * goes, unreachable: parts are in-order substrings of the source, so
 * `indexOf(part, cursor)` always finds them. But a defence that fails open is
 * worse than no defence, because the header promises something the code then
 * does not do. Exported so the branch can be exercised directly rather than
 * reasoned about.
 */
export function rejoin(markdown: string, parts: Array<[string, boolean]>): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = [];
  let cursor = 0;
  for (const [text, isCode] of parts) {
    if (!text) continue;
    const at = markdown.indexOf(text, cursor);
    if (at === -1) return [[markdown, true]];
    if (at > cursor) out.push([markdown.slice(cursor, at), false]);
    out.push([markdown.slice(at, at + text.length), isCode]);
    cursor = at + text.length;
  }
  if (cursor < markdown.length) out.push([markdown.slice(cursor), false]);
  return out;
}

/**
 * Set every undrawable dash as one the faces hold, outside code.
 *
 * Byte-identical, with an empty list, for a document carrying none — which is
 * most of them.
 */
export function substituteUndrawableGlyphs(markdown: string): PrintableGlyphResult {
  if (!markdown) return { markdown: '', substituted: [], inCode: 0 };
  if (!UNDRAWABLE_RE.test(markdown)) {
    UNDRAWABLE_RE.lastIndex = 0;
    return { markdown, substituted: [], inCode: 0 };
  }
  UNDRAWABLE_RE.lastIndex = 0;

  const counts = new Map<string, number>();
  let inCode = 0;
  const out = partitionCode(markdown).map(([text, isCode]) => {
    if (isCode) {
      inCode += (text.match(UNDRAWABLE_RE) ?? []).length;
      UNDRAWABLE_RE.lastIndex = 0;
      return text;
    }
    return text.replace(UNDRAWABLE_RE, (ch) => {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
      return UNDRAWABLE_DASHES[ch] ?? ch;
    });
  }).join('');

  const substituted = [...counts.entries()].map(([from, count]) => ({
    from,
    codePoint: codePointOf(from),
    to: UNDRAWABLE_DASHES[from],
    count,
  })).sort((a, b) => b.count - a.count);

  return { markdown: out, substituted, inCode };
}
