/**
 * The executed copy of a Partner Portal Agreement, as a print document.
 *
 * This is the artefact a partner organisation and the Command Centre both keep:
 * the agreement as it stood when it was executed, the two parties named, and
 * the acceptance that binds them. It is not a receipt and not a summary — the
 * full text is in it, because a copy of an agreement that does not contain the
 * agreement is not a copy.
 *
 * ## It is a report, and it is built like every other one
 *
 * The first version of this module carried its own `<style>` block: its own
 * page geometry, its own type scale, its own margins, and a navy and a graphite
 * written as hex literals. That is the ninth brand gold in a different costume —
 * it ignored the tenant's brand colour, printed no mark at all, and could not
 * inherit a single improvement the report programme made. Rendered, it showed:
 * a serif fallback where the container ships Inter, a heading hierarchy in
 * which a section title and a sub-clause were the same object, an acknowledgment
 * orphaned across a page break, and a hash running to the trim edge.
 *
 * Everything visual now comes from `reportDesign/` — the same stylesheet, page
 * table, primitives and palette roles as the ten migrated report formats. This
 * module composes; it does not style. Two consequences worth stating:
 *
 *  - **There is not one colour literal below**, and there must never be. Every
 *    colour is a palette role resolved from the tenant's brand snapshot, which
 *    is what makes the document white-label rather than merely un-branded.
 *  - **An improvement to the design system reaches this document for free**, in
 *    all three portals at once, because all three render through here.
 *
 * PURE. No network, no storage, no clock: every value it prints is passed in.
 * That is what makes the document reproducible — the same acceptance and the
 * same brand snapshot produce the same bytes, which is the property that lets
 * the Command Centre hand a partner "the" copy rather than "a" copy.
 */

import { AGREEMENT_DOCUMENT_REVISION } from './partnerAgreementRevision.pure.ts';
import type { CompanyDisclaimer } from './reportDesign/companyBlock.pure.ts';
import { buildReportCss } from './reportDesign/css.pure.ts';
import { resolveSnapshotBrand } from './reportDesign/documentBrand.pure.ts';
import { DENSITY_METRICS, normalizeReportDesignOptions, scaledType } from './reportDesign/options.pure.ts';
import type { ReportDesignOptions } from './reportDesign/options.pure.ts';
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderCover,
  renderDocument,
  renderSidenote,
} from './reportDesign/primitives.pure.ts';
import type { ResolvedReportPalette } from './reportDesign/roles.pure.ts';
import type { ReportBrandSnapshot } from './reportDesign/snapshot.pure.ts';
import { PRINT_TRACKING } from './reportDesign/tokens.pure.ts';
import { PRINT_STACK } from './reportDesign/typography.pure.ts';

export interface AgreementParty {
  /** Legal name of the partner organisation. */
  organisationName: string | null;
  /** Trading name, when it differs and is worth showing. */
  organisationTradingName?: string | null;
  acceptedByName: string | null;
  acceptedByEmail: string | null;
}

export interface AgreementAcknowledgement {
  key: string;
  heading: string;
  statement: string;
}

/** One section of the agreement, for the contents page. */
export interface AgreementSection {
  /** Anchor in `agreementHtml`. Comes from the Markdown renderer's headings. */
  id: string;
  text: string;
}

export interface AgreementExecution {
  portal: 'solicitor' | 'builder' | 'finance';
  portalLabel: string;
  acceptanceId: string;
  version: string;
  title: string;
  documentHash: string | null;
  acceptedAt: string;
  /** Keys the accepting person asserted. Unknown keys are ignored by the caller. */
  acknowledgements: readonly AgreementAcknowledgement[];
  /** Whether the acceptance carries a hashed source address / user agent. */
  hasIpFingerprint: boolean;
  hasUserAgentFingerprint: boolean;
  /** When this copy was produced. Printed, so a re-issued copy is not mistaken for a re-execution. */
  generatedAt: string;
}

/**
 * What a field prints when the record does not have it.
 *
 * Every block below sets a **fixed** set of rows and fills the gaps with this,
 * rather than omitting the row. A document whose shape depends on how complete
 * a record happens to be is a different document each time — one partner's copy
 * has four rows where another's has six, and neither reader can tell whether
 * something is missing or simply not applicable. Saying "not recorded" is both
 * the honest answer and the one that keeps every copy the same shape.
 */
export const NOT_RECORDED = 'Not recorded';

