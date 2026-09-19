/**
 * The chart vocabulary the model writes, parsed.
 *
 * Investment corpora carry an inline visual language the generator's prompt
 * asks for — `{{bars: …}}`, `{{gauge: …}}`, `{{heatmap: …}}` and nine more.
 * Measured across the 21 compass reports in production: **2,601 directives,
 * about 124 per document**, twelve kinds, every kind present in essentially
 * every report.
 *
 * `render-investment-report-pdf` understands them. The design system's
 * Markdown renderer did not, so every one of them set as an ordinary paragraph
 * — a client's document with `{{bars: Bed/bath/car match to family demand 82,
 * Layout flexibility 75 | title=Property fit | max=100}}` printed mid-page,
 * 124 times.
 *
 * The striking part, and the reason this module is a parser rather than a
 * chart library: **the vocabulary the model writes and the vocabulary
 * `reportDesign/charts.pure.ts` already draws are the same vocabulary.** Eleven
 * of the twelve kinds map one-to-one onto a primitive that has been sitting
 * there, tested, the whole time. Nobody had connected them.
 *
 * ## What this module does and does not do
 *
 * It parses to typed data and stops. It does **not** render: a chart needs a
 * `ChartContext` carrying the resolved palette and the column width, and this
 * runs inside the Markdown renderer, which has neither and should not acquire
 * them. The caller passes a renderer in; see `MarkdownOptions.renderDirective`.
 *
 * ## The grammar
 *
 * ```
 *   {{kind: payload (| segment)*}}
 * ```
 *
 * A segment is `key=value`, or positional when the kind expects one (`gauge`
 * takes value | label | caption; `glance` is a list of items). Read off the
 * production corpus rather than a specification, because the corpus is what
 * has to render:
 *
 * ```
 *   {{bars: Structure 75, Pest 70, Roof 65 | title=Condition | max=100}}
 *   {{gauge: 68 | Priority level | High for older dwellings}}
 *   {{gauge: 7/10 | Socio-economic decile | Higher = more advantaged}}
 *   {{donut: Verified 45, Pending 35 | title=Status | center=45% | centerSub=Verified}}
 *   {{wheel: 60,70,55 | labels=Flood,Bushfire,Coastal | max=100 | title=Risk}}
 *   {{heatmap: 3,4 / 2,3 | rows=Bushfire,Flood | cols=Likelihood,Impact}}
 *   {{tiles: Owner-occupiers strong fit int=0.85, … | title=Buyer appeal | cols=4}}
 *   {{timeline: Existing "Road-first access", 3-5y "Corridor upgrades" | title=…}}
 *   {{quadrant: 8,3 "Financial numbers", 7,8 "Location fit"* | xlabel=… | ymax=10}}
 *   {{pictograph: 3/10 | label=Renter share | icon=house | cols=10}}
 *   {{waterfall: Gross Rent +$50,000, Costs -$13,101, Room =+$36,899}}
 *   {{margin: Legal DD timeline | spark=1,2,3,4 | note=… | label=Process}}
 *   {{glance: ✓ Covered outdoor area | ⚠ Single bathroom | ◆ Character finishes}}
 * ```
 *
 * Two details that a naive split gets wrong, both taken from real strings:
 *
 *  - **`tiles` items carry their own `=`.** `Owner-occupiers strong fit
 *    int=0.85` is one comma-separated *item*, not a `key=value` option. Options
 *    are pipe-separated; splitting on `|` first keeps them apart.
 *  - **`gauge` and `glance` segments have no `=` at all.** That absence is what
 *    distinguishes a positional segment from an option, so neither kind can be
 *    parsed by the generic option reader.
 *
 * ## Refusal is silent and total
 *
 * A directive that does not parse returns `null` and the caller drops it. It is
 * never printed. Printing the source is what produced the defect this module
 * exists to fix, and a client's report is not a place to show a failed
 * shortcode. `MarkdownNotices` counts the drops so a render can still be
 * audited.
 *
 * Size caps live here only for the payload string; the chart primitives carry
 * their own structural caps (`MAX_HEATMAP_CELLS`, `MAX_WHEEL_SCORES`,
 * `MAX_PICTOGRAPH_UNITS`, `MAX_WATERFALL_ITEMS`) and return `''` rather than
 * drawing something absurd, so this module does not restate them.
 */

