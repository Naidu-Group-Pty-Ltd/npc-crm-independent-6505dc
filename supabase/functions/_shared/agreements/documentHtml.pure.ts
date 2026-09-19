/**
 * Agreement Centre — the print document.
 *
 * Composes a locked agreement template + bound field values + the tenant's
 * frozen brand snapshot into the HTML WeasyPrint renders. Like
 * `partnerAgreementDocument.pure.ts`, this module COMPOSES and does not style:
 * every colour is a palette role resolved from the brand snapshot, every type
 * size comes from the report design system, and an improvement to that system
 * reaches these agreements for free. There is not one colour literal below.
 *
 * White-label rule: the document belongs to the ISSUING ORGANISATION — its
 * mark on the cover, its name in the running metadata. Aurixa/platform
 * attribution appears only as the optional one-line footer, and only when the
 * tenant has switched it on (`showPlatformAttribution`).
 *
 * Content rule: the locked wording is rendered exactly as encoded. Unfilled
 * fields print their ORIGINAL `<<INSERT>>` bracket text, set in the muted ink
 * so a reviewer can see at a glance what is not yet completed — the same
 * honesty rule as `NOT_RECORDED` in the portal-terms document.
 *
 * PURE. No network, no storage, no clock: reproducibility is what lets an
 * executed master be "the" copy rather than "a" copy.
 */

import { buildReportCss } from '../reportDesign/css.pure.ts';
import { resolveSnapshotBrand } from '../reportDesign/documentBrand.pure.ts';
import { DENSITY_METRICS, normalizeReportDesignOptions, scaledType } from '../reportDesign/options.pure.ts';
import type { ReportDesignOptions } from '../reportDesign/options.pure.ts';
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderDocument,
} from '../reportDesign/primitives.pure.ts';
import type { ResolvedReportPalette } from '../reportDesign/roles.pure.ts';
import type { ReportBrandSnapshot } from '../reportDesign/snapshot.pure.ts';
import { PRINT_TRACKING } from '../reportDesign/tokens.pure.ts';
import { PRINT_STACK } from '../reportDesign/typography.pure.ts';

import { placeholderForToken } from './fields.pure.ts';
import type { AgreementFieldValues, AgreementTemplateKey } from './types.pure.ts';
import type {
  AgreementBlock,
  AgreementSectionDef,
  AgreementTemplateContent,
  ClauseGroupBlock,
  ConsentBlock,
  CoverBlock,
  DualPanelBlock,
  EmailTemplateBlock,
  ExecutionBlock,
  ExecutionPartyRole,
  GridBlock,
  GridCellDef,
  NoteBlock,
  WorkflowBlock,
} from './types.pure.ts';
import { EXECUTION_PANEL_LINES } from './types.pure.ts';

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface AgreementSignatureRecord {
  signatoryName: string | null;
  signatoryTitle: string | null;
  legalEntity: string | null;
  signatureTyped: string | null;
  signedAt: string | null;
  method: string | null;
}

export interface AgreementExecutionContext {
  /** Recorded signatures by party role. Absent role → blank panel. */
  signatures: Partial<Record<ExecutionPartyRole, AgreementSignatureRecord>>;
  executedAt?: string | null;
}

export interface AgreementDocumentInput {
  content: AgreementTemplateContent;
  values: AgreementFieldValues;
  /** The tenant's brand, frozen at issue — same snapshot every report takes. */
  snapshot: ReportBrandSnapshot;
  /** `1.0`, `1.1` … or `Draft` for a working preview. */
  versionLabel: string;
  agreementId?: string | null;
  templateContentHash?: string | null;
  /** Status at render time — the running-foot watermark for non-final renders. */
  statusKey?: string | null;
  /**
   * Include the Section E email pack. On for template previews and manual
   * DOCX/PDF exports; off for digitally issued and executed documents — the
   * template's own "delete this guidance card before issue" applied.
   */
  includeTemplatePack?: boolean;
  execution?: AgreementExecutionContext | null;
  /** `Generated securely through Aurixa Systems` — only when the tenant opts in. */
  showPlatformAttribution?: boolean;
  options?: Partial<ReportDesignOptions> | null;
}

export interface AgreementDocument {
  html: string;
  gaps: string[];
}

/** Same reasoning as the portal-terms agreement: a contract, not an editorial. */
export const AGREEMENT_CENTRE_DESIGN_OPTIONS: Partial<ReportDesignOptions> = {
  density: 'balanced',
  chapterStyle: 'classic',
  tableStyle: 'classic',
  showSectionNumbers: false,
  showDropCaps: false,
  justifyText: false,
};

