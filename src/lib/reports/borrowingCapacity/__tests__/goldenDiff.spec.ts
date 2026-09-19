/**
 * The new document against the one that ships today.
 *
 * Phase 0 captured the shipping jsPDF generator against a fictional fixture and
 * wrote it to `reports/golden/`. This renders the *replacement* from the same
 * fixture and asserts the thing that actually matters about a migration: **the
 * new document says everything the old one said, and says it correctly.**
 *
 * Both halves are needed. "Nothing was dropped" without "and the figures are
 * right" passes for a document that reproduces the old one's defects; "the
 * figures are right" without "nothing was dropped" passes for a document that
 * lost its audit trail.
 *
 * The old side is the jsPDF byte stream, which for base-14 fonts carries its
 * text literally — which is why the Phase 0 capture could assert on it at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { withDecodedCharts } from '@/lib/reportDesign/__tests__/chartSvg';
import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { mastheadFor, resolveCompanyBlock } from '@/lib/reportDesign/companyBlock.pure';

import { buildSnapshot } from '../normalise.pure';
import { renderSnapshotBody } from '../render.pure';
import {
  SAMPLE_ASSESSMENT,
  SAMPLE_AUDIT_TRAIL,
  SAMPLE_CLIENT_NAME,
  SAMPLE_EXPLANATION,
  SAMPLE_GLOBAL_SETTINGS,
  SAMPLE_SCENARIO_PRESETS,
} from './fixtures/sampleAssessment';

const REPO = resolve(__dirname, '../../../../..');
const GOLDEN_PDF = resolve(REPO, 'reports/golden/borrowing-capacity-snapshot.pdf');

const contact = SAMPLE_GLOBAL_SETTINGS.contactDetails as never;

const payload = buildSnapshot({
  clientName: SAMPLE_CLIENT_NAME,
  assessment: SAMPLE_ASSESSMENT,
  auditTrail: SAMPLE_AUDIT_TRAIL,
  explanation: SAMPLE_EXPLANATION,
  scenarioPresets: SAMPLE_SCENARIO_PRESETS,
});

const html = renderSnapshotBody({
  payload,
  palette: resolveReportPalette({ preset: 'signature' }),
  company: resolveCompanyBlock(contact, SAMPLE_GLOBAL_SETTINGS.disclaimer as never),
  masthead: mastheadFor(contact),
});

/**
 * The golden is written by `snapshotGolden.spec.ts` into a gitignored
 * directory. When it is absent — a fresh clone that has not run that spec —
 * these tests are skipped rather than failed: a missing artefact is a missing
 * artefact, not a regression, and failing on it would train people to ignore
 * the suite.
 */
const haveGolden = existsSync(GOLDEN_PDF);
const withGolden = haveGolden ? describe : describe.skip;

let golden = '';
beforeAll(() => {
  if (haveGolden) golden = readFileSync(GOLDEN_PDF).toString('latin1');
});

describe('every section survived the migration', () => {
  it.each([
    ['the executive summary', 'Based on the financial information provided'],
    ['the income breakdown', 'PAYG salary — applicant 1'],
    ['the shading rates', '80%'],
    ['the liabilities', 'Example Bank'],
    ['the capacity ledger', 'Maximum Borrowing Capacity'],
    ['the recommendations', 'Clear the credit card limit before application'],
    ['the warnings', 'DTI of 5.4 is above the 5.0 threshold'],
    ['the calculation explanation', 'Shade the income'],
    ['the audit trail', 'Rental income'],
    ['the scenario comparison', 'Rate rise 100bp'],
    ['the LMI position', '18,640'],
    ['the assumptions', 'Shading Policy'],
  ])('carries %s', (_label, needle) => {
    expect(html).toContain(needle);
  });

  it('carries every headline figure', () => {
    for (const figure of ['$785,000', '$712,000', '$1,840/mo', '5.4x', '8.65%', '$171,400']) {
      expect(html, `${figure} is missing`).toContain(figure);
    }
  });
});

