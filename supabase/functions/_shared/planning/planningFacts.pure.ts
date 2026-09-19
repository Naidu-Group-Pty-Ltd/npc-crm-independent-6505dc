/**
 * The planning controls a report may state, and what each one rests on.
 *
 * ## The defect this exists to end
 *
 * `planning-data-service` has worked since 2026-09-06. It resolves the
 * jurisdiction from the layers themselves, returns the zone, the parcel, the
 * state development instruments and the DA activity, and says which kind of
 * absence each empty cell is. `generate-investment-report` fetches it,
 * assigns it to `enhancedData.planningData` — and then **reads nothing back
 * out of it for the zoning section**.
 *
 * Measured on 262 Pallas Street, Maryborough QLD 4650 (report
 * `aa41bcec-5a5c-434d-9162-96deb50e9bdb`, 16 Sep 2026): the stored row has
 * `spec_zoning` null, `spec_council` null, no zoning key among its 25
 * overrides and no `planning` entry in `data_sources`, while a live call to
 * the deployed service at that report's own coordinate answers
 * `jurisdiction: QLD`, `parcel.status: ok`, `lga: "Fraser Coast Regional"`,
 * `locality: "Maryborough"` under CC BY 4.0. The enrichment worked and the
 * report discarded all of it.
 *
 * What the reader got instead was the prompt's own furniture. The zoning
 * section was a template of bracketed placeholders — `[XX]%` site coverage,
 * `[X]m` setbacks, "Refer to LEP" for minimum lot size, height and floor
 * space ratio, and the sentence "Check minimum lot size requirements
 * (typically 450m²)" — handed to a model with nothing to fill them from. A
 * model asked for a control it has not been given will supply a plausible
 * one: 450 m², 8.5 m, 0.5:1 are the numbers that came back, and a reader
 * cannot tell them from measurements. The template was also written for New
 * South Wales — LEP, DCP, a s10.7 certificate — on a Queensland property,
 * where none of those instruments exists.
 *
 * ## The rules
 *
 * 1. **A control with no source is never a number.** Every cell is a value
 *    with a provenance or a named absence; there is no default, no "typical",
 *    and no bracketed placeholder for a model to fill. This is the rule that
 *    the 450/8.5/0.5 trio broke.
 * 2. **An audited operator override outranks a layer, and says so.** A person
 *    who has read the certificate knows more than a spatial layer, so an
 *    override is never overwritten by an automatic reading — but it is
 *    labelled `operator_stated` rather than presented as a published control.
 * 3. **A layer is indicative; the instrument settles it.** Every answer
 *    carries the jurisdiction's own verification instrument, and the section
 *    says in its own words that this is desktop research rather than a
 *    planning certificate.
 * 4. **The four absences are different sentences.** `not_served` (the
 *    jurisdiction publishes no such dataset), `not_integrated` (no verified
 *    adapter), `licence_restricted` (the data exists and may not be
 *    republished), `none_at_point` (the service answered and nothing covers
 *    this point) and `unavailable` (the read failed) are five different
 *    things, and collapsing them is how "we did not look" comes to read as
 *    "there is nothing there".
 * 5. **Adopted controls and draft amendments never merge.** A draft is
 *    reported under its own heading with its own standing, because acting on
 *    a draft as though it were in force is the expensive mistake here.
 * 6. **Development potential from a zone is conditional, never approval.**
 *    A zone admitting a use is not consent for it; the sentence says so
 *    wherever a potential is stated.
 *
 * Pure: no fetch, no Deno, no clock. The retrieval stamp comes in with the
 * reading.
 */

import {
  VERIFICATION_INSTRUMENT,
  type PlanningJurisdiction,
} from './planningSources.pure.ts';
import {
  CONSTRAINT_FAMILY_LABEL,
  type ConstraintFamily,
  type ConstraintKind,
  type PlanningConstraintReading,
} from './planningConstraints.pure.ts';
import {
  CONTROL_GUIDE,
  NO_STATE_LAYER_NOTE,
  VERIFICATION_DOCUMENT,
} from './planningControlGuide.pure.ts';

// ---------------------------------------------------------------------------
// Vocabulary

/**
 * Why a cell reads as it does.
 *
 * `stated` and `operator_stated` carry a value; every other member carries a
 * note instead, and the five absences are deliberately distinct (rule 4).
 */
export type PlanningCellStatus =
  | 'stated'
  | 'operator_stated'
  | 'none_at_point'
  | 'not_published'
  | 'not_served'
  | 'licence_restricted'
  | 'not_integrated'
  | 'unavailable';

/** Whether a control is in force or proposed. Never inferred (rule 5). */
export type PlanningStanding = 'adopted' | 'draft';

export interface PlanningCell {
  /** The control, in the reader's words — "Minimum lot size". */
  label: string;
  /** The value as it should be printed, units included, or null. */
  value: string | null;
  status: PlanningCellStatus;
  /** Why there is no value. Null exactly when a value is present. */
  note: string | null;
  /** The publisher and dataset, as the adapter names them. */
  source: string | null;
  /** A page a reader can open to check it. */
  sourceUrl: string | null;
  licence: string | null;
  /** The instrument's own currency or gazettal date, where it states one. */
  effectiveDate: string | null;
  /** When THIS deployment retrieved the reading. */
  retrievedAt: string | null;
  standing: PlanningStanding | null;
}

export interface PlanningInstrumentFact {
  kind: string;
  name: string;
  status: string | null;
  gazetted: string | null;
  detail: string | null;
}