/** A payload longer than this is not a chart, it is an accident. */
export const MAX_DIRECTIVE_CHARS = 2_000;

export type VizDirectiveKind =
  | 'bars' | 'donut' | 'gauge' | 'glance' | 'heatmap' | 'margin'
  | 'pictograph' | 'quadrant' | 'tiles' | 'timeline' | 'waterfall' | 'wheel';

export const VIZ_DIRECTIVE_KINDS: readonly VizDirectiveKind[] = [
  'bars', 'donut', 'gauge', 'glance', 'heatmap', 'margin',
  'pictograph', 'quadrant', 'tiles', 'timeline', 'waterfall', 'wheel',
];

export interface LabelledValue { label: string; value: number; display?: string }
export interface WaterfallEntry { label: string; value: number; total?: boolean }
export interface QuadrantDot { x: number; y: number; label: string; highlight?: boolean }
export interface TimelineEntry { phase: string; label: string }
/**
 * `renderTiles` draws two lines of its own: a micro uppercase `label` and a
 * display-weight `value`. The directive writes them as one run — see
 * `splitTileLabelValue` for how they are told apart, and why `value` can be
 * empty rather than guessed.
 */
export interface TileEntry { label: string; value: string; sub?: string; intensity?: number }
export interface GlanceItem { symbol: string; text: string }

export type VizDirective =
  | { kind: 'bars'; items: LabelledValue[]; title?: string; max?: number; unit?: string }
  | { kind: 'donut'; segments: LabelledValue[]; title?: string; center?: string; centerSub?: string }
  | { kind: 'gauge'; value: number; max: number; label?: string; caption?: string }
  | { kind: 'glance'; items: GlanceItem[] }
  | { kind: 'heatmap'; grid: number[][]; rowLabels: string[]; colLabels: string[]; title?: string }
  | { kind: 'margin'; label?: string; note?: string; spark: number[]; heading?: string }
  | { kind: 'pictograph'; filled: number; total: number; icon: 'person' | 'house' | 'dollar'; label?: string; sub?: string; cols?: number }
  | { kind: 'quadrant'; points: QuadrantDot[]; xLabel?: string; yLabel?: string; xMax?: number; yMax?: number; title?: string; q1?: string; q2?: string; q3?: string; q4?: string }
  | { kind: 'tiles'; tiles: TileEntry[]; title?: string; cols?: number }
  | { kind: 'timeline'; items: TimelineEntry[]; title?: string }
  | { kind: 'waterfall'; items: WaterfallEntry[]; title?: string }
  | { kind: 'wheel'; scores: number[]; labels: string[]; max: number; title?: string };

/**
 * `{{kind: …}}`, non-greedy to the first `}}`.
 *
 * No `s` flag: a directive is written on one line in every one of the 2,601
 * production instances, and allowing it to span lines lets an unclosed brace
 * swallow the rest of a chapter.
 */
export const VIZ_DIRECTIVE_RE = /\{\{\s*([a-zA-Z_]+)\s*:([^}]*)\}\}/;

/** The same, global, for scanning a block. */
export const VIZ_DIRECTIVE_RE_G = new RegExp(VIZ_DIRECTIVE_RE.source, 'g');

/**
 * A directive the model NAMED and gave nothing to draw: `{{stat block}}`.
 *
 * Found by drawing a document rather than by reading code. On the Due
 * Diligence report for 18 Annabelle Crescent, `{{stat block}}` printed as body
 * copy between two paragraphs about schools — the model asking for a figure,
 * on a client's page, in braces.
 *
 * `VIZ_DIRECTIVE_RE` requires a colon, so a payload-less token matches
 * nothing, `directiveOnlyBlock` answers false, and the line falls through to a
 * paragraph. Measured over the whole corpus: **12 occurrences across 5
 * reports**, every one a bare kind — `timeline` ×3, `donut` ×2, `bars` ×2,
 * `glance` ×2, `stat block`, `tiles`, `gauge`.
 *
 * There is nothing to draw, so there is nothing to print. It is the same rule
 * the template renderer already holds — an unresolved `{{…}}` renders as the
 * empty string, never as a visible one — and it is counted as a refusal
 * rather than dropped quietly, because a silent drop looks exactly like a
 * report the model chose not to illustrate.
 *
 * Interior spaces are admitted for `stat block`; a dot is not, so a template
 * binding (`{{financials.weeklyRent}}`) is left to the renderer that owns it.
 */
