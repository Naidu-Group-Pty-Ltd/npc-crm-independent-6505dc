/**
 * The national supply floor — ABS Building Approvals, by area and month.
 *
 * ## Why this register exists
 *
 * `REPORT_PRESENTATION_PROGRAMME.md` W3 states the rule: *every property in
 * Australia gets a development reading; the grain is the publisher's; the
 * scorer prices the grain; coverage travels with the answer.* Development
 * evidence today is one state's development-application register — the
 * Queensland walk that produced 1,410 dwellings and $1.18bn — and nothing at
 * all for the other seven jurisdictions. Meanwhile the statewide prompt
 * carries `**Supply Pipeline Risk:** [New housing supply vs demand balance]`,
 * a bracketed slot with no register behind it, which is the shape that put
 * `450 m²`, `8.5 m` and `0.5:1` into a Queensland property's document under
 * New South Wales instrument names.
 *
 * ABS Building Approvals is the one free, keyless, national, sub-state,
 * monthly measure of approved dwelling supply, under CC BY 4.0. It is the
 * floor beneath every jurisdiction, exactly as `RES_DWELL_ST` is the floor
 * beneath every price series.
 *
 * ## The dataflow is DISCOVERED, never guessed
 *
 * `absResDwell.pure.ts` hardcodes `ABS,RES_DWELL_ST,1.0.0`, and that is a
 * liability rather than a model: the version is part of the identifier, the
 * ABS reissues it, and a stale constant fetches a 404 that reads exactly like
 * an outage. It is also a constant nobody in this repository can verify
 * offline — this session's egress reaches neither `data.api.abs.gov.au` nor
 * `www.abs.gov.au`, and **an identifier typed from memory is the mistyped
 * Airtable column again**: invisible, because an absent flow and an empty
 * flow fail the same way.
 *
 * So the loader reads the ABS's own dataflow catalogue, selects by NAME
 * against a declared pattern, and prefers the FINEST grain the catalogue
 * offers — because the scorer prices the grain. Three refusals, each naming
 * what it saw: a catalogue it cannot parse, a catalogue in which nothing
 * matches, and a tie inside the chosen grain. It never picks one of two.
 *
 * An operator may name a flow explicitly (`resolveBuildingApprovalsFlow`'s
 * `override`), and that override is **checked against the catalogue** rather
 * than trusted — a typed identifier that is not published is refused with the
 * near misses named, so a typo cannot present as an outage.
 *
 * ## Four rules
 *
 * **An approval is not a completion.** The ABS counts approvals; a dwelling
 * approved is not commenced, and a dwelling commenced is not finished. This
 * is `infrastructureEvidence`'s rule — an approval is never read as funding,
 * funding never as a start on site — and `APPROVALS_ARE_NOT_COMPLETIONS`
 * carries it into the prose that quotes any figure from here.
 *
 * **One series estimate, or the count is three times itself.** The ABS
 * publishes Original, Seasonally Adjusted and Trend estimates of the same
 * month on the same flow. Summing across them triples every figure while
 * every individual row is correct — the QLD rollup trap in another costume —
 * so where the download carries a series-type column, only Original is kept,
 * and where it does not, nothing is filtered and the fact is recorded.
 *
 * **Absent is never zero.** `parseNumberCell` is the one reader, so a
 * suppressed or unpublished month is `null` and never 0. A month genuinely
 * carrying no approvals is a real 0 and is kept, because a council that
 * approved nothing in August is a fact worth printing.
 *
 * **A short walk is a truncated download.** Australia has roughly 540 local
 * government areas; a download naming 40 of them is not a small country, it
 * is a truncated body, and the loader refuses rather than writing a register
 * that looks complete.
 */
import {
  type SalesRegisterState,
  parseNumberCell,
  salesAreaToken,
} from './salesRegister.pure.ts';
import { parseSdmxCsv } from './absResDwell.pure.ts';

export const ABS_BA_AGENCY = 'ABS';

/** The ABS's own catalogue of every flow it publishes. */
export const ABS_BA_DATAFLOW_CATALOGUE_URL =
  'https://data.api.abs.gov.au/rest/dataflow/ABS?detail=allstubs';

export const ABS_BA_PAGE_URL =
  'https://www.abs.gov.au/statistics/industry/building-and-construction/building-approvals-australia/latest-release';
export const ABS_BA_SOURCE_LABEL =
  'Australian Bureau of Statistics, Building Approvals, Australia — dwelling units approved';
export const ABS_BA_LICENCE = 'Creative Commons Attribution 4.0 International';
export const ABS_BA_LICENCE_URL = 'https://www.abs.gov.au/privacy-and-legals/copyright';

/** Said wherever a figure from this register is quoted. */
export const APPROVALS_ARE_NOT_COMPLETIONS =
  'An approval is a council decision, not a building. Approved dwellings are '
  + 'not commenced dwellings and commenced dwellings are not completed ones, and '
  + 'the ABS counts only the first.';

/** The grain a matched flow works at, finest first — the scorer prices it. */
export type ApprovalsAreaKind = 'sa2' | 'lga' | 'state' | 'national';

export interface GrainRule {
  areaKind: ApprovalsAreaKind;
  /** Matched against the flow's published NAME. */
  pattern: RegExp;
  /** `openDataSalesEvidence`'s geography ladder, applied to supply. */
  geographyScore: number;
}

/**
 * Finest first. A flow naming no grain at all is not admitted: an
 * unqualified "Building Approvals" is the national release, and calling it a
 * reading about a council area is the mistake this whole module exists to
 * avoid.
 */
export const ABS_BA_GRAIN_LADDER: readonly GrainRule[] = [
  { areaKind: 'sa2', pattern: /\bSA2\b|statistical areas? level 2/i, geographyScore: 80 },
  { areaKind: 'lga', pattern: /local government area|\bLGAs?\b/i, geographyScore: 55 },
  { areaKind: 'state', pattern: /states? and territor|by state\b/i, geographyScore: 30 },
];

/** The subject pattern. Both words, in either order, anywhere in the name. */
export const ABS_BA_NAME_PATTERN = /building\s+approvals?/i;