withGolden('and against the captured golden', () => {
  /**
   * Whatever text the shipping PDF carries, the new document carries too.
   *
   * Section titles are the check rather than every string: the two documents
   * word their prose differently on purpose — the new one says "Income and
   * commitments" where the old says "Income Analysis" — but a *subject* that
   * appears in one and not the other is a dropped section.
   */
  it.each([
    ['income', ['Income Analysis'], 'Income and commitments'],
    ['expenses and liabilities', ['Expenses & Liabilities'], 'Existing liabilities'],
    ['the capacity breakdown', ['Capacity Breakdown'], 'How the capacity is built'],
    ['the calculation explanation', ['How This Was Calculated'], 'How this was calculated'],
    ['the audit trail', ['Audit Trail'], 'Audit trail'],
    ['the scenarios', ['Scenario Comparison'], 'Scenario comparison'],
  ])('covers %s', (_label, oldNeedles, newNeedle) => {
    for (const needle of oldNeedles) {
      expect(golden, `the golden no longer contains "${needle}" — has the fixture changed?`)
        .toContain(needle);
    }
    expect(html).toContain(newNeedle);
  });

  /**
   * The defects, gone. Each of these is present in the captured golden and
   * must not be present in the replacement — which is a stronger statement
   * than "the new one is fine", because it fails if the old capture stops
   * exhibiting them and the comparison quietly becomes vacuous.
   */
  /**
   * F2 was fixed on **both** sides, so it is no longer a difference.
   *
   * The shipping generator used to put 6.15% → 8.65% through its currency
   * formatter and print `$6 → $9, +$3`; the rate itself never appeared in its
   * bytes. That was fixed in the legacy generator too — `AuditTrailPanel` and
   * `BorrowingCapacityPDFReport` now go through `auditMeasures` and
   * `formatMeasure` — which is the right outcome, because a client holding the
   * legacy PDF should not be told a rate is seven dollars either.
   *
   * The assertion above it was `expect(golden).not.toContain('6.15%')`, written
   * to fail if the old capture stopped exhibiting the defect and the comparison
   * became vacuous. It did stop, the assertion did fail — and nobody saw it,
   * because `reports/` is gitignored and the CI step that *writes* the golden
   * ran after the one that reads it, so `existsSync` was false on every runner
   * and this whole block was `describe.skip`. The guard worked; the gate was
   * not running.
   */
  it('prints a rate as a rate, on both documents (F2)', () => {
    expect(golden).toContain('Interest Rate Override');
    expect(golden).toContain('6.15%');
    expect(html).toContain('Interest Rate Override');
    expect(html).toContain('6.15%');
    expect(html).toContain('8.65%');
  });

  it('drops our brand from a tenant\'s document (F1)', () => {
    // The golden's cover is the NPC raster; its bytes carry the file's name.
    expect(html).not.toContain('Naidu');
    expect(html).not.toContain('YOUR DEDICATED PROPERTY PARTNER');
  });

  /**
   * The golden's fonts are the base 14, unembedded — `BaseFont /Helvetica`
   * straight in the byte stream. The replacement asks for a brand face first
   * everywhere; Helvetica survives only where it belongs, as a fallback behind
   * Inter in a font stack.
   */
  it('asks for a brand face first, everywhere (F8)', () => {
    expect(golden).toContain('/Helvetica');

    // Decoded: a chart's drawing is base64 inside an `img`, so the sweep has to
    // reach through the payload or it finds no stacks and passes vacuously —
    // which the message below was written for and which is what happened.
    const stacks = [...withDecodedCharts(html).matchAll(/font-family="([^"]+)"/g)].map((m) => m[1]);
    expect(stacks.length, 'no font stacks found — has the chart markup changed?')
      .toBeGreaterThan(0);
    for (const stack of stacks) {
      const first = stack.split(',')[0].replace(/['"]/g, '').trim();
      expect(['Cinzel', 'Playfair Display', 'Inter', 'IBM Plex Mono'], stack).toContain(first);
    }
  });

  it('drops the fixed column offsets that collided (F3)', () => {
    expect(html).not.toMatch(/BalanceMonthly/);
    expect(html).not.toMatch(/STRONG\+\$/);
  });
});

describe('what the new document adds', () => {
  /** Two pictures the tables cannot draw, and one comparison spread over two pages. */
  it.each([
    ['a utilisation bullet', 'Proposed loan against the assessed limit'],
    ['an income composition', 'Assessed income by component'],
    ['a headroom comparison', 'Capacity and headroom'],
  ])('adds %s', (_label, caption) => {
    expect(html).toContain(caption);
  });

  it('says which way each audit adjustment moves capacity, in words (F6)', () => {
    expect(html).toContain('Reduces');
    expect(html).toContain('can be an increase and still reduce what can be borrowed');
  });

  it('shows income the lender counts none of as 0%, not 100% (F10)', () => {
    expect(html).toContain('Unbanked cash income');
    expect(html).toMatch(/>0%</);
  });
});