/** Australian long form, in UTC, with the zone named. A bare date is ambiguous in a legal record. */
export function formatExecutionTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return escapeHtml(iso);
  const parts = new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC',
  }).formatToParts(date).map((part) => part.value).join('');
  return `${parts} UTC`;
}

/** `2026-08-07` from an ISO instant, for the cover and the file name. */
function isoDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/**
 * The design this document is set in.
 *
 * Stated rather than defaulted, because the defaults are tuned for a report
 * somebody reads once and this is a contract somebody looks things up in.
 *
 * `justifyText: false` is the departure. A justified measure is the right
 * setting for editorial prose and the wrong one here: the agreement is dense
 * with unbreakable tokens — `AML/CTF`, `section 6-29`, `Anti-Money Laundering
 * and Counter-Terrorism Financing Act 2006` — and justification opens rivers
 * around them. Ragged right also makes an inserted clause visibly an insertion,
 * which is a property a legal document wants.
 */
export const AGREEMENT_DESIGN_OPTIONS: Partial<ReportDesignOptions> = {
  density: 'balanced',
  chapterStyle: 'classic',
  tableStyle: 'classic',
  showSectionNumbers: true,
  showDropCaps: false,
  justifyText: false,
};

// ── Blocks ──────────────────────────────────────────────────────────────────

interface RecordRow {
  label: string;
  value: string | null | undefined;
  /** Identifiers and hashes: set in the mono face and allowed to wrap anywhere. */
  mono?: boolean;
}

/**
 * A label/value block, set as the design system's own data table.
 *
 * `table.data` rather than a definition list, for three reasons: it is the one
 * table style the whole programme shares, so these rows are ruled and spaced
 * exactly like every other table a client receives; `th[scope="row"]` is what
 * makes the pairs navigable in the tagged PDF; and a table cell wraps a long
 * value down its own column instead of pushing the label out of alignment,
 * which is what the previous flexbox rows did to a 64-character hash.
 */
function recordTable(caption: string, rows: readonly RecordRow[], modifier = ''): string {
  const body = rows.map((row) => {
    const raw = String(row.value ?? '').trim();
    const value = raw || NOT_RECORDED;
    // The mono face belongs to identifiers, not to the absence of one:
    // "Not recorded" set in IBM Plex Mono reads as a value that happens to look
    // like prose rather than as a gap.
    const classes = [row.mono && raw ? 'mono-value' : '', raw ? '' : 'absent']
      .filter(Boolean).join(' ');
    return `
          <tr>
            <th scope="row">${escapeHtml(row.label)}</th>
            <td${classes ? ` class="${classes}"` : ''}>${escapeHtml(value)}</td>
          </tr>`;
  }).join('');

  return `
      <div class="table-block">
        <table class="data record${modifier ? ` ${modifier}` : ''}">
          <caption>${escapeHtml(caption)}</caption>
          <tbody>${body}
          </tbody>
        </table>
      </div>`;
}

/**
 * The two parties, side by side.
 *
 * Side by side rather than stacked because that is what a reader is looking
 * for — who is bound to whom — and reading it means comparing the two, not
 * scrolling between them. `display: table` rather than flexbox: WeasyPrint's
 * flex support is partial and version-dependent and its table model is not,
 * which is the same call `css.pure.ts` makes for every other multi-column
 * block in this system.
 *
 * Table cells in one row are equal height by construction, so the panels stay
 * level whatever either side happens to carry.
 */
function partyPair(leftHtml: string, rightHtml: string): string {
  return `
      <div class="party-pair">
        <div class="party-cell">${leftHtml}</div>
        <div class="party-cell">${rightHtml}</div>
      </div>`;
}

/**
 * The contents page, with real page numbers.
 *
 * The numbers are `target-counter(attr(href), page)`, resolved by the engine
 * against the anchors the Markdown renderer already puts on every heading — so
 * they are the pages the sections actually landed on rather than a count
 * somebody maintained. Verified against the pinned engine before this page was
 * designed around it.
 *
 * Its own markup rather than `renderContentsPage`, because that primitive sets
 * the page number as text and this one needs an anchor for the engine to
 * resolve. The classes are the primitive's, so the two pages look identical.
 */