export interface PlanningFacts {
  jurisdiction: PlanningJurisdiction | null;
  /** The local government the answering layer named — never a guess. */
  council: string | null;
  locality: string | null;
  lotPlan: string | null;
  parcelAreaSqm: number | null;
  parcelAreaBasis: 'surveyed' | 'computed' | null;
  zoning: PlanningCell;
  zoneFamily: string | null;
  overlays: PlanningCell;
  /** Minimum lot size, height and floor space ratio, in that order. */
  controls: PlanningCell[];
  /**
   * Every control, overlay and hazard a register actually returned at this
   * point, ordered hazard → control → protection → context.
   */
  constraints: PlanningConstraintReading[];
  /**
   * What the registers that ANSWERED are able to answer.
   *
   * It travels separately from the readings because an empty list means two
   * opposite things: "we asked about bushfire and flood and neither applies"
   * is a finding, and "nobody asked" is not. A reader can only tell them
   * apart if the coverage is stated.
   */
  constraintsAsked: ConstraintFamily[];
  /** The registers that answered, and the ones that could not be reached. */
  constraintRegisters: { answered: string[]; unavailable: string[] };
  /** State development instruments the point sits inside. */
  instruments: PlanningCell;
  instrumentList: PlanningInstrumentFact[];
  /** Development applications in the surrounding register, where one exists. */
  developmentActivity: PlanningCell;
  developmentActivitySummary: Record<string, unknown> | null;
  /** The sentence that says what settles the question. */
  verification: string;
  retrievedAt: string | null;
  /** True when at least one cell carries a value. */
  anyStated: boolean;
  /** True when the enrichment was never reached at all. */
  enrichmentMissing: boolean;
}

/**
 * Where a reader goes to check the answer themselves.
 *
 * The adapter's `source` names the dataset and its host; this names the
 * public portal a person can open, which is what "persist the source URL"
 * has to mean for somebody who is not going to call an ArcGIS endpoint.
 */
export const PLANNING_VERIFICATION_URL: Readonly<Record<PlanningJurisdiction, string>> = {
  NSW: 'https://www.planningportal.nsw.gov.au/spatialviewer',
  VIC: 'https://mapshare.vic.gov.au/vicplan/',
  QLD: 'https://planning.statedevelopment.qld.gov.au/planning/spatial-mapping/interactive-mapping',
  WA: 'https://www.wa.gov.au/organisation/department-of-planning-lands-and-heritage/planwa',
  SA: 'https://plan.sa.gov.au/',
  TAS: 'https://maps.thelist.tas.gov.au/listmap/app/list/map',
  ACT: 'https://www.planning.act.gov.au/territory-plan',
  NT: 'https://ntlis.nt.gov.au/planning/',
};

// ---------------------------------------------------------------------------
// Readers

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** A cell with nothing in it, carrying the reason and nothing else. */
function absent(label: string, status: PlanningCellStatus, note: string): PlanningCell {
  return {
    label, value: null, status, note,
    source: null, sourceUrl: null, licence: null,
    effectiveDate: null, retrievedAt: null, standing: null,
  };
}

/**
 * The status a service cell's own `status` word maps onto.
 *
 * The service already distinguishes the five absences; this only widens the
 * vocabulary with the two an override can produce. An unrecognised word is
 * `unavailable` rather than an absence, because a word this module does not
 * know is a failure to understand the answer, not evidence about the land.
 */
function statusOf(raw: unknown): PlanningCellStatus {
  switch (str(raw)) {
    case 'ok': return 'stated';
    case 'none_at_point': return 'none_at_point';
    case 'not_served': return 'not_served';
    case 'licence_restricted': return 'licence_restricted';
    case 'not_integrated': return 'not_integrated';
    case 'unavailable': return 'unavailable';
    default: return 'unavailable';
  }
}

export interface PlanningOverrides {
  zoningCode?: unknown;
  zoningDescription?: unknown;
  permittedUses?: unknown;
  developmentPotential?: unknown;
  zoningOverlays?: unknown;
  minimumLotSize?: unknown;
  maximumHeight?: unknown;
  floorSpaceRatio?: unknown;
}

export interface PlanningFactsInput {
  /** `enhancedData.planningData` — the service's answer, or absent. */
  planningData?: unknown;
  /** The audited manual overrides, which outrank a layer (rule 2). */
  overrides?: PlanningOverrides;
}

/** `R2 Low Density Residential`, from whichever parts the reading carries. */
function zoneLine(code: string | null, label: string | null): string | null {
  const parts = [code, label].filter((p): p is string => !!p);
  return parts.length ? [...new Set(parts)].join(' — ') : null;
}

