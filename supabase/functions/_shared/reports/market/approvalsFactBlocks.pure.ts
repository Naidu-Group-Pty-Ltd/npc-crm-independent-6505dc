/**
 * What a report may state about approved dwelling supply.
 *
 * ## The finding
 *
 * Supply is asked for by name in three prompts and answered by no register.
 * The statewide report's section 9 carries
 * `**Supply Pipeline Risk:** [New housing supply vs demand balance]` — a
 * bracketed slot with nothing behind it — and its section 10 asks for
 * hotspots with a `Growth Forecast` column. The Compass's strategic tier
 * declares a whole section, *Market Position, Competitive Landscape & Supply
 * Pipeline*. The only development evidence this platform holds is one state's
 * development-application register.
 *
 * That is exactly the shape `PLANNING_CONTROLS_IN_THE_REPORT.md` records: a
 * template slot, handed to a model with nothing to fill it from, **filled by
 * the model**. There is no reason to expect supply to have gone better than
 * zoning did.
 *
 * ## Why the prohibition ships before the register does
 *
 * `absBuildingApprovals.pure.ts` reads the national register, and that
 * register needs a table, a schedule and a first ingest before it answers
 * anything. This module answers *today*, on the absence branch: a report with
 * no approvals reading says so, in the publisher's terms, and is forbidden
 * from describing the pipeline. A register that has not had its first ingest
 * must degrade to a stated absence, never to a model's guess — which is
 * `CLONE_PROVISIONING_GAPS.md`'s rule, applied before the gap exists.
 *
 * ## Five rules
 *
 * **An approval is not a completion**, said wherever a figure is quoted.
 *
 * **A total summed from part of a register is PARTIAL and says so.** A
 * twelve-month total built from nine months is not the year's approvals;
 * `DA_REGISTER_RECONCILIATION.md` paid for that rule once. So a window states
 * how many of its months carried a figure, and an incomplete window's total is
 * named as the sum of those months. It is deliberately NOT called a floor:
 * that word is right for a register of counts that cannot fall, and the ABS
 * publishes approvals NET OF AMENDMENTS — a month in which approved dwellings
 * were cancelled is negative — so a missing month can lower the year as well
 * as raise it. The first version said "the true figure can only be higher",
 * which stopped being true the day the register admitted the publisher's
 * negatives.
 *
 * **A change is computed only between two COMPLETE windows.** Comparing two
 * partial windows produces a percentage that describes the gaps rather than
 * the market, and it arrives looking exactly like a measurement. (`floor` on
 * a window is the field's historical name for "partial"; only this module and
 * its specs read it, and renaming it would change nothing a reader sees.)
 *
 * **The grain is the publisher's and is never renamed.** An LGA reading
 * describes a council area — often hundreds of square kilometres — and
 * calling it the suburb's supply is the error `openDataSalesEvidence` prices
 * rather than hides.
 *
 * **An absence may not be rated.** `PLANNING_CONTROLS_IN_THE_REPORT.md` §9:
 * not Low, not Limited, not Constrained, not Tight — and not Strong either,
 * because a rating drawn from the coverage of a search is a statement about
 * the search.
 */
import { MONTHS_SHORT } from '../reportDate.pure.ts';
import { auDate } from '../../planning/auDate.pure.ts';
import {
  type ApprovalsAreaKind,
  type ApprovalsBuildingType,
  APPROVALS_ARE_NOT_COMPLETIONS,
} from './openData/absBuildingApprovals.pure.ts';

/** Why there is no reading. Five absences, as the planning register has. */
export type ApprovalsAbsence =
  /** The register has never been loaded on this deployment. */
  | 'not_loaded'
  /** The register was asked and holds no row for this area. */
  | 'none_for_area'
  /** The read itself failed — ours, never a statement about the area. */
  | 'unavailable'
  /** No area was resolved to ask about. */
  | 'no_area_resolved';

export interface ApprovalsMonth {
  period: string;
  buildingType: ApprovalsBuildingType;
  dwellingUnits: number | null;
  value: number | null;
}

export interface ApprovalsSeries {
  area: string;
  areaKind: ApprovalsAreaKind;
  months: ApprovalsMonth[];
  source: string;
  sourceUrl: string;
  licence: string;
  /** When this deployment last loaded the slice. */
  loadedAt: string | null;
}

export interface ApprovalsWindow {
  from: string;
  to: string;
  /** How many of the twelve months carried a published figure. */
  monthsCounted: number;
  /** True while `monthsCounted` is short of the window's length. */
  floor: boolean;
  units: number | null;
  value: number | null;
}