function contentsPage(title: string, sections: readonly AgreementSection[]): string {
  if (!sections.length) return '';

  // "7. Binding customer due-diligence arrangement" carries its own ordinal;
  // the two unnumbered sections do not. Split rather than renumbered — a
  // contents page that numbers a section differently from the heading it points
  // at sends the reader to the wrong clause.
  const rows = sections.map((section) => {
    const match = /^\s*(\d{1,2})\.\s+(.*)$/.exec(section.text);
    const number = match ? match[1].padStart(2, '0') : '';
    const label = match ? match[2] : section.text;
    return `
        <div class="toc-row">
          <span class="toc-no">${escapeHtml(number)}</span>
          <span class="toc-title">${escapeHtml(label)}</span>
          <span class="toc-note"></span>
          <span class="toc-page"><a href="#${escapeHtml(section.id)}"></a></span>
        </div>`;
  }).join('');

  return `
    <section class="page-contents">
      <div class="eyebrow">Contents</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="contents">${rows}
      </div>
    </section>`;
}

/**
 * The closing attestation.
 *
 * A corporate agreement ends by saying who executed it and how, and until now
 * this one ended with a 8.5pt note under a hairline. The wording is the note's,
 * near enough verbatim: this block states only facts already in the record —
 * that acceptance was electronic, when it happened, who it was by, and that the
 * hash identifies the text that was displayed. Nothing here is a new term, and
 * nothing here may become one.
 */
function attestation(
  companyName: string,
  party: AgreementParty,
  execution: AgreementExecution,
): string {
  const acceptedBy = party.acceptedByName?.trim() || NOT_RECORDED;
  const organisation = party.organisationName?.trim() || NOT_RECORDED;

  return `
      <div class="attestation">
        <div class="attestation-label">Execution</div>
        <p class="attestation-lede">
          This is a copy of the Agreement executed electronically on
          ${escapeHtml(formatExecutionTimestamp(execution.acceptedAt))}, produced from the record
          held by ${escapeHtml(companyName)} on
          ${escapeHtml(formatExecutionTimestamp(execution.generatedAt))}. The document hash
          identifies the exact text that was displayed and accepted.
        </p>
        <div class="signature-pair">
          <div class="signature">
            <div class="signature-rule"></div>
            <div class="signature-name">${escapeHtml(organisation)}</div>
            <div class="signature-role">Partner Organisation · accepted by ${escapeHtml(acceptedBy)}</div>
          </div>
          <div class="signature">
            <div class="signature-rule"></div>
            <div class="signature-name">${escapeHtml(companyName)}</div>
            <div class="signature-role">Originating Organisation · Portal operator</div>
          </div>
        </div>
      </div>`;
}

// ── The document ────────────────────────────────────────────────────────────

export interface PartnerAgreementDocumentInput {
  /**
   * The tenant's brand, frozen at generation.
   *
   * The same snapshot the ten report formats take, so the agreement carries the
   * operator's colour, mark and company details rather than a hardcoded navy
   * and no logo at all.
   */
  snapshot: ReportBrandSnapshot;
  /**
   * `global_report_settings.professional_disclaimer`, when the operator wants
   * it on the closing page.
   *
   * Defaults to absent, and the caller currently leaves it so. That disclaimer
   * is written about property and investment advice; printing it at the end of
   * a confidentiality and AML/CTF agreement would put wording nobody drafted
   * for this document inside the covers of a contract. Kept as an input rather
   * than removed, so an operator who does want it has somewhere to say so.
   */
  disclaimer?: CompanyDisclaimer | null;
  party: AgreementParty;
  execution: AgreementExecution;
  /**
   * The rendered agreement body — the output of the shared Markdown renderer,
   * so this module never becomes a second Markdown implementation.
   */
  agreementHtml: string;
  /** Headings from that same render, for the contents page. */
  sections?: readonly AgreementSection[];
  /** Overrides for testing and for a future per-tenant document style. */
  options?: Partial<ReportDesignOptions> | null;
}

export interface PartnerAgreementDocument {
  html: string;
  /**
   * What the brand snapshot was missing.
   *
   * Advisory, exactly as it is for every other format: a copy with no ABN on it
   * is a worse copy, not one worth refusing to produce.
   */
  gaps: string[];
}

