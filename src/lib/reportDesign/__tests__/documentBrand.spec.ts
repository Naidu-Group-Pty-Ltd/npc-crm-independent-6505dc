/**
 * The brand snapshot is the only thing that decides what this document looks
 * like.
 *
 * The claim these tests have to earn is narrow and specific: **a tenant's
 * report carries the tenant, and carries us nowhere.** The shipping generator
 * fails it in the most visible way possible — page 1 says Naidu, page 8 says
 * the tenant — and the failure is not a bug in a branch, it is what happens
 * when the brand is looked up in five places instead of resolved in one.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
// Imported from the canonical path: `defaultAssets.generated.ts` is not a
// `.pure.ts`, so the bridge directory deliberately does not carry one.
import {
  NPC_HOUSE_COVER_ART,
  NPC_HOUSE_MARK,
} from '../../../../scripts/reportDesign/generated/defaultAssets.generated';
import { auditPaletteContrast } from '@/lib/reportDesign/brandResolve.pure';

import { DEFAULT_CONFIDENTIALITY, resolveSnapshotBrand } from '../documentBrand.pure';
import { buildSnapshot } from '@/lib/reports/borrowingCapacity/normalise.pure';
import { renderSnapshotFromBrand } from '@/lib/reports/borrowingCapacity/render.pure';
import {
  SAMPLE_ASSESSMENT,
  SAMPLE_AUDIT_TRAIL,
  SAMPLE_CLIENT_NAME,
  SAMPLE_EXPLANATION,
  SAMPLE_GLOBAL_SETTINGS,
  SAMPLE_SCENARIO_PRESETS,
} from '../../reports/borrowingCapacity/__tests__/fixtures/sampleAssessment';

const CAPTURED_AT = '2026-08-01T00:00:00.000Z';

/**
 * A 128x128 PNG: a hollow square outline, 350 bytes.
 *
 * Deliberately a real picture at a real size. The first draft of this fixture
 * was a 1x1 PNG, which passed every byte-and-mime check and rendered on the
 * cover as a 22mm red block — which is what made `MIN_ASSET_EDGE_PX` exist.
 */
const TENANT_MARK = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABJUlEQVR42u3SsQ0AMAgDQUZh+eyUbUKdEZDvJXdU6Oqefpa78gQAPAIAA8AAMAAMAAPAADAA/kOtCgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8FAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsJQBAIAnAGAAGAAGgAFgABgAFrIBQY4fEYNfF2UAAAAASUVORK5CYII='}`;

const tenantSnapshot = (over: Record<string, unknown> = {}) =>
  buildReportBrandSnapshot({
    whitelabel: {
      id: 'wl-1',
      themeVersion: 3,
      companyName: 'Meridian Property Partners',
      tradingName: 'Meridian',
      brandColour: '210 68% 38%',
      preset: 'editorial_navy',
      assets: { report: TENANT_MARK, reportMono: TENANT_MARK },
      ...over,
    },
    contact: SAMPLE_GLOBAL_SETTINGS.contactDetails as never,
    document: { confidentiality: 'Confidential · Prepared for the named client' },
    capturedAt: CAPTURED_AT,
  }).snapshot;

const payload = buildSnapshot({
  clientName: SAMPLE_CLIENT_NAME,
  assessment: SAMPLE_ASSESSMENT,
  auditTrail: SAMPLE_AUDIT_TRAIL,
  explanation: SAMPLE_EXPLANATION,
  scenarioPresets: SAMPLE_SCENARIO_PRESETS,
});

const render = (snapshot = tenantSnapshot()) =>
  renderSnapshotFromBrand({
    payload,
    snapshot,
    disclaimer: SAMPLE_GLOBAL_SETTINGS.disclaimer as never,
    reference: 'BCS-2026-0801',
  });

/**
 * A second document on disk beside the house one, for the eye — a tenant with
 * their own colour, their own mark and no cover art of ours. `reports/` is
 * gitignored.
 */
