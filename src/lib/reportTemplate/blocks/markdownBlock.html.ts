import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import {
  absBoxStyle, fontFamilyDecl, type HtmlBlockContext,
} from './_shared.html';
import { packMarkdownPages } from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { MARKDOWN_TYPE } from '../../../../supabase/functions/_shared/reports/narrativeGeometry.pure';
import { resolveMarkdownBlockContent, DEFAULT_LINES_PER_PAGE } from './markdownBlockContent';
import { listedSectionLevel, narrativeIndexFrom } from '../narrativeIndex';

export { packMarkdownPages, DEFAULT_LINES_PER_PAGE };

/**
 * Inline styles onto the tags the renderer emits.
 *
 * No block in this vocabulary emits a `<style>` element and this is not the
 * place to be the first: a scoped stylesheet would have to survive the template
 * renderer, WeasyPrint and the browser QA harness identically, and none of that
 * is established here. Inheritance carries the body face, size, colour and
 * leading from the container; the tags below are the ones that do not inherit
 * what they need.
 *
 * A rule may name a class as well as a tag, because the Markdown renderer's
 * figures and callouts are told apart only by class — `figure.chart-compact`
 * prints at the compact fraction of the measure, `div.callout` carries a rule
 * and padding — and until these rules existed the template path had no
 * stylesheet for them at all: a gauge drawn for 60% of the measure was set
 * across the whole of it, with the user agent's own 40px figure indent, and
 * the charge model was told a shorter figure than the page got.
 *
 * The regex is safe against the content because the HTML being matched is our
 * own renderer's output and every character of model text inside it has already
 * been escaped — `<` in an answer is `&lt;` long before this runs.
 */
interface TagStyle {
  tag: string;
  /** When set, the rule applies only to a tag carrying this class. */
  cls?: string;
  /**
   * When set, the rule applies only to a tag whose opening tag contains this
   * literal attribute text — `scope="row"`.
   *
   * A class is not enough to tell the two `th`s apart. `renderDataTable` marks
   * the first cell of every row `<th scope="row">`, because that is what makes
   * a table navigable in a tagged PDF, and it carries no class — so a rule
   * keyed on `th` alone painted the row's LABEL in the column head's gold, at
   * the head's weight, and never gave it the `vertical-align:top` every `td`
   * beside it has. Read off a rendered risk register: the risk name set in
   * heading gold, bold, and floating in the middle of a fifteen-line row whose
   * other four cells start at the top.
   *
   * The shared print stylesheet already states the rule for this exact
   * element — "it must not look like the column head"
   * (`reportDesign/css.pure.ts`) — and the template path is the second
   * implementation that did not have it.
   */
  attr?: string;
  style: string;
}

function styleTags(html: string, rules: readonly TagStyle[]): string {
  const byTag = new Map<string, TagStyle[]>();
  for (const rule of rules) {
    const list = byTag.get(rule.tag) ?? [];
    list.push(rule);
    byTag.set(rule.tag, list);
  }
  let out = html;
  for (const [tag, list] of byTag) {
    // The more specific rule first, so `figure.chart-compact` wins over
    // `figure` and `th[scope="row"]` over `th`. Specificity is how many of the
    // two qualifiers a rule names; a rule naming neither is the fallback and
    // sorts last.
    const rank = (r: TagStyle) => Number(Boolean(r.cls)) + Number(Boolean(r.attr));
    const ordered = [...list].sort((a, b) => rank(b) - rank(a));
    out = out.replace(
      new RegExp(`<${tag}(\\s[^>]*)?>`, 'g'),
      (m, attrs: string | undefined) => {
        const classes = /class="([^"]*)"/.exec(attrs ?? '')?.[1]?.split(/\s+/) ?? [];
        const rule = ordered.find((r) => (!r.cls || classes.includes(r.cls))
          && (!r.attr || (attrs ?? '').includes(r.attr)));
        if (!rule) return m;
        // A tag that arrives with a style of its own — an `<ol>` carrying the
        // counter its `start` stands for — keeps it. Two `style` attributes on
        // one tag and the first silently wins, which is how a continued list
        // would lose either its numbering or its margins.
        const own = /\sstyle="([^"]*)"/.exec(attrs ?? '');
        const rest = (attrs ?? '').replace(/\sstyle="[^"]*"/, '');
        const style = own ? `${own[1].replace(/;?\s*$/, ';')}${rule.style}` : rule.style;
        return `<${tag}${rest} style="${style}">`;
      },
    );
  }
  return out;
}

