/**
 * A converted template, as a document.
 *
 * ## What this renders
 *
 * The sections extracted from somebody's uploaded template, set through the
 * report design system under a chosen brand design system, in the order the
 * bound report format expects them.
 *
 * The bound format is what makes the output more than a reformat. Its chapters
 * are the spine, so a converted template opens as *that format* — same chapter
 * order, same running heads, same contents page, same closing company page as
 * the migrated renderers produce. When the real report data arrives later, the
 * chapters are already the right ones and in the right order.
 *
 * ## Three things a chapter can be
 *
 * - **bound** — a section of the upload plays this chapter. Its prose is set.
 * - **unfilled** — the format has this chapter and the template offered nothing.
 *   It is still printed, with a line saying the live report will supply it,
 *   because dropping it would change the format's own structure.
 * - **appendix** — a section of the upload that no chapter wanted. Printed at
 *   the back rather than discarded, so nothing a person uploaded disappears
 *   without being visible somewhere.
 *
 * That third case is the one worth stating plainly. It is tempting to drop
 * unbound sections — they are, by definition, the ones the format has no place
 * for. But somebody chose to put them in their template, and a converter that
 * silently eats a third of an upload is a converter nobody trusts twice.
 */
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderContentsPage,
  renderCover,
  renderDocument,
  renderLede,
  renderSheet,
  renderSidenote,
  type BrandLockupProps,
} from '../../reportDesign/primitives.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import {
  buildSpine,
  contentsEntriesFor,
  REPORT_ARCHETYPES,
  type ReportArchetypeId,
  type SpineEntry,
  spinePageBudget,
  validateSpine,
} from '../../reportDesign/structure.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import { chartContext } from '../../reportDesign/charts.pure.ts';
import { pagesForLines, renderMarkdown, THIN_CHAPTER_LINES } from '../markdown.pure.ts';
import type { BindingPlan } from './binding.pure.ts';
import { formatName, isPassthroughFormat } from './binding.pure.ts';
import { enrichedLines, type EnrichedBlock } from './enrich.pure.ts';
import { renderEnrichedBlocks } from './renderBlocks.pure.ts';
import type { ExtractedSection, ExtractedStructure } from './structure.pure.ts';
import { formatReportDate } from '../reportDate.pure.ts';

/**
 * Enriched blocks for the chapters that got them, by chapter id.
 *
 * Partial on purpose. Enrichment is per-chapter and every chapter can fail on
 * its own — no key, a timeout, a guard rejection twice, zero blocks — and a
 * chapter with no entry here renders exactly as the converter always rendered
 * it. That is what makes enrichment safe to add to a working path: its total
 * failure is the previous behaviour.
 */
export type EnrichedChapters = Readonly<Record<string, readonly EnrichedBlock[]>>;

/** Lines a chapter costs before a word of it is set. Pinned by the programme. */
export const CHAPTER_FURNITURE_LINES = 3;

/**
 * Below this an appendix section cannot hold a page on its own.
 *
 * Moved to `markdown.pure.ts` when the investment format needed the same
 * rule; the value and the reasoning that produced it are recorded there, and
 * re-exported here because this format's callers and its contract doc both
 * name it. Same number, same behaviour.
 */
export { THIN_CHAPTER_LINES };

/** What a packed run of thin sections calls itself. */
export const APPENDIX_TITLE = 'Also in the uploaded template';

/** An unfilled chapter is a header and one callout. */
export const UNFILLED_CHAPTER_LINES = 10;

/**
 * The lede and the draft notice, which only the first chapter carries.
 *
 * Measured against a render, not estimated: a two-line lede, a five-line
 * callout with its label and rules, and the space around both. It was not
 * charged at all until a real conversion was rendered and read — the spine
 * claimed thirteen pages for a document WeasyPrint printed in fifteen, and this
 * was one of the two pages missing.
 */
export const OPENING_NOTICE_LINES = 11;

/** The "your upload had no headings" callout, when there is one. */
export const UNSTRUCTURED_NOTICE_LINES = 7;

export type PlannedChapterKind = 'bound' | 'unfilled' | 'appendix';

