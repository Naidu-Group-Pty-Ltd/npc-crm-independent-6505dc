/**
 * The Strategy Rationale Brief, typeset.
 *
 * Draws `StrategyRationaleDocument` — the words `strategyRationale.pure.ts`
 * composes, which are the jsPDF generator's words — through the design system,
 * in the design chosen for Borrowing Capacity, the report type the brief has
 * always taken its design from (`DRAWN_DOCUMENTS`). Nothing here writes a word
 * of its own beyond what a page needs to be navigable: the running head and
 * the chapter numbers.
 *
 * The layout follows the jsPDF brief's order exactly — cover; the brief with
 * its headline and capacity figures; the Strategy Advisor's reasoning where
 * the scenario is one of its cards; what we propose and why; how the maths
 * reconciles; the execution sequence; caveats; then the capital flow,
 * valuation assumptions and cross-collateral method where the scenario has
 * them; the issuer's closing page.
 *
 * **It is one memo, not a set of chapters.** The jsPDF brief sets each part
 * under a small heading and runs on, and a baseline scenario's parts are one
 * line each: drawn as chapters, "No levers applied" sat under a 30pt heading
 * and "SECTION 03", and the brief ran a page longer than the one it replaces.
 * So the brief is a single chapter whose parts are the design system's
 * subhead, and a part is kept with its first lines (`keepTogether`) so a
 * heading never ends a page.
 *
 * **It opens on its finding (1 Oct 2026, §22).** The chapter's own header
 * repeated the cover word for word ("Strategy Rationale Brief", "Borrowing
 * Capacity Scenario — Finance Hand-off") under a "SECTION 01" that numbered
 * the only section, and the running head said "Strategy Rationale Brief" on
 * both sides of every page. The cover names the document; the first page now
 * leads with what the scenario does, the engine's headline, set as the memo's
 * title with its sub-headline beneath, and the running head names the client
 * the brief is for, as the jsPDF brief's footer always has. The parts' subheads
 * are a step below that title (`SECTION_SUBHEAD_CLASS`), as in every other
 * memo, and a table is kept by its estimated height (`keptTable`), never moved
 * whole with its heading: a four-step sequence kept whole left a quarter of a
 * page white above it.
 *
 * Every string is escaped by the primitive that draws it; the document arrives
 * from a browser and is read (`readStrategyRationale`) before it gets here.
 */

import type { BrandLockupProps } from '../../reportDesign/primitives.pure.ts';
import {
  closeChapter,
  escapeHtml,
  KEEP_TOGETHER_CLASS,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderCover,
  renderDataTable,
  renderDocument,
  renderKpiStrip,
  SECTION_SUBHEAD_CLASS,
  type CalloutTone,
  type TableColumn,
  type TableRow,
} from '../../reportDesign/primitives.pure.ts';
import { keptTable, type KeepOptions } from '../../reportDesign/tableKeeping.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import { withDesignOptions, type ReportTemplateDesign } from '../../reportDesign/templateDesign.pure.ts';
import {
  ADVISOR_OPTIONS_NOTE,
  CAPITAL_FLOW_LABELS,
  STRATEGY_RATIONALE_NAME,
  STRATEGY_RATIONALE_STANDFIRST,
  type RationaleSeverity,
  type StrategyRationaleDocument,
} from './strategyRationale.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['borrowing-capacity'];

const p = (t: string | null | undefined) => (t ? `<p>${escapeHtml(t)}</p>` : '');
/** A part's subhead: an `h2`, set a step below the memo's title, as in the Snapshot. */
const subhead = (t: string) => `<h2 class="${SECTION_SUBHEAD_CLASS}">${escapeHtml(t)}</h2>`;
const keepTogether = (html: string) => (html ? `<div class="${KEEP_TOGETHER_CLASS}">${html}</div>` : '');

