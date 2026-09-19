/**
 * Is this household a couple, for the purposes of the HEM benchmark?
 *
 * Audit item 9 — the borrowing capacity shown on the client card and the one
 * shown inside "View Full Calculator" are different numbers. On the reported
 * case they were $560,073 and $485,149, and the whole $74,924 is this
 * question answered two ways.
 *
 * The arithmetic, end to end. HEM's base table is $2,100/month for a single
 * and $2,950 for a couple; this household's income puts it on the 1.40
 * multiplier, so the two readings are $2,940 and $4,130. Living expenses are
 * `max(HEM, declared)` and the declared figure is $3,500, so the single
 * reading is bound by the declared expenses and the couple reading by HEM —
 * $630/month apart. At the 9.5% assessment rate over 30 years, $630/month is
 * exactly $74,924 of capacity.
 *
 * There were FOUR implementations of the test and they did not agree:
 *
 *   calculate-borrowing-capacity/index.ts   ['married','de facto','couple','partnered']
 *   utils/borrowingCapacityCalculations.ts  the same list
 *   utils/policyEngine.ts                   the same list
 *   BorrowingCapacityModal.tsx              married | de_facto | a secondary applicant exists
 *
 * Two faults follow from that, and the data shows both.
 *
 * FIRST: no spelling in the database matches any of them. `marital_status` is
 * free text and holds `Married` (11), `married` (11), `single` (5), `Single`
 * (2), `Defacto` (1), `Widow` (1), `widowed` (1) and NULL (744). Lower-casing
 * rescues `Married`, but `Defacto` matches neither `de facto` (a space) nor
 * `de_facto` (an underscore), so the one de-facto client in the system was
 * assessed as a single household by every implementation. Comparison is
 * against a normalised form now — case folded and stripped of everything but
 * letters — so all four spellings of the same status land together.
 *
 * SECOND: a second person on the assessment makes a couple household. Only
 * the modal knew this, which is why only the modal disagreed with the stored
 * figure. Fourteen clients carry a `secondary_first_name`; for five of them
 * — three with no marital status recorded, one `Defacto`, one `widowed` —
 * the server said single while the screen beside it said couple. The rule is
 * that if the assessment counts a second person's INCOME it must count their
 * expenses too, so a named secondary applicant is a couple household whatever
 * the status field says, and never the reverse.
 *
 * Resolving the disagreement raises HEM for those five, which LOWERS the
 * borrowing capacity the card reports. That is the direction the correction
 * has to go: the two readings cannot both stand, and the one that understates
 * a household's living costs is the one that overstates what it can borrow.
 * It bites only where HEM is the binding constraint — `max(HEM, declared)`
 * is unchanged wherever declared expenses are already the higher figure.
 *
 * Stored assessments are not rewritten. This decides new calculations.
 */

/**
 * Case-folded, letters only.
 *
 * `marital_status` is free text with no constraint, so `De Facto`,
 * `de_facto`, `de-facto` and `Defacto` are all in play and all mean one
 * thing. Digits and punctuation carry no meaning in a status, so they go.
 */
export function normaliseMaritalStatus(raw: string | null | undefined): string {
  return String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * The statuses that describe two adults in one household.
 *
 * Normalised spellings, so each entry covers every punctuation of itself.
 * `widowed`, `divorced`, `separated` and `single` are deliberately absent:
 * each describes one adult, and a second person on such a file arrives
 * through the secondary applicant instead.
 */
export const COUPLE_MARITAL_STATUSES: readonly string[] = [
  'married',
  'defacto',
  'couple',
  'partnered',
  'spouse',
];

export interface HouseholdComposition {
  /** `clients.marital_status` — free text, any spelling. */
  maritalStatus?: string | null;
  /** `clients.secondary_first_name` — a second person on the assessment. */
  secondaryApplicantName?: string | null;
}

/** Why the household was classified as it was, for the audit trail. */
export type CoupleBasis = 'marital_status' | 'secondary_applicant' | 'none';

export function coupleBasis(household: HouseholdComposition): CoupleBasis {
  if (COUPLE_MARITAL_STATUSES.includes(normaliseMaritalStatus(household.maritalStatus))) {
    return 'marital_status';
  }
  if (String(household.secondaryApplicantName ?? '').trim() !== '') {
    return 'secondary_applicant';
  }
  return 'none';
}

/** The one test. Every HEM lookup in the product resolves through this. */
export function isCoupleHousehold(household: HouseholdComposition): boolean {
  return coupleBasis(household) !== 'none';
}

/** `couple` or `single`, which is how the HEM tables are keyed. */
export function householdCategory(household: HouseholdComposition): 'couple' | 'single' {
  return isCoupleHousehold(household) ? 'couple' : 'single';
}

/** How the classification reads to a person looking at an audit trail. */
export function describeHousehold(household: HouseholdComposition): string {
  switch (coupleBasis(household)) {
    case 'marital_status':
      return 'Couple household (marital status)';
    case 'secondary_applicant':
      return 'Couple household (second applicant on the assessment)';
    default:
      return 'Single household';
  }
}