export interface PlannedConvertedChapter {
  id: string;
  kind: PlannedChapterKind;
  title: string;
  note?: string;
  markdown: string;
  /** Present only when this chapter was enriched. Rendered instead of `markdown`. */
  blocks?: readonly EnrichedBlock[];
  /** Sub-sections folded into this chapter rather than given one of their own. */
  foldedSubsections?: number;
  /** Thin appendix sections packed into this one chapter. Absent when 1. */
  packedSections?: number;
  lines: number;
  pages: number;
  /**
   * As printed on the chapter opener and in the contents — `05`, or `A`.
   *
   * Two series, because this document is two things: the format's own chapters,
   * and an appendix of what the uploaded template had no home for. Numbered here
   * so the opener, the contents page and the spine cannot disagree.
   */
  number: string;
  /** The word before the number. `Section` for a chapter, `Appendix` for one. */
  label: string;
}

/**
 * A sub-section's content, put back under a heading.
 *
 * `ExtractedSection.markdown` has its own heading stripped — the spine printed
 * it — so folding one into a parent has to put it back or the reader gets two
 * subjects run together with nothing between them. `depth + 1` matches what
 * `extractStructure` already does for headings too deep to bind.
 */
function asNestedMarkdown(section: ExtractedSection): string {
  return `${'#'.repeat(section.depth + 1)} ${section.title}\n\n${section.markdown}`;
}

/**
 * Plan the document from the binding, in the format's own chapter order.
 *
 * ## Sub-sections belong to their parent, not to the appendix
 *
 * This function used to ignore `depth` entirely: every section the binding did
 * not want became its own appendix chapter, with an eyebrow, a header and a
 * page break. That is right for a top-level section the format has no place
 * for, and wrong for a `###` inside one.
 *
 * Measured on a real conversion: a Snapshot transcribed into 20 sections, of
 * which 12 were `depth: 2` sub-headings inside *How This Was Calculated* —
 * `DTI Ratio` at 61 characters, `Serviceability Band` at 55, `Stress Test` at
 * 78. Each got a full page. The document came out at 27 pages where the same
 * source with a flatter transcription came out at 14, and the back half read as
 * a list of stubs rather than a report.
 *
 * So an unbound sub-section is folded into the chapter its parent produced —
 * whether that parent was bound to a format chapter or is itself an appendix
 * entry. A sub-section the binding *did* want still becomes a chapter, because
 * somebody chose it. Nothing is dropped either way; the appendix keeps its job
 * of losing nothing, and stops being a page per paragraph.
 */
