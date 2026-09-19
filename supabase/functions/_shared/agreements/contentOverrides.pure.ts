/**
 * Agreement Centre — clause-level text overrides.
 *
 * ## Why this exists, and what it does NOT do
 *
 * `types.pure.ts` states the rule that governs everything here: the supplied
 * legal wording is LOCKED, and no code in this repository rewrites it. That
 * rule is about the *template*. It is not about a particular agreement: two
 * counterparties negotiating one instrument routinely amend a clause, and until
 * now the only editable things in the document were the bracketed inserts, so a
 * negotiated wording change meant leaving the product entirely.
 *
 * This module keeps both truths:
 *
 *  - The template content modules are still untouched and still hashed
 *    (`templateContentHash`), so "which wording did this build ship" stays
 *    answerable and a template edit is still visible as a hash change.
 *  - A single agreement may carry a map of **per-node text overrides**, keyed by
 *    a stable path into the content tree. Nothing is replaced in place; the
 *    override map is applied as a pure transform at render time, so the
 *    original is always recoverable and an override is always attributable.
 *
 * Consequences that are deliberate:
 *  - Overrides live in the agreement's field values under
 *    `CONTENT_OVERRIDES_VALUE_KEY`, which means the version row's frozen
 *    `field_values` freezes the amended wording with the rest of the document.
 *    An issued version can never be re-read with someone else's later edits.
 *  - Paths are content-shaped, not positional-by-flattening: a path names its
 *    section id, block index and node. A stale path (template restructured)
 *    simply stops matching — `normaliseContentOverrides` drops it rather than
 *    letting it land on the wrong clause.
 *  - Both agreements — Strategic Property Referral (01) and Finance Referral &
 *    Commission (02) — are covered, because the traversal is over the block
 *    union and not over either template's particular shape.
 *
 * PURE. Shared verbatim by the edge functions and the browser bridge.
 */

import type {
  AgreementBlock,
  AgreementSectionDef,
  AgreementTemplateContent,
} from './types.pure.ts';

/** path → replacement text. */
export type AgreementContentOverrides = Record<string, string>;

/** Reserved key inside `AgreementFieldValues` carrying the override map. */
export const CONTENT_OVERRIDES_VALUE_KEY = '__content_overrides';

/** `schedule_extras` key the map is stored under on `partner_agreements`. */
export const CONTENT_OVERRIDES_EXTRA_KEY = 'content_overrides';

export interface AgreementContentSlot {
  /** Stable path — the override key. */
  path: string;
  /** The template's own text at this path. */
  text: string;
  /** Section the slot belongs to (jump links / audit summaries). */
  sectionId: string;
  /** Human label for an audit list — "Clause 11.2", "Cover title", …. */
  label: string;
  /** Long prose gets a textarea; short labels get an input. */
  multiline: boolean;
}

type TextVisitor = (slot: AgreementContentSlot) => string;

/** Read an unknown store into a clean override map (strings only). */
export function coerceContentOverrides(raw: unknown): AgreementContentOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: AgreementContentOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    out[key] = value;
  }
  return out;
}

/** The override map carried by a set of field values. */
export function contentOverridesFromValues(values: Record<string, unknown> | null | undefined): AgreementContentOverrides {
  return coerceContentOverrides(values?.[CONTENT_OVERRIDES_VALUE_KEY]);
}

// ── Traversal ────────────────────────────────────────────────────────────────
//
// One traversal serves three callers: apply (substitute), list (enumerate) and
// normalise (validate). It is written as a transform so `apply` is the identity
// case with a lookup, and enumeration is a side effect of walking.

