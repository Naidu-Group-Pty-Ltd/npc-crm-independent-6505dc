/**
 * Every investment surface delivers THE document — and the paths that used
 * to deliver something else stay reachable under their true names.
 *
 * Audit F11/F12/F16: the page's primary Download saved a `.txt`; Send to
 * Client shipped whatever `pdf_url` held (legacy route or browser raster,
 * whichever wrote last); the Market Intelligence scheduled email had nothing
 * to attach because nothing on the scheduled path ever rendered a PDF. These
 * are source pins in the repo's own idiom: the rule is asserted where the
 * wiring lives, so a refactor that quietly reverts a surface fails here by
 * name.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const VIEW_PAGE = 'src/pages/InvestmentReportView.tsx';

describe('the report page (F11)', () => {
  const source = code(VIEW_PAGE);

  it('primary download delivers the document, not a text dump', () => {
    const handler = /const handleDownload = async[\s\S]*?\n {2}\};/.exec(source)?.[0] ?? '';
    expect(handler, 'handleDownload not found').not.toBe('');
    expect(handler).toContain('deliverInvestmentPdf(');
    expect(handler).not.toContain('text/plain');
  });

  it('the raw-text export survives, separately and honestly named', () => {
    const handler = /const handleExportText = [\s\S]*?\n {2}\};/.exec(source)?.[0] ?? '';
    expect(handler, 'handleExportText not found').not.toBe('');
    expect(handler).toContain('text/plain');
    // Offered where its labels say "raw text": the export panel's button and
    // the header's menu item.
    expect(source).toMatch(/onDownload=\{handleExportText\}/);
    expect(source).toMatch(/onExportText=\{handleExportText\}/);
  });
});

describe('Send to Client (F12)', () => {
  const source = code(VIEW_PAGE);
  const modalRegion = /<SendToClientModal[\s\S]*?\/>/.exec(source)?.[0] ?? '';

  it('publishes a freshly produced document, never a stale pdf_url', () => {
    expect(modalRegion, 'SendToClientModal not found').not.toBe('');
    expect(modalRegion).toMatch(/storagePath=\{null\}/);
    expect(modalRegion).toContain('publishInvestmentPdf(');
  });

  /**
   * The send had a SECOND generator behind it on failure — a different
   * document, drawn from a different projection and honouring a different half
   * of the five export controls — so a send that fell back delivered something
   * the operator had never seen. Reachability was the argument for keeping it
   * and it was the wrong one: the canonical contract already falls back from a
   * chosen template to the standard presentation, both drawn from the same
   * final payload, and a failure past that is worth surfacing rather than
   * papering over with a third document.
   */
  it('has ONE producer, with no second document behind it', () => {
    expect(modalRegion).toContain('publishInvestmentPdf(');
    expect(modalRegion).not.toContain('generateAndUpload');
    expect(code(VIEW_PAGE)).not.toContain('pdfGeneratorRef');
  });

  it('carries all five export controls into the send', () => {
    for (const flag of [
      'includeSources', 'includeScoring', 'includeCharts', 'includeHeroImages', 'includeSparklines',
    ]) {
      expect(modalRegion, `${flag} must reach the published document`).toContain(flag);
    }
  });
});

describe('the scheduled Market Intelligence email (F16)', () => {
  const dispatcher = code('supabase/functions/dispatch-marketing-reports/index.ts');

  it('renders a PDF when the report has none, through the composer route', () => {
    expect(dispatcher).toContain('render-market-intelligence-pdf');
    expect(dispatcher).toMatch(/persist:\s*true/);
    expect(dispatcher).toContain('renderReportPdf(');
  });

  it('acts for the schedule creator, never on bare service authority', () => {
    expect(dispatcher).toContain('onBehalfOfUserId');
    expect(dispatcher).toMatch(/renderReportPdf\([^)]*schedule\.created_by/);
  });

  it('the route checks the named user and still refuses anonymous service_role', () => {
    const route = code('supabase/functions/render-market-intelligence-pdf/index.ts');
    expect(route).toContain("auth.userId === 'service_role'");
    expect(route).toContain('onBehalfOfUserId');
    // The delegated identity is what the permission gate judges…
    expect(route).toMatch(/requireModulePermission\(\s*supabase,\s*\{ userId: actorId/);
    // …and it can never be the short-circuit value.
    expect(route).toMatch(/actorAuthMethod = 'delegated_internal'/);
  });
});