export function buildPartnerAgreementDocument(
  input: PartnerAgreementDocumentInput,
): PartnerAgreementDocument {
  const { party, execution, agreementHtml } = input;

  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    // No cover photography on a contract. The typographic cover is the designed
    // state here, not a gap — see `documentBrand.pure.ts` on why the house cover
    // art must never stand in for a tenant's.
    coverArtDataUri: null,
  });

  const options = normalizeReportDesignOptions({ ...AGREEMENT_DESIGN_OPTIONS, ...(input.options ?? {}) });
  const css = buildReportCss({ palette: brand.palette, options, masthead: brand.masthead })
    + agreementCss(brand.palette, options);

  const contact = input.snapshot.company;

  // An acceptance taken before acknowledgments were stored prints what is true
  // of it rather than four statements nobody made — and the heading above it
  // changes with it. "asserted each of the following" over a note saying none
  // were recorded is the document contradicting itself in two lines.
  const acknowledgements = execution.acknowledgements.length
    ? '<h2>Mandatory acknowledgments as executed</h2>'
      + '<p>The person accepting this Agreement on behalf of the Partner Organisation '
      + 'asserted each of the following.</p>'
      + execution.acknowledgements.map((item, index) => renderCallout(
        'neutral',
        `${index + 1} · ${item.heading}`,
        `<p>${escapeHtml(item.statement)}</p>`,
      )).join('')
    : renderSidenote(
      'Mandatory acknowledgments',
      '<p>This acceptance was recorded before the individual acknowledgments were '
      + 'stored against it. The acknowledgments required by the Agreement are set out '
      + 'in the text that follows.</p>',
    );

  // The fingerprints are hashes and stay hashes: "recorded" is the honest
  // statement, and the hash itself is of no use to a reader.
  const fingerprints = [
    execution.hasIpFingerprint ? 'source address (hashed)' : null,
    execution.hasUserAgentFingerprint ? 'user agent (hashed)' : null,
  ].filter(Boolean).join(', ');

  const tradingName = party.organisationTradingName?.trim();
  const bodyHtml = [
    renderCover({
      title: execution.title,
      eyebrow: 'Executed agreement',
      masthead: brand.masthead,
      edition: `VERSION ${execution.version}`,
      meta: [
        { label: 'Partner Organisation', value: party.organisationName?.trim() || NOT_RECORDED },
        { label: 'Portal', value: execution.portalLabel },
        { label: 'Executed', value: isoDate(execution.acceptedAt) || NOT_RECORDED },
      ],
      // Only when it carries an actual mark. A wordmark-only lockup is the
      // company name a second time, 25mm under the masthead that already says
      // it — the same repetition `renderCompanyPage` refuses on the closing
      // page, and it reads worse here because both are set in the accent.
      lockup: brand.lockup?.markDataUri ? brand.lockup : null,
      footerLeft: brand.confidentiality,
      // A short reference, because the cover foot is one line and a full UUID
      // wraps onto two. The whole identifier is in the execution record.
      footerRight: `Ref ${execution.acceptanceId.slice(0, 8)}`,
    }),

    contentsPage(execution.title, input.sections ?? []),

    openChapter('Executed agreement', '01', 'Parties and execution'),
    renderChapterHeader({
      label: 'Part',
      number: '01',
      title: 'Parties and execution',
      dek: 'Who is bound by this Agreement, when it was accepted, and what was '
        + 'acknowledged at the moment of acceptance.',
    }),
    '<div class="chapter-body">',
    partyPair(
      recordTable('Originating Organisation', [
        { label: 'Legal name', value: contact.name },
        { label: 'ABN', value: contact.abn },
        { label: 'Address', value: contact.address },
        { label: 'Email', value: contact.email },
        { label: 'Phone', value: contact.phone },
        { label: 'Website', value: contact.website },
      ]),
      recordTable('Partner Organisation', [
        { label: 'Legal name', value: party.organisationName },
        {
          label: 'Trading name',
          // "Same as legal name" rather than a repeat of the row above it: the
          // row stays, so both parties keep the same shape, and it says
          // something rather than printing the answer twice.
          value: tradingName
            ? (tradingName === party.organisationName?.trim() ? 'Same as legal name' : tradingName)
            : null,
        },
        { label: 'Accepted by', value: party.acceptedByName },
        { label: 'Email', value: party.acceptedByEmail },
        { label: 'Portal', value: execution.portalLabel },
        { label: 'Capacity', value: 'Authorised to bind the Partner Organisation' },
      ]),
    ),
    // Across the full measure, so a 64-character hash sets on one line rather
    // than wrapping to leave a single character under itself.
    recordTable('Execution record', [
      { label: 'Agreement', value: execution.title },
      { label: 'Version', value: execution.version },
      { label: 'Accepted', value: formatExecutionTimestamp(execution.acceptedAt) },
      { label: 'Acceptance record', value: execution.acceptanceId, mono: true },
      { label: 'Document hash (SHA-256)', value: execution.documentHash, mono: true },
      { label: 'Also recorded', value: fingerprints || 'None' },
      // No "copy produced" row: the attestation on the last page states when
      // this copy was produced, in a sentence, and a fact printed twice in one
      // document is a fact a reader has to reconcile.
    ], 'record-wide'),
    acknowledgements,
    '</div>',
    closeChapter(),

    openChapter('Executed agreement', '02', 'The Agreement'),
    renderChapterHeader({
      label: 'Part',
      number: '02',
      title: 'The Agreement',
      dek: 'The text as it stood when it was accepted, identified by the document '
        + 'hash in the execution record.',
    }),
    `<div class="chapter-body agreement">${agreementHtml}`,
    attestation(contact.name || brand.masthead, party, execution),
    '</div>',
    closeChapter(),

    // The closing page, when there is something to put on it.
    //
    // It is a full-bleed dark page carrying the operator's name, their contact
    // routes and their disclaimer. For a tenant who has configured none of the
    // last two it is a dark page with a name on it and nothing else — two lines
    // of ink on a sheet, which `critique.pure.ts` flags on sight and a reader
    // takes for a printing fault. The attestation is a good ending on its own,
    // so the page is earned rather than always printed. What is missing is
    // already reported to the operator through `gaps`.
    brand.company.rows.length || brand.company.disclaimer.paragraphs.length
      ? renderCompanyPage({ block: brand.company, lockup: brand.lockup })
      : '',
  ].join('\n');

  return {
    html: renderDocument({
      title: `${execution.title} — executed copy`,
      author: brand.masthead,
      subject: `Executed copy · ${execution.portalLabel} · version ${execution.version}`,
      css,
      bodyHtml,
    }),
    gaps: brand.gaps,
  };
}