// ── Token substitution ───────────────────────────────────────────────────────

const TOKEN = /\{\{([a-z0-9_]+)\}\}/g;

/** Bound value → escaped text; unfilled → the original bracket, muted. */
export function substituteTokens(
  text: string,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
): string {
  return escapeHtml(text).replace(TOKEN, (_, token: string) => {
    const value = values[token];
    const filled = value !== null && value !== undefined && String(value).trim() !== '';
    return filled
      ? `<span class="agc-bound">${escapeHtml(String(value))}</span>`
      : `<span class="agc-unfilled">${escapeHtml(placeholderForToken(key, token))}</span>`;
  });
}

// ── Block renderers ──────────────────────────────────────────────────────────

const CHECKBOX_EMPTY = '☐';
const CHECKBOX_CHECKED = '☑';

function renderCoverPage(
  block: CoverBlock,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
  brand: { lockup: { markDataUri?: string | null } | null; masthead: string },
  versionLabel: string,
): string {
  const companyName = substituteTokens(block.companyNameToken, key, values);
  const mark = brand.lockup?.markDataUri
    ? `<img class="agc-cover-mark" src="${brand.lockup.markDataUri}" alt="" />`
    : `<div class="agc-cover-mark-fallback">${companyName}</div>`;
  // Who is bound, and on what terms — the block a front sheet exists to carry.
  // It replaced a template descriptor and a row of EDITABLE / BRAND-READY
  // chips: those describe the product to somebody choosing a template, and on
  // an executed agreement they are marketing.
  const particulars = block.particulars
    .map((entry) => {
      const value = substituteTokens(entry.value, key, values);
      const unfilled = /^&lt;&lt;.*&gt;&gt;$/.test(value.trim()) || value.trim() === '';
      return `<div class="agc-cover-particular">
          <dt>${escapeHtml(entry.label)}</dt>
          <dd${unfilled ? ' class="agc-unfilled"' : ''}>${value || '&mdash;'}</dd>
        </div>`;
    })
    .join('');

  // Three bands, matching the Word cover exactly: a full-bleed brand canvas,
  // the paper carrying the mark and the particulars, and a quiet foot.
  //
  // The bands exist because `page-cover` is a ZERO-MARGIN page — the design
  // system reserves it for a full-bleed treatment ("Full-bleed obsidian. No
  // chrome."). This cover was written as ordinary flowed content and inherited
  // that page, so every line sat hard against the paper's edge with the title
  // set at report-cover scale, four lines deep and running out of the page.
  // Each band now owns its own inset.
  return `
    <section class="agc-cover page-cover">
      <div class="agc-cover-canvas">
        <div class="agc-cover-company">${companyName}</div>
        <h1 class="agc-cover-title">${block.titleLines.map((line) => escapeHtml(line)).join('<br/>')}</h1>
        <div class="agc-cover-hair"></div>
        <div class="agc-cover-issued">${escapeHtml(block.issuedByLine)}</div>
      </div>
      <div class="agc-cover-paper">
        ${mark}
        <div class="agc-cover-particulars-label">Particulars</div>
        <div class="agc-cover-particulars-rule"></div>
        <dl class="agc-cover-particulars">${particulars}</dl>
      </div>
      <div class="agc-cover-foot">
        <div class="agc-cover-version">${substituteTokens(block.versionLine, key, values)}</div>
        <div class="agc-cover-agreement-version">Agreement version ${escapeHtml(versionLabel)}</div>
        <div class="agc-cover-review">${escapeHtml(block.reviewStatement)}</div>
      </div>
    </section>`;
}

function renderNote(block: NoteBlock, key: AgreementTemplateKey, values: AgreementFieldValues): string {
  return renderCallout('neutral', block.label, `<p>${substituteTokens(block.body, key, values)}</p>`);
}

function renderChoiceCell(
  cell: GridCellDef,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
): string {
  const choice = cell.choice!;
  const raw = values[choice.fieldKey];
  const selected = raw === null || raw === undefined ? '' : String(raw);
  const optionValues = choice.options.map((option) => option.value);
  const customValue = selected && !optionValues.includes(selected) ? selected : '';

  const parts = choice.options.map((option) => {
    const isOther = option.value === 'other';
    const checked = selected === option.value || (isOther && Boolean(customValue));
    let trailing = '';
    if (isOther) {
      const otherText = choice.otherFieldKey ? values[choice.otherFieldKey] : customValue;
      if (otherText !== null && otherText !== undefined && String(otherText).trim() !== '') {
        trailing = ` <span class="agc-bound">${escapeHtml(String(otherText))}</span>`;
      }
    }
    return `<span class="agc-choice${checked ? ' agc-choice-on' : ''}">`
      + `<span class="agc-box">${checked ? CHECKBOX_CHECKED : CHECKBOX_EMPTY}</span> ${escapeHtml(option.label)}${trailing}</span>`;
  });

  const lead = choice.lead ? `<span class="agc-choice-lead">${escapeHtml(choice.lead)}</span> ` : '';
  return `${lead}${parts.join('<span class="agc-choice-gap"></span>')}`;
}

