/**
 * S1 — six representative pages, from the Annabelle record, on the Chancery master.
 *
 * Composed with the production block registry and rendered by
 * `compileTemplateHtmlForPdf`, which is the print contract `render-template-pdf`
 * applies before it invokes the engine. The tokens are Chancery's own, lifted
 * from the seeded master rather than restated, and the table treatment is the
 * one `tablePlan('ledger_hairline')` resolves for the Private Banking family,
 * so the palette, the type scale and the ruled statement are the ones the
 * Templates workflow would use.
 *
 * Every figure on these pages is read from the stored row. Where a value is
 * real but the PROJECTION does not publish it yet, the page carries a
 * provisional chip naming the stage that publishes it. Nothing is invented.
 *
 * ── Why this script measures before it lays out ──────────────────────────────
 *
 * Every block in this system is absolutely positioned, so a block that draws
 * one line taller than its author assumed does not overflow the page — it
 * prints over the block beneath it. `blocks.ts` records the same lesson from
 * the other side: `spacing.rowHeight` is a number no part of the renderer
 * reads, and trusting it put 45 blocks of the catalogue 33–52pt past their
 * reserved space.
 *
 * So nothing here is laid out from an assumed height. Pass one renders every
 * flowed block alone, on its own page, on its own ground, through the pinned
 * engine, and measures the ink. Pass two stacks them from those measurements
 * and asserts that no page's last block reaches the running foot.
 *
 *   npx tsx scripts/reports/s1Pages.mts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { measureAndRender, REPO, type Sheet } from './_reviewKit.mts';
import { applyInvestmentProjection } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../supabase/functions/_shared/organisationProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../template-library/investmentCompass/templates';
import { transportCountReading } from '../../supabase/functions/_shared/transportReading.pure';
import {
  NSW_HAZARD_LAYERS,
  NSW_PROTECTION_LAYERS,
} from '../../supabase/functions/_shared/planning/planningConstraints.pure.ts';

/**
 * What was actually asked at this point, in the register's OWN categories.
 *
 * The page said "Nineteen hazard layers". It is wrong twice: the count is
 * wrong, and eleven of the layers are not hazards. `NSW_HAZARD_LAYERS` holds
 * four (bushfire, flood twice, landslide) and `NSW_PROTECTION_LAYERS` twelve,
 * of which only acid sulfate soils is `kind: 'hazard'` — the rest state a
 * planning control or an environmental protection, which is a different thing
 * to tell a buyer and a different thing to act on.
 *
 * Counted from the maps rather than typed, so the sentence cannot drift from
 * the request the moment a layer is added.
 */
const LAYERS = { ...NSW_HAZARD_LAYERS, ...NSW_PROTECTION_LAYERS };
const LAYER_TOTAL = Object.keys(LAYERS).length;
const HAZARD_TOTAL = Object.values(LAYERS).filter((l) => l.kind === 'hazard').length;
const OTHER_TOTAL = LAYER_TOTAL - HAZARD_TOTAL;


const F = (p: string) => resolve(REPO, 'reports/fixtures', p);

const row = JSON.parse(readFileSync(F('annabelle-row.json'), 'utf8'));
const MARK = readFileSync(F('mark-monogram.txt'), 'utf8').trim();
const li = row.location_intelligence ?? {};
const score = row.investment_score ?? {};
const v2 = score.v2 ?? {};

// ── the binding context, through the production projection ──────────────────
const flat = (o: unknown) => (o && typeof o === 'object' ? { ...(o as object) } : {});
const data: Record<string, any> = {
  report: { id: row.id, type: 'investment', generated_at: row.updated_at },
  property: flat(row.property_specs),
  financials: flat(row.financial_calculations),
  scores: flat(row.investment_score),
  brand: { tokens: {}, logo: null },
};
applyInvestmentProjection(data, row);
applyOrganisationProjection(
  data,
  {
    company_name: 'Naidu Property Consulting Services',
    email_signature_phone: '02 8609 3299',
    email_signature_email: 'admin@npcservices.com.au',
    email_signature_website: 'npcservices.com.au',
    email_signature_address: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153',
  } as never,
  { mark: MARK, markMono: MARK },
  {
    contact: {
      company_name: 'Naidu Property Consulting Services',
      abn: '50 684 555 771',
      email: 'admin@npcservices.com.au',
      phone: '02 8609 3299',
      address: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153',
      website: 'www.npcservices.com.au',
    },
    disclaimer: { is_enabled: true, font_size: 'medium', text: readFileSync(F('disclaimer.txt'), 'utf8') },
  } as never,
);