/**
 * The bounds a download has to satisfy to be believed.
 *
 * ## The ceilings are PER GRAIN, and that was measured the hard way
 *
 * The first version carried one ceiling — `maxValuePerAreaMonth:
 * 20_000_000_000` — written for a council area, and the liveness check
 * refused the Bureau's own LGA download on its first real run:
 *
 *     the ABS building-approvals value for Australia 2026-07 reads
 *     $22,314,955,000, outside 0–20,000,000,000 — refused
 *
 * Every fact in that refusal is correct and the conclusion was wrong. The
 * flow is *"Building Approvals by Local Government Area"* and its SA2
 * sibling is *"by SA2 **and above**"*: an ABS region download carries the
 * whole hierarchy — councils, states and Australia — in one body, and
 * $22.3bn of building approved nationally in a month is an ordinary
 * national figure. A bound written for one grain, applied to a body that
 * carries four, refuses the publisher for publishing correctly.
 *
 * So a row is bounded by ITS OWN grain, read from the publisher's area code
 * (`grainOfAreaCode`), and the ceilings are an order of magnitude above the
 * real figures because their job is catching a 1,000× shift — a changed
 * `UNIT_MULT`, a moved column — and never trimming a real outlier. A bound
 * that fires on a true figure is not a plausibility check, it is a filter
 * nobody asked for.
 */
export const ABS_BA_PLAUSIBILITY = {
  /** Minimum distinct areas AT THE REQUESTED GRAIN. ~540 LGAs, ~2,500 SA2s. */
  minAreas: { sa2: 800, lga: 200, state: 8, national: 1 } as Record<ApprovalsAreaKind, number>,
  /** Months. Two years is the shortest window a year-on-year reading needs. */
  minPeriods: 24,
  /**
   * Dwelling units approved in one area in one month, by that area's grain.
   * Australia approves roughly 15,000–20,000 a month; a state a few thousand.
   */
  maxUnitsPerAreaMonth: {
    sa2: 100_000, lga: 100_000, state: 500_000, national: 2_000_000,
  } as Record<ApprovalsAreaKind, number>,
  /**
   * Dollars of building approved in one area in one month, by grain. The
   * national figure measured on 2026-07 is $22.3bn; the ceiling is ten times
   * it, because this detects unit drift rather than ranking areas.
   */
  maxValuePerAreaMonth: {
    sa2: 20_000_000_000, lga: 20_000_000_000, state: 80_000_000_000, national: 250_000_000_000,
  } as Record<ApprovalsAreaKind, number>,
  /**
   * How many cells may exceed those ceilings before the download is refused
   * as drifted rather than having them dropped individually.
   *
   * A COUNT, not a share, and the difference is the whole of the rule. An
   * isolated publisher artefact is a count: it does not grow with the window.
   * Drift is a share: a changed `UNIT_MULT` or a moved column moves every
   * cell by the same factor, so the number it pushes over a ceiling grows
   * with the window.
   *
   * The first version of this rule was a 1% share, and for dwelling counts
   * that is too loose to catch the fault it exists for. Under a 1,000x drift
   * the SA2 ceiling of 100,000 is crossed only by cells whose TRUE figure is
   * above 100 units in a month, and that is a small minority of SA2 months —
   * so a drifted download could have been ACCEPTED with every other cell
   * written a thousand times too large, which is a wrong column reaching a
   * client's page. At a count of three, a 22,000-cell window refuses on the
   * fourth over-ceiling cell, which is what drift of any real extent
   * produces, while one or two publisher typos are dropped and named.
   *
   * The production parser before this refused on the FIRST such cell, which
   * is what turned one publisher value into a nine-hour livelock. Three is
   * the smallest allowance that ends the livelock for an isolated artefact
   * and the tightest that keeps drift detection close to what it was.
   */
  maxIsolatedImplausibleCells: 3,
} as const;

// ─── The dataflow catalogue ─────────────────────────────────────────────────

export interface DataflowEntry {
  agency: string;
  id: string;
  version: string;
  name: string;
}

/** `ABS,BUILDING_APPROVALS_LGA,1.0.0` — the form the data URL takes. */
export function dataflowRef(entry: DataflowEntry): string {
  return `${entry.agency},${entry.id},${entry.version}`;
}

const ATTR = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
};

/**
 * The ABS's dataflow catalogue, as `(agency, id, version, name)` records.
 *
 * Tolerant of both shapes the SDMX REST standard admits, because which one
 * answers depends on the `Accept` header the caller sent and on the
 * publisher's own defaults — and a loader that can read only the shape
 * somebody assumed is a loader that reports a publisher outage when the
 * publisher changed a content type.
 */
export function parseDataflowCatalogue(text: string): DataflowEntry[] {
  const body = text.trim();
  if (body === '') throw new Error('the ABS dataflow catalogue is empty — refused');
  if (body.startsWith('{')) return parseJsonCatalogue(body);
  return parseXmlCatalogue(body);
}

function parseJsonCatalogue(body: string): DataflowEntry[] {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    throw new Error('the ABS dataflow catalogue is not parseable JSON — refused');
  }
  const root = doc as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const flows = data.dataflows ?? root.dataflows;
  if (!Array.isArray(flows)) {
    throw new Error('the ABS dataflow catalogue JSON carries no "dataflows" array — refused');
  }
  const out: DataflowEntry[] = [];
  for (const raw of flows) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const id = typeof f.id === 'string' ? f.id : null;
    if (!id) continue;
    // SDMX-JSON writes either a plain `name` or a `names` map by locale.
    const names = (f.names ?? {}) as Record<string, unknown>;
    const name = typeof f.name === 'string'
      ? f.name
      : typeof names.en === 'string'
        ? names.en
        : Object.values(names).find((v): v is string => typeof v === 'string') ?? '';
    out.push({
      agency: typeof f.agencyID === 'string' ? f.agencyID : ABS_BA_AGENCY,
      id,
      version: typeof f.version === 'string' ? f.version : '1.0.0',
      name,
    });
  }
  return out;
}

function parseXmlCatalogue(body: string): DataflowEntry[] {
  const out: DataflowEntry[] = [];
  // Both the namespaced (`str:Dataflow`) and bare spellings, self-closing or not.
  const blocks = body.match(/<(?:\w+:)?Dataflow\b[\s\S]*?(?:\/>|<\/(?:\w+:)?Dataflow>)/g) ?? [];
  for (const block of blocks) {
    const open = /<(?:\w+:)?Dataflow\b[^>]*>/.exec(block)?.[0] ?? '';
    const id = ATTR(open, 'id');
    if (!id) continue;
    const nameMatch = /<(?:\w+:)?Name\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Name>/.exec(block);
    out.push({
      agency: ATTR(open, 'agencyID') ?? ABS_BA_AGENCY,
      id,
      version: ATTR(open, 'version') ?? '1.0.0',
      name: (nameMatch ? nameMatch[1] : '').replace(/\s+/g, ' ').trim(),
    });
  }
  if (out.length === 0) {
    throw new Error('the ABS dataflow catalogue names no dataflow (neither JSON nor SDMX-ML) — refused');
  }
  return out;
}

