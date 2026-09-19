/**
 * pdfImportRetentionEvaluator — Phase 11E dry-run candidate evaluation.
 *
 * Evaluates the retention policy against a signal bundle and produces durable
 * candidate events. DRY-RUN ONLY: it recommends decisions but never deletes,
 * archives, compacts, or mutates anything. Deterministic and pure.
 */
import { getPdfImportRetentionPolicyRule } from './pdfImportRetentionPolicy';
import {
  extractReferencedArtifactPathsFromImport,
  getRetentionImportId,
  getRetentionMeta,
  getRetentionSourceFilename,
  getRetentionTemplateId,
  isRetentionDateOlderThan,
  readRetentionPath,
} from './pdfImportRetentionSignals';
import {
  PDF_IMPORT_RETENTION_EVENT_VERSION,
  type PdfImportRetentionDomain,
  type PdfImportRetentionEvaluationResult,
  type PdfImportRetentionEventInput,
  type PdfImportRetentionEvidence,
  type PdfImportRetentionRuleId,
  type PdfImportRetentionSignals,
} from './pdfImportRetentionTypes';

const META_COMPACT_THRESHOLD_BYTES = 500_000;

export function buildPdfImportRetentionRunId(now: () => Date = () => new Date()): string {
  return `retention-${now().toISOString().replace(/[:.]/g, '-')}`;
}

export function buildPdfImportRetentionDedupeKey(input: {
  retentionRuleId: string;
  scopeType: string;
  scopeId: string;
}): string {
  return `${input.retentionRuleId}:${input.scopeType}:${input.scopeId}`;
}

export function buildPdfImportRetentionEvent(input: {
  retentionRuleId: string;
  scopeType: string;
  scopeId: string;
  scopeLabel?: string | null;
  message: string;
  storageBucket?: string | null;
  storageObjectPath?: string | null;
  importId?: string | null;
  templateId?: string | null;
  monitoringEventId?: string | null;
  goldenRunId?: string | null;
  evidence?: PdfImportRetentionEvidence[];
  estimatedBytes?: number | null;
  objectCreatedAt?: string | null;
  objectUpdatedAt?: string | null;
  now?: () => Date;
  runId?: string | null;
}): PdfImportRetentionEventInput {
  const now = input.now ?? (() => new Date());
  const iso = now().toISOString();
  const rule = getPdfImportRetentionPolicyRule(input.retentionRuleId);

  const domain = (rule?.domain ?? 'unknown') as PdfImportRetentionDomain;
  const decision = rule?.defaultDecision ?? 'unknown';
  const cleanupAction = rule?.defaultCleanupAction ?? 'mark_for_review';
  const safetyLevel = rule?.defaultSafetyLevel ?? 'requires_operator_approval';
  const recommendedAction = rule?.recommendedAction ?? 'Operator review required.';
  const title = rule?.title ?? 'Retention candidate';

  return {
    version: PDF_IMPORT_RETENTION_EVENT_VERSION,
    retentionRuleId: input.retentionRuleId as PdfImportRetentionRuleId,
    domain,
    decision,
    cleanupAction,
    safetyLevel,
    status: 'candidate',
    title,
    message: input.message,
    scope: { type: input.scopeType, id: input.scopeId, label: input.scopeLabel ?? null },
    dedupeKey: buildPdfImportRetentionDedupeKey({
      retentionRuleId: input.retentionRuleId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    }),
    storageBucket: input.storageBucket ?? null,
    storageObjectPath: input.storageObjectPath ?? null,
    importId: input.importId ?? null,
    templateId: input.templateId ?? null,
    monitoringEventId: input.monitoringEventId ?? null,
    goldenRunId: input.goldenRunId ?? null,
    evidence: input.evidence ?? [],
    recommendedAction,
    estimatedBytes: input.estimatedBytes ?? null,
    objectCreatedAt: input.objectCreatedAt ?? null,
    objectUpdatedAt: input.objectUpdatedAt ?? null,
    source: 'pdf_import_retention',
    runId: input.runId ?? null,
    firstSeenAt: iso,
    lastSeenAt: iso,
    occurrenceCount: 1,
  };
}

