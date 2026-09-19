import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), 'src/components/clients', file), 'utf8');

describe('client finance action regression guards', () => {
  it('keeps PDF download as a dedicated guarded client action and removes legacy menu items', () => {
    const generator = source('FormaraPDFGenerator.tsx');
    const workspace = source('ClientDetailsModal.tsx');

    expect(generator).toContain("action?: 'finance' | 'download'");
    expect(generator).toContain("if (action === 'download')");
    expect(generator).toContain('actionLock.current');
    expect(generator).not.toContain('Export Client Details as PDF');
    expect(generator).not.toContain('FlattenPdfMenuItem');
    // Since the legacy consolidation the typeset control is the toolbar's
    // primary download and the raster button follows it with its layout
    // named — both still dedicated, still capability-guarded actions.
    expect(workspace).toContain('<ClientDetailsDownloadButton');
    expect(workspace).toContain("'Download (legacy layout)'");
  });

  it('keeps finance delivery actions in the finance menu and moves portfolio analysis from Reports', () => {
    const generator = source('FormaraPDFGenerator.tsx');
    const reports = source('ClientReportsTab.tsx');
    const portfolio = source('PortfolioAnalysisPDFGenerator.tsx');
    const workspace = source('ClientDetailsModal.tsx');

    expect(generator).toContain('Compose Email with PDF');
    expect(generator).toContain('Quick Send to Finance');
    expect(reports).not.toContain('PortfolioAnalysisPDFGenerator');
    expect(reports).not.toContain('FlattenPdfIconButton');
    expect(portfolio).not.toContain('Flattened PDF');
    expect(workspace).toContain('<PortfolioAnalysisPDFGenerator');
  });

  it('base64-encodes inline PDF attachments for the email API contract', () => {
    const compose = source('ClientEmailCompose.tsx');

    expect(compose).toContain('await fileToBase64(inlineAttachment.blob)');
    expect(compose).not.toContain('Array.from(new Uint8Array(await inlineAttachment.blob.arrayBuffer()))');
  });

  it('does not count explicitly previous employment as current PDF income', () => {
    const generator = source('FormaraPDFGenerator.tsx');

    expect(generator).toContain('const current = empList.filter(e => e.is_current !== false)');
    expect(generator).toContain('const totals = current.reduce');
    expect(generator).not.toContain('current.length ? current : empList');
  });
});