function renderCellValue(cell: GridCellDef, key: AgreementTemplateKey, values: AgreementFieldValues): string {
  if (cell.choice) return renderChoiceCell(cell, key, values);
  if (cell.template) return substituteTokens(cell.template, key, values);
  if (cell.fieldKey) return substituteTokens(`{{${cell.fieldKey}}}`, key, values);
  return escapeHtml(cell.text ?? '');
}

function renderGrid(block: GridBlock, key: AgreementTemplateKey, values: AgreementFieldValues): string {
  const rows = block.rows.map((cells) => {
    const rendered = cells.map((cell) => `
            <th scope="row">${escapeHtml(cell.label)}</th>
            <td${cells.length === 1 ? ' colspan="3"' : ''}>${renderCellValue(cell, key, values)}</td>`).join('');
    return `<tr>${rendered}</tr>`;
  }).join('');

  return `
      <div class="table-block">
        <table class="data agc-grid">
          <tbody>${rows}</tbody>
        </table>
      </div>`;
}

function renderDualPanel(block: DualPanelBlock, key: AgreementTemplateKey, values: AgreementFieldValues): string {
  const panel = (side: { title: string; bullets: string[] }) => `
        <div class="agc-panel">
          <div class="agc-panel-title">${escapeHtml(side.title)}</div>
          <ul class="agc-panel-list">
            ${side.bullets.map((item) => `<li>${substituteTokens(item, key, values)}</li>`).join('\n            ')}
          </ul>
        </div>`;
  return `
      <div class="agc-pair">
        <div class="agc-pair-cell">${panel(block.left)}</div>
        <div class="agc-pair-cell">${panel(block.right)}</div>
      </div>`;
}

function renderClauses(block: ClauseGroupBlock, key: AgreementTemplateKey, values: AgreementFieldValues): string {
  return block.clauses.map((clause) => `
      <div class="agc-clause">
        <h3 class="agc-clause-heading"><span class="agc-clause-no">${escapeHtml(clause.number)}.</span> ${escapeHtml(clause.heading)}</h3>
        ${clause.subclauses.map((sub) => `
        <p class="agc-subclause"><span class="agc-subclause-no">${escapeHtml(sub.number)}</span>${substituteTokens(sub.text, key, values)}</p>`).join('')}
      </div>`).join('');
}

function renderWorkflow(block: WorkflowBlock): string {
  return `
      <div class="agc-workflow">
        ${block.steps.map((step) => `
        <div class="agc-step">
          <div class="agc-step-no">${escapeHtml(step.num)}</div>
          <div class="agc-step-title">${escapeHtml(step.title)}</div>
          <div class="agc-step-text">${escapeHtml(step.text)}</div>
        </div>`).join('')}
      </div>`;
}

function renderEmailTemplate(block: EmailTemplateBlock, key: AgreementTemplateKey, values: AgreementFieldValues): string {
  return `
      <div class="agc-pair agc-email">
        <div class="agc-pair-cell">
          <div class="agc-email-subject-label">${escapeHtml(block.subjectLabel)}</div>
          <div class="agc-email-subject">${substituteTokens(block.subject, key, values)}</div>
          ${block.bodyParagraphs.map((p) => `<p>${substituteTokens(p, key, values)}</p>`).join('\n          ')}
          ${block.signoffLines.map((line) => `<div class="agc-email-signoff">${substituteTokens(line, key, values)}</div>`).join('\n          ')}
        </div>
        <div class="agc-pair-cell">
          <div class="agc-panel-title">${escapeHtml(block.checklistTitle)}</div>
          ${block.checklist.map((item) => `
          <div class="agc-check-item">
            <div class="agc-step-no">${escapeHtml(item.step)}</div>
            <div><div class="agc-check-title">${escapeHtml(item.title)}</div>
            <div class="agc-check-detail">${escapeHtml(item.detail)}</div></div>
          </div>`).join('')}
          <div class="agc-panel-title agc-attachments-title">${escapeHtml(block.attachmentsTitle)}</div>
          <ul class="agc-panel-list">
            ${block.attachments.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n            ')}
          </ul>
        </div>
      </div>`;
}

