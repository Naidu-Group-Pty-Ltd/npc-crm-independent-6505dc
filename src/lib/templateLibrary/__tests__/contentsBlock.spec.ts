/**
 * The contents page, across every format that declares one.
 *
 * `toc` does not draw the list it is handed. It walks the document's own
 * rendered pages and sets one row per page, with that page's real name and real
 * number — which is why a conditional page dropping out still leaves the
 * numbering correct.
 *
 * `title` is the block's *heading*, and it used to be given
 * `entries.join('\n')`. A `<div>` collapses newlines, so every contents page in
 * the seven formats that declare one printed all twelve section names as a
 * single run-on line at heading size, immediately above the real list:
 *
 *   "The verdict Executive summary The ranking The scorecard Money · return,
 *    cash flow Location · catchment, amenity Risk · exposure, reward …"
 *
 * The height was wrong for the same reason the list was: it counted the section
 * names, while the renderer counts pages. A Property Comparison draws 17 pages
 * from a 12-name list, and the block declared height for 12 — so it ran past
 * the footer on `ap-03`, found by rendering a stored production row.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '../../reportTemplate/htmlRenderer';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { CLIENT_DETAILS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/clientDetails';
import { CASH_FLOW_COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlowComparison';

const SETS: Array<[string, any[]]> = [
  ['Investment Compass', INVESTMENT_COMPASS_TEMPLATES as any[]],
  ['Borrowing Capacity', BORROWING_CAPACITY_TEMPLATES as any[]],
  ['Portfolio Review', PORTFOLIO_TEMPLATES as any[]],
  ['Property Comparison', COMPARISON_TEMPLATES as any[]],
  ['10 Year Cash Flow', CASH_FLOW_COMPASS_TEMPLATES as any[]],
  ['Client Details', CLIENT_DETAILS_TEMPLATES as any[]],
  ['Cash Flow Comparison', CASH_FLOW_COMPARISON_TEMPLATES as any[]],
];

function tocBlocks(list: any[]): Array<{ slug: string; block: any; page: any; pages: number }> {
  const out: Array<{ slug: string; block: any; page: any; pages: number }> = [];
  for (const t of list) {
    for (const page of t.schema.pages as any[]) {
      for (const block of page.blocks as any[]) {
        if (block.type === 'toc') {
          out.push({ slug: t.slug, block, page, pages: (t.schema.pages as any[]).length });
        }
      }
    }
  }
  return out;
}

describe('the contents block carries no heading of its own', () => {
  for (const [label, list] of SETS) {
    it(`${label}: never sets the section names as the block title`, () => {
      const found = tocBlocks(list);
      expect(found.length, `${label} declares no contents page`).toBeGreaterThan(0);
      for (const { slug, block } of found) {
        const title = String(block.props.title ?? '');
        // The page's own sectionHeading already reads "Contents"; the renderer
        // omits the block heading when it is empty.
        expect(title, `${slug} set a toc title`).toBe('');
        // The specific regression: a joined list of section names.
        expect(title).not.toContain('\n');
      }
    });
  }
});

describe('the contents block reserves height for pages, not for section names', () => {
  for (const [label, list] of SETS) {
    it(`${label}: declares enough rows for the document it sits in`, () => {
      for (const { slug, block, pages } of tocBlocks(list)) {
        // The renderer draws one row per rendered page. The block must have
        // declared at least that much, or it prints over what is beneath it.
        const lineHeight = Number(block.props.lineHeight ?? 20);
        const declared = Number(block.props.height ?? 0);
        if (!declared) continue; // height lives on the flow item for some blocks
        expect(declared, `${slug} reserves fewer rows than the document has pages`)
          .toBeGreaterThanOrEqual(pages * lineHeight);
      }
    });
  }
});

describe('what the contents page actually prints', () => {
  it('lists the real pages and not the authored section names', () => {
    // 37 of the 50 declare a contents page — `toc_style` is a family trait, and
    // the first master in catalogue order is one of the thirteen without one.
    const t: any = (COMPARISON_TEMPLATES as any[]).find(
      (x) => x.schema.pages.some((p: any) => p.blocks.some((b: any) => b.type === 'toc')),
    );
    expect(t, 'no comparison master declares a contents page').toBeTruthy();
    const { html } = renderTemplateToHtml(t.schema, { data: {} });
    // The run-on blob, verbatim from the defect.
    expect(html).not.toContain('The verdict Executive summary');
    // Real rows, numbered by the renderer.
    expect(html).toContain('1. Cover');
    expect(html).toContain('2. Contents');
  });
});