const ARTIFACT_BUCKET = 'template-import-artifacts';

function getOperatorDecision(meta: Record<string, unknown>): string | null {
  const v = readRetentionPath(meta, ['production_operator_control_audit', 'operatorState', 'decision']);
  return v == null ? null : String(v);
}

function isManualReview(meta: Record<string, unknown>): boolean {
  const a = readRetentionPath(meta, ['production_operator_control_audit', 'operatorState', 'manualReviewRequired']);
  const b = readRetentionPath(meta, ['visual_quality_summary', 'manualReviewRequired']);
  return a === true || b === true;
}

function repairStatus(meta: Record<string, unknown>): string | null {
  const v = readRetentionPath(meta, ['visual_repair_summary', 'status']);
  return v == null ? null : String(v);
}

function isGoldenExportEvidence(meta: Record<string, unknown>): boolean {
  const a = readRetentionPath(meta, ['export_parity_summary', 'isGoldenBaseline']);
  const b = readRetentionPath(meta, ['export_parity_summary', 'releaseEvidence']);
  return a === true || b === true;
}

function importAge(row: unknown): string | null {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  const v = r.updated_at ?? r.created_at;
  return v == null ? null : String(v);
}

export function evaluatePdfImportRetention(
  signals: PdfImportRetentionSignals,
): PdfImportRetentionEvaluationResult {
  const now = () => new Date(signals.generatedAt || new Date().toISOString());
  const runId = buildPdfImportRetentionRunId(now);
  const events: PdfImportRetentionEventInput[] = [];
  const seen = new Set<string>();

  const push = (ev: PdfImportRetentionEventInput) => {
    if (seen.has(ev.dedupeKey)) return;
    seen.add(ev.dedupeKey);
    events.push(ev);
  };

  // Build the set of referenced storage paths across all imports.
  const referencedPaths = new Set<string>();
  for (const imp of signals.imports) {
    for (const ref of extractReferencedArtifactPathsFromImport(imp)) referencedPaths.add(ref.path);
  }
  // Storage object name set (for missing-reference detection).
  const storageNames = new Set<string>();
  for (const obj of signals.storageObjects) {
    const name = (obj && typeof obj === 'object' ? (obj as Record<string, unknown>).name : null);
    if (name != null) storageNames.add(String(name));
  }
  const haveStorageListing = signals.storageObjects.length > 0;

  // ── Imports ──
  for (const imp of signals.imports) {
    const importId = getRetentionImportId(imp);
    const templateId = getRetentionTemplateId(imp);
    const label = getRetentionSourceFilename(imp);
    const meta = getRetentionMeta(imp);
    const status = String((imp as Record<string, unknown>)?.status ?? '');
    const ageDate = importAge(imp);
    const decision = getOperatorDecision(meta);
    const manualReview = isManualReview(meta);
    if (!importId) continue;

    // Rule 1: source PDF retained (blocked).
    if (label) {
      push(buildPdfImportRetentionEvent({
        retentionRuleId: 'source_pdf_retained', scopeType: 'import', scopeId: importId, scopeLabel: label,
        message: `Source PDF for import ${importId} is retained and must not be auto-deleted.`,
        importId, templateId, now,
        evidence: [{ code: 'source_filename', label: 'Source filename', value: label, message: 'Import source reference (name only).' }],
        runId,
      }));
    }

    // Rule 13: operator audit retained.
    if (meta.production_operator_control_audit) {
      push(buildPdfImportRetentionEvent({
        retentionRuleId: 'operator_audit_retained', scopeType: 'import', scopeId: importId, scopeLabel: label,
        message: `Operator control audit for import ${importId} is retained.`,
        importId, templateId, now, runId,
        evidence: [{ code: 'operator_decision', label: 'Operator decision', value: decision, message: 'Operator decision reference.' }],
      }));
    }

    // Rule 12: phase 10 metadata large (needs a size signal).
    const metaSize = readRetentionPath(imp, ['meta_size_bytes']) ?? readRetentionPath(meta, ['__meta_size_bytes']);
    const metaSizeNum = typeof metaSize === 'number' ? metaSize : null;
    if (metaSizeNum != null && metaSizeNum > META_COMPACT_THRESHOLD_BYTES) {
      push(buildPdfImportRetentionEvent({
        retentionRuleId: 'phase10_metadata_large', scopeType: 'import', scopeId: importId, scopeLabel: label,
        message: `Import ${importId} metadata is ${metaSizeNum} bytes (compaction candidate for a later phase).`,
        importId, templateId, estimatedBytes: metaSizeNum, now, runId,
        evidence: [{ code: 'meta_size_bytes', label: 'Metadata size', value: metaSizeNum, message: 'Metadata size in bytes.' }],
      }));
    }

    // Per-artifact rules.
    for (const ref of extractReferencedArtifactPathsFromImport(imp)) {
      const scopeId = `${importId}:${ref.path}`;
      const common = {
        scopeType: 'artifact', scopeId, scopeLabel: ref.path,
        storageBucket: ARTIFACT_BUCKET, storageObjectPath: ref.path,
        importId, templateId, now, runId,
      } as const;

      // Rule 15: missing referenced object (only when we have a storage listing).
      if (haveStorageListing && !storageNames.has(ref.path)) {
        push(buildPdfImportRetentionEvent({
          ...common, retentionRuleId: 'metadata_reference_missing_object',
          message: `Import ${importId} references a missing storage object (${ref.domain}).`,
          evidence: [{ code: 'missing_object', label: 'Missing object', value: ref.path, message: 'Referenced object not found in bucket listing.' }],
        }));
        continue;
      }

      const domain = ref.domain as PdfImportRetentionDomain | string;
      if (domain === 'visual_quality') {
        if (manualReview) {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'visual_quality_manual_review_retained', message: `Visual QA evidence for import ${importId} retained (manual review).` }));
        } else if ((decision === 'accepted' || decision === 'accepted_with_warnings') && isRetentionDateOlderThan({ date: ageDate, days: 180, now })) {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'visual_quality_old_accepted', message: `Old accepted Visual QA evidence for import ${importId} (archive candidate).` }));
        }
      } else if (domain === 'visual_repair') {
        const rs = repairStatus(meta);
        if (rs === 'applied' || rs === 'rejected') {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'visual_repair_applied_retained', message: `Repair artifact for import ${importId} retained (${rs}).` }));
        } else if (isRetentionDateOlderThan({ date: ageDate, days: 180, now })) {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'visual_repair_old', message: `Old visual repair artifact for import ${importId} (review).` }));
        }
      } else if (domain === 'export_parity') {
        if (isGoldenExportEvidence(meta)) {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'export_parity_golden_retained', message: `Export parity for import ${importId} retained (golden/release evidence).` }));
        } else if (isRetentionDateOlderThan({ date: ageDate, days: 180, now })) {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'export_parity_old', message: `Old export parity artifact for import ${importId} (archive candidate).` }));
        }
      } else if (domain === 'diagnostics') {
        if (status === 'failed') {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'diagnostics_failed_import_retained', message: `Diagnostics for failed import ${importId} retained.` }));
        } else if (isRetentionDateOlderThan({ date: ageDate, days: 90, now })) {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'diagnostics_old_success', message: `Old successful-import diagnostics for import ${importId} (archive candidate).` }));
        }
      } else if (domain === 'page_manifest') {
        if (isRetentionDateOlderThan({ date: ageDate, days: 180, now })) {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'page_manifest_old', message: `Old page manifest for import ${importId} (archive candidate).` }));
        }
      } else if (domain === 'docling_artifact') {
        if (isRetentionDateOlderThan({ date: ageDate, days: 180, now })) {
          push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'docling_artifact_old', message: `Old Docling artifact for import ${importId} (archive candidate).` }));
        }
      } else {
        push(buildPdfImportRetentionEvent({ ...common, retentionRuleId: 'unknown_artifact_review', message: `Unknown artifact for import ${importId} needs review.` }));
      }
    }
  }

  // ── Golden runs → golden_history_retained (dedupe by corpus). ──
  for (const run of signals.goldenRuns) {
    const r = (run && typeof run === 'object' ? run : {}) as Record<string, unknown>;
    const corpusId = r.corpus_id ?? r.corpusId;
    const runId2 = r.id;
    if (corpusId == null) continue;
    push(buildPdfImportRetentionEvent({
      retentionRuleId: 'golden_history_retained', scopeType: 'golden_corpus', scopeId: String(corpusId), scopeLabel: String(corpusId),
      message: `Golden run history for corpus ${corpusId} is retained.`,
      goldenRunId: runId2 == null ? null : String(runId2), now, runId,
    }));
  }

  // ── Monitoring events → archive candidate when old + resolved. ──
  for (const ev of signals.monitoringEvents) {
    const r = (ev && typeof ev === 'object' ? ev : {}) as Record<string, unknown>;
    const status = String(r.status ?? '');
    const id = r.id;
    if (!id) continue;
    if (['resolved', 'suppressed', 'false_positive'].includes(status) && isRetentionDateOlderThan({ date: String(r.updated_at ?? r.last_seen_at ?? ''), days: 180, now })) {
      push(buildPdfImportRetentionEvent({
        retentionRuleId: 'monitoring_event_old_resolved', scopeType: 'monitoring_event', scopeId: String(id), scopeLabel: String(r.rule_id ?? ''),
        message: `Old ${status} monitoring event ${id} (archive candidate).`,
        monitoringEventId: String(id), now, runId,
      }));
    }
  }

  // ── Storage orphans + recent unknowns. ──
  for (const obj of signals.storageObjects) {
    const r = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>;
    const name = r.name == null ? null : String(r.name);
    if (!name) continue;
    if (referencedPaths.has(name)) continue; // referenced → not orphan
    const createdAt = r.created_at == null ? null : String(r.created_at);
    const sizeRaw = readRetentionPath(r, ['metadata', 'size']);
    const size = typeof sizeRaw === 'number' ? sizeRaw : (typeof sizeRaw === 'string' && Number.isFinite(Number(sizeRaw)) ? Number(sizeRaw) : null);
    if (isRetentionDateOlderThan({ date: createdAt, days: 90, now })) {
      push(buildPdfImportRetentionEvent({
        retentionRuleId: 'storage_object_orphaned', scopeType: 'storage_object', scopeId: name, scopeLabel: name,
        message: `Orphaned storage object ${name} older than 90 days (delete candidate — developer approval, dry-run only).`,
        storageBucket: ARTIFACT_BUCKET, storageObjectPath: name, estimatedBytes: size,
        objectCreatedAt: createdAt, objectUpdatedAt: r.updated_at == null ? null : String(r.updated_at), now, runId,
        evidence: [{ code: 'orphan_age', label: 'Object age', value: createdAt, message: 'Object created date.' }],
      }));
    } else {
      push(buildPdfImportRetentionEvent({
        retentionRuleId: 'unknown_artifact_review', scopeType: 'storage_object', scopeId: name, scopeLabel: name,
        message: `Recent unreferenced storage object ${name} needs review.`,
        storageBucket: ARTIFACT_BUCKET, storageObjectPath: name, estimatedBytes: size,
        objectCreatedAt: createdAt, now, runId,
      }));
    }
  }

  // Counts + recoverable bytes.
  let retainCount = 0, reviewCount = 0, archiveCandidateCount = 0, deleteCandidateCount = 0, blockedCount = 0, recoverable = 0;
  for (const ev of events) {
    switch (ev.decision) {
      case 'retain': retainCount++; break;
      case 'review': reviewCount++; break;
      case 'archive_candidate': archiveCandidateCount++; break;
      case 'delete_candidate': deleteCandidateCount++; break;
      case 'blocked': blockedCount++; break;
      default: break;
    }
    if ((ev.decision === 'archive_candidate' || ev.decision === 'delete_candidate') && typeof ev.estimatedBytes === 'number') {
      recoverable += ev.estimatedBytes;
    }
  }

  return {
    runId,
    generatedAt: signals.generatedAt,
    events,
    retainCount,
    reviewCount,
    archiveCandidateCount,
    deleteCandidateCount,
    blockedCount,
    estimatedRecoverableBytes: recoverable,
  };
}