export interface ApprovalsReading {
  area: string;
  areaKind: ApprovalsAreaKind;
  latestPeriod: string;
  /** Per building type, the twelve months to `latestPeriod`. */
  latest: Record<ApprovalsBuildingType, ApprovalsWindow>;
  /** The twelve months before those. */
  prior: Record<ApprovalsBuildingType, ApprovalsWindow>;
  /**
   * Year-on-year change in total residential dwelling units, as a percentage,
   * and only where BOTH windows are complete.
   */
  changePct: number | null;
  source: string;
  sourceUrl: string;
  licence: string;
  loadedAt: string | null;
}

export const WINDOW_MONTHS = 12;

const TYPES: readonly ApprovalsBuildingType[] = ['total_residential', 'house', 'other_residential'];

export const BUILDING_TYPE_WORDS: Record<ApprovalsBuildingType, string> = {
  total_residential: 'all residential dwellings',
  house: 'houses',
  other_residential: 'other residential dwellings (townhouses, units and apartments)',
};

export const AREA_KIND_WORDS: Record<ApprovalsAreaKind, string> = {
  sa2: 'ABS Statistical Area Level 2',
  lga: 'local government area',
  state: 'state or territory',
  national: 'country',
};

/** `2026-07` → `Jul 2026`, from the one month table. */
export function monthLabel(period: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!m) return null;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return null;
  return `${MONTHS_SHORT[idx]} ${m[1]}`;
}

/** `2026-07` shifted back by `n` months. */
export function monthsBefore(period: string, n: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!m) return period;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) - n;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function windowOf(
  months: ApprovalsMonth[],
  type: ApprovalsBuildingType,
  to: string,
): ApprovalsWindow {
  const from = monthsBefore(to, WINDOW_MONTHS - 1);
  const inWindow = months.filter(
    (m) => m.buildingType === type && m.period >= from && m.period <= to,
  );
  let units: number | null = null;
  let value: number | null = null;
  let counted = 0;
  /*
   * `Number.isFinite`, not `!== null`.
   *
   * These are sums, and a sum is a figure printed in a client's table. The
   * old guard admitted `undefined` — which `!== null` is — and `0 + undefined`
   * is NaN, which then survives every downstream null check and renders as
   * `$NaN` in the money column. PostgREST hands back `undefined` for a column
   * missing from a projection exactly as it hands back `null` for an empty
   * one (`check-edge-column-names.mjs`' whole reason for existing), so the
   * shape is one narrower `select` away.
   *
   * Only a finite number contributes to a total. Anything else is an absence,
   * and an absence travels as `null` — the rule `rentalEvidence` and
   * `placesAvailability` each paid for, stated where the arithmetic happens as
   * well as where the row is built, because this module is what any future
   * producer of an `ApprovalsMonth` will be summed by.
   */
  for (const m of inWindow) {
    if (Number.isFinite(m.dwellingUnits)) {
      units = (units ?? 0) + (m.dwellingUnits as number);
      counted++;
    }
    if (Number.isFinite(m.value)) value = (value ?? 0) + (m.value as number);
  }
  return { from, to, monthsCounted: counted, floor: counted < WINDOW_MONTHS, units, value };
}

/**
 * The two twelve-month windows, and the change between them where both are
 * whole. Returns null where the series carries nothing at all — an empty
 * reading is an absence and must travel as one.
 */
export function summariseApprovals(series: ApprovalsSeries): ApprovalsReading | null {
  const periods = [...new Set(series.months.map((m) => m.period))].sort();
  if (periods.length === 0) return null;
  const latestPeriod = periods[periods.length - 1];
  const priorTo = monthsBefore(latestPeriod, WINDOW_MONTHS);

  const latest = {} as Record<ApprovalsBuildingType, ApprovalsWindow>;
  const prior = {} as Record<ApprovalsBuildingType, ApprovalsWindow>;
  for (const type of TYPES) {
    latest[type] = windowOf(series.months, type, latestPeriod);
    prior[type] = windowOf(series.months, type, priorTo);
  }
  if (TYPES.every((t) => latest[t].units === null && latest[t].value === null)) return null;

  const a = latest.total_residential;
  const b = prior.total_residential;
  const changePct = !a.floor && !b.floor && a.units !== null && b.units !== null && b.units > 0
    ? Math.round(((a.units - b.units) / b.units) * 1000) / 10
    : null;

  return {
    area: series.area,
    areaKind: series.areaKind,
    latestPeriod,
    latest,
    prior,
    changePct,
    source: series.source,
    sourceUrl: series.sourceUrl,
    licence: series.licence,
    loadedAt: series.loadedAt,
  };
}

