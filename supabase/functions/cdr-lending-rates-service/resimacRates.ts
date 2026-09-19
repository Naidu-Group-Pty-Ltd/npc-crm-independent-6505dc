/**
 * Resimac Manual Rate Card — effective 27 March 2026
 * Source: https://broker.resimac.com.au/rates
 *
 * Resimac is a non-bank lender NOT participating in CDR Open Banking, so its
 * rates must be maintained manually. This module encodes the published broker
 * rate cards (Prime Full Doc, Prime Alt Doc, SMSF, Specialist Full Doc,
 * Specialist Alt Doc) across both OO and INV intents, all advertised LVR
 * bands, and both P&I / Interest-Only repayment types.
 *
 * To refresh: re-scrape https://broker.resimac.com.au/rates and regenerate
 * the BANDS arrays below. Update RESIMAC_EFFECTIVE_DATE.
 */

export const RESIMAC_EFFECTIVE_DATE = '2026-03-27';

export interface LendingRate {
  lenderId: string;
  lenderName: string;
  productId: string;
  productName: string;
  rate: number;
  comparisonRate: number | null;
  rateType: 'FIXED' | 'VARIABLE';
  loanPurpose: 'OWNER_OCCUPIED' | 'INVESTMENT';
  repaymentType: 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY';
  lvrMin: number | null;
  lvrMax: number | null;
  minLoanAmount: number | null;
  maxLoanAmount: number | null;
  features: string[];
  lastUpdated: string;
}

type Repay = 'PI' | 'IO';
type Purpose = 'OO' | 'INV';

interface BandRow {
  product: string;        // Display name
  productCode: string;    // Stable id slug
  repay: Repay;
  // Each tuple: [lvrMin, lvrMax, rate, compRate]; null rate = N/A row
  bands: Array<[number, number, number | null, number | null]>;
}

// ── Resimac Prime Full Doc — OO ─────────────────────────────────────────
const PRIME_FULL_OO: BandRow[] = [
  { product: 'Resimac Prime Flex P&I', productCode: 'prime-flex-pi', repay: 'PI', bands: [
    [0, 70, 6.14, 6.44], [70.01, 80, 6.24, 6.54], [80.01, 90, 6.44, 6.74], [90.01, 95, 6.64, 6.94],
  ]},
  { product: 'Resimac Prime Flex I/O', productCode: 'prime-flex-io', repay: 'IO', bands: [
    [0, 70, 6.14, 6.44], [70.01, 80, 6.24, 6.54], [80.01, 90, null, null], [90.01, 95, null, null],
  ]},
  { product: 'Resimac Prime P&I', productCode: 'prime-pi', repay: 'PI', bands: [
    [0, 70, 6.44, 6.48], [70.01, 80, 6.54, 6.58], [80.01, 90, 6.64, 6.68], [90.01, 95, 6.74, 6.78],
  ]},
  { product: 'Resimac Prime I/O', productCode: 'prime-io', repay: 'IO', bands: [
    [0, 70, 6.44, 6.48], [70.01, 80, 6.54, 6.58], [80.01, 90, null, null], [90.01, 95, null, null],
  ]},
];

// ── Resimac Prime Full Doc — INV ────────────────────────────────────────
const PRIME_FULL_INV: BandRow[] = [
  { product: 'Resimac Prime Flex P&I', productCode: 'prime-flex-pi', repay: 'PI', bands: [
    [0, 70, 6.34, 6.64], [70.01, 80, 6.44, 6.74], [80.01, 90, 6.64, 6.94], [90.01, 95, 6.84, 7.13],
  ]},
  { product: 'Resimac Prime Flex I/O', productCode: 'prime-flex-io', repay: 'IO', bands: [
    [0, 70, 6.34, 6.64], [70.01, 80, 6.44, 6.74], [80.01, 90, 6.64, 6.94], [90.01, 95, 6.84, 7.13],
  ]},
  { product: 'Resimac Prime P&I', productCode: 'prime-pi', repay: 'PI', bands: [
    [0, 70, 6.64, 6.68], [70.01, 80, 6.74, 6.78], [80.01, 90, 6.84, 6.88], [90.01, 95, 6.94, 6.98],
  ]},
  { product: 'Resimac Prime I/O', productCode: 'prime-io', repay: 'IO', bands: [
    [0, 70, 6.64, 6.68], [70.01, 80, 6.74, 6.78], [80.01, 90, 6.84, 6.88], [90.01, 95, 6.94, 6.98],
  ]},
];