export interface FlowChoice {
  flow: DataflowEntry;
  areaKind: ApprovalsAreaKind;
  geographyScore: number;
  /** How the flow was arrived at, for the sync row. */
  how: 'discovered' | 'operator_override';
  /** Every flow whose name matched the subject, finest grain first. */
  candidates: Array<{ ref: string; name: string; areaKind: ApprovalsAreaKind | null }>;
  /** How many flows the catalogue held in total. */
  cataloguedFlows: number;
}

function grainOf(name: string): GrainRule | null {
  for (const rule of ABS_BA_GRAIN_LADDER) if (rule.pattern.test(name)) return rule;
  return null;
}

/** `ABS,SOMETHING,1.0.0` and nothing else. */
export const DATAFLOW_REF_SHAPE = /^[A-Za-z0-9_]+,[A-Za-z0-9_]+,\d+(?:\.\d+)*$/;

/**
 * Which flow this load reads, and why.
 *
 * With no override: the finest-grained flow whose name names building
 * approvals. With an override: that flow, but only once the catalogue is
 * shown to publish it — an identifier nobody publishes is refused with the
 * closest published names beside it, because "we asked for a flow that does
 * not exist" and "the publisher is down" must not read the same.
 */
export function resolveBuildingApprovalsFlow(
  catalogueText: string,
  override?: string | null,
): FlowChoice {
  const all = parseDataflowCatalogue(catalogueText);
  if (all.length === 0) throw new Error('the ABS dataflow catalogue names no dataflow — refused');

  const matched = all
    .map((flow) => ({ flow, rule: grainOf(flow.name) }))
    .filter((c) => ABS_BA_NAME_PATTERN.test(c.flow.name));
  const candidates = matched
    .map((c) => ({ ref: dataflowRef(c.flow), name: c.flow.name, areaKind: c.rule?.areaKind ?? null }))
    .sort((a, b) => rank(a.areaKind) - rank(b.areaKind));

  if (override) {
    const want = override.trim();
    if (!DATAFLOW_REF_SHAPE.test(want)) {
      throw new Error(`"${want}" is not an SDMX dataflow reference (AGENCY,ID,VERSION) — refused`);
    }
    const found = all.find((f) => dataflowRef(f) === want);
    if (!found) {
      const near = all.filter((f) => ABS_BA_NAME_PATTERN.test(f.name)).map(dataflowRef);
      throw new Error(
        `the ABS catalogue (${all.length} flows) does not publish "${want}"`
        + (near.length ? ` — it publishes ${near.join(', ')}` : ' — and no flow it publishes names building approvals')
        + ' — refused',
      );
    }
    const rule = grainOf(found.name);
    return {
      flow: found,
      areaKind: rule?.areaKind ?? 'national',
      geographyScore: rule?.geographyScore ?? ABS_BA_GRAIN_LADDER[ABS_BA_GRAIN_LADDER.length - 1].geographyScore,
      how: 'operator_override',
      candidates,
      cataloguedFlows: all.length,
    };
  }

  if (matched.length === 0) {
    throw new Error(
      `no flow in the ABS catalogue (${all.length} flows) names building approvals — refused`,
    );
  }
  const graded = matched.filter((c): c is { flow: DataflowEntry; rule: GrainRule } => c.rule !== null);
  if (graded.length === 0) {
    throw new Error(
      `the ABS catalogue names ${matched.length} building-approvals flow(s) and none states a sub-national grain `
      + `(${candidates.map((c) => c.ref).join(', ')}) — refused, because an unqualified release is not a reading about an area`,
    );
  }
  const best = ABS_BA_GRAIN_LADDER.find((g) => graded.some((c) => c.rule.areaKind === g.areaKind))!;
  const atBest = graded.filter((c) => c.rule.areaKind === best.areaKind);
  // Not "which of these is the flow" but "which of these is CURRENT" — the
  // Bureau publishes one per edition. See `currentEdition`.
  const { chosen, tied } = currentEdition(atBest.map((c) => c.flow));
  if (!chosen) {
    throw new Error(
      `the ABS catalogue names ${tied.length} building-approvals flows at ${best.areaKind} grain `
      + `with the same vintage and no declared end (${tied.map(dataflowRef).join(', ')}) `
      + '— refused rather than picking one',
    );
  }
  return {
    flow: chosen,
    areaKind: best.areaKind,
    geographyScore: best.geographyScore,
    how: 'discovered',
    candidates,
    cataloguedFlows: all.length,
  };
}

/**
 * Which EDITION of a series a flow is, and whether it is the current one.
 *
 * ## Measured, not assumed — and the assumption was wrong
 *
 * `resolveBuildingApprovalsFlow` originally refused any grain holding more
 * than one flow, on the reasoning that two candidates mean an ambiguity a
 * loader must not resolve by itself. Run against the ABS's own catalogue on
 * 21 Sep 2026 (`abs-register-liveness`, HTTP 200, 791,134 bytes) that refused
 * outright, and it was RIGHT to:
 *
 *     the ABS catalogue names 3 building-approvals flows at sa2 grain
 *     (ABS,BA_SA2,2.0.0, ABS,BA_SA2_201116, ABS,BA_SA2_2016-21)
 *     — refused rather than picking one
 *
 * The Bureau publishes one flow per EDITION, not one per subject:
 *
 *   * SA2 — `BA_SA2_201116` (July 2011 to June 2016), `BA_SA2_2016-21`
 *     (2016 to 2021), `BA_SA2,2.0.0` (from July 2021 onwards);
 *   * LGA — `BA_LGA2018` through `BA_LGA2026`, one per LGA vintage. Nine.
 *
 * So they are not competitors to disambiguate. They are one series cut into
 * editions, and the question is not "which of these is the flow" but "which
 * of these is CURRENT". Refusing twelve flows is as wrong as picking one at
 * random — and picking at random is what a hardcoded identifier does, which
 * is the whole reason this module discovers instead. Had the loader named a
 * flow from memory it could have taken `BA_SA2_201116`, whose data ends in
 * **June 2016**, and presented a decade-old series as this month's supply.
 *
 * ## Two rules, in order
 *
 * **A period a publisher declares CLOSED is history.** A name saying "to June
 * 2016" or "2016 to 2021" states its own end; one saying "from July 2021
 * onwards" does not. Where any open edition exists the closed ones are not
 * candidates at all, whatever year they carry — `BA_SA2_2016-21` reaches 2021
 * and is still finished.
 *
 * **Then the latest vintage wins**, read as the greatest four-digit year in
 * the identifier or the name. That is what separates `BA_LGA2026` from the
 * eight LGA editions behind it.
 *
 * A tie after both is still refused, because two editions claiming the same
 * vintage with neither declaring an end is an ambiguity nothing here can
 * settle. The rule narrowed; it did not go away.
 */
