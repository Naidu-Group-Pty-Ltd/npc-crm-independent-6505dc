/**
 * The four source documents are pinned artefacts and must not drift.
 *
 * "Must not change" is easy to say and easy to break — a well-meaning re-save
 * through Excel, a lint rule that normalises line endings, a build step that
 * recompresses a zip. All of those produce a file that still opens and is no
 * longer the document that was approved, and nobody notices until it is in a
 * client's inbox.
 *
 * So the checksums below are the contract. If one fails, the fix is to restore
 * the file — not to update the hash. A hash moves only alongside a deliberate,
 * requested edit, and the only one so far is recorded here:
 *
 *  - **The two blank templates are byte-identical to what was supplied.** Their
 *    hashes have never moved and must not.
 *  - **The two MOCKDATA examples were edited once**, on request, to replace the
 *    real adviser firm's name and contact details with a fictional firm
 *    (Meridian Commercial Advisory). Nothing else was touched: a string
 *    replacement inside the OOXML parts, leaving styles, layout, page breaks
 *    and formulas alone. A demonstration document shipped to every tenant
 *    should not carry one firm's real trading name, website and ABN.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ASSET_DIR = resolve(__dirname, '../../../../assets/intakePack');

/** SHA-256 of each file as it must be on disk. See the header for the one edit. */
const APPROVED = {
  'CommercialIndustrialFinanceIntakeWorkbook.xlsx':
    'a0a6334b6044755e8c35d193b8e6eb4df7ff1b28bb88bed0d199c7e7786c05ec',
  'CommercialIndustrialFinanceIntakeWorkbookMOCKDATA.xlsx':
    '126da64431670d3984a527b38032d342126ea3afb4837e3f824251b4a5f48446',
  'CommercialIndustrialFinanceIntakePack.docx':
    '47062d81593cb377b062cb0d9be7067426d10b7ea4b1e1045009931236f732ae',
  'CommercialIndustrialFinanceIntakePackMOCKDATA.docx':
    '8fd7e49419095dbf3c63fd859b1d82a1148301ac246736167aa441bf66ffc11e',
} as const;

/** Byte lengths, so a truncated file fails with a clearer message than a hash. */
const SIZES = {
  'CommercialIndustrialFinanceIntakeWorkbook.xlsx': 43_724,
  'CommercialIndustrialFinanceIntakeWorkbookMOCKDATA.xlsx': 35_019,
  'CommercialIndustrialFinanceIntakePack.docx': 52_511,
  'CommercialIndustrialFinanceIntakePackMOCKDATA.docx': 51_920,
} as const;

describe('intake pack source documents', () => {
  Object.entries(APPROVED).forEach(([fileName, expected]) => {
    it(`${fileName} matches its pinned checksum`, () => {
      const bytes = readFileSync(resolve(ASSET_DIR, fileName));
      expect(bytes.byteLength).toBe(SIZES[fileName as keyof typeof SIZES]);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected);
    });
  });

  it('serves the exact approved bytes, not a re-encoding of them', async () => {
    // The checksums above prove the file on disk is right. This proves the
    // thing a user actually receives is the same file: the module is imported
    // through the real Vite plugin, so the assertion is on the data URL the
    // download anchor points at.
    const { PACK_SOURCE_DOCUMENTS } = await import('../sourceDocuments');
    expect(PACK_SOURCE_DOCUMENTS).toHaveLength(4);

    for (const source of PACK_SOURCE_DOCUMENTS) {
      const base64 = source.url.split(',')[1] ?? '';
      expect(base64.length).toBeGreaterThan(0);
      const served = Buffer.from(base64, 'base64');
      const expected = APPROVED[source.fileName as keyof typeof APPROVED];
      expect(expected, `${source.fileName} is not in the approved list`).toBeTruthy();
      expect(createHash('sha256').update(served).digest('hex')).toBe(expected);
    }
  });

  it('carries the approved file names and types', async () => {
    const { PACK_SOURCE_DOCUMENTS } = await import('../sourceDocuments');
    // The download keeps the supplied name; anything else and the file a
    // client receives is not recognisably the one that was approved.
    expect(PACK_SOURCE_DOCUMENTS.map((source) => source.fileName).sort())
      .toEqual(Object.keys(APPROVED).sort());
    PACK_SOURCE_DOCUMENTS.forEach((source) => {
      expect(source.url.startsWith(`data:${source.mimeType};base64,`)).toBe(true);
    });
  });

  it('ships exactly these four and no others', () => {
    // A fifth file in the directory means somebody added a variant that is not
    // covered by a checksum, which is the state this guard exists to prevent.
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    expect(readdirSync(ASSET_DIR).sort()).toEqual(Object.keys(APPROVED).sort());
  });
});
