/**
 * The specimen cards a brand design system is edited through.
 *
 * ## Why these exist
 *
 * Until now a design system was chosen from five dropdowns with a sentence of
 * hint under each, and shown as three swatches. `chapterStyle`, `tableStyle`,
 * `coverStyle`, `density` and `bodyScale` were picked blind — you found out
 * what `opener_band` meant by rendering a document.
 *
 * Each entry here is a **live specimen**: real `buildReportCss`, real
 * primitives, rendered into a sandboxed iframe by `BrandSpecimenCard`. Changing
 * `chapterStyle` visibly changes the Chapters card because it is the same code
 * path WeasyPrint takes. There is no second implementation of the design system
 * to drift from the first, which is the defect this codebase keeps finding.
 *
 * ## Shaped like a Claude Design card, deliberately
 *
 * A card in the published NPC Services Design System is a standalone HTML page
 * with a first-line directive:
 *
 *     <!-- @dsCard group="Report templates" viewport="1100x560"
 *          name="The five report voices" subtitle="Chancery / Broadsheet / …" -->
 *
 * followed by the specimen and a `.note` paragraph saying why the thing is the
 * way it is, with a mono `.tk` line carrying the tokens. The four fields below
 * — `group`, `name`, `subtitle`, `viewport` — are that directive, and `note`
 * and `tokenLine` are those two lines. The brand-systems page groups by `group`
 * exactly as the Design System pane does.
 *
 * ## Pure
 *
 * No React, no DOM, no colour of its own — `body()` takes a resolved palette
 * and returns HTML built from the kit. That is what lets a spec render every
 * specimen under every preset and assert the result is safe, which is the only
 * practical way to test eight iframes.
 *
 * A `.ts`, not a `.tsx`, for the same reason `formOptions.ts` is: the specimen
 * *content* is document data — a sample figure, a sample address — and
 * `scripts/audit-style-tokens.cjs` would otherwise count the palette values
 * that reach it as hardcoded colour in a component.
 */
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCover,
  renderDataTable,
  renderEyebrow,
  renderKpiStrip,
  renderLede,
  renderSidenote,
  type CalloutTone,
} from '@/lib/reportDesign/primitives.pure';
import { scaledType, type ReportDesignOptions } from '@/lib/reportDesign/options.pure';
import type { ResolvedReportPalette } from '@/lib/reportDesign/roles.pure';
import { auditPaletteContrast } from '@/lib/reportDesign/brandResolve.pure';

export interface BrandSpecimen {
  id: string;
  /** The pane section this sits under. Ordered by `SPECIMEN_GROUPS`. */
  group: string;
  name: string;
  subtitle: string;
  /** The card's own coordinate space, in px. Scaled to whatever width it gets. */
  viewport: { w: number; h: number };
  /** Why the thing is the way it is. The `.note` paragraph. */
  note: string;
  /** The mono `.tk` line — which options this card is actually showing. */
  tokenLine: (options: ReportDesignOptions) => string;
  body: (palette: ResolvedReportPalette, options: ReportDesignOptions) => string;
}

/** Reading order for the gallery. Anything unlisted sorts last, alphabetically. */
export const SPECIMEN_GROUPS = ['Paper & ink', 'Type', 'Accent', 'Chapters', 'Data', 'Cover'] as const;

/** Sample content. Fictional throughout — no specimen carries client data. */
const SAMPLE = {
  client: 'Harbour & Vale Advisory',
  address: '14 Ellery Parade',
  locality: 'Randwick NSW 2031',
  capacity: '$856,932',
  surplus: '$7,168/mo',
  rate: '9.44%',
} as const;

const swatch = (label: string, hex: string, ink: string) => `
  <div style="flex:1;min-width:88px">
    <div style="height:56px;border-radius:4px;background:${hex};border:1px solid ${ink}22"></div>
    <div style="margin-top:6px;font-size:8pt;letter-spacing:.14em;text-transform:uppercase;opacity:.72">${escapeHtml(label)}</div>
    <div style="font-size:8.5pt;font-variant-numeric:tabular-nums">${escapeHtml(hex)}</div>
  </div>`;