// ── Chancery's own tokens ───────────────────────────────────────────────────
const chancery: any = INVESTMENT_COMPASS_TEMPLATES.find(
  (t: any) => String(t.slug ?? '').includes('-pb-01-'),
);
const TOKENS = chancery.schema.tokens;
const C = TOKENS.colors;
const PAD = TOKENS.spacing.padding;   // 57
const W = 595 - PAD * 2;              // 481
const FOOT_RULE = 786;                // the running foot's rule
const FLOOR = FOOT_RULE - 12;         // nothing flowed may reach this

/**
 * The Private Banking table treatment, verbatim.
 *
 * `tablePlan('ledger_hairline')` resolves to tracked column heads over a single
 * heavy rule, hairlines between rows, no outer border and an alternate-row
 * tint — a statement, not a filled band. Taken from the seeded Chancery master
 * rather than restated, so a change to the family reaches this document.
 */
const TABLE = {
  headerStyle: 'rule', headerBg: 'token:primary', headerFg: 'token:onPrimary',
  headerFont: 'token:mono', headerSize: 6, headerTracking: 0.1,
  numericFont: 'token:heading', rowRule: true, outerBorder: false,
  stripeBg: 'token:panel', cellFg: 'token:ink', borderColor: 'token:line',
  emphasisColor: 'token:ink', negativeColor: 'token:negative',
  fontSize: 8.5, cellPadding: 4.5,
};

// ── helpers ─────────────────────────────────────────────────────────────────
let n = 0;
const id = (t: string) => `s1-${t}-${++n}`;
const B = (type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: id(type), type, props: { x: PAD, width: W, ...props }, overlays: [], ...extra });

const eyebrow = (text: string, color = C.accentOnField) =>
  B('text-block', { body: text, bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.28, color });
const title = (text: string, size = 22, color = C.ink) =>
  B('text-block', { body: text, bodySize: size, bodyFont: 'token:heading', bodyLineHeight: 1.18, bodyTracking: -0.01, color });
const para = (text: string, opts: Record<string, unknown> = {}) =>
  B('text-block', { body: text, bodySize: 9.5, bodyFont: 'token:body', bodyLineHeight: 1.5, color: C.ink, ...opts });
const rule = (color = C.line, width = W) => B('divider', { color, thickness: 0.6, width });

/** The provisional chip. Names the stage that will publish the binding. */
const provisional = (stage: string, what: string) =>
  B('text-block', {
    body: `PROVISIONAL · ${stage}   ${what}`,
    bodySize: 6, bodyFont: 'token:mono', bodyTracking: 0.14, bodyLineHeight: 1.6, color: C.caution,
  });

/**
 * The interpretation callout, in Chancery's own treatment.
 *
 * The family declares `callout_style: 'tinted_gold_bar'` and `radius: '0'`, so
 * a tinted panel with a gold left bar and square corners is the design; the
 * block's own defaults are a 6pt radius and the legacy off-white, which is the
 * one element on the page that would ignore the colourway.
 *
 * `maxWords` is passed for the reason `blocks.ts` passes it: the 60-word
 * default silently truncates at word 61 and prints an ellipsis, and a
 * client-facing sentence that stops mid-clause is worse than a longer card.
 */
const callout = (heading: string, body: string) =>
  B('decision-box', {
    heading, body, maxWords: 130,
    accent: 'token:primary', bg: 'token:panel', color: 'token:ink',
    headingColor: 'token:accentInk', headingFont: 'token:mono',
    headingSize: 6.5, headingTracking: 0.18,
    bodyFont: 'token:body', bodySize: 9.5,
    radius: 0, barWidth: 2,
  });

const foot = (pageNo: string) => ([
  B('divider', { color: C.line, thickness: 0.6, width: W, y: FOOT_RULE }),
  B('text-block', { body: `18 Annabelle Crescent, Kellyville NSW 2155 · Investment Compass`, bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.12, color: C.muted, y: FOOT_RULE + 10, width: 340 }),
  B('text-block', { body: pageNo, bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.12, color: C.muted, y: FOOT_RULE + 10, x: PAD + W - 120, width: 120, align: 'right' }),
]);

