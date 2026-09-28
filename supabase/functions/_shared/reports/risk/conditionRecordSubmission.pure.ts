/**
 * The condition-record SUBMISSION contract — what an operator's payload must
 * carry before a row may be written, and which refusals block storage as
 * opposed to riding on the stored evidence.
 *
 * One rule, rendered and enforced: the dialog validates with THIS module and
 * the edge operation refuses with THIS module, so what an operator is asked
 * for and what the server accepts cannot become two standards — the
 * `assessPepEvidence` pattern applied to condition evidence.
 *
 * ## Two different "no"s
 *
 * `assessConditionRecord` answers whether a record may become a scoring
 * observation. Storage is a different question: the table is an EVIDENCE
 * register, and a document that cannot clear the dwelling is still evidence
 * (`not_verified`, `out_of_currency`, a scope nobody recorded — each is
 * "recorded as evidence and not scored" in the validator's own words).
 *
 * What may NOT be stored is exactly what the table's own constraints would
 * refuse (`document_kind` outside the vocabulary, a blank issuer or address,
 * an unparseable or out-of-order date, a finding whose severity the shape
 * function cannot weigh, a held-document claim with no file) — refused HERE,
 * with the validator's sentence, so an operator never sees a raw 23514 —
 * plus the subject rules: a document that identifies a DIFFERENT property,
 * or none this assessment can check, is the wrong file, and filing it under
 * this report would manufacture the binding the validator exists to check.
 *
 * The migration may not be applied yet on a deployment. That is an honest,
 * named state — {@link TABLE_NOT_APPLIED} — never a stack trace.
 */

import {
  ADMISSIBLE_SOURCES,
  FINDING_SEVERITIES,
  assessConditionRecord,
  bestConditionRecord,
  isFindingSeverity,
  type ConditionFinding,
  type ConditionRecord,
  type ConditionReading,
  type ConditionRefusal,
  type ConditionSubject,
  type ConditionVerification,
  type ScopeCoverage,
} from './conditionRecord.pure.ts';

/** The shape the dialog submits. Everything else in the body is ignored. */
export interface ConditionSubmissionPayload {
  documentKind?: unknown;
  issuer?: unknown;
  issuerLicence?: unknown;
  issuedOn?: unknown;
  inspectedOn?: unknown;
  documentReference?: unknown;
  /** The property AS THE DOCUMENT IDENTIFIES IT — not assumed from the report. */
  documentPropertyAddress?: unknown;
  scope?: unknown;
  scopeCoverage?: unknown;
  exclusions?: unknown;
  conclusion?: unknown;
  findings?: unknown;
  verification?: unknown;
  fileId?: unknown;
  /**
   * Where the uploaded document is held, as `requestConditionDocumentUpload`
   * issued it. Only a path inside THIS report's own folder is accepted.
   */
  documentPath?: unknown;
}

/**
 * Where a condition document's bytes are kept: the private bucket a report's
 * other kept files already live in, under a folder of their own.
 *
 * Deliberately NOT one of `reportStorageFolders`: a condition document is
 * evidence about the PROPERTY and outlives the report it was filed against
 * (the row's `report_id` is `ON DELETE SET NULL`), so deleting a report must
 * never take the inspection report another report rests on.
 */
export const CONDITION_DOCUMENT_BUCKET = 'listing-images';
export const CONDITION_DOCUMENT_PREFIX = 'condition-documents';

/** File types an inspection report arrives as. */
export const CONDITION_DOCUMENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
});

/** 25 MB: a long inspection report with photographs, with room to spare. */
export const CONDITION_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A file name safe to use as the last segment of a storage path. */
export function safeConditionFileName(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '').slice(-120);
  return cleaned || 'document';
}

/** The extension a condition document may carry, or null when it is not one. */
export function conditionDocumentExtension(name: unknown): string | null {
  const ext = safeConditionFileName(name).split('.').pop()?.toLowerCase() ?? '';
  return Object.prototype.hasOwnProperty.call(CONDITION_DOCUMENT_TYPES, ext) ? ext : null;
}