/**
 * Model-authored Markdown, set as structure.
 *
 * ## Why this block takes source rather than HTML
 *
 * Every other block in this vocabulary escapes its body, and that is what keeps
 * a language model from injecting markup into a document a client receives. A
 * block that accepted rendered HTML would be a hole in
 * `PRODUCTION_SAFE_BLOCK_TYPES` for exactly the content least able to be
 * trusted — and the allow-list is a security boundary, not a formatting one.
 *
 * So this takes **Markdown source** and renders it here. Safety is a property
 * of the renderer rather than of the caller: `_shared/reports/markdown.pure.ts`
 * is escape-first — `escapeHtml` runs at one auditable call before any parsing —
 * so `<script>alert(1)</script>` in the source becomes `&lt;script&gt;` in the
 * page no matter who bound it or what they bound. There is no input to this
 * block that produces markup the model chose. That is why it is safe to add to
 * the allow-list, and it is the whole reason for the extra render.
 *
 * The renderer is the programme's only Markdown implementation, shared with the
 * flowing `render-report-qa-pdf` route. A second one would be a second set of
 * escaping decisions.
 *
 * ## Where the paging decision lives
 *
 * Not here. `markdownBlockContent.ts` resolves the profile, renders the
 * source and packs it into buckets, and the browser PDF renderer reads the
 * same module — so the bucket set as markup and the bucket drawn as runs are
 * one decision rather than two that agree.
 */