function walkBlock(
  block: AgreementBlock,
  sectionId: string,
  prefix: string,
  visit: TextVisitor,
): AgreementBlock {
  const t = (
    node: string,
    text: string,
    label: string,
    multiline = false,
  ): string => visit({ path: `${prefix}/${node}`, text, sectionId, label, multiline });

  switch (block.kind) {
    case 'cover':
      return {
        ...block,
        titleLines: block.titleLines.map((line, i) => t(`title:${i}`, line, `Cover title line ${i + 1}`)),
        issuedByLine: t('issuedBy', block.issuedByLine, 'Cover — issued-by line'),
        particulars: block.particulars.map((entry, i) => ({
          label: t(`particular:${i}:label`, entry.label, `Cover particular ${i + 1} — label`),
          value: t(`particular:${i}:value`, entry.value, `Cover particular ${i + 1} — value`),
        })),
        versionLine: t('versionLine', block.versionLine, 'Cover — version line'),
        reviewStatement: t('review', block.reviewStatement, 'Cover — review statement', true),
      };

    case 'note':
      return {
        ...block,
        label: t('label', block.label, 'Panel label'),
        body: t('body', block.body, `Panel — ${block.label}`, true),
      };

    case 'emailTemplate':
      return {
        ...block,
        subjectLabel: t('subjectLabel', block.subjectLabel, 'Email — subject label'),
        subject: t('subject', block.subject, 'Email — subject'),
        bodyParagraphs: block.bodyParagraphs.map((p, i) => t(`para:${i}`, p, `Email paragraph ${i + 1}`, true)),
        signoffLines: block.signoffLines.map((l, i) => t(`signoff:${i}`, l, `Email sign-off line ${i + 1}`)),
        checklistTitle: t('checklistTitle', block.checklistTitle, 'Email checklist title'),
        checklist: block.checklist.map((item, i) => ({
          step: item.step,
          title: t(`check:${i}:title`, item.title, `Checklist step ${item.step} — title`),
          detail: t(`check:${i}:detail`, item.detail, `Checklist step ${item.step} — detail`, true),
        })),
        attachmentsTitle: t('attachTitle', block.attachmentsTitle, 'Attachments title'),
        attachments: block.attachments.map((a, i) => t(`attach:${i}`, a, `Attachment ${i + 1}`)),
      };

    case 'grid':
      return {
        ...block,
        rows: block.rows.map((row, r) => row.map((cell, c) => {
          const at = `cell:${r}:${c}`;
          const next = { ...cell };
          next.label = t(`${at}:label`, cell.label, `${cell.label} — label`);
          if (cell.template !== undefined) {
            next.template = t(`${at}:template`, cell.template, `${cell.label} — text`, true);
          }
          if (cell.text !== undefined) {
            next.text = t(`${at}:text`, cell.text, `${cell.label} — text`, true);
          }
          if (cell.choice) {
            next.choice = {
              ...cell.choice,
              lead: cell.choice.lead === undefined
                ? undefined
                : t(`${at}:lead`, cell.choice.lead, `${cell.label} — lead sentence`, true),
              options: cell.choice.options.map((option, o) => ({
                value: option.value,
                label: t(`${at}:opt:${o}`, option.label, `${cell.label} — option ${o + 1}`),
              })),
            };
          }
          return next;
        })),
      };

    case 'dualPanel':
      return {
        ...block,
        left: {
          title: t('left:title', block.left.title, 'Left panel title'),
          bullets: block.left.bullets.map((b, i) => t(`left:bullet:${i}`, b, `${block.left.title} — item ${i + 1}`, true)),
        },
        right: {
          title: t('right:title', block.right.title, 'Right panel title'),
          bullets: block.right.bullets.map((b, i) => t(`right:bullet:${i}`, b, `${block.right.title} — item ${i + 1}`, true)),
        },
      };

    case 'clauses':
      return {
        ...block,
        clauses: block.clauses.map((clause, i) => ({
          number: t(`clause:${i}:number`, clause.number, `Clause ${clause.number} — number`),
          heading: t(`clause:${i}:heading`, clause.heading, `Clause ${clause.number} — heading`),
          subclauses: clause.subclauses.map((sub, s) => ({
            number: t(`clause:${i}:sub:${s}:number`, sub.number, `Clause ${sub.number} — number`),
            text: t(`clause:${i}:sub:${s}:text`, sub.text, `Clause ${sub.number}`, true),
          })),
        })),
      };

    case 'workflow':
      return {
        ...block,
        steps: block.steps.map((step, i) => ({
          num: step.num,
          title: t(`step:${i}:title`, step.title, `Stage ${step.num} — title`),
          text: t(`step:${i}:text`, step.text, `Stage ${step.num} — text`, true),
        })),
      };

    case 'execution':
      return {
        ...block,
        parties: block.parties.map((party, i) => ({
          role: party.role,
          title: t(`party:${i}:title`, party.title, `Execution panel ${i + 1} — title`),
        })),
      };

    case 'consent':
      return {
        ...block,
        label: t('label', block.label, 'Consent panel label'),
        body: t('body', block.body, 'Client consent declaration', true),
        signatureLabel: t('signatureLabel', block.signatureLabel, 'Consent — signature label'),
        dateLabel: t('dateLabel', block.dateLabel, 'Consent — date label'),
      };

    default:
      return block;
  }
}

