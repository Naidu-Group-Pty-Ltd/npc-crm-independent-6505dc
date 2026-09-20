/**
 * The section summary, set as a key rather than a box of dingbats.
 *
 * ## What shipped, and why it was wrong
 *
 * `vizFigures.pure.ts` drew `{{glance: …}}` as a neutral callout carrying an
 * unstyled list, and its own header said why: *"A new `.glance-strip` rule
 * would be a new thing to style, test and keep in print contrast for no gain
 * over a callout."* That was a reasonable call about implementation cost. The
 * delivered document is the evidence it was wrong about the page.
 *
 * On the Investment Compass issued for 97 Poole Road, Kellyville on 20 Sep
 * 2026 it drew **twelve** washed, left-ruled boxes, each one a stack of raw
 * glyphs — `✓`, `⚠`, `◆`, `★` — with three of them on page 28 and three more
 * on page 29:
 *
 * ```
 * ┃ AT A GLANCE
 * ┃    ★ Proceed with confidence for long-term growth
 * ┃    ✓ Strong Hills Shire fundamentals and established amenity
 * ┃    ⚠ Requires careful planning and holding-cost discipline
 * ┃    ◆ Best suited to 10+ year, growth-focused investors
 * ```
 *
 * Three things are wrong with that and none of them is the content.
 *
 * **A dingbat is not a category.** The glyph carries the whole meaning — good,
 * watch, fact, bottom line — and it carries it in a way that survives neither
 * greyscale, nor a screen reader, nor a reader who has not been told the key.
 * `★` against `◆` is a distinction nobody can look up.
 *
 * **A wash and a rule say "separate object".** Twelve of them in one document,
 * three to a page, and the page stops being a document and becomes a stack of
 * boxes. Border, fill and rule are the expensive signals in print and this
 * block spent all three on a summary of the prose directly beneath it.
 *
 * **The findings do not align.** Each item starts where the previous glyph left
 * off, so four findings sit on four different left edges inside one box.
 *
 * ## What it is now
 *
 * A ruled key: hairlines above and below, no wash, no left bar, and the
 * meaning set as a word in a fixed column so every finding hangs on one axis.
 *
 * ```
 * AT A GLANCE
 * ────────────────────────────────────────────────────────────
 * STRENGTH   Established school-and-shopping network
 * STRENGTH   Metro and bus access present
 * WATCH      Car reliance still relevant for many trips
 * CONTEXT    Kellyville East sits within a mature Hills catchment
 * ────────────────────────────────────────────────────────────
 * ```
 *
 * Three rules hold it.
 *
 * **The meaning is a word, and the colour is second.** `STRENGTH` reads in
 * greyscale, out loud, and to somebody who has never seen the document before.
 * The tone colour rides on top for the reader who is scanning, which is the
 * right way round — colour that carries meaning alone fails four ways.
 *
 * **The glyph never reaches the page.** It is an input vocabulary, not an
 * output one, so a model writing `▲` and a model writing `⚠` produce the same
 * printed key. {@link glanceTone} is the one place that mapping lives, and an
 * unrecognised marker resolves to `context` — the neutral reading — rather
 * than being dropped, because a finding is a finding whatever it was tagged.
 *
 * **It is a list, and it stays a list.** `render-template-pdf` asks WeasyPrint
 * for `pdf/ua-1` and the structure tree is built from element names, so the
 * key is a `<ul>` of `<li>` however it is set. The tag is a `<span>` inside
 * the item rather than a `<dt>`, because a definition list would announce four
 * findings as four definitions of the word "STRENGTH".
 */

/** What a marker means, once the dingbat has been read off it. */
export type GlanceTone = 'strength' | 'watch' | 'context' | 'verdict';

/** The word printed in the key's left column, per tone. */
export const GLANCE_TAG: Readonly<Record<GlanceTone, string>> = {
  strength: 'Strength',
  watch: 'Watch',
  context: 'Context',
  verdict: 'Verdict',
};

/**
 * The input vocabulary, as the generator's prompt asks for it and as six
 * issued documents actually used it.
 *
 * Deliberately generous on each side: a model reaching for "a tick" may write
 * `✓`, `✔`, `☑` or `√`, and refusing three of those would print a finding
 * under the wrong heading. Anything unlisted is `context`.
 */
const TONE_BY_MARKER: ReadonlyArray<readonly [readonly string[], GlanceTone]> = [
  [['✓', '✔', '✅', '☑', '√', '+'], 'strength'],
  [['⚠', '⚠️', '▲', '△', '!', '⚡', '✗', '✘', '×'], 'watch'],
  [['★', '☆', '✭', '➤', '»'], 'verdict'],
  [['◆', '◇', '•', '·', '–', '—', '-', '▪', '■', '○'], 'context'],
];

/**
 * Read a marker's meaning.
 *
 * Variation selectors are stripped first: `⚠️` is `⚠` followed by U+FE0F, and
 * a document that emitted the emoji presentation would otherwise miss.
 */
export function glanceTone(symbol: string): GlanceTone {
  const bare = symbol.replace(/[︀-️‍]/gu, '').trim();
  for (const [markers, tone] of TONE_BY_MARKER) {
    if (markers.includes(bare)) return tone;
  }
  return 'context';
}

export interface GlanceEntry {
  readonly symbol: string;
  readonly text: string;
}

export interface GlanceRow {
  readonly tone: GlanceTone;
  readonly tag: string;
  readonly text: string;
}

/**
 * Resolve the parsed items into printable rows.
 *
 * An item whose text is empty is dropped — a marker on its own is not a
 * finding — and an item that repeats one already in the same strip is dropped
 * too, because a key that says the same thing twice is a key nobody reads.
 * Comparison is on the words, not the marker: the same finding tagged `✓` in
 * one strip and `◆` in another is still the same finding.
 */
export function glanceRows(items: readonly GlanceEntry[]): GlanceRow[] {
  const seen = new Set<string>();
  const rows: GlanceRow[] = [];
  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const tone = glanceTone(item.symbol);
    rows.push({ tone, tag: GLANCE_TAG[tone], text });
  }
  return rows;
}

/**
 * The key, as HTML.
 *
 * `escape` is passed in rather than imported so this module stays free of the
 * design system and can be read by the browser bundle as-is.
 */
export function renderGlanceStrip(
  items: readonly GlanceEntry[],
  escape: (s: string) => string,
  label = 'At a glance',
): string | null {
  const rows = glanceRows(items);
  if (!rows.length) return null;
  const lis = rows
    .map((r) => `<li class="glance-row glance-${r.tone}">`
      + `<span class="glance-tag">${escape(r.tag)}</span>`
      + `<span class="glance-text">${escape(r.text)}</span>`
      + '</li>')
    .join('');
  return `
      <div class="glance">
        <span class="glance-label">${escape(label)}</span>
        <ul class="glance-rows">${lis}</ul>
      </div>`;
}
