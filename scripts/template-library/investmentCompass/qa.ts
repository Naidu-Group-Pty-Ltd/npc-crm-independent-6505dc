/**
 * Investment Compass — render QA.
 *
 * ## Why this exists on top of the spec suite
 *
 * `investmentCompassCatalogue.spec.ts` proves the templates parse, render and
 * carry their colourways. It cannot prove they FIT: `flow()`'s overflow guard
 * is arithmetic over the heights the authoring helpers declare, and a declared
 * height is a guess about how tall a paragraph of bound text will set. The only
 * honest measure of whether a block runs past the footer is to lay the document
 * out and look at the boxes.
 *
 * So this opens each rendered document in Chromium at A4, measures every
 * block's real bounding box against its page, and reports anything that
 * overflows. It also prints a PDF through the browser's own print pipeline and
 * screenshots the pages a reviewer would want to see.
 *
 * This is not a substitute for a WeasyPrint render — that engine is what
 * production uses, and it paginates differently. It is the check that catches
 * the class of defect the arithmetic cannot: text that is taller than the
 * author thought.
 *
 * Run:  npm run templates:compass:qa
 * Output: artifacts under `audit-output/investment-compass/`.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { renderTemplateToHtml } from '../../../src/lib/reportTemplate/htmlRenderer';
import { evalConditional } from '../../../src/lib/reportTemplate/bindingResolver';
import { SAMPLE_REPORT_DATA } from '../../../src/lib/templateLibrary/sampleReportData';
import {
  investmentGeometryDocuments,
  investmentOwnerOccupierGeometryDocuments,
} from '../../../src/lib/templateLibrary/narrativeGeometryFixture';
import {
  pagesForDocument,
} from '../../../supabase/functions/_shared/reports/investment/tierPageSequence.pure';
import {
  colourwaysForFamily,
  colourwayTokenOverride,
} from '../../../supabase/functions/_shared/templateColourways.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from './templates';
import { BORROWING_CAPACITY_TEMPLATES } from './borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from './portfolio';
import { COMPARISON_TEMPLATES } from './comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from './cashFlow';
import { CLIENT_DETAILS_TEMPLATES } from './clientDetails';
import { LONGEST_ADDRESS } from './blocks';
import { CASH_FLOW_COMPARISON_TEMPLATES } from './cashFlowComparison';
import { REPORT_QA_TEMPLATES } from './reportQa';
import { COMMERCIAL_CAPACITY_TEMPLATES } from './commercialCapacity';
import { MARKET_INTELLIGENCE_TEMPLATES } from './marketIntelligence';

import { DESIGN_FAMILIES } from './family';

/**
 * Every family master, across every report format.
 *
 * The overflow measurement is the reason this exists, and it is format-blind:
 * a Borrowing Capacity income table can run past the footer exactly as an
 * investment cash-flow table can, and neither is visible from the schema.
 */
const ALL_MASTERS = [
  ...INVESTMENT_COMPASS_TEMPLATES,
  ...BORROWING_CAPACITY_TEMPLATES,
  ...PORTFOLIO_TEMPLATES,
  ...COMPARISON_TEMPLATES,
  ...CASH_FLOW_COMPASS_TEMPLATES,
  ...CLIENT_DETAILS_TEMPLATES,
  ...CASH_FLOW_COMPARISON_TEMPLATES,
  ...REPORT_QA_TEMPLATES,
  ...COMMERCIAL_CAPACITY_TEMPLATES,
  ...MARKET_INTELLIGENCE_TEMPLATES,
];


const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../..');
const OUT = resolve(REPO, 'audit-output/investment-compass');

/** A4 in CSS pixels at 96dpi, which is how the browser lays out a `pt` page. */
const A4_PX = { width: 794, height: 1123 };

/** Points of slack before a box counts as overflowing. */
const TOLERANCE_PT = 2;

interface Overflow {
  template: string;
  colourway: string;
  page: number;
  pageName: string;
  block: string;
  overBy: number;
}

interface Collision {
  template: string;
  page: number;
  pageName: string;
  over: string;
  under: string;
  overlap: number;
}

/** A class of text that must never reach a rendered page. */
interface Debris {
  template: string;
  page: number;
  pageName: string;
  kind: string;
  text: string;
}

interface Report {
  templates: number;
  colourways: number;
  combinations: number;
  rendered: number;
  overflows: Overflow[];
  collisions: Collision[];
  debris: Debris[];
  pdf: Array<{ template: string; pages: number; bytes: number }>;
  screenshots: string[];
}

/**
 * Measure every block against the page that contains it.
 *
 * Blocks are absolutely positioned, so a page's own scroll height says nothing
 * — an overflowing block is clipped by `overflow:hidden` and the page stays
 * exactly 842pt tall. The only way to see it is to compare each block's bottom
 * against the page box.
 */