export const VIZ_DIRECTIVE_EMPTY_RE = /\{\{\s*[a-zA-Z_][a-zA-Z_ ]*\s*\}\}/;

const VIZ_DIRECTIVE_EMPTY_RE_G = new RegExp(VIZ_DIRECTIVE_EMPTY_RE.source, 'g');

/** `1,234.5`, `$1.2M`, `-13,101`, `+50,000` → a number, or null. */
function looseNumber(raw: string): number | null {
  const cleaned = String(raw).replace(/[^0-9.\-+]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '+') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** `$1.2M` → ×1e6, `48k` → ×1e3. Applied to the *display* text, not the digits. */
function magnitude(display: string): number {
  if (/\d\s*m\b/i.test(display)) return 1_000_000;
  if (/\d\s*k\b/i.test(display)) return 1_000;
  return 1;
}

interface Segments { payload: string; options: Record<string, string>; positional: string[] }

/**
 * `positionalOnly` is for `gauge` and `glance`, whose trailing segments are
 * prose and may contain an `=` of their own. A real caption reads
 * `Higher = more advantaged`, which the generic reader turns into an option
 * named `higher` and then discards — the caption vanishes from the page.
 */
function segments(body: string, positionalOnly = false): Segments {
  const parts = body.split('|').map((s) => s.trim());
  const payload = parts[0] ?? '';
  const options: Record<string, string> = {};
  const positional: string[] = [];
  for (const part of parts.slice(1)) {
    if (!part) continue;
    const m = positionalOnly ? null : /^([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*([\s\S]*)$/.exec(part);
    if (m) options[m[1].toLowerCase()] = m[2].trim();
    else positional.push(part);
  }
  return { payload, options, positional };
}

/**
 * A comma that separates items, not one inside a number.
 *
 * `{{waterfall: Gross rent +$50,000, Non-mortgage outgoings -$13,101, …}}`
 * splits into six fragments on a plain `,`, and `000` is not a waterfall step.
 * A thousands separator is a comma followed by exactly three digits and then a
 * non-digit; an item separator is anything else.
 */
const ITEM_COMMA = /,(?!\d{3}(?:\D|$))/;

/** What follows a comma when that comma is a thousands separator: exactly three digits. */
const THOUSANDS_TAIL = /^\d{3}(?:\D|$)/;

/**
 * `Structure 75`, `Rent 45%`, `Median $1.2M`, `Tin Can Bay ~15 min` → a
 * labelled value.
 *
 * The `~` is not decoration. Travel-time bars are written `Tin Can Bay ~15 min,
 * Rainbow Beach ~35 min, Gympie ~45 min` throughout the corpus, and without it
 * every one of those charts refuses and the reader gets nothing where a
 * comparison was meant to be.
 *
 * A *range* — `Drive to Melton Station 8–12 min` — still refuses, and should:
 * the low end is not the figure and the midpoint is not in the source.
 */
function labelledValues(payload: string): LabelledValue[] {
  const out: LabelledValue[] = [];
  for (const item of payload.split(ITEM_COMMA).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(.+?)\s+([~≈]?\s*[\-+]?[$€£]?\s*[\d.,]+\s*[%$kKmM]?[a-zA-Z]*)$/.exec(item);
    if (!m) continue;
    const display = m[2].trim();
    const n = looseNumber(display);
    if (n === null) continue;
    out.push({ label: m[1].trim(), value: n * magnitude(display), display });
  }
  return out;
}

const num = (raw: string | undefined): number | undefined => {
  if (raw == null) return undefined;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Split a label list on commas — except commas inside parentheses, which
 * belong to the label. A real render split `rows=Risk level (1=Low, 5=High)`
 * into two rows, and the second, having no cells, printed as an orphan label
 * floating under the grid. The same rule the quote-aware splitter below
 * applies to quotes, applied to parens.
 */
const csv = (raw: string | undefined): string[] => {
  if (!raw) return [];
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of raw) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
};

/**
 * Split on commas that are not inside double quotes.
 *
 * `{{tiles: Cooloola Cove Calm & space sub="Quiet cul-de-sacs, family yards"
 * int=0.75, Tin Can Bay …}}` is one item and then another; a plain
 * `split(',')` tears the first one in half at the comma inside `sub`, and the
 * fragment `family yards" int=0.75` becomes a tile of its own. Real string,
 * from a production report.
 */
function splitOutsideQuotes(raw: string, separator = ','): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') { inQuote = !inQuote; buf += ch; continue; }
    // A comma inside a number is a THOUSANDS SEPARATOR, never an item break.
    // `labelledValues` and `waterfall` have always known this (ITEM_COMMA);
    // tiles split on every comma and so cut `>2,000 m2` into `>2` and
    // `000 m2` — measured on the 262 Pallas Street report, which printed a
    // tile reading `>2` beside another reading `000 M2`.
    if (ch === separator && !inQuote && THOUSANDS_TAIL.test(raw.slice(i + 1))) { buf += ch; continue; }
    if (ch === separator && !inQuote) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** A trailing figure: `4`, `78`, `1.0`, `$1.42M`, `-3.2%`. */
const TILE_VALUE_TAIL = /^([\s\S]+?)\s+((?:[+\-−]\s*)?[$€£]?\d[\d,.]*\s*(?:%|[kKmMx]|pts?)?)$/;

/**
 * Where a tile's label ends and its value begins.
 *
 * The prompt asks for `{{tiles: Label value sub="…" int=0.7}}` and the model
 * obliges, but neither half is delimited and both are routinely more than one
 * word. Sampled from production:
 *
 * ```
 *   Cooloola Cove "Family coastal"          → quoted, unambiguous
 *   Schools 4                               → a figure
 *   Economic & Mining Cycle Moderate–High   → neither
 *   Cooloola Cove Calm & space              → neither
 * ```
 *
 * The third rule is the one that earns its place: **the value starts at the
 * last capitalised word**, because the model capitalises the value's first word
 * and lower-cases the rest of the phrase. On the sample above it puts the
 * break in the right place every time — `Economic & Mining Cycle` / `Moderate–
 * High`, `Cooloola Cove` / `Calm & space`, `Tin Can Bay` / `Coastal leisure` —
 * where "split at the last word" gets three of seven wrong.
 *
 * When nothing after the first word is capitalised there is no signal, and the
 * whole run becomes the label with **no value**. A tile then prints its name
 * and its `sub` and omits the display line. That is a thinner tile than the
 * model intended; it is not a wrong one, and inventing the break to fill the
 * slot would put an arbitrary word in the largest type on the page.
 *
 * **A one-word label is not a signal either**, and that is the rule the 262
 * Pallas Street report bought. A capital in the SECOND word is far more often
 * the middle of a proper noun than the start of a value — measured on that
 * document, every failure broke there and printed a place name cut in half:
 *
 * ```
 *   Pallas St local shops        → "Pallas" / "St local shops"
 *   Pallas St large-block houses → "Pallas" / "St large-block houses"
 *   Fraser Coast region          → "Fraser" / "Coast region"
 * ```
 *
 * Every case this function was built on breaks at the third word or later
 * (`Economic & Mining Cycle` / `Moderate-High` at 4, `Tin Can Bay` /
 * `Coastal leisure` at 3, `Cooloola Cove` / `Calm & space` at 2), so requiring
 * at least two words of label keeps all of them and loses none. A tile whose
 * only break would orphan one word keeps its whole name and prints no value,
 * which is the thinner-not-wrong outcome above.
 */
export function splitTileLabelValue(text: string): { label: string; value: string } {
  const quoted = /^([\s\S]+?)\s*"([^"]+)"$/.exec(text);
  if (quoted) return { label: quoted[1].trim(), value: quoted[2].trim() };

  const figure = TILE_VALUE_TAIL.exec(text);
  if (figure) return { label: figure[1].trim(), value: figure[2].trim() };

  const words = text.split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i > 1; i--) {
    if (/^[A-ZÀ-Þ]/.test(words[i])) {
      return { label: words.slice(0, i).join(' '), value: words.slice(i).join(' ') };
    }
  }
  return { label: text.trim(), value: '' };
}

