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
 * its headline and capacity figures; what we propose and why; how the maths
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
  renderLede,
  type CalloutTone,
  type TableRow,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import { withDesignOptions, type ReportTemplateDesign } from '../../reportDesign/templateDesign.pure.ts';
import {
  STRATEGY_RATIONALE_NAME,
  STRATEGY_RATIONALE_STANDFIRST,
  type RationaleSeverity,
  type StrategyRationaleDocument,
} from './strategyRationale.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['borrowing-capacity'];

const p = (t: string | null | undefined) => (t ? `<p>${escapeHtml(t)}</p>` : '');
/** The design system's subhead (`h2`), as the Snapshot sets one inside a chapter. */
const subhead = (t: string) => `<h2>${escapeHtml(t)}</h2>`;
const keepTogether = (html: string) => (html ? `<div class="${KEEP_TOGETHER_CLASS}">${html}</div>` : '');

/** The severity a lever carries, as the callout tone that says it. */
const SEVERITY_TONE: Record<RationaleSeverity, CalloutTone> = {
  positive: 'positive',
  caution: 'caution',
  critical: 'negative',
  info: 'informative',
};

interface Section {
  title: string;
  dek?: string;
  /** Sibling blocks, in order; the first is kept with the part's heading. */
  blocks: string[];
}

function sectionsOf(d: StrategyRationaleDocument): Section[] {
  const out: Section[] = [];

  // ── The brief: headline and the capacity figures ─────────────────────────
  out.push({
    title: STRATEGY_RATIONALE_NAME,
    dek: STRATEGY_RATIONALE_STANDFIRST,
    blocks: [
      renderLede(d.headline),
      p(d.subHeadline),
      renderKpiStrip(d.kpis.map((k) => ({ label: k.label, value: k.value, foot: k.foot || undefined, tone: k.tone }))),
    ],
  });

  // ── What we propose and why ──────────────────────────────────────────────
  out.push({
    title: d.proposeTitle,
    blocks: d.bullets.length
      ? d.bullets.map((b) => keepTogether(renderCallout(
          SEVERITY_TONE[b.severity],
          b.impactLabel ? `${b.severityLabel} · ${b.impactLabel}` : b.severityLabel,
          `<p><strong>${escapeHtml(b.what)}</strong></p>` + p(b.why) + p(b.cashflowLine),
        )))
      : [p(d.proposeEmpty)],
  });

  // ── How the maths reconciles ─────────────────────────────────────────────
  out.push({ title: d.reconcileTitle, blocks: [p(d.reconciliation)] });

  // ── The execution sequence ───────────────────────────────────────────────
  out.push({
    title: d.sequenceTitle,
    blocks: [d.steps.length
      ? keepTogether(renderDataTable(
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
        ))
      : p(d.sequenceEmpty)],
  });

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
    const legs = renderDataTable(
      [
        { key: 'leg', label: 'Source → sink', align: 'left' },
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
          { label: 'Available', value: cf.available },
          { label: 'Routed', value: cf.routed },
          { label: 'Residual', value: cf.residual },
        ]),
        // The warning is its own label, as the jsPDF brief prints it.
        cf.overcommitted ? unlabelledCallout('negative', `<p><strong>${escapeHtml(cf.overcommitted)}</strong></p>`) : '',
        keepTogether(legs),
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
    const [first = '', ...rest] = part.blocks.filter(Boolean);
    return keepTogether(subhead(part.title) + first) + rest.join('');
  }).join('');

  const chapter = openChapter(STRATEGY_RATIONALE_NAME, '01', brief.title, 'body')
    + renderChapterHeader({ number: '01', title: brief.title, dek: brief.dek, label: ARCHETYPE.chapterLabel })
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