const HTML_OUT = resolve(__dirname, '../../../../..', 'reports/html/borrowing-capacity-tenant.html');

beforeAll(() => {
  mkdirSync(dirname(HTML_OUT), { recursive: true });
  writeFileSync(HTML_OUT, render().html);
});

describe('a tenant gets their own document', () => {
  it('takes the palette from the snapshot, not from a default', () => {
    const brand = resolveSnapshotBrand({ snapshot: tenantSnapshot() });
    const house = resolveSnapshotBrand({ snapshot: tenantSnapshot({ brandColour: null, preset: 'signature' }) });
    expect(brand.palette.accentFill).not.toBe(house.palette.accentFill);
  });

  it('puts the tenant in the running foot of every page', () => {
    const brand = resolveSnapshotBrand({ snapshot: tenantSnapshot() });
    expect(brand.masthead).toContain('Meridian');
    expect(render().html).toContain(brand.masthead.toUpperCase().slice(0, 8));
  });

  it('puts the tenant on the cover and on the closing page', () => {
    const html = render().html;
    // Both grounds, one identity — the thing the shipping generator gets wrong.
    const cover = html.slice(0, html.indexOf('</section>'));
    const closing = html.slice(html.indexOf('company-page'));
    expect(cover).toContain('MERIDIAN');
    expect(closing).toContain('MERIDIAN');
  });

  it('carries the tenant mark on the dark cover ground', () => {
    const brand = resolveSnapshotBrand({ snapshot: tenantSnapshot() });
    expect(brand.lockup?.markDataUri).toBe(TENANT_MARK);
    expect(brand.lockup?.onField).toBe(true);
    expect(render().html).toContain(TENANT_MARK);
  });

  it('uses the snapshot wording on the cover foot', () => {
    expect(render().html).toContain('Confidential · Prepared for the named client');
  });

  it('falls back to a house line only for the confidentiality wording', () => {
    const snapshot = buildReportBrandSnapshot({
      whitelabel: { companyName: 'Nameless Advisory' },
      contact: SAMPLE_GLOBAL_SETTINGS.contactDetails as never,
      capturedAt: CAPTURED_AT,
    }).snapshot;
    expect(resolveSnapshotBrand({ snapshot }).confidentiality).toBe(DEFAULT_CONFIDENTIALITY);
  });
});

describe('and gets nothing of ours', () => {
  /**
   * `NPC_HOUSE_COVER_ART` is not a photograph. It is a finished NPC cover with
   * our company name, our tagline and our monogram burned into the pixels — its
   * own doc comment says it must never be a white-label fallback. This asserts
   * the brand resolver cannot reach it.
   */
  it('never reaches the house cover art (F1)', () => {
    const html = render().html;
    expect(html).not.toContain(NPC_HOUSE_COVER_ART.slice(0, 120));
    expect(html).not.toContain(NPC_HOUSE_MARK.slice(0, 120));
  });

  it('leaves the cover unillustrated rather than borrowing ours', () => {
    const brand = resolveSnapshotBrand({ snapshot: tenantSnapshot() });
    expect(brand.heroDataUri).toBeNull();
    // …and uses the tenant's when there is one.
    expect(
      resolveSnapshotBrand({ snapshot: tenantSnapshot(), coverArtDataUri: TENANT_MARK }).heroDataUri,
    ).toBe(TENANT_MARK);
  });

  it('names neither us nor our tagline anywhere in the document (F1)', () => {
    const html = render().html;
    for (const ours of ['Naidu', 'NAIDU', 'YOUR DEDICATED PROPERTY PARTNER', 'npc-cashflow-cover']) {
      expect(html, `the document names "${ours}"`).not.toContain(ours);
    }
  });
});

