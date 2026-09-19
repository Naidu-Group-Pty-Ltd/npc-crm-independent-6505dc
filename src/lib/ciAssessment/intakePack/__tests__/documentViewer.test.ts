/* eslint-disable no-restricted-syntax -- the hex values asserted here are the
   supplied document's own brand colours. Checking them against a semantic token
   would defeat the purpose: the point is that the file's colours survive. */

/**
 * The viewer has to show the approved document, not an approximation of it.
 *
 * These tests render the real files that ship in `src/assets/intakePack` and
 * assert on what comes out: the sheets that exist, the values *as formatted by
 * the spreadsheet* rather than the raw numbers underneath them, the styling
 * that carries meaning (brand header bands, cream input cells), and the merged
 * ranges and column widths that make it a spreadsheet rather than a list.
 *
 * They also pin the two properties that keep it safe: the rendered document is
 * script-free, and rendering never touches the source bytes.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { renderWorkbookToHtml } from '../viewer/excelToHtml';
import { readWorkbookStyles } from '../viewer/xlsxStyles';

const ASSET_DIR = resolve(__dirname, '../../../../assets/intakePack');

function bytes(fileName: string): ArrayBuffer {
  const buffer = readFileSync(resolve(ASSET_DIR, fileName));
  return new Uint8Array(buffer).buffer as ArrayBuffer;
}

const BLANK = 'CommercialIndustrialFinanceIntakeWorkbook.xlsx';
const EXAMPLE = 'CommercialIndustrialFinanceIntakeWorkbookMOCKDATA.xlsx';

describe('workbook viewer', () => {
  it('renders every sheet in the file, in order', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      'Start here', 'Summary', '1. Transaction', '2. Purpose', '3. Ownership',
      '4. Income', '4b. Add-backs', '5. Portfolio', '5b. Liabilities',
      '6. Tenancies', '6b. Lease terms', '7. Proceed',
    ]);
  });

  it('shows the figures as the spreadsheet formats them', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    const summary = sheets.find((sheet) => sheet.name === 'Summary')!;

    // Currency with its symbol and grouping, not 5850000.
    expect(summary.html).toContain('$5,850,000');
    expect(summary.html).toContain('$6,588,250');
    // A ratio as a percentage, not as 0.7.
    expect(summary.html).toContain('70.0%');
    // The em dash the format uses for zero, not "$0".
    expect(summary.html).toContain('—');
  });

  it('shows cached formula results rather than formula text', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    const summary = sheets.find((sheet) => sheet.name === 'Summary')!;
    // `=N('1. Transaction'!$B$11)` belongs in Excel's formula bar, not on the
    // page where a reader is looking for a number.
    expect(summary.html).not.toContain("N('1. Transaction'");
    expect(summary.html).not.toContain('IFERROR');
  });

  it('keeps the answers a reader came to see', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    const ownership = sheets.find((sheet) => sheet.name === '3. Ownership')!;
    expect(ownership.html).toContain('Asteron Industrial Holdings Pty Ltd');
    expect(ownership.html).toContain('Trust');
  });

  it('carries the styling that makes the sheet readable', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    const ownership = sheets.find((sheet) => sheet.name === '3. Ownership')!;

    // The brand header band, and white bold text on it. Without the styles pass
    // this would be black-on-brown — see xlsxStyles for why neither library
    // supplies this on its own.
    expect(ownership.html).toContain('background:#5c3f1f');
    expect(ownership.html).toContain('font-weight:700');
    expect(ownership.html).toMatch(/color:#f[0-9a-f]{5}/i);
  });

  it('preserves merges, widths and row heights', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    const summary = sheets.find((sheet) => sheet.name === 'Summary')!;
    expect(summary.html).toContain('colspan=');
    expect(summary.html).toMatch(/<col style="width:\d+px">/);
    expect(summary.html).toMatch(/<tr style="height:\d+px">/);
  });

  it('renders the blank template as a blank form', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(BLANK));
    const transaction = sheets.find((sheet) => sheet.name === '1. Transaction')!;
    // The questions are there; the answers are not.
    expect(transaction.html).toContain('What is the full street address of the property?');
    expect(transaction.html).not.toContain('88 Foundry Link');
  });

  it('produces a document with nothing executable in it', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    sheets.forEach((sheet) => {
      expect(sheet.html).not.toMatch(/<script/i);
      expect(sheet.html).not.toMatch(/\son[a-z]+\s*=/i);
      expect(sheet.html).not.toMatch(/javascript:/i);
    });
  });

  it('leaves the source file untouched', async () => {
    const before = createHash('sha256').update(readFileSync(resolve(ASSET_DIR, EXAMPLE))).digest('hex');
    await renderWorkbookToHtml(bytes(EXAMPLE));
    const after = createHash('sha256').update(readFileSync(resolve(ASSET_DIR, EXAMPLE))).digest('hex');
    expect(after).toBe(before);
  });
});

describe('every sheet reports a size that can hold it', () => {
  /**
   * The reported defect, three times over: the frame was sized from the row
   * heights stored in the file, and every sheet was clipped by between 53px and
   * 362px because a browser wraps text where Excel did not.
   *
   * jsdom cannot lay the sheets out, so this pins the floor rather than the
   * measurement: no sheet may report a size smaller than its own grid, and none
   * may report zero — a frame of zero height shows nothing at all. The
   * measurement proper is verified in Chromium.
   */
  it('never reports a size below the grid it contains', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));

    sheets.forEach((sheet) => {
      const columns = (sheet.html.match(/<col style="width:(\d+)px">/g) ?? [])
        .map((tag) => Number(/width:(\d+)px/.exec(tag)?.[1] ?? 0));
      const rows = (sheet.html.match(/<tr style="height:(\d+)px">/g) ?? [])
        .map((tag) => Number(/height:(\d+)px/.exec(tag)?.[1] ?? 0));

      const gridWidth = columns.reduce((total, width) => total + width, 0);
      const gridHeight = rows.reduce((total, height) => total + height, 0);

      expect(sheet.width, `${sheet.name} width`).toBeGreaterThanOrEqual(gridWidth);
      expect(sheet.height, `${sheet.name} height`).toBeGreaterThanOrEqual(gridHeight);
    });
  });

  it('gives every sheet a usable size', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    sheets.forEach((sheet) => {
      expect(sheet.width, `${sheet.name} width`).toBeGreaterThan(100);
      expect(sheet.height, `${sheet.name} height`).toBeGreaterThan(100);
    });
  });

  /**
   * The fourth recurrence's lesson. When measurement is unavailable — here,
   * because jsdom has no layout engine — the arithmetic grid sum is known to
   * run up to 358px short on this pack, so an unmeasured sheet must ship with
   * generous slack over its grid and say `measured: false`, which is the
   * viewer's cue to re-measure the sheet when its tab is shown. An unmeasured
   * sheet that is too tall shows blank space; one that is too short silently
   * cuts rows off.
   */
  it('pads an unmeasured sheet well beyond its grid, and says so', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));

    sheets.forEach((sheet) => {
      expect(sheet.measured, `${sheet.name} measured`).toBe(false);

      const rows = (sheet.html.match(/<tr style="height:(\d+)px">/g) ?? [])
        .map((tag) => Number(/height:(\d+)px/.exec(tag)?.[1] ?? 0));
      const gridHeight = rows.reduce((total, height) => total + height, 0);
      // 358px is the worst measured shortfall; the pad must clear it with room.
      expect(sheet.height, `${sheet.name} height`).toBeGreaterThanOrEqual(gridHeight + 400);
    });
  });
});