/**
 * Parse one directive body.
 *
 * `kind` and `body` are the two capture groups of `VIZ_DIRECTIVE_RE`. Returns
 * `null` for an unknown kind or a payload that does not yield anything worth
 * drawing — the caller drops it rather than printing it.
 */
export function parseVizDirective(kind: string, body: string): VizDirective | null {
  const k = kind.toLowerCase() as VizDirectiveKind;
  if (!VIZ_DIRECTIVE_KINDS.includes(k)) return null;
  if (body.length > MAX_DIRECTIVE_CHARS) return null;

  const positionalKinds = k === 'gauge' || k === 'glance';
  const { payload, options, positional } = segments(body, positionalKinds);

  switch (k) {
    case 'bars': {
      const items = labelledValues(payload);
      if (!items.length) return null;
      return { kind: 'bars', items, title: options.title, max: num(options.max), unit: options.unit };
    }

    case 'donut': {
      const segs = labelledValues(payload);
      if (!segs.length) return null;
      return {
        kind: 'donut', segments: segs, title: options.title,
        center: options.center, centerSub: options.centersub,
      };
    }

    case 'gauge': {
      // `68` or `7/10`; label and caption are positional, never `key=`.
      const [rawValue, rawMax] = payload.split('/').map((s) => s.trim());
      const value = looseNumber(rawValue ?? '');
      if (value === null) return null;
      return {
        kind: 'gauge', value, max: looseNumber(rawMax ?? '') ?? 100,
        label: positional[0], caption: positional[1],
      };
    }

    case 'glance': {
      // Every segment is an item, including the payload — there are no options.
      const raw = [payload, ...positional].map((s) => s.trim()).filter(Boolean);
      const items = raw.map((line) => {
        const m = /^(\S+)\s+([\s\S]+)$/.exec(line);
        return m ? { symbol: m[1], text: m[2].trim() } : { symbol: '•', text: line };
      });
      return items.length ? { kind: 'glance', items } : null;
    }

    case 'heatmap': {
      const rows = payload.split('/').map((r) => r.trim()).filter(Boolean);
      const grid = rows.map((r) => r.split(',').map((v) => Number(v.trim())));
      const cols = grid[0]?.length ?? 0;
      if (!cols || grid.some((r) => r.length !== cols || r.some((v) => !Number.isFinite(v)))) return null;
      return {
        kind: 'heatmap', grid,
        rowLabels: csv(options.rows), colLabels: csv(options.cols), title: options.title,
      };
    }

    case 'margin': {
      const spark = csv(options.spark).map(Number).filter((n) => Number.isFinite(n));
      if (!spark.length && !options.note) return null;
      return { kind: 'margin', heading: payload || undefined, label: options.label, note: options.note, spark };
    }

    case 'pictograph': {
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(payload.trim());
      if (!m) return null;
      const icon = options.icon === 'person' || options.icon === 'dollar' ? options.icon : 'house';
      return {
        kind: 'pictograph', filled: Number(m[1]), total: Number(m[2]),
        icon, label: options.label, sub: options.sub, cols: num(options.cols),
      };
    }

    case 'quadrant': {
      // Split before each `x,y "` so a label containing a comma stays whole.
      const points: QuadrantDot[] = [];
      for (const seg of payload.split(/,(?=\s*[\d.]+\s*,\s*[\d.]+\s*")/)) {
        const m = /^([\d.]+)\s*,\s*([\d.]+)\s*"([^"]+)"(\s*\*)?$/.exec(seg.trim());
        if (m) points.push({ x: Number(m[1]), y: Number(m[2]), label: m[3], highlight: Boolean(m[4]) });
      }
      if (!points.length) return null;
      return {
        kind: 'quadrant', points,
        xLabel: options.xlabel, yLabel: options.ylabel,
        xMax: num(options.xmax), yMax: num(options.ymax), title: options.title,
        q1: options.q1, q2: options.q2, q3: options.q3, q4: options.q4,
      };
    }

    case 'tiles': {
      // Two suffixes ride *inside* an item rather than being pipe options:
      // `… sub="Quiet cul-de-sacs, family yards" int=0.75`. Both are stripped
      // off the tail, longest-first, so what remains is the tile's label.
      const tiles: TileEntry[] = [];
      for (const item of splitOutsideQuotes(payload)) {
        let text = item;
        let intensity: number | undefined;
        let sub: string | undefined;

        const withInt = /^([\s\S]+?)\s+int\s*=\s*([\d.]+)\s*$/.exec(text);
        if (withInt) {
          text = withInt[1].trim();
          const n = Number(withInt[2]);
          if (Number.isFinite(n)) intensity = n;
        }
        const withSub = /^([\s\S]+?)\s+sub\s*=\s*"([^"]*)"\s*$/.exec(text);
        if (withSub) { text = withSub[1].trim(); sub = withSub[2].trim() || undefined; }

        if (text) tiles.push({ ...splitTileLabelValue(text), sub, intensity });
      }
      if (!tiles.length) return null;
      return { kind: 'tiles', tiles, title: options.title, cols: num(options.cols) };
    }

    case 'timeline': {
      const items: TimelineEntry[] = [];
      for (const seg of payload.split(/,(?=\s*[^,"]+\s*")/)) {
        const m = /^([\s\S]+?)\s*"([^"]+)"$/.exec(seg.trim());
        if (m) items.push({ phase: m[1].trim(), label: m[2].trim() });
      }
      if (!items.length) return null;
      return { kind: 'timeline', items, title: options.title };
    }

    case 'waterfall': {
      const items: WaterfallEntry[] = [];
      for (const seg of payload.split(ITEM_COMMA).flatMap((p) => p.split(';'))) {
        const m = /^(.+?)\s*([=+\-])\s*([\d.,$\s+-]+)$/.exec(seg.trim());
        if (!m) continue;
        const display = m[3].trim();
        const magnitudeOf = looseNumber(display);
        if (magnitudeOf === null) continue;
        // The operator carries the sign: `-$13,101` is a decrement of 13,101,
        // not a step of positive 13,101 that happens to be spelled with a dash.
        // Only `=` defers to the number's own sign, since a running total can
        // legitimately be negative.
        const signed = m[2] === '-' ? -Math.abs(magnitudeOf) : magnitudeOf;
        items.push({
          label: m[1].trim(),
          value: signed * magnitude(display),
          total: m[2] === '=',
        });
      }
      if (!items.length) return null;
      return { kind: 'waterfall', items, title: options.title };
    }

    case 'wheel': {
      const scores = payload.split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n));
      // The primitive refuses fewer than three; refusing here too keeps the
      // reason with the input rather than producing an empty figure.
      if (scores.length < 3) return null;
      return { kind: 'wheel', scores, labels: csv(options.labels), max: num(options.max) ?? 100, title: options.title };
    }
  }
}

