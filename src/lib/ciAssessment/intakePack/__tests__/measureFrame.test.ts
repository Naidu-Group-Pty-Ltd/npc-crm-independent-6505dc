/**
 * Sizing the viewer's frame.
 *
 * The bug this module exists to kill: the frame was sized by arithmetic —
 * summing the column widths and row heights stored in the .xlsx — and every
 * sheet in the pack came out between 53px and 362px short, because a browser
 * wraps a long answer across two lines where Excel used one. The shortfall was
 * clipped, and no amount of adjusting the arithmetic could fix it.
 *
 * jsdom has no layout engine, so what is covered here is the contract around
 * the measurement rather than the measurement itself: it must never return
 * something smaller than the estimate, never reject, and never hang. The
 * measurement proper is verified in Chromium — see the PR.
 */

import { describe, expect, it } from 'vitest';
import { measureDocument, measureDocuments } from '../viewer/measureFrame';

const HTML = '<!doctype html><html><body><div class="sheet"><table><tr><td>x</td></tr></table></div></body></html>';

describe('measureDocument', () => {
  it('falls back to the estimate where there is no layout to read', async () => {
    // jsdom lays nothing out, so every rect is zero. Sizing the frame to zero
    // would hide the document completely — the estimate is the safe answer.
    const result = await measureDocument({
      html: HTML,
      selector: 'table',
      fallback: { width: 900, height: 700 },
    });

    expect(result.measured).toBe(false);
    expect(result.width).toBe(900);
    expect(result.height).toBe(700);
  });

  it('falls back when the thing it was asked to measure is not there', async () => {
    const result = await measureDocument({
      html: '<!doctype html><html><body><p>no table</p></body></html>',
      selector: 'table',
      fallback: { width: 120, height: 80 },
    });

    expect(result.measured).toBe(false);
    expect(result.width).toBe(120);
    expect(result.height).toBe(80);
  });

  it('resolves rather than rejecting on malformed input', async () => {
    // A viewer that showed an approximately sized document beats one that
    // showed an error because it could not measure it.
    await expect(measureDocument({
      html: '<<<not html',
      selector: 'table',
      fallback: { width: 10, height: 10 },
    })).resolves.toMatchObject({ width: 10, height: 10 });
  });

  it('leaves nothing behind in the document', async () => {
    const before = document.querySelectorAll('iframe').length;
    await measureDocument({
      html: HTML, selector: 'table', fallback: { width: 10, height: 10 },
    });
    expect(document.querySelectorAll('iframe')).toHaveLength(before);
  });

  it('measures a batch in order', async () => {
    const results = await measureDocuments([
      { html: HTML, selector: 'table', fallback: { width: 1, height: 2 } },
      { html: HTML, selector: 'table', fallback: { width: 3, height: 4 } },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ width: 1, height: 2 });
    expect(results[1]).toMatchObject({ width: 3, height: 4 });
  });
});