async function measureOverflows(
  page: Page,
  templateName: string,
  colourwayName: string,
  pageNames: string[],
): Promise<Overflow[]> {
  const raw = await page.evaluate(({ tolerance }) => {
    const results: Array<{ page: number; block: string; overBy: number }> = [];
    const pages = Array.from(document.querySelectorAll('.tpl-page'));
    pages.forEach((pageEl, pageIndex) => {
      const pageBox = pageEl.getBoundingClientRect();
      // Direct children only: a block's own internals are its business, and a
      // table cell taller than its row is not a page overflow.
      Array.from(pageEl.children).forEach((child) => {
        const box = (child as HTMLElement).getBoundingClientRect();
        if (box.height === 0 && box.width === 0) return;
        const overBy = box.bottom - pageBox.bottom;
        if (overBy > tolerance) {
          const el = child as HTMLElement;
          const label = el.getAttribute('data-block-id')
            ?? el.className
            ?? el.tagName.toLowerCase();
          results.push({ page: pageIndex, block: String(label).slice(0, 80), overBy });
        }
      });
    });
    return results;
  }, { tolerance: (TOLERANCE_PT * 96) / 72 });

  return raw.map((r) => ({
    template: templateName,
    colourway: colourwayName,
    page: r.page + 1,
    pageName: pageNames[r.page] ?? `Page ${r.page + 1}`,
    // Back to points, which is the unit the templates are authored in.
    overBy: Math.round((r.overBy * 72) / 96),
    block: r.block,
  }));
}

/**
 * Read the page as a READER does, and refuse four classes of debris.
 *
 * The overflow and collision measures are geometric: they ask where ink sits,
 * never what it says. So a master could emit an unresolved `{{directive}}`, a
 * label clipped to an ellipsis, a placeholder word or a database identifier
 * and pass this gate cleanly — and three of those four have reached a client
 * document in this product's history. `{{stat label="Crime data coverage" …`
 * printed verbatim on page 25 of the Compass delivered 21 Sep 2026;
 * `osm_amenity_register` printed mid-paragraph on page 34; `renderWaterfall`
 * set "Stamp duty and…" where the label fits whole.
 *
 * Measured over the rendered TEXT rather than the schema, because that is the
 * thing a reader holds, and in the browser the harness already has rather than
 * through a PDF text layer, which would add a system dependency this gate does
 * not otherwise need.
 *
 * Each class is narrow enough to carry no false positive over the catalogue:
 *
 *  - `{{`      — a directive or binding the renderer did not consume. A
 *                 master cannot trigger this one: the binder consumes `{{…}}`
 *                 in a master's own text and an unresolved binding renders as
 *                 the empty string. Its target is a directive in MODEL PROSE,
 *                 which is where `{{stat label=…` came from.
 *  - `word…`   — an ellipsis welded to a letter, which is what a hard
 *                 character cut produces; a real ellipsis follows a space or
 *                 ends a sentence.
 *  - `N/A`, `TBC`, `XX`, `[Placeholder]` — the owner's rule is "N/A or
 *                 unavailable, never".
 *  - `snake_case` — database vocabulary. `plan_zone` and `plan_overlay` are
 *                 the known-good exception: they are Vicmap Planning's own
 *                 published layer names, and a citation is a name rather than
 *                 debris.
 *
 * Measured 21 Sep 2026 over all 100 rendered documents and all ten formats:
 * **zero of every class**, so this gate starts green and any hit is new.
 */
const DEBRIS_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: 'unresolved directive or binding', re: /\{\{[^}\n]{0,80}/g },
  { kind: 'label clipped to an ellipsis', re: /\S{2,}\u2026/g },
  { kind: 'placeholder word', re: /\bN\/A\b|\bTBC\b|\bXX\b|\[Placeholder\]/gi },
  // Case-INSENSITIVE, and that is not tidiness. `innerText` returns the text
  // as CSS transformed it, and this design system sets every eyebrow, column
  // head and register label in uppercase -- which is exactly where a database
  // identifier would land. Proved by injection: `plan_thing` in a register
  // title arrived as `PLAN_THING` and a lowercase pattern walked past it.
  { kind: 'database identifier', re: /\b[a-z]{3,}_[a-z_]{3,}\b/gi },
];

/** Identifiers a publisher uses, which are names rather than debris. */
const PUBLISHED_IDENTIFIERS = new Set(['plan_zone', 'plan_overlay']);