const SIGNATURE_RULE = '______________________________';
const DATE_RULE = '____ / ____ / ______';
const WITNESS_RULE = '__________________';

/** The entity a blank panel prefers on its "Legal entity" line. */
function panelEntity(role: ExecutionPartyRole, key: AgreementTemplateKey, values: AgreementFieldValues): unknown {
  if (role === 'principal') {
    return key === 'strategic_property_referral' ? values.ba_legal_name : values.ba_legal_name;
  }
  if (role === 'partner') return values.fp_legal_name;
  if (role === 'loan_writer') return values.lw_entity;
  return null;
}

function panelPrefill(role: ExecutionPartyRole, values: AgreementFieldValues, field: 'name' | 'title'): unknown {
  if (role === 'principal') return values[`principal_signatory_${field}`];
  if (role === 'partner') return values[`partner_signatory_${field}`];
  return null;
}

function line(label: string, valueHtml: string): string {
  return `<div class="agc-sig-line"><span class="agc-sig-label">${escapeHtml(label)}</span> ${valueHtml}</div>`;
}

function boundOr(value: unknown, fallback: string): string {
  const filled = value !== null && value !== undefined && String(value).trim() !== '';
  return filled
    ? `<span class="agc-bound">${escapeHtml(String(value))}</span>`
    : `<span class="agc-unfilled">${escapeHtml(fallback)}</span>`;
}

function renderExecution(
  block: ExecutionBlock,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
  execution: AgreementExecutionContext | null | undefined,
): string {
  const panels = block.parties.map((party) => {
    const signature = execution?.signatures?.[party.role] ?? null;
    const entity = signature?.legalEntity ?? panelEntity(party.role, key, values);
    const name = signature?.signatoryName ?? panelPrefill(party.role, values, 'name');
    const title = signature?.signatoryTitle ?? panelPrefill(party.role, values, 'title');

    const signatureLine = signature?.signatureTyped
      ? `<span class="agc-sig-typed">${escapeHtml(signature.signatureTyped)}</span>`
      : `<span class="agc-rule">${SIGNATURE_RULE}</span>`;
    const dateLine = signature?.signedAt
      ? `<span class="agc-bound">${escapeHtml(signature.signedAt.slice(0, 10))}</span>`
      : `<span class="agc-rule">${DATE_RULE}</span>`;

    return `
        <div class="agc-pair-cell">
          <div class="agc-sig-panel">
            <div class="agc-panel-title">${escapeHtml(party.title)}</div>
            ${line(EXECUTION_PANEL_LINES.legalEntity, boundOr(entity, '<<INSERT>>'))}
            ${line(EXECUTION_PANEL_LINES.signatoryName, boundOr(name, '<<INSERT>>'))}
            ${line(EXECUTION_PANEL_LINES.signatoryTitle, boundOr(title, '<<INSERT>>'))}
            ${line(EXECUTION_PANEL_LINES.signature, signatureLine)}
            ${line(EXECUTION_PANEL_LINES.date, dateLine)}
            ${line(EXECUTION_PANEL_LINES.witness, `<span class="agc-rule">${WITNESS_RULE}</span>`)}
            ${signature?.signatureTyped
              ? `<div class="agc-sig-method">Executed electronically${signature.method === 'typed_electronic' ? ' — typed signature' : ''}</div>`
              : ''}
          </div>
        </div>`;
  }).join('');

  return `<div class="agc-pair agc-sig-pair">${panels}</div>`;
}

function renderConsent(block: ConsentBlock, key: AgreementTemplateKey, values: AgreementFieldValues): string {
  return `
      ${renderCallout('neutral', block.label, `<p>${substituteTokens(block.body, key, values)}</p>`)}
      <div class="table-block">
        <table class="data agc-grid"><tbody><tr>
          <th scope="row">${escapeHtml(block.signatureLabel)}</th>
          <td><span class="agc-rule">${SIGNATURE_RULE}</span></td>
          <th scope="row">${escapeHtml(block.dateLabel)}</th>
          <td><span class="agc-rule">${DATE_RULE}</span></td>
        </tr></tbody></table>
      </div>`;
}