export interface FlowEdition {
  /** The year the publisher's own name says the period ENDS, where it says. */
  closedAt: number | null;
  /** The greatest four-digit year in the identifier or the name. */
  vintage: number | null;
}

/** `2011` through the year after next: a year in an ABS series, not an ABN. */
const PLAUSIBLE_YEAR = /\b(20[0-4]\d)\b/g;

/**
 * A declared END. Both shapes the catalogue uses, and neither matches
 * "from July 2021 onwards", which declares a beginning.
 */
const DECLARES_AN_END = [
  /\bto\s+(?:\w+\s+)?(20\d\d)\b/i,
  /\b(20\d\d)\s*[-\u2013]\s*(\d{2,4})\b/,
];

export function flowEdition(entry: DataflowEntry): FlowEdition {
  const text = `${entry.id} ${entry.name}`;
  let closedAt: number | null = null;
  for (const re of DECLARES_AN_END) {
    const m = re.exec(entry.name);
    if (!m) continue;
    // `2016-21` closes in 2021; `to June 2016` closes in 2016.
    const tail = m[2] ?? m[1];
    const year = tail.length === 2 ? Number(`20${tail}`) : Number(tail);
    if (Number.isFinite(year)) closedAt = Math.max(closedAt ?? 0, year);
  }
  const years = [...text.matchAll(PLAUSIBLE_YEAR)].map((m) => Number(m[1]));
  return { closedAt, vintage: years.length ? Math.max(...years) : null };
}

/**
 * The current edition among flows at one grain, or null where two tie.
 *
 * Exported because the probe reports what it rejected: an operator reading a
 * sync row should see the eight LGA vintages that lost, not only the one
 * that won.
 */
export function currentEdition(
  flows: ReadonlyArray<DataflowEntry>,
): { chosen: DataflowEntry | null; tied: DataflowEntry[] } {
  if (flows.length === 0) return { chosen: null, tied: [] };
  if (flows.length === 1) return { chosen: flows[0], tied: [] };
  const withEdition = flows.map((flow) => ({ flow, edition: flowEdition(flow) }));
  const open = withEdition.filter((f) => f.edition.closedAt === null);
  const pool = open.length > 0 ? open : withEdition;
  const best = Math.max(...pool.map((f) => f.edition.vintage ?? -1));
  const at = pool.filter((f) => (f.edition.vintage ?? -1) === best);
  if (at.length === 1) return { chosen: at[0].flow, tied: [] };
  return { chosen: null, tied: at.map((f) => f.flow) };
}

const rank = (kind: ApprovalsAreaKind | null): number => {
  if (kind === null) return ABS_BA_GRAIN_LADDER.length;
  const at = ABS_BA_GRAIN_LADDER.findIndex((g) => g.areaKind === kind);
  return at === -1 ? ABS_BA_GRAIN_LADDER.length : at;
};

/**
 * What else the ABS publishes that bears on construction in an area.
 *
 * ## Why a SURVEY rather than a wider selection
 *
 * `INFRASTRUCTURE_COVERAGE_LIMITS` states, on every report, that this
 * platform does not reach *"council capital works programmes and their
 * budgets"* or *"state and federal budget infrastructure programmes"* — and
 * those are precisely the scheduled projects a reader most wants named. The
 * residential approvals this module loads are dwelling supply; they say
 * nothing about a hospital, a school, a distribution centre or a road.
 *
 * The ABS collection carries more than dwellings — non-residential building
 * approvals by value and purpose, engineering construction, building activity
 * — and some of it is published at sub-state grain. **Which of it, at what
 * grain, is not knowable from this repository**: neither ABS host answers a
 * development egress, so any list written here would be a list of what
 * somebody remembered rather than what the Bureau publishes.
 *
 * So this reports rather than decides. It is read by the `probe` stage alone,
 * changes no selection, and turns "could we also look at scheduled
 * infrastructure?" into one measurement from production instead of an opinion
 * about a catalogue nobody here can open. `resolveBuildingApprovalsFlow` stays
 * exactly as narrow as it was: a survey that widened the selection would be a
 * loader choosing a series because its name sounded relevant.
 */
export const ABS_CONSTRUCTION_SURVEY: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  { key: 'building_approvals', pattern: /building\s+approvals?/i },
  { key: 'non_residential', pattern: /non-?residential/i },
  { key: 'engineering_construction', pattern: /engineering\s+construction/i },
  { key: 'building_activity', pattern: /building\s+activity|work\s+done|construction\s+activity/i },
  { key: 'public_infrastructure', pattern: /infrastructure|public\s+works|capital\s+works/i },
];

export interface SurveyedFlow {
  /** Which survey term matched. A flow may match more than one. */
  keys: string[];
  ref: string;
  name: string;
  /** The grain its NAME declares, where it declares one. */
  areaKind: ApprovalsAreaKind | null;
}

/**
 * Every catalogue flow whose name matches a construction term, with the grain
 * its name declares. Ordered finest-grain first, so an LGA or SA2 series is
 * the first thing an operator reads.
 */
export function surveyConstructionFlows(catalogueText: string): SurveyedFlow[] {
  return parseDataflowCatalogue(catalogueText)
    .map((flow) => ({
      keys: ABS_CONSTRUCTION_SURVEY.filter((t) => t.pattern.test(flow.name)).map((t) => t.key),
      ref: dataflowRef(flow),
      name: flow.name,
      areaKind: grainOf(flow.name)?.areaKind ?? null,
    }))
    .filter((f) => f.keys.length > 0)
    .sort((a, b) => rank(a.areaKind) - rank(b.areaKind) || a.ref.localeCompare(b.ref));
}

/** The data query for a chosen flow. Labels, because the parse reads labels. */
export function absBuildingApprovalsUrl(flow: DataflowEntry, startPeriod: string): string {
  if (!/^\d{4}-\d{2}$/.test(startPeriod)) {
    throw new Error(`startPeriod must be YYYY-MM, not "${startPeriod}"`);
  }
  return `https://data.api.abs.gov.au/rest/data/${dataflowRef(flow)}/all`
    + `?startPeriod=${startPeriod}&format=csvfilewithlabels`;
}

// ─── The data ───────────────────────────────────────────────────────────────

export type ApprovalsBuildingType = 'house' | 'other_residential' | 'total_residential';

export interface ApprovalRow {
  state: SalesRegisterState | null;
  areaKind: ApprovalsAreaKind;
  /** The publisher's own label. */
  area: string;
  areaToken: string;
  /** The publisher's own area code (an LGA code, an SA2 code). */
  areaCode: string;
  period: string;
  buildingType: ApprovalsBuildingType;
  /**
   * Dwelling units approved, NET OF AMENDMENTS — so negative in a month when
   * previously approved dwellings were cancelled or revised down. Null where
   * the ABS published none.
   */
  dwellingUnits: number | null;
  /** Dollars of building approved, net of amendments, where the flow carries a value measure. */
  value: number | null;
}

