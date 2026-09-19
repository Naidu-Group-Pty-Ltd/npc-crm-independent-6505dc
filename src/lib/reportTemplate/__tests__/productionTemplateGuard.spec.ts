/**
 * A template that is a copy of one report must not render another.
 *
 * The case these pin is not hypothetical: `report_templates` held a 61-page
 * "Investment Compass — WeasyPrint Pilot" imported from one client's PDF, with
 * 3,452 literal `content` strings and **zero** `{{ }}` bindings, marked
 * `is_default` + `scope: global` for `tier: compass`. Every Compass report
 * resolved to it and rendered that client's property, with the requesting
 * client's address substituted into the PDF title and nowhere else.
 */
import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_ASSET_BUCKET,
} from '../rendering/pdfImportPagePolicy';
import { refuseUnboundReconstruction } from '../rendering/productionTemplateGuard';

const RASTER = `https://x.supabase.co/storage/v1/object/public/${PDF_IMPORT_ASSET_BUCKET}/6922/page-1-0.jpg`;

const overlay = (content: string) => ({
  id: 'o1', type: 'text', content, x: 51, y: 605, width: 300, height: 40,
});

const importPage = (content: string) => ({
  id: 'p1',
  name: 'Cover',
  size: { width: 595, height: 842 },
  background: { imageUrl: RASTER },
  blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [overlay(content)] }],
});

describe('refusing a static reconstruction', () => {
  it('refuses the shape that shipped: import rasters and no bindings', () => {
    const refusal = refuseUnboundReconstruction({
      version: 1,
      pages: [importPage('Lot 60941 Cloverton,'), importPage('Kalkallo, VIC 3064')],
    });
    expect(refusal?.code).toBe('unbound-pdf-import-reconstruction');
    expect(refusal?.reason).toContain('2 of 2 pages');
    expect(refusal?.reason).toContain('no data bindings');
  });

  it('allows it the moment a single field is bound', () => {
    // One binding is enough. Someone is building a template rather than
    // storing a copy, and half-finished work is not this guard's business.
    expect(refuseUnboundReconstruction({
      version: 1,
      pages: [importPage('{{property.address}}'), importPage('Kalkallo, VIC 3064')],
    })).toBeNull();
  });

  it('finds a binding wherever it lives, not only in overlay content', () => {
    expect(refuseUnboundReconstruction({
      version: 1,
      meta: { subtitle: 'Prepared for {{client.name}}' },
      pages: [importPage('Lot 60941 Cloverton,')],
    })).toBeNull();
  });
});

describe('what it deliberately leaves alone', () => {
  it('a hand-built static template with no import raster', () => {
    // A fixed terms-and-conditions sheet is a legitimate thing to have. Only
    // the intersection — import raster AND no bindings — is certainly a copy.
    expect(refuseUnboundReconstruction({
      version: 1,
      pages: [{
        id: 'p1', name: 'Terms', size: { width: 595, height: 842 },
        background: {},
        blocks: [{ id: 'b', type: 'text', props: { text: 'Standard terms apply.' } }],
      }],
    })).toBeNull();
  });

  it('a decorative background is not an import raster', () => {
    expect(refuseUnboundReconstruction({
      version: 1,
      pages: [{
        id: 'p1', name: 'Cover', size: { width: 595, height: 842 },
        background: { imageUrl: 'https://x.supabase.co/storage/v1/object/public/report-assets/hero.jpg' },
        blocks: [{ id: 'b', type: 'text', props: { text: 'Annual Review' } }],
      }],
    })).toBeNull();
  });

  it('an empty or page-less template', () => {
    expect(refuseUnboundReconstruction({ version: 1, pages: [] })).toBeNull();
    expect(refuseUnboundReconstruction({ version: 1 })).toBeNull();
    expect(refuseUnboundReconstruction(null)).toBeNull();
  });
});

describe('the production route consults it', () => {
  it('is wired into routeReportThroughTemplate before the render', async () => {
    // Read as text: the guard is only worth having if the production path
    // actually calls it, and this is the one path that selects a template on
    // a client's behalf.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../routeReportThroughTemplate.ts'),
      'utf8',
    );
    expect(src).toContain('refuseUnboundReconstruction');
    // Before the document is drawn, not after. What draws it has changed —
    // the route compiled HTML for a render service and now calls the
    // presentation renderer in this browser — so the ordering is asserted
    // against whatever produces the bytes.
    const renderAt = src.indexOf('renderTemplateToBlob(');
    expect(renderAt, 'the route no longer draws a document at all').toBeGreaterThan(-1);
    expect(src.indexOf('refuseUnboundReconstruction(')).toBeLessThan(renderAt);
  });
});