function renderBlock(
  block: AgreementBlock,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
  input: AgreementDocumentInput,
  brand: { lockup: { markDataUri?: string | null } | null; masthead: string },
): string {
  switch (block.kind) {
    case 'cover': return renderCoverPage(block, key, values, brand, input.versionLabel);
    case 'note': return renderNote(block, key, values);
    case 'emailTemplate': return renderEmailTemplate(block, key, values);
    case 'grid': return renderGrid(block, key, values);
    case 'dualPanel': return renderDualPanel(block, key, values);
    case 'clauses': return renderClauses(block, key, values);
    case 'workflow': return renderWorkflow(block);
    case 'execution': return renderExecution(block, key, values, input.execution);
    case 'consent': return renderConsent(block, key, values);
    default: return '';
  }
}

// ── Contents page ────────────────────────────────────────────────────────────

function contentsPage(title: string, sections: readonly AgreementSectionDef[]): string {
  const rows = sections.map((section) => `
        <div class="toc-row">
          <span class="toc-no">${escapeHtml(section.header?.badge ?? '')}</span>
          <span class="toc-title">${escapeHtml(section.header?.heading ?? '')}</span>
          <span class="toc-note"></span>
          <span class="toc-page"><a href="#agc-${escapeHtml(section.id)}"></a></span>
        </div>`).join('');
  return `
    <section class="page-contents">
      <div class="eyebrow">Contents</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="contents">${rows}
      </div>
    </section>`;
}

// ── The document ─────────────────────────────────────────────────────────────

export function buildAgreementDocument(input: AgreementDocumentInput): AgreementDocument {
  const { content, values } = input;
  const key = content.key;

  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: null,
    coverArtDataUri: null,
  });

  const options = normalizeReportDesignOptions({
    ...AGREEMENT_CENTRE_DESIGN_OPTIONS,
    ...(input.options ?? {}),
  });
  const css = buildReportCss({ palette: brand.palette, options, masthead: brand.masthead })
    + agreementCentreCss(brand.palette, options);

  const sections = content.sections.filter((section) =>
    section.audience === 'always' || input.includeTemplatePack === true);
  const tocSections = sections.filter((section) => section.header !== null);

  const body: string[] = [];
  for (const section of sections) {
    if (section.header === null) {
      // The cover renders its own full page.
      for (const block of section.blocks) body.push(renderBlock(block, key, values, input, brand));
      body.push(contentsPage(content.title, tocSections));
      continue;
    }
    const { badge, heading, hint, sub } = section.header;
    const dek = [hint, sub].filter(Boolean).join(' · ');
    body.push(openChapter(content.title, badge, heading));
    body.push(`<div id="agc-${escapeHtml(section.id)}"></div>`);
    body.push(renderChapterHeader({ label: 'Section', number: badge, title: heading, dek }));
    body.push('<div class="chapter-body">');
    for (const block of section.blocks) body.push(renderBlock(block, key, values, input, brand));
    body.push('</div>');
    body.push(closeChapter());
  }

  // The execution record — facts about how the digital execution happened,
  // clearly the platform's record rather than agreement wording. Only on a
  // document that carries at least one signature.
  const signatures = Object.entries(input.execution?.signatures ?? {})
    .filter(([, record]) => record?.signatureTyped);
  if (signatures.length > 0) {
    const rows = signatures.map(([role, record]) => `
          <tr>
            <th scope="row">${escapeHtml(role === 'principal' ? 'Issuing organisation' : 'Finance partner')}</th>
            <td>${escapeHtml(record!.signatoryName ?? '')}${record!.signatoryTitle ? ` · ${escapeHtml(record!.signatoryTitle)}` : ''}
              — signed ${escapeHtml(record!.signedAt ?? '')}</td>
          </tr>`).join('');
    body.push(`
      <div class="agc-execution-record">
        <div class="agc-exec-label">Execution record</div>
        <div class="table-block"><table class="data agc-grid"><tbody>
          <tr><th scope="row">Agreement</th><td>${escapeHtml(content.title)} — version ${escapeHtml(input.versionLabel)}</td></tr>
          ${input.agreementId ? `<tr><th scope="row">Agreement record</th><td class="agc-mono">${escapeHtml(input.agreementId)}</td></tr>` : ''}
          ${input.templateContentHash ? `<tr><th scope="row">Content fingerprint</th><td class="agc-mono">${escapeHtml(input.templateContentHash)}</td></tr>` : ''}
          ${rows}
        </tbody></table></div>
      </div>`);
  }

  if (brand.company.rows.length || brand.company.disclaimer.paragraphs.length) {
    body.push(renderCompanyPage({ block: brand.company, lockup: brand.lockup }));
  }

  // `showPlatformAttribution` used to stamp "Generated securely through Aurixa
  // Systems" onto the document. It is deliberately inert now: the platform no
  // longer issues, records or stands behind any agreement between two
  // independent parties, and a line on the page saying otherwise is the exact
  // implication being removed. The input is kept so existing callers still
  // type-check; it prints nothing. See `templateResource.pure.ts`.

  // A plain label, not a lifecycle status. The state machine went with the
  // workflow, and a blank template has no status to report.
  const statusLabel = input.statusKey ?? null;

  return {
    html: renderDocument({
      title: `${content.title} — version ${input.versionLabel}`,
      author: brand.masthead,
      subject: statusLabel ? `${content.title} · ${statusLabel}` : content.title,
      css,
      bodyHtml: body.join('\n'),
    }),
    gaps: brand.gaps,
  };
}

