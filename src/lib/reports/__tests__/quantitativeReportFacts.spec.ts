/**
 * What a quantitative market report holds (`quantitativeReportFacts.ts`).
 *
 * The composed PDF read a report shape the pipeline no longer stores, and
 * every read had a default — "0.0% increase in listing volume", "median
 * listing price $0", "market health: Low" — beside tables of invented shares
 * and ten fixed Perth suburbs. The rules pinned here: every figure is read
 * from where `quantitative-report-pipeline` puts it, a figure the row does not
 * hold is null, and the snapshot says nothing about a fact it does not have.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { marketSnapshotSentences, readQuantitativeReportFacts } from '@/lib/reports/quantitativeReportFacts';
import type { StoredQuantitativeChart } from '@/lib/reports/quantitativeCharts';

/** A row exactly as the pipeline writes it (`kpis: built.metrics`, `analytics: { ...metrics, summary }`). */
const METRICS = { total_listings: 148, average_price: 812_450, median_price: 745_000, valid_price_count: 121, unique_suburbs: 37 };
const ROW = { listing_count: 148, kpis: METRICS, analytics: { ...METRICS, summary: 'A summary.' } };

const chart = (chart_key: string, title: string, data: Array<{ label: string; value: number }>): StoredQuantitativeChart => ({
  id: chart_key, chart_key, chart_type: 'bar', title, image_data: '', chart_config: { type: 'bar', data, title },
});
const CHARTS = [
  chart('suburb_volume', 'Suburb Volume Distribution', [
    { label: 'Tarneit', value: 18 }, { label: 'Unknown Suburb', value: 30 }, { label: 'Truganina', value: 22 }, { label: 'Werribee', value: 9 },
  ]),
  chart('daily_listing_activity', 'Daily Listing Activity', [{ label: '2026-09-24', value: 4 }, { label: '2026-09-25', value: 7 }]),
];

describe('reading the row the pipeline writes', () => {
  it('finds every figure where the pipeline puts it', () => {
    const f = readQuantitativeReportFacts(ROW, CHARTS);
    expect(f).toMatchObject({
      totalListings: 148, averagePrice: 812_450, medianPrice: 745_000, pricedListings: 121,
      // 37 stored, one of them the listings with no suburb (its chart shows the bucket).
      uniqueSuburbs: 36,
      recent30d: 11,
    });
  });

  it("counts only suburbs the listings name — the pipeline counts 'no suburb' as one", () => {
    const named = [chart('suburb_volume', 'Suburb Volume Distribution', [{ label: 'Tarneit', value: 18 }, { label: 'Truganina', value: 22 }])];
    expect(readQuantitativeReportFacts(ROW, named).uniqueSuburbs).toBe(37);
    // Only the pipeline's own chart says what its count holds; a keyless chart is not read for it.
    const keyless = [{ ...CHARTS[0], chart_key: null }];
    expect(readQuantitativeReportFacts(ROW, keyless).uniqueSuburbs).toBe(37);
    expect(readQuantitativeReportFacts(ROW, []).uniqueSuburbs).toBe(37);
  });

  it("takes the suburbs the pipeline counted, most first, without its 'no suburb' bucket", () => {
    expect(readQuantitativeReportFacts(ROW, CHARTS).topSuburbs).toEqual([
      { suburb: 'Truganina', listings: 22 }, { suburb: 'Tarneit', listings: 18 }, { suburb: 'Werribee', listings: 9 },
    ]);
  });

  it('reads an older row under its older spellings', () => {
    const f = readQuantitativeReportFacts({ kpis: { avg_price: 650_000, recent_30d: 12 }, analytics: { velocity: { label: 'Uptrend', delta: 4.2 }, quality: { avg_confidence: 0.825, completeness: 71 } } });
    expect(f).toMatchObject({ averagePrice: 650_000, recent30d: 12, velocity: { label: 'Uptrend', delta: 4.2 }, completeness: 71 });
    expect(f.confidence).toBeCloseTo(82.5, 10);
  });

  it('reads a stored confidence on its own scale — a 0–1 share is not a per cent', () => {
    // The generator stored the listings' average share; the page printed 0.78 as "0.8%".
    const at = (avg_confidence: unknown) => readQuantitativeReportFacts({ analytics: { quality: { avg_confidence } } }).confidence;
    expect(at(0.78)).toBeCloseTo(78, 10);
    expect(at(1)).toBe(100);
    expect(at(82.5)).toBe(82.5);
    expect(at(0)).toBeNull();
    expect(at(140)).toBeNull();
    expect(at('0.8')).toBeNull();
    expect(readQuantitativeReportFacts({ analytics: { quality: { completeness: 140 } } }).completeness).toBeNull();
  });

  it('holds nothing it was not given: no zero, no default, no invented suburb', () => {
    const f = readQuantitativeReportFacts({}, []);
    expect(f).toEqual({
      totalListings: null, averagePrice: null, medianPrice: null, pricedListings: null, uniqueSuburbs: null,
      recent30d: null, velocity: null, confidence: null, completeness: null, coverage: null, quartiles: null, topSuburbs: [],
    });
  });

  it('reads a zero price as no price — the pipeline writes 0 when nothing was priced', () => {
    const f = readQuantitativeReportFacts({ kpis: { total_listings: 12, average_price: 0, median_price: 0, valid_price_count: 0 } });
    expect(f.averagePrice).toBeNull();
    expect(f.medianPrice).toBeNull();
    // A count of zero is a count.
    expect(f.pricedListings).toBe(0);
  });
});

