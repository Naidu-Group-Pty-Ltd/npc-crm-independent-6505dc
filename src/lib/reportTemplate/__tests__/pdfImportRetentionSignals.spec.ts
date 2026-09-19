import { describe, expect, it } from 'vitest';
import {
  buildPdfImportRetentionSignals,
  coerceRetentionBoolean,
  coerceRetentionNumber,
  extractReferencedArtifactPathsFromImport,
  getRetentionImportId,
  getRetentionMeta,
  getRetentionSourceFilename,
  getRetentionTemplateId,
  isRetentionDateOlderThan,
  readRetentionPath,
} from '../ingestion/retention';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

describe('pdfImportRetentionSignals', () => {
  it('builds signals with defaults for missing arrays', () => {
    const s = buildPdfImportRetentionSignals({ now: NOW });
    expect(s.imports).toEqual([]);
    expect(s.jobs).toEqual([]);
    expect(s.storageObjects).toEqual([]);
    expect(s.generatedAt).toBe('2026-07-09T00:00:00.000Z');
  });

  it('reads nested meta', () => {
    expect(readRetentionPath({ a: { b: { c: 5 } } }, ['a', 'b', 'c'])).toBe(5);
    expect(readRetentionPath({ a: 1 }, ['a', 'b'])).toBeUndefined();
  });

  it('coerces booleans and numbers', () => {
    expect(coerceRetentionBoolean('true')).toBe(true);
    expect(coerceRetentionBoolean(false)).toBe(false);
    expect(coerceRetentionBoolean('nope')).toBeNull();
    expect(coerceRetentionNumber('12')).toBe(12);
    expect(coerceRetentionNumber(3.5)).toBe(3.5);
    expect(coerceRetentionNumber('x')).toBeNull();
  });

  it('extracts import id, template id, filename, meta', () => {
    const row = { id: 'imp-1', created_template_id: 'tpl-1', source_filename: 'a.pdf', meta: { k: 1 } };
    expect(getRetentionImportId(row)).toBe('imp-1');
    expect(getRetentionTemplateId(row)).toBe('tpl-1');
    expect(getRetentionSourceFilename(row)).toBe('a.pdf');
    expect(getRetentionMeta(row)).toEqual({ k: 1 });
  });

  it('extracts the known artifact paths', () => {
    const row = {
      id: 'imp-1',
      meta: {
        visual_quality_artifact_path: 'imports/imp-1/vq.json',
        visual_repair_artifact_path: 'imports/imp-1/vr.json',
        export_parity_artifact_path: 'imports/imp-1/ep.json',
      },
    };
    const refs = extractReferencedArtifactPathsFromImport(row);
    const byDomain = Object.fromEntries(refs.map((r) => [r.domain, r.path]));
    expect(byDomain.visual_quality).toBe('imports/imp-1/vq.json');
    expect(byDomain.visual_repair).toBe('imports/imp-1/vr.json');
    expect(byDomain.export_parity).toBe('imports/imp-1/ep.json');
  });

  it('ignores signed / external URLs', () => {
    const row = {
      id: 'imp-1',
      meta: {
        visual_quality_artifact_path: 'https://x.supabase.co/object/sign/a?token=abc&signature=z',
        export_parity_artifact_path: 'imports/imp-1/ep.json',
      },
    };
    const refs = extractReferencedArtifactPathsFromImport(row);
    expect(refs.some((r) => r.path.startsWith('http'))).toBe(false);
    expect(refs).toHaveLength(1);
  });

  it('identifies old dates', () => {
    expect(isRetentionDateOlderThan({ date: '2026-01-01T00:00:00.000Z', days: 90, now: NOW })).toBe(true);
    expect(isRetentionDateOlderThan({ date: '2026-07-01T00:00:00.000Z', days: 90, now: NOW })).toBe(false);
    expect(isRetentionDateOlderThan({ date: null, days: 90, now: NOW })).toBe(false);
  });
});
