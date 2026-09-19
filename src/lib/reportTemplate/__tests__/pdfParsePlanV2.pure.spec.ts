/**
 * pdf-plan-contract-v2 runtime validator (Path-to-100 v2 · C1.1).
 *
 * Locks the boundary that replaced the dispatcher's unchecked `as PlanResult`
 * cast: malformed / unknown sidecar plan output must produce a structured,
 * audited rejection (→ conservative fallback), never silently route on garbage.
 * Pure module → runs under vitest without Deno.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePlanV2,
  PDF_PLAN_CONTRACT_VERSION,
  PLAN_CHUNK_SIZE_MAX,
} from '../../../../supabase/functions/_shared/pdfParsePlanV2.pure';

const validRaw = {
  engine_version: 'docling-x',
  page_count: 12,
  byte_size: 34567,
  ocr_hint: true,
  recommended_mode: 'hybrid',
  recommended_lane: 'accurate_table',
  recommended_chunk_size: 10,
  requires_raster: true,
  requires_ocr: false,
  requires_picture_description: true,
  plan_ms: 42,
};

describe('normalizePlanV2', () => {
  it('accepts a valid plan and stamps the contract version', () => {
    const res = normalizePlanV2(validRaw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.contract_version).toBe(PDF_PLAN_CONTRACT_VERSION);
    expect(res.plan.page_count).toBe(12);
    expect(res.plan.recommended_mode).toBe('hybrid');
    expect(res.plan.recommended_lane).toBe('accurate_table');
    expect(res.plan.recommended_chunk_size).toBe(10);
    expect(res.plan.requires_picture_description).toBe(true);
  });

  it('normalizes pixel_perfect (DB form) to pixel-perfect (contract form)', () => {
    const res = normalizePlanV2({ ...validRaw, recommended_mode: 'pixel_perfect' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.recommended_mode).toBe('pixel-perfect');
  });

  it('clamps recommended_chunk_size into [1, 50]', () => {
    const hi = normalizePlanV2({ ...validRaw, recommended_chunk_size: 9999 });
    expect(hi.ok && hi.plan.recommended_chunk_size).toBe(PLAN_CHUNK_SIZE_MAX);
    // A sub-1 fractional value clamps up to the floor of the range (1).
    const frac = normalizePlanV2({ ...validRaw, recommended_chunk_size: 0.4 });
    expect(frac.ok && frac.plan.recommended_chunk_size).toBe(1);
    // A genuinely non-positive value is dropped to null (no chunk hint).
    const zero = normalizePlanV2({ ...validRaw, recommended_chunk_size: 0 });
    expect(zero.ok && zero.plan.recommended_chunk_size).toBe(null);
    const neg = normalizePlanV2({ ...validRaw, recommended_chunk_size: -5 });
    expect(neg.ok && neg.plan.recommended_chunk_size).toBe(null);
  });

  it('rejects a non-positive page_count', () => {
    for (const pc of [0, -3, undefined, 'abc']) {
      const res = normalizePlanV2({ ...validRaw, page_count: pc });
      expect(res.ok).toBe(false);
      // ternary narrows res to the rejection branch without relying on
      // statement-level control-flow narrowing.
      expect((res as { reason?: string }).reason).toBe('invalid_page_count');
    }
  });

  it('rejects an unknown mode', () => {
    const res = normalizePlanV2({ ...validRaw, recommended_mode: 'quantum' });
    expect(res.ok).toBe(false);
    expect((res as { reason?: string }).reason).toBe('unknown_mode');
  });

  it('rejects an unknown lane', () => {
    const res = normalizePlanV2({ ...validRaw, recommended_lane: 'turbo' });
    expect(res.ok).toBe(false);
    expect((res as { reason?: string }).reason).toBe('unknown_lane');
  });

  it('rejects a non-object payload', () => {
    for (const raw of [null, undefined, 'plan', 42, []]) {
      const res = normalizePlanV2(raw as unknown);
      expect(res.ok).toBe(false);
      expect((res as { reason?: string }).reason).toBe('plan_not_object');
    }
  });

  it('defaults absent mode to null and absent lane to unplanned (no rejection)', () => {
    const res = normalizePlanV2({ page_count: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.recommended_mode).toBe(null);
    expect(res.plan.recommended_lane).toBe('unplanned');
    expect(res.plan.recommended_chunk_size).toBe(null);
    expect(res.plan.requires_raster).toBe(false);
  });

  it('coerces boolean-ish requires_* values', () => {
    const res = normalizePlanV2({ page_count: 2, requires_ocr: 'true', requires_raster: 'false' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.requires_ocr).toBe(true);
    expect(res.plan.requires_raster).toBe(false);
  });
});
