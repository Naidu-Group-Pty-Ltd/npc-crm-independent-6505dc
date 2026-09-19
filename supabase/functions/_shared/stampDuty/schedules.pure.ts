/**
 * Transfer/stamp duty schedules for the eight Australian jurisdictions.
 *
 * THIS FILE IS THE ONLY PLACE RATES LIVE. Four copies of these numbers used to
 * exist — `src/utils/`, the `_shared/` mirror, a fallback inside
 * `financial-calculator-service`, and the seed of `stamp_duty_rates_cache` —
 * and all four disagreed with each other and with the revenue offices. If you
 * are here to change a rate, change it here; `validate.pure.ts` will check the
 * bands still join up and the golden tests will check the totals.
 *
 * Every figure below was taken from the jurisdiction's own published schedule
 * on 2026-08-10 and each band boundary was checked for continuity against the
 * band beneath it (the arithmetic is in `__tests__/stampDuty.spec.ts`). Where a
 * revenue office blocked automated retrieval, the note on the schedule records
 * how the figures were confirmed instead.
 *
 * A word on what "current" means. NSW and the ACT re-index every 1 July, so a
 * schedule here goes stale on a date rather than when a policy changes;
 * `assessStaleness()` in `validate.pure.ts` is what notices. The others change
 * only by announcement. `indexedAnnually` is what tells the difference.
 */

import type { DutySchedule, AustralianState } from './types.pure.ts';

/**
 * New South Wales — 2026-27.
 *
 * Thresholds are indexed to the Sydney CPI and republished before each 1 July;
 * the 2025-26 table this replaced understated the premium threshold by
 * $149,000. Premium property duty is a separate scale that supersedes the
 * general one for residential land, which is why it is not just a seventh band.
 */
const NSW: DutySchedule = {
  state: 'NSW',
  year: '2026-27',
  effectiveFrom: '2026-07-01',
  indexedAnnually: true,
  sourceUrl: 'https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/transfer-duty/rates',
  general: [
    { from: 0, base: 0, rate: 1.25, min: 20 },
    { from: 18_000, base: 225, rate: 1.5 },
    { from: 38_000, base: 525, rate: 1.75 },
    { from: 103_000, base: 1_662, rate: 3.5 },
    { from: 387_000, base: 11_602, rate: 4.5 },
    { from: 1_290_000, base: 52_237, rate: 5.5 },
  ],
  premium: {
    from: 3_870_000,
    bands: [{ from: 3_870_000, base: 194_137, rate: 7 }],
  },
  firstHome: {
    established: { kind: 'exempt_to_taper', fullTo: 800_000, taperTo: 1_000_000 },
    newHome: { kind: 'exempt_to_taper', fullTo: 800_000, taperTo: 1_000_000 },
    vacantLand: { kind: 'exempt_to_taper', fullTo: 350_000, taperTo: 450_000 },
  },
  foreignSurchargePct: 9,
  notes: [
    'Premium property duty applies to residential land only; non-residential land above the premium threshold stays on the general scale.',
    'First Home Buyers Assistance Scheme thresholds have been $800k/$1m (homes) and $350k/$450k (land) since 1 July 2023 and are not indexed.',
  ],
};

/**
 * Victoria — general rates unchanged since 1 July 2021, PPR rates since 2008.
 *
 * Two quirks that a naive bracket table gets wrong. The $960,000–$2,000,000
 * band is a flat 5.5% of the *entire* value, not a marginal rate, so duty jumps
 * about $130 the moment the value crosses $960,000. And the PPR concession stops
 * at $550,000 rather than tapering — above it an owner-occupier pays general
 * rates on the whole amount.
 */
const VIC: DutySchedule = {
  state: 'VIC',
  year: '2026-27',
  effectiveFrom: '2021-07-01',
  indexedAnnually: false,
  sourceUrl: 'https://www.sro.vic.gov.au/about-us/rates-and-statistics/current-rates/land-transfer-duty-non-principal-place-residence-current-rates',
  general: [
    { from: 0, base: 0, rate: 1.4 },
    { from: 25_000, base: 350, rate: 2.4 },
    { from: 130_000, base: 2_870, rate: 6 },
    { from: 960_000, mode: 'flat', rate: 5.5 },
    { from: 2_000_000, base: 110_000, rate: 6.5 },
  ],
  ownerOccupier: [
    { from: 0, base: 0, rate: 1.4 },
    { from: 25_000, base: 350, rate: 2.4 },
    { from: 130_000, base: 2_870, rate: 5 },
    { from: 440_000, base: 18_370, rate: 6 },
  ],
  ownerOccupierUpTo: 550_000,
  firstHome: {
    established: { kind: 'exempt_to_taper', fullTo: 600_000, taperTo: 750_000 },
    newHome: { kind: 'exempt_to_taper', fullTo: 600_000, taperTo: 750_000 },
    vacantLand: { kind: 'exempt_to_taper', fullTo: 600_000, taperTo: 750_000 },
  },
  foreignSurchargePct: 8,
  notes: [
    'The $960k–$2m band is a flat 5.5% of the whole dutiable value, not a marginal rate.',
    'PPR concessional rates are unavailable above $550,000; general rates then apply to the full value.',
  ],
};

