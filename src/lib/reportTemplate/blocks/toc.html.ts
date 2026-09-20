import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';
import { fitTocEntries, splitTocColumns, tocOmittedLine } from './tocFit';
import {
  listedSectionLevel, narrativeIndexFrom, type NarrativeIndexSection,
} from '../narrativeIndex';
import { scopeContentsEntries } from '../contentsScope.pure';

export function renderTocHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const title = resolveBindable(p.title ?? 'Contents', ctx);
  const titleSize = Number(p.titleSize ?? 22);
  const size = Number(p.size ?? 11);
  const lh = Number(p.lineHeight ?? 18);
  const titleColor = resolveBindableColor(p.titleColor ?? 'token:primary', ctx, '#BF9B50');
  const color = resolveBindableColor(p.color ?? 'token:text', ctx, '#1A1A1A');
  const idxColor = resolveBindableColor(p.indexColor ?? 'token:muted', ctx, '#888');
  const pages = ctx.pages ?? [];

  /**
   * ## A contents list names sections, not sheets
   *
   * This mapped one row per rendered page, and a section that runs long is many
   * pages: the Investment Compass sets aside 40 for the report body, so a real
   * document listed "The report", "The report (2)" … "The report (40)" and its
   * contents filled two whole pages. A page that declares `tocContinues` folds
   * into the entry above it — it is still rendered and still numbered, it just
   * does not open a second line about the same section. The flag is set by the
   * master (see `PageSchema.tocContinues`); nothing here infers a continuation
   * from a page's name.
   *
   * That fixed the LENGTH and left the list naming page archetypes. On a real
   * Investment Compass it produced eight rows — *Cover · Contents ·
   * Executive dashboard · The assessment · Risk and recommendation · The
   * report · Sources and methodology · Important information* — for a 36-page
   * document whose body is twenty-one sections, because the twenty-nine
   * narrative pages fold into the single row named "The report". Everything a
   * reader opens a contents page to find was inside that row.
   *
   * The renderer publishes which of the report's OWN headings landed on which
   * visible page (`__sectionEntries`, computed from each `markdown-block`'s
   * packed bucket after pagination and conditional content). A page that named
   * a section lists its sections; a page that named none keeps the row it
   * always had. So the archetype pages — cover, contents, the dashboards, the
   * closing pages — still appear under the names their designer gave them, and
   * the body appears under the names the report gave itself.
   *
   * `tocContinues` is asked only of a page the narrative does NOT draw on. A
   * sheet that opens a section lists it; a sheet in the MIDDLE of one is not a
   * part of the document and contributes nothing — which is what the flag was
   * approximating, declared by a master rather than read off the render.
   *
   * One level of the run's own headings is listed. The Compass's narrative
   * carries 18 `h2` sections and 26 `h3` subsections; listing both is 51 rows
   * on a page that fits about 30, and `fitTocEntries` would then omit the tail
   * — which loses the END of the document rather than its detail. A complete
   * list of sections beats a truncated list of sections and subsections. A
   * master that wants more sets `sectionDepth`.
   *
   * WHICH level is `listedSectionLevel`'s to decide, and it is not simply the
   * shallowest: a narrative that wraps everything in one `h1` puts a single
   * row — the document's own title — at that level, which is how a nineteen
   * page Financial Analysis came to list its whole body as one contents entry.
   * See that function for the measurement.
   */
  const index = narrativeIndexFrom(ctx.data);
  const topLevel = listedSectionLevel(index.sections);
  const depth = Math.max(1, Number(p.sectionDepth ?? 1));
  const sectionsOn = new Map<number, NarrativeIndexSection[]>();
  for (const s of index.sections) {
    // Shallower than the listed level is the document's own title — the row
    // `listedSectionLevel` descended past. Listing it beside the sections it
    // introduces gives the same page two rows, the second of which is the
    // first section on it.
    if (s.level < topLevel) continue;
    if (s.level >= topLevel + depth) continue;
    const list = sectionsOn.get(s.pageIndex);
    if (list) list.push(s); else sectionsOn.set(s.pageIndex, [s]);
  }
  const narrativePages = new Set(index.narrativePages);

  const candidates = pages
    .map((pg, i) => ({ pg, i }))
    .filter(({ pg, i }) => (sectionsOn.has(i)
      || (!narrativePages.has(i) && (i === 0 || pg.tocContinues !== true))));

  /**
   * The front matter of a list is not an entry in it.
   *
   * Page 2 of the 97 Poole Road Compass opened `1. Cover / 2. Contents /
   * 3. Executive dashboard` — the first row pointing at the sheet before this
   * one and the second at the sheet the reader is holding. The filter above
   * kept both by construction, and `i === 0` FORCED the cover in past even
   * the `tocContinues` test. See `scopeContentsEntries` for the two bounds
   * that keep it off a page which opens a section and off a list it would
   * empty.
   */
  const scope = scopeContentsEntries({
    candidates: candidates.map(({ i }) => i),
    selfIndex: ctx.pageIndex,
    opensSection: (i) => sectionsOn.has(i),
  });
  const keep = new Set(scope.listed);
  const entries = candidates.filter(({ i }) => keep.has(i));

  /**
   * The list fits the page it is printed on — see `tocFit.ts`. A 41-section
   * document used to run off the foot of this page and be drawn, invisibly,
   * under the next page's blocks. The foot reserve is the master's footer zone;
   * a master that draws a taller foot declares `bottomReserve`.
   */
  const bottomReserve = Number(p.bottomReserve ?? 64);
  const titlePt = title ? titleSize * 1.6 : 0;
  // A page that opened three sections prints three rows, so the list is
  // measured in ROWS rather than in pages.
  const rows = entries.flatMap(({ pg, i }) => {
    const own = sectionsOn.get(i);
    if (own?.length) return own.map((s) => ({ label: s.label, page: String(i + 1), href: `#${s.anchor}` }));
    return [{ label: pg.name || `Page ${i + 1}`, page: String(i + 1), href: `#tpl-page-${i}` }];
  });
  const fit = fitTocEntries({
    entries: rows.length, availablePt: ctx.page.height - y - bottomReserve, titlePt,
    lineHeightPt: lh, sizePt: size,
  });
  const lines: Array<{ label: string; page: string; href: string | null }> = rows
    .slice(0, fit.shown)
    .map((r, n) => ({ label: `${n + 1}. ${r.label}`, page: r.page, href: r.href }));
  if (fit.omitted) lines.push({ label: tocOmittedLine(fit.omitted), page: '', href: null });

  /**
   * A contents entry goes to its section.
   *
   * The list named the page and could not reach it: measured on a 36-page
   * Templates render, the file carried 48 bookmarks and **zero** link
   * annotations, so the only way through the document was the reader's own
   * page field. `autoToc` has always linked; this list, which is the one the
   * catalogue's masters draw, never did.
   *
   * The destination is exact rather than inferred, and it is the finest one
   * available. A section row goes to the HEADING'S OWN id — the same id
   * `renderMarkdown` wrote and the same one the renderer read to find out
   * which page it landed on — so the reader arrives at the section rather
   * than at the top of the sheet carrying it. A page row goes to
   * `#tpl-page-<index into visiblePages>`, which is the index `renderPage`
   * stamps and the index `ctx.pages` is keyed by, so a folio and a
   * destination cannot disagree. The omitted-count line names no page and is
   * therefore not a link.
   */
  const row = (line: { label: string; page: string; href: string | null }) => {
    // The ANCHOR CARRIES TEXT AND NOTHING ELSE. Measured on WeasyPrint 69.0:
    // `<a>` wrapping plain text tags as a conforming `/Link`, and the moment
    // it contains an element — one `<span>`, the whole flex row — PDF/UA
    // clause 7.18.5 test 1 fails, 32 checks on the 36-page render. So the row
    // stays a flex box, the label alone is the link, and the folio beside it
    // is not. `text-decoration`/`color` are restated because the engine's own
    // stylesheet gives an anchor blue underlined text, which would repaint
    // every contents page in the catalogue.
    const label = `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    const inner = (line.href === null
      ? `<span style="${label}">${esc(line.label)}</span>`
      : `<a href="${esc(line.href)}" style="${label}text-decoration:none;color:${color};">${esc(line.label)}</a>`)
      + `<span style="color:${idxColor};flex:none;">${esc(line.page)}</span>`;
    return `<div style="display:flex;justify-content:space-between;gap:8pt;`
      + `line-height:${fit.lineHeightPt.toFixed(2)}pt;font-size:${fit.sizePt.toFixed(2)}pt;color:${color};">${inner}</div>`;
  };
  const columns = splitTocColumns(lines, fit.columns).map((col) => col.map(row).join(''));
  const body = fit.columns === 1
    ? columns[0]
    : `<div style="display:flex;gap:18pt;align-items:flex-start;">${columns.map((c) => `<div style="flex:1 1 0;min-width:0;">${c}</div>`).join('')}</div>`;

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;">
    ${title ? `<div style="color:${titleColor};font-weight:700;font-size:${titleSize}pt;margin-bottom:${titleSize * 0.6}pt;font-family:var(--font-heading, Helvetica);">${esc(title)}</div>` : ''}
    ${body}
  </div>`;
}