// ── real values, read from the row ──────────────────────────────────────────
const amenities: any[] = Array.isArray(li.amenities) ? li.amenities : [];
const amen = (cat: string) => amenities.find((a) => a.category === cat) ?? {};
const km = (d: unknown) => (typeof d === 'number' ? `${d.toFixed(2)} km` : '—');
/** Small counts are spelled in prose, and a four-figure measurement is grouped. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: unknown) => (typeof n === 'number' && n <= 10 && n >= 0 ? WORDS[n] : String(n));
const grouped = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-AU') : String(n));
const schools: any[] = li.schools?.topSchools ?? [];
const stops: any[] = li.transport?.detailedStops ?? [];
const nearestStopMetres = Math.round(stops[0]?.metres ?? 0);
/**
 * The stop count under a name and radius that agree — `transportCountReading`.
 * The stored key is called `stopsWithin1km` and holds the count within
 * `radiusMetres`, which is 1,600, so the name has never described the value.
 */
const transportCount = transportCountReading(li.transport);
const transportLabel = transportCount.label ?? 'No boarding place is recorded within the searched radius';

const dims = [
  { key: 'growth', label: 'Capital growth' },
  { key: 'location', label: 'Location' },
  { key: 'yield', label: 'Rental return' },
  { key: 'demand', label: 'Market demand' },
  { key: 'risk', label: 'Property risk' },
].map((d) => {
  const rec = (v2.dimensions ?? []).find((x: any) => x.key === d.key) ?? {};
  const gap = (score.gradeGaps ?? []).find((g: any) => g.dimension === d.key);
  return { ...d, ...rec, reason: gap?.reason ?? null, remedy: gap?.remedy ?? null };
});
const coverage = v2.evidenceCoverage != null ? Math.round(v2.evidenceCoverage * 100) : null;
/**
 * The four readings the record holds, kept apart — owner correction C2.1.
 *
 *   performance  the composite over the dimensions that COULD be measured,
 *                and the grade that composite alone would carry
 *   coverage     the share of the method the evidence reached
 *   issued       the grade actually issued, after the evidence cap
 *   conclusion   whether the evidence supports an overall recommendation
 *
 * Merging the first and third is what made the cover read "assessment
 * performance F · 40" while page three said the composite would be C.
 */
const nominalPoints = Number(
  String(v2.gradeCapReasons?.[0] ?? '').match(/delivers (\d+) of the composite/)?.[1] ?? NaN,
);
const capCeiling = v2.gradeEligibility?.ceiling ?? null;
const measured = (v2.dimensions ?? []).filter((d: any) => d.available).length;
const total = (v2.dimensions ?? []).length;

// ── the layout model ────────────────────────────────────────────────────────
type Entry = [gap: number, block: any];

// ═══ 1 · COVER ══════════════════════════════════════════════════════════════
// One governed conclusion, with evidence coverage disclosed beside it and never
// merged into it. No financial band: the weekly position, loan and repayment
// belong to the Financial Analysis.
const COVER: Sheet = {
  name: 'Cover',
  background: { color: 'token:bg' },
  top: 300,
  pinned: [
    B('image', { src: MARK, fit: 'contain', placeholder: false, x: PAD, y: PAD, width: 46, height: 37 },
      // The block's name is what the image block reads for its alternative
      // text when nothing else describes the picture.
      { name: 'Naidu Property Consulting Services brand mark' }),
    B('text-block', { body: 'Naidu Property Consulting Services', bodySize: 8.5, bodyFont: 'token:display', bodyTracking: 0.26, color: C.text, y: 112 }),
    B('divider', { color: C.primary, thickness: 1, y: 140, width: 64, x: PAD }),
    B('text-block', { body: 'Prepared 17 September 2026   ·   Private and confidential', bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.16, color: C.mutedOnField, y: 800 }),
  ],
  flow: [
    [0, eyebrow('INVESTMENT COMPASS')],
    [16, B('text-block', { body: '18 Annabelle Crescent\nKellyville NSW 2155', bodySize: 34, bodyFont: 'token:heading', bodyLineHeight: 1.1, bodyTracking: -0.02, color: C.text })],
    [18, B('text-block', {
      body: 'Where the property is, who wants to live there, what is mapped over the land, and what the assessment concluded.',
      bodySize: 10, bodyFont: 'token:body', bodyLineHeight: 1.5, color: C.mutedOnField, width: 400,
    })],
    [40, rule('#4A3F32')],
    [16, eyebrow('THE CONCLUSION')],
    [14, B('text-block', {
      body: 'The evidence available does not support an overall\nrecommendation on this property.',
      bodySize: 16, bodyFont: 'token:heading', bodyLineHeight: 1.3, color: C.text, width: 430,
    })],
    [16, B('text-block', {
      body: `${measured} of ${total} assessment criteria could be measured — capital growth in full, rental return in full, market demand on 15% of its method. Location and property risk could not be measured at all. On what WAS measured the property scores ${v2.score}, a ${v2.scoreGrade}; the grade issued is ${v2.grade}, because a criterion that was not measured never lifts a grade. Those are three different statements and this report keeps them apart.`,
      bodySize: 9, bodyFont: 'token:body', bodyLineHeight: 1.55, color: C.mutedOnField, width: 430,
    })],
    // No divider here: the `ruled` band draws its own 1.5pt rule over itself,
    // and that rule is what attaches it to what it sits under. A second one
    // above it prints as a doubled line.
    [44, B('kpi-grid', {
      variant: 'ruled', columns: 3, height: 74,
      items: [
        { label: 'Measured-criteria score', value: `${v2.score} · ${v2.scoreGrade}` },
        // One line. The ruled band does not reserve the label's line height, so
        // a label that wraps drops its own value below the other two baselines
        // — the reservation `AmlMetricCard` already makes for the same reason.
        { label: 'Evidence coverage', value: `${coverage}%` },
        { label: 'Grade issued, after the cap', value: String(v2.grade) },
      ],
      valueFont: 'token:heading', labelFont: 'token:mono', labelSize: 6, labelTracking: 0.18,
      valueSize: 13, valueColor: C.text, labelColor: C.mutedOnField, ruleColor: '#4A3F32', emphasisColor: '#4A3F32',
    })],
  ],
};

