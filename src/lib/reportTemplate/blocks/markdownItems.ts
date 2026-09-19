/**
 * One `MarkdownBlock` → the items a PDF painter can draw.
 *
 * ## Why this reads HTML
 *
 * `_shared/reports/markdown.pure.ts` is the programme's only Markdown
 * implementation and it publishes its result as HTML — deliberately, because
 * it is **escape-first**: `escapeHtml` runs at one auditable call before any
 * parsing, so every `<` in a model's prose is `&lt;` long before anything
 * downstream sees it. The HTML this reads is therefore OUR OWN emitter's
 * output over already-escaped text, with a vocabulary small enough to write
 * down: `h2`/`h3`/`h4`, `p`, `ul`/`ol`/`li`, `strong`, `em`, `code`, `br`,
 * `sup`, the callout `div` a blockquote becomes, the `table-block` div and the
 * `figure`/`img` a chart directive becomes. Nothing else is emitted.
 *
 * A second Markdown parser would be a second set of escaping decisions, which
 * is the one thing `markdown.pure.ts`'s header forbids. Reading its output is
 * the alternative that keeps the safety property where it already is.
 *
 * Two shapes are taken structurally rather than from the HTML, because the
 * renderer already carries them: a table's `cols`/`rows` (so a painter never
 * parses a table it did not build) and a figure's SVG (decoded from the data
 * URI the chart renderer emits).
 */
import type { MarkdownBlock, MarkdownTableMeta } from '../../../../supabase/functions/_shared/reports/markdown.pure';

export interface MarkdownStyle {
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  /** A footnote reference — drawn small and raised. */
  sup?: boolean;
}

export interface MarkdownRun extends MarkdownStyle {
  text: string;
}

export type MarkdownItem =
  | { kind: 'heading'; level: 2 | 3 | 4; runs: MarkdownRun[] }
  | { kind: 'paragraph'; runs: MarkdownRun[] }
  | { kind: 'listItem'; depth: number; marker: string; runs: MarkdownRun[] }
  | { kind: 'callout'; label: string; items: MarkdownItem[] }
  | { kind: 'table'; meta: MarkdownTableMeta }
  /**
   * `compact` is the chart renderer's own decision, carried on the figure's
   * class. A gauge, donut, wheel or pictograph is DRAWN at the compact width
   * and printing it across the full measure spends 136mm of a 253mm text block
   * on one number — the reason `renderVizDirective` narrows those four. The
   * HTML side gets this from `.chart-compact`; this carries the same flag so
   * both surfaces make one decision rather than two.
   */
  | { kind: 'figure'; svg: string; alt: string; compact: boolean };

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** Our emitter's escapes, plus the numeric forms it can produce. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * The chart renderer writes its SVG as a base64 data URI, and the SVG holds
 * the report's own prose in its labels — so this has to be UTF-8 correct
 * rather than latin-1. `atob` yields one code unit per BYTE; the bytes are
 * reassembled and decoded. Node has neither `atob` nor `TextDecoder`
 * guaranteed in every runner, so `Buffer` is the fallback.
 */
function decodeBase64Utf8(b64: string): string {
  try {
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i) & 0xff;
      return new TextDecoder('utf-8').decode(bytes);
    }
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

interface Token {
  /** `''` for a text token. */
  tag: string;
  close: boolean;
  attrs: string;
  text: string;
}

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|[^>])*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) out.push({ tag: '', close: false, attrs: '', text: html.slice(last, m.index) });
    out.push({ tag: m[2].toLowerCase(), close: m[1] === '/', attrs: m[3] ?? '', text: '' });
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ tag: '', close: false, attrs: '', text: html.slice(last) });
  return out;
}

function attr(attrs: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : '';
}

/** Collapse the runs of white space HTML would, and drop empty runs. */
function tidy(runs: MarkdownRun[]): MarkdownRun[] {
  const out: MarkdownRun[] = [];
  for (const r of runs) {
    const text = r.text.replace(/\s+/g, ' ');
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && !!prev.bold === !!r.bold && !!prev.italic === !!r.italic
      && !!prev.mono === !!r.mono && !!prev.sup === !!r.sup) {
      prev.text += text;
    } else {
      out.push({ ...r, text });
    }
  }
  if (out.length) {
    out[0].text = out[0].text.replace(/^ +/, '');
    out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, '');
  }
  return out.filter((r) => r.text.length > 0);
}

const STYLE_TAGS: Record<string, keyof MarkdownStyle> = {
  strong: 'bold', b: 'bold', em: 'italic', i: 'italic', code: 'mono', sup: 'sup',
};