/**
 * The handful of rules this document adds to the shared stylesheet.
 *
 * Everything here is either a layout this document is the only one to need, or
 * a treatment the shared sheet already defines that these blocks borrow. No new
 * colours, no new type sizes: `palette` and `scaledType` are the same values
 * `buildReportCss` sets everything else from, which is what keeps this from
 * becoming a second design system.
 */
function agreementCss(palette: ResolvedReportPalette, options: ReportDesignOptions): string {
  const type = scaledType(options);
  const d = DENSITY_METRICS[options.density];
  const pt = (n: number) => `${Math.round(n * 100) / 100}pt`;

  return `

  /* ── Executed agreement ──────────────────────────────────────────────── */

  /* The contents page numbers itself from the anchors rather than from a count
     somebody maintains. \`attr(href)\` resolves against the heading ids the
     Markdown renderer emits. */
  .page-contents .toc-page a { color: inherit; text-decoration: none; }
  .page-contents .toc-page a::after { content: target-counter(attr(href), page); }
  /* A report's contents annotates each chapter; a contract's is an index of
     clauses and has nothing to say about them. Left in place, the note column
     holds a third of the measure empty and wraps clause titles beside it —
     which cost four of the nineteen entries a second line, and pushed three of
     them onto a sheet of their own at almost no ink. */
  .page-contents .toc-note { display: none; }
  /* Nineteen clauses, not six chapters. The title sets at subhead size so the
     index fits the page it belongs on. */
  .page-contents h1 { font-size: ${pt(type.subhead)}; line-height: 1.2; max-width: 150mm; }
  .page-contents .toc-row > * { padding: ${pt(d.cellPadPt - 1)} 0; }

  /* Two parties, level with each other. Table, not flex — see \`partyPair\`. */
  .party-pair {
    display: table;
    width: 100%;
    table-layout: fixed;
    border-spacing: 6mm 0;
    margin: 0 -6mm;
  }
  .party-pair > .party-cell { display: table-cell; width: 50%; vertical-align: top; }
  .party-pair .table-block { margin-top: 0; }

  /* A record table is label/value, so its row headers take the micro-label
     treatment the column heads have rather than reading as body copy at the
     same weight as the value beside them. */
  table.data.record { table-layout: fixed; }
  table.data.record th[scope="row"] {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    vertical-align: top;
    /* Wide enough for the longest label at this size, and no wider: the value
       column is what has to hold an email address inside half the measure, and
       at 38% \`mithrubanbupathy3@gmail.com\` broke across two lines mid-domain. */
    width: 32%;
  }
  /* Every value wraps inside its own column instead of running to the trim.
     An address is not the only long one — \`mithrubanbupathy3@gmail.com\` has no
     break opportunity in it at all, and set flush to the edge of its panel. */
  table.data.record td { vertical-align: top; overflow-wrap: anywhere; }
  table.data.record td.mono-value {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    word-break: break-all;
  }
  /* Across the full measure the label needs a smaller share, which is what
     gives a 64-character hash a column it fits in. */
  table.data.record-wide th[scope="row"] { width: 26%; }
  /* A field the record does not carry is stated, and set back so it does not
     read with the same authority as one it does. */
  table.data.record td.absent { color: ${palette.mutedInk}; }

  /* ── Closing attestation ─────────────────────────────────────────────── */

  .attestation {
    margin: ${pt(d.blockGapPt + 10)} 0 0;
    padding: ${pt(d.cellPadPt + 7)} 0 0;
    border-top: 1pt solid ${palette.accentFill};
    page-break-inside: avoid;
  }
  .attestation-label {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
    margin-bottom: ${pt(d.paragraphGapPt)};
  }
  .attestation-lede {
    font-size: ${pt(type.caption + 1)};
    color: ${palette.bodyInk};
    max-width: 150mm;
  }
  .signature-pair {
    display: table;
    width: 100%;
    table-layout: fixed;
    border-spacing: 8mm 0;
    margin: ${pt(d.blockGapPt + 6)} -8mm 0;
  }
  .signature-pair > .signature { display: table-cell; width: 50%; vertical-align: bottom; }
  /* The rule a wet signature would sit on. There is no signature to print — the
     Agreement is executed by acceptance — so the rule carries the party's name
     and how they executed, which is the fact the page is attesting to. */
  .signature-rule { border-bottom: 0.75pt solid ${palette.rule}; margin-bottom: ${pt(d.paragraphGapPt)}; }
  .signature-name {
    font-family: ${PRINT_STACK.display};
    font-size: ${pt(type.h3)};
    line-height: 1.2;
    color: ${palette.bodyInk};
  }
  .signature-role {
    font-size: ${pt(type.micro)};
    color: ${palette.mutedInk};
    margin-top: 2pt;
  }`;
}