// ── Resimac Prime Alt Doc — OO ──────────────────────────────────────────
const PRIME_ALT_OO: BandRow[] = [
  { product: 'Resimac Prime Alt Doc P&I', productCode: 'prime-altdoc-pi', repay: 'PI', bands: [
    [0, 70, 6.74, 6.81], [70.01, 80, 6.89, 6.96], [80.01, 85, 7.44, 7.51], [85.01, 90, 7.74, 7.81],
  ]},
  { product: 'Resimac Prime Alt Doc I/O', productCode: 'prime-altdoc-io', repay: 'IO', bands: [
    [0, 70, 6.74, 6.81], [70.01, 80, 6.89, 6.96], [80.01, 85, null, null], [85.01, 90, null, null],
  ]},
];

// ── Resimac Prime Alt Doc — INV ─────────────────────────────────────────
const PRIME_ALT_INV: BandRow[] = [
  { product: 'Resimac Prime Alt Doc P&I', productCode: 'prime-altdoc-pi', repay: 'PI', bands: [
    [0, 70, 6.94, 7.01], [70.01, 80, 7.09, 7.16], [80.01, 85, 7.64, 7.71], [85.01, 90, 7.94, 8.01],
  ]},
  { product: 'Resimac Prime Alt Doc I/O', productCode: 'prime-altdoc-io', repay: 'IO', bands: [
    [0, 70, 6.94, 7.01], [70.01, 80, 7.09, 7.16], [80.01, 85, 7.64, 7.71], [85.01, 90, 7.94, 8.01],
  ]},
];

// ── Resimac SMSF — INV only ─────────────────────────────────────────────
const SMSF_INV: BandRow[] = [
  { product: 'Resimac SMSF P&I', productCode: 'smsf-pi', repay: 'PI', bands: [
    [0, 60, 6.89, 7.34], [60.01, 70, 6.89, 7.34], [70.01, 80, 7.49, 7.94], [80.01, 90, 7.74, 8.18],
  ]},
  { product: 'Resimac SMSF I/O', productCode: 'smsf-io', repay: 'IO', bands: [
    [0, 60, 6.89, 7.34], [60.01, 70, 6.89, 7.34], [70.01, 80, 7.49, 7.94], [80.01, 90, 7.74, 8.18],
  ]},
];

// ── Resimac Specialist Full Doc — OO ────────────────────────────────────
const SPEC_FULL_OO: BandRow[] = [
  { product: 'Resimac Specialist Clear P&I', productCode: 'spec-clear-pi', repay: 'PI', bands: [
    [0, 70, 7.24, 7.34], [70.01, 80, 7.34, 7.44], [80.01, 85, 8.34, 8.44], [85.01, 90, 9.04, 9.15],
  ]},
  { product: 'Resimac Specialist Clear I/O', productCode: 'spec-clear-io', repay: 'IO', bands: [
    [0, 70, 7.24, 7.34], [70.01, 80, 7.34, 7.44], [80.01, 85, null, null], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Plus P&I', productCode: 'spec-plus-pi', repay: 'PI', bands: [
    [0, 70, 8.24, 8.34], [70.01, 80, 8.34, 8.44], [80.01, 85, 8.84, 8.94], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Plus I/O', productCode: 'spec-plus-io', repay: 'IO', bands: [
    [0, 70, 8.24, 8.34], [70.01, 80, 8.34, 8.44], [80.01, 85, null, null], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Assist P&I', productCode: 'spec-assist-pi', repay: 'PI', bands: [
    [0, 70, 9.24, 9.35], [70.01, 80, 9.34, 9.45], [80.01, 85, 9.84, 9.95], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Assist I/O', productCode: 'spec-assist-io', repay: 'IO', bands: [
    [0, 70, 9.24, 9.35], [70.01, 80, 9.34, 9.45], [80.01, 85, null, null], [85.01, 90, null, null],
  ]},
];