/**
 * Is this whole block nothing but directives?
 *
 * The model writes them on their own line, so a paragraph that is entirely
 * directives becomes figures and a paragraph with one embedded mid-sentence is
 * left as prose — replacing inline would leave a dangling clause.
 */
export function directiveOnlyBlock(text: string): boolean {
  const stripped = text
    .replace(VIZ_DIRECTIVE_RE_G, '')
    .replace(VIZ_DIRECTIVE_EMPTY_RE_G, '')
    .trim();
  return stripped.length === 0
    && (VIZ_DIRECTIVE_RE.test(text) || VIZ_DIRECTIVE_EMPTY_RE.test(text));
}

/** Every directive in a block, in order. Unparseable ones are omitted. */
export function parseVizDirectives(text: string): VizDirective[] {
  return scanVizDirectives(text).directives;
}

/**
 * The same scan, with the refusals counted.
 *
 * A caller writing a client document needs both halves: what to draw, and how
 * many the model wrote that could not be drawn. The second number is the only
 * way anyone finds out that a kind has drifted — a silent drop looks exactly
 * like a report the model chose not to illustrate.
 */
export function scanVizDirectives(
  text: string,
): { directives: VizDirective[]; refused: number } {
  const directives: VizDirective[] = [];
  let refused = 0;
  for (const m of text.matchAll(VIZ_DIRECTIVE_RE_G)) {
    const parsed = parseVizDirective(m[1], m[2] ?? '');
    if (parsed) directives.push(parsed);
    else refused++;
  }
  // A kind the model named with nothing to draw is a refusal, not silence —
  // see `VIZ_DIRECTIVE_EMPTY_RE`. Counted here so the one caller that reports
  // figures (`renderMarkdown`'s `figuresDropped`) sees it.
  for (const _ of text.matchAll(VIZ_DIRECTIVE_EMPTY_RE_G)) refused++;
  return { directives, refused };
}
