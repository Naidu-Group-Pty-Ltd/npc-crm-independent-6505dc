/**
 * pdfImportClientReportSanitizer — Phase 11G redaction engine.
 *
 * Removes unsafe content (URLs, signed URLs, storage/bucket paths, service-role
 * references, stack traces, raw JSON dumps, env vars, and — for external_client
 * — internal UUIDs) from report text, sections, and payloads, recording every
 * redaction. Pure. Never throws for normal content.
 */
import {
  PDF_IMPORT_CLIENT_REPORT_DISALLOWED_PATTERNS,
  PDF_IMPORT_CLIENT_REPORT_UUID_PATTERN,
} from './pdfImportClientReportPolicy';
import {
  type PdfImportClientReportAudience,
  type PdfImportClientReportPayload,
  type PdfImportClientReportRedaction,
  type PdfImportClientReportSection,
} from './pdfImportClientReportTypes';

const REDACTED = '[redacted]';
const MAX_BODY_LENGTH = 2000;
const MAX_ITEM_LENGTH = 400;

function collapseWhitespace(value: string): string {
  return value.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function sanitizeClientReportText(input: {
  value: string | null | undefined;
  audience: PdfImportClientReportAudience;
  field: string;
}): { value: string; redactions: PdfImportClientReportRedaction[] } {
  const redactions: PdfImportClientReportRedaction[] = [];
  let value = String(input.value ?? '');

  for (const { code, pattern, reason } of PDF_IMPORT_CLIENT_REPORT_DISALLOWED_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    if (re.test(value)) {
      value = value.replace(re, REDACTED);
      redactions.push({ code, field: input.field, reason });
    }
  }

  // External-client reports must not carry internal UUIDs.
  if (input.audience === 'external_client') {
    const uuidRe = new RegExp(PDF_IMPORT_CLIENT_REPORT_UUID_PATTERN.source, 'gi');
    if (uuidRe.test(value)) {
      value = value.replace(new RegExp(PDF_IMPORT_CLIENT_REPORT_UUID_PATTERN.source, 'gi'), REDACTED);
      redactions.push({ code: 'internal_uuid', field: input.field, reason: 'internal identifier removed for external audience' });
    }
  }

  value = collapseWhitespace(value);
  if (value.length > MAX_BODY_LENGTH) {
    value = value.slice(0, MAX_BODY_LENGTH).trimEnd() + '…';
    redactions.push({ code: 'truncated', field: input.field, reason: 'content truncated to length limit' });
  }

  return { value, redactions };
}

export function sanitizeClientReportSection(input: {
  section: PdfImportClientReportSection;
  audience: PdfImportClientReportAudience;
}): { section: PdfImportClientReportSection; redactions: PdfImportClientReportRedaction[] } {
  const { section, audience } = input;
  const redactions: PdfImportClientReportRedaction[] = [];

  const titleR = sanitizeClientReportText({ value: section.title, audience, field: `section.${section.id}.title` });
  const bodyR = sanitizeClientReportText({ value: section.body, audience, field: `section.${section.id}.body` });
  redactions.push(...titleR.redactions, ...bodyR.redactions);

  const items: string[] = [];
  for (let i = 0; i < (Array.isArray(section.items) ? section.items : []).length; i++) {
    const itemR = sanitizeClientReportText({ value: section.items[i], audience, field: `section.${section.id}.items[${i}]` });
    let v = itemR.value;
    if (v.length > MAX_ITEM_LENGTH) v = v.slice(0, MAX_ITEM_LENGTH).trimEnd() + '…';
    if (v.trim()) items.push(v);
    redactions.push(...itemR.redactions);
  }

  return {
    section: { ...section, title: titleR.value, body: bodyR.value, items },
    redactions,
  };
}

export function sanitizeClientReportPayload(
  payload: PdfImportClientReportPayload,
): PdfImportClientReportPayload {
  const audience = payload.audience;
  const redactions: PdfImportClientReportRedaction[] = [...(payload.redactions ?? [])];

  const titleR = sanitizeClientReportText({ value: payload.title, audience, field: 'title' });
  const summaryR = sanitizeClientReportText({ value: payload.summary, audience, field: 'summary' });
  redactions.push(...titleR.redactions, ...summaryR.redactions);

  const sections = (Array.isArray(payload.sections) ? payload.sections : []).map((section) => {
    const r = sanitizeClientReportSection({ section, audience });
    redactions.push(...r.redactions);
    return r.section;
  });

  return {
    ...payload,
    title: titleR.value || 'PDF import report',
    summary: summaryR.value,
    sections,
    redactions,
  };
}

export function detectUnsafeClientReportContent(input: {
  payload: PdfImportClientReportPayload;
}): { safe: boolean; findings: PdfImportClientReportRedaction[] } {
  const { payload } = input;
  const findings: PdfImportClientReportRedaction[] = [];

  const texts: Array<{ field: string; value: string }> = [
    { field: 'title', value: payload.title },
    { field: 'summary', value: payload.summary },
  ];
  for (const s of Array.isArray(payload.sections) ? payload.sections : []) {
    texts.push({ field: `section.${s.id}.body`, value: s.body });
    (Array.isArray(s.items) ? s.items : []).forEach((it, i) => texts.push({ field: `section.${s.id}.items[${i}]`, value: it }));
  }

  for (const { field, value } of texts) {
    for (const { code, pattern, reason } of PDF_IMPORT_CLIENT_REPORT_DISALLOWED_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      if (re.test(String(value ?? ''))) {
        findings.push({ code, field, reason });
      }
    }
    if (payload.audience === 'external_client') {
      const uuidRe = new RegExp(PDF_IMPORT_CLIENT_REPORT_UUID_PATTERN.source, 'gi');
      if (uuidRe.test(String(value ?? ''))) {
        findings.push({ code: 'internal_uuid', field, reason: 'internal identifier present for external audience' });
      }
    }
  }

  return { safe: findings.length === 0, findings };
}