/** An override's own words, tidied but never reinterpreted. */
function overrideText(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  // Stored overrides are slug-shaped (`dual_occupancy`). Spacing them is
  // presentation; nothing here changes which control was recorded.
  return s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

const OPERATOR_NOTE =
  'Recorded by an operator against this report rather than read from a published layer.';

function operatorCell(label: string, value: string, retrievedAt: string | null): PlanningCell {
  return {
    label, value, status: 'operator_stated', note: OPERATOR_NOTE,
    source: 'Operator override recorded against this report',
    sourceUrl: null, licence: null, effectiveDate: null,
    retrievedAt, standing: null,
  };
}

/**
 * Build the planning record a report may state, from the enrichment and the
 * operator's own overrides.
 *
 * Nothing here fetches, and nothing here invents: every cell either carries a
 * value with its provenance or names which absence it is.
 */
export function buildPlanningFacts(input: PlanningFactsInput): PlanningFacts {
  const data = isRecord(input.planningData) ? input.planningData : null;
  const o = input.overrides ?? {};
  const retrievedAt = data ? str(data.fetchedAt) : null;

  const jurisdiction = (str(data?.jurisdiction) as PlanningJurisdiction | null) ?? null;
  const portal = jurisdiction ? PLANNING_VERIFICATION_URL[jurisdiction] ?? null : null;

  const zoningRaw = isRecord(data?.zoning) ? data!.zoning : null;
  const parcelRaw = isRecord(data?.parcel) ? data!.parcel : null;
  const instrumentsRaw = isRecord(data?.developmentInstruments) ? data!.developmentInstruments : null;
  const activityRaw = isRecord(data?.developmentActivity) ? data!.developmentActivity : null;

  // ── the zone ──────────────────────────────────────────────────────────────
  // The override wins (rule 2); otherwise the layer's own words, or the named
  // absence the service already worked out.
  const overrideZone = zoneLine(overrideText(o.zoningCode), overrideText(o.zoningDescription));
  let zoning: PlanningCell;
  if (overrideZone) {
    zoning = operatorCell('Zone', overrideZone, retrievedAt);
  } else if (!data) {
    zoning = absent('Zone', 'unavailable',
      'The planning enrichment did not run for this report, so no zone was retrieved.');
  } else if (statusOf(zoningRaw?.status) === 'stated') {
    const line = zoneLine(str(zoningRaw?.zoneCode), str(zoningRaw?.zoneLabel));
    zoning = {
      label: 'Zone',
      value: line,
      status: line ? 'stated' : 'unavailable',
      note: line ? null : 'The layer answered without a zone code.',
      source: str(zoningRaw?.source),
      sourceUrl: portal,
      licence: str(zoningRaw?.licence),
      effectiveDate: str(zoningRaw?.currencyDate),
      retrievedAt,
      // A published scheme layer is the instrument in force. A draft
      // amendment is not published on these layers at all, which is exactly
      // why the draft section below says nothing rather than guessing.
      standing: line ? 'adopted' : null,
    };
  } else {
    zoning = absent('Zone', statusOf(zoningRaw?.status),
      str(zoningRaw?.note) ?? 'No zone was returned for this point.');
  }

  // ── the constraint register ───────────────────────────────────────────────
  // Every control, overlay and hazard the state registers returned at this
  // point. Until 17 Sep 2026 this module carried one sentence — "overlay
  // mapping ... is not retrieved by this platform" — which was true of the
  // code and false of the world: NSW answers height, floor space ratio,
  // minimum lot size, heritage, bushfire, flood, landslide, acid sulfate
  // soils and nine more in three calls; Victoria's overlays sit on the same
  // WFS endpoint as its zones; Queensland answers its regional plan and
  // priority living areas; Tasmania answers both overlay layers. All measured
  // from the production egress, all open-licensed, none needing a key.
  const rawConstraints = Array.isArray(data?.constraints) ? data!.constraints as unknown[] : [];
  const constraints: PlanningConstraintReading[] = rawConstraints.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const label = str(raw.label);
    const family = str(raw.family);
    if (!label || !family) return [];
    return [{
      family: family as ConstraintFamily,
      kind: (str(raw.kind) ?? 'context') as ConstraintKind,
      label,
      code: str(raw.code),
      value: str(raw.value),
      instrument: str(raw.instrument),
      clause: str(raw.clause),
      currencyDate: str(raw.currencyDate),
      detail: str(raw.detail),
      // Absent on every enrichment stored before these two fields existed, and
      // that is the ordinary state rather than an error: the Infrastructure
      // Outlook prints an em dash for each, which is what a designation with
      // no published standing or region should read as anyway.
      standingLabel: str(raw.standingLabel),
      region: str(raw.region),
      source: str(raw.source) ?? 'planning register',
      licence: str(raw.licence) ?? 'unstated',
    }];
  });
  const constraintsAsked = (Array.isArray(data?.constraintsAsked)
    ? (data!.constraintsAsked as unknown[]).map(str).filter((v): v is string => !!v)
    : []) as ConstraintFamily[];
  const registersRaw = isRecord(data?.constraintRegisters) ? data!.constraintRegisters : null;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : [];
  const constraintRegisters = {
    answered: strList(registersRaw?.answered),
    unavailable: strList(registersRaw?.unavailable),
  };

  // ── overlays ──────────────────────────────────────────────────────────────
  // An operator's recorded overlay still outranks a layer (rule 2). Below
  // that, the cell states what the registers found — and an EMPTY finding is
  // only a finding where a register answered, which is what
  // `constraintRegisters.answered` decides. With no register answered the
  // cell reads exactly as it did before: nothing was looked up.
  const overlayReadings = constraints.filter((c) => c.kind !== 'context');
  /*
   * The strategic designations are counted separately and NAMED in the same
   * cell, because the table under this row lists them.
   *
   * Excluding them from the count is right — a regional plan does not control
   * what is built on one lot, and counting it as a "mapped control" would say
   * it does. But the first render of 262 Pallas Street read
   * "1 mapped control applies at this point" directly above a three-row table,
   * and a reader resolves that contradiction by distrusting one of them.
   */
  const contextReadings = constraints.filter((c) => c.kind === 'context');
  const designationTail = contextReadings.length
    ? `, plus ${contextReadings.length} strategic designation${contextReadings.length === 1 ? '' : 's'}`
    : '';
  const overrideOverlays = overrideText(o.zoningOverlays);
  const overlays = overrideOverlays
    ? operatorCell('Overlays', overrideOverlays, retrievedAt)
    : overlayReadings.length
      ? {
        label: 'Overlays, controls and hazards',
        value: `${overlayReadings.length} mapped ${overlayReadings.length === 1 ? 'control applies' : 'controls apply'} at this point${designationTail}`,
        status: 'stated' as const,
        note: null,
        source: constraintRegisters.answered.join('; ') || null,
        sourceUrl: portal,
        licence: [...new Set(overlayReadings.map((c) => c.licence))].join(', ') || null,
        effectiveDate: overlayReadings.map((c) => c.currencyDate).filter(Boolean).sort().at(-1) ?? null,
        retrievedAt,
        standing: 'adopted' as const,
      }
      : constraintRegisters.answered.length
        ? absent('Overlays, controls and hazards', 'none_at_point',
          `${constraintRegisters.answered.length} register${constraintRegisters.answered.length === 1 ? '' : 's'} `
          + `answered at this coordinate and returned no mapped control`
          + (contextReadings.length
            ? `${designationTail}, listed below. `
            : '. ')
          + (constraintsAsked.length
            ? `What was checked: ${constraintsAsked.map((f) => CONSTRAINT_FAMILY_LABEL[f] ?? f).join(', ')}. `
            : '')
          + 'Anything outside that list was not checked and is not stated either way.')
        : absent('Overlays, controls and hazards', 'not_integrated',
          (jurisdiction ? NO_STATE_LAYER_NOTE[jurisdiction] : null)
          ?? 'No overlay register was reached for this point. '
          + 'Nothing here states that the property carries no overlay — only that none was looked up.');

  // ── the numeric controls ──────────────────────────────────────────────────
  // Minimum lot size, height and floor space ratio: the three the old
  // template printed as "Refer to LEP" beside a model free to invent them,
  // and the three the legacy long-form report invented three different
  // answers for on one lot.
  //
  // The order is an ORDER and not a fallback chain with a default: an audited
  // operator figure outranks a layer (rule 2, and it says so on the page);
  // below it a RETRIEVED figure now stands where NSW publishes one; below
  // that the cell still states the absence and carries no number.
  const controlSpecs: Array<{
    label: string; value: unknown; suffix: string; family: ConstraintFamily;
  }> = [
    { label: 'Minimum lot size', value: o.minimumLotSize, suffix: ' m²', family: 'minimumLotSize' },
    { label: 'Maximum building height', value: o.maximumHeight, suffix: ' m', family: 'height' },
    { label: 'Floor space ratio', value: o.floorSpaceRatio, suffix: ':1', family: 'floorSpaceRatio' },
  ];
  const controls = controlSpecs.map(({ label, value, suffix, family }) => {
    const stated = num(value) ?? (str(value) ? Number(str(value)) : null);
    if (stated !== null && Number.isFinite(stated)) {
      return operatorCell(label, `${stated}${suffix}`, retrievedAt);
    }
    const retrieved = constraints.find((c) => c.family === family && c.value);
    if (retrieved) {
      return {
        label,
        value: retrieved.value,
        status: 'stated' as const,
        note: retrieved.clause ? `${retrieved.instrument ?? 'Planning instrument'} ${retrieved.clause}` : null,
        source: retrieved.source,
        sourceUrl: portal,
        licence: retrieved.licence,
        effectiveDate: retrieved.currencyDate,
        retrievedAt,
        standing: 'adopted' as const,
      };
    }
    // Asked and not answered is a different sentence from never asked, and a
    // reader acts on them differently: the first sends them to the certificate
    // for a figure the layer genuinely does not carry, the second tells them
    // this platform does not read that jurisdiction at all.
    const asked = constraintsAsked.includes(family);
    return absent(label, 'not_published',
      asked
        ? 'The register that carries this control answered for this point and published no figure. '
        + 'Read it from the planning certificate.'
        : `Set by the ${jurisdiction === 'QLD' ? 'council planning scheme' : 'planning instrument'} and not published on any layer this platform reads. `
        + 'No figure is stated here; read it from the scheme or the certificate.');
  });

  // ── state development instruments ─────────────────────────────────────────
  const instrumentList: PlanningInstrumentFact[] = Array.isArray(instrumentsRaw?.instruments)
    ? (instrumentsRaw!.instruments as unknown[]).flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const name = str(raw.name);
      if (!name) return [];
      return [{
        kind: str(raw.kind) ?? 'instrument',
        name,
        status: str(raw.status),
        gazetted: str(raw.gazetted),
        detail: str(raw.detail),
      }];
    })
    : [];
  const instruments = !data
    ? absent('State development instruments', 'unavailable',
      'The planning enrichment did not run for this report.')
    : statusOf(instrumentsRaw?.status) === 'stated'
      ? {
        label: 'State development instruments',
        value: `${instrumentList.length} declared instrument${instrumentList.length === 1 ? '' : 's'} cover this point`,
        status: 'stated' as const,
        note: null,
        source: str(instrumentsRaw?.source),
        sourceUrl: portal,
        licence: str(instrumentsRaw?.licence),
        effectiveDate: null,
        retrievedAt,
        standing: 'adopted' as const,
      }
      : absent('State development instruments', statusOf(instrumentsRaw?.status),
        str(instrumentsRaw?.note) ?? 'No state development instrument reading for this point.');

  // ── development activity ──────────────────────────────────────────────────
  const activitySummary = isRecord(activityRaw?.summary)
    ? activityRaw!.summary as Record<string, unknown>
    : null;
  const developmentActivity = !data
    ? absent('Development applications', 'unavailable',
      'The planning enrichment did not run for this report.')
    : statusOf(activityRaw?.status) === 'stated' && activitySummary
      ? {
        label: 'Development applications',
        /*
         * ## The fabricated zero
         *
         * This read `summary.headline` and `summary.total`, and `DaSummary`
         * has neither — its fields are `totalInPeriod`, `rowsRead`,
         * `newApplications`, `amendments`, `unclassified`, `periodFrom` and
         * `periodTo`. Both reads were `undefined`, so the `?? 0` fell
         * through and the planning table printed **"0 applications in the
         * register window"** on the Kellyville report, directly above an
         * infrastructure block that said 171 and 278 applications for the
         * same council over the same six months. One page, two numbers, one
         * register: the reader cannot tell which is wrong, so both are
         * worthless.
         *
         * It is the class `caseTenant.ts` documents — naming a field the
         * object does not have and taking the fallback as an answer — and
         * the fallback is what made it invisible: a real zero and a read
         * that missed look identical.
         *
         * Counted from the same `newApplications` / `amendments` totals the
         * infrastructure block reads, so the two cannot disagree, and the
         * two classes are never added (see `classifyApplicationType`).
         */
        value: daActivityLine(activitySummary),
        status: 'stated' as const,
        note: null,
        source: str(activityRaw?.source),
        sourceUrl: portal,
        licence: str(activityRaw?.licence),
        effectiveDate: str(activitySummary.periodTo),
        retrievedAt,
        standing: null,
      }
      : absent('Development applications', statusOf(activityRaw?.status),
        str(activityRaw?.note) ?? 'No development-application register reading for this jurisdiction.');

  const parcelStated = statusOf(parcelRaw?.status) === 'stated';
  const council = parcelStated ? str(parcelRaw?.lga) : (zoning.status === 'stated' ? str(zoningRaw?.lga) : null);

  const cells = [zoning, overlays, ...controls, instruments, developmentActivity];
  return {
    jurisdiction,
    council,
    locality: parcelStated ? str(parcelRaw?.locality) : null,
    lotPlan: parcelStated ? str(parcelRaw?.lotPlan) : null,
    // A parcel area of zero is the layer declining to publish one, never a
    // lot with no area: `Parcel area: 0 m² (surveyed)` printed on 262 Pallas
    // Street, which is a surveyed measurement of nothing. `num()` admits it
    // because zero is a finite number, so the guard is on the VALUE.
    parcelAreaSqm: parcelStated ? (num(parcelRaw?.area) || null) : null,
    parcelAreaBasis: parcelStated
      ? (str(parcelRaw?.areaBasis) === 'surveyed' ? 'surveyed' : str(parcelRaw?.areaBasis) === 'computed' ? 'computed' : null)
      : null,
    zoning,
    zoneFamily: zoning.status === 'stated' ? str(zoningRaw?.zoneFamily) : null,
    overlays,
    constraints,
    constraintsAsked,
    constraintRegisters,
    controls,
    instruments,
    instrumentList,
    developmentActivity,
    developmentActivitySummary: activitySummary,
    verification: str(data?.verification)
      ?? (jurisdiction
        ? `A spatial layer is indicative; what settles the question is ${VERIFICATION_INSTRUMENT[jurisdiction]}.`
        : 'A spatial layer is indicative; verify with the relevant council or planning authority.'),
    retrievedAt,
    anyStated: cells.some((c) => c.status === 'stated' || c.status === 'operator_stated'),
    enrichmentMissing: !data,
  };
}