/** As the Snapshot keeps its tables: whole while short, by height when not. */
const TABLE_KEEP: KeepOptions = { widths: 'content', leadRows: 2 };
const table = (cols: TableColumn[], rows: TableRow[]) =>
  keptTable(renderDataTable(cols, rows), { cols, rows }, TABLE_KEEP);
/** A block that is a table carries its own keeping, and is never wrapped whole with its heading. */
const isTable = (html: string) => html.startsWith('<div class="table-block');

/** The severity a lever carries, as the callout tone that says it. */
const SEVERITY_TONE: Record<RationaleSeverity, CalloutTone> = {
  positive: 'positive',
  caution: 'caution',
  critical: 'negative',
  info: 'informative',
};

/** How hard the advisor judged the scenario to execute, as the tone that says it. */
const ADVISOR_RISK_TONE: Record<'low' | 'medium' | 'high', CalloutTone> = {
  low: 'positive',
  medium: 'caution',
  high: 'negative',
};

interface Section {
  title: string;
  dek?: string;
  /** Sibling blocks, in order; the first is kept with the part's heading. */
  blocks: string[];
}

function sectionsOf(d: StrategyRationaleDocument): Section[] {
  const out: Section[] = [];

  // ── The brief: its finding and the capacity figures ──────────────────────
  // The headline and sub-headline are the memo's title and standfirst; the
  // cover names the document (§22).
  out.push({
    title: d.headline,
    dek: d.subHeadline ?? undefined,
    blocks: [
      renderKpiStrip(d.kpis.map((k) => ({ label: k.label, value: k.value, foot: k.foot || undefined, tone: k.tone }))),
      // How to read the two figures, where they seem to disagree.
      d.readingNote ? unlabelledCallout('informative', p(d.readingNote)) : '',
    ],
  });

  // ── The Strategy Advisor's reasoning, where the scenario is its card ─────
  // Directly under the figures it explains and before the per-lever account,
  // because it is the client-specific WHY of the whole scenario; the levers
  // below are the engine's account of each part of it.
  if (d.advisor) {
    const a = d.advisor;
    const risk = a.riskLine && a.risk
      ? unlabelledCallout(ADVISOR_RISK_TONE[a.risk], `<p><strong>${escapeHtml(a.riskLine)}</strong></p>`)
      : '';
    out.push({
      title: a.title,
      blocks: [
        `<p><strong>${escapeHtml(a.scenarioLine)}</strong></p>`,
        ...a.paragraphs.map((t) => p(t)),
        risk,
        a.evidence.length
          ? keepTogether(`<p><strong>${escapeHtml(a.evidenceTitle)}</strong></p>`
            + `<ul>${a.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`)
          : '',
        a.rejected.length
          ? keepTogether(`<p><strong>${escapeHtml(a.rejectedTitle)}</strong></p>`
            + `<ul>${a.rejected.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`)
          : '',
        a.cautions.length
          ? keepTogether(`<p><strong>${escapeHtml(a.cautionsTitle)}</strong></p>`
            + `<ul>${a.cautions.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`)
          : '',
        // The options the advisor put forward, the applied one marked: a
        // decision is between options, and the brief used to name only one.
        a.options.length
          ? keepTogether(`<p><strong>${escapeHtml(a.optionsTitle)}</strong></p>`
            + table(
              [
                { key: 'name', label: 'Option', align: 'left' },
                { key: 'capacity', label: 'Capacity', align: 'right' },
                { key: 'purchasePower', label: 'Purchase power', align: 'right' },
                { key: 'target', label: 'Target', align: 'right' },
                { key: 'risk', label: 'Risk', align: 'right' },
              ],
              a.options.map((o): TableRow => ({
                name: o.applied ? `${o.name} (applied)` : o.name,
                capacity: o.capacity,
                purchasePower: o.purchasePower,
                target: o.target,
                risk: o.risk,
              })),
            )
            + `<p><em>${escapeHtml(ADVISOR_OPTIONS_NOTE)}</em></p>`)
          : '',
        ...a.notes.map((n) => `<p><em>${escapeHtml(n)}</em></p>`),
      ],
    });
  }

  // ── What we propose and why, how the maths reconciles ───────────────────
  // A part with nothing in it is left out (§22). A baseline brief headed its
  // finding "Baseline scenario — no levers applied." and then said so three
  // more times, under "(0 levers)", "How the maths reconciles" and "(0
  // steps)", and the empty sequence's line called any scenario without steps
  // a baseline. `proposeEmpty` and `sequenceEmpty` are still composed, because
  // a server older than this draws them.
  if (d.bullets.length) {
    out.push({
      title: d.proposeTitle,
      blocks: d.bullets.map((b) => keepTogether(renderCallout(
        SEVERITY_TONE[b.severity],
        b.impactLabel ? `${b.severityLabel} · ${b.impactLabel}` : b.severityLabel,
        `<p><strong>${escapeHtml(b.what)}</strong></p>` + p(b.why) + p(b.cashflowLine),
      ))),
    });
    if (d.reconciliation) out.push({ title: d.reconcileTitle, blocks: [p(d.reconciliation)] });
  }

  // ── The execution sequence ───────────────────────────────────────────────
  if (d.steps.length) {
    out.push({
      title: d.sequenceTitle,
      blocks: [table(
        [
          { key: 'step', label: 'Step', align: 'left' },
          { key: 'action', label: 'Action', align: 'left' },
          { key: 'owner', label: 'Owner', align: 'right' },
        ],
        d.steps.map((s): TableRow => ({
          step: s.step,
          action: s.detail ? `${s.action} — ${s.detail}` : s.action,
          owner: s.owner,
        })),
      )],
    });
  }

  // ── Caveats ──────────────────────────────────────────────────────────────
  if (d.caveats.length) {
    out.push({
      title: d.caveatsTitle,
      blocks: [`<ul>${d.caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`],
    });
  }

  // ── Capital flow, where the scenario routes capital ──────────────────────
  if (d.capitalFlow) {
    const cf = d.capitalFlow;
    const legs = table(
      [
        // "Sink" is the capital router's word; sources and uses is the
        // finance team's (§22).
        { key: 'leg', label: 'Source → use', align: 'left' },
        { key: 'amount', label: 'Amount', align: 'right' },
        { key: 'servicing', label: 'Servicing', align: 'right' },
        { key: 'debt', label: 'Debt', align: 'right' },
      ],
      cf.legs.map((l): TableRow => ({
        leg: l.label,
        amount: l.amount,
        servicing: l.servicing ?? '—',
        debt: l.debt ?? '—',
      })),
    );
    const notes = cf.legs.filter((l) => l.note);
    out.push({
      title: cf.title,
      blocks: [
        renderKpiStrip([
          { label: CAPITAL_FLOW_LABELS.available, value: cf.available },
          { label: CAPITAL_FLOW_LABELS.allocated, value: cf.routed },
          { label: CAPITAL_FLOW_LABELS.unallocated, value: cf.residual },
        ]),
        // The warning is its own label, as the jsPDF brief prints it.
        cf.overcommitted ? unlabelledCallout('negative', `<p><strong>${escapeHtml(cf.overcommitted)}</strong></p>`) : '',
        legs,
        notes.length
          ? `<ul>${notes.map((l) => `<li><strong>${escapeHtml(l.label)}.</strong> ${escapeHtml(l.note!)}</li>`).join('')}</ul>`
          : '',
        p(cf.netImpact),
      ],
    });
  }

  // ── Valuation assumptions ────────────────────────────────────────────────
  if (d.valuations) {
    out.push({
      title: d.valuations.title,
      blocks: [
        `<p><em>${escapeHtml(d.valuations.note)}</em></p>`,
        `<ul>${d.valuations.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`,
      ],
    });
  }

  // ── Cross-collateral method ──────────────────────────────────────────────
  if (d.crossCollat) {
    out.push({ title: d.crossCollat.title, blocks: [unlabelledCallout('neutral', p(d.crossCollat.text))] });
  }

  return out;
}