// ═══ 2 · CONTENTS ═══════════════════════════════════════════════════════════
// Two levels, built from the sections the document actually renders. The
// delivered contents lists eight page archetypes and puts 29 pages of analysis
// behind one line reading "The report".
const IN = '    ';   // a real indent: HTML collapses ordinary spaces
const SECTIONS: Array<[string, string, string]> = [
  ['1', 'Executive verdict', '6'],
  ['2', 'Property & locality snapshot', '7'],
  ['3', 'Why this location matters', '8'],
  ['', 'Capital growth context and suburb trajectory', '8'],
  ['', 'Planning framework and development controls', '9'],
  ['4', 'Demand drivers', '11'],
  ['', 'Population, income and socio-economic profile', '12'],
  ['', 'Employment, industry mix and local job anchors', '12'],
  ['5', 'Amenity & access', '14'],
  ['', 'Education access', '14'],
  ['', 'Parks, lifestyle and daily living', '15'],
  ['6', 'Transport & connectivity', '15'],
  ['7', 'Planning, zoning & what is mapped over the land', '16'],
  ['', 'Zoning and primary development controls', '16'],
  ['', 'Verification steps before contract', '18'],
  ['8', 'Infrastructure & ten-year outlook', '19'],
  ['9', 'Environment, climate & safety', '19'],
  ['10', 'Market positioning', '21'],
  ['11', 'Property fit within the suburb', '23'],
  ['12', 'Risk dashboard', '24'],
  ['13', 'Due diligence checklist', '29'],
  ['14', 'Recommendation, suitability & monitoring', '30'],
  ['15', 'Appendix, sources & disclaimer', '31'],
];

const CONTENTS: Sheet = {
  name: 'Contents',
  top: PAD,
  pinned: foot('Page 2 of 36'),
  flow: [
    [0, eyebrow('IN THIS REPORT', C.muted)],
    [16, title('Contents')],
    [20, rule()],
    [18, B('data-table', {
      ...TABLE,
      headers: ['', 'Section', 'Page'],
      columnWidths: [0.06, 0.82, 0.12],
      numericColumns: [2],
      rows: SECTIONS.map(([num, name, pg]) => ({ cells: [num, num ? name : IN + name, pg] })),
      // No zebra here. The tint alternates by DRAWN row, so on a two-level
      // contents it cuts across the level it is meant to sit behind — a part
      // and one of its sub-entries land in the same band while the next
      // sub-entry does not, and the pattern reads as a third kind of row.
      // The hairlines and the indent carry the structure.
      stripeBg: 'transparent',
      fontSize: 8.4, cellPadding: 5,
    })],
    [22, provisional('S3', 'Section list and page numbers are bound from the rendered spine; the master currently indexes page archetypes.')],
  ],
};