/** The storage path for a new upload against a report. Null for a non-id. */
export function conditionDocumentPath(reportId: unknown, objectId: string, fileName: unknown): string | null {
  if (typeof reportId !== 'string' || !UUID.test(reportId.trim().toLowerCase())) return null;
  if (!UUID.test(objectId)) return null;
  return `${CONDITION_DOCUMENT_PREFIX}/${reportId.trim().toLowerCase()}/${objectId}-${safeConditionFileName(fileName)}`;
}

/**
 * Is this a path this platform issued for THIS report? A submission may only
 * point at a document uploaded against the report it is filed under, so a
 * caller cannot attach somebody else's file by naming its path.
 */
export function isConditionDocumentPathFor(path: unknown, reportId: unknown): boolean {
  if (typeof path !== 'string' || typeof reportId !== 'string') return false;
  const id = reportId.trim().toLowerCase();
  if (!UUID.test(id)) return false;
  const prefix = `${CONDITION_DOCUMENT_PREFIX}/${id}/`;
  if (!path.startsWith(prefix)) return false;
  const leaf = path.slice(prefix.length);
  if (!leaf || leaf.includes('/') || leaf.includes('..')) return false;
  return UUID.test(leaf.slice(0, 36)) && leaf.charAt(36) === '-' && conditionDocumentExtension(leaf.slice(37)) !== null;
}

const SCOPE_COVERAGES: readonly ScopeCoverage[] = [
  'whole_dwelling', 'partial_dwelling', 'common_property', 'specified_works', 'disclosure_only',
];
const VERIFICATIONS: readonly ConditionVerification[] = [
  'issuer_verified', 'document_held', 'transcribed_only',
];
const CONCLUSIONS = ['no_defects_identified', 'defects_identified', 'not_concluded'] as const;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const optStr = (v: unknown): string | undefined => (str(v) ? str(v) : undefined);

export interface SubmissionRefusal {
  /** Machine-readable; the validator's vocabulary where the rule is its. */
  reason: ConditionRefusal | 'invalid_payload';
  /** The sentence the dialog shows. */
  statement: string;
}

export type ParsedSubmission =
  | { ok: true; record: ConditionRecord }
  | { ok: false; refusal: SubmissionRefusal };

/**
 * Build a `ConditionRecord` from an operator's payload.
 *
 * Whitelisted field by field — a payload key this function does not name
 * never reaches a column (the mass-assignment rule). The record's subject is
 * the DOCUMENT's stated address plus the platform's linkage for the report
 * being assessed, so `assessConditionRecord` can check the binding rather
 * than have the caller assert it.
 */