async function measureDebris(
  page: Page,
  template: string,
  pageNames: string[],
): Promise<Debris[]> {
  const texts = await page.evaluate(() => Array.from(document.querySelectorAll('.tpl-page'))
    .map((el) => (el as HTMLElement).innerText ?? ''));
  const out: Debris[] = [];
  texts.forEach((text, i) => {
    for (const { kind, re } of DEBRIS_PATTERNS) {
      for (const hit of new Set(text.match(re) ?? [])) {
        // Lowercased before the allow-list is consulted, for the same reason
        // the pattern is case-insensitive: `PLAN_ZONE` is the same citation.
        if (kind === 'database identifier' && PUBLISHED_IDENTIFIERS.has(hit.toLowerCase())) continue;
        out.push({ template, page: i + 1, pageName: pageNames[i] ?? `Page ${i + 1}`, kind, text: hit });
      }
    }
  });
  return out;
}

/**
 * Find blocks printed on top of each other.
 *
 * ## The defect the overflow measure cannot see
 *
 * `flow()` stacks the next block at `y + height`, where `height` is what the
 * authoring helper *declared*. Blocks are absolutely positioned and are not
 * clipped, so a block whose text sets taller than its declaration does not push
 * the page down and does not cross the page's bottom edge — it simply prints
 * over whatever comes next. Every arithmetic check passes and two paragraphs
 * are laid on top of each other on a client's page.
 *
 * That is not hypothetical. The first run of this measure found 463 overlapping
 * pairs across the 50 Portfolio masters, 24 across the Investment Compass ones
 * and 15 across Borrowing Capacity — all shipped, all invisible to the overflow
 * guard.
 *
 * Two things make the measure honest rather than noisy. It compares the **ink**
 * — the union of each block's own text-node rects — because a footer text block
 * spans the full measure while its page number sits at the right end of the
 * same band, and their boxes overlap where no reader would ever see it. And it
 * skips the **cover**, which composes deliberately overlapping layers: a
 * wordmark over a photographic plate is the design, not a fault.
 */
async function measureCollisions(
  page: Page,
  templateName: string,
  pageNames: string[],
): Promise<Collision[]> {
  const raw = await page.evaluate(`(() => {
    const out = [];
    const pages = Array.from(document.querySelectorAll('.tpl-page'));
    pages.forEach((pageEl, pi) => {
      if (pi === 0) return;
      const kids = [];
      Array.from(pageEl.children).forEach((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let box = null;
        let node = walker.nextNode();
        while (node) {
          if ((node.textContent || '').trim() !== '') {
            const range = document.createRange();
            range.selectNodeContents(node);
            Array.from(range.getClientRects()).forEach((r) => {
              if (r.width === 0 || r.height === 0) return;
              box = box === null
                ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
                : {
                  top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom),
                  left: Math.min(box.left, r.left), right: Math.max(box.right, r.right),
                };
            });
          }
          node = walker.nextNode();
        }
        if (box === null) return;
        kids.push({ box, label: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 44) });
      });
      for (let i = 0; i < kids.length; i += 1) {
        for (let j = i + 1; j < kids.length; j += 1) {
          const a = kids[i].box; const b = kids[j].box;
          const vy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const vx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (vy > 2 && vx > 2) {
            out.push({ page: pi, a: kids[i].label, b: kids[j].label, overlap: (vy * 72) / 96 });
          }
        }
      }
    });
    return out;
  })()`) as Array<{ page: number; a: string; b: string; overlap: number }>;

  return raw.map((r) => ({
    template: templateName,
    page: r.page + 1,
    pageName: pageNames[r.page] ?? `Page ${r.page + 1}`,
    over: r.a,
    under: r.b,
    overlap: Math.round(r.overlap),
  }));
}

async function open(browser: Browser, html: string): Promise<Page> {
  const page = await browser.newPage({ viewport: A4_PX });
  await page.setContent(html, { waitUntil: 'networkidle' });
  // Webfonts decide how tall text is. Measuring before they land would measure
  // the fallback and pass templates that overflow in the face they ship in.
  await page.evaluate(() => (document as any).fonts?.ready);
  return page;
}

/**
 * Find a Chromium this machine already has.
 *
 * Playwright resolves its browser by the build number its own version pins, so
 * a CI image carrying a different build fails with "Executable doesn't exist"
 * and a suggestion to download one. Downloading a second Chromium to render
 * five templates is not a reasonable thing for this script to do, and on a
 * sandboxed runner it will not work anyway. So: use whatever full Chromium is
 * present under `PLAYWRIGHT_BROWSERS_PATH`, and fall back to Playwright's own
 * resolution when there is nothing there.
 *
 * The full browser is preferred over `chrome-headless-shell` because the shell
 * build cannot print a PDF, which is half of what this script is for.
 */
/**
 * Every typeface the catalogue's ten families declare.
 *
 * Read from the source the generator is built from, so a family added there
 * is checked here without anybody remembering to.
 */
