/**
 * Which heading level a contents list names.
 *
 * Found 18 September 2026 by reading produced documents. Three narrative
 * shapes appear across the seven retained production fixtures, and two of them
 * put title matter at the shallowest level — a Financial Analysis wrapping
 * everything in one `h1`, and an Investment Report opening with
 * `# NAIDU PROPERTY CONSULTING SERVICES` and `# Investment Report: <address>`.
 * Listing the shallowest level gave those documents one and two contents rows
 * for nineteen and thirty-six pages.
 */
import { describe, expect, it } from 'vitest';

import { listedSectionLevel, type NarrativeIndexSection } from '../narrativeIndex';

const s = (level: number, pageIndex: number, label = `L${level}p${pageIndex}`): NarrativeIndexSection =>
  ({ label, level, pageIndex, anchor: label });

describe('listedSectionLevel — a level is a tier only if it opens more than one page', () => {
  it('skips the masthead shape: two h1s on one page over eleven h2s', () => {
    // The measured Investment Report: the issuer's name and the document
    // title, both at the top of the body, then the real sections.
    const sections = [
      s(1, 3, 'NAIDU PROPERTY CONSULTING SERVICES'),
      s(1, 3, 'Investment Report: 48 Redfern Street, Cowra NSW 2794'),
      ...Array.from({ length: 11 }, (_, i) => s(2, 4 + i)),
      ...Array.from({ length: 31 }, (_, i) => s(3, 4 + (i % 11))),
    ];
    expect(listedSectionLevel(sections)).toBe(2);
  });

  it('skips a lone title: one h1 over six h2 sections', () => {
    // The measured Financial Analysis.
    const sections = [
      s(1, 3, 'Client Investment Feasibility & Financial Performance Report'),
      ...Array.from({ length: 6 }, (_, i) => s(2, 3 + i)),
      ...Array.from({ length: 14 }, (_, i) => s(3, 3 + (i % 6))),
    ];
    expect(listedSectionLevel(sections)).toBe(2);
  });

  it('leaves the Compass shape exactly where it was — 18 h2 over 26 h3', () => {
    const sections = [
      ...Array.from({ length: 18 }, (_, i) => s(2, 4 + i)),
      ...Array.from({ length: 26 }, (_, i) => s(3, 4 + (i % 18))),
    ];
    expect(listedSectionLevel(sections)).toBe(2);
  });

  it('descends more than one level where each shallower tier opens one page', () => {
    const sections = [s(1, 0), s(2, 0), s(3, 0), s(3, 1), s(3, 2)];
    expect(listedSectionLevel(sections)).toBe(3);
  });

  it('stands at the shallowest where NO level opens two pages', () => {
    // A document that never turns a page has one entry, and that is correct.
    expect(listedSectionLevel([s(2, 0)])).toBe(2);
    expect(listedSectionLevel([s(1, 0), s(2, 0), s(2, 0)])).toBe(1);
  });

  it('counts DISTINCT pages, not sections — five headings on one page is not a tier', () => {
    const sections = [
      ...Array.from({ length: 5 }, (_, i) => s(1, 2, `masthead-${i}`)),
      s(2, 3), s(2, 6),
    ];
    expect(listedSectionLevel(sections)).toBe(2);
  });

  it('answers 0 for an empty index, so a caller need not branch', () => {
    expect(listedSectionLevel([])).toBe(0);
  });

  it('reads levels by their pages, not by document order', () => {
    const sections = [s(3, 7), s(3, 9), s(1, 2), s(3, 11)];
    expect(listedSectionLevel(sections)).toBe(3);
  });
});