// ---------------------------------------------------------------------------
// Rendering

/**
 * What the development-application register said, in one line.
 *
 * New proposals and amendments are counted separately and never added — an
 * amendment restates the development it modifies, so a combined count is a
 * number about nothing. Where the walk read fewer rows than the register
 * states, the line says so rather than presenting a sample as the whole.
 */
export function daActivityLine(summary: Record<string, unknown>): string {
  const rowsOf = (key: string): number | null => {
    const t = summary[key];
    return isRecord(t) ? num(t['rows']) : null;
  };
  const fresh = rowsOf('newApplications');
  const amended = rowsOf('amendments');
  const other = rowsOf('unclassified');
  if (fresh === null && amended === null) {
    return 'The register answered, and stated no application counts.';
  }
  const bits = [
    `${(fresh ?? 0).toLocaleString('en-AU')} new application${(fresh ?? 0) === 1 ? '' : 's'}`,
    `${(amended ?? 0).toLocaleString('en-AU')} amendment${(amended ?? 0) === 1 ? '' : 's'} of approved developments`,
  ];
  if (other && other > 0) bits.push(`${other.toLocaleString('en-AU')} of an unrecognised type`);
  const from = auDate(str(summary['periodFrom']));
  const to = auDate(str(summary['periodTo']));
  const window = from && to ? `, lodged ${from} to ${to}` : '';
  const read = num(summary['rowsRead']);
  const total = num(summary['totalInPeriod']);
  const sample = read !== null && total !== null && read < total
    ? ` (read ${read.toLocaleString('en-AU')} of the ${total.toLocaleString('en-AU')} the register states)`
    : '';
  return `${bits.join(', ')}${window}${sample}`;
}