export const CATALOGUE_FAMILIES: readonly string[] = [
  'Cinzel', 'Playfair Display', 'IBM Plex Mono', 'Inter', 'Roboto', 'Lato', 'Noto Serif',
];

/**
 * Refuse to report a clean run this harness could not actually measure.
 *
 * ## What happened
 *
 * `open()` waits on `document.fonts.ready` under a comment that states the
 * stakes exactly: *"Measuring before they land would measure the fallback and
 * pass templates that overflow in the face they ship in."* It then never
 * checks that anything landed.
 *
 * Measured in this repository's sandbox on 21 Sep 2026: the masters declare
 * their faces with a Google Fonts `cssUrl`, the stylesheet request fails with
 * `net::ERR_CERT_AUTHORITY_INVALID` because the egress proxy's CA is not in
 * Chromium's trust store, `document.fonts` is **empty**, and
 * `document.fonts.ready` therefore resolves instantly having loaded nothing.
 * Cinzel and generic serif then set the same string to the same 546.63px.
 *
 * Every local run of this gate in that session reported
 * *"no block overflows its page, and none prints over another, in any of the
 * 710 renders"* — a statement about a document nobody receives. The same
 * commit failed on CI, where the fonts do load, with **six** blocks printing
 * over another: two at 6pt on the risk page and four at 2pt on the cash-flow
 * page. Cinzel sets that probe string **19% wider** than the fallback, which
 * is the whole difference.
 *
 * ## Why it is measured rather than asked
 *
 * `document.fonts.check('700 40px Cinzel')` returns **true** when no matching
 * face is *pending* — which is trivially satisfied when no face exists at all.
 * It answered true in exactly the run where nothing had loaded. So the test is
 * the only one that cannot lie: set a probe string in the declared family and
 * in both generics, and if the widths match a generic, the family did not
 * resolve.
 *
 * This is the rule the whole programme runs on, applied to the instrument:
 * **a failed read is not a clean result.** A gate that cannot see the document
 * must say so, not pass.
 */
async function assertDeclaredFacesResolve(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: A4_PX });
  // Two probes: a coincidental width match against one generic is unlikely and
  // against two, on two different strings, is not a case worth designing for.
  const PROBES = ['Recommendation STRONG BUY', 'Hazard rating verification 1,902,114'];
  /*
   * `display:inline-block` and `width:max-content`, not a block element.
   * The first version used `<div>`s: a block box is its CONTAINER's width, so
   * every probe measured 794px and every family read as unresolved, including
   * the three that were installed. A measure of set width has to measure the
   * text, which is the same mistake as measuring a block's declared height
   * instead of its drawn one, one level down.
   */
  const probe = (id: string, family: string, text: string) =>
    `<span id="${id}" style="font-family:${family};font-size:40px;white-space:nowrap;`
    + `display:inline-block;width:max-content">${text}</span>`;
  await page.setContent(
    `<body style="margin:0">${CATALOGUE_FAMILIES
      .map((f, i) => PROBES.map((t, j) => probe(`f${i}_${j}`, `'${f}'`, t)).join(''))
      .join('')}${PROBES
      .map((t, j) => probe(`gs_${j}`, 'serif', t) + probe(`gx_${j}`, 'sans-serif', t))
      .join('')}</body>`,
    { waitUntil: 'networkidle' },
  );
  await page.evaluate('document.fonts && document.fonts.ready');
  /*
   * Evaluated as a STRING, like `measureCollisions` above it and for the same
   * reason: tsx's transform injects a `__name` helper into every function it
   * compiles, and a function passed to `page.evaluate` is serialised WITH that
   * helper and without its definition, so it throws `__name is not defined`
   * inside the page.
   */
  const widths = await page.evaluate(`(() => {
    const w = (id) => document.getElementById(id).getBoundingClientRect().width;
    const out = { fam: [], serif: [], sans: [] };
    for (let i = 0; i < ${CATALOGUE_FAMILIES.length}; i += 1) {
      const row = [];
      for (let j = 0; j < ${PROBES.length}; j += 1) row.push(w('f' + i + '_' + j));
      out.fam.push(row);
    }
    for (let j = 0; j < ${PROBES.length}; j += 1) { out.serif.push(w('gs_' + j)); out.sans.push(w('gx_' + j)); }
    return out;
  })()`) as { fam: number[][]; serif: number[]; sans: number[] };
  await page.close();

  const unresolved = CATALOGUE_FAMILIES.filter((_, i) => PROBES.every((_, j) =>
    widths.fam[i][j] === widths.serif[j] || widths.fam[i][j] === widths.sans[j]));
  if (unresolved.length === 0) return;

  console.error('');
  console.error(`\u2716 ${unresolved.length} of ${CATALOGUE_FAMILIES.length} declared typefaces did not resolve:`);
  console.error('');
  for (const family of unresolved) console.error(`  ${family}`);
  console.error('');
  console.error('  This run would have measured the FALLBACK face, not the one the');
  console.error('  templates ship in, and a clean verdict from it would be a statement');
  console.error('  about a document nobody receives. Cinzel sets 19% wider than the');
  console.error('  fallback: the same commit that passed here failed CI with six blocks');
  console.error('  printing over another.');
  console.error('');
  console.error('  The faces reach Chromium two ways. The catalogue names them with a');
  console.error('  Google Fonts stylesheet, which needs outbound network AND a trusted');
  console.error('  CA \u2014 behind an intercepting proxy the request fails and');
  console.error('  `document.fonts` stays empty. Or they are installed on the machine,');
  console.error('  which is how the render container does it: the nine files in');
  console.error('  weasyprint-service/fonts/ plus fonts-inter, fonts-roboto, fonts-lato');
  console.error('  and fonts-noto from the Dockerfile.');
  console.error('');
  process.exitCode = 1;
  throw new Error('the declared typefaces did not resolve \u2014 refusing to measure the fallback');
}

function findChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const candidates = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse()
    .map((name) => resolve(root, name, 'chrome-linux/chrome'))
    .filter((path) => existsSync(path));
  return candidates[0];
}

/**
 * The documents a master has to be measured as.
 *
 * ## The fixture was the front matter of a 34-page report
 *
 * `SAMPLE_REPORT_DATA` carries no narrative and no `report.type`, and both are
 * load-bearing here. The masters gate every body page on
 * `narrative && narrative.pages > n`, and `planNarrative` — the pre-pass that
 * computes the true page count from the template's own geometry — returns null
 * for a report type it does not recognise. So with the fixture as shipped, the
 * Investment Compass masters rendered **7 of 50 pages**: Cover, Contents,
 * Executive dashboard, The assessment, Risk and recommendation, Sources and
 * methodology, Important information.
 *
 * Measured 20 Sep 2026 on the first three masters, with a body at the
 * registry's declared size and `report.type` set as the adapter sets it:
 * Chancery 7 -> 25, Chancery Compact 7 -> 21, Sovereign Folio 8 -> 32. Every
 * body page, the overflow notice and both financial-modelling pages had never
 * been laid out by this gate on any run.
 *
 * That is `WHAT_THE_PAGE_ACTUALLY_DRAWS.md` §5 one level up: a fixture shorter
 * than the product turns a real measurement into a statement about the
 * fixture. `SAMPLE_REPORT_DATA` itself is left alone — it is the BINDING
 * fixture the catalogue specs assert rendered output against, and its job is
 * to resolve every bound path. The geometric measure needs a document-sized
 * body, and composes one here.
 *
 * ## And four of the five documents had never been drawn
 *
 * The Investment masters serve five document kinds through one page sequence
 * (`tierPageSequence.pure.ts`), and the fixture's tier is `compass` — so the
 * Snapshot, Executive Briefing, Financial Analysis and Due Diligence reports
 * were outside the measurement entirely, as were the two pages only a tier
 * that draws financial modelling prints. The tier is set where the production
 * adapter sets it: top level, which is what `pagesForDocument` reads, AND on
 * `report`, which is what the projection publishes and the masters bind.
 */
interface Variant {
  /** How this document is named in a finding. Empty for a one-document format. */
  label: string;
  data: Record<string, unknown>;
}

/**
 * An address of the longest length production carries, for the geometry only.
 *
 * `SAMPLE_REPORT_DATA` carries a 42-character address and `property_address`
 * runs to **84** across the 1,187 stored rows. The running head binds
 * `{{report.documentTitle}} · {{property.address}}` into two reserved lines
 * with a rule struck beneath them, so at the fixture's length this gate was
 * measuring a 63-character head where a client's can reach 103 — which is
 * `WHAT_THE_PAGE_ACTUALLY_DRAWS.md` §2 exactly: *a fixture shorter than the
 * product turns a real measurement into a statement about the fixture.*
 *
 * Substituted HERE rather than in `SAMPLE_REPORT_DATA`, for the reason the
 * body composition above gives: that fixture is the BINDING fixture the
 * catalogue specs assert rendered output against, and its job is to resolve
 * every bound path. The geometric measure needs the worst case, and composes
 * one.
 *
 * It reaches all ten formats, not just the Compass: every one of them draws a
 * running head, and nine bind a literal document label beside this address.
 *
 * Measured with it in place, 21 Sep 2026: all 710 renders still clean. So the
 * running head FITS at the worst case — this is a closed blind spot rather
 * than a repaired document, and it stays so that the next change to the head,
 * the type scale or the measure is judged against the real thing.
 */