describe('the market snapshot', () => {
  it('is a sentence for each fact held', () => {
    expect(marketSnapshotSentences(readQuantitativeReportFacts(ROW, CHARTS))).toEqual([
      'This quantitative analysis covers 148 property listings across 36 suburbs.',
      'The median listing price is $745,000 and the average $812,450.',
      '121 of the 148 listings carried a price.',
      '11 listings were received in the last 30 days.',
    ]);
  });

  it('says nothing about momentum, confidence or completeness it does not hold', () => {
    const text = marketSnapshotSentences(readQuantitativeReportFacts(ROW, CHARTS)).join(' ');
    expect(text).not.toMatch(/momentum|stable|confidence|completeness|\$0\b|0\.0%/i);
  });

  it("says what the velocity means in words a sentence can carry", () => {
    const at = (label: string, delta: number | null) => marketSnapshotSentences(readQuantitativeReportFacts({ analytics: { velocity: { label, delta } } }));
    expect(at('Uptrend', 18.4)).toEqual(['Listing volume is rising, up 18.4% on the previous 30 days.']);
    expect(at('Downtrend', -6)).toEqual(['Listing volume is falling, down 6.0% on the previous 30 days.']);
    expect(at('Stable', null)).toEqual(['Listing volume is steady.']);
    expect(at('Seasonal', 2)).toEqual(['Listing volume trend: Seasonal, up 2.0% on the previous 30 days.']);
  });

  it('is empty for a row that holds nothing', () => {
    expect(marketSnapshotSentences(readQuantitativeReportFacts({}, []))).toEqual([]);
  });
});

describe('the composed PDF', () => {
  const viewer = readFileSync(resolve(__dirname, '../../../pages/ReportViewer.tsx'), 'utf8');
  const pdfPath = viewer.slice(viewer.indexOf('const handleDownloadPDF'), viewer.indexOf('if (loading) {'));

  it('reads the report through the facts, never a field the pipeline does not write', () => {
    expect(pdfPath).toMatch(/readQuantitativeReportFacts\(/);
    expect(pdfPath).not.toMatch(/kpis\??\.(avg_price|recent_30d)|analytics\??\.(velocity|quality|coverage)/);
  });

  it('prints no suburb, share or distribution it made up', () => {
    expect(pdfPath).not.toMatch(/City Beach|Cottesloe|Subiaco|500000|totalListingsVal \* 0\.\d|Math\.random/);
  });

  it('states no method or source the report did not use', () => {
    expect(pdfPath).not.toMatch(/public records|AI-powered|aggregators|intelligence systems|cross-referencing validation/i);
  });

  it('numbers its contents from the pages the sections were drawn on', () => {
    expect(pdfPath).not.toMatch(/`\$\{i \+ 3\}`/);
    expect(pdfPath).toMatch(/pdf\.setPage\(tocPageRef\)/);
  });

  it('lists a finding that is both high-priority and a warning once', () => {
    expect(pdfPath).toMatch(/const actionItems = \[\.\.\.highPriority, \.\.\.warnings\]\s*\.filter\(\(item, at, all\) => all\.indexOf\(item\) === at\)/);
  });

  it('never names the platform as the author, owner or adviser of an unbranded report', () => {
    // An unbranded clone's report is issued by Aurixa, which supplies the
    // software and prepared none of it (`PLATFORM_DISCLAIMER`).
    expect(pdfPath).toMatch(/const platformIssued = legacyBrand\.artwork === 'issuer' && legacyBrand\.issuer\.kind === 'platform'/);
    expect(pdfPath).toMatch(/if \(!platformIssued\) pdf\.text\('PREPARED BY'/);
    expect(pdfPath).toMatch(/const disclaimerText = platformIssued \? \[\s*\.\.\.PLATFORM_DISCLAIMER\.split/);
    const platformBranch = pdfPath.slice(
      pdfPath.indexOf('const disclaimerText = platformIssued ? ['),
      pdfPath.indexOf('] : [', pdfPath.indexOf('const disclaimerText = platformIssued ? [')),
    );
    expect(platformBranch).not.toMatch(/prepared by|©|All rights reserved/i);
    // Every "advisory" tagline is drawn only for a named business.
    for (const tagline of ['MARKET RESEARCH  •  ADVISORY', 'Market Research  •  Strategic Advisory']) {
      const at = pdfPath.indexOf(tagline);
      expect(at, tagline).toBeGreaterThan(-1);
      expect(pdfPath.slice(Math.max(0, at - 200), at)).toMatch(/if \(!platformIssued\) \{/);
    }
  });
});

describe('the report page', () => {
  const viewer = readFileSync(resolve(__dirname, '../../../pages/ReportViewer.tsx'), 'utf8');
  const page = viewer.slice(viewer.indexOf('if (loading) {'));

  it('reads the same facts as the PDF, so it prints no "N/A" for a field the pipeline never wrote', () => {
    expect(page).toMatch(/readQuantitativeReportFacts\(report, charts\)/);
    expect(page).not.toMatch(/kpis\??\.(avg_price|recent_30d|total_listings|unique_suburbs)|analytics\??\.(velocity|quality|coverage)/);
    expect(page).not.toMatch(/'N\/A'/);
  });

  it("prints an insight's words, never the stored object", () => {
    expect(page).not.toMatch(/report\.insights\.slice/);
    expect(page).toMatch(/insightTexts/);
  });
});