// ── Resimac Specialist Full Doc — INV ───────────────────────────────────
const SPEC_FULL_INV: BandRow[] = [
  { product: 'Resimac Specialist Clear P&I', productCode: 'spec-clear-pi', repay: 'PI', bands: [
    [0, 70, 7.54, 7.64], [70.01, 80, 7.64, 7.74], [80.01, 85, 8.64, 8.74], [85.01, 90, 9.34, 9.45],
  ]},
  { product: 'Resimac Specialist Clear I/O', productCode: 'spec-clear-io', repay: 'IO', bands: [
    [0, 70, 7.54, 7.64], [70.01, 80, 7.64, 7.74], [80.01, 85, 8.64, 8.74], [85.01, 90, 9.34, 9.45],
  ]},
  { product: 'Resimac Specialist Plus P&I', productCode: 'spec-plus-pi', repay: 'PI', bands: [
    [0, 70, 8.54, 8.64], [70.01, 80, 8.64, 8.74], [80.01, 85, 9.14, 9.25], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Plus I/O', productCode: 'spec-plus-io', repay: 'IO', bands: [
    [0, 70, 8.54, 8.64], [70.01, 80, 8.64, 8.74], [80.01, 85, 9.14, 9.25], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Assist P&I', productCode: 'spec-assist-pi', repay: 'PI', bands: [
    [0, 70, 9.54, 9.65], [70.01, 80, 9.64, 9.75], [80.01, 85, 10.14, 10.25], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Assist I/O', productCode: 'spec-assist-io', repay: 'IO', bands: [
    [0, 70, 9.54, 9.65], [70.01, 80, 9.64, 9.75], [80.01, 85, 10.14, 10.25], [85.01, 90, null, null],
  ]},
];

// ── Resimac Specialist Alt Doc — OO ─────────────────────────────────────
const SPEC_ALT_OO: BandRow[] = [
  { product: 'Resimac Specialist Clear Alt Doc P&I', productCode: 'spec-clear-alt-pi', repay: 'PI', bands: [
    [0, 70, 7.44, 7.54], [70.01, 80, 7.54, 7.64], [80.01, 85, 8.54, 8.64], [85.01, 90, 9.24, 9.35],
  ]},
  { product: 'Resimac Specialist Clear Alt Doc I/O', productCode: 'spec-clear-alt-io', repay: 'IO', bands: [
    [0, 70, 7.44, 7.54], [70.01, 80, 7.54, 7.64], [80.01, 85, null, null], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Plus Alt Doc P&I', productCode: 'spec-plus-alt-pi', repay: 'PI', bands: [
    [0, 70, 8.44, 8.54], [70.01, 80, 8.54, 8.64], [80.01, 85, 9.04, 9.15], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Plus Alt Doc I/O', productCode: 'spec-plus-alt-io', repay: 'IO', bands: [
    [0, 70, 8.44, 8.54], [70.01, 80, 8.54, 8.64], [80.01, 85, null, null], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Assist Alt Doc P&I', productCode: 'spec-assist-alt-pi', repay: 'PI', bands: [
    [0, 70, 9.44, 9.55], [70.01, 80, 9.54, 9.65], [80.01, 85, 10.04, 10.15], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Assist Alt Doc I/O', productCode: 'spec-assist-alt-io', repay: 'IO', bands: [
    [0, 70, 9.44, 9.55], [70.01, 80, 9.54, 9.65], [80.01, 85, null, null], [85.01, 90, null, null],
  ]},
];

