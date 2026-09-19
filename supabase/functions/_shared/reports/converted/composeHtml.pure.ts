/**
 * The model composes the page; the design system still decides how it looks.
 *
 * ## Why a second output mode at all
 *
 * `enrich.pure.ts` asks for typed blocks — the model says "these four figures
 * are a KPI strip" and a primitive decides what a KPI strip is. That split is
 * what makes brand and contrast *guarantees* rather than hopes, and it stays.
 * What it cannot express is **composition**: which things sit beside which, and
 * what fills one page. `row` bought two or three across; it did not buy a model
 * deciding that page three is a callout beside a table with a chart under both.
 *
 * A report generated natively against the same design system did exactly that,
 * and read visibly better for it. This module is that capability, made safe.
 *
 * ## The bargain
 *
 * The model writes HTML. It may choose **structure** — what nests in what, what
 * sits across, what shares a sheet. It may not choose **appearance**:
 *
 * - a closed list of tags (`ALLOWED_TAGS`)
 * - a closed list of classes, every one of which `css.pure.ts` already defines
 *   (`ALLOWED_CLASSES`)
 * - **no `style` attribute, ever** — not filtered, refused
 * - no colour, size, font or spacing value anywhere
 * - no `src`, `href`, `url()` or any other reference to anything
 * - no `<script>`, `<style>`, `<iframe>`, `<object>`, `<link>`, and their
 *   contents dropped rather than unwrapped
 *
 * So every colour on the page still comes from the resolved palette, every size
 * from the type scale, and a tenant's brand and the contrast floors survive
 * untouched. The widest thing a confused or hostile answer can do is arrange
 * the right components badly, which looks wrong and is not dangerous.
 *
 * ## Why it is written by hand
 *
 * `dompurify` and `jsdom` are already dependencies — of the *browser* bundle.
 * This runs in Deno on the render path, and shipping a DOM implementation to an
 * edge function to sanitise a page of markup is the wrong trade. What is needed
 * is not a general HTML sanitiser but a very narrow one: about a dozen tags and
 * thirty classes, allow-listed, with everything else dropped. That is small
 * enough to read in one sitting, which matters more here than generality —
 * this output is stored, signed and sent to a client.
 *
 * ## What it does *not* do
 *
 * It does not check that the HTML is well-formed, balanced, or sensible. It
 * guarantees only that what comes out contains nothing but allowed tags,
 * allowed classes and text. WeasyPrint's parser is tolerant of the rest, and
 * `judgeDocument` in `critique.pure.ts` is what catches a page that came out
 * wrong — because with free-form markup there is no `blockLines` to predict a
 * page count from, and measuring the render is the only honest answer.
 */

// ── The vocabulary ──────────────────────────────────────────────────────────

/**
 * Tags the model may use.
 *
 * Structure and text. No `img`, because every image in a report is a brand
 * asset the renderer inlines and a model has nothing to point at; no `a`,
 * because a link in a printed PDF is either dead or a phishing vector; no form
 * elements, no media, no `svg` — charts arrive as blocks, drawn by
 * `charts.pure.ts`, which is the only thing that knows the chart palette.
 */
export const ALLOWED_TAGS: readonly string[] = [
  'div', 'section', 'aside', 'p', 'span', 'em', 'strong', 'br',
  'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  'blockquote', 'cite',
];

/**
 * Tags whose *contents* are dropped with them.
 *
 * Unwrapping a `<script>` would paste its source into the document as text.
 * Everything else on the disallowed list is unwrapped — a `<b>` becomes its
 * words — because dropping a paragraph because it was tagged wrongly loses
 * client content, which is worse than losing its emphasis.
 */
export const VOID_CONTENT_TAGS: readonly string[] = [
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'template',
  'noscript', 'svg', 'math', 'head', 'title', 'base', 'form', 'input', 'button',
];

/**
 * Classes the model may use. Every one is defined in `css.pure.ts`.
 *
 * This list is asserted against the stylesheet by a spec: a class here that the
 * stylesheet does not define renders as unstyled markup, and a class the
 * stylesheet defines but this omits is a component the model cannot reach —
 * which is the exact failure a nine-word block vocabulary was.
 */
export const ALLOWED_CLASSES: readonly string[] = [
  // Layout
  'grid-12', 'col', 'col-4', 'col-5', 'col-7', 'col-8', 'two-col', 'avoid-break',
  // `sheet` and `chapter-body` are deliberately absent. The renderer wraps what
  // the model returns; the model composes *inside* a sheet and does not declare
  // one, so a sheet cannot contain a sheet.
  // Editorial furniture
  'lede', 'eyebrow', 'muted', 'pull-quote', 'sidenote', 'sidenote-label',
  'callout', 'callout-label', 'decision-box', 'decision-label',
  'tone-neutral', 'tone-positive', 'tone-caution', 'tone-negative', 'tone-informative',
  // Figures
  'kpi-strip', 'kpi', 'kpi-label', 'kpi-value', 'kpi-foot',
  // Tables
  'table-block', 'data', 'total', 'num', 'pos', 'neg',
];