// ─── The prose ──────────────────────────────────────────────────────────────

const WEB_SEARCH_HEAD =
  'A news article, a developer’s marketing page, a council media release or a '
  + 'search result is NOT this register.';

/**
 * The web-search rule, in the two forms the two branches need.
 *
 * The absence branch has no figures above it, so a rule reading "do not
 * substitute one for the figures above" describes something that is not on
 * the page — and a prohibition naming a thing the reader cannot find is one a
 * model reasons its way around. It is `A_PREMIUM_DOCUMENT.md`'s rule that no
 * step may describe its own position, applied to a rule about evidence.
 */
export function approvalsWebSearchRule(hasFigures: boolean): string {
  return hasFigures
    ? `${WEB_SEARCH_HEAD} Do not substitute one for the figures above, and do not `
      + 'add approvals, completions or project counts from any other source to them.'
    : `${WEB_SEARCH_HEAD} Do not go looking for one to fill the gap: the absence `
      + 'stated above is the finding, and a figure from anywhere else is not this '
      + 'register answering.';
}

/** The reading branch's form, for the prompt gates and the specs. */
export const APPROVALS_WEB_SEARCH_RULE = approvalsWebSearchRule(true);

export const APPROVALS_RATING_PROHIBITION =
  'Do NOT rate supply. Do not call the pipeline strong, weak, tight, constrained, '
  + 'limited, ample, oversupplied or undersupplied, and do not infer a price or '
  + 'rent consequence from these counts — an approval count is a count, and a '
  + 'judgement about what it means for this property is not in the record.';

/**
 * The four absences, in the two sentences the planning register already uses.
 *
 * The first draft of these described THIS PLATFORM to the client: *"has not
 * been loaded on this deployment"*, *"holds no row for it"*. A model told to
 * state the absence states the one it was handed, so those would have reached
 * a client's page as a note about our data loads and our database — which is
 * W4.7's rule (database vocabulary never reaches the reader) committed in the
 * one place W4.7's test cannot look, because it is prose rather than an
 * identifier.
 *
 * So they are cast as `planningFacts`' own two readings. **Searched, nothing
 * found** is a statement about this area within that register's coverage;
 * **Not searched** is a statement about the retrieval, from which nothing
 * about the area follows. The reader learns what was and was not asked, which
 * is what they need, and learns nothing about how this product is deployed,
 * which is none of their business and reads as an apology.
 */
export const ABSENCE_SENTENCE: Record<ApprovalsAbsence, string> = {
  not_loaded:
    '**Not searched.** The national building-approvals register was not searched for '
    + 'this report, so nothing about approved supply in this area follows from it.',
  none_for_area:
    '**Searched, nothing found.** The national building-approvals register was searched '
    + 'for this area and publishes no figure for it.',
  unavailable:
    '**Not searched.** The national building-approvals register could not be reached for '
    + 'this report. That is a fact about this retrieval, not about the area.',
  no_area_resolved:
    '**Not searched.** No council area or statistical area was resolved for this property, '
    + 'so no question could be put to the building-approvals register.',
};

/**
 * The rule W4.7 could not reach.
 *
 * `publisherNames.spec.ts` refuses an underscore-cased IDENTIFIER in a
 * rendered field. It cannot refuse a well-formed English sentence about a
 * deployment, a database, a data load or a cache — and a report that
 * explains its own plumbing to a customer reads as an apology for a product
 * rather than as a finding about a property.
 */
export const NO_PLUMBING_IN_THE_PROSE =
  'State this as what was and was not searched. Do NOT describe this platform’s own '
  + 'systems to the reader — no deployment, database, table, row, cache, data load, '
  + 'integration or API is ever mentioned in the report, and no apology is offered for '
  + 'one. The reader is told which register was asked and what it said.';

const n = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString('en-AU');

/**
 * The sign goes before the currency: `-$200,000`, never `$-200,000`.
 *
 * A net-of-amendments value is negative in a month of cancellations, and the
 * old form put the minus inside the amount. The hyphen-minus is the form that
 * PRINTS — `printableGlyphs.pure.ts` records that the typographic minus is
 * undrawable in two of the print faces and maps it back to `-` — and it is a
 * form `documentConsistency.pure.ts` already reads.
 */