const INSTRUMENT_LABEL: Record<string, string> = {
  priority_development_area: 'Priority development area',
  state_development_area: 'State development area',
  coordinated_project: 'Coordinated project',
  infrastructure_designation: 'Infrastructure designation',
};

/** `1 Jan 2026` from an ISO date, or the string back if it is not one. */
function auDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** The evidence reference a row carries: publisher, currency, retrieval. */
function evidenceRef(cell: PlanningCell): string {
  if (cell.status === 'operator_stated') return 'Recorded by operator';
  if (!cell.source) return '—';
  const bits = [cell.source];
  const effective = auDate(cell.effectiveDate);
  if (effective) bits.push(`current at ${effective}`);
  const got = auDate(cell.retrievedAt);
  if (got) bits.push(`retrieved ${got}`);
  if (cell.licence) bits.push(cell.licence);
  return bits.join('; ');
}

/** What a row prints where it has no value: the absence, in words. */
function absenceText(cell: PlanningCell): string {
  return cell.note ?? 'Not retrieved.';
}

/**
 * The constraint register: what applies to this land, and what each one means.
 *
 * This is the part of the report the owner's review named — "the information
 * being incorporated does not provide the client with sufficiently solid,
 * meaningful or valuable information". A retrieval on its own does not: `HO544`
 * is a fact and not information. Each family present is explained ONCE, from
 * `CONTROL_GUIDE`, so two heritage rows share one explanation and a register of
 * nine controls does not become nine essays.
 *
 * The explanation is about the CONTROL and never about the property, which is
 * what lets it be written down in advance and still be true. Everything that is
 * about the property — whether it applies, under which instrument, to what
 * figure, current at what date — comes from the reading beside it.
 */
