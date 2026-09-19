/**
 * What is wrong with a rendered document, judged from the rendered document.
 *
 * ## Why this exists
 *
 * Every defect in the converter's last three rounds was found by rendering a
 * PDF and looking at the pages. None was found by a unit test. That is not an
 * indictment of the unit tests — they were all passing and all correct — it is
 * a statement about what they can see. A spec asserts on the HTML a function
 * returns; nobody had asserted on *the document a reader receives*, because
 * until now nothing in the repo could.
 *
 * The list of things that got through: a cover title printed as a filename and
 * running off the sheet; a company name and a design-system name jammed into
 * one word; four of seventeen pages carrying one to three lines each; a chapter
 * heading repeated verbatim as its own lede one line below itself; a disclaimer
 * printed as a column of ragged half-lines; the same contact block printed
 * twice, a page apart. Every one of those is obvious at a glance and invisible
 * to `toContain`.
 *
 * ## The split
 *
 * This module is **pure and knows nothing about pixels**. It is handed
 * measurements — a `PageMeasurement` per page, produced by
 * `scripts/reports/critique.mts` from a real WeasyPrint render — and returns
 * findings. That keeps the rules reviewable, testable and cheap to run, and
 * confines the rasteriser, the PDF and the filesystem to a script.
 *
 * It is deliberately *mechanical*. It cannot tell you the cover is ugly. It can
 * tell you the cover has ink outside the trim, that page nine is 4% covered,
 * and that "How the capacity is built" appears twice on one page at two sizes.
 * The `report-critic` agent does the rest by looking, and these findings are
 * what it is handed first so that it spends its attention on what a rule cannot
 * express.
 */

// ── What a measured page is ─────────────────────────────────────────────────

export interface PageMeasurement {
  /** 1-based, as printed. */
  page: number;
  /** Fraction of the page that is not the paper colour, 0–1. */
  inkCoverage: number;
  /**
   * Fraction of the *trim margin* that is not the paper colour, 0–1.
   *
   * The margin is where nothing but the running head and foot belong, so this
   * is never zero on a body page. It is the *excess* over the running chrome
   * that matters — see `TRIM_BLEED_MAX`.
   */
  marginInk: number;
  /** True when this page is a full-bleed field — a cover or a closing page. */
  fullBleed: boolean;
  /** The page's text, in reading order, one entry per line. */
  lines: readonly string[];
  /**
   * Text drawn at display size on this page, longest first.
   *
   * Used for the "same sentence twice in two sizes" rule. Produced by the
   * harness from the PDF's own font sizes, so it is what was actually set
   * rather than what the HTML asked for.
   */
  headings: readonly string[];
}

export interface DocumentMeasurement {
  pages: readonly PageMeasurement[];
  /** What the planner claimed before rendering, when the caller knows it. */
  claimedPages?: number;
}

// ── Thresholds ──────────────────────────────────────────────────────────────

/**
 * Below this a page is not a page, it is a page break with a sentence on it.
 *
 * Calibrated against real renders: a full body page of prose and a table
 * measures 0.14–0.22 ink; the `Warnings` page that started this — a heading and
 * one bullet — measured 0.03. Eight percent sits well clear of both.
 */
export const SPARSE_PAGE_INK = 0.08;

/**
 * A closing page is mostly field with a little type on it, so it reads as
 * sparse by the coverage rule and is not. Full-bleed pages are judged on
 * whether they carry *text*, not on how much ink they have.
 */
export const FULL_BLEED_MIN_LINES = 4;

/**
 * How much ink may sit in the trim margin before something has escaped.
 *
 * The running head and foot legitimately live there. A cover title that
 * overflowed its box put type hard against the paper edge and pushed the
 * masthead off the sheet entirely — that is what this catches.
 */
export const TRIM_BLEED_MAX = 0.06;

/** A document that claims one page count and prints another. */
export const PAGE_BUDGET_SLACK = 2;

