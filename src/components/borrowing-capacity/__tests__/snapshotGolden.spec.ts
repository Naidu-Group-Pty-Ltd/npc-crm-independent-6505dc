/**
 * A golden capture of the Borrowing Capacity Snapshot as it ships today.
 *
 * ## Why this exists before any change is made
 *
 * `docs/reports/DESIGN_SYSTEM.md` records that shipping PDF paths have **zero**
 * fidelity coverage. This is the first. It is deliberately written against the
 * *current* jsPDF generator, unmodified, so that when the report is rebuilt on
 * the design system there is something truthful to diff the result against.
 *
 * A golden is only worth having if it exercises the branches. The fixture below
 * turns on every conditional the generator has — LMI, additional assumptions,
 * recommendations, warnings, the calculation explanation, the audit trail and
 * the scenario comparison — because those are four extra pages that a
 * happy-path fixture would never reach, and four pages a migration could
 * silently drop.
 *
 * The artefact is written to `reports/` (gitignored) for rasterising and
 * eyeballing; the assertions below are what runs in CI.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  SAMPLE_ASSESSMENT,
  SAMPLE_AUDIT_TRAIL,
  SAMPLE_CLIENT_NAME,
  SAMPLE_EXPLANATION,
  SAMPLE_SCENARIO_PRESETS,
} from '@/lib/reports/borrowingCapacity/__tests__/fixtures/sampleAssessment';

const REPO = resolve(__dirname, '../../../..');
const GOLDEN_PDF = resolve(REPO, 'reports/golden/borrowing-capacity-snapshot.pdf');

// ── The generator's collaborators, stubbed at the boundary ──────────────────
//
// Only the three that reach the network. Everything else — the drawing, the
// layout, the pagination, the colours — is the real code path.

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@/hooks/useGlobalReportSettings', async () => {
  const { SAMPLE_GLOBAL_SETTINGS } = await import(
    '@/lib/reports/borrowingCapacity/__tests__/fixtures/sampleAssessment'
  );
  return { fetchGlobalReportSettings: async () => SAMPLE_GLOBAL_SETTINGS };
});

vi.mock('@/lib/fetchLatestBorrowingCapacity', () => ({
  fetchLatestBorrowingCapacity: async () => null,
}));

/**
 * The generator fetches its cover art by relative URL, which has no meaning
 * outside a browser. Serve the real file so the golden contains the real cover
 * — the point of a golden is that it is what a client receives.
 */
beforeAll(() => {
  const coverPath = resolve(REPO, 'public/templates/npc-cashflow-cover.jpg');
  const cover = readFileSync(coverPath);
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('npc-cashflow-cover')) {
      return {
        ok: true,
        blob: async () => new Blob([cover], { type: 'image/jpeg' }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
});

// ── Fixture ─────────────────────────────────────────────────────────────────
//
// Shared with the payload contract's tests so the two cannot drift; see
// `src/lib/reports/borrowingCapacity/__tests__/fixtures/sampleAssessment.ts`
// for the provenance of every field name in it.
//
// The generator reads `auditTrail` and `explanation` off the assessment object,
// so they are folded in here. Neither is a column — the Edge Function computes
// both and its `insert` does not persist them, which is why these two pages
// have never appeared in a shipping PDF (`BORROWING_CAPACITY.md` F12).

const ASSESSMENT = {
  ...SAMPLE_ASSESSMENT,
  auditTrail: SAMPLE_AUDIT_TRAIL,
  explanation: SAMPLE_EXPLANATION,
};

const FIXTURE = {
  clientId: '00000000-0000-4000-8000-000000000000',
  clientName: SAMPLE_CLIENT_NAME,
  assessment: ASSESSMENT,
  scenarioPresets: SAMPLE_SCENARIO_PRESETS,
  returnBlob: true as const,
};

// ── The capture ─────────────────────────────────────────────────────────────

describe('Borrowing Capacity Snapshot — golden capture', () => {
  let bytes: Buffer;
  let fileName: string;

  beforeAll(async () => {
    const { generateBorrowingCapacityPDF } = await import('../BorrowingCapacityPDFReport');
    const result = await generateBorrowingCapacityPDF(FIXTURE as never);
    expect(result, 'the generator returned nothing').toBeDefined();
    bytes = Buffer.from(await result!.blob.arrayBuffer());
    fileName = result!.fileName;

    mkdirSync(dirname(GOLDEN_PDF), { recursive: true });
    writeFileSync(GOLDEN_PDF, bytes);
  });

  it('produces a PDF', () => {
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(50_000);
  });

  it('names the file the way the product does', () => {
    expect(fileName).toMatch(/^Borrowing_Capacity_Snapshot_.*\.pdf$/);
  });

  /**
   * Page count is the single most useful thing a golden pins. A migration that
   * silently drops the audit trail or the scenario comparison changes nothing
   * a unit test would notice — but it changes this.
   */
  it('emits every conditional page the fixture turns on', () => {
    const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    // cover, summary, (flowing body), explanation, audit trail, scenarios, closing
    expect(pages).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ['the running foot', 'Borrowing Capacity Snapshot'],
    ['the executive summary', 'Executive Summary'],
    ['the income table', 'Income Analysis'],
    ['the capacity breakdown', 'Capacity Breakdown'],
    ['the calculation explanation', 'How This Was Calculated'],
    ['the audit trail', 'Audit Trail'],
    ['the scenario comparison', 'Scenario Comparison'],
  ])('contains %s', (_label, needle) => {
    // jsPDF writes text uncompressed with standard fonts, so the section titles
    // are literally in the byte stream.
    expect(bytes.toString('latin1')).toContain(needle);
  });

  /**
   * The two findings this capture is here to pin, so the rebuild can be
   * measured against them rather than argued about.
   */
  describe('what the current output gets wrong', () => {
    it('sets the entire document in Helvetica — no brand typeface anywhere', () => {
      const text = bytes.toString('latin1');
      expect(text).toMatch(/Helvetica/);
      for (const brandFace of ['Cinzel', 'Playfair', 'IBM Plex']) {
        expect(text).not.toContain(brandFace);
      }
    });

    it('carries a cover that names OUR company, whoever the tenant is', () => {
      // The fixture's issuing company is "Meridian Property Partners", and the
      // generator resolves that name — then pastes an NPC-branded JPEG over the
      // top of it anyway. The name only reaches the page if the image fetch
      // fails. The cover is a raster, so this asserts the code path rather than
      // the pixels: the tenant name appears nowhere on page one.
      const firstPage = bytes.toString('latin1').slice(0, bytes.indexOf('Executive Summary'));
      expect(firstPage).not.toContain('MERIDIAN');
    });
  });
});