export function planConvertedChapters(
  structure: ExtractedStructure,
  plan: BindingPlan,
  enriched: EnrichedChapters = {},
): PlannedConvertedChapter[] {
  /** Numbered in one pass at the end, so the two series are decided in one place. */
  const chapters: Array<Omit<PlannedConvertedChapter, 'number' | 'label'>> = [];

  // Whatever the first chapter carries on top of its own content.
  const opening = OPENING_NOTICE_LINES
    + (structure.notices.unstructured ? UNSTRUCTURED_NOTICE_LINES : 0);

  // ── Fold unbound sub-sections into their parent ───────────────────────────
  //
  // The parent is the nearest preceding section one level shallower. A
  // sub-section with no parent — a document that opens at `##` — has nothing to
  // fold into and keeps its own chapter.
  const bound = new Set(
    plan.bindings.map((b) => b.sectionIndex).filter((i): i is number => i !== null),
  );
  const foldedInto = new Map<number, ExtractedSection[]>();
  const absorbed = new Set<number>();

  for (const section of structure.sections) {
    if (section.depth === 1 || bound.has(section.index)) continue;
    let parent: ExtractedSection | null = null;
    for (let i = section.index - 1; i >= 0; i -= 1) {
      const candidate = structure.sections[i];
      if (candidate && candidate.depth < section.depth) { parent = candidate; break; }
    }
    if (!parent) continue;
    const list = foldedInto.get(parent.index) ?? [];
    list.push(section);
    foldedInto.set(parent.index, list);
    absorbed.add(section.index);
  }

  /** A section's own Markdown plus whatever folded into it, in source order. */
  const bodyOf = (section: ExtractedSection): string => {
    const children = foldedInto.get(section.index);
    if (!children?.length) return section.markdown;
    return [section.markdown, ...children.map(asNestedMarkdown)].join('\n\n');
  };

  // Enriched blocks and flat Markdown cost different numbers of lines — a KPI
  // strip is four where the table it replaced was nine — so the budget has to
  // be taken from whichever will actually be printed. Costing the Markdown and
  // printing the blocks is how a spine claims a page count the document does
  // not have, which is the defect `BORROWING_CAPACITY.md` §2 exists about.
  const costOf = (id: string, markdown: string, idPrefix: string): number => {
    const blocks = enriched[id];
    return (blocks?.length ? enrichedLines(blocks) : renderMarkdown(markdown, { idPrefix }).lines)
      + CHAPTER_FURNITURE_LINES
      // `renderConvertedBody` puts the lede and the draft notice inside the
      // first chapter's body, so the first chapter is the one that pays for
      // them. Keyed on the list being empty rather than on an index, because
      // an unfilled first chapter is charged too — it prints the same notice.
      + (chapters.length === 0 ? opening : 0);
  };

  plan.bindings.forEach((binding, i) => {
    const section = binding.sectionIndex === null
      ? null
      : structure.sections[binding.sectionIndex] ?? null;
    if (section) {
      const id = `cv.${i}`;
      const blocks = enriched[id];
      const markdown = bodyOf(section);
      const lines = costOf(id, markdown, `cv${i}`);
      const folded = foldedInto.get(section.index)?.length ?? 0;
      chapters.push({
        id,
        kind: 'bound',
        title: binding.chapter,
        note: section.title === binding.chapter ? undefined : `From "${section.title}"`,
        markdown,
        blocks: blocks?.length ? blocks : undefined,
        foldedSubsections: folded || undefined,
        lines,
        pages: pagesForLines(lines),
      });
      return;
    }
    const unfilledLines = UNFILLED_CHAPTER_LINES + (chapters.length === 0 ? opening : 0);
    chapters.push({
      id: `cv.${i}`,
      kind: 'unfilled',
      title: binding.chapter,
      // No dek. The callout this chapter's body *is* carries the label
      // `SUPPLIED BY THE LIVE REPORT`, and a 12pt italic dek saying the same
      // four words 40pt above an 8.5pt mono eyebrow saying them again is the
      // repetition E3 exists to stop — three pages of a real render opened on
      // exactly that.
      note: undefined,
      markdown: '',
      lines: unfilledLines,
      pages: pagesForLines(unfilledLines),
    });
  });

  // ── Pack the thin appendix sections ──────────────────────────────────────
  //
  // A chapter is a page: `.chapter { page-break-before: always }` is global to
  // all nine formats and stays that way. So a two-bullet `Warnings` section
  // promoted to a chapter costs a whole sheet, and a real render came back with
  // four of its seventeen pages carrying one to three lines each.
  //
  // Consecutive appendix sections that are each too small to hold a page are
  // packed into one chapter, each under its own heading — the same shape D1's
  // folding produces, and the same helper. A section big enough to carry a page
  // keeps its own title, because the appendix's job is that nothing an uploader
  // wrote disappears, and losing the name of a substantial section is a way of
  // disappearing it.
  //
  // The decision is taken on the *flat* Markdown cost, never on the enriched
  // one. `planConvertedChapters` runs twice for one document — once to choose
  // what to send the model, once to render what came back — and a grouping that
  // moved between those two calls would re-key the whole appendix.
  const thin = (markdown: string, idPrefix: string): boolean =>
    renderMarkdown(markdown, { idPrefix }).lines + CHAPTER_FURNITURE_LINES < THIN_CHAPTER_LINES;

  const groups: ExtractedSection[][] = [];
  for (const index of plan.unbound) {
    const section = structure.sections[index];
    if (!section || absorbed.has(index)) continue;
    const last = groups[groups.length - 1];
    const small = thin(bodyOf(section), `cvpack${index}`);
    if (small && last && last.length && thin(bodyOf(last[last.length - 1]), `cvpack${last[last.length - 1].index}`)) {
      last.push(section);
    } else {
      groups.push([section]);
    }
  }

  groups.forEach((group, n) => {
    const id = `cv.a${n}`;
    const blocks = enriched[id];
    const lead = group[0];
    const markdown = group.length === 1
      ? bodyOf(lead)
      : group.map((s) => `## ${s.title}\n\n${bodyOf(s)}`).join('\n\n');
    const lines = costOf(id, markdown, `cva${n}`);
    const folded = group.reduce((t, s) => t + (foldedInto.get(s.index)?.length ?? 0), 0);
    chapters.push({
      id,
      kind: 'appendix',
      title: group.length === 1 ? lead.title : APPENDIX_TITLE,
      // A packed chapter names what it holds. "From the template" over "From
      // the uploaded template" is the same sentence twice in two sizes, which
      // is the thing this pass exists to stop doing.
      // A packed group prints `## <title>` for each section it holds, so a dek
      // listing those same titles says the page's own headings back to it —
      // `From the template` / `Recommendations · Warnings`, then
      // `Recommendations` and `Warnings` as the only two headings below. The
      // headings are the better label; the dek is dropped.
      note: group.length === 1 ? 'From the uploaded template' : undefined,
      markdown,
      blocks: blocks?.length ? blocks : undefined,
      foldedSubsections: folded || undefined,
      packedSections: group.length > 1 ? group.length : undefined,
      lines,
      pages: pagesForLines(lines),
    });
  });

  // ── A pass-through chapter still has to earn its sheet ────────────────────
  //
  // A chapter is a sheet. For a declarative format that is fine — its chapters
  // are the format's own and each is substantial — and for the appendix the
  // packing above already handles it. A pass-through format is the third case:
  // its chapters are whatever the uploaded template's top level happened to be,
  // and a template with a two-bullet `Recommendations` and a one-bullet
  // `Warnings` spent two sheets on three lines. Measured: 0.011 and 0.006 ink,
  // against a native document's 0.133–0.221.
  //
  // The same rule and the same helper as the appendix: consecutive chapters
  // that are each too thin to hold a page become one, each under its own
  // heading. Nothing is lost and nothing is renamed — the packed chapter takes
  // the first section's title, because for this format the template's own words
  // are the chapter names and inventing one would be the C5 mistake again.
  const packed = isPassthroughFormat(plan.format) ? packThin(chapters, enriched) : chapters;

  // ── Two series ────────────────────────────────────────────────────────────
  //
  // The document says on its second page that unmatched sections are "kept as
  // an appendix", and then printed them in the main spine under `SECTION 05` …
  // `SECTION 10` with the same eyebrow, the same rule and the same 30pt serif
  // as the format's own chapters. The only marker was a 9pt italic dek, which
  // nobody reads as a structural boundary — so the document contradicted itself
  // on page two, and cross-format binding made it worse: a Borrowing Capacity
  // template bound to Portfolio has six appendix chapters, not three.
  //
  // Letters rather than a continued count, because an appendix is not chapter
  // eleven of a ten-chapter format. `contentsEntriesFor` reads these back off
  // the spine, so the contents page and the openers cannot drift — they used to
  // count independently and agreed only by coincidence.
  // The format's own word for a chapter — `Chapter` for the Investment Compass,
  // `Section` for the other nine. An appendix has only one word.
  const chapterLabel = REPORT_ARCHETYPES[plan.format]?.chapterLabel ?? 'Section';
  let section = 0;
  let appendix = 0;
  return packed.map((chapter) => {
    if (chapter.kind === 'appendix') {
      appendix += 1;
      return { ...chapter, number: appendixLetter(appendix), label: 'Appendix' };
    }
    section += 1;
    return { ...chapter, number: String(section).padStart(2, '0'), label: chapterLabel };
  });
}

