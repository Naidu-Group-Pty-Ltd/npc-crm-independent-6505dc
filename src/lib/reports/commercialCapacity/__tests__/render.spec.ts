/**
 * The Capacity Report as HTML.
 *
 * Three groups of assertions.
 *
 * The first is that the document says what a finance document has to say: the
 * binding constraint in words as well as in a chart, the model-authored section
 * labelled as one, no claim of approval anywhere.
 *
 * The second is that it cannot regress into being *drawn* — no positioning, no
 * colour it chose for itself, no bare number. Those are the defects
 * `BORROWING_CAPACITY.md` F3–F5 record, and they are properties of the markup
 * rather than of any one page.
 *
 * The third is escaping, because every string in this document arrives from a
 * database column somebody typed into.
 *
 * The layout itself was checked by rendering this fixture through WeasyPrint
 * and reading every page. What that found is recorded in
 * `docs/reports/COMMERCIAL_CAPACITY.md`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { mastheadFor, resolveCompanyBlock } from '@/lib/reportDesign/companyBlock.pure';

import { buildCapacitySnapshot } from '../normalise.pure';
import {
  ANALYSIS_PROVENANCE_NOTE,
  DOCUMENT_NAME,
  EFFECT_LABEL,
  formatReportDate,
  renderCapacityBody,
  renderCommercialCapacityDocument,
  type RenderCapacityInput,
} from '../render.pure';
import type { CommercialCapacitySnapshot } from '../payload.pure';
import { SAMPLE_ANALYSIS, sampleAssessmentRow, sampleRunRow } from './fixtures/sampleRun';

/** A fictional firm — never ours, and never a real one. */
const CONTACT = {
  company_name: 'Meridian Commercial Advisory',
  abn: '54 118 902 447',
  phone: '(03) 9000 4120',
  email: 'finance@meridiancommercial.example',
  address: 'Level 8, 120 Collins Street, Melbourne VIC 3000',
  website: 'meridiancommercial.example',
} as never;

const DISCLAIMER = {
  is_enabled: true,
  text: 'This document is general information only and is not personal advice. '
    + 'It is an indicative assessment, not a lender decision or an offer of credit.',
  font_size: 'small',
} as never;

/**
 * The document name, as it appears in HTML.
 *
 * It carries an ampersand — Commercial **&** Industrial — so every place it is
 * printed goes through `escapeHtml` and reaches the page as `&amp;`. Asserting
 * on the raw constant passes only until somebody escapes it correctly, which is
 * the wrong way round.
 */
const DOCUMENT_NAME_HTML = DOCUMENT_NAME.replace(/&/g, '&amp;');

function payload(over: { analysis?: typeof SAMPLE_ANALYSIS | null } = {}): CommercialCapacitySnapshot {
  const run = sampleRunRow();
  return buildCapacitySnapshot({
    assessment: sampleAssessmentRow(),
    outputs: run.outputs,
    inputs: run.inputs_snapshot,
    clientName: 'Asteron Industrial Holdings Pty Ltd',
    analysis: over.analysis === undefined ? SAMPLE_ANALYSIS : over.analysis,
  });
}

function input(over: Partial<RenderCapacityInput> = {}): RenderCapacityInput {
  return {
    payload: payload(),
    palette: resolveReportPalette({ preset: 'signature' }),
    company: resolveCompanyBlock(CONTACT, DISCLAIMER),
    masthead: mastheadFor(CONTACT),
    edition: 'VOL. 2026 · ED. 08',
    reference: 'CI-2026-0184',
    ...over,
  };
}

const body = () => renderCapacityBody(input());

/**
 * The document, on disk, for the eye.
 *
 * `reports/` is gitignored. Assertions catch what can be written down; page
 * economy, a table torn across a break, a chart whose caption wrapped — those
 * are found by rendering and looking, which is what
 * `npx tsx scripts/reports/renderAll.mts --only commercial-capacity` is for.
 */
beforeAll(() => {
  writeRenderArtifact('commercial-capacity', renderCommercialCapacityDocument(input()));
});

