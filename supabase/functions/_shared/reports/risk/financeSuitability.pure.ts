/**
 * ME-5.1 item 5 — the buyer's position, reported and never scored into the
 * property.
 *
 * ME-5 measured the reason this exists. 55 addresses appear in more than one
 * report; the purchase price differs on 7 of them, the LVR on 16 and the weekly
 * cash flow on 21. **1 Boxer Drive, Wyndham Vale carries two reports written
 * the same day, at the same $635,000 and the same −$562 weekly net, one at 80%
 * LVR and one at 90%.** Under the live model that is 12.8 points of Risk for a
 * number an operator typed into a calculator.
 *
 * Financing belongs to the buyer. The property does not become a worse asset
 * because this particular purchaser borrowed more against it, and a grade that
 * says otherwise cannot be defended to the next buyer of the same house.
 *
 * So there are two results, and the report must make the distinction obvious:
 *
 *   **Property Investment Grade** — what the asset is.
 *   **Client Finance Suitability** — whether THIS purchase, at THIS leverage,
 *   sits comfortably for THIS buyer.
 *
 * ## Three rules
 *
 * **It never returns a number the composite can read.** There is no field on
 * this result that a grade could pick up by accident; the separation is
 * structural rather than a convention someone has to remember.
 *
 * **It is a reading about a scenario, not about a person.** The inputs are the
 * stated financing parameters, which is all the record holds — no income, no
 * expenses, no serviceability assessment. Calling it a suitability
 * *determination* would overclaim, so every band names the scenario.
 *
 * **Absent is absent.** A report with no stated LVR gets no suitability
 * reading, not a neutral one.
 */

export const FINANCE_SUITABILITY_VERSION = '1.0.0';

export interface FinanceInputs {
  /** Loan-to-value ratio, per cent, as stated for this purchase. */
  lvr?: number | null;
  /** Weekly cash flow after financing, as calculated for this scenario. */
  weeklyCashFlow?: number | null;
  /** Purchase price, for context in the statement only. */
  purchasePrice?: number | null;
}

export type SuitabilityBand = 'comfortable' | 'manageable' | 'stretched' | 'under_pressure';

export interface FinanceSuitabilityResult {
  version: string;
  /** Null when the record states no financing at all. */
  band: SuitabilityBand | null;
  /** What each stated parameter contributes, for the reader — never a grade. */
  readings: Array<{ key: string; value: number; reading: string }>;
  /** Said in full on every result, because the separation is the point. */
  appliesTo: 'this purchase scenario, not the property';
  statement: string;
}

/** Leverage bands. Higher leverage is a larger claim on the buyer, not on the asset. */
function lvrReading(lvr: number): { band: SuitabilityBand; reading: string } {
  if (lvr <= 60) return { band: 'comfortable', reading: `${lvr}% leverage leaves substantial equity buffer.` };
  if (lvr <= 80) return { band: 'manageable', reading: `${lvr}% leverage is within conventional lending limits.` };
  if (lvr <= 90) return { band: 'stretched', reading: `${lvr}% leverage typically requires mortgage insurance and leaves a thin equity buffer.` };
  return { band: 'under_pressure', reading: `${lvr}% leverage leaves almost no equity buffer against a price fall.` };
}

/** Holding pressure. A negative weekly figure is a call on the buyer's income. */
function cashFlowReading(weekly: number): { band: SuitabilityBand; reading: string } {
  if (weekly >= 0) return { band: 'comfortable', reading: `The scenario is cash-flow positive at $${weekly.toFixed(0)} a week.` };
  if (weekly >= -150) return { band: 'manageable', reading: `The scenario requires $${Math.abs(weekly).toFixed(0)} a week from other income.` };
  if (weekly >= -400) return { band: 'stretched', reading: `The scenario requires $${Math.abs(weekly).toFixed(0)} a week from other income — a material ongoing commitment.` };
  return { band: 'under_pressure', reading: `The scenario requires $${Math.abs(weekly).toFixed(0)} a week from other income, which is a substantial sustained claim.` };
}

const SEVERITY: Record<SuitabilityBand, number> = {
  comfortable: 0, manageable: 1, stretched: 2, under_pressure: 3,
};

/**
 * Read the buyer's stated position.
 *
 * Takes the WORST band rather than an average: a comfortable LVR does not
 * offset a cash-flow call the buyer has to fund every week, and averaging the
 * two would let one hide the other.
 */
export function assessFinanceSuitability(input: FinanceInputs): FinanceSuitabilityResult {
  const readings: FinanceSuitabilityResult['readings'] = [];
  const bands: SuitabilityBand[] = [];

  if (typeof input.lvr === 'number' && Number.isFinite(input.lvr)) {
    const r = lvrReading(input.lvr);
    readings.push({ key: 'lvr', value: input.lvr, reading: r.reading });
    bands.push(r.band);
  }
  if (typeof input.weeklyCashFlow === 'number' && Number.isFinite(input.weeklyCashFlow)) {
    const r = cashFlowReading(input.weeklyCashFlow);
    readings.push({ key: 'weeklyCashFlow', value: input.weeklyCashFlow, reading: r.reading });
    bands.push(r.band);
  }

  if (bands.length === 0) {
    return {
      version: FINANCE_SUITABILITY_VERSION, band: null, readings: [],
      appliesTo: 'this purchase scenario, not the property',
      statement: 'No financing parameters are stated for this report, so no finance suitability '
        + 'is read. This says nothing about the property.',
    };
  }

  const band = bands.reduce((worst, b) => (SEVERITY[b] > SEVERITY[worst] ? b : worst), bands[0]);

  return {
    version: FINANCE_SUITABILITY_VERSION,
    band,
    readings,
    appliesTo: 'this purchase scenario, not the property',
    statement: `This reading describes the stated purchase scenario — the leverage and holding `
      + `position a particular buyer would take on. It does not form part of the property's `
      + `grade, and the same property at different leverage would read differently here and `
      + `identically there.`,
  };
}