// ── Storage paths ────────────────────────────────────────────────────────────

/**
 * `agreement-centre/<agreement id>/v1-0/issued.pdf` in the private
 * `partner-agreements` bucket. One object per version per artefact kind per
 * document revision; written once, never replaced.
 *
 * The revision is a path suffix (`issued-r2.pdf`) rather than a column, and
 * **revision 1 carries no suffix** so every artefact stored before revisions
 * existed still resolves at the path already recorded against its row. A
 * refresh therefore writes a new object beside the old one and repoints the
 * row, which is what keeps `upsert: false` honest — see
 * `documentRevision.pure.ts` for why the bytes are a cache and not the record.
 */
export function agreementCentreStoragePath(
  agreementId: string,
  versionLabel: string,
  kind: 'issued' | 'executed',
  revision = 1,
): string {
  const safeLabel = versionLabel.replace(/[^0-9A-Za-z]+/g, '-');
  const suffix = revision > 1 ? `-r${revision}` : '';
  return `agreement-centre/${agreementId}/v${safeLabel}/${kind}${suffix}.pdf`;
}

export function agreementDownloadFileName(
  title: string,
  partnerName: string | null,
  versionLabel: string,
  kind: 'draft' | 'issued' | 'executed',
): string {
  const slug = (value: string) => value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  const parts = [slug(title), partnerName ? slug(partnerName) : '', `v${versionLabel.replace(/\./g, '-')}`, kind]
    .filter(Boolean);
  return `${parts.join('-')}.pdf`;
}

// ── CSS ──────────────────────────────────────────────────────────────────────

/**
 * The rules this document adds to the shared stylesheet. Palette roles and the
 * scaled type ramp only — no new colours, no new sizes.
 */