/** Does this row carry a published negative on either measure? */
export const carriesNetNegative = (r: ApprovalRow): boolean =>
  (r.dwellingUnits !== null && r.dwellingUnits < 0) || (r.value !== null && r.value < 0);

/**
 * The order a window's rows are written in: every row carrying a negative
 * FIRST, then the rest.
 *
 * ## Why an order is part of the fix
 *
 * The walk derives its next window from the register's own edges —
 * `oldest` is `min(period)` over the table — and the loader writes a window
 * in batches of five hundred, throwing on the first batch that fails. So a
 * batch refused half-way through a window leaves the rows before it committed,
 * `oldest` moves to the window's first month, and the planner steps below a
 * window it never finished. Nothing ever asks for those rows again. That is
 * a hole in the register, and a hole reads to every report as data.
 *
 * Until `20261217000000_approvals_admit_net_amendments.sql` is applied the
 * table refuses a negative on its own CHECK, and the code that admits
 * negatives ships on merge while that migration is dispatched by hand. In the
 * gap, a window containing a negative would have punched a hole. Written
 * first, the negative-bearing rows are the FIRST request of the window: a table
 * that still refuses them refuses before any other row commits, the register
 * stays exactly where it was, and the next tick asks again. Once the migration
 * lands the whole window writes. The order makes the two changes safe to
 * deploy in either sequence.
 *
 * Stable within each group, so the order is otherwise the parse's own.
 *
 * It does NOT make a window atomic. A transient failure part-way through the
 * non-negative rows still commits the batches before it, as it always has;
 * that is recorded in `docs/operations/SESSION_HANDOFF_2026-09-23.md` as a
 * defect of its own rather than papered over here.
 */
export function approvalsWriteOrder(rows: ReadonlyArray<ApprovalRow>): {
  first: ApprovalRow[];
  then: ApprovalRow[];
} {
  const first: ApprovalRow[] = [];
  const then: ApprovalRow[] = [];
  for (const r of rows) (carriesNetNegative(r) ? first : then).push(r);
  return { first, then };
}

/*
 * The label rules. Exported because `absDataStructure.pure.ts` composes the
 * QUERY from the same rules the parse reads the ANSWER with — asking for the
 * codes we keep and keeping the codes we asked for cannot drift when they are
 * one declaration. Two copies of "which building types are residential" is
 * how a narrowed download comes back missing a row the parser still expects.
 */
/*
 * A bare `Total` is NOT total residential.
 *
 * This matched `^total$` until 21 Sep 2026, and the Bureau's building-type
 * codelist publishes `100 = Total residential` AND `TOT = Total` side by
 * side across thirty-four categories that include hotels, shops, factories,
 * offices, health and education. `Total` is all of them. Reading it as
 * residential inflates approved dwelling supply by the whole non-residential
 * programme — and the two land on one row key, so whichever arrived second
 * silently won.
 *
 * It is dropped rather than disambiguated, because a label that could mean
 * either must not be resolved to the narrower meaning: this register would
 * rather skip a row than attribute a factory to housing. The cost is a flow
 * whose building-type dimension carries only residential categories and
 * calls its total `Total` — there, the row is skipped and counted in
 * `skipped`, which is visible, rather than being wrong, which is not.
 *
 * Third instance of one shape today, after `Number of buildings` and the
 * national rollup: a pattern written against one publisher's vocabulary,
 * meeting the vocabulary the publisher actually has.
 */
export const BUILDING_TYPE_PATTERNS: ReadonlyArray<[ApprovalsBuildingType, RegExp]> = [
  ['total_residential', /^total (residential|dwellings?)\b|^dwellings?,? total\b/i],
  ['house', /^houses?\b/i],
  ['other_residential', /other residential|non-?house/i],
];

/**
 * Dwelling units approved, and never a count of BUILDINGS.
 *
 * This read `^number\b` until 21 Sep 2026, and the ABS building-approvals
 * cube publishes `Number of dwelling units`, `Value of building approved`
 * AND `Number of buildings` on one measure dimension. A block of forty flats
 * is one building and forty dwellings, so the two differ by an order of
 * magnitude — and because the row key is `(area, period, building type)`,
 * a building count did not merely leak in, it OVERWROTE the dwelling count
 * for the same month whenever it was read second.
 *
 * Nothing caught it because the fixture published two measures and the cube
 * publishes three: the defect was invisible until the query had to enumerate
 * what the publisher actually offers. A bare `Number` still matches, for a
 * flow whose measure dimension carries only one.
 */
export const UNITS_MEASURE = /number of dwelling units|^dwelling units\b|^number$/i;
export const VALUE_MEASURE = /value of (building|work)/i;
export const ORIGINAL_SERIES = /^orig/i;
/** Monthly. The parse discards every other period anyway (`monthPeriod`). */
export const MONTHLY_FREQ = /^month/i;

/** State from the ABS's own one-digit region code, where the flow carries it. */
export const ABS_BA_STATE_OF_CODE: Readonly<Record<string, SalesRegisterState>> = {
  '1': 'NSW', '2': 'VIC', '3': 'QLD', '4': 'SA', '5': 'WA', '6': 'TAS', '7': 'NT', '8': 'ACT', AUS: 'AU',
};

/**
 * A grain the ASGS publishes in the same download and this register has no
 * column for. `area_kind`'s CHECK admits four values; the SA2 hierarchy has
 * five levels.
 */
export type ApprovalsIntermediateGrain = 'sa3' | 'sa4';

/** What one row's area code turns out to describe. */
export type ApprovalsRowGrain = ApprovalsAreaKind | ApprovalsIntermediateGrain | 'unknown';

/** The four `area_kind` accepts. Anything else is read and then refused. */
export function isStorableGrain(grain: ApprovalsRowGrain): grain is ApprovalsAreaKind {
  return grain === 'sa2' || grain === 'lga' || grain === 'state' || grain === 'national';
}