// ═══ 3 · THE ASSESSMENT ═════════════════════════════════════════════════════
// Five dimensions, always five. A dimension that could not be measured draws a
// row carrying its reason and its remedy, rather than being dropped so that a
// heading reading "Five dimensions" sits over three.
const ASSESSMENT: Sheet = {
  name: 'The assessment',
  top: PAD,
  pinned: foot('Page 4 of 36'),
  flow: [
    [0, eyebrow('HOW THE ASSESSMENT WAS REACHED', C.muted)],
    [16, title('Performance, and what it rests on')],
    [16, rule()],
    [12, para('Three things are kept apart and never combined: how the property SCORED on what could be measured, how much of the method the evidence REACHED, and the GRADE issued once the second limits the first.', { bodySize: 9 })],
    [12, eyebrow('PERFORMANCE ON MEASURED CRITERIA')],
    [12, B('data-table', {
      ...TABLE,
      headers: ['Criterion', 'Score', 'Weight applied', 'Measured on'],
      columnWidths: [0.32, 0.12, 0.13, 0.43],
      numericColumns: [1, 2],
      rows: dims.filter((d) => d.available).map((d) => ({
        cells: [
          d.label,
          String(d.performance),
          `${Math.round((d.effectiveWeight ?? 0) * 100)}%`,
          d.coverage === 1 ? 'Full method' : `${Math.round((d.coverage ?? 0) * 100)}% of method`,
        ],
      })),
    })],
    [8, para(`Weight applied is not the criterion\u2019s share of the whole method: capital growth carries ${Math.round((dims.find((d) => d.key === 'growth')?.nominalWeight ?? 0) * 100)}% of it and the other two ${Math.round((dims.find((d) => d.key === 'yield')?.nominalWeight ?? 0) * 100)}% each, and with location and property risk unmeasured those three are re-weighted across what remains. The unrounded weights total exactly 100%; the whole numbers shown are rounded, so they may not.`, { bodySize: 8.4, color: C.muted })],
    [10, eyebrow('NOT MEASURED — AND WHY')],
    // The record's own reason, and nothing else.
    //
    // Each gap also stores a `remedy`, and neither belongs on a client page:
    // one is engineering prose ("the location service re-acquires the
    // enrichment with its acquisition stamp (RF-7.2B)"), and the property-risk
    // one is written in the past tense — "Answered property-risk questions
    // from the per-class schema" — so printed as a remedy it reads as though
    // the work had already been done. They are operator instructions and are
    // named in the chip below rather than set as the reader's next step.
    // The record's own reason is printed for property risk, where it is
    // accurate: no property-specific risk evidence was ever supplied.
    //
    // It is NOT printed for location. That row reads "the available location
    // information does not meet the current verification standard", which
    // describes the information; the traced cause is that the readings were
    // acquired and then not retained when this assessment was saved
    // (S2_LOCATION_EVIDENCE_TRACE.md). Printing the record's sentence would
    // tell the reader their evidence was inadequate when the evidence was
    // fine and this product dropped it.
    [8, B('definition-list', {
      title: '',
      items: dims.filter((d) => !d.available).map((d) => ({
        term: d.label,
        definition: d.key === 'location'
          ? 'The readings this criterion needs — walkability, the drive to the city and the school count — were obtained for this property and were not retained when this assessment was saved. Nothing about the property, or about the information available for it, caused that.'
          : d.reason,
      })),
    })],
    [10, para('Neither absence is a finding about the property, and closing both is our work: the location readings re-acquire when this report is next produced, and the property-risk criterion needs its per-class questions answered on this file. The certificates and searches on the risk page are separate and remain yours, before contract.', { bodySize: 8.2 })],
    [8, provisional('S2', 'Both absences and their reasons are read from the stored record; the projection publishes the three scored rows only.')],
    [10, rule()],
    [8, eyebrow('EVIDENCE COVERAGE')],
    [4, B('progress-bars', {
      title: '',
      // The block prints the value as a percentage on the right of every bar,
      // so a label that also carries the figure prints it twice.
      items: [
        { label: 'Share of the method the evidence reached', value: coverage },
      ],
      accent: C.primary,
    })],
    [12, eyebrow('WHY THE GRADE IS LOWER THAN THE SCORE')],
    [8, para(`A separate measure sets the CEILING: across the full method the measured criteria deliver ${nominalPoints} of its 100 nominal points, and ${nominalPoints} supports at most ${capCeiling}. So the score is ${v2.score} (${v2.scoreGrade}) and the grade issued is ${v2.grade} — the rule that an unmeasured criterion never lifts a grade, not a second opinion.`, { bodySize: 8.6 })],
    [10, callout('What this means for this property', 'The largest gap is location, the second-heaviest criterion, on a property 90 m from a public school and 106 m from a bus stop in a straight line — so what is missing is not obscure. Until it is measured this report gives you the score, the coverage and the grade, and stops short of an overall recommendation.')],
  ],
};