export const PORTAL_LABELS: Record<string, string> = {
  solicitor: 'Solicitor / Conveyancer Portal',
  builder: 'Builder / Developer Portal',
  finance: 'Finance Partner Portal',
  // A partner outside the three portals, who acknowledged the same
  // instrument through a one-time emailed link. The label says how the
  // agreement was executed, so the document never implies a portal
  // account that does not exist.
  direct: 'Direct Partner Acknowledgement (no portal)',
};

/**
 * The revision, and the two helpers that read it off a path, live in
 * `partnerAgreementRevision.pure.ts` — a module with no imports, because the
 * Command Centre needs the same number and importing this file into the browser
 * to read one integer would pull the whole report stylesheet into the bundle.
 *
 * Re-exported here so every caller that already reaches for the document module
 * keeps working, and so there is still exactly one definition.
 */
export {
  AGREEMENT_DOCUMENT_REVISION,
  agreementRevisionForPath,
  agreementServiceState,
  hasCurrentAgreementCopy,
  type AgreementServiceState,
} from './partnerAgreementRevision.pure.ts';

/**
 * `builder/2026/<acceptance id>.pdf` — sortable, and one object per acceptance
 * per revision.
 *
 * Revision 1 has no suffix, so every copy stored before revisions existed keeps
 * resolving at the path its row already records.
 */
export function agreementStoragePath(
  portal: string,
  acceptanceId: string,
  acceptedAt: string,
  revision: number = AGREEMENT_DOCUMENT_REVISION,
): string {
  const year = Number.isNaN(new Date(acceptedAt).getTime())
    ? 'undated'
    : new Date(acceptedAt).getUTCFullYear().toString();
  const suffix = revision > 1 ? `-r${revision}` : '';
  return `${portal}/${year}/${acceptanceId}${suffix}.pdf`;
}

/** `Partner-Agreement-Kopi-Jantan-Builders-2026-08-07.pdf`, or a safe fallback. */
export function agreementFileName(organisationName: string | null, acceptedAt: string): string {
  const slug = (organisationName || 'partner-organisation')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'partner-organisation';
  const date = isoDate(acceptedAt) || 'undated';
  return `Partner-Agreement-${slug}-${date}.pdf`;
}