/** Shorter than this and a repeated phrase is a label, not a duplicated line. */
export const MIN_ECHO_CHARS = 12;

// ── Findings ────────────────────────────────────────────────────────────────

export type CritiqueRule =
  | 'sparse-page'
  | 'trim-bleed'
  | 'heading-echo'
  | 'duplicate-block'
  | 'page-budget'
  | 'empty-page';

export type CritiqueSeverity = 'high' | 'medium' | 'low';

export interface CritiqueFinding {
  rule: CritiqueRule;
  severity: CritiqueSeverity;
  /** 1-based; 0 when the finding is about the document rather than a page. */
  page: number;
  /** One sentence, phrased so it can be read straight out of a CI log. */
  detail: string;
}

const SEVERITY: Record<CritiqueRule, CritiqueSeverity> = {
  'empty-page': 'high',
  'trim-bleed': 'high',
  'duplicate-block': 'high',
  'heading-echo': 'medium',
  'sparse-page': 'medium',
  'page-budget': 'low',
};

const finding = (rule: CritiqueRule, page: number, detail: string): CritiqueFinding =>
  ({ rule, severity: SEVERITY[rule], page, detail });

/** Case, punctuation and spacing removed, so only the words are compared. */
const bare = (v: string): string =>
  String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

// ── The rules ───────────────────────────────────────────────────────────────

/**
 * A page carrying almost nothing.
 *
 * The commonest failure in this programme by a distance, and the one that makes
 * a document read as unfinished: a chapter is a page, so a chapter with two
 * bullets in it is a page with two bullets on it.
 */
function sparsePages(pages: readonly PageMeasurement[]): CritiqueFinding[] {
  const out: CritiqueFinding[] = [];
  for (const p of pages) {
    if (!p.lines.length) {
      out.push(finding('empty-page', p.page, `page ${p.page} carries no text at all`));
      continue;
    }
    if (p.fullBleed) {
      // A cover is mostly field. Judge it on whether it says anything.
      if (p.lines.length < FULL_BLEED_MIN_LINES) {
        out.push(finding(
          'sparse-page', p.page,
          `page ${p.page} is a full-bleed page with only ${p.lines.length} lines on it`,
        ));
      }
      continue;
    }
    if (p.inkCoverage < SPARSE_PAGE_INK) {
      out.push(finding(
        'sparse-page', p.page,
        `page ${p.page} is ${pct(p.inkCoverage)} covered (${p.lines.length} lines) — `
        + `below the ${pct(SPARSE_PAGE_INK)} a page needs to look deliberate`,
      ));
    }
  }
  return out;
}

/** Ink where only the running head and foot belong. */
function trimBleed(pages: readonly PageMeasurement[]): CritiqueFinding[] {
  return pages
    .filter((p) => !p.fullBleed && p.marginInk > TRIM_BLEED_MAX)
    .map((p) => finding(
      'trim-bleed', p.page,
      `page ${p.page} has ${pct(p.marginInk)} of its trim margin inked — `
      + 'something has overflowed its box',
    ));
}

/**
 * The same sentence set twice on one page, at two sizes.
 *
 * A chapter header followed immediately by a lede repeating it. Cheap to check,
 * and it is exactly what a reader notices first.
 */
function headingEchoes(pages: readonly PageMeasurement[]): CritiqueFinding[] {
  const out: CritiqueFinding[] = [];
  for (const p of pages) {
    const heads = p.headings.map(bare).filter((h) => h.length >= MIN_ECHO_CHARS);
    for (const head of new Set(heads)) {
      const echoes = p.lines.filter((l) => bare(l) === head).length;
      const asHeading = heads.filter((h) => h === head).length;
      // The heading counts once in `lines` too, so an echo means twice or more.
      if (echoes > asHeading) {
        out.push(finding(
          'heading-echo', p.page,
          `page ${p.page} sets "${head}" as a heading and again as body copy`,
        ));
      }
    }
  }
  return out;
}