/**
 * The reader. One pass, a style stack for inline tags and a list stack for
 * nesting depth; everything else opens or closes the current item.
 */
export function markdownBlockToItems(block: MarkdownBlock): MarkdownItem[] {
  if (block.kind === 'table' && block.table) return [{ kind: 'table', meta: block.table }];
  if (block.kind === 'figure') {
    const src = /src="data:image\/svg\+xml;base64,([^"]*)"/.exec(block.html);
    const alt = decodeEntities(/\salt="([^"]*)"/.exec(block.html)?.[1] ?? '');
    if (!src) return [];
    const svg = decodeBase64Utf8(src[1]);
    const compact = /class="[^"]*\bchart-compact\b/.test(block.html);
    return svg ? [{ kind: 'figure', svg, alt, compact }] : [];
  }
  return readFlow(block.html);
}

function readFlow(html: string): MarkdownItem[] {
  const items: MarkdownItem[] = [];
  const style: MarkdownStyle = {};
  const counts: number[] = [];   // 0 = bullet list, >0 = next ordinal
  let runs: MarkdownRun[] = [];
  let heading: 2 | 3 | 4 | null = null;
  let inItem = false;

  // A callout's children collect into their own flow, so `label` and body do
  // not leak into the surrounding document.
  let callout: { label: string; items: MarkdownItem[] } | null = null;
  let inLabel = false;
  const sink = () => (callout ? callout.items : items);

  const flushText = () => {
    const tidied = tidy(runs);
    runs = [];
    if (!tidied.length) return;
    if (heading !== null) { sink().push({ kind: 'heading', level: heading, runs: tidied }); return; }
    if (inItem) {
      const depth = Math.max(0, counts.length - 1);
      const ordinal = counts[counts.length - 1] ?? 0;
      sink().push({
        kind: 'listItem',
        depth,
        marker: ordinal > 0 ? `${ordinal}.` : '•',
        runs: tidied,
      });
      return;
    }
    sink().push({ kind: 'paragraph', runs: tidied });
  };

  for (const t of tokenize(html)) {
    if (!t.tag) {
      if (inLabel) { callout!.label += decodeEntities(t.text); continue; }
      runs.push({ text: decodeEntities(t.text), ...style });
      continue;
    }
    const styleKey = STYLE_TAGS[t.tag];
    if (styleKey) { style[styleKey] = !t.close ? true : undefined; continue; }

    switch (t.tag) {
      case 'br':
        // A hard break inside a paragraph ends the drawn line and no more.
        flushText();
        break;
      case 'h2': case 'h3': case 'h4':
        // Flushed BEFORE the level changes, so the text between the tags is
        // emitted as the heading it sat in rather than as the paragraph after.
        flushText();
        heading = t.close ? null : (Number(t.tag[1]) as 2 | 3 | 4);
        break;
      case 'p':
        flushText();
        break;
      case 'ul': case 'ol':
        flushText();
        if (t.close) counts.pop();
        else {
          // `start` is where a continued run resumes (the emitter writes it
          // beside the CSS counter the engine reads); the painter counts from it.
          const start = Number(attr(t.attrs, 'start'));
          counts.push(t.tag === 'ol' ? (Number.isFinite(start) && start > 0 ? start : 1) : 0);
        }
        break;
      case 'li':
        flushText();
        if (t.close) {
          inItem = false;
        } else {
          inItem = true;
          const top = counts.length - 1;
          if (top >= 0 && counts[top] > 0) {
            const forced = Number(attr(t.attrs, 'value'));
            if (Number.isFinite(forced) && forced > 0) counts[top] = forced;
          }
        }
        break;
      case 'div':
        flushText();
        if (!t.close && /\bcallout\b/.test(attr(t.attrs, 'class'))) {
          callout = { label: '', items: [] };
        } else if (t.close && callout) {
          const done = callout;
          callout = null;
          items.push({ kind: 'callout', label: done.label.trim(), items: done.items });
        }
        break;
      case 'span':
        flushText();
        inLabel = !t.close && /\bcallout-label\b/.test(attr(t.attrs, 'class')) && !!callout;
        break;
      default:
        // Every other tag is a boundary and nothing more. `figure`, `img`,
        // `table` and `aside` reach here only on a block whose kind was
        // handled structurally above.
        flushText();
        break;
    }

    // An `<li>` that closes advances its list's ordinal — after the item is
    // flushed, so the marker drawn is the one the item was numbered with.
    if (t.tag === 'li' && t.close) {
      const top = counts.length - 1;
      if (top >= 0 && counts[top] > 0) counts[top] += 1;
    }
  }
  flushText();
  return items;
}