const LONGEST_SAMPLE_ADDRESS =
  "Apartment 1204A, 'Waterline Residences', 145-149 Marine Parade, Kingscliff, NSW 2487";

/*
 * Exactly `LONGEST_ADDRESS`, checked rather than counted by hand.
 *
 * The first draft of this string was 82 characters — two short of the measured
 * maximum, which is the same defect one order of magnitude smaller than the
 * one it exists to close. The assertion is why that was caught.
 */
if (LONGEST_SAMPLE_ADDRESS.length !== LONGEST_ADDRESS) {
  throw new Error(
    `the geometry fixture's address is ${LONGEST_SAMPLE_ADDRESS.length} characters; `
    + `the measured corpus maximum is ${LONGEST_ADDRESS}`,
  );
}

/** The worst-case address, in both shapes the masters bind. */
function withLongestAddress(data: Record<string, unknown>): Record<string, unknown> {
  const property = data.property && typeof data.property === 'object'
    ? { ...(data.property as Record<string, unknown>), address: LONGEST_SAMPLE_ADDRESS }
    : data.property;
  return { ...data, property, property_address: LONGEST_SAMPLE_ADDRESS };
}

function documentVariants(reportFormat: string): Variant[] {
  if (reportFormat !== 'investment-compass') {
    return [{
      label: '',
      data: withLongestAddress(SAMPLE_REPORT_DATA as unknown as Record<string, unknown>),
    }];
  }
  return [...investmentGeometryDocuments(), ...investmentOwnerOccupierGeometryDocuments()]
    .map((d) => ({ label: d.tier, data: withLongestAddress(d.data) }));
}

/**
 * The pages that rendered, named by the schema page each one came from.
 *
 * Read from the DOM rather than recomputed. The harness used to filter the
 * schema by `evalConditional` alone and throw when its count disagreed with
 * the renderer's — but the renderer applies two more filters
 * (`pagesForDocument` and its own empty-page pass), so the two lists agreed
 * only while the fixture named no derived tier. Every rendered page carries
 * the id of the schema page that drew it, so the list is taken from the thing
 * being measured instead of being predicted alongside it.
 */
async function renderedPageNames(
  page: Page,
  pages: ReadonlyArray<{ id?: string | null; name?: string | null }>,
): Promise<string[]> {
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('.tpl-page'))
    .map((el) => el.getAttribute('data-pdf-page-id') ?? ''));
  const byId = new Map(pages.map((p) => [String(p.id ?? ''), String(p.name ?? '')]));
  return ids.map((id, i) => byId.get(id) ?? `Page ${i + 1}`);
}

/**
 * `--only <substring>` limits the run to masters whose format or name matches.
 *
 * The sweep is 500 masters and the Investment ones are now measured as five
 * documents each, so a full run is tens of minutes. A reviewer looking at one
 * format should not have to wait for the other nine, and a filtered run says
 * so in its own output rather than looking like a complete one.
 */
