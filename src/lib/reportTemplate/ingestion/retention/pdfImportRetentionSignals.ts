/**
 * pdfImportRetentionSignals — Phase 11E signal normalization + extraction.
 *
 * Pure helpers that normalize imports / jobs / golden runs / monitoring events /
 * storage objects into a retention signal bundle, and extract *storage-path*
 * artifact references from import metadata. Signed URLs and http(s) values are
 * never treated as storage paths and are never stored.
 */
import {
  type PdfImportRetentionSignals,
} from './pdfImportRetentionTypes';

export function readRetentionPath(source: unknown, path: string[]): unknown {
  let cur: unknown = source;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function coerceRetentionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function coerceRetentionBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
}

function asRow(row: unknown): Record<string, unknown> {
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
}

export function getRetentionImportId(row: unknown): string | null {
  const r = asRow(row);
  const v = r.import_id ?? r.importId ?? r.id;
  return v == null ? null : String(v);
}

export function getRetentionTemplateId(row: unknown): string | null {
  const r = asRow(row);
  const v = r.created_template_id ?? r.template_id ?? r.templateId;
  return v == null ? null : String(v);
}

export function getRetentionSourceFilename(row: unknown): string | null {
  const r = asRow(row);
  const v = r.source_filename ?? r.source_file_name ?? r.sourceFilename;
  return v == null ? null : String(v);
}

export function getRetentionMeta(row: unknown): Record<string, unknown> {
  const r = asRow(row);
  const meta = r.meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

/** True when a string value looks like a signed URL / external URL (must never be stored as a path). */
function looksLikeUrlOrSigned(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith('http://') || v.startsWith('https://')) return true;
  if (v.includes('token=') || v.includes('signature=') || v.includes('x-goog-signature') || v.includes('?')) return true;
  return false;
}

function domainForArtifactKey(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('visual_quality')) return 'visual_quality';
  if (k.includes('visual_repair')) return 'visual_repair';
  if (k.includes('export_parity')) return 'export_parity';
  if (k.includes('diagnostic')) return 'diagnostics';
  if (k.includes('manifest')) return 'page_manifest';
  if (k.includes('cdir') || k.includes('source_chunk') || k.includes('schema') || k.includes('import_asset')) return 'docling_artifact';
  return 'unknown';
}

/**
 * Extract referenced storage-path artifacts from an import row. Detects the
 * explicit domain keys plus any meta key ending in `_artifact_path` / `_path`
 * whose value is a storage path. Skips http/signed URL values.
 */
export function extractReferencedArtifactPathsFromImport(row: unknown): Array<{
  domain: string;
  path: string;
  importId: string | null;
  templateId: string | null;
  label: string | null;
}> {
  const meta = getRetentionMeta(row);
  const importId = getRetentionImportId(row);
  const templateId = getRetentionTemplateId(row);
  const label = getRetentionSourceFilename(row);
  const out: Array<{ domain: string; path: string; importId: string | null; templateId: string | null; label: string | null }> = [];
  const seen = new Set<string>();

  for (const [key, rawValue] of Object.entries(meta)) {
    if (typeof rawValue !== 'string') continue;
    const isPathKey = key.endsWith('_artifact_path') || key.endsWith('_path');
    if (!isPathKey) continue;
    const value = rawValue.trim();
    if (!value) continue;
    if (looksLikeUrlOrSigned(value)) continue; // never store signed/external URLs
    if (seen.has(`${key}:${value}`)) continue;
    seen.add(`${key}:${value}`);
    out.push({ domain: domainForArtifactKey(key), path: value, importId, templateId, label });
  }

  return out;
}

export function isRetentionDateOlderThan(input: {
  date: string | null | undefined;
  days: number;
  now?: () => Date;
}): boolean {
  if (!input.date) return false;
  const ts = new Date(input.date).getTime();
  if (Number.isNaN(ts)) return false;
  const now = (input.now ?? (() => new Date()))().getTime();
  const ageMs = now - ts;
  return ageMs > input.days * 24 * 60 * 60 * 1000;
}

export function buildPdfImportRetentionSignals(input: {
  imports?: unknown[];
  jobs?: unknown[];
  goldenRuns?: unknown[];
  monitoringEvents?: unknown[];
  storageBuckets?: unknown[];
  storageObjects?: unknown[];
  now?: () => Date;
}): PdfImportRetentionSignals {
  const now = input.now ?? (() => new Date());
  return {
    imports: Array.isArray(input.imports) ? input.imports : [],
    jobs: Array.isArray(input.jobs) ? input.jobs : [],
    goldenRuns: Array.isArray(input.goldenRuns) ? input.goldenRuns : [],
    monitoringEvents: Array.isArray(input.monitoringEvents) ? input.monitoringEvents : [],
    storageBuckets: Array.isArray(input.storageBuckets) ? input.storageBuckets : [],
    storageObjects: Array.isArray(input.storageObjects) ? input.storageObjects : [],
    generatedAt: now().toISOString(),
  };
}
