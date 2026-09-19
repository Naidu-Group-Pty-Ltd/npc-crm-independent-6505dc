/**
 * The macro scan's negative control.
 *
 * The scan's finding over the whole library is *zero*, and a check that reports
 * nothing is indistinguishable from a check that looks at nothing. So this
 * plants one of each defect it claims to detect and asserts it is caught — and
 * plants the two compositions it must stay quiet about and asserts it is.
 *
 * The false-positive cases are the ones that matter. The first run of this scan
 * reported 48 defects, every one of them the Luxury Editorial plate: a monograph
 * page whose picture runs to the trim under a deliberate caption scrim. A scan
 * that cries wolf on a design decision gets switched off.
 */
import { describe, it, expect } from 'vitest';
import { scanTemplate, type Finding } from '../../../../scripts/template-library/macroScan.pure';

const PAGE_W = 595;
const PAGE_H = 842;

function tpl(pages: any[]): any {
  return { slug: 'planted', schema: { pages } };
}

function page(name: string, blocks: any[], extra: Record<string, unknown> = {}) {
  return { name, size: { width: PAGE_W, height: PAGE_H }, blocks, ...extra };
}

function blk(type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: `${type}-1`, type, props, overlays: [], ...extra };
}

function kinds(t: any): string[] {
  const out: Finding[] = [];
  scanTemplate(t, 'planted', out);
  return out.map((f) => f.kind);
}

describe('the scan catches what it claims to', () => {
  it('finds a block whose bottom runs under the footer band', () => {
    expect(kinds(tpl([page('P', [
      blk('text-block', { x: 40, y: 700, width: 500, height: 135 }),
    ])]))).toContain('under-footer');
  });

  it('finds a block that leaves the sheet sideways', () => {
    expect(kinds(tpl([page('P', [
      blk('text-block', { x: 40, y: 100, width: 700, height: 40 }),
    ])]))).toContain('off-page');
  });

  it('finds a negative box', () => {
    expect(kinds(tpl([page('P', [
      blk('text-block', { x: 40, y: 100, width: -10, height: 40 }),
    ])]))).toContain('negative-box');
  });

  it('finds two unconditional blocks that print over each other', () => {
    expect(kinds(tpl([page('P', [
      blk('text-block', { x: 40, y: 100, width: 500, height: 200 }),
      blk('table-block', { x: 40, y: 250, width: 500, height: 200 }),
    ])]))).toContain('overlap');
  });

  it('finds an unbalanced binding', () => {
    expect(kinds(tpl([page('P', [
      blk('text-block', { x: 40, y: 100, width: 500, height: 40, text: '{{property.address}' }),
    ])]))).toContain('malformed-binding');
  });

  it('finds an empty binding', () => {
    expect(kinds(tpl([page('P', [
      blk('text-block', { x: 40, y: 100, width: 500, height: 40, text: 'Prepared for {{ }}' }),
    ])]))).toContain('malformed-binding');
  });

  it('finds a page that can draw entirely blank', () => {
    expect(kinds(tpl([page('P', [
      blk('text-block', { x: 40, y: 100, width: 500, height: 40 }, { conditional: 'a' }),
      blk('text-block', { x: 40, y: 200, width: 500, height: 40 }, { conditional: 'b' }),
    ])]))).toContain('blank-page-risk');
  });

  it('finds a duplicate page name inside one template', () => {
    expect(kinds(tpl([
      page('Same', [blk('text-block', { x: 40, y: 100, width: 500, height: 40 })]),
      page('Same', [blk('text-block', { x: 40, y: 100, width: 500, height: 40 })]),
    ]))).toContain('duplicate-page-name');
  });
});

describe('the scan stays quiet about deliberate composition', () => {
  // These two are the Luxury Editorial plate, which is what the scan's first
  // run reported 48 times. Both must read as design.
  const bleedPlate = page('Plate 01', [
    blk('image', { src: '{{property.images.0}}', fit: 'cover', x: 0, y: 0, width: PAGE_W, height: PAGE_H }),
    blk('hero', {
      tintFade: true, tint: 'token:bg', title: '{{property.address}}',
      x: 0, y: PAGE_H - 220, width: PAGE_W, height: 220,
    }),
  ]);

  it('does not call a full-bleed plate an overflow', () => {
    expect(kinds(tpl([bleedPlate]))).not.toContain('under-footer');
    expect(kinds(tpl([bleedPlate]))).not.toContain('off-page');
  });

  it('does not call a caption scrim a collision', () => {
    expect(kinds(tpl([bleedPlate]))).not.toContain('overlap');
  });

  it('says nothing at all about a correctly composed plate', () => {
    expect(kinds(tpl([bleedPlate]))).toEqual([]);
  });

  it('does not flag a page whose blocks merely sit adjacent', () => {
    expect(kinds(tpl([page('P', [
      blk('text-block', { x: 40, y: 100, width: 500, height: 100 }),
      blk('text-block', { x: 40, y: 200, width: 500, height: 100 }),
    ])]))).toEqual([]);
  });

  it('does not flag the running foot for sitting in the footer band', () => {
    expect(kinds(tpl([page('P', [
      blk('page-number', { x: 40, y: PAGE_H - 18, width: 500, height: 12 }),
      blk('running-head', { x: 40, y: PAGE_H - 18, width: 500, height: 12 }),
    ])]))).toEqual([]);
  });
});
