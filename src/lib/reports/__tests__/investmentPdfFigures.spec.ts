import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  drawProjectionLineChart,
  drawScoreBars,
  drawSparkline,
  readProjectionSeries,
  readScoreComponents,
  sparklineSeries,
  type FigurePalette,
} from '../investment/investmentPdfFigures';

/** The shape a real row carries — verbatim from a production record. */
const PRODUCTION_PROJECTIONS = {
  projections: {
    moderate: Array.from({ length: 10 }, (_, i) => ({
      roi: -20.31 + i * 3,
      year: i + 1,
      equity: 116372 + i * 20000,
      cashFlow: -23099 + i * 900,
      annualRent: 23834 + i * 800,
      loanBalance: 439183 - i * 6000,
      propertyValue: 555555 + i * 22000,
      cumulativeCashFlow: -23099 * (i + 1),
    })),
    conservative: [],
    optimistic: [],
  },
};

const PALETTE: FigurePalette = {
  ink: rgb(0, 0, 0), muted: rgb(0.5, 0.5, 0.5), accent: rgb(0.7, 0.6, 0.3),
  rule: rgb(0.85, 0.85, 0.85), positive: rgb(0.2, 0.5, 0.2), negative: rgb(0.6, 0.1, 0.1),
};

const surface = async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  return {
    page,
    fonts: {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    },
    // Object streams compress the content stream; the assertions below read
    // the drawing operators, so the document is saved uncompressed.
    bytes: () => doc.save({ useObjectStreams: false }),
  };
};

/**
 * The drawing operators the page emitted.
 *
 * pdf-lib Flate-compresses every content stream, so "did it draw this?" is not
 * a substring search over the file — it is a search over the INFLATED streams.
 * Reading the raw bytes instead finds nothing and passes every negative
 * assertion, which is the shape of a test that proves nothing.
 */
const drawn = async (doc: { bytes: () => Promise<Uint8Array> }): Promise<string> => {
  const raw = Buffer.from(await doc.bytes());
  const out: string[] = [];
  const marker = Buffer.from('stream');
  let at = raw.indexOf(marker);
  while (at !== -1) {
    let start = at + marker.length;
    if (raw[start] === 0x0d) start += 1;
    if (raw[start] === 0x0a) start += 1;
    const end = raw.indexOf(Buffer.from('endstream'), start);
    if (end === -1) break;
    const body = raw.subarray(start, end);
    try {
      // pdf-lib writes every string as a HEX literal — `<50726F…> Tj` — so the
      // operators are decoded before they are searched. Reading them raw finds
      // no word of the document and passes every negative assertion.
      out.push(inflateSync(body).toString('latin1').replace(
        /<([0-9A-Fa-f]+)>/g,
        (whole, hex: string) => (hex.length % 2 === 0
          ? Buffer.from(hex, 'hex').toString('latin1')
          : whole),
      ));
    } catch { /* not a deflated stream */ }
    at = raw.indexOf(marker, end);
  }
  return out.join('\n');
};

describe('reading the series the record carries', () => {
  it('reads the ten-year moderate scenario', () => {
    const series = readProjectionSeries(PRODUCTION_PROJECTIONS);
    expect(series).toHaveLength(10);
    expect(series?.[0]).toMatchObject({ year: 1, propertyValue: 555555 });
  });

  /**
   * 22 of the 216 stored reports with financials carry no `projections` at
   * all. A chart invented for them would be a confident figure against
   * nothing — the failure this programme has already had once.
   */
  it('answers null rather than inventing a series', () => {
    expect(readProjectionSeries(null)).toBeNull();
    expect(readProjectionSeries({})).toBeNull();
    expect(readProjectionSeries({ projections: {} })).toBeNull();
    expect(readProjectionSeries({ projections: { moderate: [] } })).toBeNull();
    // One point is not a series.
    expect(readProjectionSeries({ projections: { moderate: [{ year: 1, equity: 1 }] } })).toBeNull();
  });

  it('reads the scored dimensions and names them in words', () => {
    const components = readScoreComponents({
      breakdown: {
        growthScore: { score: 58, weight: 40 },
        locationScore: { score: 70, weight: 25 },
      },
    });
    expect(components).toEqual([
      { label: 'Growth', score: 58, weight: 40 },
      { label: 'Location', score: 70, weight: 25 },
    ]);
  });

  it('answers an empty list for a record with no breakdown', () => {
    expect(readScoreComponents(null)).toEqual([]);
    expect(readScoreComponents({})).toEqual([]);
    expect(readScoreComponents({ breakdown: { note: 'not a number' } })).toEqual([]);
  });
});