/**
 * Attributes that survive.
 *
 * `class` carries every design decision. `colspan`/`rowspan` and `scope` are
 * table semantics — `scope` in particular is what makes a table navigable in
 * the tagged PDF the render route emits. Nothing else: no `id` (it would
 * collide with the renderer's own), no `style`, no data attributes, no events.
 */
export const ALLOWED_ATTRS: readonly string[] = ['class', 'colspan', 'rowspan', 'scope'];

/** A composed sheet longer than this is not a page, it is a mistake. */
export const MAX_SHEET_CHARS = 24_000;
/** More than this and the model is paginating a book. */
export const MAX_SHEETS = 12;

// ── Sanitising ──────────────────────────────────────────────────────────────

export interface SanitisedHtml {
  html: string;
  /** What was removed, by name, once each. Reported, never silent. */
  dropped: string[];
}

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** `<` and `&` in text, so a stray angle bracket cannot re-open a tag. */
const escapeText = (v: string): string =>
  v.replace(/&(?![a-zA-Z#][a-zA-Z0-9]{0,8};)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Reduce model-authored markup to the allowed vocabulary.
 *
 * Single pass, no DOM. Disallowed tags are unwrapped (their text survives)
 * except for `VOID_CONTENT_TAGS`, whose contents go with them. Attributes are
 * filtered to `ALLOWED_ATTRS` and `class` is filtered to `ALLOWED_CLASSES`.
 *
 * Never throws and always returns a string. A sanitiser that can fail on a
 * malformed input is a sanitiser that gets bypassed by a malformed input.
 */
export function sanitiseComposedHtml(raw: unknown): SanitisedHtml {
  const source = String(raw ?? '').slice(0, MAX_SHEET_CHARS);
  const dropped = new Set<string>();
  const out: string[] = [];

  // Depth of nesting inside a tag whose contents are being discarded.
  let skipping = 0;
  let skipTag = '';
  let last = 0;

  TAG.lastIndex = 0;
  for (let m = TAG.exec(source); m; m = TAG.exec(source)) {
    const [whole, nameRaw, attrsRaw] = m;
    const name = nameRaw.toLowerCase();
    const closing = whole.startsWith('</');

    if (!skipping) {
      const text = source.slice(last, m.index);
      if (text) out.push(escapeText(text));
    }
    last = m.index + whole.length;

    if (skipping) {
      if (name === skipTag) skipping += closing ? -1 : 1;
      continue;
    }

    if (VOID_CONTENT_TAGS.includes(name)) {
      dropped.add(name);
      if (!closing && !whole.endsWith('/>')) { skipping = 1; skipTag = name; }
      continue;
    }

    if (!ALLOWED_TAGS.includes(name)) {
      // Unwrapped: the tag goes, its words stay.
      dropped.add(name);
      continue;
    }

    if (closing) { out.push(`</${name}>`); continue; }

    const kept: string[] = [];
    ATTR.lastIndex = 0;
    for (let a = ATTR.exec(attrsRaw ?? ''); a; a = ATTR.exec(attrsRaw ?? '')) {
      const attr = a[1].toLowerCase();
      const value = a[3] ?? a[4] ?? a[5] ?? '';
      if (!ALLOWED_ATTRS.includes(attr)) { dropped.add(`@${attr}`); continue; }
      if (attr === 'class') {
        const classes = value.split(/\s+/).filter((c) => {
          if (ALLOWED_CLASSES.includes(c)) return true;
          if (c) dropped.add(`.${c}`);
          return false;
        });
        if (classes.length) kept.push(`class="${classes.join(' ')}"`);
        continue;
      }
      // `colspan`, `rowspan`, `scope`: a short token, nothing else.
      if (/^[a-z0-9]{1,12}$/i.test(value)) kept.push(`${attr}="${value}"`);
      else dropped.add(`@${attr}`);
    }

    // `br` is the only void tag on the allow-list.
    out.push(name === 'br' ? '<br />' : `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}>`);
  }

  const tail = skipping ? '' : source.slice(last);
  if (tail) out.push(escapeText(tail));

  return { html: out.join(''), dropped: [...dropped].sort() };
}

/**
 * The words a composed sheet will print.
 *
 * What `enrichedText` is for typed blocks: everything the faithfulness check
 * has to see. With free-form markup there is no union to walk, so the text is
 * taken out of the markup — which is *stronger*, because it is by construction
 * everything that reaches the page rather than everything a switch statement
 * remembered to include.
 */
export function htmlText(html: unknown): string {
  return String(html ?? '')
    .replace(new RegExp(`<(${VOID_CONTENT_TAGS.join('|')})\\b[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Did the model actually compose anything?
 *
 * The composed equivalent of `checkQuota`, and it exists for the same failure:
 * a model asked for a laid-out page can satisfy the letter of the request with
 * a stack of `<p>`s, which is exactly the flat output this replaces. A sheet
 * that uses no design-system class at all has not been designed.
 */
export function composedIsDesigned(html: string): boolean {
  return /class="[^"]*\b(kpi-strip|table-block|callout|sidenote|decision-box|grid-12|pull-quote|lede)\b/
    .test(html);
}

// ── What the model is asked for ─────────────────────────────────────────────

export const COMPOSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sheets'],
  properties: {
    sheets: {
      type: 'array',
      description:
        'One entry per printed page. Fill each page: a sheet with four short '
        + 'paragraphs on it prints as a mostly empty sheet.',
      items: {
        type: 'object',
        required: ['html'],
        properties: {
          html: {
            type: 'string',
            description:
              'The page contents as HTML, using only the tags and classes listed '
              + 'in the instructions. No style attributes, no colours, no sizes.',
          },
        },
      },
    },
  },
} as const;

/** The component vocabulary, written out for the model. */
const VOCABULARY = `
Layout
  <div class="grid-12"><div class="col col-8">…</div><div class="col col-4">…</div></div>
    Sets things across the page. Spans must be 4, 5, 7 or 8 and add to 12.
    Three across is col-4 three times. This is how a page gets filled.
  <div class="two-col">…</div>            Two equal columns of running text.
  <div class="avoid-break">…</div>        Keeps its contents on one page.

Figures
  <div class="kpi-strip">
    <div class="kpi"><div class="kpi-label">ASSESSMENT RATE</div>
      <div class="kpi-value">9.44%</div><div class="kpi-foot">over 30 years</div></div>
    …two to four of these…
  </div>

Tables
  <div class="table-block"><table class="data">
    <thead><tr><th>Source</th><th class="num">Annual</th></tr></thead>
    <tbody><tr><th scope="row">Salary</th><td class="num">$180,000</td></tr>
      <tr class="total"><th scope="row">Total</th><td class="num">$222,000</td></tr></tbody>
  </table></div>
    class="num" right-aligns a column of figures. class="neg" colours a negative.
    Omit <thead> entirely when the columns have no names.

Editorial
  <p class="lede">One opening sentence.</p>
  <div class="callout tone-caution"><span class="callout-label">Assumed</span><p>…</p></div>
    Tones: tone-neutral, tone-positive, tone-caution, tone-negative, tone-informative.
  <aside class="sidenote"><span class="sidenote-label">Definition</span><p>…</p></aside>
  <div class="decision-box"><span class="decision-label">What this means</span><p>…</p></div>
  <blockquote class="pull-quote">…<cite>…</cite></blockquote>
  <h3>A sub-heading</h3>, <p>, <ul>/<ol>/<li>, <strong>, <em>

Nothing else. No style attribute, no colour, no size, no font, no image, no link,
no SVG. Every one of those is decided by the design system and stripped from your
answer if you write it.`.trim();

export function composePrompt(
  chapterTitle: string,
  markdown: string,
  fidelityRule: string,
  figureRule: string,
): string {
  return `You are laying out one chapter of a property finance report, as pages.

The chapter is called "${chapterTitle.slice(0, 120)}". Here is what it says, as
transcribed from the client's existing document:

---
${markdown.slice(0, 12_000)}
---

Return the chapter as one or more **sheets**. A sheet is one printed A4 page.
Compose each one — decide what sits beside what, what shares a page, and what
earns a page of its own. That composition is the whole task: the same content
stacked one item under another down the left of every page is what this replaces.

${VOCABULARY}

Rules:

- ${figureRule}
- ${fidelityRule}
- **Fill the page.** A4 at this type size holds roughly 38 lines. A sheet with
  four short paragraphs on it prints as a mostly empty page and reads as
  unfinished. Put short related things across the page with grid-12.
- Do not repeat the chapter's title inside the sheet — it is printed above.
- Keep the chapter's order. A reader should be able to follow your pages against
  the original top to bottom.
- Write valid, balanced HTML. Do not wrap it in a code fence.`;
}