/**
 * Queensland — general rates unchanged since 21 September 2012.
 *
 * Queensland is the jurisdiction whose relief is least like everyone else's.
 * Anyone buying a home to live in gets the *home concession* scale, first home
 * buyers then deduct a flat dollar amount from that, and since 1 May 2025 a
 * first home buyer of a new home or vacant land pays nothing at all with no
 * price cap. The three interact, so they are modelled as a scale plus a
 * deduction rather than as one blended table.
 */
const QLD: DutySchedule = {
  state: 'QLD',
  year: '2026-27',
  effectiveFrom: '2025-05-01',
  indexedAnnually: false,
  sourceUrl: 'https://qro.qld.gov.au/duties/transfer-duty/calculate/rates/',
  general: [
    { from: 0, base: 0, rate: 0 },
    { from: 5_000, base: 0, rate: 1.5 },
    { from: 75_000, base: 1_050, rate: 3.5 },
    { from: 540_000, base: 17_325, rate: 4.5 },
    { from: 1_000_000, base: 38_025, rate: 5.75 },
  ],
  ownerOccupier: [
    { from: 0, base: 0, rate: 1 },
    { from: 350_000, base: 3_500, rate: 3.5 },
    { from: 540_000, base: 10_150, rate: 4.5 },
    { from: 1_000_000, base: 30_850, rate: 5.75 },
  ],
  firstHome: {
    // Deducted from home-concession duty. $17,350 exactly cancels the duty on a
    // $700,000 home, which is why Queensland describes the cut-in as "no duty
    // under $700,000" even though the mechanism is a fixed rebate.
    established: {
      kind: 'fixed_steps',
      steps: [
        { under: 710_000, amount: 17_350 },
        { under: 720_000, amount: 15_615 },
        { under: 730_000, amount: 13_880 },
        { under: 740_000, amount: 12_145 },
        { under: 750_000, amount: 10_410 },
        { under: 760_000, amount: 8_675 },
        { under: 770_000, amount: 6_940 },
        { under: 780_000, amount: 5_205 },
        { under: 790_000, amount: 3_470 },
        { under: 800_000, amount: 1_735 },
      ],
    },
    newHome: { kind: 'exempt_all', note: 'Full first home (new home) concession, no value cap, contracts from 1 May 2025.' },
    vacantLand: { kind: 'exempt_all', note: 'Full first home vacant land concession, no value cap, contracts from 1 May 2025.' },
  },
  foreignSurchargePct: 8,
  notes: [
    'The home concession scale applies to any buyer occupying the property, not only first home buyers.',
    'The first home concession is a fixed dollar deduction from home-concession duty, stepping down $1,735 per $10,000 of value to nil at $800,000.',
  ],
};

/**
 * Western Australia — general rates long-standing, first home owner rate
 * rebased on 7 May 2026.
 *
 * The FHOR is a replacement scale rather than a discount, and its bands are
 * calibrated to meet the general scale exactly at the ceiling: at $550,000 the
 * vacant-land rate and the general rate both come to $20,140. That coincidence
 * is a useful check that the numbers have been transcribed correctly.
 */
const WA: DutySchedule = {
  state: 'WA',
  year: '2026-27',
  effectiveFrom: '2026-05-07',
  indexedAnnually: false,
  sourceUrl: 'https://www.wa.gov.au/organisation/department-of-treasury-and-finance/transfer-duty-assessment',
  general: [
    { from: 0, base: 0, rate: 1.9 },
    { from: 120_000, base: 2_280, rate: 2.85 },
    { from: 150_000, base: 3_135, rate: 3.8 },
    { from: 360_000, base: 11_115, rate: 4.75 },
    { from: 725_000, base: 28_453, rate: 5.15 },
  ],
  ownerOccupier: [
    { from: 0, base: 0, rate: 1.5 },
    { from: 120_000, base: 1_800, rate: 4.04 },
  ],
  ownerOccupierUpTo: 200_000,
  firstHome: {
    established: {
      kind: 'scale',
      appliesUpTo: 800_000,
      bands: [
        { from: 0, base: 0, rate: 0 },
        { from: 600_000, base: 0, rate: 16.15 },
      ],
    },
    newHome: {
      kind: 'scale',
      appliesUpTo: 800_000,
      bands: [
        { from: 0, base: 0, rate: 0 },
        { from: 600_000, base: 0, rate: 16.15 },
      ],
    },
    vacantLand: {
      kind: 'scale',
      appliesUpTo: 550_000,
      bands: [
        { from: 0, base: 0, rate: 0 },
        { from: 450_000, base: 0, rate: 20.14 },
      ],
    },
  },
  foreignSurchargePct: 7,
  notes: [
    'First home owner rate from 7 May 2026: nil to $600,000 for homes and nil to $450,000 for vacant land, statewide (no metropolitan/regional split).',
    "WA's concessional rate covers a principal residence only up to $200,000 and so rarely bites in practice.",
  ],
};