/**
 * The layers that were ASKED of a register that answered and matched nothing.
 *
 * One implementation, because it is stated twice: on the page as "Checked and
 * not mapped at this coordinate", and in the rules as the closed list of
 * absences the prose is permitted to repeat. Two copies of "which layers came
 * back clear" is how a rule comes to permit a sentence the evidence does not.
 *
 * It is deliberately NOT the complement of `constraints` alone: a family is in
 * this list only because it appears in `constraintsAsked`, which the service
 * populates from the registers that answered. A layer nobody asked, and a
 * layer whose register was unreachable, are both absent from it.
 */
export function checkedAndNotMapped(facts: PlanningFacts): string[] {
  const found = new Set(facts.constraints.map((c) => c.family));
  return facts.constraintsAsked
    .filter((f) => !found.has(f))
    .map((f) => CONSTRAINT_FAMILY_LABEL[f] ?? f);
}

export function renderConstraintRegister(facts: PlanningFacts): string {
  const lines: string[] = [];
  const readings = facts.constraints;

  if (readings.length) {
    lines.push('**What is mapped over this land**', '');
    lines.push('| Kind | What the register returned | Instrument | Current at |');
    lines.push('|---|---|---|---|');
    for (const c of readings) {
      /**
       * A publisher's index is not a reading.
       *
       * `code` is the LEP map's own band letter — `K` on The Hills Height of
       * Buildings map, `Q` on its Minimum Lot Size map. It identifies a BAND
       * in the publisher's lookup table, and the metres or square metres that
       * band stands for are already in `value`. Printed beside them it added
       * nothing a reader could use and read as an artefact:
       * `Height of Buildings Map · (K) · 10 m`, five times across one
       * delivered Compass. The letter stays in the record — it is how the
       * reading is checked against the map — and leaves the client's page.
       *
       * `detail` is kept, because it is the band's own RANGE (`700-749`) and
       * that is a fact about what the control admits rather than an index
       * into a table.
       */
      const found = [c.label, c.value, c.detail].filter(Boolean).join(' · ');
      /**
       * `cl. Clause 4.3` — the prefix was added to a value that already
       * carried it. The guard compared `clause` against `code` (`4.3` against
       * `K`), which is never equal and so never fired. Compare against what
       * is actually being prefixed.
       */
      const clause = typeof c.clause === 'string' ? c.clause.trim() : '';
      const citedClause = clause === '' || clause === c.code
        ? null
        : /^(cl\.?|clause|s\.?|section)\b/i.test(clause) ? clause : `cl. ${clause}`;
      const instrument = [c.instrument, citedClause].filter(Boolean).join(', ') || '—';
      lines.push(`| ${KIND_LABEL[c.kind]} | ${found} | ${instrument} | ${auDate(c.currencyDate) ?? '—'} |`);
    }
    lines.push('');

    // One explanation per family present, in the order the table introduced
    // them, so a reader meets each control where they first saw it.
    const seen = new Set<ConstraintFamily>();
    for (const c of readings) {
      if (seen.has(c.family)) continue;
      seen.add(c.family);
      const guide = CONTROL_GUIDE[c.family] ?? CONTROL_GUIDE.other;
      lines.push(`**${capitalise(CONSTRAINT_FAMILY_LABEL[c.family] ?? c.family)}.** ${guide.what} ${guide.effect}`);
      lines.push('');
      lines.push(`*Before you proceed:* ${guide.verify}`);
      lines.push('');
    }

    const sources = [...new Set(readings.map((c) => `${c.source}${c.licence ? ` (${c.licence})` : ''}`))];
    lines.push(`Retrieved from ${sources.join('; ')}${facts.retrievedAt ? ` on ${auDate(facts.retrievedAt)}` : ''}.`, '');
  }

  // Coverage. A short register is only readable beside what was searched —
  // the rule the sanctions register and the PEP index both answer to, and the
  // reason an empty answer here is never printed on its own.
  if (facts.constraintsAsked.length) {
    const clear = checkedAndNotMapped(facts);
    if (clear.length) {
      lines.push(
        `**Checked and not mapped at this coordinate:** ${clear.join(', ')}. `
        + 'Each of these was asked of a register that answered, and no feature covers this point. '
        + 'A mapped layer is indicative at the scale it is published; it is not a survey of the lot.',
        '',
      );
    }
  } else if (!readings.length) {
    lines.push(
      (facts.jurisdiction ? NO_STATE_LAYER_NOTE[facts.jurisdiction] : null)
      ?? 'No overlay or hazard register was reached for this point, so nothing here says whether a control applies.',
      '',
    );
  }

  if (facts.constraintRegisters.unavailable.length) {
    lines.push(
      `**Not reached:** ${facts.constraintRegisters.unavailable.join('; ')}. `
      + 'These registers could not be read for this report, so their subject matter is unchecked rather than clear.',
      '',
    );
  }

  if (facts.jurisdiction) {
    lines.push(
      `**What settles every line above:** ${VERIFICATION_DOCUMENT[facts.jurisdiction]} `
      + 'A spatial layer is published at a scale; a certificate is issued for a lot.',
      '',
    );
  }

  return lines.join('\n').trimEnd();
}

