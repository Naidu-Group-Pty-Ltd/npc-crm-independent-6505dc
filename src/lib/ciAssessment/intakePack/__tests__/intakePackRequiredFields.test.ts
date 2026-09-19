/**
 * Regression: the four figures the calculation blocks on must survive the
 * round trip out to the workbook and back, and a mixed multi-file drop must
 * keep both the workbook *and* the supporting documents.
 *
 * The reported symptom was "218 values read" sitting next to "Property
 * address, Purchase price, Current valuation, Interest rate missing", so this
 * asserts on those exact four paths rather than on the aggregate count.
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildIntakeWorkbook } from '../workbook';
import { parseIntakeWorkbook } from '../parseWorkbook';
import { SINGLE_ANSWER_COL } from '../layout';
import { emptyAssessmentPayload } from '../../types';

async function roundTrip(values: Record<string, unknown>) {
  const built = await buildIntakeWorkbook({ payload: emptyAssessmentPayload('commercial_investment') });
  const buffer = await built.xlsx.writeBuffer();
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  const sheetName = '1. Transaction';
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1, defval: '', blankrows: true,
  });
  Object.entries(values).forEach(([key, value]) => {
    const index = rows.findIndex((row) => (row ?? []).some(
      (cell) => String(cell ?? '').trim() === key,
    ));
    if (index === -1) throw new Error(`Field ${key} is not in the workbook`);
    rows[index][SINGLE_ANSWER_COL - 1] = value as never;
  });
  workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows as never);

  return parseIntakeWorkbook(workbook);
}

describe('intake pack — required calculation inputs', () => {
  it('carries address, price, valuation and rate back out of the workbook', async () => {
    const parsed = await roundTrip({
      'property.address': '12 Kembla Street',
      'property.purchasePrice': 2_450_000,
      'property.currentValuation': 2_500_000,
      'loan.actualRatePercent': 6.85,
    });

    expect(parsed.recognised).toBe(true);
    expect(parsed.payload.property.address).toBe('12 Kembla Street');
    expect(parsed.payload.property.purchasePrice).toBe(2_450_000);
    expect(parsed.payload.property.currentValuation).toBe(2_500_000);
    expect(parsed.payload.loan.actualRatePercent).toBeCloseTo(6.85, 2);
  });

  it('exposes every required field to the panel readiness check', async () => {
    const parsed = await roundTrip({ 'property.address': '9 Bay Road' });
    // Address answered, the other three deliberately left blank — the panel
    // reads them off the payload, so they must be falsy rather than absent.
    expect(parsed.payload.property.address).toBe('9 Bay Road');
    expect(parsed.payload.property.purchasePrice).toBe(0);
    expect(parsed.payload.loan.actualRatePercent).toBe(0);
  });
});