// ═══ 4 · AMENITY & ACCESS ═══════════════════════════════════════════════════
const AMENITY: Sheet = {
  name: 'Amenity & access',
  top: PAD,
  pinned: foot('Page 14 of 36'),
  flow: [
    [0, eyebrow('PART 05 · AMENITY & ACCESS', C.muted)],
    [16, title('What is nearby, and how far')],
    [22, rule()],
    [14, para('Two registers answer this page: an OpenStreetMap slice loaded on a schedule and read locally, so a count is what it holds rather than a live search, and the Transport for NSW GTFS stop feed. EVERY DISTANCE IS STRAIGHT-LINE from the verified coordinate — no route is measured.')],
    [10, eyebrow('NEAREST ON RECORD')],
    [10, B('data-table', {
      ...TABLE,
      headers: ['Category', 'Nearest on record', 'Distance', 'What it means, and its limit'],
      columnWidths: [0.14, 0.24, 0.1, 0.52],
      numericColumns: [2],
      rows: [
        { cells: ['Schools', amen('Schools').nearest, km(amen('Schools').distance), 'Nearest of five held. Proximity is not catchment.'] },
        { cells: ['Healthcare', amen('Healthcare').nearest, km(amen('Healthcare').distance), 'An allied-health practice, not a medical centre; no hospital is held at this grain.'] },
        { cells: ['Shopping', amen('Shopping').nearest, km(amen('Shopping').distance), 'A full-line supermarket under a kilometre away in a straight line.'] },
        { cells: ['Recreation', amen('Recreation').nearest, km(amen('Recreation').distance), 'A local park for everyday use, not a destination reserve.'] },
        { cells: [
          'Transport',
          li.transport?.detailedStops?.[0]?.name ?? '—',
          `${Math.round((li.transport?.detailedStops?.[0]?.metres ?? 0))} m`,
          `The closest of the ${word(stops.length)} nearest stops this record names individually. Mode and service frequency are not published per stop, so neither is stated.`,
        ] },
      ],
      fontSize: 8.2,
    })],
    [14, B('text-block', {
      bodySize: 8.2, bodyFont: 'token:body', bodyLineHeight: 1.5, color: C.caution,
      body: `Two figures here look like they disagree and do not. The stop register holds ${transportLabel.toLowerCase()} of this property, counting a station and its platforms once. The record names the ${word(stops.length)} nearest of them individually and the row above shows the closest of those ${word(stops.length)}; it is a sample, not the whole list. Separately, the amenity register reports no public transport at all, because its transit category is rail, metro and tram STATIONS within two kilometres and matches no bus stop: that nought is true about stations and says nothing about buses.`,
    })],
    [10, eyebrow('THE FIVE NEAREST SCHOOLS')],
    [10, B('data-table', {
      ...TABLE,
      headers: ['School', 'Distance'],
      columnWidths: [0.79, 0.21],
      numericColumns: [1],
      rows: schools.map((s: any) => ({ cells: [s.name, `${s.distance.toFixed(2)} km`] })),
      fontSize: 8.2,
    })],
    [12, callout('What this means, and what to do before contract', 'The nearest of every category sits within a kilometre in a straight line. Whether that suits the tenant a landlord would target depends on the dwelling — bedrooms, bathrooms, parking, condition — and this page establishes none of those, so it draws no conclusion about who would rent it. Three limits besides: the register caps each category at ten, so ten is a floor rather than a measurement; no rating, ranking or catchment is published here; and no route is measured, so a short straight line is not a short walk. Before contract, confirm the catchment with the NSW School Finder and travel to the Windsor Road stop at the hour you would use it.')],
    [16, provisional('S3 · S4', 'Named facilities and distances are read from the stored enrichment; the projection does not yet publish an amenity namespace.')],
  ],
};

