/**
 * The running head says which chapter a page is in — on every master.
 *
 * ## Twenty-nine pages that said the same thing
 *
 * v15 made the running head name the chapter rather than the part. It reached
 * eleven of the fifty masters. `furniture()` branches on `navigation_style`:
 * a RAILED family draws the part as an eyebrow and the section beneath it, and
 * a RUNNING-HEAD family draws the part and **discards the section argument
 * entirely**. So the chapter binding was composed, published and passed in on
 * all fifty, and drawn on eleven.
 *
 * On the 42 Patya Circuit Compass of 19 September 2026, 29 of 36 pages carried
 * the identical head `Part 05 · Report`. The body IS one part — that is right,
 * and renumbering it would be wrong — but a reader thirty pages in has no way
 * to tell the zoning chapter from the transport one.
 *
 * ## And then twenty-six pages that said the same thing
 *
 * v16 fixed the discarded half and left the repeated one. It passed
 * `Part NN · {{narrative.chapters.i}}`, so the 97 Poole Road Compass of
 * 20 Sep 2026 carried `Part 07 · <chapter>` on twenty-six consecutive pages:
 * true — the body is one part — and saying nothing twenty-six times over.
 *
 * A running head exists to say where the reader is. Across a single part the
 * part number does not; the chapter does. The part structure is on the
 * contents page, which is where it varies. So the marker is the chapter alone.
 *
 * The ten characters that buys are not a line — the marker sits in 34% of the
 * measure, about 43 characters, against `CHAPTER_MAX_CHARS` of 64, so the
 * worst case still takes both lines the rule reserves. What they buy is
 * measured below on the twelve chapters that report actually produced: three
 * wrapped with the prefix, one wraps without it.
 *
 * ## What deliberately did not change
 *
 * `furniture()`'s optional `headMarker` is read by the running-head branch
 * alone. The RAILED branch is untouched and stays right: there the part is an
 * eyebrow ABOVE the chapter rather than a prefix beside it, so the repetition
 * is subordinate by construction and carries the orientation for free. The
 * other nine formats and the Compass's own non-report pages pass nothing and
 * are byte-identical, which is what keeps a 450-master blast radius off a
 * 50-master fix.
 */
import { describe, expect, it } from 'vitest';
import {
  INVESTMENT_COMPASS_TEMPLATES,
} from '../../../../scripts/template-library/investmentCompass/templates';
import {
  MONO_ADVANCE,
} from '../../../../scripts/template-library/investmentCompass/blocks';
import {
  CHAPTER_MAX_CHARS,
} from '../../../../supabase/functions/_shared/reports/runningChapters.pure';

interface Marker { template: string; size: number; width: number; body: string }

/** The report pages of every master, split by which furniture they drew. */
function reportFurniture() {
  const railed: string[] = [];
  const markers: Marker[] = [];
  for (const t of INVESTMENT_COMPASS_TEMPLATES as Record<string, any>[]) {
    const schema = t.schema ?? t.page_schema ?? t;
    const name = String(t.name ?? t.key);
    for (const page of (schema.pages ?? []) as Record<string, any>[]) {
      // The first body page. The continuation pages repeat its furniture.
      if (page.name !== 'The report') continue;
      for (const b of (page.blocks ?? []) as Record<string, any>[]) {
        if (b.name === 'Rail marker') railed.push(name);
        if (b.name === 'Part marker') {
          markers.push({ template: name, size: b.props.bodySize, width: b.props.width, body: String(b.props.body) });
        }
      }
    }
  }
  return { railed, markers };
}

const { railed, markers } = reportFurniture();

/** The one line-count for the marker, mirroring `runningHeadMarkerLines`. */
const markerLines = (chars: number, m: Marker) =>
  Math.max(1, Math.ceil(chars / Math.max(1, Math.floor(m.width / (m.size * MONO_ADVANCE)))));

describe('every master tells the reader which chapter they are in', () => {
  it('covers all fifty, by one route or the other', () => {
    expect(railed.length + markers.length).toBe(50);
    // Both routes exist — if either count went to zero the assertions about it
    // below would be vacuous.
    expect(railed.length).toBeGreaterThan(0);
    expect(markers.length).toBeGreaterThan(0);
  });

  it('names the chapter on every running-head master', () => {
    const silent = markers.filter((m) => !m.body.includes('narrative.chapters'));
    expect(
      silent.map((m) => `${m.template}: ${m.body}`),
      'running-head masters whose report pages still draw only the part',
    ).toEqual([]);
  });

  /*
   * v16 fixed the discarded half of this and left the repeated one. The
   * Compass body is ONE part, so prefixing the chapter with it printed
   * `Part 07 · <chapter>` on twenty-six consecutive pages of the 97 Poole
   * Road report — true, and saying nothing twenty-six times.
   *
   * A running head exists to say where the reader is. The part structure is
   * on the contents page, where it is what varies.
   */
  it('names the chapter and does not repeat the part beside it', () => {
    const prefixed = markers.filter((m) => /Part \d\d · /.test(m.body));
    expect(
      prefixed.map((m) => `${m.template}: ${m.body}`),
      'report-page markers still carrying the part the whole body shares',
    ).toEqual([]);
  });

  it('fits the longest chapter into the two lines the rule reserves', () => {
    // The longest heading `runningChapters` will pass through; anything longer
    // is already the document-name fallback, which is shorter.
    //
    // Two lines remains the allowance and the worst case still needs both:
    // the marker sits in 34% of the measure, which is about 43 characters a
    // line, and CHAPTER_MAX_CHARS is 64. Dropping the prefix buys ten
    // characters, not a line — see the header for what those ten bought on
    // the document that prompted it.
    const worst = CHAPTER_MAX_CHARS;
    expect(worst).toBe(64);
    const over = markers
      .filter((m) => markerLines(worst, m) > 2)
      .map((m) => `${m.template}: ${markerLines(worst, m)} lines at ${m.size}pt in ${m.width}pt`);
    expect(over, 'markers that would strike the rule beneath them').toEqual([]);
  });

  /*
   * What the ten characters bought, measured on the chapters the 97 Poole Road
   * Compass actually produced rather than on the theoretical worst case.
   */
  it('halves the chapters that wrap, on the twelve that report produced', () => {
    const chapters = [
      'Demand Drivers', 'Amenity & Access', 'Transport & Connectivity',
      'Zoning, Planning and Development Considerations',
      'Environment, Climate & Safety', 'Market Positioning',
      'Property Fit Within the Suburb', 'Risk Dashboard',
      'Due Diligence Checklist', 'Final Recommendation',
      'Appendix · Source Notes & Disclaimer',
      'Planning controls and development registers',
    ];
    // The narrowest master is the binding case: if it fits there it fits.
    const narrowest = markers.reduce((a, b) => (
      markerLines(64, a) >= markerLines(64, b) ? a : b));
    const wraps = (map: (len: number) => number) => chapters.filter((c) => markerLines(map(c.length), narrowest) > 1).length;
    expect(wraps((n) => n + 'Part 07 · '.length), 'wrapped with the part prefix').toBe(3);
    expect(wraps((n) => n), 'wrap without it').toBe(1);
  });
});