export function renderMarkdownBlockHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;

  const source = resolveBindable(p.source ?? p.body, ctx);
  if (!source || !String(source).trim()) return '';

  // The bucket, the profile, the charge model and the directive context are
  // all resolved by `markdownBlockContent` — the module the browser PDF
  // renderer reads too. Two resolutions of the same block is how one surface
  // comes to draw a bucket the other's page count says does not exist.
  const content = resolveMarkdownBlockContent(block, ctx);
  const page = content?.page ?? [];
  if (!page.length) return '';

  const bodySize = Number(p.bodySize ?? 9.5);
  const lineHeight = Number(p.lineHeight ?? 1.5);
  const color = resolveBindableColor(p.color ?? 'token:text', ctx, '#1A1A1A');
  const headingColor = resolveBindableColor(p.headingColor ?? 'token:primary', ctx, '#BF9B50');
  const ruleColor = resolveBindableColor(p.ruleColor ?? 'token:border', ctx, '#E4E4E7');

  const bodyFont = fontFamilyDecl(p.bodyFont, '--font-body');
  const headingFont = fontFamilyDecl(p.headingFont, '--font-heading');

  const mutedColor = resolveBindableColor(p.mutedColor ?? 'token:muted', ctx, '#666666');
  const toneColor = (name: string, fallback: string) => resolveBindableColor(`token:${name}`, ctx, fallback);

  // Every dimension below is `MARKDOWN_TYPE`'s, which is also what the charge
  // model reads (`narrativeGeometry.pure.ts`): the block cannot style a heading
  // one way and charge it another.
  const T = MARKDOWN_TYPE;
  const pt = (n: number) => `${n.toFixed(2).replace(/\.?0+$/, '')}pt`;
  const heading = (level: 2 | 3 | 4) => {
    const h = T.heading[level];
    return `font-size:${(bodySize * h.scale).toFixed(1)}pt;line-height:${h.lineHeight};`
      + `margin:${pt(h.marginTopPt)} 0 ${pt(h.marginBottomPt)};`;
  };
  const chrome = `margin:0 0 ${pt(T.callout.marginBottomPt)};padding:${pt(T.callout.paddingPt)} ${pt(T.callout.paddingPt + 2)};`
    + `border-left:${pt(T.callout.rulePt)} solid `;
  const label = `display:block;font-size:${(bodySize * T.callout.labelScale).toFixed(1)}pt;font-weight:700;`
    + `letter-spacing:0.06em;text-transform:uppercase;color:${headingColor};margin:0 0 ${pt(T.callout.labelGapPt)};`;

  /*
   * The PDF outline names the report's own sections, because the contents
   * page already does.
   *
   * Measured 19 September 2026 on a Chancery Compass carrying a real
   * narrative: the contents listed nine rows including "Location Overview"
   * and "Zoning, Planning and Development Considerations", while the outline
   * held seven — Cover, Contents, Executive dashboard, The assessment, Risk
   * and recommendation, Sources and methodology, Important information. Every
   * one is furniture. Not one section of the report appeared in it.
   *
   * `narrativeIndex.ts` says the two surfaces "cannot describe the document
   * differently", and the half that keeps that promise is the page's entry
   * standing down on a sheet the narrative drew on. Nothing was replacing it,
   * so the outline LOST the row rather than gaining the section — a reader
   * opening the bookmark panel of a 31-page report was offered the furniture
   * and a single row for the whole body.
   *
   * The tier is `listedSectionLevel`, the same rule and the same index the
   * contents reads, for the reason that rule exists: `renderMarkdown`
   * normalises a run's shallowest heading to `h2`, so on the Investment
   * Report shape `h2` is `# NAIDU PROPERTY CONSULTING SERVICES` and
   * `# Investment Report: <address>` — masthead, not parts of a document.
   * Styling `h2` unconditionally would put the company's name in the outline,
   * which is the defect `textBlock` already fixed on the other side.
   *
   * The entry is level 2, which is what a page's own name uses, so the
   * outline is one flat list in document order and reads exactly as the
   * contents does. `includeBookmarks: false` opts out of this one too.
   */
  const sections = narrativeIndexFrom(ctx.data).sections;
  const outlineLevel = sections.length ? listedSectionLevel(sections) : 0;
  const outlineTag = (ctx as { _includeBookmarks?: boolean })._includeBookmarks === false
    ? '' : (outlineLevel >= 2 && outlineLevel <= 4 ? `h${outlineLevel}` : '');
  const outline = (tag: string) => (tag === outlineTag ? 'bookmark-level:2;' : '');

  const html = styleTags(page.map((b) => b.html).join(''), [
    { tag: 'h2', style: `${headingFont}color:${headingColor};${heading(2)}font-weight:600;${outline('h2')}` },
    { tag: 'h3', style: `${headingFont}color:${headingColor};${heading(3)}font-weight:600;${outline('h3')}` },
    { tag: 'h4', style: `${headingFont}color:${color};${heading(4)}font-weight:700;${outline('h4')}` },
    { tag: 'p', style: `margin:0 0 ${pt(T.paragraph.marginBottomPt)};` },
    { tag: 'ul', cls: 'marked', style: `margin:0;padding-left:${pt(T.list.indentPt)};list-style:none;` },
    { tag: 'ul', style: `margin:0 0 ${pt(T.list.marginBottomPt)};padding-left:${pt(T.list.indentPt)};` },
    { tag: 'ol', style: `margin:0 0 ${pt(T.list.marginBottomPt)};padding-left:${pt(T.list.indentPt)};` },
    { tag: 'li', style: `margin:0 0 ${pt(T.list.itemMarginBottomPt)};` },
    { tag: 'table', style: `width:100%;border-collapse:collapse;margin:0 0 ${pt(T.table.marginBottomPt)};font-size:${(bodySize * T.table.scale).toFixed(1)}pt;` },
    // The row's LABEL, not a second column head: body ink, body weight, and
    // the row rule and top alignment its siblings have. See `TagStyle.attr`.
    { tag: 'th', attr: 'scope="row"', style: `text-align:left;padding:${pt(T.table.cellPaddingPt)} 4pt;`
      + `border-bottom:${pt(T.table.rowRulePt)} solid ${ruleColor};color:${color};font-weight:500;vertical-align:top;` },
    { tag: 'th', style: `text-align:left;padding:${pt(T.table.cellPaddingPt)} 4pt;border-bottom:${pt(T.table.headRulePt)} solid ${ruleColor};`
      + `color:${headingColor};font-weight:600;` },
    { tag: 'td', style: `padding:${pt(T.table.cellPaddingPt)} 4pt;border-bottom:${pt(T.table.rowRulePt)} solid ${ruleColor};vertical-align:top;` },
    { tag: 'blockquote', style: `margin:0 0 ${pt(T.blockquote.marginBottomPt)};padding-left:${pt(T.blockquote.paddingLeftPt)};border-left:${pt(T.blockquote.rulePt)} solid ${ruleColor};` },
    { tag: 'pre', style: `margin:0 0 ${pt(T.code.marginBottomPt)};padding:${pt(T.code.paddingPt)};background:rgba(0,0,0,0.03);font-size:${(bodySize * T.code.scale).toFixed(1)}pt;`
      + 'white-space:pre-wrap;' },
    // Figures: the compact fraction the chart was drawn for, the block's own
    // margins, the image across the figure, and a caption in the label style.
    { tag: 'figure', cls: 'chart-compact', style: `margin:${pt(T.figure.marginTopPt)} 0 ${pt(T.figure.marginBottomPt)};width:${(T.figure.compactFraction * 100).toFixed(1)}%;` },
    { tag: 'figure', style: `margin:${pt(T.figure.marginTopPt)} 0 ${pt(T.figure.marginBottomPt)};` },
    { tag: 'img', style: 'display:block;width:100%;height:auto;' },
    { tag: 'figcaption', style: `margin-top:${pt(T.figure.captionGapPt)};font-size:${(bodySize * T.figure.captionScale).toFixed(1)}pt;`
      + `letter-spacing:0.06em;text-transform:uppercase;color:${mutedColor};` },
    // Callouts, sidenotes and decision boxes: a rule in the tone's colour, the
    // label in the heading colour, no user-agent chrome of their own.
    { tag: 'div', cls: 'tone-positive', style: `${chrome}${toneColor('positive', ruleColor)};` },
    { tag: 'div', cls: 'tone-caution', style: `${chrome}${toneColor('caution', ruleColor)};` },
    { tag: 'div', cls: 'tone-negative', style: `${chrome}${toneColor('negative', ruleColor)};` },
    { tag: 'div', cls: 'tone-informative', style: `${chrome}${toneColor('info', ruleColor)};` },
    { tag: 'div', cls: 'callout', style: `${chrome}${ruleColor};` },
    { tag: 'div', cls: 'decision-box', style: `${chrome}${headingColor};` },
    { tag: 'aside', cls: 'sidenote', style: `${chrome}${ruleColor};` },
    { tag: 'span', cls: 'callout-label', style: label },
    { tag: 'span', cls: 'decision-label', style: label },
    { tag: 'span', cls: 'sidenote-label', style: label },
    // The generator's fenced blocks: a pull quote behind a rule at the quote
    // scale, and a stat card — label, figure at display size, caption —
    // between two hairlines. Every dimension is `MARKDOWN_TYPE`'s, as above.
    { tag: 'blockquote', cls: 'pull-quote', style: `margin:${pt(T.pullquote.marginTopPt)} 0 ${pt(T.pullquote.marginBottomPt)};`
      + `padding:0 0 0 ${pt(T.pullquote.paddingLeftPt)};border-left:${pt(T.pullquote.rulePt)} solid ${headingColor};`
      + `${headingFont}font-size:${(bodySize * T.pullquote.scale).toFixed(1)}pt;line-height:${T.pullquote.lineHeight};`
      + `font-style:italic;color:${headingColor};` },
    { tag: 'cite', style: `display:block;margin-top:${pt(T.pullquote.attributionGapPt)};`
      + `${bodyFont}font-size:${(bodySize * T.pullquote.attributionScale).toFixed(1)}pt;line-height:${lineHeight};`
      + `font-style:normal;letter-spacing:0.06em;text-transform:uppercase;color:${mutedColor};` },
    { tag: 'div', cls: 'stat-card', style: `margin:${pt(T.stat.marginTopPt)} 0 ${pt(T.stat.marginBottomPt)};`
      + `padding:${pt(T.stat.paddingPt)} 0;border-top:${pt(T.stat.rulePt)} solid ${ruleColor};`
      + `border-bottom:${pt(T.stat.rulePt)} solid ${ruleColor};` },
    { tag: 'span', cls: 'stat-label', style: `${label}margin:0 0 ${pt(T.stat.gapPt)};` },
    { tag: 'div', cls: 'stat-value', style: `${headingFont}font-size:${(bodySize * T.stat.valueScale).toFixed(1)}pt;`
      + `line-height:${T.stat.valueLineHeight};font-weight:700;color:${headingColor};` },
    { tag: 'span', cls: 'stat-unit', style: `font-size:${(bodySize * 1.1).toFixed(1)}pt;font-weight:600;margin-left:2pt;` },
    { tag: 'span', cls: 'stat-sub', style: `display:block;margin-top:${pt(T.stat.gapPt)};`
      + `font-size:${(bodySize * T.stat.subScale).toFixed(1)}pt;line-height:${lineHeight};color:${mutedColor};` },
    { tag: 'p', cls: 'stat-headline', style: `margin:${pt(T.stat.gapPt)} 0 0;` },
  ]);

  const box = absBoxStyle(p, { x: 40, y: 120, w: 515 });
  const container = `${box};${bodyFont}font-size:${bodySize}pt;line-height:${lineHeight};`
    + `color:${color};`;

  return `<div style="${container}">${html}</div>`;
}