/**
 * A run of lines printed identically on two different pages.
 *
 * Catches the uploaded contact block printed as a chapter and then again by the
 * design system's own closing page. Four consecutive lines is long enough that
 * a shared table header or a running foot cannot trip it.
 */
export const DUPLICATE_RUN_LINES = 4;

function duplicateBlocks(pages: readonly PageMeasurement[]): CritiqueFinding[] {
  const seen = new Map<string, number>();
  const out: CritiqueFinding[] = [];
  for (const p of pages) {
    const body = p.lines.map(bare).filter((l) => l.length >= MIN_ECHO_CHARS);
    for (let i = 0; i + DUPLICATE_RUN_LINES <= body.length; i += 1) {
      const run = body.slice(i, i + DUPLICATE_RUN_LINES).join(' | ');
      const first = seen.get(run);
      if (first === undefined) {
        seen.set(run, p.page);
      } else if (first !== p.page) {
        out.push(finding(
          'duplicate-block', p.page,
          `page ${p.page} repeats ${DUPLICATE_RUN_LINES} lines already printed on page ${first}`,
        ));
        // One report per page pair; the run is enough to find it by hand.
        seen.set(run, p.page);
        break;
      }
    }
  }
  return out;
}

/** The spine claimed one length and the renderer produced another. */
function pageBudget(doc: DocumentMeasurement): CritiqueFinding[] {
  if (typeof doc.claimedPages !== 'number') return [];
  const actual = doc.pages.length;
  const drift = Math.abs(actual - doc.claimedPages);
  if (drift <= PAGE_BUDGET_SLACK) return [];
  return [finding(
    'page-budget', 0,
    `the spine claimed ${doc.claimedPages} pages and the render is ${actual}`,
  )];
}

/**
 * Judge a rendered document.
 *
 * Ordered high severity first, then by page, so the top of the list is the
 * thing to fix. Never throws: a malformed measurement produces no finding
 * rather than taking a CI job down.
 */
export function judgeDocument(doc: DocumentMeasurement): CritiqueFinding[] {
  // Read rather than trusted. These measurements arrive from a Python script
  // over stdout, and a rubric that throws on a malformed page takes a CI job
  // down instead of reporting on the pages it *could* read.
  const num = (v: unknown, fallback = 0): number =>
    (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const strings = (v: unknown): string[] =>
    (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

  const pages: PageMeasurement[] = (Array.isArray(doc?.pages) ? doc.pages : [])
    .filter((p): p is PageMeasurement => !!p && typeof p === 'object')
    .map((p, i) => ({
      page: num(p.page, i + 1),
      inkCoverage: num(p.inkCoverage),
      marginInk: num(p.marginInk),
      fullBleed: p.fullBleed === true,
      lines: strings(p.lines),
      headings: strings(p.headings),
    }));
  const findings = [
    ...sparsePages(pages),
    ...trimBleed(pages),
    ...headingEchoes(pages),
    ...duplicateBlocks(pages),
    ...pageBudget({ ...doc, pages }),
  ];
  const rank: Record<CritiqueSeverity, number> = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.page - b.page);
}

/** The findings as a CI log block. Empty string when there are none. */
export function describeCritique(findings: readonly CritiqueFinding[]): string {
  if (!findings.length) return '';
  return findings
    .map((f) => `  [${f.severity}] ${f.rule}: ${f.detail}`)
    .join('\n');
}

/**
 * Does this document pass?
 *
 * `high` fails. `medium` and `low` are reported and do not, because a sparse
 * page is sometimes the right answer — a one-line "Scenario comparison" chapter
 * that the live report will fill is thin on purpose — and a gate that cries
 * wolf on those gets switched off.
 */
export function critiquePasses(findings: readonly CritiqueFinding[]): boolean {
  return !findings.some((f) => f.severity === 'high');
}