/**
 * A toned panel with no label of its own, for a passage the jsPDF brief sets
 * in a box without one — `renderCallout` would print an empty label line.
 */
const unlabelledCallout = (tone: CalloutTone, bodyHtml: string) =>
  `<div class="callout tone-${tone}">${bodyHtml}</div>`;

export interface RenderRationaleInput {
  document: StrategyRationaleDocument;
  clientName: string;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  masthead: string;
  options?: Partial<ReportDesignOptions> | null;
  heroDataUri?: string | null;
  lockup?: BrandLockupProps | null;
  confidentiality?: string | null;
  reference?: string | null;
}

/** The body — cover, sections, closing — without the shell. */
export function renderStrategyRationaleBody(input: RenderRationaleInput): string {
  const d = input.document;
  const cover = renderCover({
    eyebrow: STRATEGY_RATIONALE_NAME,
    title: input.clientName,
    subtitle: STRATEGY_RATIONALE_STANDFIRST,
    masthead: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    meta: [
      { label: 'Generated', value: d.generatedLabel },
      ...(d.scenarioName ? [{ label: 'Scenario', value: d.scenarioName }] : []),
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  const [brief, ...parts] = sectionsOf(d);
  const body = brief.blocks.join('') + parts.map((part) => {
    // The heading travels with the part's opening block: a part that is one
    // line is kept whole, a long one keeps its heading with what follows it.
    // A table keeps itself (`keptTable`), and the heading stays with its
    // first rows by the heading's own rule, so a long one can still split.
    const [first = '', ...rest] = part.blocks.filter(Boolean);
    const opening = isTable(first) ? subhead(part.title) + first : keepTogether(subhead(part.title) + first);
    return opening + rest.join('');
  }).join('');

  // The running head names the client, as the jsPDF brief's footer does: the
  // only chapter's title would repeat the eyebrow beside it on every page.
  const chapter = openChapter(STRATEGY_RATIONALE_NAME, '01', input.clientName, 'body', { memo: true })
    + renderChapterHeader({
      number: '01',
      title: brief.title,
      dek: brief.dek,
      label: ARCHETYPE.chapterLabel,
      unnumbered: true,
    })
    + `<div class="chapter-body">${body}</div>`
    + closeChapter();

  return cover + chapter + renderCompanyPage({ block: input.company, lockup: input.lockup ?? null });
}

export function renderStrategyRationaleDocument(input: RenderRationaleInput): string {
  return renderDocument({
    title: `${STRATEGY_RATIONALE_NAME} — ${input.clientName}`,
    author: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    subject: STRATEGY_RATIONALE_NAME,
    css: buildReportCss({ palette: input.palette, options: input.options ?? null, masthead: input.masthead }),
    bodyHtml: renderStrategyRationaleBody(input),
  });
}

export interface RenderRationaleFromBrandInput {
  document: StrategyRationaleDocument;
  clientName: string;
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  coverArtDataUri?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  reference?: string | null;
  /** The design chosen for Borrowing Capacity; absent, the standard design byte for byte. */
  design?: ReportTemplateDesign | null;
}

export function renderStrategyRationaleFromBrand(input: RenderRationaleFromBrandInput): { html: string; gaps: string[] } {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });
  return {
    html: renderStrategyRationaleDocument({
      document: input.document,
      clientName: input.clientName,
      palette: input.design?.palette ?? brand.palette,
      company: brand.company,
      masthead: brand.masthead,
      lockup: brand.lockup,
      heroDataUri: brand.heroDataUri,
      confidentiality: brand.confidentiality,
      options: withDesignOptions(input.options, input.design),
      reference: input.reference ?? null,
    }),
    gaps: brand.gaps,
  };
}
