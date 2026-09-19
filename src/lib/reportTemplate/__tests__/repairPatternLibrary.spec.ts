import { describe, expect, it } from 'vitest';
import {
  REPAIR_PATTERN_LIBRARY,
  listRepairPatternDefinitions,
  getRepairPatternDefinition,
  assertRepairPatternLibraryIntegrity,
} from '../ingestion/repairPatterns';

const REQUIRED = [
  'page_margin_drift',
  'background_block_shift',
  'font_scale_mismatch',
  'table_grid_drift',
  'image_crop_mismatch',
  'layer_order_conflict',
  'ocr_text_fragments',
  'header_footer_alignment',
  'multi_page_spacing_drift',
  'missing_major_visual_element',
  'export_renderer_mismatch',
  'manual_review_only',
];

describe('repairPatternLibrary', () => {
  it('contains all required pattern IDs', () => {
    const ids = REPAIR_PATTERN_LIBRARY.map((d) => d.patternId);
    for (const id of REQUIRED) expect(ids).toContain(id);
  });

  it('has no duplicate pattern IDs', () => {
    const ids = listRepairPatternDefinitions().map((d) => d.patternId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getRepairPatternDefinition returns page_margin_drift', () => {
    expect(getRepairPatternDefinition('page_margin_drift')?.patternId).toBe('page_margin_drift');
  });

  it('getRepairPatternDefinition returns null for an invalid ID', () => {
    expect(getRepairPatternDefinition('not_a_pattern')).toBeNull();
  });

  it('every definition has a title, description, symptoms, action, fallback, eligible categories', () => {
    for (const d of REPAIR_PATTERN_LIBRARY) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      expect(Array.isArray(d.symptoms) && d.symptoms.length > 0).toBe(true);
      expect(d.recommendedAction.length).toBeGreaterThan(0);
      expect(d.manualFallback.length).toBeGreaterThan(0);
      expect(Array.isArray(d.eligibleProfileCategories)).toBe(true);
    }
  });

  it('assertRepairPatternLibraryIntegrity returns ok true', () => {
    const res = assertRepairPatternLibraryIntegrity();
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('manual_review_only is critical', () => {
    expect(getRepairPatternDefinition('manual_review_only')?.defaultSeverity).toBe('critical');
  });

  it('table_grid_drift uses the table category', () => {
    expect(getRepairPatternDefinition('table_grid_drift')?.category).toBe('table');
  });

  it('export_renderer_mismatch uses the export category', () => {
    expect(getRepairPatternDefinition('export_renderer_mismatch')?.category).toBe('export');
  });

  it('ocr_text_fragments uses the OCR category', () => {
    expect(getRepairPatternDefinition('ocr_text_fragments')?.category).toBe('ocr');
  });
});
