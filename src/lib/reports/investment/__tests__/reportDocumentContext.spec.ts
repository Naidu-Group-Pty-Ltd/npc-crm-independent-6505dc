/**
 * A brochure's or a listing's words reach every section of a report.
 *
 * The owner's commercial-readiness item (26 Sep 2026): "Brochure text reaches
 * only the first batch of report sections. Links to property listings have the
 * same limitation." Only the first invocation of a generation is handed the
 * document (in `propertyDetails`); a continuation is sent `{ reportId,
 * propertyAddress, continueFrom }`. So the first invocation keeps the context
 * it composed, and every later invocation handed no document reads it back.
 *
 * What is held here:
 *
 *   - the kept record round-trips, and nothing that is not one is read;
 *   - a kept copy stands in only for the same report at the same address;
 *   - keeping and reading never throw and never wait long;
 *   - the generator composes the prompt section from the kept fields ALONE,
 *     keeps it only where it was handed a document, and reads it only where it
 *     was not — so a continuation states the document exactly as the first
 *     invocation did.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOCUMENT_CONTEXT_MAX_TEXT_BYTES,
  REPORT_SOURCES_BUCKET,
  buildReportDocumentContext,
  documentContextPath,
  keptDocumentApplies,
  normaliseReportAddress,
  parseReportDocumentContext,
  type ReportDocumentContext,
} from '../reportDocumentContext.pure';
import {
  keepReportDocumentContext,
  readReportDocumentContext,
  type ReportSourcesClient,
} from '../../../../../supabase/functions/_shared/reports/investment/reportDocumentContextStore';
import { UPLOADED_DOCUMENT_MAX_BYTES } from '../uploadedDocumentText.pure';

const REPORT = '79d677d6-1c2b-4e5f-8a9b-0c1d2e3f4a5b';
const ADDRESS = 'Lot 1629 Hornsea Street, Armstrong Creek VIC 3217';

const record = (over: Partial<ReportDocumentContext> = {}): ReportDocumentContext => ({
  ...buildReportDocumentContext({
    reportId: REPORT,
    address: ADDRESS,
    source: 'pdf',
    sourceLabel: 'PDF Document',
    text: 'Lot 1629 Hornsea Street. A four-bedroom home with a double garage.',
    extractedDetails: '\n\n**EXTRACTED PROPERTY SPECIFICATIONS:**\nNew Build: Yes\n',
    keptAt: '2026-09-26T04:00:00.000Z',
  }),
  ...over,
});

describe('the kept record', () => {
  it('lives in its own folder of the private bucket, one per report', () => {
    expect(REPORT_SOURCES_BUCKET).toBe('listing-images');
    expect(documentContextPath(REPORT)).toBe(`report-sources/${REPORT}/document.json`);
    expect(documentContextPath(REPORT.toUpperCase())).toBe(`report-sources/${REPORT}/document.json`);
    // Nothing that is not a report id names a path — least of all one that climbs.
    for (const bad of ['', '../other', `${REPORT}/../x`, 'report-photographs']) {
      expect(documentContextPath(bad)).toBeNull();
    }
  });

  it('round-trips through JSON, which is how a continuation reads it', () => {
    const kept = record();
    expect(parseReportDocumentContext(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
  });

  it('is bounded above anything the generator writes', () => {
    // A listing page is kept at 24,000 bytes and an uploaded document at 12,000.
    expect(DOCUMENT_CONTEXT_MAX_TEXT_BYTES).toBeGreaterThan(24_000);
    expect(DOCUMENT_CONTEXT_MAX_TEXT_BYTES).toBeGreaterThan(UPLOADED_DOCUMENT_MAX_BYTES);
  });

  it('refuses anything this module did not write', () => {
    const good = JSON.parse(JSON.stringify(record()));
    const cases: unknown[] = [
      null, 'text', [], {},
      { ...good, version: 2 },
      { ...good, reportId: 'not-a-report' },
      { ...good, address: '  ' },
      { ...good, source: 'email' },
      { ...good, sourceLabel: '' },
      { ...good, text: '' },
      { ...good, text: 'x'.repeat(DOCUMENT_CONTEXT_MAX_TEXT_BYTES + 1) },
      { ...good, extractedDetails: 42 },
      { ...good, keptAt: undefined },
    ];
    for (const raw of cases) expect(parseReportDocumentContext(raw)).toBeNull();
  });
});

describe('a kept copy stands in only for its own report and address', () => {
  it('applies to the same report at the same address, however the address is cased or spaced', () => {
    const kept = record();
    expect(keptDocumentApplies(kept, { reportId: REPORT, address: ADDRESS })).toBe(true);
    expect(keptDocumentApplies(kept, { reportId: REPORT.toUpperCase(), address: `  ${ADDRESS.toUpperCase()}  ` })).toBe(true);
    expect(keptDocumentApplies(kept, { reportId: REPORT, address: ADDRESS.replace(/ /g, '   ') })).toBe(true);
  });

  it('does not apply to another address, another report, or no address at all', () => {
    const kept = record();
    expect(keptDocumentApplies(kept, { reportId: REPORT, address: '1630 Hornsea Street, Armstrong Creek VIC 3217' })).toBe(false);
    expect(keptDocumentApplies(kept, { reportId: '00000000-0000-4000-8000-000000000000', address: ADDRESS })).toBe(false);
    expect(keptDocumentApplies(kept, { reportId: REPORT, address: '' })).toBe(false);
    expect(keptDocumentApplies(kept, { reportId: REPORT, address: undefined })).toBe(false);
  });

  it('compares addresses by the rule the generator applies to a request and its row', () => {
    expect(normaliseReportAddress('  12 Smith St,  Suburb ')).toBe('12 smith st, suburb');
    expect(normaliseReportAddress(null)).toBe('');
  });
});

/** A storage double: what was written, and what a download answers. */
function storage(opts: {
  uploadError?: string;
  download?: () => Promise<{ data: Blob | null; error: { message?: string } | null }>;
  hang?: 'upload' | 'download';
} = {}) {
  const writes: { bucket: string; path: string; body: string; upsert: boolean }[] = [];
  const never = new Promise<never>(() => {});
  const client: ReportSourcesClient = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path, body, options) => {
          if (opts.hang === 'upload') return never;
          writes.push({ bucket, path, body: await body.text(), upsert: options.upsert });
          return { error: opts.uploadError ? { message: opts.uploadError } : null };
        },
        download: async (path) => {
          if (opts.hang === 'download') return never;
          if (opts.download) return opts.download();
          const hit = writes.find((w) => w.bucket === bucket && w.path === path);
          return hit
            ? { data: new Blob([hit.body], { type: 'application/json' }), error: null }
            : { data: null, error: { message: 'Object not found' } };
        },
      }),
    },
  };
  return { client, writes };
}