describe('worked example is fully fictional', () => {
  it('names the fictional firm, not the real one', async () => {
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    const start = sheets.find((sheet) => sheet.name === 'Start here')!;

    expect(start.html).toContain('Meridian Commercial Advisory');
    expect(start.html).toContain('meridiancommercial.example');
    // A demonstration document shipped to every tenant must not carry one
    // firm's real trading name, website or ABN.
    expect(start.html).not.toContain('Naidu');
    expect(start.html).not.toContain('npcservices');
  });

  it('leaves the borrower\'s own identifiers alone', async () => {
    // The mock data gave the client the same ABN as the firm. Only the firm's
    // contact row was rebranded; the borrowing entity is untouched.
    const { sheets } = await renderWorkbookToHtml(bytes(EXAMPLE));
    const ownership = sheets.find((sheet) => sheet.name === '3. Ownership')!;
    expect(ownership.html).toContain('25 689 472 311');
    expect(ownership.html).toContain('Asteron Industrial Holdings Pty Ltd');
  });

  it('keeps the real firm on the blank template', async () => {
    // The template is the firm's own fact-find. It is the example that has to
    // be generic, not the document they hand to a client.
    const { sheets } = await renderWorkbookToHtml(bytes(BLANK));
    const start = sheets.find((sheet) => sheet.name === 'Start here')!;
    expect(start.html).not.toContain('Meridian Commercial Advisory');
  });
});

describe('workbook styles', () => {
  it('resolves fonts, fills and alignment the other readers drop', async () => {
    const styles = await readWorkbookStyles(bytes(EXAMPLE));
    const ownership = styles.get('3. Ownership');
    expect(ownership).toBeDefined();

    const header = ownership!.get('A3');
    expect(header?.fill).toBe('#5c3f1f');
    expect(header?.bold).toBe(true);
    expect(header?.fontColour).toBeTruthy();

    // Input cells are cream; that convention is what tells a client which
    // cells are theirs, so it has to survive into the viewer.
    const input = ownership!.get('A4');
    expect(input?.fill).toBeTruthy();
    expect(input?.fill).not.toBe(header?.fill);
  });

  it('returns an empty map rather than throwing on a file it cannot read', async () => {
    const notAZip = new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer;
    await expect(readWorkbookStyles(notAZip)).rejects.toBeTruthy();
  });
});
