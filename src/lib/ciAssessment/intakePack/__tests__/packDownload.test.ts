/**
 * Preparing a blank intake pack for download (`packDownload.ts`).
 *
 * The two answers that matter, pinned: the prime with no design gets the
 * approved file exactly as it always did — the anchor points at the inlined
 * source and nothing is read, rebuilt or re-zipped — and a clone's pack that
 * cannot be prepared is NOT handed over, because the approved file names
 * another business in its consent clause.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/reports/drawnDocumentDesign', () => ({ drawnDesignFor: vi.fn(async () => null) }));
vi.mock('@/lib/reports/legacyDocumentBrand', () => ({ loadCloneIssuerName: vi.fn(async () => undefined) }));
vi.mock('@/hooks/useGlobalReportSettings', () => ({
  fetchGlobalReportSettings: vi.fn(async () => ({ contactDetails: { company_name: 'Coastline Realty' } })),
}));

import {
  PACK_DESIGN_NOT_APPLIED_TEXT,
  PACK_NOT_PREPARED_TEXT,
  loadPackPresentation,
  preparePackDownload,
  type PackDownloadDeps,
} from '../packDownload';
import type { PackPresentation } from '../packPresentation';
import type { PackSourceDocument } from '../sourceDocuments';
import { drawnDesignFor } from '@/lib/reports/drawnDocumentDesign';
import { loadCloneIssuerName } from '@/lib/reports/legacyDocumentBrand';
import { DESIGN_NOT_USED_TITLE } from '@/lib/reportTemplate/standardDesign';
import type { DrawnDocumentDesign } from '@/lib/reportDesign/drawnDesign.pure';

const SOURCE: PackSourceDocument = {
  id: 'workbook-blank',
  kind: 'workbook',
  variant: 'blank',
  fileName: 'CommercialIndustrialFinanceIntakeWorkbook.xlsx',
  url: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,AAA=',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  title: 'Commercial & Industrial Finance Intake Workbook',
};

const DESIGN = { label: 'Private Banking — Chancery' } as unknown as DrawnDocumentDesign;

function deps(presentation: PackPresentation, over: Partial<PackDownloadDeps> = {}) {
  const notified: Array<[string, string]> = [];
  const revoked: string[] = [];
  const d: PackDownloadDeps = {
    source: vi.fn(() => SOURCE),
    read: vi.fn(async () => new ArrayBuffer(8)),
    presentation: vi.fn(async () => presentation),
    present: vi.fn(async () => new Uint8Array([1, 2, 3])),
    objectUrl: vi.fn(() => 'blob:prepared'),
    revokeObjectUrl: (url) => { revoked.push(url); },
    notify: (title, description) => { notified.push([title, description]); },
    ...over,
  };
  return { d, notified, revoked };
}

describe('the prime, with no design chosen', () => {
  it('points the anchor at the approved file itself — nothing is read or rebuilt', async () => {
    const { d } = deps({});
    const pack = await preparePackDownload('workbook', d);
    expect(pack.href).toBe(SOURCE.url);
    expect(pack.fileName).toBe(SOURCE.fileName);
    expect(d.read).not.toHaveBeenCalled();
    expect(d.present).not.toHaveBeenCalled();
    expect(d.objectUrl).not.toHaveBeenCalled();
  });
});

describe('a pack presented for this deployment', () => {
  it('is handed over under the approved file name, and its URL released after', async () => {
    const { d, revoked } = deps({ issuerName: 'Coastline Realty' });
    const pack = await preparePackDownload('workbook', d);
    expect(d.present).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'workbook', { issuerName: 'Coastline Realty' });
    expect(pack.href).toBe('blob:prepared');
    expect(pack.fileName).toBe(SOURCE.fileName);
    const blob = (d.objectUrl as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe(SOURCE.mimeType);
    pack.release();
    expect(revoked).toEqual(['blob:prepared']);
  });

  it('is the approved file where presenting it changed nothing', async () => {
    const { d } = deps({ design: DESIGN }, { present: vi.fn(async () => null) });
    expect((await preparePackDownload('guide', d)).href).toBe(SOURCE.url);
  });
});

describe('when the pack cannot be presented', () => {
  it("on a clone, nothing is handed over — the approved file names another business", async () => {
    const { d } = deps({ issuerName: null }, { present: vi.fn(async () => { throw new Error('corrupt'); }) });
    await expect(preparePackDownload('workbook', d)).rejects.toThrow(PACK_NOT_PREPARED_TEXT);
    expect(d.objectUrl).not.toHaveBeenCalled();
  });

  it('on the prime, only the design is lost, and the person is told', async () => {
    const { d, notified } = deps({ design: DESIGN }, { present: vi.fn(async () => { throw new Error('corrupt'); }) });
    const pack = await preparePackDownload('workbook', d);
    expect(pack.href).toBe(SOURCE.url);
    expect(notified).toEqual([[DESIGN_NOT_USED_TITLE, PACK_DESIGN_NOT_APPLIED_TEXT]]);
  });
});

describe("this deployment's presentation", () => {
  it('is the design chosen for Commercial & Industrial Capacity, and no name on the prime', async () => {
    vi.mocked(drawnDesignFor).mockResolvedValueOnce(DESIGN);
    vi.mocked(loadCloneIssuerName).mockResolvedValueOnce(undefined);
    const presentation = await loadPackPresentation();
    expect(presentation).toEqual({ design: DESIGN });
    expect('issuerName' in presentation).toBe(false);
    expect(drawnDesignFor).toHaveBeenCalledWith('commercial_intake_pack');
  });

  it("is the clone's business, read from the report settings' contact name first", async () => {
    vi.mocked(loadCloneIssuerName).mockImplementationOnce(async (read) => {
      const name = typeof read === 'function' ? await (read as () => Promise<unknown>)() : read;
      return String(name);
    });
    expect(await loadPackPresentation()).toEqual({ issuerName: 'Coastline Realty', design: null });
  });

  it('is a clone naming nobody where its settings name nobody', async () => {
    vi.mocked(loadCloneIssuerName).mockResolvedValueOnce(null);
    expect(await loadPackPresentation()).toEqual({ issuerName: null, design: null });
  });
});