/** How a reader triages the register before reading any of it. */
const KIND_LABEL: Record<ConstraintKind, string> = {
  hazard: 'Hazard',
  control: 'Development control',
  protection: 'Protected value',
  context: 'Strategic context',
};

const capitalise = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The planning table a client reads, and the sentences that qualify it.
 *
 * Composed here rather than asked of a model, because every figure in it is
 * either retrieved or absent and neither is a writing task. The prose the
 * model does write is constrained by `planningFactBlocks` below.
 */
export function renderPlanningControls(facts: PlanningFacts): string {
  const lines: string[] = [];

  const where = [
    facts.locality ? `**Locality:** ${facts.locality}` : null,
    facts.council ? `**Local government:** ${facts.council}` : null,
    facts.jurisdiction ? `**Jurisdiction:** ${facts.jurisdiction}` : null,
    facts.lotPlan ? `**Lot / plan:** ${facts.lotPlan}` : null,
    facts.parcelAreaSqm !== null
      ? `**Parcel area:** ${facts.parcelAreaSqm.toLocaleString('en-AU')} m²${facts.parcelAreaBasis ? ` (${facts.parcelAreaBasis})` : ''}`
      : null,
  ].filter((l): l is string => l !== null);
  if (where.length) lines.push(where.join(' · '), '');

  lines.push('| Control | Reading | Standing | Evidence |');
  lines.push('|---|---|---|---|');
  for (const cell of [facts.zoning, facts.overlays, ...facts.controls]) {
    const reading = cell.value ?? absenceText(cell);
    const standing = cell.status === 'operator_stated'
      ? 'Operator record'
      : cell.standing === 'adopted' ? 'Adopted'
        : cell.standing === 'draft' ? 'Draft — not in force'
          : '—';
    lines.push(`| ${cell.label} | ${reading} | ${standing} | ${evidenceRef(cell)} |`);
  }
  lines.push('');

  // The constraint register, and what each control it found actually means.
  // It sits directly under the summary table because a reader who has just
  // been told a heritage overlay applies needs to know what one obliges
  // before they read anything else — not in an appendix.
  const register = renderConstraintRegister(facts);
  if (register.trim()) lines.push(register, '');

  if (facts.instrumentList.length) {
    lines.push('**State development instruments covering this point:**', '');
    lines.push('| Instrument | Name | Status | Gazetted |');
    lines.push('|---|---|---|---|');
    for (const i of facts.instrumentList) {
      lines.push(`| ${INSTRUMENT_LABEL[i.kind] ?? i.kind} | ${i.name} | ${i.status ?? '—'} | ${auDate(i.gazetted) ?? '—'} |`);
    }
    lines.push('', `Source: ${facts.instruments.source ?? 'state planning layers'}${facts.instruments.licence ? ` (${facts.instruments.licence})` : ''}.`, '');
  } else {
    lines.push(`**State development instruments:** ${absenceText(facts.instruments)}`, '');
  }

  lines.push(
    facts.developmentActivity.value
      ? `**Development applications:** ${facts.developmentActivity.value} — ${evidenceRef(facts.developmentActivity)}.`
      : `**Development applications:** ${absenceText(facts.developmentActivity)}`,
    '',
  );

  // Rules 3 and 6, said on the page rather than left to a reader to infer.
  lines.push(
    `**What this is.** These readings are desktop research against the jurisdiction's published spatial layers, `
    + `retrieved automatically at the property's verified coordinate. They are not a planning certificate and do not `
    + `substitute for one. ${facts.verification}`,
  );
  lines.push('');
  lines.push(
    '**What a zone is not.** A zone that admits a use is not consent for it. Any development potential described here '
    + 'is conditional on assessment against the scheme and remains subject to approval; nothing in this report is an '
    + 'approval, a pre-lodgement view, or evidence that one would be granted.',
  );
  if (facts.zoning.status !== 'stated' && facts.zoning.status !== 'operator_stated') {
    lines.push('');
    lines.push(
      '**No zone was retrieved for this property.** The rows above say which kind of absence each one is. '
      + 'A blank is not a finding that the control does not apply.',
    );
  }
  return lines.join('\n');
}

/**
 * The rules the prose beside the table must obey.
 *
 * Deliberately NOT a second copy of the readings: `planningStatBlocks`
 * already puts the measured cells in the prompt and `renderPlanningControls`
 * hands over the table itself, so repeating them here would give a model
 * three versions of one fact to choose between. What was missing was the
 * prohibitions — the old template offered `[XX]%` site coverage, `[X]m`
 * setbacks and "typically 450m²" with nothing to fill them from, and a model
 * asked for a control it has not been given supplies a plausible one.
 */