// ── Resimac Specialist Alt Doc — INV ────────────────────────────────────
const SPEC_ALT_INV: BandRow[] = [
  { product: 'Resimac Specialist Clear Alt Doc P&I', productCode: 'spec-clear-alt-pi', repay: 'PI', bands: [
    [0, 70, 7.74, 7.84], [70.01, 80, 7.84, 7.94], [80.01, 85, 8.84, 8.94], [85.01, 90, 9.54, 9.65],
  ]},
  { product: 'Resimac Specialist Clear Alt Doc I/O', productCode: 'spec-clear-alt-io', repay: 'IO', bands: [
    [0, 70, 7.74, 7.84], [70.01, 80, 7.84, 7.94], [80.01, 85, 8.84, 8.94], [85.01, 90, 9.54, 9.65],
  ]},
  { product: 'Resimac Specialist Plus Alt Doc P&I', productCode: 'spec-plus-alt-pi', repay: 'PI', bands: [
    [0, 70, 8.74, 8.84], [70.01, 80, 8.84, 8.94], [80.01, 85, 9.34, 9.45], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Plus Alt Doc I/O', productCode: 'spec-plus-alt-io', repay: 'IO', bands: [
    [0, 70, 8.74, 8.84], [70.01, 80, 8.84, 8.94], [80.01, 85, 9.34, 9.45], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Assist Alt Doc P&I', productCode: 'spec-assist-alt-pi', repay: 'PI', bands: [
    [0, 70, 9.44, 9.55], [70.01, 80, 9.54, 9.65], [80.01, 85, 10.04, 10.15], [85.01, 90, null, null],
  ]},
  { product: 'Resimac Specialist Assist Alt Doc I/O', productCode: 'spec-assist-alt-io', repay: 'IO', bands: [
    [0, 70, 9.74, 9.85], [70.01, 80, 9.84, 9.95], [80.01, 85, 10.34, 10.45], [85.01, 90, null, null],
  ]},
];

interface ProductGroup {
  group: string;        // e.g. 'Prime Full Doc'
  groupSlug: string;    // e.g. 'prime-full'
  purpose: Purpose;
  rows: BandRow[];
}

const ALL_GROUPS: ProductGroup[] = [
  { group: 'Prime Full Doc',     groupSlug: 'prime-full', purpose: 'OO',  rows: PRIME_FULL_OO },
  { group: 'Prime Full Doc',     groupSlug: 'prime-full', purpose: 'INV', rows: PRIME_FULL_INV },
  { group: 'Prime Alt Doc',      groupSlug: 'prime-alt',  purpose: 'OO',  rows: PRIME_ALT_OO },
  { group: 'Prime Alt Doc',      groupSlug: 'prime-alt',  purpose: 'INV', rows: PRIME_ALT_INV },
  { group: 'SMSF',               groupSlug: 'smsf',       purpose: 'INV', rows: SMSF_INV },
  { group: 'Specialist Full Doc',groupSlug: 'spec-full',  purpose: 'OO',  rows: SPEC_FULL_OO },
  { group: 'Specialist Full Doc',groupSlug: 'spec-full',  purpose: 'INV', rows: SPEC_FULL_INV },
  { group: 'Specialist Alt Doc', groupSlug: 'spec-alt',   purpose: 'OO',  rows: SPEC_ALT_OO },
  { group: 'Specialist Alt Doc', groupSlug: 'spec-alt',   purpose: 'INV', rows: SPEC_ALT_INV },
];

/**
 * Build the full Resimac LendingRate[] array from the BandRow tables above.
 * Skips bands where rate is null (N/A in published table).
 */
export function buildResimacRates(): LendingRate[] {
  const now = new Date().toISOString();
  const rates: LendingRate[] = [];

  for (const grp of ALL_GROUPS) {
    for (const row of grp.rows) {
      for (const [lvrMin, lvrMax, rate, compRate] of row.bands) {
        if (rate === null) continue; // Skip N/A bands
        rates.push({
          lenderId: 'resimac',
          lenderName: 'Resimac',
          productId: `resimac-${grp.groupSlug}-${grp.purpose.toLowerCase()}-${row.productCode}-${lvrMax}`,
          productName: `${row.product} (≤${lvrMax}% LVR)`,
          rate,
          comparisonRate: compRate,
          rateType: 'VARIABLE',
          loanPurpose: grp.purpose === 'OO' ? 'OWNER_OCCUPIED' : 'INVESTMENT',
          repaymentType: row.repay === 'PI' ? 'PRINCIPAL_AND_INTEREST' : 'INTEREST_ONLY',
          lvrMin,
          lvrMax,
          minLoanAmount: null,
          maxLoanAmount: null,
          features: ['NON_BANK', 'OFFSET_AVAILABLE', grp.group.toUpperCase().replace(/\s+/g, '_')],
          lastUpdated: now,
        });
      }
    }
  }

  return rates;
}

export const RESIMAC_LENDER = {
  id: 'resimac',
  name: 'Resimac',
  logo: 'https://www.resimac.com.au/favicon.ico',
};