// ═══ 5 · INFRASTRUCTURE & TEN-YEAR OUTLOOK ══════════════════════════════════
// A determination date is not a delivery date. Every row the NSW register
// returned for this window carries a determination and no published delivery
// horizon, so every row sits under "Timing unconfirmed" and says so.
const DA = [
  { what: 'Demolition, residential flat building, shop-top housing, hotel or motel accommodation', cat: 'Residential supply', where: 'Castle Hill', cost: '$181,934,581', det: 'Determined 7 Jul 2026' },
  { what: 'Alterations or additions, high technology industry, data centre', cat: 'Retail & employment', where: 'Norwest', cost: '$93,180,778', det: 'Determined 7 May 2026' },
  { what: 'Alterations or additions, high technology industry, data centre', cat: 'Retail & employment', where: 'Norwest', cost: '$93,180,778', det: 'Determined 2 Jul 2026' },
  { what: 'Alterations or additions, high technology industry, data centre', cat: 'Retail & employment', where: 'Norwest', cost: '$93,180,778', det: 'Determined 30 Jul 2026' },
  { what: 'Erection of a new structure, multi-dwelling housing (terraces)', cat: 'Residential supply', where: 'Gables', cost: '$29,752,831', det: 'Determined 22 Jul 2026' },
];

const INFRA: Sheet = {
  name: 'Infrastructure & ten-year outlook',
  top: PAD,
  pinned: foot('Page 19 of 36'),
  flow: [
    [0, eyebrow('PART 08 · INFRASTRUCTURE & TEN-YEAR OUTLOOK', C.muted)],
    [16, title('What is coming, and what is only decided')],
    [22, rule()],
    [16, para('A development application that has been DETERMINED has been decided by the consent authority. That is all this register records: whether the work is funded, whether it has started and when it might finish are NOT ESTABLISHED by anything below. No row carries a publisher-stated delivery date, so nothing below is placed on a horizon.')],
    [18, eyebrow(`TIMING UNCONFIRMED — ${WORDS[DA.length].toUpperCase()} APPLICATIONS IN THE REGISTER WINDOW`)],
    [12, B('data-table', {
      ...TABLE,
      headers: ['Project', 'Category', 'Where', 'Status recorded', 'Stated cost'],
      columnWidths: [0.3, 0.155, 0.115, 0.235, 0.195],
      numericColumns: [4],
      rows: DA.map((d) => ({ cells: [d.what, d.cat, d.where, d.det, d.cost] })),
      fontSize: 7.6, cellPadding: 4,
    })],
    [16, B('text-block', {
      bodySize: 8.4, bodyFont: 'token:body', bodyLineHeight: 1.5, color: C.caution,
      body: 'Three Norwest rows share a description, a suburb and a stated cost to the dollar, and differ only in determination date. They are flagged as a possible relationship and are NOT merged: identity is confirmed by application number or a documented modification record, and the register’s identifiers have not yet been read. They are counted here as three applications, not as three projects.',
    })],
    [14, rule()],
    [12, eyebrow('TOTALS, SEPARATELY LABELLED')],
    [12, B('data-table', {
      ...TABLE,
      headers: ['Basis', 'Figure', 'What it counts'],
      columnWidths: [0.26, 0.21, 0.53],
      numericColumns: [1],
      rows: [
        { cells: ['Selected applications', '$491,229,746', 'The five rows above, summed. Not de-duplicated.'] },
        { cells: ['Council-wide cost', '$808,649,729', '278 applications, The Hills Shire, 18 Mar – 17 Sep 2026.'] },
        { cells: ['Council-wide dwellings', '680', '171 applications, same window.'] },
      ],
      fontSize: 8.2,
    })],
    [16, callout('What this means for this property', 'Activity in the local government area is visible and substantial, and none of it is at this address. For a landlord it reads both ways: confidence in the district, and competing supply for a comparable dwelling. None of it can be given a completion date from this register.')],
    [14, eyebrow('NOT COVERED BY THIS REGISTER')],
    [10, para('Council capital works programmes, state transport, education and health capital registers, and agency announcements are not integrated. Their absence here is not evidence that nothing is planned.', { bodySize: 8.6 })],
    [12, provisional('S4', 'Six-category filing, the evidence fields and the identity check are the agreed design; only the NSW DA register is integrated today.')],
  ],
};