describe('drawing', () => {
  const box = { x: 55, y: 400, width: 485, height: 150 };

  it('draws a projection chart and says it drew one', async () => {
    const s = await surface();
    const series = readProjectionSeries(PRODUCTION_PROJECTIONS)!;
    expect(drawProjectionLineChart(
      s.page, series, 'propertyValue', 'Projected property value', box, s.fonts, PALETTE,
    )).toBe(true);
    const content = await drawn(s);
    expect(content).toContain('Projected property value');
    // Every gridline carries the value it stands for.
    expect(content).toMatch(/\$\d/);
  });

  it('draws nothing, and says so, for a field the record does not carry', async () => {
    const s = await surface();
    const series = [{ year: 1 }, { year: 2 }];
    expect(drawProjectionLineChart(
      s.page, series, 'propertyValue', 'Projected property value', box, s.fonts, PALETTE,
    )).toBe(false);
    expect(await drawn(s)).not.toContain('Projected property value');
  });

  it('refuses a box too small to be read', async () => {
    const s = await surface();
    const series = readProjectionSeries(PRODUCTION_PROJECTIONS)!;
    expect(drawProjectionLineChart(
      s.page, series, 'equity', 'Equity', { x: 0, y: 0, width: 30, height: 10 },
      s.fonts, PALETTE,
    )).toBe(false);
  });

  it('draws scored dimensions on a common baseline', async () => {
    const s = await surface();
    expect(drawScoreBars(
      s.page,
      [{ label: 'Growth', score: 58 }, { label: 'Location', score: 70 }],
      'Scored dimensions', { x: 55, y: 600, width: 485, height: 60 }, s.fonts, PALETTE,
    )).toBe(true);
    const content = await drawn(s);
    expect(content).toContain('Scored dimensions');
    expect(content).toContain('Growth');
    expect(content).toContain('58');
  });

  it('draws no bars for a record with no scored dimensions', async () => {
    const s = await surface();
    expect(drawScoreBars(
      s.page, [], 'Scored dimensions', { x: 55, y: 600, width: 485, height: 60 },
      s.fonts, PALETTE,
    )).toBe(false);
  });

  it('draws a sparkline from a series and refuses one point', async () => {
    const s = await surface();
    const series = readProjectionSeries(PRODUCTION_PROJECTIONS)!;
    const values = sparklineSeries(series, 'propertyValue');
    expect(values).toHaveLength(10);
    expect(drawSparkline(s.page, values, { x: 100, y: 700, width: 120, height: 9 }, PALETTE)).toBe(true);
    expect(drawSparkline(s.page, [5], { x: 100, y: 680, width: 120, height: 9 }, PALETTE)).toBe(false);
    expect(drawSparkline(s.page, [], { x: 100, y: 660, width: 120, height: 9 }, PALETTE)).toBe(false);
  });

  /**
   * A sparkline carries no label and no axis by design. The moment it needs
   * one it wants to be a chart instead — and a labelled word-sized graphic
   * beside a figure is two readings of the same number competing.
   */
  it('a sparkline draws no text at all', async () => {
    const s = await surface();
    const before = (await drawn(s)).length;
    drawSparkline(s.page, [1, 5, 3, 8], { x: 100, y: 700, width: 120, height: 9 }, PALETTE);
    const after = await drawn(s);
    expect(after.length).toBeGreaterThan(before);
    expect(after).not.toContain('Tj');
  });
});
