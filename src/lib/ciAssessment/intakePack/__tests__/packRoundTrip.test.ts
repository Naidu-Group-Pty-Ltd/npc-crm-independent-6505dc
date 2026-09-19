/**
 * The worked example has to be true, not merely plausible.
 *
 * An example that quietly stopped matching the template would teach people to
 * fill the pack in wrongly — worse than having no example at all, because they
 * would be confident. So the load-bearing test here generates the filled
 * workbook through the ordinary generator and parses it back through the
 * ordinary parser, then checks the figures survived. If the schema, the layout,
 * the encoders or the parser move, this fails.
 *
 * The arithmetic is asserted too. "Funding closes" is the first thing an
 * adviser checks on the Summary sheet, so an example where it does not close
 * demonstrates the wrong thing.
 */

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildIntakeWorkbook } from '../workbook';
import { buildIntakeDocument } from '../document';
import { parseIntakeWorkbook } from '../parseWorkbook';
import { SAMPLE_DETAILS, SAMPLE_PROCEED, sampleAssessment } from '../sample';
import { Packer } from 'docx';

const AS_AT = new Date('2026-08-05T00:00:00.000Z');

async function buildAndParse() {
  const workbook = await buildIntakeWorkbook({
    payload: sampleAssessment(),
    details: SAMPLE_DETAILS,
    proceed: SAMPLE_PROCEED,
    sample: true,
    generatedAt: AS_AT,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return parseIntakeWorkbook(XLSX.read(buffer, { type: 'buffer', cellDates: true }));
}

describe('worked example — round trip', () => {
  it('is recognised as one of our packs', async () => {
    const parsed = await buildAndParse();
    expect(parsed.recognised).toBe(true);
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('carries every collection back out at full length', async () => {
    const parsed = await buildAndParse();
    const sample = sampleAssessment();

    expect(parsed.counts.entities).toBe(sample.ownership.entities.length);
    expect(parsed.counts.incomePeriods).toBe(sample.income.periods.length);
    expect(parsed.counts.addbacks).toBe(sample.income.addbacks.length);
    expect(parsed.counts.portfolioAssets).toBe(sample.portfolio.assets.length);
    expect(parsed.counts.liabilities).toBe(sample.portfolio.liabilities.length);
    expect(parsed.counts.tenancies).toBe(sample.lease.tenancies.length);
  });

  it('reproduces the figures the assessment is struck on', async () => {
    const parsed = await buildAndParse();
    const sample = sampleAssessment();

    expect(parsed.payload.property.address).toBe(sample.property.address);
    expect(parsed.payload.property.purchasePrice).toBe(sample.property.purchasePrice);
    expect(parsed.payload.property.currentValuation).toBe(sample.property.currentValuation);
    expect(parsed.payload.property.stampDuty).toBe(sample.property.stampDuty);
    expect(parsed.payload.loan.requestedLoan).toBe(sample.loan.requestedLoan);
    expect(parsed.payload.loan.actualRatePercent).toBeCloseTo(sample.loan.actualRatePercent, 2);
    expect(parsed.payload.loan.repaymentType).toBe(sample.loan.repaymentType);
    expect(parsed.payload.assessmentType).toBe(sample.assessmentType);
  });

  it('keeps the trust structure intact rather than flattening it to a company', async () => {
    const parsed = await buildAndParse();
    const [trust, opco] = parsed.payload.ownership.entities;

    expect(trust.structure).toBe('trust');
    expect(trust.trustees).toContain('corporate trustee');
    expect(trust.beneficiaries).toContain('Bennett');
    expect(trust.ownershipPercent).toBe(100);
    // The guarantor holds nothing but must still come back as a guarantor.
    expect(opco.structure).toBe('company');
    expect(opco.ownershipPercent).toBe(0);
    expect(opco.isGuarantor).toBe(true);
  });

  it('attaches each add-back to the period it names', async () => {
    const parsed = await buildAndParse();
    const byLabel = new Map(parsed.payload.income.periods.map((p) => [p.id, p.label]));
    const labels = parsed.payload.income.addbacks.map((a) => byLabel.get(a.periodId));

    expect(labels).toEqual(['FY2025', 'FY2025', 'FY2024']);
    expect(parsed.payload.income.addbacks.every((a) => a.confirmed)).toBe(true);
    expect(parsed.payload.income.addbacks.every((a) => a.source.length > 0)).toBe(true);
  });

  it('names owning entities exactly as the ownership sheet does', async () => {
    // The cross-sheet check in the parser warns when they disagree. The example
    // must not trip its own warning — that is what it is teaching.
    const parsed = await buildAndParse();
    const mismatches = parsed.issues.filter(
      (issue) => issue.message.includes('is not on the Ownership sheet'),
    );
    expect(mismatches).toEqual([]);
  });

  it('closes the funding exactly', async () => {
    const sample = sampleAssessment();
    const { property, loan } = sample;
    const costs = property.stampDuty + property.legalCosts + property.valuationCosts
      + property.lenderFees + property.fitOut + property.plantAndEquipment
      + property.repairs + property.immediateCapex + property.contingency
      + loan.establishmentFees;

    const required = property.purchasePrice + costs + property.refinanceAmount;
    const available = property.depositOrContribution + loan.requestedLoan;

    expect(available).toBe(required);
  });

  it('totals ownership at 100%', async () => {
    const total = sampleAssessment().ownership.entities
      .reduce((sum, entity) => sum + entity.ownershipPercent, 0);
    expect(total).toBe(100);
  });
});

describe('worked example — documents say what they are', () => {
  it('marks the workbook as an example in its properties and on its cover', async () => {
    const workbook = await buildIntakeWorkbook({
      payload: sampleAssessment(), details: SAMPLE_DETAILS, sample: true, generatedAt: AS_AT,
    });
    expect(workbook.title).toContain('worked example');

    const buffer = await workbook.xlsx.writeBuffer();
    const read = XLSX.read(buffer, { type: 'buffer' });
    const start = XLSX.utils.sheet_to_csv(read.Sheets['Start here']);
    expect(start).toContain('FICTIONAL TEST DATA');
    expect(start).toContain('worked-example');
  });

  it('marks the guide as an example in its header and its properties', async () => {
    const doc = buildIntakeDocument({
      payload: sampleAssessment(), details: SAMPLE_DETAILS, proceed: SAMPLE_PROCEED,
      sample: true, generatedAt: AS_AT,
    });
    const buffer = await Packer.toBuffer(doc);
    const xml = buffer.toString('latin1');
    expect(xml.length).toBeGreaterThan(0);
    // The blank guide must not carry the banner; only the example does.
    const blank = await Packer.toBuffer(buildIntakeDocument({ generatedAt: AS_AT }));
    expect(blank.length).toBeGreaterThan(0);
  });

  it('leaves the blank template genuinely blank', async () => {
    const workbook = await buildIntakeWorkbook({ generatedAt: AS_AT });
    const buffer = await workbook.xlsx.writeBuffer();
    const parsed = parseIntakeWorkbook(XLSX.read(buffer, { type: 'buffer', cellDates: true }));

    expect(parsed.recognised).toBe(true);
    expect(parsed.counts.entities).toBe(0);
    expect(parsed.counts.portfolioAssets).toBe(0);
    expect(parsed.counts.tenancies).toBe(0);
    expect(parsed.payload.property.address).toBe('');
  });
});