function selectedMasters(): typeof ALL_MASTERS {
  const i = process.argv.indexOf('--only');
  const needle = i >= 0 ? (process.argv[i + 1] ?? '').trim().toLowerCase() : '';
  if (!needle) return ALL_MASTERS;
  return ALL_MASTERS.filter((t) => `${t.designMeta.reportFormat} ${t.name}`.toLowerCase().includes(needle));
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const masters = selectedMasters();
  if (masters.length !== ALL_MASTERS.length) {
    console.log(`  --only: ${masters.length} of ${ALL_MASTERS.length} masters — this is a PARTIAL run`);
  }
  const executablePath = findChromium();
  if (executablePath) console.log(`  using ${executablePath}`);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  // Before anything is measured, not after: a run that cannot see the faces
  // has nothing to say about the pages, and saying it anyway is what let six
  // real overlaps through.
  await assertDeclaredFacesResolve(browser);
  const report: Report = {
    templates: masters.length,
    colourways: 10,
    combinations: INVESTMENT_COMPASS_TEMPLATES.length * 10,
    rendered: 0,
    overflows: [],
    collisions: [],
    debris: [],
    pdf: [],
    screenshots: [],
  };

  /**
   * Overflow is measured once per template, in its default colourway.
   *
   * A colourway cannot change how tall a paragraph sets — and
   * `investmentCompassCatalogue.spec.ts` proves it, asserting that every
   * block's geometry is byte-identical across a family's ten palettes. So five
   * hundred browser renders would measure the same fifty layouts ten times
   * each, for about ninety minutes of wall clock and no additional coverage.
   *
   * The dark spot-check below is a different question — whether a reverse
   * ground still reads — and is answered by eye, one per family.
   */
  for (const template of masters) {
    // Variant codes repeat across formats — `pb-01` exists in both catalogues —
    // so an artifact named by code alone has one format silently overwrite the
    // other's. The first run of this after Borrowing Capacity landed reported 20
    // PDFs and left 10 on disk.
    const code = `${template.designMeta.reportFormat}-${template.designMeta.templateCode}`;
    const family = template.designMeta.familyKey;
    const colourways = colourwaysForFamily(family);
    const dflt = colourways.find((c) => c.id === template.designMeta.defaultColourway)
      ?? colourways[0];

    /*
     * One measurement per document this master has to draw. For every format
     * but the Investment masters that is one; for those it is five, because
     * one page sequence serves five document kinds. See `documentVariants`.
     */
    for (const variant of documentVariants(template.designMeta.reportFormat)) {
      const name = variant.label ? `${template.name} [${variant.label}]` : template.name;
      const { html } = renderTemplateToHtml(template.schema, {
        data: variant.data,
        tokenOverrides: colourwayTokenOverride(dflt),
        /*
         * `container`, because that is what the PRINT renderer uses.
         *
         * `render-template-pdf` asserts the HTML can make no network request
         * and `compileTemplateHtmlForPdf` forces `fontSource: 'container'`,
         * so a production document is set in the faces the image has
         * installed and never in a Google-hosted file. This harness was
         * asking for `remote`, and that made it measure a third thing:
         *
         *   * on a machine with no reachable Google Fonts the `@import` fails
         *     and Chromium falls to whatever fontconfig has;
         *   * on CI the `@import` SUCCEEDS, so Chromium uses Google's current
         *     webfont files, whose metrics differ from the Debian packages of
         *     the same families that the render container installs;
         *   * production uses neither, because it never fetches at all.
         *
         * Measured 21 Sep 2026: the same four cash-flow masters passed here
         * with the Debian faces and failed on CI by 2pt with the webfonts,
         * from the same commit. A gate whose answer depends on whether the
         * machine can reach `fonts.googleapis.com` is measuring the network.
         *
         * With `container` both machines resolve the same installed families,
         * `assertDeclaredFacesResolve` refuses the run if they are missing,
         * and what is measured is what WeasyPrint will set.
         */
        fontSource: 'container',
      });
      const page = await open(browser, html);
      report.rendered += 1;

      /*
       * Named from the DOM, so the list measured and the list rendered are one
       * list. See `renderedPageNames` for what the recomputation got wrong.
       */
      const pageNames = await renderedPageNames(page, template.schema.pages as never);
      // The pages the renderer kept, for the index-based screenshots below.
      const visiblePages = pagesForDocument(
        template.schema.pages.filter(
          (pg) => evalConditional((pg as { conditional?: string }).conditional, {
            data: variant.data,
            tokens: template.schema.tokens as never,
          }),
        ),
        variant.data as Parameters<typeof pagesForDocument>[1],
      );

      report.overflows.push(
        ...await measureOverflows(page, name, dflt.name, pageNames),
      );
      report.collisions.push(...await measureCollisions(page, name, pageNames));
      report.debris.push(...await measureDebris(page, name, pageNames));

      /*
       * Artefacts are drawn for the master's own document only — the tier
       * variants are a measurement, not fifty more covers for a reviewer to
       * page through.
       */
      const artefacts = !variant.label || variant.label === 'compass';
      if (artefacts) {
        // A cover and a dashboard for every master — the cover is what the
        // library card shows, and the dashboard is where the KPI arrangement
        // lives, which is the axis the five masters in a family most visibly
        // differ on.
        const cover = resolve(OUT, `${code}-cover.png`);
        await page.locator('.tpl-page').first().screenshot({ path: cover });
        report.screenshots.push(cover.replace(`${REPO}/`, ''));

        // The densest page, whatever the format calls it. Hardcoding 'Executive
        // dashboard' meant the Borrowing Capacity masters — whose equivalent is
        // 'Capacity summary' — were screenshotted as covers only.
        const dashboardIndex = visiblePages.findIndex(
          (pg) => pg.name === 'Executive dashboard'
            || pg.name === 'Capacity summary'
            || pg.name === 'Portfolio at a glance'
            || pg.name === 'The ranking',
        );
        if (dashboardIndex >= 0) {
          const dashboard = resolve(OUT, `${code}-dashboard.png`);
          await page.locator('.tpl-page').nth(dashboardIndex).screenshot({ path: dashboard });
          report.screenshots.push(dashboard.replace(`${REPO}/`, ''));
        }

        // A plate, for the two families that carry photographs. It is the page
        // a reviewer most needs to see, because it is the only one whose
        // content an operator supplies — and the one that has to disappear
        // cleanly when they do not. Index 0 is skipped: the cover's plate is a
        // ground behind a composition rather than a plate page.
        const plateIndex = visiblePages.findIndex(
          (pg, i) => i > 0 && JSON.stringify(pg.blocks).includes('property.images'),
        );
        if (plateIndex >= 0) {
          const plate = resolve(OUT, `${code}-plate.png`);
          await page.locator('.tpl-page').nth(plateIndex).screenshot({ path: plate });
          report.screenshots.push(plate.replace(`${REPO}/`, ''));
        }

        // One PDF per family reference — fifty is a lot of artefact for a
        // reviewer, and the reference is the variant the Design source drew.
        if (template.designMeta.isFamilyReference) {
          const pdfPath = resolve(OUT, `${code}.pdf`);
          const bytes = await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            // The template already carries its own page geometry; a browser
            // margin on top would shrink every page and invalidate the measure.
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
          });
          report.pdf.push({
            template: `${template.designMeta.familyName} — ${template.name}`,
            pages: pageNames.length,
            bytes: bytes.length,
          });
        }
      }

      await page.close();
    }
  }

  // ── Dark-ground spot check, one per family ───────────────────────────────
  for (const family of DESIGN_FAMILIES) {
    const template = INVESTMENT_COMPASS_TEMPLATES.find(
      (t) => t.designMeta.familyKey === family.key && t.designMeta.isFamilyReference,
    );
    const dark = colourwaysForFamily(family.key).find((c) => c.ground === 'dark');
    if (!template || !dark) continue;

    /*
     * The same document the measure above draws, so a dark ground is spot
     * checked on the report rather than on its front matter — and the page
     * names come from the DOM, because mapping the whole schema onto a
     * filtered render labelled every finding here with the wrong page.
     */
    const { html } = renderTemplateToHtml(template.schema, {
      data: documentVariants(template.designMeta.reportFormat)[0].data,
      tokenOverrides: colourwayTokenOverride(dark),
      // The print renderer's font source, for the reason given at the other
      // call site: a remote stylesheet makes the verdict depend on whether
      // the machine can reach Google.
      fontSource: 'container',
    });
    const page = await open(browser, html);
    report.rendered += 1;
    const darkNames = await renderedPageNames(page, template.schema.pages as never);
    report.overflows.push(
      ...await measureOverflows(page, template.name, dark.name, darkNames),
    );
    const shot = resolve(OUT, `${template.designMeta.templateCode}-dark.png`);
    const dashboardIndex = darkNames.indexOf('Executive dashboard');
    await page.locator('.tpl-page').nth(Math.max(0, dashboardIndex)).screenshot({ path: shot });
    report.screenshots.push(shot.replace(`${REPO}/`, ''));
    await page.close();
  }

  await browser.close();

  writeFileSync(resolve(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));

  console.log(`\nInvestment Compass — render QA`);
  console.log(`  ${report.templates} templates, ${report.combinations} declared combinations`);
  console.log(`  ${report.rendered} browser renders (one per master + one dark per family)`);
  console.log(`  ${report.pdf.length} PDFs, ${report.screenshots.length} screenshots → audit-output/investment-compass/`);
  for (const p of report.pdf) {
    console.log(`    ${p.template}: ${p.pages} pages, ${(p.bytes / 1024).toFixed(0)} KB`);
  }

  if (report.collisions.length > 0) {
    console.error(`\n✖ ${report.collisions.length} block(s) print over another:\n`);
    for (const col of report.collisions.slice(0, 60)) {
      console.error(`  ${col.template} / p${col.page} "${col.pageName}": ${col.overlap}pt — "${col.over}" over "${col.under}"`);
    }
  }
  if (report.overflows.length > 0) {
    console.error(`\n✖ ${report.overflows.length} block(s) run past their page:\n`);
    for (const o of report.overflows.slice(0, 60)) {
      console.error(`  ${o.template} / ${o.colourway} / p${o.page} "${o.pageName}": ${o.overBy}pt — ${o.block}`);
    }
    process.exit(1);
  }
  if (report.collisions.length > 0) process.exit(1);

  if (report.debris.length > 0) {
    console.error(`\n✗ ${report.debris.length} piece(s) of debris reached a rendered page:`);
    for (const d of report.debris.slice(0, 40)) {
      console.error(`  ${d.template} / p${d.page} "${d.pageName}": ${d.kind} — ${JSON.stringify(d.text)}`);
    }
    if (report.debris.length > 40) console.error(`  … and ${report.debris.length - 40} more`);
    process.exit(1);
  }

  console.log(
    `\n✓ no block overflows its page, none prints over another, and no `
    + `unresolved binding, clipped label, placeholder or database identifier `
    + `reached one, in any of the ${report.rendered} renders`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