function walkSection(section: AgreementSectionDef, visit: TextVisitor): AgreementSectionDef {
  const header = section.header
    ? {
      badge: section.header.badge,
      heading: visit({
        path: `s:${section.id}/h:heading`,
        text: section.header.heading,
        sectionId: section.id,
        label: 'Section heading',
        multiline: false,
      }),
      hint: section.header.hint === undefined ? undefined : visit({
        path: `s:${section.id}/h:hint`,
        text: section.header.hint,
        sectionId: section.id,
        label: 'Section hint',
        multiline: false,
      }),
      sub: section.header.sub === undefined ? undefined : visit({
        path: `s:${section.id}/h:sub`,
        text: section.header.sub,
        sectionId: section.id,
        label: 'Section subtitle',
        multiline: false,
      }),
    }
    : null;

  return {
    ...section,
    header,
    blocks: section.blocks.map((block, index) =>
      walkBlock(block, section.id, `s:${section.id}/b:${index}`, visit)),
  };
}

/** Transform every editable text node of a template. The one traversal. */
export function mapAgreementContentText(
  content: AgreementTemplateContent,
  visit: TextVisitor,
): AgreementTemplateContent {
  return { ...content, sections: content.sections.map((section) => walkSection(section, visit)) };
}

/** Every editable text node, in document order. */
export function listAgreementContentSlots(content: AgreementTemplateContent): AgreementContentSlot[] {
  const slots: AgreementContentSlot[] = [];
  mapAgreementContentText(content, (slot) => {
    slots.push(slot);
    return slot.text;
  });
  return slots;
}

/**
 * The agreement's own wording: the locked template with this agreement's
 * negotiated amendments applied. Empty map → the template, unchanged and
 * referentially the same shape.
 */
export function applyAgreementContentOverrides(
  content: AgreementTemplateContent,
  overrides: AgreementContentOverrides | null | undefined,
): AgreementTemplateContent {
  if (!overrides || Object.keys(overrides).length === 0) return content;
  return mapAgreementContentText(content, (slot) => {
    const replacement = overrides[slot.path];
    return typeof replacement === 'string' ? replacement : slot.text;
  });
}

/**
 * Drop what cannot apply: paths the template no longer has, and "overrides"
 * that merely restate the template. A no-op override would otherwise show as an
 * amendment in the audit list, which would be a lie.
 */
export function normaliseContentOverrides(
  content: AgreementTemplateContent,
  raw: unknown,
): AgreementContentOverrides {
  const incoming = coerceContentOverrides(raw);
  if (Object.keys(incoming).length === 0) return {};
  const out: AgreementContentOverrides = {};
  for (const slot of listAgreementContentSlots(content)) {
    const replacement = incoming[slot.path];
    if (typeof replacement !== 'string') continue;
    if (replacement === slot.text) continue;
    if (replacement.trim() === '') continue; // a clause cannot be blanked by accident
    out[slot.path] = replacement;
  }
  return out;
}

/** What was amended, for the wizard's review list and the audit trail. */
export interface AgreementAmendment {
  path: string;
  label: string;
  sectionId: string;
  original: string;
  amended: string;
}

export function listAgreementAmendments(
  content: AgreementTemplateContent,
  overrides: AgreementContentOverrides | null | undefined,
): AgreementAmendment[] {
  if (!overrides || Object.keys(overrides).length === 0) return [];
  const out: AgreementAmendment[] = [];
  for (const slot of listAgreementContentSlots(content)) {
    const amended = overrides[slot.path];
    if (typeof amended !== 'string' || amended === slot.text) continue;
    out.push({
      path: slot.path,
      label: slot.label,
      sectionId: slot.sectionId,
      original: slot.text,
      amended,
    });
  }
  return out;
}
