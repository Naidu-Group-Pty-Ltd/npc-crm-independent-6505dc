import { describe, expect, it } from 'vitest';
import { buildPageLines, decodeSpan, renderPageText, type PdfTextItemLike } from '../pdfTextLayout';

/** Build a PDF.js-shaped text item at a page position. */
function item(
  str: string,
  x: number,
  y: number,
  { size = 10, width, rotation = 0 }: { size?: number; width?: number; rotation?: number } = {},
): PdfTextItemLike {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    str,
    // [a, b, c, d, e, f] with a uniform scale plus rotation.
    transform: [size * cos, size * sin, -size * sin, size * cos, x, y],
    width: width ?? str.length * size * 0.5,
    height: size,
  };
}

describe('decodeSpan', () => {
  it('derives position, font size and rotation from the text matrix', () => {
    const span = decodeSpan(item('Hello', 72, 700, { size: 12 }))!;
    expect(span.x).toBe(72);
    expect(span.y).toBe(700);
    expect(span.fontSize).toBeCloseTo(12, 6);
    expect(span.rotation).toBeCloseTo(0, 6);
  });

  it('reports rotated text', () => {
    const span = decodeSpan(item('Side', 40, 400, { rotation: 90 }))!;
    expect(span.rotation).toBeCloseTo(90, 6);
  });

  it('rejects a non-finite transform instead of emitting NaN geometry', () => {
    expect(decodeSpan({ str: 'x', transform: [Number.NaN, 0, 0, 10, 0, 0] })).toBeNull();
  });
});

describe('buildPageLines', () => {
  it('returns nothing for empty input', () => {
    expect(buildPageLines([])).toEqual([]);
    expect(buildPageLines(null)).toEqual([]);
  });

  it('joins runs split mid-word without inserting a space', () => {
    // The classic PDF.js kerning split that used to yield "Rich mond".
    const lines = buildPageLines([
      item('Rich', 100, 700, { size: 10, width: 20 }),
      item('mond', 120, 700, { size: 10, width: 22 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('Richmond');
  });

  it('inserts a single space at a word-sized gap', () => {
    const lines = buildPageLines([
      item('Weekly', 100, 700, { size: 10, width: 30 }),
      item('rent', 133, 700, { size: 10, width: 20 }),
    ]);
    expect(lines[0]!.text).toBe('Weekly rent');
  });

  it('separates columns instead of gluing a label to a different value', () => {
    // Two-column form row: "Weekly rent   $650" and "Council rates   $2,100".
    const lines = buildPageLines([
      item('Weekly rent', 60, 700, { size: 10, width: 50 }),
      item('$650', 300, 700, { size: 10, width: 22 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('Weekly rent  $650');
  });

  it('groups items onto lines by geometry, not content-stream order', () => {
    // Emitted out of order, as a real content stream frequently is.
    const lines = buildPageLines([
      item('second line', 60, 680),
      item('first line', 60, 700),
    ]);
    expect(lines.map((line) => line.text)).toEqual(['first line', 'second line']);
  });

  it('keeps a superscript on the same line as its baseline text', () => {
    const lines = buildPageLines([
      item('Area', 60, 700, { size: 10, width: 22 }),
      item('2', 83, 704, { size: 6, width: 3 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('Area2');
  });

  it('does not merge two genuinely separate lines', () => {
    const lines = buildPageLines([
      item('line one', 60, 700, { size: 10 }),
      item('line two', 60, 684, { size: 10 }),
    ]);
    expect(lines).toHaveLength(2);
  });

  it('keeps rotated text out of the body flow', () => {
    const lines = buildPageLines([
      item('body text here', 60, 700),
      item('CONFIDENTIAL', 30, 400, { rotation: 90 }),
    ]);
    expect(lines[0]!.text).toBe('body text here');
    expect(lines[0]!.rotation).toBe(0);
    expect(lines[lines.length - 1]!.text).toBe('CONFIDENTIAL');
    expect(lines[lines.length - 1]!.rotation).toBe(90);
  });

  it('drops whitespace-only runs without losing the gap they implied', () => {
    const lines = buildPageLines([
      item('Total', 60, 700, { size: 10, width: 25 }),
      { str: ' ', transform: [10, 0, 0, 10, 85, 700], width: 3 },
      item('$1,200', 300, 700, { size: 10, width: 30 }),
    ]);
    expect(lines[0]!.text).toBe('Total  $1,200');
  });

  it('honours a custom column separator', () => {
    const lines = buildPageLines(
      [item('Label', 60, 700, { size: 10, width: 25 }), item('Value', 300, 700, { size: 10, width: 25 })],
      { columnSeparator: '\t' },
    );
    expect(lines[0]!.text).toBe('Label\tValue');
  });
});

describe('renderPageText', () => {
  it('emits one line per geometric line, top to bottom', () => {
    const text = renderPageText([
      item('Investment Summary', 60, 720, { size: 14 }),
      item('Purchase price', 60, 700, { size: 10, width: 60 }),
      item('$1,250,000', 300, 700, { size: 10, width: 50 }),
      item('Weekly rent', 60, 686, { size: 10, width: 50 }),
      item('$780', 300, 686, { size: 10, width: 25 }),
    ]);
    expect(text).toBe(
      'Investment Summary\nPurchase price  $1,250,000\nWeekly rent  $780',
    );
  });

  it('marks a paragraph break with a blank line', () => {
    const text = renderPageText([
      item('Heading', 60, 720, { size: 10 }),
      item('body line', 60, 660, { size: 10 }),
    ]);
    expect(text).toBe('Heading\n\nbody line');
  });

  it('can suppress paragraph markers', () => {
    const text = renderPageText(
      [item('Heading', 60, 720, { size: 10 }), item('body line', 60, 660, { size: 10 })],
      { paragraphGapEm: 0 },
    );
    expect(text).toBe('Heading\nbody line');
  });

  it('returns an empty string for a page with no text layer', () => {
    expect(renderPageText([])).toBe('');
  });
});