// ═══ 6 · RISK & INTERPRETATION ══════════════════════════════════════════════
// Exposure and evidence confidence are separate columns. A "Low" exposure with
// an outstanding check is not a clearance, and the page says so in the table
// rather than in a footnote.
const RISK: Sheet = {
  name: 'Risk & interpretation',
  top: PAD,
  pinned: foot('Page 24 of 36'),
  flow: [
    [0, eyebrow('PART 12 · RISK DASHBOARD', C.muted)],
    [16, title('What is recorded, and what is exposed')],
    [18, rule()],
    // Two different kinds of thing were in one table. A planning control is
    // something the scheme STATES about the land; a hazard exposure is
    // something that could harm it, and a desktop layer returning nothing
    // cannot set its severity. They are banded separately now.
    [12, para('Two kinds of finding sit below and they are not read the same way. A PLANNING CONTROL is something the scheme states about this land: it is either published or it is not. An EXPOSURE is something that could affect value, and its severity has to be established — where no register settled it, this page says so rather than choosing a word.')],
    [14, B('data-table', {
      ...TABLE,
      headers: ['Item', 'Status', 'On what basis', 'What it means, and what to do before contract'],
      columnWidths: [0.17, 0.145, 0.135, 0.55],
      numericColumns: [],
      fontSize: 8.2,
      sectionRows: [0, 3],
      sectionBg: 'token:bg', sectionFg: 'token:accentOnField',
      rows: [
        { cells: ['Planning controls the scheme publishes for this land'] },
        { cells: [
          'Zone, height and minimum lot',
          'Published',
          'The Hills LEP 2019',
          'R2 Low Density Residential; 10\u00A0m height (cl.\u00A04.3); 700\u00A0m² minimum lot, which this 765\u00A0m² recorded area exceeds by 65\u00A0m². A zone that admits a use is not approval for it: confirm the surveyed area and frontage before assuming a subdivision is feasible.',
        ] },
        { cells: [
          'Floor space ratio',
          'Not published',
          'Register answered, no value',
          'FSR caps TOTAL FLOOR AREA across all storeys against site area — not the building footprint. The register answered here and published no figure, so permitted floor area is not known from mapping. Read it from the s.10.7(2) certificate and the DCP.',
        ] },
        { cells: ['Exposures, and whether their severity is established'] },
        { cells: [
          'Mapped hazards, controls and protections',
          'Severity not established',
          'Desktop layers only',
          `${LAYER_TOTAL} layers answered here and none returned a mapped feature — ${HAZARD_TOTAL} are hazards, ${OTHER_TOTAL} are planning controls or protections. A layer answers at its published scale, not for one lot, so this is absent mapping and NOT a finding that the property is unaffected. Order the s.10.7(2) and (5) certificates and the AFRIP and RFS mapping.`,
        ] },
        { cells: [
          'Competing new dwellings',
          'Measured, council-wide',
          'NSW DA register',
          '680 new dwellings across 171 applications in The Hills Shire, six months to 17\u00A0Sep\u00A02026 — a local government area count, not this street, and how much competes with this dwelling is not established. Count the comparable detached houses before setting rent and resale assumptions.',
        ] },
        { cells: [
          'Getting about without a car',
          'Partly measured',
          'GTFS stop register',
          `${transportLabel}, nearest ${nearestStopMetres}\u00A0m straight-line. No walking route, mode or frequency is measured and no rail, metro or tram station is recorded within two kilometres, so how well the property is served is not established here. Check Transport for NSW timetables for the Windsor Road routes.`,
        ] },
      ],
    })],
    // C6.2 — a concise source, date and method line on the page; the full
    // provenance belongs in the appendix.
    [12, eyebrow('WHERE EACH ROW CAME FROM', C.muted)],
    [10, para('Planning controls: NSW Planning Portal and Spatial Services layers, read at this property\u2019s verified coordinate on 17 Sep 2026, each at its own publisher\u2019s scale. Supply: NSW development application register, The Hills Shire, applications determined 18 Mar – 17 Sep 2026. Transport: Transport for NSW GTFS stops (CC BY 4.0), straight-line distance from the coordinate. No field survey, certificate or site inspection informs this page.', { bodySize: 8, color: C.muted })],
    [12, callout('How to read this page', 'Nothing here settles a site-specific question. Desktop registers say what has been PUBLISHED about an area; they do not inspect a lot, and where one returned nothing this page records that the severity is not established rather than choosing a comfortable word. Every row carries the step that would settle it, and those steps are yours and your adviser\u2019s before contract.')],
    [12, provisional('S3 · S4', 'Rows are read from the stored planning and enrichment records; the projection does not yet publish a planning or exposure namespace. Drawn on the template\u2019s own ledger for this review\u2019s layout; the shared risk-register block\u2019s chips now resolve `token:chip*` and follow the colourway.')],
  ],
};

const SHEETS = [COVER, CONTENTS, ASSESSMENT, AMENITY, INFRA, RISK];

// ── render, through the shared review harness ───────────────────────────────
const { overruns, lost } = await measureAndRender(SHEETS, TOKENS, data, 's1-review', {
  floor: FLOOR,
  coverFloor: 812,
  coverNames: ['Cover'],
  showHeights: !!process.env.S1_HEIGHTS,
});
process.exitCode = overruns === 0 && lost === 0 ? 0 : 1;