/**
 * South Australia — nine marginal bands, unindexed.
 *
 * The band this repo kept losing is $200,000–$250,000 at 4.25%: dropping it and
 * running 4.25% straight through to $300,000 understates duty on every property
 * above a quarter of a million dollars.
 */
const SA: DutySchedule = {
  state: 'SA',
  year: '2026-27',
  effectiveFrom: '2025-02-13',
  indexedAnnually: false,
  sourceUrl: 'https://www.revenuesa.sa.gov.au/stamp-duty-land/rate-of-stamp-duty',
  general: [
    { from: 0, base: 0, rate: 1 },
    { from: 12_000, base: 120, rate: 2 },
    { from: 30_000, base: 480, rate: 3 },
    { from: 50_000, base: 1_080, rate: 3.5 },
    { from: 100_000, base: 2_830, rate: 4 },
    { from: 200_000, base: 6_830, rate: 4.25 },
    { from: 250_000, base: 8_955, rate: 4.75 },
    { from: 300_000, base: 11_330, rate: 5 },
    { from: 500_000, base: 21_330, rate: 5.5 },
  ],
  firstHome: {
    established: { kind: 'none', note: 'SA first home relief covers new homes and land to build on only; an established home pays full duty.' },
    newHome: { kind: 'exempt_all', note: 'Full exemption with no value cap for eligible new homes, contracts from 13 February 2025.' },
    vacantLand: { kind: 'exempt_all', note: 'Full exemption with no value cap for vacant land on which a new home will be built.' },
  },
  foreignSurchargePct: 7,
  notes: [
    'RevenueSA blocks automated retrieval; the band table was confirmed against RevenueSA quoted figures ($8,955 / $11,330 / $21,330 at the $250k / $300k / $500k boundaries) and cross-checked band by band for continuity.',
    'Commercial and industrial property has been exempt from SA conveyance duty since 1 July 2018 — this schedule covers residential only.',
  ],
};

/**
 * Tasmania — rates from the State Revenue Office duty table.
 *
 * The first home buyer exemption for established homes to $750,000 ran from
 * 18 February 2024 and **expired on 30 June 2026**. It is deliberately recorded
 * as `none` with a note rather than deleted, because "there is no concession"
 * is a fact a report should be able to state, and because a silent absence is
 * indistinguishable from an oversight.
 */
const TAS: DutySchedule = {
  state: 'TAS',
  year: '2026-27',
  effectiveFrom: '2026-07-01',
  indexedAnnually: false,
  sourceUrl: 'https://www.sro.tas.gov.au/property-transfer-duties/rates-of-duty',
  general: [
    { from: 0, base: 50, rate: 0 },
    { from: 3_000, base: 50, rate: 1.75 },
    { from: 25_000, base: 435, rate: 2.25 },
    { from: 75_000, base: 1_560, rate: 3.5 },
    { from: 200_000, base: 5_935, rate: 4 },
    { from: 375_000, base: 12_935, rate: 4.25 },
    { from: 725_000, base: 27_810, rate: 4.5 },
  ],
  firstHome: {
    established: { kind: 'none', note: 'The 100% first home exemption to $750,000 expired 30 June 2026; established homes now pay full duty.' },
    newHome: { kind: 'none', note: 'The 100% first home exemption to $750,000 expired 30 June 2026.' },
    vacantLand: { kind: 'none', note: 'No first home vacant land duty concession currently in force.' },
  },
  foreignSurchargePct: 8,
  notes: [
    'Duty on a property worth $3,000 or less is a flat $50.',
    'The first home exemption that ran 18 February 2024 – 30 June 2026 has ended; do not reinstate it without a fresh SRO reference.',
  ],
};

/**
 * Northern Territory — quadratic below $525,000, flat above.
 *
 * Every previous version of this calculator in the repo modelled NT as linear
 * brackets, which is simply not what the Territory does: below $525,000 duty is
 * `(0.06571441 × V²) + 15V` with V the value in thousands. Above the threshold
 * the rate applies to the *whole* value, and the formula is calibrated so the
 * two meet — V = 525 gives $25,987.16 against 4.95% of $525,000 = $25,987.50.
 */