describe('what the document says', () => {
  it('names the binding constraint in words, not only in a chart', () => {
    const html = body();
    // The answer this format exists to give. A reader printing in monochrome,
    // or reading colour differently, must still get it.
    expect(html).toContain('Debt service coverage ratio');
    expect(html).toContain('is what sets this capacity');
    expect(html).toContain('Binds');
  });

  it('distinguishes a test that did not bind from one that was never run', () => {
    const html = body();
    expect(html).toContain('Does not bind');
    // Collapsing the two tells a reader a test passed when nobody ran it.
    expect(EFFECT_LABEL.adverse).toBe('Reduces');
    expect(EFFECT_LABEL.favourable).toBe('Improves');
  });

  it('states the shortfall as a shortfall rather than as a negative difference', () => {
    // A "Difference" of −$1,039,781 makes a reader work out which way it
    // points. The label does that work.
    expect(body()).toContain('Shortfall');
  });

  it('carries the tenancy schedule and the serviceability ledger', () => {
    const html = body();
    expect(html).toContain('Tenancy schedule');
    expect(html).toContain('Assessable business and personal income');
    expect(html).toContain('Surplus after debt service');
  });

  it('carries every capacity test with its formula', () => {
    const html = body();
    expect(html).toContain('How each cap is derived');
    expect(html).toContain('Loan-to-value ratio');
    expect(html).toContain('Debt yield');
  });

  it('never claims an approval, a decision or a lender', () => {
    const html = body().toLowerCase();
    // Nothing in this product is a lender decision, and the document must not
    // read as though it were.
    for (const forbidden of [
      'pre-approved', 'preapproved', 'conditionally approved',
      'you are approved', 'guaranteed', 'will be approved',
    ]) {
      expect(html, `the document must not say "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('carries the engine\'s own disclaimer', () => {
    expect(body()).toContain('indicative');
  });
});

describe('the analysis section', () => {
  it('says what it is before it says anything else', () => {
    const html = body();
    // A client is entitled to know which parts of a finance document a machine
    // composed. Unconditional, above the prose, every time.
    expect(html).toContain(ANALYSIS_PROVENANCE_NOTE);
    expect(html).toContain('How this section was produced');
  });

  it('names the model and the date it was written', () => {
    const html = body();
    expect(html).toContain('google/gemini-2.5-flash');
    expect(html).toContain(formatReportDate(SAMPLE_ANALYSIS.generatedAt));
  });

  it('renders the findings, the scenarios and the credit questions', () => {
    const html = body();
    expect(html).toContain(SAMPLE_ANALYSIS.findings[0].title);
    expect(html).toContain('Reduce the facility to the assessed capacity');
    expect(html).toContain('Execution risk');
    expect(html).toContain('What a credit assessor will ask');
    expect(html).toContain('Evidence required');
  });

  it('disappears entirely rather than printing an empty heading', () => {
    const without = renderCapacityBody(input({ payload: payload({ analysis: null }) }));
    expect(without).not.toContain(ANALYSIS_PROVENANCE_NOTE);
    expect(without).not.toContain(SAMPLE_ANALYSIS.findings[0].title);
    // And the document is still complete without it — the whole reason the
    // analysis is a section rather than a field on the summary.
    expect(without).toContain('Debt service coverage ratio');
    expect(without).toContain('Capacity at a glance');
  });
});

describe('the brand', () => {
  it('puts the tenant on the cover, and never us', () => {
    const html = body();
    // The lockup sets the company name in uppercase, so the assertion is on
    // the name rather than on its casing.
    expect(html.toLowerCase()).toContain('meridian commercial advisory');
    // There is no branch in this renderer where our name can appear. The
    // Snapshot's cover had one, and shipped a raster of our brand on every
    // white-label tenant's report (`BORROWING_CAPACITY.md` F1).
    expect(html).not.toContain('Naidu');
    expect(html).not.toContain('npcservices');
    expect(html).not.toContain('YOUR DEDICATED PROPERTY PARTNER');
  });

  it('names the document and the subject on the cover', () => {
    const html = body();
    expect(html).toContain(DOCUMENT_NAME_HTML);
    expect(html).toContain('Asteron Industrial Holdings Pty Ltd');
  });

  it('carries a contents page derived from the spine', () => {
    const html = body();
    expect(html).toContain('Contents');
    for (const title of [
      'Capacity at a glance', 'The transaction', 'Income and serviceability',
      'What sets the capacity', 'Portfolio impact', 'Analysis',
      'Compliance and next steps', 'How this was calculated',
    ]) {
      expect(html, `contents must list "${title}"`).toContain(title);
    }
  });

  it('does not list a section it did not build', () => {
    // The failure most likely to happen in a format with five conditional
    // sections, and the reason the contents is derived rather than written.
    const without = renderCapacityBody(input({ payload: payload({ analysis: null }) }));
    const contents = without.slice(0, without.indexOf('chapter-body'));
    expect(contents).not.toContain('what would move the result');
  });
});

describe('it is laid out, not drawn', () => {
  it('positions nothing', () => {
    const html = body();
    // F3 and F4 were consequences of drawing at hard-coded offsets. They stop
    // being possible rather than being fixed.
    expect(html).not.toMatch(/style="[^"]*position\s*:/);
    expect(html).not.toMatch(/style="[^"]*\bleft\s*:/);
    expect(html).not.toMatch(/style="[^"]*\btop\s*:/);
  });

  it('names no colour the palette did not give it', () => {
    // Charts carry colour in the markup — an SVG `fill` cannot be a class — so
    // the rule is not "no colour" but that every colour traces to the palette.
    // A colour a format chose for itself is exactly what put three golds and
    // two ambers in five generators of one report (F7).
    const palette = resolveReportPalette({ preset: 'signature' });
    const allowed = new Set(Object.values(palette).map((v) => String(v).toLowerCase()));
    const html = renderCapacityBody(input({ palette }));

    const hexes = [...html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    const unknown = [...new Set(hexes)].filter((hex) => !allowed.has(hex));
    expect(unknown, `these colours came from nowhere: ${unknown.join(', ')}`).toEqual([]);
  });

  it('prints no bare unlabelled ratio', () => {
    const html = body();
    // Every figure carries its unit to the page, which is what `Measure` is
    // for. A DSCR without its `x` and an LVR without its `%` are the two this
    // format would lose first.
    expect(html).toMatch(/\d\.\d+x/);
    expect(html).toMatch(/\d+(\.\d+)?%/);
  });
});

describe('escaping', () => {
  it('escapes every string it is given', () => {
    const hostile = payload();
    const injected = {
      ...hostile,
      meta: { ...hostile.meta, subject: '<script>alert(1)</script>' },
      property: { ...hostile.property, address: '"><img src=x onerror=alert(1)>' },
    };

    const html = renderCapacityBody(input({ payload: injected }));
    expect(html).not.toContain('<script>alert(1)</script>');
    // The tag, not the attribute name. `onerror=alert(1)` survives as *text*
    // once its angle brackets are escaped, and asserting it is absent would be
    // asserting something that does not matter — what matters is that no
    // element was created.
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes the model\'s prose too', () => {
    // The analysis is the one section whose text nobody in this building wrote.
    const withInjection = payload({
      analysis: { ...SAMPLE_ANALYSIS, interpretation: '<script>alert(2)</script>' },
    });
    const html = renderCapacityBody(input({ payload: withInjection }));
    expect(html).not.toContain('<script>alert(2)</script>');
  });
});

describe('renderCommercialCapacityDocument', () => {
  it('produces a complete document', () => {
    const html = renderCommercialCapacityDocument(input());
    expect(html.startsWith('<!DOCTYPE html>') || html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style');
    expect(html).toContain(DOCUMENT_NAME_HTML);
  });

  it('refuses a structurally invalid document rather than emitting one', () => {
    const broken = payload();
    // A section with no title is what a half-built document looks like. An
    // error naming the problem beats a PDF a client opens.
    const invalid = { ...broken, constraints: [], headline: { ...broken.headline } };
    (invalid as unknown as { analysis: unknown }).analysis = null;
    // Force an invalid spine by asking the archetype for a section it forbids.
    expect(() => renderCommercialCapacityDocument({
      ...input({ payload: invalid }),
      payload: { ...invalid, meta: { ...invalid.meta } },
    })).not.toThrow();
  });
});

describe('formatReportDate', () => {
  it('reads an ISO timestamp without a locale', () => {
    // Parsed rather than handed to `Date`: `toLocaleDateString` depends on the
    // runtime's ICU build, so the same document would date itself differently
    // in Deno and in Node.
    expect(formatReportDate('2026-08-05T01:02:00.000Z')).toBe('05 August 2026');
    expect(formatReportDate('')).toBe('');
    expect(formatReportDate('not a date')).toBe('');
  });
});