/**
 * The grain of one row, read from the publisher's own area code.
 *
 * An ABS region download is a HIERARCHY, not a list: *"Building Approvals by
 * SA2 and above"* carries SA2s, states and Australia in one body, and the LGA
 * flow does the same. So the grain is a property of the ROW, never of the
 * request — stamping every row with the requested kind files the national
 * total as a council area, which is what the read path would then serve as a
 * suburb's supply.
 *
 * ## What the first production load found, 22 Sep 2026
 *
 * The rule above was right and the code under it was wrong, in two places,
 * and a read-back of the loaded register is what showed it:
 *
 *     by_kind=[lga=2064, national=6, sa2=15324, state=48]
 *     samples=[lga code=10102 area=Queanbeyan | sa2 code=101 area=Capital Region]
 *
 * `10102 Queanbeyan` is **SA3** and was filed `lga`; `101 Capital Region` is
 * **SA4** and was filed `sa2`. The SA2 hierarchy is SA2 (9 digits), SA3 (5),
 * SA4 (3), state (1), `AUS` — so the five-digit rule caught SA3s, and SA4s
 * matched nothing and fell through to `return requested`, which was `sa2`.
 *
 * **That fallback called itself the conservative side and was the opposite of
 * it.** Defaulting an unreadable code to the grain that was ASKED FOR means
 * defaulting it to the FINEST grain in the download, so a 250,000-person SA4
 * is served as a suburb's approved supply. `ABS_BA_PLAUSIBILITY` cannot catch
 * it either, and says so in its own comment — the ceilings detect unit drift
 * "rather than ranking areas", so an SA4's figure sits far inside an SA2's
 * 20-billion-dollar ceiling.
 *
 * ## The scheme, and how the five-digit collision is settled
 *
 * ASGS codes are stable across editions: `AUS` Australia, one digit a state
 * or territory, three an SA4, five an SA3, nine an SA2 — and an ABS **LGA**
 * code is also five digits. That collision is real and it is settled by the
 * download rather than by the code, which is the one legitimate use of
 * `requested` here: an LGA-grain download's hierarchy is LGA → state → AUS
 * and contains no SA3, while an SA2-grain download's contains no LGA. So five
 * digits is an LGA in the first and an SA3 in the second.
 *
 * An unreadable code is **`unknown`** and is refused rather than guessed.
 * Guessing upward and guessing downward are both wrong; the difference is
 * that guessing downward puts a coarse figure on a client's page as a fine
 * one, and guessing upward merely loses a row. Neither is taken.
 */
export function grainOfAreaCode(code: string, requested: ApprovalsAreaKind): ApprovalsRowGrain {
  const trimmed = code.trim();
  if (/^AUS$/i.test(trimmed) || trimmed === '0') return 'national';
  if (/^[1-8]$/.test(trimmed)) return 'state';
  if (/^\d{9}$/.test(trimmed)) return 'sa2';
  if (/^\d{3}$/.test(trimmed)) return 'sa4';
  // Five digits is an LGA in an LGA download and an SA3 in an SA2 one.
  if (/^\d{5}$/.test(trimmed)) return requested === 'lga' ? 'lga' : 'sa3';
  return 'unknown';
}

/** An LGA/SA2 code's leading digit is its state, under every ASGS edition. */
export function stateOfAreaCode(code: string): SalesRegisterState | null {
  const trimmed = code.trim();
  if (trimmed === '') return null;
  if (ABS_BA_STATE_OF_CODE[trimmed]) return ABS_BA_STATE_OF_CODE[trimmed];
  const lead = trimmed[0];
  return /[1-8]/.test(lead) ? ABS_BA_STATE_OF_CODE[lead] : null;
}

export interface ResolvedColumns {
  regionCode: string;
  regionLabel: string;
  measureLabel: string | null;
  buildingTypeLabel: string | null;
  seriesTypeLabel: string | null;
}

/**
 * Which column is which, read off the header rather than assumed.
 *
 * SDMX-CSV with labels emits both the code column (`REGION`) and its label
 * (`Region`), which is what makes this safe: a header offering exactly one
 * region pair and one measure label is not ambiguous, and where it is
 * ambiguous the loader says which names it found rather than choosing.
 */
export function resolveColumns(header: string[]): ResolvedColumns {
  const find = (re: RegExp, exclude?: RegExp): string[] =>
    header.filter((h) => re.test(h) && !(exclude && exclude.test(h)));

  /*
   * Case is the discriminator, and it is load-bearing. SDMX-CSV with labels
   * emits the dimension's ID in upper snake (`REGION`) and its human name
   * beside it (`Region`) -- so a case-INSENSITIVE code pattern matches both
   * and the header reads as ambiguous when it is not. That was this reader's
   * first defect, caught by its own fixture.
   */
  const regionCodes = find(/^(REGION|ASGS_2016|ASGS_2021|LGA|SA2)$/);
  const regionLabels = find(/^(Region|Local Government Area|Statistical Area Level 2)$/);
  if (regionCodes.length !== 1 || regionLabels.length !== 1) {
    throw new Error(
      `the ABS building-approvals download offers ${regionCodes.length} region code column(s) `
      + `and ${regionLabels.length} region label column(s) (header: ${header.join(', ')}) — refused`,
    );
  }
  const one = (names: string[]): string | null => (names.length === 1 ? names[0] : null);
  return {
    regionCode: regionCodes[0],
    regionLabel: regionLabels[0],
    measureLabel: one(find(/^Measure$/)),
    buildingTypeLabel: one(find(/^(Building Type|Type of Building|Dwelling Type)$/i)),
    seriesTypeLabel: one(find(/^(Adjustment Type|Series Type|TSEST_Label|Type of Series Estimate)$/i)),
  };
}

export interface AbsApprovalsParse {
  rows: ApprovalRow[];
  periods: string[];
  latestPeriod: string;
  /** Distinct areas AT THE REQUESTED GRAIN — what the floor is judged on. */
  areas: number;
  /** Every grain the download turned out to carry, and how many of each. */
  areasByGrain: Partial<Record<ApprovalsAreaKind, number>>;
  states: SalesRegisterState[];
  columns: ResolvedColumns;
  /** True where the download carried no series-type column to filter on. */
  seriesTypeUnfiltered: boolean;
  /** Rows the parse skipped because nothing it recognises named them. */
  skipped: number;
  /**
   * Rows READ correctly and then refused, because their grain is real and
   * `area_kind` has no value for it — the SA2 hierarchy's SA3 and SA4 levels,
   * and any code in no ASGS shape at all.
   *
   * Counted and carried rather than silently dropped: these used to be
   * written as `lga` and `sa2`, which is how an SA4 came to be filed as a
   * suburb. A number here is the download's hierarchy being declined, not a
   * fault.
   */
  refusedByGrain: Partial<Record<ApprovalsIntermediateGrain | 'unknown', number>>;
  /** Cells dropped for magnitude, named. Empty is the ordinary outcome. */
  implausibleCells: string[];
}

/**
 * The building-approvals download as register rows.
 *
 * Throws on a reshaped, truncated or unit-drifted answer; never returns a
 * partial register as though it were whole, and never writes a figure it
 * could not attribute to an area, a month and a building type.
 */