const money = (value: number | null): string => {
  if (value === null) return '—';
  const rounded = Math.round(value);
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString('en-AU')}`;
};

function windowSentence(w: ApprovalsWindow, type: ApprovalsBuildingType): string {
  const span = `${monthLabel(w.from) ?? w.from} – ${monthLabel(w.to) ?? w.to}`;
  const head = `| ${BUILDING_TYPE_WORDS[type]} | ${n(w.units)} | ${money(w.value)} | ${span} |`;
  return head;
}

/**
 * The block handed to the model.
 *
 * On a reading: a table of the publisher's own figures, each with its window,
 * the grain stated in the publisher's words, the provenance, and the rules.
 * On an absence: the named absence and the prohibition, with no table and no
 * digit anywhere — the shape `crimeStatBlocks` already answers to.
 */
export function approvalsFactBlocks(
  reading: ApprovalsReading | null,
  absence: ApprovalsAbsence = 'not_loaded',
): string {
  if (!reading) {
    return [
      '### Approved dwelling supply',
      '',
      ABSENCE_SENTENCE[absence],
      '',
      'RULES FOR THIS REPORT — approved supply:',
      '1. State the absence if the subject arises. Do not state, imply or estimate '
      + 'a number of approvals, dwellings, lots or projects for this area.',
      `2. ${NO_PLUMBING_IN_THE_PROSE}`,
      `3. ${APPROVALS_RATING_PROHIBITION}`,
      `4. ${approvalsWebSearchRule(false)}`,
    ].join('\n');
  }

  const grain = AREA_KIND_WORDS[reading.areaKind];
  const lines: string[] = [
    '### Approved dwelling supply',
    '',
    `Area: **${reading.area}** — the ${grain} this property sits in. `
    + 'Every figure below describes that whole area and none of them describes '
    + 'this property, this street or this suburb.',
    '',
    '| Dwelling type | Units approved | Value of building approved | Window |',
    '| --- | --- | --- | --- |',
  ];
  for (const type of TYPES) lines.push(windowSentence(reading.latest[type], type));

  const total = reading.latest.total_residential;
  lines.push('');
  if (total.floor) {
    /*
     * Two statements the first version made here were not true. "The
     * publisher has released N of the 12 months" is false while the register
     * is still walking back — the ABS released all twelve and they are simply
     * not held yet. And "the true figure can only be higher" is false once the
     * publisher's negatives are stored: a missing month of cancellations lowers
     * the year. What IS true is how many months the total covers, and that it
     * is neither the year's total nor a minimum — so that is what is said, and
     * "not a minimum" is said out loud because "at least N dwellings" is the
     * sentence a model reaches for next.
     */
    lines.push(
      `Only **${total.monthsCounted} of the ${WINDOW_MONTHS} months** in that window carry a figure `
      + `for this area, so each total above is the sum of those ${total.monthsCounted} months. It is `
      + '**not** a twelve-month total, and it is not a minimum either: the publisher\'s monthly '
      + 'figures are net of amendments, and a month of cancellations is negative. Quote each one as '
      + `the approvals over those ${total.monthsCounted} months, and carry that qualification `
      + 'wherever you use it.',
    );
  } else {
    lines.push(`All ${WINDOW_MONTHS} months of that window are published for this area.`);
  }

  const prior = reading.prior.total_residential;
  lines.push('');
  if (reading.changePct !== null) {
    const dir = reading.changePct > 0 ? 'up' : reading.changePct < 0 ? 'down' : 'unchanged';
    lines.push(
      `Against the twelve months to ${monthLabel(prior.to) ?? prior.to} `
      + `(${n(prior.units)} units approved), all residential approvals are **${dir}`
      + `${reading.changePct === 0 ? '' : ` ${Math.abs(reading.changePct)}%`}**.`,
    );
  } else {
    lines.push(
      'No year-on-year change is stated: that comparison is made only between two complete '
      + 'twelve-month windows, and one of these two is short. Do not compute one.',
    );
  }

  const loaded = auDate(reading.loadedAt);
  lines.push(
    '',
    `Source: ${reading.source}. Latest month published: **${monthLabel(reading.latestPeriod) ?? reading.latestPeriod}**`
    + `${loaded ? `; this register was last loaded ${loaded}` : ''}. Licence: ${reading.licence}.`,
    '',
    'RULES FOR THIS REPORT — approved supply:',
    `1. ${APPROVALS_ARE_NOT_COMPLETIONS}`,
    `2. Name the area (**${reading.area}**) whenever you quote one of these figures. `
    + `Do not attribute them to the suburb or to this property \u2014 they describe the whole ${grain}.`,
    `3. ${APPROVALS_RATING_PROHIBITION}`,
    `4. ${approvalsWebSearchRule(true)}`,
  );
  return lines.join('\n');
}