const NT: DutySchedule = {
  state: 'NT',
  year: '2026-27',
  effectiveFrom: '2024-07-01',
  indexedAnnually: false,
  sourceUrl: 'https://nt.gov.au/property/land-title-and-valuation/stamp-duty',
  general: [
    { from: 0, mode: 'nt_quadratic' },
    { from: 525_000, mode: 'flat', rate: 4.95 },
    { from: 3_000_000, mode: 'flat', rate: 5.75 },
    { from: 5_000_000, mode: 'flat', rate: 5.95 },
  ],
  firstHome: {
    established: { kind: 'none', note: 'The NT First Home Owner Discount ended 30 June 2021; relief is delivered as cash grants, not duty concessions.' },
    newHome: { kind: 'none', note: 'The NT First Home Owner Discount ended 30 June 2021; relief is delivered as cash grants, not duty concessions.' },
    vacantLand: { kind: 'none', note: 'The NT First Home Owner Discount ended 30 June 2021.' },
  },
  foreignSurchargePct: 0,
  notes: [
    'Below $525,000 duty is D = (0.06571441 × V²) + 15V where V is the dutiable value in thousands.',
    'Above $525,000 the rate applies to the entire dutiable value, not the excess.',
    'The Northern Territory is the only jurisdiction with no foreign purchaser surcharge.',
    'NT first home grants (FHOG and the HomeGrown Territory grants) are cash payments and are deliberately not netted off duty here.',
  ],
};

/**
 * Australian Capital Territory — 2026-27.
 *
 * The ACT is the only jurisdiction running two full residential schedules side
 * by side: owner-occupiers start at $0.28 per $100 and investors at $1.20, and
 * they converge on a flat 4.54% of the whole value above $1,455,000. The flat
 * band is calibrated to the investor scale, so an owner-occupier crossing
 * $1,455,000 sees duty step *up* — that is the published position, not an
 * arithmetic slip.
 *
 * From 1 July 2026 the Home Buyer Concession Scheme is a full exemption with no
 * income test and no property value cap, so an eligible first home buyer pays
 * nothing regardless of price.
 */
const ACT: DutySchedule = {
  state: 'ACT',
  year: '2026-27',
  effectiveFrom: '2026-07-01',
  indexedAnnually: true,
  sourceUrl: 'https://www.revenue.act.gov.au/duties/conveyance-duty',
  general: [
    { from: 0, base: 0, rate: 1.2 },
    { from: 200_000, base: 2_400, rate: 2.2 },
    { from: 300_000, base: 4_600, rate: 3.4 },
    { from: 500_000, base: 11_400, rate: 4.32 },
    { from: 750_000, base: 22_200, rate: 5.9 },
    { from: 1_000_000, base: 36_950, rate: 6.4 },
    { from: 1_455_000, mode: 'flat', rate: 4.54 },
  ],
  ownerOccupier: [
    { from: 0, base: 0, rate: 0.28 },
    { from: 260_000, base: 728, rate: 2.2 },
    { from: 300_000, base: 1_608, rate: 3.4 },
    { from: 500_000, base: 8_408, rate: 4.32 },
    { from: 750_000, base: 19_208, rate: 5.9 },
    { from: 1_000_000, base: 33_958, rate: 6.4 },
    { from: 1_455_000, mode: 'flat', rate: 4.54 },
  ],
  firstHome: {
    established: { kind: 'exempt_all', note: 'Home Buyer Concession Scheme: full exemption, no income test or value cap, from 1 July 2026.' },
    newHome: { kind: 'exempt_all', note: 'Home Buyer Concession Scheme: full exemption, no income test or value cap, from 1 July 2026.' },
    vacantLand: { kind: 'exempt_all', note: 'Home Buyer Concession Scheme: full exemption, no income test or value cap, from 1 July 2026.' },
  },
  foreignSurchargePct: 0,
  notes: [
    'The ACT Revenue Office blocks automated retrieval; both schedules were confirmed against two independent published reproductions that agreed exactly, and every band boundary was checked for continuity.',
    'The flat 4.54% band above $1,455,000 is calibrated to the investor scale, so owner-occupier duty is discontinuous there by design.',
    'The ACT levies no foreign purchaser duty surcharge; it applies a land tax surcharge instead, which is annual rather than at acquisition.',
  ],
};

/** Built-in schedules, one per jurisdiction. */
export const DUTY_SCHEDULES: Readonly<Record<AustralianState, DutySchedule>> = {
  NSW, VIC, QLD, WA, SA, TAS, NT, ACT,
};

/** The date the figures above were taken from the revenue offices. */
export const SCHEDULES_VERIFIED_ON = '2026-08-10';

export function getSchedule(state: AustralianState): DutySchedule | undefined {
  return DUTY_SCHEDULES[state];
}