/**
 * Merge runs of chapters too thin to hold a page, each under its own heading.
 *
 * The appendix packer's rule, applied to a pass-through format's own chapters —
 * see the call site. Costed on the *flat* Markdown, never the enriched blocks,
 * for the reason the appendix packer records: this runs twice for one document
 * and a grouping that moved between the two calls would re-key everything.
 */
function packThin(
  chapters: ReadonlyArray<Omit<PlannedConvertedChapter, 'number' | 'label'>>,
  enriched: EnrichedChapters,
): Array<Omit<PlannedConvertedChapter, 'number' | 'label'>> {
  const thin = (c: { markdown: string; id: string }): boolean =>
    renderMarkdown(c.markdown, { idPrefix: `pk${c.id.replace(/[^a-z0-9]/gi, '')}` }).lines
      + CHAPTER_FURNITURE_LINES < THIN_CHAPTER_LINES;

  const groups: Array<Array<Omit<PlannedConvertedChapter, 'number' | 'label'>>> = [];
  for (const chapter of chapters) {
    const last = groups[groups.length - 1];
    // Never absorb an enriched chapter: its blocks are keyed by its own id, and
    // a merge would render the flat Markdown while the design pass was costed.
    const mergeable = thin(chapter) && !enriched[chapter.id]?.length;
    if (mergeable && last?.length && thin(last[last.length - 1]) && !enriched[last[0].id]?.length) {
      last.push(chapter);
    } else {
      groups.push([chapter]);
    }
  }

  return groups.map((group) => {
    if (group.length === 1) return group[0];
    const lead = group[0];
    const markdown = group.map((c) => `## ${c.title}\n\n${c.markdown}`).join('\n\n');
    const lines = renderMarkdown(markdown, { idPrefix: `pk${lead.id.replace(/[^a-z0-9]/gi, '')}` }).lines
      + CHAPTER_FURNITURE_LINES;
    return {
      ...lead,
      // Named from the sections it holds, not from the first of them.
      //
      // Keeping the lead's title printed `Recommendations` at 34pt over
      // `Recommendations` at 17pt — the echo this programme keeps removing —
      // and implied the second section was subordinate to the first when the
      // two were peers. Joining their own words names the chapter without
      // inventing one, which is the line C5 draws.
      title: joinTitles(group.map((c) => c.title)),
      markdown,
      blocks: undefined,
      packedSections: group.length,
      lines,
      pages: pagesForLines(lines),
    };
  });
}