export function parseConditionSubmission(
  payload: ConditionSubmissionPayload,
  subject: { reportId: string; propertyId?: string | null },
): ParsedSubmission {
  const refuse = (reason: SubmissionRefusal['reason'], statement: string): ParsedSubmission =>
    ({ ok: false, refusal: { reason, statement } });

  const kind = str(payload.documentKind);
  if (!(ADMISSIBLE_SOURCES as readonly string[]).includes(kind)) {
    return refuse('inadmissible_source',
      `The document kind must be one of: ${ADMISSIBLE_SOURCES.join(', ')}.`);
  }
  const issuer = str(payload.issuer);
  if (!issuer) {
    return refuse('unattributed',
      'The document must name its issuer — an unattributed document is a claim, not a record.');
  }
  const issuedOn = str(payload.issuedOn);
  if (!issuedOn || Number.isNaN(Date.parse(issuedOn))) {
    return refuse('undated', 'The document needs a readable issue date (YYYY-MM-DD).');
  }
  const inspectedOn = optStr(payload.inspectedOn);
  if (inspectedOn && Number.isNaN(Date.parse(inspectedOn))) {
    return refuse('undated', 'The inspection date could not be read (use YYYY-MM-DD).');
  }

  const documentAddress = str(payload.documentPropertyAddress);
  if (!documentAddress) {
    return refuse('subject_not_recorded',
      'Record the property exactly as the document identifies it. The record is bound to the '
      + 'assessed property by checking that identification, never by assuming it.');
  }

  const scopeCoverage = optStr(payload.scopeCoverage);
  if (scopeCoverage && !(SCOPE_COVERAGES as readonly string[]).includes(scopeCoverage)) {
    return refuse('invalid_payload',
      `Scope coverage must be one of: ${SCOPE_COVERAGES.join(', ')}.`);
  }
  const conclusion = optStr(payload.conclusion);
  if (conclusion && !(CONCLUSIONS as readonly string[]).includes(conclusion)) {
    return refuse('invalid_payload',
      `The document's conclusion must be one of: ${CONCLUSIONS.join(', ')}.`);
  }
  const verification = str(payload.verification) || 'transcribed_only';
  if (!(VERIFICATIONS as readonly string[]).includes(verification)) {
    return refuse('invalid_payload',
      `Verification must be one of: ${VERIFICATIONS.join(', ')}.`);
  }
  const fileId = optStr(payload.fileId);
  const documentPath = optStr(payload.documentPath);
  if (documentPath && !isConditionDocumentPathFor(documentPath, subject.reportId)) {
    return refuse('invalid_payload',
      'The attached document was not uploaded against this report. Upload it again from this page.');
  }
  if (verification !== 'transcribed_only' && !fileId && !documentPath) {
    return refuse('not_verified',
      'A verification that claims the document is held needs the uploaded file. Attach the '
      + 'document, or record the findings as transcribed only.');
  }

  const rawFindings = Array.isArray(payload.findings) ? payload.findings : [];
  const findings: ConditionFinding[] = [];
  for (const f of rawFindings) {
    const element = str((f as Record<string, unknown>)?.element);
    const severity = str((f as Record<string, unknown>)?.severity);
    const note = optStr((f as Record<string, unknown>)?.note);
    if (!element) {
      return refuse('invalid_payload', 'Every finding must name the building element it is about.');
    }
    if (!isFindingSeverity(severity)) {
      return refuse('unrecognised_severity',
        `"${severity || '(empty)'}" is not a severity this method can weigh. Use one of: `
        + `${FINDING_SEVERITIES.join(', ')}.`);
    }
    findings.push(note ? { element, severity, note } : { element, severity });
  }

  const rawExclusions = Array.isArray(payload.exclusions) ? payload.exclusions : [];
  const exclusions = rawExclusions.map((e) => str(e)).filter((e) => e.length > 0);

  const record: ConditionRecord = {
    document: {
      kind: kind as ConditionRecord['document']['kind'],
      issuer,
      issuerLicence: optStr(payload.issuerLicence),
      issuedOn,
      inspectedOn,
      reference: optStr(payload.documentReference),
    },
    subject: {
      propertyAddress: documentAddress,
      propertyId: subject.propertyId ?? null,
      reportId: subject.reportId,
    },
    scope: optStr(payload.scope),
    scopeCoverage: scopeCoverage as ScopeCoverage | undefined,
    exclusions,
    conclusion: conclusion as ConditionRecord['conclusion'],
    findings,
    verification: verification as ConditionVerification,
  };
  return { ok: true, record };
}

/**
 * Refusals that BLOCK storage. Everything else is evidence the register
 * holds, with the refusal riding on the reading.
 *
 * The set is exactly: what the table's own constraints refuse (so an
 * operator gets the validator's sentence and never a raw 23514), plus the
 * subject rules (the wrong property's document belongs on the wrong
 * property's file, not on this one).
 */
export const STORAGE_BLOCKING_REFUSALS: readonly ConditionRefusal[] = [
  'no_record',
  'inadmissible_source',
  'unattributed',
  'undated',
  'issued_in_future',
  'inspected_in_future',
  'inspected_after_issue',
  'subject_not_recorded',
  'subject_unresolved',
  'subject_mismatch',
  'unrecognised_severity',
] as const;

export interface SubmissionDecision {
  reading: ConditionReading;
  storable: boolean;
  /** Set when `storable` is false. */
  refusal: SubmissionRefusal | null;
}

/**
 * Judge a parsed record against the property being assessed, and decide
 * whether the row may be written.
 */
export function decideConditionSubmission(
  record: ConditionRecord,
  expectedSubject: ConditionSubject,
  asOf: string,
): SubmissionDecision {
  const reading = assessConditionRecord(record, asOf, { expectedSubject });
  if (reading.refusal && STORAGE_BLOCKING_REFUSALS.includes(reading.refusal)) {
    return { reading, storable: false, refusal: { reason: reading.refusal, statement: reading.statement } };
  }
  return { reading, storable: true, refusal: null };
}

