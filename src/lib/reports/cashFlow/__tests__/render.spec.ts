/**
 * What the document must be true of, whatever it says.
 *
 * Not a snapshot. These are the properties the legacy generator fails, stated
 * so that a future edit cannot quietly reintroduce them: a colour written into
 * the source, a matrix on a portrait page, a client's name interpolated into
 * markup unescaped, a tenant's report carrying our name.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { buildProjection } from '../normalise.pure';
import { DOCUMENT_NAME, formatPreparedOn, renderCashFlowBody, renderCashFlowDocument } from '../render.pure';
import { resolveSnapshotBrand } from '@/lib/reportDesign/documentBrand.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';

const REPO = resolve(__dirname, '../../../../..');

const YEAR = {
  year: 1,
  propertyValue: 815_100,
  loanBalance: 612_768,
  rentalIncome: 32_240,
  grossYield: 3.96,
  netYield: 2.53,
  expenses: 11_657,
  interestRate: 6.15,
  interest: 37_685,
  principal: 11_232,
  preTaxAnnual: -29_534,
  afterTaxAnnual: -18_692,
  depreciation: 11_000,
  taxRefund: 10_842,
  landTax: 1_200,
  capitalGrowth: 4.5,
  cpiGrowth: 2.5,
};

function projectionFor(address: string, clientName = 'Sample Client') {
  return buildProjection({
    source: {
      acquisition: {
        purchasePrice: 780_000, marketValue: 780_000, deposit: 156_000, loanAmount: 624_000,
        loanTermYears: 30, interestRate: 6.15, loanType: 'principal_interest', weeklyRent: 620,
        costs: [{ label: 'Stamp duty', amount: 31_090 }],
      },
      years: Array.from({ length: 10 }, (_, i) => ({ ...YEAR, year: i + 1 })),
      assumptions: [{ label: 'Capital growth', value: '4.5% per year' }],
      notes: [],
    },
    propertyAddress: address,
    clientName,
    now: '2026-08-02T00:00:00.000Z',
  });
}

/** A tenant who is emphatically not us. */
function tenantBrand() {
  const { snapshot } = buildReportBrandSnapshot({
    whitelabel: {
      id: 'wl-1', themeVersion: 1, companyName: 'Kestrel Buyers Agency',
      tradingName: '', brandColour: '#2E5E4E', preset: '', assets: {},
    },
    contact: { abn: '12 345 678 901', phone: '02 0000 0000', company_name: 'Kestrel Buyers Agency' } as never,
    document: { confidentiality: '', preparedBy: 'Kestrel Buyers Agency' },
    capturedAt: '2026-08-02T00:00:00.000Z',
  });
  return resolveSnapshotBrand({ snapshot, disclaimer: null, coverArtDataUri: null });
}

const render = (address = '14 Wattlebird Grove, Marsden Park NSW 2765') => {
  const brand = tenantBrand();
  return renderCashFlowDocument({
    projection: projectionFor(address),
    palette: brand.palette,
    company: brand.company,
    masthead: brand.masthead,
    lockup: brand.lockup,
    heroDataUri: brand.heroDataUri,
    confidentiality: brand.confidentiality,
  });
};

/** The document, on disk, for the eye. See `renderArtifact.ts`. */
beforeAll(() => {
  writeRenderArtifact('cash-flow-projection', render());
});

describe('the cash flow document', () => {
  it('is one HTML document with a title naming the format and the property', () => {
    const html = render();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('10 Year Cash Flow Analysis — 14 Wattlebird Grove');
    expect(DOCUMENT_NAME).toBe('10 Year Cash Flow Analysis');
  });

  /**
   * The matrix is the artefact. On a portrait page twelve columns get 42pt
   * each, which is what made the legacy export unreadable.
   */
  it('puts both projection matrices on the landscape page', () => {
    const html = render();
    const landscape = html.match(/class="page-landscape-table"/g) ?? [];
    expect(landscape).toHaveLength(2);
  });

  it('carries the tenant on the cover and the closing page, and us nowhere', () => {
    const html = render();
    expect(html).toContain('Kestrel Buyers Agency');
    expect(html.toLowerCase()).not.toContain('naidu');
    expect(html.toLowerCase()).not.toContain('npc services');
  });

  it('escapes a property address rather than interpolating it', () => {
    const html = render('12 <script>alert(1)</script> St');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('states the weekly figure with its period attached', () => {
    const html = render();
    expect(html).toContain('-$359/wk');
  });

  it('refuses to render a structurally invalid document rather than shipping it', () => {
    const brand = tenantBrand();
    const projection = projectionFor('A');
    expect(() => renderCashFlowDocument({
      // A projection with no years has no chapters, so the spine is invalid.
      projection: { ...projection, years: [], meta: { ...projection.meta, termYears: 0 } },
      palette: brand.palette,
      company: brand.company,
      masthead: brand.masthead,
    })).toThrow(/invalid structure/);
  });

  it('dates itself without asking the runtime what a locale is', () => {
    expect(formatPreparedOn('2026-08-02T13:45:00.000Z')).toBe('02 August 2026');
    expect(formatPreparedOn('nonsense')).toBe('');
  });
});

describe('what the document never contains', () => {
  /**
   * Not one colour is written into this format. Everything comes from the
   * resolved palette, which is contrast-checked as a whole — the legacy
   * generator writes `#c9a55a` into its source four times.
   */
  it('names no colour in any of its own modules', () => {
    for (const file of [
      'supabase/functions/_shared/reports/cashFlow/render.pure.ts',
      'supabase/functions/_shared/reports/cashFlow/charts.pure.ts',
      'supabase/functions/_shared/reports/cashFlow/normalise.pure.ts',
      'supabase/functions/_shared/reports/cashFlow/sections.pure.ts',
    ]) {
      const code = readFileSync(resolve(REPO, file), 'utf8')
        // A hex is allowed to be *named* in a comment explaining why it is gone.
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, `${file} writes a colour into the source`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('does not draw the body itself — no absolute positioning in the markup', () => {
    expect(renderCashFlowBody({
      projection: projectionFor('A'),
      ...(() => { const b = tenantBrand(); return { palette: b.palette, company: b.company, masthead: b.masthead }; })(),
    })).not.toMatch(/position:\s*absolute/);
  });
});

describe('the legacy generators', () => {
  /**
   * The instruction was explicit: the new path is added, the old ones stay.
   * This fails if a future edit deletes one of them from the modal.
   */
  it('are all still present in CashFlowAnalysisModal', () => {
    const modal = readFileSync(resolve(REPO, 'src/components/reports/CashFlowAnalysisModal.tsx'), 'utf8');
    for (const generator of ['exportSingleReportPDF', 'exportComparisonPDF', 'exportAiAnalysisPDF', 'handleExportExcel']) {
      expect(modal, `${generator} was removed`).toContain(`const ${generator}`);
    }
    expect(modal).toContain("import jsPDF from 'jspdf'");
  });

  it('are still reachable from the export menu', () => {
    const menu = readFileSync(resolve(REPO, 'src/components/cash-flow/modal/CashFlowExportMenu.tsx'), 'utf8');
    expect(menu).toContain('onExportPdf');
    expect(menu).toContain('Generate PDF (legacy layout)');
  });
});