function agreementCentreCss(palette: ResolvedReportPalette, options: ReportDesignOptions): string {
  const type = scaledType(options);
  const d = DENSITY_METRICS[options.density];
  const pt = (n: number) => `${Math.round(n * 100) / 100}pt`;

  return `

  /* ── Agreement Centre document ─────────────────────────────────────────── */

  .page-contents .toc-page a { color: inherit; text-decoration: none; }
  .page-contents .toc-page a::after { content: target-counter(attr(href), page); }
  .page-contents .toc-note { display: none; }
  .page-contents h1 { font-size: ${pt(type.subhead)}; line-height: 1.2; max-width: 150mm; }

  /* Cover — three full-bleed bands on the zero-margin cover page.
     Matches the Word cover band for band, so the two deliverables are one
     document in two formats rather than two designs. */
  .agc-cover {
    page-break-after: always;
    color: ${palette.bodyInk};
    /* A4 exactly: the bands sum to the page so none can spill to a second. */
    height: 297mm;
  }
  .agc-cover-canvas {
    box-sizing: border-box;
    height: 100mm;
    padding: 24mm 22mm 0;
    background: ${palette.field};
  }
  .agc-cover-company {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    /* Not accentOnField: its contrast floor is the DISPLAY floor, so it is only
       promised to be legible at display size and this is 7.5pt. The hairline
       below keeps the brand note, which is what that floor is actually for.
       This line is a token, so it also depends on the .agc-cover-canvas
       override further down — without it the span's paper ink wins over
       whatever the band sets here. */
    color: ${palette.onFieldInk};
    margin: 0 0 9mm;
  }
  .agc-cover-title {
    font-family: ${PRINT_STACK.display};
    /* Explicitly sized rather than the coverTitle scale: the report cover's
       display scale set this four lines deep and past the page edge. */
    font-size: 27pt;
    line-height: 1.14;
    font-weight: 400;
    color: ${palette.onFieldInk};
    margin: 0;
    /* The band's full measure. The content module declares its own line breaks
       in titleLines; a narrower measure re-wrapped the first of them and put
       the title three ragged lines deep. */
    max-width: 166mm;
  }
  .agc-cover-hair {
    width: 34mm;
    border-top: 0.75pt solid ${palette.accentOnField};
    margin: 7mm 0 4mm;
  }
  .agc-cover-issued {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.onFieldInk};
    opacity: 0.72;
  }
  .agc-cover-paper {
    box-sizing: border-box;
    height: 151mm;
    padding: 16mm 22mm 0;
    background: ${palette.paper};
  }
  .agc-cover-mark { max-height: 18mm; max-width: 60mm; margin-bottom: 12mm; }
  .agc-cover-mark-fallback {
    font-family: ${PRINT_STACK.display};
    font-size: ${pt(type.h2)};
    color: ${palette.bodyInk};
    margin-bottom: 12mm;
  }
  .agc-cover-particulars-label {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
  }
  .agc-cover-particulars-rule {
    width: 22mm;
    border-top: 1pt solid ${palette.accentOnPaper};
    margin: 2mm 0 5mm;
  }
  .agc-cover-particulars { max-width: 150mm; margin: 0; }
  .agc-cover-particular {
    display: flex;
    gap: 8mm;
    padding: 2.6mm 0;
    border-bottom: 0.5pt solid ${palette.rule};
  }
  .agc-cover-particular dt {
    flex: 0 0 30mm;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    align-self: center;
  }
  .agc-cover-particular dd {
    margin: 0;
    font-family: ${PRINT_STACK.display};
    font-size: ${pt(type.body + 1)};
    color: ${palette.bodyInk};
  }
  .agc-cover-foot {
    box-sizing: border-box;
    height: 46mm;
    padding: 10mm 22mm 0;
    background: ${palette.paperAlt};
  }
  .agc-cover-version {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.caption)};
    color: ${palette.bodyInk};
  }
  .agc-cover-agreement-version {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    color: ${palette.mutedInk};
    margin-top: 2pt;
  }
  .agc-cover-review {
    font-size: ${pt(type.micro)};
    color: ${palette.mutedInk};
    margin-top: ${pt(d.paragraphGapPt)};
    border-top: 0.5pt solid ${palette.rule};
    padding-top: ${pt(d.paragraphGapPt)};
  }

  /* Field states. The unfilled bracket keeps the template's own text.

     Both inks are PAPER roles — bodyInk and mutedInk are only allowed on the
     paper grounds — and every substituted token wears one of them wherever it
     lands. On the cover's dark canvas that painted graphite on near-black: the
     tenant's own name at the head of its own agreement, at about 1.2:1. The
     ground has to win there, so a token on the canvas inherits the band's ink
     instead. The distinction between bound and unfilled is worth nothing if
     neither can be read. */
  .agc-bound { color: ${palette.bodyInk}; }
  .agc-unfilled { color: ${palette.mutedInk}; }
  .agc-cover-canvas .agc-bound,
  .agc-cover-canvas .agc-unfilled { color: inherit; }
  .agc-cover-canvas .agc-unfilled { opacity: 0.72; }
  .agc-rule { color: ${palette.mutedInk}; letter-spacing: 0.06em; }

  /* Detail / schedule grids — four columns, label/value twice. */
  table.data.agc-grid { table-layout: fixed; }
  table.data.agc-grid th[scope="row"] {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    vertical-align: top;
    width: 18%;
  }
  table.data.agc-grid td { vertical-align: top; overflow-wrap: anywhere; width: 32%; }
  table.data.agc-grid tr { page-break-inside: avoid; }
  .agc-mono { font-family: ${PRINT_STACK.mono}; font-size: ${pt(type.micro)}; word-break: break-all; }

  .agc-choice { white-space: nowrap; }
  .agc-choice-on { color: ${palette.bodyInk}; }
  .agc-choice-gap { display: inline-block; width: 8pt; }
  .agc-box { font-size: ${pt(type.body + 1)}; }
  .agc-choice-lead { display: block; margin-bottom: 2pt; }

  /* Side-by-side responsibility panels. Table, not flex — WeasyPrint. */
  .agc-pair {
    display: table;
    width: 100%;
    table-layout: fixed;
    border-spacing: 5mm 0;
    margin: ${pt(d.blockGapPt)} -5mm;
    page-break-inside: avoid;
  }
  .agc-pair > .agc-pair-cell { display: table-cell; width: 50%; vertical-align: top; }
  .agc-panel {
    border-top: 1.5pt solid ${palette.accentFill};
    padding-top: ${pt(d.paragraphGapPt)};
  }
  .agc-panel-title {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
    margin-bottom: ${pt(d.paragraphGapPt)};
  }
  .agc-panel-list { margin: 0; padding-left: 5mm; }
  .agc-panel-list li { margin-bottom: ${pt(d.paragraphGapPt - 2)}; font-size: ${pt(type.caption + 1)}; }

  /* Clause groups. */
  .agc-clause { page-break-inside: avoid; margin-bottom: ${pt(d.blockGapPt)}; }
  .agc-clause-heading {
    font-family: ${PRINT_STACK.display};
    font-size: ${pt(type.h3)};
    color: ${palette.bodyInk};
    margin: 0 0 ${pt(d.paragraphGapPt)};
  }
  .agc-clause-no { color: ${palette.accentOnPaper}; }
  .agc-subclause {
    margin: 0 0 ${pt(d.paragraphGapPt - 1)};
    padding-left: 11mm;
    text-indent: -11mm;
    font-size: ${pt(type.caption + 1.5)};
  }
  .agc-subclause-no {
    display: inline-block;
    width: 11mm;
    text-indent: 0;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.caption)};
    color: ${palette.mutedInk};
  }

  /* Referral workflow — seven stages, kept whole. */
  .agc-workflow { page-break-inside: avoid; margin: ${pt(d.blockGapPt)} 0; }
  .agc-step {
    display: table;
    width: 100%;
    table-layout: fixed;
    border-top: 0.5pt solid ${palette.rule};
    padding: ${pt(d.paragraphGapPt - 1)} 0;
    page-break-inside: avoid;
  }
  .agc-step > * { display: table-cell; vertical-align: top; }
  .agc-step-no {
    width: 10mm;
    font-family: ${PRINT_STACK.display};
    font-size: ${pt(type.h3)};
    color: ${palette.accentOnPaper};
  }
  .agc-step-title {
    width: 38mm;
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.bodyInk};
    padding-top: 2pt;
  }
  .agc-step-text { font-size: ${pt(type.caption + 1)}; color: ${palette.mutedInk}; }

  /* Email pack. */
  .agc-email-subject-label {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
  }
  .agc-email-subject {
    font-family: ${PRINT_STACK.display};
    font-size: ${pt(type.h3)};
    margin-bottom: ${pt(d.paragraphGapPt)};
  }
  .agc-email p { font-size: ${pt(type.caption + 1)}; }
  .agc-email-signoff { font-size: ${pt(type.caption + 1)}; }
  .agc-check-item { display: table; width: 100%; padding: ${pt(d.paragraphGapPt - 2)} 0; }
  .agc-check-item > * { display: table-cell; vertical-align: top; }
  .agc-check-item .agc-step-no { width: 8mm; }
  .agc-check-title {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
  }
  .agc-check-detail { font-size: ${pt(type.caption)}; color: ${palette.mutedInk}; }
  .agc-attachments-title { margin-top: ${pt(d.blockGapPt)}; }

  /* Execution panels — never split across a page. */
  .agc-sig-pair { page-break-inside: avoid; }
  .agc-sig-panel {
    border: 0.75pt solid ${palette.rule};
    border-top: 1.5pt solid ${palette.accentFill};
    padding: ${pt(d.cellPadPt + 2)};
    page-break-inside: avoid;
  }
  .agc-sig-line { margin-bottom: ${pt(d.paragraphGapPt)}; font-size: ${pt(type.caption + 1)}; }
  .agc-sig-label {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    color: ${palette.mutedInk};
  }
  .agc-sig-typed {
    font-family: ${PRINT_STACK.display};
    font-style: italic;
    font-size: ${pt(type.h3)};
    color: ${palette.bodyInk};
    border-bottom: 0.75pt solid ${palette.rule};
    display: inline-block;
    min-width: 45mm;
  }
  .agc-sig-method {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    color: ${palette.accentOnPaper};
    margin-top: ${pt(d.paragraphGapPt)};
  }

  /* Execution record + attribution. */
  .agc-execution-record { page-break-inside: avoid; margin-top: ${pt(d.blockGapPt + 8)}; }
  .agc-exec-label {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
    border-top: 1pt solid ${palette.accentFill};
    padding-top: ${pt(d.paragraphGapPt)};
  }
  .agc-attribution {
    font-family: ${PRINT_STACK.mono};
    font-size: ${pt(type.micro)};
    color: ${palette.mutedInk};
    text-align: center;
    margin-top: ${pt(d.blockGapPt)};
  }`;
}