/** The insert payload, column-named. One place, so a rename cannot fork. */
export function rowFromRecord(
  record: ConditionRecord,
  meta: {
    reportId: string;
    canonicalPropertyKey?: string | null;
    clientPropertyId?: string | null;
    fileId?: string | null;
    documentPath?: string | null;
    recordedBy: string;
  },
): Record<string, unknown> {
  return {
    property_address: record.subject.propertyAddress,
    canonical_property_key: meta.canonicalPropertyKey ?? null,
    client_property_id: meta.clientPropertyId ?? null,
    report_id: meta.reportId,
    document_kind: record.document.kind,
    issuer: record.document.issuer,
    issuer_licence: record.document.issuerLicence ?? null,
    issued_on: record.document.issuedOn,
    inspected_on: record.document.inspectedOn ?? null,
    document_reference: record.document.reference ?? null,
    file_id: meta.fileId ?? null,
    document_path: meta.documentPath ?? null,
    scope: record.scope ?? null,
    scope_coverage: record.scopeCoverage ?? null,
    exclusions: record.exclusions ?? [],
    conclusion: record.conclusion ?? 'not_concluded',
    findings: record.findings,
    verification: record.verification,
    recorded_by: meta.recordedBy,
  };
}

/** A stored row read back into the validator's shape. */
export function recordFromRow(row: Record<string, unknown>): ConditionRecord {
  const findings = Array.isArray(row.findings) ? row.findings as ConditionFinding[] : [];
  return {
    document: {
      kind: row.document_kind as ConditionRecord['document']['kind'],
      issuer: String(row.issuer ?? ''),
      issuerLicence: (row.issuer_licence as string | null) ?? undefined,
      issuedOn: String(row.issued_on ?? ''),
      inspectedOn: (row.inspected_on as string | null) ?? undefined,
      reference: (row.document_reference as string | null) ?? undefined,
    },
    subject: {
      propertyAddress: String(row.property_address ?? ''),
      propertyId: (row.client_property_id as string | null) ?? null,
      reportId: (row.report_id as string | null) ?? null,
    },
    scope: (row.scope as string | null) ?? undefined,
    scopeCoverage: (row.scope_coverage as ScopeCoverage | null) ?? undefined,
    exclusions: Array.isArray(row.exclusions) ? row.exclusions as string[] : [],
    conclusion: (row.conclusion as ConditionRecord['conclusion'] | null) ?? undefined,
    findings,
    verification: (row.verification as ConditionVerification) ?? 'transcribed_only',
  };
}

/**
 * The reading an ASSESSMENT should carry for a property, over every stored
 * candidate: the best record among those that BIND to the subject.
 *
 * A record whose subject check fails is left out entirely rather than
 * carried as this property's evidence — a mismatch statement says "this
 * document is about a different property", which must never ride on a gap
 * describing THIS one. Where nothing binds, the answer is null and the
 * caller says nothing, never `no_record` dressed as a finding.
 */
export function bestReadingForSubject(
  records: readonly ConditionRecord[],
  expectedSubject: ConditionSubject,
  asOf: string,
): ConditionReading | null {
  const bound = records.filter((r) => {
    const read = assessConditionRecord(r, asOf, { expectedSubject });
    return read.refusal !== 'subject_mismatch'
      && read.refusal !== 'subject_unresolved'
      && read.refusal !== 'subject_not_recorded';
  });
  const best = bestConditionRecord(bound);
  return best ? assessConditionRecord(best, asOf, { expectedSubject }) : null;
}

/**
 * The honest answer while the migration has not been applied to this
 * deployment. PostgREST reports a missing relation as PGRST205; anything that
 * catches it says THIS, never a stack trace, and never "no records".
 */
export const CONDITION_TABLE_MIGRATION = '20261228090000_property_condition_records';

export const TABLE_NOT_APPLIED =
  'This deployment has not applied the condition-record evidence table yet '
  + `(migration ${CONDITION_TABLE_MIGRATION}). The record was not stored; nothing was lost, and `
  + 'nothing here is a statement about the dwelling.';

export function isMissingTableError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  // PostgREST resolves a relation against its own schema cache and answers
  // PGRST205 before Postgres ever sees the statement; 42P01 is what a direct
  // SQL caller gets. Both spellings are the same fact (CLAUDE.md, "an error
  // code is observed on the wire").
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return /property_condition_records.*does not exist|relation .* does not exist/i.test(err.message ?? '');
}