describe('a snapshot with holes in it', () => {
  const bare = buildReportBrandSnapshot({ capturedAt: CAPTURED_AT }).snapshot;

  it('still renders a complete document', () => {
    const { html } = renderSnapshotFromBrand({ payload, snapshot: bare });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('Capacity at a glance');
    expect(html).not.toContain('undefined');
  });

  /**
   * Reported, not thrown. A report with no ABN is a worse report, not an
   * impossible one, and refusing to render turns a cosmetic gap into an outage.
   */
  it('reports what is missing instead of failing', () => {
    const { gaps } = renderSnapshotFromBrand({ payload, snapshot: bare });
    expect(gaps.join(' ')).toContain('no company name');
    expect(gaps.join(' ')).toContain('no ABN');
    expect(gaps.join(' ')).toContain('no brand mark');
  });

  it('reports nothing for a complete snapshot', () => {
    expect(render().gaps).toEqual([]);
  });

  it('flags a disabled disclaimer, which is the one gap worth acting on', () => {
    const { gaps } = renderSnapshotFromBrand({
      payload,
      snapshot: tenantSnapshot(),
      disclaimer: { ...(SAMPLE_GLOBAL_SETTINGS.disclaimer as Record<string, unknown>), is_enabled: false } as never,
    });
    expect(gaps.join(' ')).toContain('disclaimer is disabled');
  });
});

describe('every tenant colour is legible', () => {
  /**
   * A tenant may configure any colour. Category A cascades from it; Category B
   * — the semantic colours a financial table depends on — is frozen and
   * unreachable from tenant input. `auditPaletteContrast` is what proves the
   * cascade lands somewhere legible rather than trusting that it does.
   */
  it.each([
    ['a mid blue', '210 68% 38%'],
    ['a pale yellow', '#F5E663'],
    ['near-black', '#101010'],
    ['pure white', '#FFFFFF'],
    ['the house gold', null],
  ])('clears the print contrast floors for %s', (_label, brandColour) => {
    const snapshot = tenantSnapshot({ brandColour });
    const brand = resolveSnapshotBrand({ snapshot });
    expect(auditPaletteContrast(brand.palette)).toEqual([]);
  });
});

describe('re-issuing a report', () => {
  /**
   * The reason a snapshot exists rather than a lookup. A report generated today
   * and re-issued after the tenant rebrands must reproduce what the client was
   * originally sent — so the same snapshot has to produce byte-identical
   * output, and a changed snapshot has to produce different output.
   */
  it('reproduces the same document from the same snapshot', () => {
    const snapshot = tenantSnapshot();
    expect(render(snapshot).html).toBe(render(snapshot).html);
  });

  it('produces a different document after a rebrand', () => {
    expect(render(tenantSnapshot()).html)
      .not.toBe(render(tenantSnapshot({ brandColour: '#7A1F1F', companyName: 'Someone Else' })).html);
  });

  it('fingerprints the brand it was issued under', () => {
    expect(tenantSnapshot().fingerprint).not.toBe(tenantSnapshot({ brandColour: '#7A1F1F' }).fingerprint);
    expect(tenantSnapshot().fingerprint).toBe(tenantSnapshot().fingerprint);
  });
});

describe('the last hardcoded gold in this format', () => {
  /**
   * `#C9A55A` was the fallback cover's gold in the shipping generator — one of
   * three across the format's five implementations, and none of them the brand
   * (F7). It now comes from `accentOnField`, the role the design system
   * contrast-checks for brand type on a dark ground.
   */
  it('is gone from the borrowing capacity generators', () => {
    const REPO = resolve(__dirname, '../../../..');
    for (const file of [
      'src/components/borrowing-capacity/BorrowingCapacityPDFReport.tsx',
      'src/utils/borrowingCapacityPdfSections.ts',
      'src/utils/borrowingCapacityPdfLibSections.ts',
      'src/components/borrowing-capacity/scenarios/StrategyRationalePDF.ts',
    ]) {
      const source = readFileSync(resolve(REPO, file), 'utf8')
        // The finding is allowed to be *named* in a comment explaining its removal.
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source, `${file} still carries the literal`).not.toMatch(/c9a55a/i);
      expect(source, `${file} still carries the literal`).not.toMatch(/201,\s*g:\s*165,\s*b:\s*90/);
    }
  });
});