/** `[a, b]` → `a & b`; `[a, b, c]` → `a, b & c`. Trimmed to the cover measure. */
function joinTitles(titles: readonly string[]): string {
  const parts = titles.filter(Boolean);
  if (parts.length < 2) return parts[0] ?? APPENDIX_TITLE;
  const joined = `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`;
  return joined.length <= 72 ? joined : `${parts[0]}, and ${parts.length - 1} more`;
}

/** `1 → A`, `26 → Z`, `27 → AA`. A template with 27 loose sections is not likely. */
function appendixLetter(n: number): string {
  let out = '';
  let i = Math.max(1, n);
  while (i > 0) {
    const r = (i - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    i = Math.floor((i - 1) / 26);
  }
  return out;
}

export interface RenderConvertedInput {
  structure: ExtractedStructure;
  plan: BindingPlan;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  masthead: string;
  /** The design system's name, printed on the cover so a draft is identifiable. */
  systemName: string;
  lockup?: BrandLockupProps | null;
  heroDataUri?: string | null;
  confidentiality?: string | null;
  options?: ReportDesignOptions | null;
  preparedOn: string;
  reference?: string | null;
  /** Enriched blocks, by chapter id. Absent chapters render as flat Markdown. */
  enriched?: EnrichedChapters;
  /**
   * Composed sheets by chapter id — model-authored, already sanitised.
   *
   * Wins over `enriched` for a chapter that has both, which cannot happen: a
   * conversion asks for one or the other. Each sheet is one printed page.
   */
  composed?: Readonly<Record<string, readonly string[]>>;
  /**
   * Print it as a document rather than as a draft.
   *
   * Drops the caution block, the `converted draft` on the cover and the
   * `From "…"` deks. Defaults to false, so a caller that has not thought about
   * it gets the warning. See `RenderRequest.final`.
   */
  final?: boolean;
}

export interface ConvertedRenderPlan {
  spine: SpineEntry[];
  bodyHtml: string;
  chapters: string[];
  pageBudget: number;
  boundCount: number;
  unfilledCount: number;
  appendixCount: number;
  /** Chapters that printed designed output rather than flat Markdown. */
  enrichedCount: number;
  /** Of those, the ones the model composed as pages. */
  composedCount: number;
  /** Every block kind printed across the document, counted. For the ledger. */
  blockCounts: Record<string, number>;
  problems: string[];
  /**
   * The format's page band, when the draft sits outside it.
   *
   * Advisory rather than fatal — see `renderConvertedBody`. Surfaced so the
   * review screen can say "this draft is longer than the format usually runs",
   * which is worth knowing and is not an error.
   */
  bandNote: string[];
}


export { formatReportDate };

export function renderConvertedBody(input: RenderConvertedInput): ConvertedRenderPlan {
  const archetype = REPORT_ARCHETYPES[input.plan.format];
  const chapters = planConvertedChapters(input.structure, input.plan, input.enriched ?? {});
  const charts = chartContext(input.palette);

  // The name the document calls itself, everywhere.
  //
  // `archetype.documentName` is catalogue metadata; `formatName` is what the
  // renderer prints on a real one of these. Using both put "Borrowing Capacity
  // Assessment" in the cover eyebrow and the running head while the cover's own
  // "Bound to" line said "Borrowing Capacity Snapshot" — one page, two names
  // for the same format.
  const documentName = formatName(input.plan.format);

  const spine = buildSpine({
    archetype: input.plan.format,
    chapters: chapters.map((c) => ({
      id: c.id, title: c.title, pageBudget: c.pages, note: c.note, number: c.number,
    })),
    contentsPages: Math.max(1, Math.ceil(chapters.length / 22)),
  });

  // Whether there is a contents page is the *spine's* answer, not this
  // renderer's.
  //
  // `buildSpine` adds one only when the archetype asks for it — Borrowing
  // Capacity declares `contents: false`, because a short format does not carry
  // one. This renderer used to print a contents page unconditionally, which
  // broke the binding's whole promise (a draft bound to a format opens *as*
  // that format) and under-claimed the page budget by exactly one, since the
  // spine was costing a page the document was not printing and vice versa.
  //
  // Reading it back off the spine is what makes the two incapable of
  // disagreeing again.
  const contentsEntry = spine.find((e) => e.slot === 'contents');

  // The page band is advisory here, and only here.
  //
  // A converted draft is not an instance of the format — it is a draft *bound*
  // to one, and it carries appendix chapters the format never has. The
  // Borrowing Capacity band is [4, 12] and a seven-chapter template with four
  // unmatched sections lands at 13, which is correct output and would be a
  // fatal `problems` entry for every other renderer in the programme. Every
  // other rule `validateSpine` enforces — illegal slots, duplicate ids, a
  // document with no chapters — is a real defect here too and stays fatal.
  const allProblems = validateSpine(input.plan.format, spine);
  const bandMarker = `outside ${input.plan.format}`;
  const problems = allProblems.filter((p) => !p.includes(bandMarker));
  const bandNote = allProblems.filter((p) => p.includes(bandMarker));

  const bound = chapters.filter((c) => c.kind === 'bound').length;
  const unfilled = chapters.filter((c) => c.kind === 'unfilled').length;
  const appendix = chapters.filter((c) => c.kind === 'appendix').length;

  const final = input.final === true;

  const cover = renderCover({
    eyebrow: final ? documentName : `${documentName} · converted draft`,
    title: input.structure.title,
    masthead: input.masthead,
    // The design system's name is build vocabulary, not a co-brand.
    //
    // In the edition slot it sets top-right opposite the masthead, wrapped over
    // two lines — so the first surface anyone sees carried our tooling's name
    // beside the tenant's. It is genuinely useful while somebody is checking a
    // draft, which is where it now lives: a meta row with the binding and the
    // date, and nothing at all on a document marked final.
    edition: null,
    meta: [
      { label: 'Bound to', value: formatName(input.plan.format) },
      ...(final || !input.systemName ? [] : [{ label: 'Design system', value: input.systemName }]),
      { label: 'Prepared on', value: formatReportDate(input.preparedOn) },
      { label: 'Chapters', value: String(chapters.length) },
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  const contents = contentsEntry
    ? renderContentsPage(
      'Contents',
      contentsEntriesFor(spine).map((e) => ({ number: e.number, title: e.title, note: e.note })),
    )
    : '';

  // Said on page one, every time.
  //
  // A converted document looks exactly like a finished one — same cover, same
  // typography, same closing page — and it is not. Somebody will send it to a
  // client by accident unless the document itself says what it is.
  //
  // A `sidenote` rather than a `caution` callout, and only when the render is
  // not final. The caution block is the design system's loudest primitive —
  // tinted panel, coloured rule, full measure — and putting it at the top of
  // chapter one made the first thing anybody read a warning about the document
  // instead of the document. It said the right thing at the wrong volume; the
  // sidenote says the same thing beside the text.
  const draftNotice = final ? '' : renderSidenote(
    'Converted draft — not a client document',
    `<p>${escapeHtml(
      `The structure of "${input.structure.title}" has been converted onto the ${
        formatName(input.plan.format)
      } format. The words are the ones from the uploaded template, not live report data. `
      + `${bound} ${bound === 1 ? 'chapter carries' : 'chapters carry'} converted content`
      + `${unfilled ? `, ${unfilled} will be supplied by the live report` : ''}`
      + `${appendix ? `, and ${appendix} unmatched ${appendix === 1 ? 'section is' : 'sections are'} kept as an appendix` : ''}.`,
    )}</p>`,
  );

  const unstructured = input.structure.notices.unstructured
    ? renderCallout(
      'caution',
      'The upload had no headings',
      '<p>No heading structure was found in the source, so the whole document became one '
      + 'section and nothing could be bound to the format. Re-exporting the original with '
      + 'real headings — rather than text sized to look like them — converts far better.</p>',
    )
    : '';

  const blockCounts: Record<string, number> = {};
  let enrichedCount = 0;
  let composedCount = 0;
  const composedFor = (id: string): readonly string[] => input.composed?.[id] ?? [];

  const body = chapters.map((chapter, index) => {
    const number = chapter.number;
    // The opening lede describes the *conversion*, so it goes with the draft
    // furniture. A final document opens on its own first chapter.
    const opening = index === 0
      ? (final ? '' : renderLede(
        `A converted draft of "${input.structure.title}", bound to the ${
          formatName(input.plan.format)
        } format.`,
      )) + draftNotice + unstructured
      : '';

    const idPrefix = chapter.id.replace(/[^a-z0-9]/gi, '');
    let inner: string;
    if (chapter.kind === 'unfilled') {
      inner = renderCallout(
        'informative',
        'Supplied by the live report',
        `<p>${escapeHtml(
          `The ${formatName(input.plan.format)} format prints a "${chapter.title}" chapter from `
          + 'its own data. The uploaded template had no section that matched it, so this chapter '
          + 'is empty in the draft and will fill itself when the format renders for real.',
        )}</p>`,
      );
    } else if (composedFor(chapter.id).length) {
      // Composed: the model chose what fills each page, so the renderer stops
      // flowing and starts placing. `renderSheet` uses `min-height`, so an
      // over-full page grows rather than clipping.
      const sheets = composedFor(chapter.id);
      composedCount += 1;
      inner = sheets.map((html) => renderSheet(html)).join('');
    } else if (chapter.blocks?.length) {
      // Designed. `renderEnrichedBlocks` returns the primitives' own output —
      // KPI strips, data tables, charts — rather than the paragraph soup that
      // `renderMarkdown` makes of anything it does not have a rule for.
      const rendered = renderEnrichedBlocks(chapter.blocks, charts, idPrefix);
      if (rendered.html) {
        enrichedCount += 1;
        for (const b of chapter.blocks) blockCounts[b.kind] = (blockCounts[b.kind] ?? 0) + 1;
        inner = rendered.html;
      } else {
        // Every block refused by its primitive. Vanishingly unlikely — the
        // reader rejects degenerate input before it gets here — but a chapter
        // that prints nothing is worse than one that prints flat prose.
        inner = renderMarkdown(chapter.markdown, {
          idPrefix,
          headlessTableCaption: chapter.title,
          // Not on a packed chapter. Its body opens `## <first section>` and
          // its title *is* that first section, so dropping the echo deleted a
          // real heading: `Warnings` then read as a subsection of
          // `Recommendations` when the two were peers.
          chapterTitle: chapter.packedSections ? undefined : chapter.title,
        }).html;
      }
    } else {
      inner = renderMarkdown(chapter.markdown, {
        idPrefix,
        headlessTableCaption: chapter.title,
        chapterTitle: chapter.packedSections ? undefined : chapter.title,
      }).html;
    }

    return openChapter(documentName, number, chapter.title)
      + renderChapterHeader({
        number,
        title: chapter.title,
        // `From "Executive Summary"` is provenance — useful while somebody is
        // checking the binding, noise on a document being sent out. An appendix
        // chapter keeps its note either way: on a *final* document it is the
        // only thing on the page saying which of the template's sections this
        // is, and `APPENDIX B` alone does not.
        dek: final && chapter.kind !== 'appendix' ? undefined : chapter.note,
        // `Appendix A` where the format's own chapters say `Section 05`.
        label: chapter.label,
      })
      + `<div class="chapter-body">${opening}${inner}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({ block: input.company, lockup: input.lockup ?? null });

  return {
    spine,
    bodyHtml: cover + contents + body + closing,
    chapters: chapters.map((c) => c.title),
    pageBudget: spinePageBudget(spine),
    boundCount: bound,
    unfilledCount: unfilled,
    appendixCount: appendix,
    enrichedCount: enrichedCount + composedCount,
    composedCount,
    blockCounts,
    problems,
    bandNote,
  };
}

export function renderConvertedDocument(
  input: RenderConvertedInput,
): ConvertedRenderPlan & { html: string } {
  const plan = renderConvertedBody(input);
  return {
    ...plan,
    html: renderDocument({
      // The PDF's own title, which is what a viewer shows in its tab and what a
      // file manager indexes — so it carries the draft mark too, and drops it
      // for the same reason the cover does.
      title: input.final === true
        ? input.structure.title
        : `${input.structure.title} — converted draft`,
      author: input.masthead,
      subject: formatName(input.plan.format),
      css: buildReportCss({
        palette: input.palette,
        options: input.options ?? null,
        masthead: input.masthead,
      }),
      bodyHtml: plan.bodyHtml,
    }),
  };
}

export interface RenderConvertedFromBrandInput {
  structure: ExtractedStructure;
  plan: BindingPlan;
  snapshot: ReportBrandSnapshot;
  /** The palette the chosen design system resolves to. */
  palette: ResolvedReportPalette;
  options: ReportDesignOptions;
  systemName: string;
  disclaimer?: CompanyDisclaimer | null;
  coverArtDataUri?: string | null;
  preparedOn: string;
  reference?: string | null;
  enriched?: EnrichedChapters;
  /** See `RenderConvertedInput.composed`. */
  composed?: Readonly<Record<string, readonly string[]>>;
  /** See `RenderConvertedInput.final`. */
  final?: boolean;
}

export interface ConvertedRenderResult extends ConvertedRenderPlan {
  html: string;
  gaps: string[];
}

/**
 * Render under a brand design system.
 *
 * The palette comes from the *design system*, not from the brand snapshot —
 * that is the whole point of choosing one. The snapshot still supplies the
 * company block, the lockup and the confidentiality line, because those are
 * facts about the tenant rather than design decisions.
 */
export function renderConvertedFromBrand(
  input: RenderConvertedFromBrandInput,
): ConvertedRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  const rendered = renderConvertedDocument({
    structure: input.structure,
    plan: input.plan,
    palette: input.palette,
    company: brand.company,
    masthead: brand.masthead,
    systemName: input.systemName,
    lockup: brand.lockup,
    heroDataUri: brand.heroDataUri,
    confidentiality: brand.confidentiality,
    options: input.options,
    preparedOn: input.preparedOn,
    reference: input.reference ?? null,
    enriched: input.enriched,
    composed: input.composed,
    final: input.final,
  });

  return { ...rendered, gaps: brand.gaps };
}