export function planningFactBlocks(facts: PlanningFacts): string {
  if (facts.enrichmentMissing) {
    return 'PLANNING RULES FOR THE WHOLE REPORT — no planning enrichment ran. State in one sentence that '
      + 'zoning and planning controls were not retrieved and must be confirmed with the local planning '
      + 'authority. Do NOT print a zoning table, a control table, a minimum lot size, a height limit, a '
      + 'floor space ratio, a setback, a site coverage figure or an overlay finding. Do NOT name a planning '
      + 'instrument. This holds in every section, and a figure found by live web search is still a figure '
      + 'this report did not retrieve.';
  }
  /*
   * Rule 4a — the one absence the prose MAY repeat, and only with its
   * provenance.
   *
   * Rule 4 forbade writing that the property is not flood or bushfire
   * affected, full stop. That was right when it was written and this module's
   * own header had already recorded why it became wrong: *"we asked about
   * bushfire and flood and neither applies" is a finding, and "nobody asked"
   * is not.* Since §8 the evidence tells the two apart —
   * `constraintsAsked` names what the answering registers were able to answer,
   * and `constraintRegisters.unavailable` names what could not be reached — so
   * a blanket prohibition now forbids the one statement the register actually
   * supports.
   *
   * The Kellyville Compass shows what that costs. Twenty-one layers were asked
   * of three NSW registers, all three answered, none was unavailable, and
   * bushfire, flood and landslip matched nothing. The page said so precisely.
   * The prose, forbidden to, wrote it anyway and wrote it worse:
   * `✓ No bushfire or flood overlays mapped at this coordinate (verification
   * still required)` — a tick, no register named, no currency date, no scale
   * caveat. A prohibition with no permitted form is one a model routes around;
   * the Compass document contract records the same lesson.
   *
   * So the permitted form is given, and the list is CLOSED and generated from
   * the same `checkedAndNotMapped` the page prints. A layer that is not in it
   * stays under rule 4.
   */
  const clear = checkedAndNotMapped(facts);
  const clearLayerRule = clear.length
    ? '4a. Exactly these layers were asked of a register that answered and matched nothing at this coordinate: '
      + `${clear.join(', ')}. You may report ONE of those as not mapped, and only in a sentence that names the `
      + `register (${facts.constraintRegisters.answered.join('; ') || 'the register named in the table'}), says it `
      + 'is indicative at the scale it is published rather than a survey of the lot, and keeps the certificate as '
      + 'what settles it. Do NOT draw it as a tick, a clearance, a reassurance or a strength, do not rate a risk '
      + 'from it (see the risk table\u2019s own rule), and do not name a layer outside that list — anything else '
      + 'falls under rule 4.'
    : '4a. No layer was asked of an answering register and found clear at this coordinate, so there is no absence '
      + 'you may report at all. Rule 4 governs every one of them.';

  const instrumentRule = facts.jurisdiction === 'NSW'
    ? '3. This property is in New South Wales, so the Local Environmental Plan, the Development Control Plan and '
      + 'the s10.7 certificate are the right instruments to name.'
    : '3. This property is in ' + (facts.jurisdiction ?? 'a jurisdiction the layers did not resolve')
      + '. Do NOT mention a Local Environmental Plan, a Development Control Plan or a s10.7 planning certificate — '
      + 'those are New South Wales instruments and do not exist here. Name only the instrument in the verification '
      + 'sentence.';
  return [
    'PLANNING RULES FOR THE WHOLE REPORT — they apply in every section, including risk registers, '
    + 'checklists, summaries and verdicts, and they override any example elsewhere in this prompt AND '
    + 'anything a live web search returns. A portal, a listing site or a news page is not a retrieval: '
    + 'if a control is not in the table below, this report did not retrieve it.',
    '1. The planning controls table above is supplied complete. Reproduce it EXACTLY as given. Do not add a row, '
    + 'a column, a figure or a bracketed placeholder to it.',
    '2. Do NOT state a minimum lot size, maximum building height, floor space ratio, site coverage, setback, '
    + 'landscaping percentage, parking minimum or overlay finding that is not in the table. There is no typical '
    + 'value and no default. If it is not in the table it was not retrieved, and the correct sentence says so.',
    instrumentRule,
    '4. A layer this report did not reach supports nothing. Never write that no overlay applies, that the property '
    + 'is not heritage listed, or that it is not flood or bushfire affected on the authority of a listing portal, a '
    + 'property data site, a live web search or a register that was not asked — not in prose, not in a risk register '
    + 'row, and not in a checklist. Those report what they hold, not what the council scheme maps.',
    clearLayerRule,
    '5. A zone that admits a use is not approval for it. Describe any development potential as conditional and subject '
    + 'to assessment, and never quantify an uplift.',
    '6. Say plainly that this is desktop research and that the verification instrument is what settles it.',
    /*
     * Rule 4 closes the STATEMENT; this closes the RATING.
     *
     * On 262 Pallas Street the model obeyed rule 4 exactly where it was
     * written — the flood and bushfire rows read "Moderate", chipped
     * "Unverified — no council flood overlay … was retrieved" — and then rated
     * a row Low from the same kind of absence one line further down:
     * "Environmental nuisance | **Low** | … | Unverified — no acoustic or
     * industrial-use overlay was retrieved, streetscape character is INFERRED
     * from Maryborough's low-density residential pattern." Nothing there is a
     * statement that no overlay applies, so rule 4 admitted it; the exposure
     * rating is still drawn from having looked and not found, which is the
     * same error one level up.
     */
    '7. An absence may NOT be rated. Where a risk register, a scorecard, a SWOT table or any other rating has a '
    + 'row whose evidence is something this report did not retrieve, the rating cell reads "Not assessed" and '
    + 'the row says what has to be obtained to settle it. Never rate it Low, Minimal, Limited, Negligible or '
    + 'Favourable, and never '
    + 'file it as a strength: not retrieving a control is not evidence that the control is absent or benign. An '
    + 'inference from the area\u2019s general character is not a retrieval either, and may not carry a rating.',
    '8. An evidence, confidence or verification note describes the RETRIEVAL and never the conclusion beside it. '
    + '"Verified" may be written of a table reading and may NOT be written of a rating, an outlook or a '
    + 'recommendation drawn from it.',
  ].join('\n');
}