describe('keeping and reading', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the record where a later invocation reads it back, overwriting an older one', async () => {
    const { client, writes } = storage();
    expect(await keepReportDocumentContext(client, record())).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ bucket: 'listing-images', path: `report-sources/${REPORT}/document.json`, upsert: true });
    expect(await readReportDocumentContext(client, REPORT)).toEqual(record());
  });

  it('answers null — never throws — for nothing kept, a refused store or a body it did not write', async () => {
    expect(await readReportDocumentContext(storage().client, REPORT)).toBeNull();
    const garbage = storage({ download: async () => ({ data: new Blob(['{not json'], { type: 'application/json' }), error: null }) });
    expect(await readReportDocumentContext(garbage.client, REPORT)).toBeNull();
    const foreign = storage({ download: async () => ({ data: new Blob([JSON.stringify({ version: 1 })]), error: null }) });
    expect(await readReportDocumentContext(foreign.client, REPORT)).toBeNull();
    const refused = storage({ download: async () => { throw new Error('network'); } });
    expect(await readReportDocumentContext(refused.client, REPORT)).toBeNull();
  });

  it('reports a write it could not make, and never throws', async () => {
    expect(await keepReportDocumentContext(storage({ uploadError: 'Bucket not found' }).client, record())).toBe(false);
    expect(await keepReportDocumentContext(storage().client, record({ reportId: 'nope' }))).toBe(false);
  });

  it('gives up on a store that does not answer, rather than holding up the report', async () => {
    vi.useFakeTimers();
    const kept = keepReportDocumentContext(storage({ hang: 'upload' }).client, record());
    const read = readReportDocumentContext(storage({ hang: 'download' }).client, REPORT);
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(kept).resolves.toBe(false);
    await expect(read).resolves.toBeNull();
  });
});

describe('the generator', () => {
  const src = readFileSync(
    resolve(__dirname, '../../../../../supabase/functions/generate-investment-report/index.ts'),
    'utf8',
  );
  const acquisition = src.slice(
    src.indexOf('    let documentContext: ReportDocumentContextInput | null = null;'),
    src.indexOf('    if (documentContext) {\n'),
  );
  const compose = src.slice(
    src.indexOf('    if (documentContext) {\n'),
    src.indexOf('      prompt = documentContextSection + prompt;'),
  );

  it('composes the document section from the kept context alone', () => {
    expect(compose.length).toBeGreaterThan(1000);
    // Anything read from the request here would differ on a continuation.
    for (const requestOnly of ['fromPdfUpload', 'documentContent', 'propertyDetails', 'scrapedContent', 'sourceUrl']) {
      expect(compose, requestOnly).not.toContain(requestOnly);
    }
    expect(compose).toContain('documentContext.sourceLabel');
    expect(compose).toContain('documentContext.text');
    expect(compose).toContain('documentContext.extractedDetails');
  });

  it('keeps the context only where it was handed a document, and reads it only where it was not', () => {
    const handed = acquisition.slice(0, acquisition.indexOf('    } else if (reportId && supabaseClient) {'));
    const notHanded = acquisition.slice(acquisition.indexOf('    } else if (reportId && supabaseClient) {'));
    expect(handed).toMatch(/if \(documentContent\) \{/);
    expect(handed).toContain('keepReportDocumentContext(');
    expect(handed).not.toContain('readReportDocumentContext(');
    expect(notHanded).toContain('readReportDocumentContext(');
    expect(notHanded).toContain('keptDocumentApplies(kept, { reportId, address: propertyAddress })');
    expect(notHanded).not.toContain('keepReportDocumentContext(');
  });

  it('keeps what it composed — the bounded words, not the raw document', () => {
    expect(acquisition).toMatch(/text: boundedDocumentText,/);
    expect(acquisition).toMatch(/extractedDetails: extractedDetailsText,/);
  });
});