const row = (html: string) => `<div style="display:flex;gap:10px;align-items:flex-start">${html}</div>`;

/** The specimen table, used by both the Data card and the Chapters card. */
const SAMPLE_TABLE = () => renderDataTable(
  [
    { key: 'c0', label: 'Income component' },
    { key: 'c1', label: 'Gross per year', align: 'right' },
    { key: 'c2', label: 'Assessed', align: 'right' },
  ],
  [
    { c0: 'Salary — primary', c1: '$180,000', c2: '$180,000' },
    { c0: 'Rental — Ellery Parade', c1: '$42,000', c2: '$33,600' },
    { c0: 'Distributions', c1: '$11,000', c2: '$8,800' },
    { c0: 'Total', c1: '$233,000', c2: '$222,400', __total: true },
  ],
  { caption: 'Income, before and after shading', signedKeys: ['c1', 'c2'] },
);

export const BRAND_SPECIMENS: readonly BrandSpecimen[] = [
  {
    id: 'paper',
    group: 'Paper & ink',
    name: 'Paper and ink',
    subtitle: 'The seven grounds every page is built from',
    viewport: { w: 900, h: 250 },
    note: 'A preset supplies these seven, and an imported design system brings its own. '
      + 'The panel must be darker than the sheet or it disappears in print — on screen a '
      + 'lighter panel reads fine, on paper it is invisible.',
    tokenLine: (o) => `preset: ${o.preset}`,
    body: (p) => `
      ${renderEyebrow('Paper and ink')}
      ${row(
        swatch('paper', p.paper, p.bodyInk)
        + swatch('paperAlt', p.paperAlt, p.bodyInk)
        + swatch('paperBright', p.paperBright, p.bodyInk)
        + swatch('rule', p.rule, p.bodyInk),
      )}
      <div style="height:12px"></div>
      ${row(
        swatch('field', p.field, p.bodyInk)
        + swatch('bodyInk', p.bodyInk, p.bodyInk)
        + swatch('mutedInk', p.mutedInk, p.bodyInk)
        + `<div style="flex:1;min-width:88px">
             <div style="height:56px;border-radius:4px;background:${p.field};color:${p.onFieldInk};
                         display:flex;align-items:center;justify-content:center;font-size:9pt">
               Type on the field
             </div>
             <div style="margin-top:6px;font-size:8pt;letter-spacing:.14em;text-transform:uppercase;opacity:.72">onFieldInk</div>
             <div style="font-size:8.5pt">${escapeHtml(p.onFieldInk)}</div>
           </div>`,
      )}`,
  },

  {
    id: 'contrast',
    group: 'Paper & ink',
    name: 'Contrast',
    subtitle: 'Every ink role against every ground it prints on',
    viewport: { w: 900, h: 300 },
    note: 'The brand gold is 7.26:1 on obsidian and 2.10:1 on ivory. That asymmetry — not '
      + 'carelessness — is why this codebase accumulated eight different golds before the '
      + 'floors were made checkable. A system that fails here cannot be saved.',
    tokenLine: () => 'floor: 4.5:1 · WCAG 2.1',
    body: (p) => {
      const problems = auditPaletteContrast(p);
      const verdict = problems.length
        ? renderCallout(
          'negative',
          `${problems.length} role${problems.length === 1 ? '' : 's'} below the floor`,
          `<ul>${problems.slice(0, 6).map((x) =>
            `<li>${escapeHtml(x.role)} on ${escapeHtml(x.ground)} — `
            + `${x.ratio.toFixed(2)}:1 against ${x.floor.toFixed(1)}:1</li>`).join('')}</ul>`,
        )
        : renderCallout(
          'positive',
          'Every ink role clears its floor',
          '<p>On every ground it is legal to print on.</p>',
        );
      return `${renderEyebrow('Contrast')}${verdict}${renderDataTable(
        [
          { key: 'c0', label: 'Role' },
          { key: 'c1', label: 'On paper', align: 'right' },
          { key: 'c2', label: 'On the field', align: 'right' },
        ],
        [
          { c0: 'Accent', c1: p.accentOnPaper, c2: p.accentOnField },
          { c0: 'Body', c1: p.bodyInk, c2: p.onFieldInk },
          { c0: 'Muted', c1: p.mutedInk, c2: p.onFieldInk },
        ],
        {},
      )}`;
    },
  },

  {
    id: 'eyebrow',
    group: 'Type',
    name: 'The section eyebrow',
    subtitle: 'The strongest typographic signature of the brand',
    viewport: { w: 900, h: 260 },
    note: 'A wide uppercase eyebrow over a tight-tracked title is how every NPC surface '
      + 'announces itself, on screen and on paper. It is set in the accent corrected for the '
      + 'worst ground it can land on — at 8.5pt an uncorrected brand gold is unreadable.',
    tokenLine: (o) => `body ${o.bodyScale}% · section numbers ${o.showSectionNumbers ? 'on' : 'off'}`,
    body: (_p, o) => {
      const t = scaledType(o);
      return `
        ${renderChapterHeader({
          number: '02',
          title: 'Income and commitments',
          dek: 'Every income component with its shading, and every liability with its servicing.',
          label: 'Section',
        })}
        ${renderLede('The assessment was made on the household income and commitments recorded at application.')}
        <p>Body copy is set at ${t.body}pt. A caption sits at ${t.caption}pt and the eyebrow above at ${t.micro}pt.</p>`;
    },
  },

  {
    id: 'scale',
    group: 'Type',
    name: 'Body scale',
    subtitle: 'What the reader actually reads',
    viewport: { w: 900, h: 320 },
    note: 'Body size is a percentage of the print scale rather than a point size, so the '
      + 'whole ramp moves together and a heading never collides with its own standfirst. '
      + 'Density is the other half: it trades pages against breathing room, and spacious on '
      + 'a long report adds real pages.',
    tokenLine: (o) => `${o.bodyScale}% · ${o.density} · ${o.justifyText ? 'justified' : 'ragged'}`
      + `${o.showDropCaps ? ' · drop caps' : ''}`,
    body: () => `
      ${renderLede('A lede opens the chapter and is set larger than the body it introduces.')}
      <p>Capacity is assessed against a servicing buffer above the advertised rate, on the household
      income and commitments recorded at application. Shaded income is what the serviceability
      calculation uses; the gross figure is shown beside it so the shading is visible rather than
      implied.</p>
      <p>A second paragraph, so the gap between them is the one the density setting actually
      produces. ${SAMPLE.client} is fictional, as is every figure on this card.</p>
      ${renderSidenote('On shading', '<p>A lender counts some income at less than face value.</p>')}`,
  },

  {
    id: 'accent',
    group: 'Accent',
    name: 'Accent and tones',
    subtitle: 'Category A follows the brand; Category B never does',
    viewport: { w: 900, h: 360 },
    note: 'The accent is the one colour a tenant chooses, and its on-paper and on-field '
      + 'variants are re-derived per render rather than stored — a colour legible on one '
      + 'ground and illegible on another is the failure that produces. The five tones below '
      + 'are fixed by meaning: risk reads the same in a tenant’s report as in ours.',
    tokenLine: (o) => `visual intensity ${o.visualIntensity}%`,
    body: (p) => {
      const tones: Array<[CalloutTone, string, string]> = [
        ['positive', 'Headroom', 'Monthly surplus of ' + SAMPLE.surplus + ' after commitments.'],
        ['caution', 'Assumed', 'Rates hold at ' + SAMPLE.rate + ' for the term of the assessment.'],
        ['negative', 'Shortfall', 'The proposed loan exceeds the assessed limit.'],
        ['informative', 'Note', 'Figures are indicative and not an offer of finance.'],
        ['neutral', 'Method', 'Declared expenses, benchmarked against HEM.'],
      ];
      return `
        ${renderEyebrow('Accent')}
        ${row(
          swatch('accentFill', p.accentFill, p.bodyInk)
          + swatch('accentOnPaper', p.accentOnPaper, p.bodyInk)
          + swatch('accentOnField', p.accentOnField, p.bodyInk),
        )}
        ${tones.map(([tone, label, text]) =>
          renderCallout(tone, label, `<p>${escapeHtml(text)}</p>`)).join('')}`;
    },
  },

  {
    id: 'chapters',
    group: 'Chapters',
    name: 'Chapter openers',
    subtitle: 'classic · opener_band · minimal',
    viewport: { w: 900, h: 420 },
    note: 'How a chapter announces itself, and the only option here that changes the page '
      + 'rather than the type on it. The band variant carries the accent across the measure; '
      + 'minimal drops the rule entirely and lets the type do it.',
    tokenLine: (o) => `${o.chapterStyle} · numbers ${o.showSectionNumbers ? 'on' : 'off'}`,
    body: () => `
      ${openChapter('Borrowing Capacity Snapshot', '03', 'How the capacity is built')}
        ${renderChapterHeader({
          number: '03',
          title: 'How the capacity is built',
          dek: 'The arithmetic from gross income to maximum capacity.',
          label: 'Section',
        })}
        <div class="chapter-body">
          ${renderLede('Every figure below comes from the assessment, not from an estimate.')}
          ${renderKpiStrip([
            { label: 'Maximum capacity', value: SAMPLE.capacity },
            { label: 'Monthly surplus', value: SAMPLE.surplus, tone: 'positive' },
            { label: 'Assessment rate', value: SAMPLE.rate },
          ])}
        </div>
      ${closeChapter()}`,
  },

  {
    id: 'data',
    group: 'Data',
    name: 'Tables and KPIs',
    subtitle: 'classic · ledger · minimal',
    viewport: { w: 900, h: 400 },
    note: 'A financial table is the most-read thing in these documents, and the first column '
      + 'is a header cell rather than a plain one — that is what makes the table navigable in '
      + 'a tagged PDF. Negative figures take the one red the product uses, whatever the brand '
      + 'colour is.',
    tokenLine: (o) => `${o.tableStyle} · ${o.density}`,
    body: () => `
      ${renderKpiStrip([
        { label: 'Maximum capacity', value: SAMPLE.capacity },
        { label: 'Monthly surplus', value: SAMPLE.surplus, tone: 'positive' },
        { label: 'Existing commitments', value: '-$1,302/mo', tone: 'negative' },
        { label: 'Assessment rate', value: SAMPLE.rate },
      ])}
      ${SAMPLE_TABLE()}`,
  },

  {
    id: 'cover',
    group: 'Cover',
    name: 'Cover',
    subtitle: 'image · title_overlay · editorial',
    viewport: { w: 794, h: 1123 },
    note: 'A4 at 96dpi, so the proportions are the printed ones. The cover ground is one flat '
      + 'hex rather than a gradient: gradient stacks band on the PDF/A raster path, which is '
      + 'visible on a printed page and not on a screen.',
    tokenLine: (o) => `${o.coverStyle} · intensity ${o.visualIntensity}%`,
    body: (_p, _o) => renderCover({
      eyebrow: 'Borrowing Capacity Snapshot',
      title: SAMPLE.address,
      subtitle: SAMPLE.locality,
      masthead: SAMPLE.client,
      edition: 'SPECIMEN',
      meta: [
        { label: 'Prepared for', value: 'A. Client' },
        { label: 'Prepared on', value: '4 August 2026' },
        { label: 'Assessment rate', value: SAMPLE.rate },
      ],
      footerLeft: 'Private and confidential',
      footerRight: 'SPECIMEN',
    }),
  },
];

/** The specimens, grouped and ordered as the Design System pane groups its cards. */
export function specimensByGroup(): Array<{ group: string; specimens: BrandSpecimen[] }> {
  const seen = new Map<string, BrandSpecimen[]>();
  for (const s of BRAND_SPECIMENS) {
    const list = seen.get(s.group) ?? [];
    list.push(s);
    seen.set(s.group, list);
  }
  const known = SPECIMEN_GROUPS.filter((g) => seen.has(g));
  const rest = [...seen.keys()].filter((g) => !(SPECIMEN_GROUPS as readonly string[]).includes(g)).sort();
  return [...known, ...rest].map((group) => ({ group, specimens: seen.get(group) ?? [] }));
}