export interface ApprovalsParseOptions {
  /**
   * The month floor THIS download must clear. Defaults to
   * `ABS_BA_PLAUSIBILITY.minPeriods`.
   *
   * ## Why it is a parameter now
   *
   * The floor exists to catch a truncated body, and it was written when one
   * request carried the whole series. Measured 21 Sep 2026, it cannot: SA2
   * narrowed is 111.6 MB over 33 months and 10.4 MB over 6, so a full load
   * is eight requests of six months. Judging a six-month PAGE against a
   * twenty-four-month floor refuses every page of a healthy load.
   *
   * So the floor moves from a property of the DOWNLOAD to a property of the
   * REGISTER: a page declares the window it asked for, and whether the
   * register as a whole holds twenty-four months is a question about the
   * table, asked after a load rather than during one. The default is
   * unchanged, so an unpaged caller behaves exactly as before — this widens
   * what can be expressed, never what is accepted by accident.
   */
  minPeriods?: number;
}

export function parseAbsBuildingApprovals(
  text: string,
  areaKind: ApprovalsAreaKind,
  options: ApprovalsParseOptions = {},
): AbsApprovalsParse {
  const records = parseSdmxCsv(text);
  if (records.length === 0) throw new Error('the ABS building-approvals download is empty — refused');
  const header = Object.keys(records[0]);
  for (const col of ['TIME_PERIOD', 'OBS_VALUE']) {
    if (!header.includes(col)) {
      throw new Error(`the ABS building-approvals download has no "${col}" column (header drift) — refused`);
    }
  }
  const columns = resolveColumns(header);
  const hasUnitMult = header.includes('UNIT_MULT');

  // (area code, period, building type) → the row being built.
  const byKey = new Map<string, ApprovalRow>();
  const periods = new Set<string>();
  // Distinct area codes per GRAIN. A hierarchical download carries councils,
  // states and Australia together, so one undifferentiated count judged
  // against one grain's floor is a count of the wrong thing.
  const areasByGrain = new Map<ApprovalsAreaKind, Set<string>>();
  const refusedByGrain = new Map<ApprovalsIntermediateGrain | 'unknown', number>();
  /** Cells outside the magnitude ceiling — dropped individually, named together. */
  const implausible: string[] = [];
  let cellsRead = 0;
  const states = new Set<SalesRegisterState>();
  let skipped = 0;
  let sawSeriesType = false;

  for (const rec of records) {
    if (columns.seriesTypeLabel) {
      const series = (rec[columns.seriesTypeLabel] ?? '').trim();
      if (series !== '') {
        sawSeriesType = true;
        if (!ORIGINAL_SERIES.test(series)) continue;
      }
    }
    const period = monthPeriod(rec.TIME_PERIOD ?? '');
    if (!period) { skipped++; continue; }
    const areaCode = (rec[columns.regionCode] ?? '').trim();
    const area = (rec[columns.regionLabel] ?? '').trim();
    if (areaCode === '' || area === '') { skipped++; continue; }

    const buildingType = columns.buildingTypeLabel
      ? matchBuildingType(rec[columns.buildingTypeLabel] ?? '')
      : 'total_residential';
    if (!buildingType) { skipped++; continue; }

    const measure = columns.measureLabel ? (rec[columns.measureLabel] ?? '') : '';
    const isValue = VALUE_MEASURE.test(measure);
    const isUnits = !columns.measureLabel || UNITS_MEASURE.test(measure);
    if (!isValue && !isUnits) { skipped++; continue; }

    const raw = parseNumberCell(rec.OBS_VALUE);
    const mult = hasUnitMult ? Number(rec.UNIT_MULT) : 0;
    const scaled = raw === null ? null : Math.round(raw * 10 ** (Number.isInteger(mult) ? mult : 0));

    /*
     * The row's OWN grain, not the request's. See `grainOfAreaCode`.
     *
     * A grain the register has no column for is REFUSED here rather than
     * bent into one that fits. Before this, an SA3 was written `lga` and an
     * SA4 `sa2`, so the read path would have served a 250,000-person region
     * as one suburb's approved supply.
     */
    const grain = grainOfAreaCode(areaCode, areaKind);
    if (!isStorableGrain(grain)) {
      refusedByGrain.set(grain, (refusedByGrain.get(grain) ?? 0) + 1);
      continue;
    }
    const rowKind = grain;
    const key = `${areaCode}|${period}|${buildingType}`;
    let row = byKey.get(key);
    if (!row) {
      const state = stateOfAreaCode(areaCode);
      row = {
        state,
        areaKind: rowKind,
        area,
        areaToken: salesAreaToken(rowKind === 'sa2' ? 'suburb' : rowKind, area),
        areaCode,
        period,
        buildingType,
        dwellingUnits: null,
        value: null,
      };
      byKey.set(key, row);
      if (state) states.add(state);
    }
    if (scaled !== null) {
      cellsRead += 1;
      /*
       * The bound is on MAGNITUDE, and one cell never refuses the download.
       *
       * This read `scaled < 0 || scaled > ceiling` and THREW, and it stalled
       * the production walk for nine consecutive hourly ticks on 22 Sep 2026:
       *
       *   the ABS building-approvals count for Ulverstone 2025-08 reads -5
       *   dwelling units, outside 0-100000 for a sa2 area (unit or column
       *   drift) — refused
       *
       * Two faults, either of which alone is enough.
       *
       * **A negative is the publisher's own value, not drift.** ABS Building
       * Approvals are net of AMENDMENTS, so a small area records a negative
       * in a month when a previously approved dwelling is cancelled or
       * revised down. Drift — a column read in thousands, a value column read
       * as a count — is a fault of MAGNITUDE and shows up in either
       * direction, which is what `Math.abs` tests. `ABS_BA_PLAUSIBILITY`'s own
       * header already said this: *"a check that fires on a true figure is not
       * a plausibility check, it is a filter nobody asked for."*
       *
       * **And one cell may not refuse a series.** The window is ~22,000 cells
       * (2,458 areas x 3 months x 3 building types); throwing on any one of
       * them discarded all of it, and the next tick asked for the same window
       * again — a livelock, for ever, reported by nothing but a log line. That
       * is the rule the sibling register already paid for: *a publisher's typo
       * is nulled and named, never a reason to refuse a series*, where one
       * $7,000 cell refused 444 localities.
       *
       * So an isolated implausible cell is DROPPED and NAMED, and the refusal
       * is kept for what it was written for — systematic drift, which is many
       * cells rather than one. `maxIsolatedImplausibleCells` is the boundary
       * between the two.
       */
      const ceiling = isValue
        ? ABS_BA_PLAUSIBILITY.maxValuePerAreaMonth[rowKind]
        : ABS_BA_PLAUSIBILITY.maxUnitsPerAreaMonth[rowKind];
      if (Math.abs(scaled) > ceiling) {
        implausible.push(
          isValue
            ? `${area} ${period} value $${scaled} (|x| > ${ceiling}, ${rowKind})`
            : `${area} ${period} ${scaled} dwelling units (|x| > ${ceiling}, ${rowKind})`,
        );
      } else if (isValue) {
        assertNoCollision(row.value, scaled, 'value of building approved', area, period, buildingType);
        row.value = scaled;
      } else {
        assertNoCollision(row.dwellingUnits, scaled, 'dwelling units', area, period, buildingType);
        row.dwellingUnits = scaled;
      }
    }
    periods.add(period);
    let atGrain = areasByGrain.get(rowKind);
    if (!atGrain) { atGrain = new Set<string>(); areasByGrain.set(rowKind, atGrain); }
    atGrain.add(areaCode);
  }

  /*
   * Systematic drift still refuses. See `maxIsolatedImplausibleCells` for why
   * the allowance is a count: an artefact does not grow with the window and
   * drift does. The message NAMES examples rather than a count alone — a bare
   * number sends nobody to a remedy.
   */
  if (implausible.length > ABS_BA_PLAUSIBILITY.maxIsolatedImplausibleCells) {
    throw new Error(
      `${implausible.length} of ${cellsRead} ABS building-approvals cells are outside their `
      + `magnitude ceiling (more than ${ABS_BA_PLAUSIBILITY.maxIsolatedImplausibleCells}), which is a `
      + `column read wrongly rather than a publisher artefact — refused. `
      + `For example: ${implausible.slice(0, 3).join('; ')}`,
    );
  }

  const rows = [...byKey.values()];
  if (rows.length === 0) {
    /*
     * The refusals are NAMED here, because they are a different finding from
     * a body nothing could read. A download that is all SA3 and SA4 was read
     * perfectly and declined for want of a column, and reporting it as
     * "no row this loader recognises (0 skipped)" sends an operator looking
     * for a parse fault that does not exist.
     */
    const refused = [...refusedByGrain.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([grain, n]) => `${n} ${grain}`)
      .join(', ');
    throw new Error(
      'the ABS building-approvals download carries no row this loader recognises '
      + `(${records.length} records read, ${skipped} skipped`
      + `${refused === '' ? '' : `, refused for want of a column: ${refused}`}) — refused`,
    );
  }
  /*
   * The floor is on the REQUESTED grain alone. An LGA download naming 40
   * councils is a truncated body however many state and national rollups rode
   * in with it — and counting those towards the floor is how a body carrying
   * nothing but rollups passes a check designed to catch exactly that.
   */
  const areasAtGrain = areasByGrain.get(areaKind)?.size ?? 0;
  const minAreas = ABS_BA_PLAUSIBILITY.minAreas[areaKind];
  if (areasAtGrain < minAreas) {
    const seen = [...areasByGrain.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .map(([kind, set]) => `${set.size} ${kind}`)
      .join(', ');
    throw new Error(
      `the ABS building-approvals download names ${areasAtGrain} ${areaKind} areas, fewer than ${minAreas} `
      + `(it carries ${seen || 'nothing'}) — a truncated download, refused`,
    );
  }
  const sorted = [...periods].sort();
  const minPeriods = options.minPeriods ?? ABS_BA_PLAUSIBILITY.minPeriods;
  if (minPeriods > 0 && sorted.length < minPeriods) {
    throw new Error(
      `the ABS building-approvals download holds ${sorted.length} month${sorted.length === 1 ? '' : 's'} `
      + `(${sorted[0]}${sorted.length > 1 ? ` to ${sorted[sorted.length - 1]}` : ''}), `
      + `fewer than the ${minPeriods} this read asked for — refused`,
    );
  }
  return {
    rows,
    periods: sorted,
    latestPeriod: sorted[sorted.length - 1],
    areas: areasAtGrain,
    areasByGrain: Object.fromEntries(
      [...areasByGrain.entries()].map(([kind, set]) => [kind, set.size]),
    ) as Partial<Record<ApprovalsAreaKind, number>>,
    states: [...states],
    columns,
    seriesTypeUnfiltered: !sawSeriesType,
    skipped,
    refusedByGrain: Object.fromEntries(refusedByGrain) as AbsApprovalsParse['refusedByGrain'],
    implausibleCells: implausible,
  };
}

/** `2026-07` → `2026-07`; `2026-07-01` → `2026-07`; null for anything else. */
export function monthPeriod(timePeriod: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(timePeriod.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}`;
}

/**
 * Two different figures for one (area, month, building type) mean this reader
 * is not filtering a dimension the download carries.
 *
 * ## Asserted by EFFECT, never by configuration
 *
 * The ABS cube has EIGHT dimensions — measured 21 Sep 2026 from the Bureau's
 * own structure: `MEASURE[3] · SECTOR[3] · WORK_TYPE[9] · BUILDING_TYPE[34] ·
 * REGION_TYPE[43] · REGION[2985] · FREQ[9] · TIME_PERIOD` — and this parse
 * reads four of them. Private, public and total sector figures for one month
 * all map to the same row key, as do new work, alterations and conversions,
 * and the last one written silently wins. The stored figure would then be an
 * arbitrary SLICE presented as a total: plausible, wrong, and impossible to
 * tell from a correct one by looking at it.
 *
 * Enumerating every dimension the publisher might add is a losing game — the
 * `Number of buildings` defect was exactly that bet, and it was lost because
 * the fixture published two measures and the cube publishes three. So this
 * detects the SYMPTOM instead: a second, DIFFERENT figure arriving for a key
 * that already has one. It is the rule the retention purge and the
 * verification self-test already answer to, applied to a parse.
 *
 * An identical second write is not a collision — a download may legitimately
 * repeat a row — so only a disagreement refuses.
 */
function assertNoCollision(
  held: number | null,
  incoming: number,
  measure: string,
  area: string,
  period: string,
  buildingType: ApprovalsBuildingType,
): void {
  if (held === null || held === incoming) return;
  throw new Error(
    `the ABS building-approvals download gives two different ${measure} figures for `
    + `${area} ${period} ${buildingType} (${held} then ${incoming}) — it carries a dimension `
    + 'this reader does not filter, so rows collide on (area, period, building type) and the '
    + 'last one silently wins. Narrow the query or read the extra dimension; do not average '
    + 'them — refused',
  );
}

function matchBuildingType(label: string): ApprovalsBuildingType | null {
  const s = label.trim();
  if (s === '') return null;
  for (const [type, pattern] of BUILDING_TYPE_PATTERNS) if (pattern.test(s)) return type;
  return null;
}
