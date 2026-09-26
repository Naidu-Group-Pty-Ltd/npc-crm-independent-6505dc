/**
 * The infrastructure and development a report may describe, and what each
 * item's status actually rests on.
 *
 * ## The defect this exists to end
 *
 * The prompt asked for an infrastructure pipeline whether or not a single
 * project was evidenced. Its own worked examples were the shape of the
 * problem: a SWOT strength reading *"**Metro connectivity:** [Metro Line]
 * opened [Year], fundamentally improving transport profile … This
 * infrastructure investment typically drives long-term capital growth"*, an
 * opportunity reading *"**Infrastructure development:** Planned residential
 * and commercial developments in [Suburb] region support continued population
 * growth and property appreciation"*, and a directive requiring every
 * pipeline to be drawn as a `{{timeline: Existing … 0-2y … 3-5y … 5y+}}`
 * ribbon. None of that is a question a model can answer from the record, so
 * what came back was a plausible pipeline: named projects, horizons, and a
 * causal claim about capital growth, with nothing behind any of it.
 *
 * Meanwhile the enrichment already holds evidenced development facts and the
 * outlook sections used none of them — the same shape as the zoning section
 * (`planningFacts.pure.ts`). Queensland's StatePlanning layers answer, at the
 * property's own coordinate, whether it sits inside a declared priority
 * development area, state development area, coordinated project or
 * infrastructure designation, each with the publisher's own status word and
 * its gazettal date. New South Wales' Online DA register answers what has
 * been lodged and determined in the council over a stated window, with costs,
 * dwelling counts and the largest applications by cost.
 *
 * ## The rules
 *
 * 1. **A project is named only where a register named it.** There is no
 *    inferred pipeline and no horizon a publisher did not state.
 * 2. **A status is the publisher's own word.** The vocabulary a reader needs
 *    — proposed, approved, funded, under construction, completed, delayed,
 *    cancelled — is added in parentheses ONLY where the publisher's word maps
 *    onto it unambiguously. An unrecognised word is printed as it stands
 *    rather than forced into a category it may not belong in. Approval is not
 *    funding and funding is not delivery, so nothing here promotes one to
 *    another.
 * 3. **A completion date is never invented.** A gazettal or determination
 *    date is a date something HAPPENED, and it is labelled as that. Where a
 *    register states no delivery date, the item says so.
 * 4. **An announcement is never a capital-growth claim.** Nothing composed
 *    here quantifies an uplift or asserts that a project will raise values,
 *    and the rules handed to the model forbid it in the prose beside this.
 * 5. **Coverage is stated honestly, every time.** What these two registers do
 *    NOT cover — council capital works, state budget programmes, agency
 *    announcements, transport and utility projects — is named on the page, so
 *    a short list reads as a short search rather than a quiet area.
 * 6. **Development nearby cuts both ways.** Dwellings in the pipeline are
 *    competing supply as well as a sign of confidence, and the reading says
 *    so rather than filing them under opportunity.
 * 7. **An absence may not be rated.** A register that answered nothing has
 *    measured the SEARCH, not the area, so nothing it returned can carry a
 *    risk rating, a score or a favourable finding. 262 Pallas Street is what
 *    this exists for: its risk register read *"Infrastructure timing and
 *    pipeline | **Low** | The absence of a named infrastructure pipeline in
 *    the registers searched means this property's performance is tied to
 *    broader Maryborough fundamentals"*, chipped **Verified**. Two things go
 *    wrong there and rules 7 and 8 close one each. The **Low** is a
 *    conclusion about the area drawn from the coverage of a search — and the
 *    coverage statement three paragraphs above it says these registers do not
 *    reach council capital works, budget programmes or agency announcements,
 *    which is where a regional centre's infrastructure actually lives. It is
 *    the asymmetry this repository has already written down twice: *a stop
 *    found is a fact about the area; no stop found is a fact about the
 *    FEEDS*, and a sanctions hit is a signal while a miss says nothing.
 * 8. **An evidence note describes the retrieval, never the conclusion beside
 *    it.** "Verified" was true of the layer reading on that row — the four
 *    Queensland layers were checked at the coordinate and matched nothing —
 *    and it was written against the *rating*, lending a retrieval's
 *    verification to an inference the retrieval does not support.
 * 9. **The two absences are different sentences.** `none_at_point` is a
 *    register that was asked here and holds nothing here; everything else is
 *    a register that was never asked at all. That row called the Queensland
 *    development-application register one of "the registers searched", and it
 *    cannot be searched — no state-wide feed is published for the
 *    jurisdiction. `absences` was a flat list of strings, so the prose had no
 *    way to tell them apart.
 * 10. **One designation, one row — and identity is PROVEN before anything is
 *    merged.** The two Queensland sources read the SAME MapServer: the
 *    instruments probe asks layers 25/30/35/40 one at a time, the constraint
 *    register calls `identify` with `layers: all` on the same service. So a
 *    property inside a priority development area got two rows that disagreed
 *    on every cell but the name (executed 18 Sep 2026).
 *
 *    The first version of this rule merged on **publisher + name**, and that
 *    is a candidate match rather than proof: two designations can share a
 *    name across registers, and — worse — the context source was read as
 *    `?? 'state planning layers'`, so two readings that named NO source both
 *    wore the fallback and looked identical to each other. A missing source
 *    must never establish identity.
 *
 *    Identity now needs three things, and any one missing means no merge: the
 *    context reading NAMES its publisher (no fallback); it carries the
 *    publisher's own `sourceLayer`, and that layer is one of the four in
 *    `INSTRUMENT_LAYER_KIND` — the stable identifier, because a label is what
 *    a feature is called while a layer id is which register it came out of;
 *    and the two publishers' own names match exactly after trim, case-fold and
 *    whitespace collapse. Never token overlap, never edit distance, never a
 *    shared word, and never across sources.
 *
 *    And a layer identifies a COLLECTION, not an individual designation. Two
 *    priority development areas are both layer 35 and a name can be reused,
 *    so those three things are a CANDIDATE and the publisher's own
 *    identifiers settle it. There are two of them and they identify different
 *    things — a feature's own reference or code (`PDA-MBH`, `DDO1`) and the
 *    instrument it sits UNDER (`Wide Bay Burnett Regional Plan`) — so each is
 *    judged against its own channel only, and only where BOTH sides published
 *    it. Comparing across channels is the publisher-plus-name mistake a level
 *    down: two identifiers of different things disagree on every honest pair.
 *
 *    Where a channel both sides published DISAGREES, the match is refused
 *    however well publisher, layer and name line up — these are two records
 *    and both stand, each with its own reference, source, licence and
 *    currency, so a reader can see the disagreement and look either up. A
 *    channel one side left unpublished says nothing and does not refuse:
 *    measured 18 Sep 2026, `parseQldInstrument` emits NEITHER identifier on
 *    any of its four kinds while a `PlanningConstraintReading` carries both,
 *    so every real match today is that case. It is exactly there that the
 *    merge EARNS something: the surviving layer-specific row is filled from
 *    the suppressed one wherever it held nothing — reference, region,
 *    currency date, licence — so suppressing a duplicate never costs the
 *    document a fact. Nothing already stated is overwritten, and no status
 *    word travels: a designation's standing is not an instrument's. The guard
 *    is written before either parser publishes an identifier, because that is
 *    the change that would otherwise merge two designations silently.
 *
 *    Where identity cannot be proven **the row stands**. A visible duplicate
 *    is a presentation fault; merging two different designations deletes a
 *    real one, and only one of those is recoverable. The layer-specific
 *    reading wins a proven match, because it parses that layer's own fields
 *    where the identify-all row parses whatever the server offered.
 *
 * Pure: no fetch, no Deno, no clock.
 */

import {
  horizonCaveat,
  programmeStanding,
  PROGRAMME_RADIUS_KM as PROGRAMME_RADIUS_KM_FALLBACK,
  stageSentence,
} from './investmentProgramme.pure.ts';
import { ABSENCE_GUIDE, INFRASTRUCTURE_GUIDE_LEAD_IN, guidesForKinds } from './infrastructureGuide.pure.ts';
import { auDate } from './auDate.pure.ts';
import { readerNote, uncheckedSentence } from './serviceNote.pure.ts';
import { NATIONAL_PIPELINE_COVERAGE_PHRASE } from './nationalPipeline.pure.ts';
import { DISCLOSURE_HOMES, REGISTER_CHECKED_EMPTY, REGISTER_NOT_COVERED, elsewhereOnly, inHomeSection } from '../reports/adviserVoice.pure.ts';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** What a reader needs to know about where a project has got to. */
export type DeliveryStanding =
  | 'proposed'
  | 'approved'
  | 'funded'
  | 'under_construction'
  | 'completed'
  | 'delayed'
  | 'cancelled';

export const DELIVERY_STANDING_LABEL: Readonly<Record<DeliveryStanding, string>> = {
  proposed: 'Proposed',
  approved: 'Approved',
  funded: 'Funded',
  under_construction: 'Under construction',
  completed: 'Completed',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
};

/**
 * A publisher's status word, read onto the reader's vocabulary — or not.
 *
 * Deliberately narrow (rule 2). Every entry is a phrase a register actually
 * publishes, and anything else answers null so the publisher's own word is
 * printed unmapped. "Approved" is never read as funded and "funded" is never
 * read as under construction: those are the three a reader most wants
 * collapsed and the three it would be most expensive to collapse wrongly.
 */
export function readDeliveryStanding(raw: string | null): DeliveryStanding | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(lodged|under assessment|pending|on exhibition|proposed|nominated)\b/.test(s)) return 'proposed';
  if (/^(approved|determined - approved|determination - approved|granted|declared|gazetted)\b/.test(s)) return 'approved';
  if (/^(funded|committed|budgeted)\b/.test(s)) return 'funded';
  if (/^(under construction|construction|commenced|in delivery)\b/.test(s)) return 'under_construction';
  if (/^(complete|completed|finalised|operational)\b/.test(s)) return 'completed';
  if (/^(deferred|delayed|on hold|paused)\b/.test(s)) return 'delayed';
  if (/^(withdrawn|refused|rejected|cancelled|lapsed|discontinued)\b/.test(s)) return 'cancelled';
  return null;
}

/**
 * A register that returned no item, and whether it was actually asked.
 *
 * Rule 9. The planning service publishes five distinct absences
 * (`none_at_point`, `not_served`, `not_integrated`, `licence_restricted`,
 * `unavailable`) and this collapses them onto the ONE distinction a reader's
 * conclusion turns on: was the question put, or not.
 */
export interface RegisterReading {
  /** Which register, in words a reader can match to the sentence. */
  register: 'development instruments' | 'development applications' | 'forward investment programme';
  /**
   * `searched_empty` — the register was asked at this location and answered
   * that it holds nothing here. Within that register's own coverage, that is
   * a fact about the AREA.
   *
   * `not_searched` — nothing was asked. The jurisdiction publishes no such
   * register, the layer is not integrated, its licence forbids it, or the
   * request failed. That is a fact about THIS PLATFORM, and no finding about
   * the area follows from it at all.
   */
  reading: 'searched_empty' | 'not_searched';
  /** The service's own note, verbatim. */
  note: string;
}

export interface InfrastructureItem {
  /** What it is, in the publisher's own words. */
  name: string;
  /**
   * The publisher's own reference for it — a council application number, an
   * instrument's identifier. Null where the publisher gave none.
   *
   * A reader asked to act on an entry has to be able to look it up, and the
   * rendered table named a concatenated list of development types ("Alterations
   * or additions to an existing building or structure, High technology
   * industry, Data centre") with no number and no address, while the register
   * carried both. Identity is the first of the six things the brief asks for
   * per project.
   */
  reference: string | null;
  /** The kind of instrument or application. */
  kind: string;
  /** The publisher's status word, verbatim. Null where it stated none. */
  statedStatus: string | null;
  /** That word read onto the reader's vocabulary, where it maps (rule 2). */
  standing: DeliveryStanding | null;
  /** A date something HAPPENED, with what happened. Never a forecast (rule 3). */
  dateLabel: string | null;
  date: string | null;
  /** Where, as the register states it. Null where it states nothing. */
  where: string | null;
  /** The full address the register states, where it states one. */
  address: string | null;
  /**
   * The cost the register states, where it carries one.
   *
   * **On a DA entry it is a cost and not funding.** A development-application
   * register carries the APPLICANT'S OWN stated cost of development and says
   * nothing about who is paying — so `costBasis` names which of the two this
   * figure is, and a DA cost may never be read as investment.
   *
   * On a forward investment programme entry it IS a committed budget, because
   * a government programme publishes one. That is the difference the two
   * registers turn on, and it is the reason this field carries its basis
   * rather than a bare number.
   */
  statedCost: number | null;
  /**
   * What `statedCost` IS — `application` for an applicant's stated cost of
   * development, `committed_budget` for a government's committed funding.
   * Null where there is no figure.
   */
  costBasis: 'application' | 'committed_budget' | null;
  /**
   * A cost BAND, where the publisher gives one instead of a figure.
   *
   * A planned investment carries "Up to $250 million" and no budget; a
   * committed one carries a budget and no band. They are alternatives, and
   * printing a band as an amount states a commitment nobody made.
   */
  statedCostRange: string | null;
  /**
   * Which governments contribute, where a register names them.
   *
   * Empty on every DA entry — an application register publishes no funder. On
   * a programme entry it is the set of partners and never a split, because the
   * columns are markers rather than amounts.
   */
  fundingPartners: string[];
  /**
   * What the publisher says about WHEN this will be delivered.
   *
   * Null on every entry from a DA register, which publishes decision and
   * lodgement dates and no delivery date at all. The brief requires unknown
   * timing to be explicit, so this is rendered as its own statement per entry
   * rather than left to a footnote at the end of the table.
   */
  statedDelivery: string | null;
  /**
   * Present ONLY for an entry that came from an application register.
   *
   * A development amended three times is one development, and the reader is
   * told it was amended rather than shown three copies of it. Null on a
   * gazetted instrument or a strategic designation, which are not
   * applications and have no window — as a sub-object rather than three
   * fields, so a reader can never take a `false` about something that was
   * never asked.
   */
  applications: {
    inWindow: number;
    amendments: number;
    /** No new application falls inside the window — it was approved earlier. */
    approvedBeforeWindow: boolean;
  } | null;
  /** The publisher and dataset. */
  source: string;
  licence: string | null;
  /** When this deployment retrieved it. */
  retrievedAt: string | null;
  /**
   * The name of an entry this one MIGHT be a second reading of — publisher,
   * layer and name all matched, and neither side published an identifier that
   * could confirm or deny it.
   *
   * It is retained rather than suppressed, because suppressing a record that
   * was never confirmed to be a duplicate destroys evidence. It is MARKED
   * because the danger is not the extra row: it is a reader or a consumer
   * adding two statements of one project together and calling the total
   * independent investment. Anything that totals must exclude a marked row.
   *
   * Null on a confirmed-distinct entry — identifiers that CONTRADICT say these
   * are two records, and calling a genuine second designation "possibly a
   * duplicate" is the same error pointing the other way.
   */
  unconfirmedDuplicateOf?: string | null;
}

export interface InfrastructureEvidence {
  items: InfrastructureItem[];
  /** Dwellings the register says are in the pipeline nearby, and over what. */
  pipelineDwellings: { total: number; rowsStating: number; window: string; council: string } | null;
  /** Aggregate stated investment, with how many rows stated one. */
  pipelineInvestment: { total: number; rowsStating: number } | null;
  /**
   * How much of the register these totals were summed from.
   *
   * `daActivityLine` already discloses a partial walk on the planning
   * controls line; the pipeline paragraph did not, and the pipeline paragraph
   * is where the money is. The Kellyville report printed "680 new dwellings …
   * $808,649,729" from **300 of the 650 applications the register stated**,
   * with nothing on the page saying so. Reading the rest gives 3,442 and
   * $2.364bn on the same counting rule — so the published figures were not
   * merely stale, they were a little over a third of the register, presented
   * as the register.
   *
   * Null where the reading carried no walk figures at all, which is a
   * different statement from a complete walk.
   */
  registerWalk: { rowsRead: number; totalStated: number } | null;
  /**
   * Why an empty list is empty, per register — as strings, for the persisted
   * record and for every caller that already reads it.
   */
  absences: string[];
  /**
   * The same absences, typed, so the prose can say which kind each one is
   * (rule 9). Derived from `absences`' own readings rather than beside them,
   * so the two can never disagree.
   */
  readings: RegisterReading[];
  /** What these registers do not reach at all (rule 5). */
  coverageLimits: string[];
  /**
   * What the forward investment programme was asked, and over what window —
   * set only where it answered WITH entries, because a programme that answered
   * with nothing is an absence and belongs in `readings` where the page prints
   * "Searched, nothing found." over it.
   */
  programmeStatement: string | null;
  retrievedAt: string | null;
  /** True when at least one register answered with something. */
  anyEvidenced: boolean;
  /** True when the enrichment never ran. */
  enrichmentMissing: boolean;
}

const INSTRUMENT_LABEL: Record<string, string> = {
  priority_development_area: 'Priority development area',
  state_development_area: 'State development area',
  coordinated_project: 'Coordinated project',
  infrastructure_designation: 'Infrastructure designation',
};

/**
 * What these two registers cannot see.
 *
 * Named on every reading, including a full one, because a list of two
 * instruments with no coverage statement reads as "these are the projects
 * around this property" — which is a claim neither register makes.
 */
export const INFRASTRUCTURE_COVERAGE_LIMITS: readonly string[] = [
  'council capital works programmes and their budgets',
  'state and federal budget infrastructure programmes',
  'transport, water, energy and health agency project announcements',
  /*
   * W3.2. The Infrastructure Priority List was not disclaimed by any of the
   * three above, and it is the register a reader is most likely to assume
   * was consulted: it is the national list of proposals Infrastructure
   * Australia has evaluated. It is NOT a budget programme — it commits no
   * money and appearing on it is not funding — so "state and federal budget
   * infrastructure programmes" does not cover it, and the entry above that
   * replaces that one when a state forward-works programme HAS been read
   * does not cover it either. It therefore stands on its own and is never
   * removed, which is why it is not folded into `coverageLimitsFor`.
   */
  NATIONAL_PIPELINE_COVERAGE_PHRASE,
  'projects outside the property\u2019s local government area',
];

/**
 * The two absences, as a reader is told them (rule 9). Defined once in
 * `adviserVoice.pure.ts`, because the supply block prints them too, and
 * re-exported here for every existing importer.
 */
export { REGISTER_CHECKED_EMPTY, REGISTER_NOT_COVERED };

/**
 * The same list, with the programme limit removed where a programme WAS read.
 *
 * A coverage statement has to be true of this reading rather than of the
 * registers in general: once the state's own forward investment programme has
 * been read at this coordinate, saying it is not covered is false, and a false
 * limitation teaches a reader to discount the true ones. The two entries a
 * programme reading does not close stay — a state programme is not a council
 * capital works programme and is not an agency announcement.
 */
export function coverageLimitsFor(programmeRead: boolean): string[] {
  if (!programmeRead) return [...INFRASTRUCTURE_COVERAGE_LIMITS];
  return INFRASTRUCTURE_COVERAGE_LIMITS
    .filter((l) => l !== 'state and federal budget infrastructure programmes')
    .concat('federal budget programmes, and state programmes outside transport and roads');
}

export interface InfrastructureEvidenceInput {
  /** `enhancedData.planningData` — the planning service's answer, or absent. */
  planningData?: unknown;
}

export function buildInfrastructureEvidence(input: InfrastructureEvidenceInput): InfrastructureEvidence {
  const data = isRecord(input.planningData) ? input.planningData : null;
  const retrievedAt = data ? str(data.fetchedAt) : null;
  const jurisdiction = data ? str(data.jurisdiction) : null;
  const items: InfrastructureItem[] = [];
  const readings: RegisterReading[] = [];

  /*
   * A register that answered nothing, filed by whether it was asked (rule 9).
   *
   * `none_at_point` is the ONLY status that means the question was put and
   * the answer was "nothing here". `not_served`, `not_integrated`,
   * `licence_restricted` and `unavailable` all mean no question was put, for
   * four different reasons — and a report that describes any of them as a
   * register it searched has stated something false about its own evidence.
   */
  const note = (
    register: RegisterReading['register'],
    block: Record<string, unknown>,
    fallback: string,
  ): void => {
    readings.push({
      register,
      reading: str(block.status) === 'none_at_point' ? 'searched_empty' : 'not_searched',
      // The service's words, unless they describe our build rather than the
      // register — `serviceNote.pure.ts` says why.
      note: readerNote(str(block.note), jurisdiction) ?? fallback,
    });
  };

  /*
   * ── one designation, one row (rule 10) ───────────────────────────────────
   *
   * The two Queensland sources overlap, and the overlap is exact rather than
   * incidental. `QLD_INSTRUMENT_LAYERS` queries layers 25, 30, 35 and 40 of
   * `PlanningCadastre/StatePlanning/MapServer` one at a time; the constraint
   * register calls `identify` on the SAME MapServer with `layers: all`, so a
   * priority development area at the point comes back from both, and
   * `classify()` files the second copy under `growthArea` / `context`.
   *
   * Executed 18 Sep 2026: one designation produced two rows disagreeing on
   * every cell but the name — `Priority development area` / `Declared` /
   * `PLA-MBH` beside `Growth / priority area` / `Statutory` / `Wide Bay
   * Burnett Regional Plan`. That is the legacy report's own failure, the one
   * `compassDocumentContract` was written against: three copies of one zoning
   * section on one lot disagreeing on every control.
   *
   * §9's rule is **confirm project identity before deduplication**, so this
   * merges on identity and never on resemblance: the SAME publisher's source
   * string, and the publisher's own name equal after trimming, case-folding
   * and collapsing internal whitespace. No token overlap, no edit distance,
   * no stemming — two projects that merely read alike are two projects, and
   * a report that merged them would have deleted one.
   *
   * The instrument reading wins because it is the more specific read: it
   * queries the named layer and parses that layer's own fields (`pda_name`,
   * `pda_status`, `gazetted_date`), where the identify-all row is a generic
   * parse of whatever the server volunteered. Nothing is merged across
   * sources — a council development application and a state instrument are
   * never one item however alike their names — and the suppression is silent,
   * because a client document does not narrate its own production.
   */
  const norm = (v: string): string => v.trim().toLowerCase().replace(/\s+/g, ' ');
  /**
   * The four StatePlanning layers the instruments probe reads one at a time,
   * and which of its `kind` values each answers with.
   *
   * This is the **documented equivalent mapping**: it says, layer by layer,
   * that a `context` reading carrying `sourceLayer: 35` and an instrument
   * reading carrying `kind: 'priority_development_area'` came out of the same
   * register. It is written from `QLD_INSTRUMENT_LAYERS` in
   * `planningSources.pure.ts`, and a spec asserts the two agree — a layer
   * added there and not here would stop merging rather than start merging the
   * wrong thing, which is the safe direction.
   */
  const INSTRUMENT_LAYER_KIND: Readonly<Record<number, string>> = {
    25: 'coordinated_project',
    30: 'infrastructure_designation',
    35: 'priority_development_area',
    40: 'state_development_area',
  };
  /**
   * The publisher's own identifiers for one reading — the finer question a
   * layer cannot answer, and the reason they are two fields rather than one.
   *
   * A layer id says which REGISTER a feature came out of. Inside that
   * register a publisher issues up to two identifiers, and they identify
   * different things: `feature` is this designation's own reference or code
   * (`PDA-MBH`, `DDO1`, `HO544`), `instrument` is the planning instrument it
   * sits UNDER (`Wide Bay Burnett Regional Plan`). Comparing one against the
   * other is the "publisher plus name" mistake a level down — two identifiers
   * that identify different things will disagree on every honest pair — so
   * each channel is judged only against its own, and only where both sides
   * published it.
   *
   * Measured 18 Sep 2026: `parseQldInstrument` emits NEITHER on any of its
   * four kinds, and a `PlanningConstraintReading` carries both. So today
   * every real match is "one side publishes none", which merges — and the
   * guard is written now because it has to be in place the moment either
   * parser starts publishing one.
   */
  interface PublisherIdentifiers {
    feature: string | null;
    instrument: string | null;
  }
  const identifiersOf = (r: Record<string, unknown>): PublisherIdentifiers => ({
    feature: str(r.reference) ?? str(r.code),
    instrument: str(r.instrument),
  });
  /**
   * Whether two readings are CONFIRMED to be the same record.
   *
   * This asks for a match, not merely the absence of a contradiction — which
   * is the correction of 18 Sep 2026 and the whole of the difference. The
   * first version merged wherever nothing disagreed, so two readings that
   * published NO identifier between them were suppressed to one on the
   * strength of publisher, layer and name. Those three are a CANDIDATE. A
   * missing identifier confirms nothing, and suppressing a record on it
   * destroys evidence to tidy a list.
   *
   * So: a match on either channel confirms; a disagreement on either channel
   * refuses outright, even if the other channel agrees; and nothing published
   * on either side is `unconfirmed`, which retains both rows.
   *
   * Each channel is still judged against its own — a feature reference against
   * a feature reference, the instrument a designation sits under against the
   * same — because comparing across them is the publisher-plus-name mistake a
   * level down and would refuse every honest pair.
   */
  type IdentityVerdict = 'confirmed' | 'contradicted' | 'unconfirmed';
  const compareIdentity = (a: PublisherIdentifiers, b: PublisherIdentifiers): IdentityVerdict => {
    const channels: Array<[string | null, string | null]> = [
      [a.feature, b.feature],
      [a.instrument, b.instrument],
    ];
    let matched = false;
    for (const [x, y] of channels) {
      if (x === null || y === null) continue;
      if (norm(x) !== norm(y)) return 'contradicted';
      matched = true;
    }
    return matched ? 'confirmed' : 'unconfirmed';
  };
  /**
   * Each instrument reading, keyed by what can actually identify it and
   * carrying WHERE it landed in `items` — because a candidate match has to be
   * able to read that row's own identifiers before refusing or accepting the
   * merge, and to fill its gaps afterwards.
   */
  const instrumentIdentities = new Map<string, { at: number; ids: PublisherIdentifiers }>();
  const identityOf = (source: string, kind: string, name: string): string =>
    `${norm(source)}\u0000${kind}\u0000${norm(name)}`;

  // ── state development instruments, at the property's own coordinate ───────
  const inst = isRecord(data?.developmentInstruments) ? data!.developmentInstruments : null;
  if (inst?.status === 'ok' && Array.isArray(inst.instruments)) {
    const source = str(inst.source) ?? 'state planning layers';
    const licence = str(inst.licence);
    for (const raw of inst.instruments as unknown[]) {
      if (!isRecord(raw)) continue;
      const name = str(raw.name);
      if (!name) continue;
      const statedStatus = str(raw.status);
      const instrumentKind = str(raw.kind);
      const probeSource = str(inst.source);
      items.push({
        name,
        kind: INSTRUMENT_LABEL[str(raw.kind) ?? ''] ?? (str(raw.kind) ?? 'Instrument'),
        statedStatus,
        standing: readDeliveryStanding(statedStatus),
        // A gazettal is a declaration, not a delivery. Rule 3.
        dateLabel: str(raw.gazetted) ? 'Gazetted' : null,
        date: str(raw.gazetted),
        where: str(raw.detail),
        // An instrument applies over an area rather than to an address, and
        // no layer read here publishes a delivery date or a cost.
        address: null,
        reference: str(raw.reference),
        statedCost: null,
        costBasis: null,
        statedCostRange: null,
        fundingPartners: [],
        statedDelivery: null,
        applications: null,
        source,
        licence,
        retrievedAt,
      });
      // Only a reading that names BOTH its publisher and its kind can be
      // identified. `probeSource` is the probe's own, never the fallback.
      if (probeSource && instrumentKind) {
        instrumentIdentities.set(
          identityOf(probeSource, instrumentKind, name),
          { at: items.length - 1, ids: identifiersOf(raw) },
        );
      }
    }
  } else if (inst) {
    note('development instruments', inst, uncheckedSentence('State-level development designations', 'Any that affect the property will appear on the local government’s planning certificate.'));
  }

  /*
   * ── the strategic designations the point sits inside ─────────────────────
   *
   * Added 17 Sep 2026, and the measurement is why. The instruments probe asks
   * four named Queensland layers — priority development areas, state
   * development areas, coordinated projects, infrastructure designations — and
   * at 262 Pallas Street none of them matched, so the report said "the
   * property lies inside no declared priority development area, state
   * development area, coordinated project or infrastructure designation" and
   * stopped. True, and it left out what the SAME service returns at the SAME
   * coordinate: `Maryborough Priority Living Area`, inside the `Wide Bay
   * Burnett Regional Plan`, **Legal status: Statutory, Version: December
   * 2023**.
   *
   * A regional plan does not control what is built on one lot, and nothing
   * here says it does — `standing` is null and the kind is the register's own
   * word. What it does is state, in the publisher's own instrument, what the
   * area is planned to BECOME, which is the most reliable published statement
   * about long-term direction a report of this kind can carry. The legacy
   * long-form report filled that space by inventing a station, a freeway
   * extension and a dwelling target.
   *
   * It is drawn from the constraint register's `context` readings alone.
   * Anything the register filed as a hazard, a development control or a
   * protected value belongs to the planning section, not to this one.
   */
  const contextual = Array.isArray(data?.constraints) ? data!.constraints as unknown[] : [];
  for (const raw of contextual) {
    if (!isRecord(raw)) continue;
    if (str(raw.kind) !== 'context') continue;
    const name = str(raw.label);
    if (!name) continue;
    /*
     * Rule 10: the same publisher's same designation, already carried by the
     * layer-specific read above — and identity has to be PROVEN, not inferred
     * from a shared label.
     *
     * Three things must all hold, and any one of them missing means no merge:
     *
     *   1. the context reading names its own publisher — `?? 'state planning
     *      layers'` is a FALLBACK, and two readings that both fell back to it
     *      share a string rather than a source. A null source identifies
     *      nothing.
     *   2. it carries the publisher's own `sourceLayer`, and that layer is one
     *      of the four the instruments probe reads, mapped to the kind that
     *      probe would have returned for it. This is the stable identifier:
     *      a label is what a feature is called, a layer id is which register
     *      it came out of.
     *   3. the publisher's own names match exactly, after trim, case-fold and
     *      whitespace collapse.
     *
     * Publisher plus name was the first version of this rule and it was not
     * enough: two designations could share a name across registers, and two
     * readings with no source could both wear the fallback and look identical.
     * Where identity cannot be proven the row STANDS — a visible duplicate is
     * a presentation fault, and merging two different designations deletes a
     * real one.
     *
     * And a fourth thing REFUSES a match the other three admit. A layer
     * identifies a COLLECTION: two priority development areas are both layer
     * 35, and a name can be reused. So publisher + layer + name is a
     * CANDIDATE, and the publisher's own identifiers settle it — each channel
     * judged against its own (`identifiersContradict`), because a feature
     * reference and the instrument a designation sits under are two different
     * identifiers and comparing them across would refuse every honest pair.
     *
     * Where a channel both sides published DISAGREES, the two rows stand,
     * each keeping its own reference, source, licence and currency, so the
     * reader can see the disagreement and look either up. Where no channel
     * contradicts, the merge is taken — and then it EARNS something: the
     * surviving layer-specific row is filled from the suppressed one wherever
     * it held nothing, so suppressing a duplicate never costs the document a
     * fact. Nothing already stated is overwritten, and no status word
     * travels: a designation's standing is not an instrument's.
     */
    const contextSource = str(raw.source);
    const contextReference = str(raw.instrument);
    const contextRegion = str(raw.region);
    const contextCurrency = str(raw.currencyDate);
    const contextLicence = str(raw.licence);
    const layerKind = typeof raw.sourceLayer === 'number'
      ? INSTRUMENT_LAYER_KIND[raw.sourceLayer] ?? null : null;
    const candidate = contextSource && layerKind
      ? instrumentIdentities.get(identityOf(contextSource, layerKind, name))
      : undefined;
    const verdict = candidate === undefined
      ? 'contradicted' as IdentityVerdict
      : compareIdentity(candidate.ids, identifiersOf(raw));
    if (candidate !== undefined && verdict === 'confirmed') {
      // Suppress, and fill the survivor from what it held nothing for, so a
      // confirmed merge never costs the document a fact. Never overwrite.
      const held = items[candidate.at];
      if (held.reference === null && contextReference !== null) {
        held.reference = contextReference;
      }
      if (held.where === null && contextRegion !== null) held.where = contextRegion;
      if (held.date === null && contextCurrency !== null) {
        held.date = contextCurrency;
        held.dateLabel = 'Current at';
      }
      if (held.licence === null && contextLicence !== null) held.licence = contextLicence;
      continue;
    }
    /*
     * Not confirmed. The row STANDS, and where it was a candidate that nothing
     * confirmed it is marked so — because the danger of retaining an
     * unconfirmed duplicate is not the extra row, it is a reader or a consumer
     * adding two statements of the same project together and calling the total
     * independent investment. `unconfirmedDuplicateOf` names the row it might
     * be, so a total can exclude it and a reader is told why both are there.
     *
     * A contradiction is NOT marked: the identifiers said these are two
     * records, and labelling a genuine second designation "possibly a
     * duplicate" would be the same error pointing the other way.
     */
    const unconfirmedDuplicateOf = candidate !== undefined && verdict === 'unconfirmed'
      ? items[candidate.at].name : null;
    const family = str(raw.family);
    items.push({
      name,
      kind: family === 'regionalPlan' ? 'Regional plan'
        : family === 'growthArea' ? 'Growth / priority area'
          : 'Strategic designation',
      /*
       * The publisher's own word for the instrument's standing, and NOT
       * `detail`.
       *
       * `detail` is a join of everything the layer published — legal status,
       * version, region, hazard class — which reads correctly in the planning
       * register's "What the register returned" column and is wrong in a
       * column called **Status**. On 262 Pallas Street the Priority Living
       * Area's `detail` is `Wide Bay Burnett`, so the first render of this
       * table gave a project the status "Wide Bay Burnett", which is a region.
       *
       * Where the register stated no standing the cell is empty, and the
       * renderer prints an em dash: a designation with no published standing
       * is a real state, and inventing one is the defect above in the other
       * direction.
       */
      statedStatus: str(raw.standingLabel),
      // A designation is not a project and has no delivery standing. Reading
      // one as `approved` would put a plan in the same column as a road under
      // construction.
      standing: null,
      dateLabel: contextCurrency ? 'Current at' : null,
      date: contextCurrency,
      // The region the register named — a place. It used to be `instrument`,
      // which is a layer or plan name: "Priority Living Area" is not a WHERE,
      // and on the regional-plan row it repeated the project's own name.
      where: contextRegion,
      // A designation covers an area rather than an address, states no cost,
      // and publishes no delivery date — it says what the area is planned to
      // BECOME, on a horizon nobody has dated.
      address: null,
      reference: contextReference,
      statedCost: null,
      costBasis: null,
      statedCostRange: null,
      fundingPartners: [],
      statedDelivery: null,
      applications: null,
      source: contextSource ?? 'state planning layers',
      licence: contextLicence,
      retrievedAt,
      unconfirmedDuplicateOf,
    });
  }

  // ── the council's own development-application register ────────────────────
  const act = isRecord(data?.developmentActivity) ? data!.developmentActivity : null;
  const summary = act?.status === 'ok' && isRecord(act.summary) ? act.summary : null;
  let pipelineDwellings: InfrastructureEvidence['pipelineDwellings'] = null;
  let pipelineInvestment: InfrastructureEvidence['pipelineInvestment'] = null;
  let registerWalk: InfrastructureEvidence['registerWalk'] = null;
  if (summary) {
    const source = str(act?.source) ?? 'the council development-application register';
    const licence = str(act?.licence);
    const council = str(summary.councilName) ?? 'the council';
    // The reader's date, not the register's. This printed the ISO pair
    // verbatim — "2026-03-18 to 2026-09-17" — in a sentence otherwise written
    // in English, on the same page as `27 Feb 2026` and `7 Aug 2026`. Two
    // date formats in one document is a raw marker like any other.
    const window = [auDate(str(summary.periodFrom)), auDate(str(summary.periodTo))]
      .filter(Boolean).join(' to ');
    // NEW applications only. A modification restates the development it
    // modifies — the register carries the whole cost and the whole dwelling
    // count on the modification row, not the delta — so the two may never be
    // added. Measured on this register 17 Sep 2026 (The Hills Shire, 659
    // applications over six months): summing them stated $2.367bn against
    // $1.177bn of genuinely new proposals, and 3,447 dwellings against 1,412.
    // See `classifyApplicationType`.
    const newApps = isRecord(summary.newApplications) ? summary.newApplications : null;
    const dwellings = num(newApps?.newDwellingsTotal);
    if (dwellings !== null) {
      pipelineDwellings = {
        total: dwellings,
        rowsStating: num(newApps?.rowsWithDwellings) ?? 0,
        window,
        council,
      };
    }
    const cost = num(newApps?.statedCostTotal);
    if (cost !== null) {
      pipelineInvestment = { total: cost, rowsStating: num(newApps?.rowsWithCost) ?? 0 };
    }
    const rowsRead = num(summary.rowsRead);
    const totalStated = num(summary.totalInPeriod);
    if (rowsRead !== null && totalStated !== null) registerWalk = { rowsRead, totalStated };
    // One entry per DEVELOPMENT. `summariseDaRows` resolves an amendment to
    // the parent application it amends (see `DaDevelopment`), because the
    // list used to rank ROWS: three of the five largest "projects" on the
    // rendered Kellyville report were 1382/2025/JP/A, /B and /C — one data
    // centre at 3 Brookhollow Avenue, printed three times at $93,180,778.
    for (const raw of Array.isArray(summary.largestDevelopments) ? summary.largestDevelopments as unknown[] : []) {
      if (!isRecord(raw)) continue;
      const types = Array.isArray(raw.types) ? (raw.types as unknown[]).map((t) => str(t)).filter((t): t is string => !!t) : [];
      const statedStatus = str(raw.status);
      const amendments = num(raw.amendmentsInWindow) ?? 0;
      const approvedBefore = raw.parentOutsideWindow === true;
      items.push({
        name: types.length ? types.join(', ') : 'Development application',
        reference: str(raw.reference),
        // Named for what the register holds. A development that reaches this
        // window only through its amendments was approved before it, and a
        // reader told "Development application" would read it as new. How
        // many times it was amended is the cell's business, not the kind's.
        kind: approvedBefore ? 'Approved development' : 'Development application',
        statedStatus,
        standing: readDeliveryStanding(statedStatus),
        // A determination date is when a decision was made; a lodgement date
        // is when one was asked for. Neither is a completion date (rule 3).
        dateLabel: raw.latestDateKind === 'determined'
          ? 'Determined' : raw.latestDateKind === 'lodged' ? 'Lodged' : null,
        date: str(raw.latestDate),
        where: str(raw.suburb),
        address: str(raw.address),
        statedCost: num(raw.statedCost),
        // An applicant's own stated cost of development, never funding.
        costBasis: num(raw.statedCost) === null ? null : 'application',
        statedCostRange: null,
        fundingPartners: [],
        // A DA register publishes no delivery date, for any application. Rule
        // 3 already forbids reading a decision date as a completion date; this
        // says the absence out loud per entry rather than once at the foot.
        statedDelivery: null,
        applications: {
          inWindow: num(raw.rowsInWindow) ?? 1,
          amendments,
          approvedBeforeWindow: approvedBefore,
        },
        source,
        licence,
        retrievedAt,
      });
    }
  } else if (act) {
    note('development applications', act, uncheckedSentence('Development applications', 'The council’s own application tracker shows activity near the property.'));
  }

  /*
   * ── the forward investment programme ──────────────────────────────────────
   *
   * What a government has FUNDED, as against what somebody has applied to
   * build. Everything above answers the second question, which is why
   * `INFRASTRUCTURE_COVERAGE_LIMITS` has always named budget programmes as
   * something these registers do not reach.
   *
   * It contributes entries on exactly the same terms as the other two
   * registers — the publisher's own name, the publisher's own status word, a
   * reference a reader can look up, and no date that is not a date something
   * happened. Two things are its own:
   *
   *   **A distance, measured.** §4: *"an LGA project is not automatically near
   *   the property."* The programme publishes a midpoint, so `where` states
   *   the district AND how far the investment is from this property, and
   *   `planning-data-service` has already dropped anything outside the radius.
   *
   *   **A committed budget, which a DA register cannot publish.** This is the
   *   one source here that states who is paying, so `costBasis` distinguishes
   *   it from an applicant's stated cost and `fundingPartners` names the
   *   contributors — never a split, because the columns are markers.
   */
  const programme = isRecord(data?.investmentProgramme) ? data!.investmentProgramme : null;
  let programmeStatement: string | null = null;
  if (programme?.status === 'ok' && Array.isArray(programme.investments)) {
    const source = str(programme.source) ?? 'a government investment programme';
    const licence = str(programme.licence);
    const edition = str(programme.edition);
    for (const raw of programme.investments) {
      if (!isRecord(raw)) continue;
      const name = str(raw.name);
      if (!name) continue;
      const stages = isRecord(raw.stages) ? raw.stages : {};
      const constructionStart = str(stages.constructionStart);
      const statedStatus = str(raw.status);
      const standing = programmeStanding(statedStatus, constructionStart);
      const km = num(raw.distanceKm);
      const district = str(raw.district);
      const stageLine = [
        stageSentence('Planning', str(stages.planning)),
        stageSentence('Procurement', str(stages.procurement)),
        stageSentence('Construction', constructionStart),
      ].filter(Boolean).join('; ');
      const budget = num(raw.committedBudget);
      items.push({
        name,
        reference: str(raw.reference),
        kind: standing === 'funded' ? 'Committed government investment' : 'Planned government investment',
        statedStatus,
        standing,
        // The programme states no date on which anything happened, and its
        // stage markers are expectations. Rule 3: they go in `statedDelivery`
        // with what they are, never in a date column.
        dateLabel: null,
        date: null,
        where: [
          // The programme's own district names, except "Statewide", which is
          // a scope rather than a district — "Statewide district" is not a
          // place, and the Queensland Train Manufacturing Program is one.
          district && (district.toLowerCase() === 'statewide' ? 'Statewide programme' : `${district} district`),
          km === null ? null : `${km.toFixed(1)} km from the property`,
        ].filter(Boolean).join(', ') || null,
        address: null,
        statedCost: budget,
        costBasis: budget === null ? null : 'committed_budget',
        statedCostRange: str(raw.costRange),
        fundingPartners: Array.isArray(raw.fundingPartners)
          ? raw.fundingPartners.filter((x): x is string => typeof x === 'string')
          : [],
        statedDelivery: stageLine || null,
        applications: null,
        source: edition ? `${source} ${edition}` : source,
        licence,
        retrievedAt,
      });
    }
    // A programme that ANSWERED WITH ENTRIES is not an absence, and the
    // readings list prints "Searched, nothing found." over everything in it.
    // Its statement belongs beside the table it explains, so it travels as
    // `programmeStatement` and only joins the absence list when it found
    // nothing — which is a real absence and reads correctly there.
    programmeStatement = `${source}${edition ? ` (${edition})` : ''} was checked for investments within `
      + `${num(programme.radiusKm) ?? PROGRAMME_RADIUS_KM_FALLBACK} km of the property. `
      + horizonCaveat(edition ?? 'its published window');
    if (programme.investments.length === 0) {
      readings.push({
        register: 'forward investment programme',
        reading: 'searched_empty',
        note: programmeStatement,
      });
      programmeStatement = null;
    }
  } else if (programme) {
    readings.push({
      register: 'forward investment programme',
      reading: str(programme.status) === 'none_at_point' ? 'searched_empty' : 'not_searched',
      note: readerNote(str(programme.note), jurisdiction)
        ?? uncheckedSentence('The state’s forward infrastructure programme', 'The state budget papers list the projects it funds.'),
    });
  }

  return {
    items,
    pipelineDwellings,
    pipelineInvestment,
    // The strings stay exactly what they were, in exactly the order they were
    // pushed, so the persisted record and every existing reader are unchanged.
    absences: readings.map((r) => r.note),
    readings,
    registerWalk,
    coverageLimits: coverageLimitsFor(programme?.status === 'ok'),
    programmeStatement,
    retrievedAt,
    anyEvidenced: items.length > 0 || pipelineDwellings !== null,
    enrichmentMissing: !data,
  };
}

// ---------------------------------------------------------------------------
// Rendering


const money = (v: number): string => `$${Math.round(v).toLocaleString('en-AU')}`;

/**
 * The funding cell.
 *
 * Every register this platform reads publishes a COST and no funding at all —
 * a development application states what the applicant says the work will
 * cost, which says nothing about who is paying or whether anything is
 * committed. The brief asks for funding per project, so the answer is stated
 * rather than left as an empty cell a reader fills in from the figure beside
 * it.
 */
function fundingCell(item: InfrastructureItem): string {
  // A programme entry names its contributors; a DA entry names nobody, and
  // the figure beside it is the applicant's own cost rather than investment.
  if (item.fundingPartners.length) {
    const n = item.fundingPartners;
    const named = n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
    return `${named} — contributors named, amounts per partner not published`;
  }
  if (item.costBasis === 'committed_budget') return 'Committed by the programme; contributors not named on this entry';
  return item.statedCost !== null
    ? 'Not stated — the figure is the applicant’s own cost of development'
    : 'Not stated';
}

/**
 * The cost cell.
 *
 * A committed budget, a cost BAND, or nothing — never a band printed as though
 * it were an amount. A planned investment carries "Up to $250 million" and no
 * figure, and rendering that as a number would state a commitment nobody made.
 */
function costCell(item: InfrastructureItem): string {
  if (item.statedCost !== null) {
    return item.costBasis === 'committed_budget'
      ? `${money(item.statedCost)} committed`
      : money(item.statedCost);
  }
  if (item.statedCostRange) return `${item.statedCostRange} (band, not a committed figure)`;
  return '—';
}

/**
 * The type cell, and how many times the register was asked about it again.
 *
 * Three rows for one data centre is what this replaces, so the amendments are
 * counted in the entry rather than printed as more entries.
 */
function kindCell(item: InfrastructureItem): string {
  const a = item.applications;
  if (!a || a.amendments < 1) return item.kind;
  return `${item.kind} · amended ${a.amendments} time${a.amendments === 1 ? '' : 's'} in this window`;
}

/** The status cell: the publisher's word, and the reading where one is certain. */
function statusCell(item: InfrastructureItem): string {
  if (!item.statedStatus) return 'Status not stated';
  const read = item.standing ? DELIVERY_STANDING_LABEL[item.standing] : null;
  return read && read.toLowerCase() !== item.statedStatus.toLowerCase()
    ? `${item.statedStatus} (${read})`
    : item.statedStatus;
}

/**
 * What part of the register a total was summed from, where that is not all of
 * it. Empty on a complete walk — a sentence saying "all of it" on every
 * complete reading is noise, and the figures then mean what they say.
 */
function walkNote(walk: InfrastructureEvidence['registerWalk']): string {
  if (!walk || walk.rowsRead >= walk.totalStated) return '';
  const n = (v: number) => v.toLocaleString('en-AU');
  return `Both totals were summed from ${n(walk.rowsRead)} of the ${n(walk.totalStated)} applications the register `
    + 'lists for this period, so each is a floor rather than a total: the remainder can only add to it. ';
}

/**
 * The evidenced outlook a client reads.
 *
 * Composed here rather than asked of a model, because every row is either
 * retrieved or absent and neither is a writing task.
 */
export function renderInfrastructureOutlook(evidence: InfrastructureEvidence): string {
  const lines: string[] = [];

  if (evidence.items.length) {
    // The six things the brief asks for per project: identity, location,
    // source date, recorded status, funding and published delivery timing.
    // Identity is the publisher's own reference — the table used to open on a
    // joined list of development types with no number and no address, so
    // nothing in it could be looked up. Funding and timing get columns of
    // their own precisely BECAUSE no register read here publishes either:
    // an absence stated in a footnote is an absence most readers never see.
    lines.push('| Reference | Project or instrument | Type | Status | Date recorded | Where | Stated cost | Funding | Delivery timing |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const i of evidence.items) {
      const when = i.date ? `${i.dateLabel ?? 'Recorded'} ${auDate(i.date)}` : 'No date stated';
      const where = i.address ?? i.where ?? '—';
      lines.push(
        `| ${i.reference ?? '—'} | ${i.name} | ${kindCell(i)} | ${statusCell(i)} | ${when} | ${where} | `
        + `${costCell(i)} | ${fundingCell(i)} | `
        + `${i.statedDelivery ?? 'Not published'} |`,
      );
    }
    lines.push('');
    /*
     * An unconfirmed duplicate is disclosed, not hidden and not merged.
     *
     * Both readings are on the page because neither publisher issued an
     * identifier that could confirm they are one record, and suppressing on a
     * name would destroy a real designation. Saying so is what stops a reader
     * adding the two together — which is the only way an extra row does harm.
     */
    const unconfirmed = evidence.items.filter((i) => i.unconfirmedDuplicateOf);
    if (unconfirmed.length) {
      const pairs = unconfirmed
        .map((i) => `"${i.name}" (${i.source}) beside "${i.unconfirmedDuplicateOf}"`);
      lines.push(
        `**Two readings that may be one project.** ${pairs.join('; ')}. `
        + 'Both sources describe a designation of the same name at the property, and neither '
        + 'published a reference that would confirm they are the same record — so both are '
        + 'listed rather than one being dropped. **Do not add their figures together**: they may '
        + 'be one project counted twice, and no total in this report treats them as independent.',
        '',
      );
    }
    const sources = [...new Set(evidence.items.map((i) => `${i.source}${i.licence ? ` (${i.licence})` : ''}`))];
    const accessed = auDate(evidence.retrievedAt);
    lines.push(`Sources: ${sources.join('; ')}${accessed ? `, accessed ${accessed}` : ''}.`);
    lines.push('');

    /*
     * What the forward investment programme was asked, and over what window.
     *
     * Beside the table it explains rather than in the absence list, because
     * that list prints "Searched, nothing found." over everything in it and
     * this programme found four things. Its window is the load-bearing part:
     * a four-year programme read as a ten-year outlook is §4's own warning,
     * and the caveat says which years it covers and that it dates no
     * completion at all.
     */
    if (evidence.programmeStatement) {
      lines.push(`**The forward investment programme.** ${evidence.programmeStatement}`, '');
    }

    /*
     * How to count this table, said on the page.
     *
     * `summariseDaRows` already resolves an amendment to the development it
     * amends, so the table is right — and the RENDERED Kellyville report still
     * read "**Three separate data centre and high-technology industry projects
     * in Norwest**, each with stated costs of **$93.18 million**", drew a
     * timeline stop saying "three approvals at $93.18m", and put "three
     * determined Norwest applications each at $93,180,778" in its risk
     * register. There is ONE data centre: PAN-619414, PAN-643600 and PAN-638082
     * carry the same coordinate (150.968022088, -33.73252699), the same lot
     * (2021/DP831173), the same address and the same $93,180,778, and the
     * council numbers are 1382/2025/JP/A, /B and /C.
     *
     * The fix that resolved them into one row is also what invites the error
     * now: a cell reading "amended 3 times in this window" is a reasonable
     * thing to read as three approvals. Saying what the count IS costs one
     * sentence and reaches the reader as well as the model — the prose above
     * was wrong by about $186 million, and a reader had nothing on the page to
     * check it against.
     */
    const withApps = evidence.items.filter((i) => i.applications);
    if (withApps.length) {
      const rowsBehind = withApps.reduce((n, i) => n + (i.applications?.inWindow ?? 1), 0);
      const amended = withApps.filter((i) => (i.applications?.amendments ?? 0) > 0).length;
      const plural = (n: number, one: string) => `${n.toLocaleString('en-AU')} ${one}${n === 1 ? '' : 's'}`;
      lines.push(
        `**How to count these.** ${plural(withApps.length, 'development')} from the council's application register `
        + `${withApps.length === 1 ? 'is' : 'are'} listed above, drawn from ${plural(rowsBehind, 'lodged application')}.`
        + (amended
          ? ' An amendment restates the development it amends — the register carries the whole cost and the whole'
            + ' dwelling count on the amendment rather than the change — so a development amended three times'
            + ' is one development, its stated cost is counted once, and the amendment count is not a number of'
            + ' projects.'
          : ''),
      );
      lines.push('');
    }
  }

  if (evidence.pipelineDwellings) {
    const d = evidence.pipelineDwellings;
    /**
     * Two counts, and each says what it counts.
     *
     * This read "680 new dwellings across 171 applications … with
     * $808,649,729 of stated development cost across 278 applications" — one
     * window, one council, two different application counts, and nothing
     * saying why they differ. A reader cannot tell whether 171 or 278 is the
     * number of applications, and the document looked as though it could not
     * add up.
     *
     * It always could. `rowsStating` is the rows that STATED that figure, and
     * an application need state neither a dwelling count nor a cost of
     * development — so the denominators are genuinely different and the
     * arithmetic was never wrong. Only the sentence was. Saying what each
     * count is makes both readings true of the same window.
     */
    const inv = evidence.pipelineInvestment;
    const apps = (n: number) => `${n.toLocaleString('en-AU')} application${n === 1 ? '' : 's'}`;
    lines.push(
      `**Dwellings in the development pipeline.** ${d.total.toLocaleString('en-AU')} new dwellings were stated on `
      + `the ${apps(d.rowsStating)} that gave a dwelling count in ${d.council}${d.window ? `, ${d.window}` : ''}`
      + `${inv
        ? `, and ${money(inv.total)} of development cost on the ${apps(inv.rowsStating)} that gave a cost`
        : ''}. `
      + `${inv && inv.rowsStating !== d.rowsStating
        ? 'The two counts differ because an application need state neither figure, and many state only one. '
        : ''}`
      /*
       * And how much of the register they were summed from.
       *
       * A sum of non-negative figures over part of a set is a FLOOR, which is
       * the honest word: reading the rest can only raise it. The rendered
       * Kellyville report printed these two totals from 300 of 650 rows with
       * nothing saying so, and the complete walk on the same counting rule is
       * 3,442 dwellings and $2.364bn — so "680" and "$808,649,729" were not a
       * stale reading of the area, they were a third of the register
       * presented as the register.
       */
      + `${walkNote(evidence.registerWalk)}`
      + 'That is activity in the local government area, not at this address, and it reads both ways: it is a sign of '
      + 'confidence in the area and it is competing supply for a landlord letting a comparable dwelling.',
    );
    lines.push('');
  }

  /*
   * Each absence under the heading that is true of it (rule 9).
   *
   * Every one of these used to read "**Not retrieved.**", which is right for a
   * register nobody could ask and wrong for one that was asked and answered
   * "nothing here" — the Queensland layers were checked at this coordinate and
   * matched none of the four. Printing one heading over both is what let the
   * prose beside the table call an unsearchable register one of "the registers
   * searched".
   */
  for (const r of evidence.readings) {
    lines.push(`**${r.reading === 'searched_empty' ? REGISTER_CHECKED_EMPTY : REGISTER_NOT_COVERED}** ${r.note}`);
    lines.push('');
  }

  // Rule 5, stated whether the list is long or empty — once, here, in the
  // section that owns the subject (`DISCLOSURE_HOMES.infrastructure`).
  //
  // Said as a statement about what WAS checked only where something was: a
  // Western Australian property has no state source checked at all, and "the
  // entries above come from the state's registers, checked for the property"
  // over an empty list is a claim of a search that never happened.
  const anyChecked = evidence.items.length > 0 || evidence.readings.some((r) => r.reading === 'searched_empty');
  lines.push(
    (anyChecked
      ? '**What these searches cover.** The entries above come from the state\'s published planning and '
        + 'development records, checked for the property and its local government area. They do not include '
      : '**What this section covers.** None of the state\'s published planning and development records is '
        + 'covered by this report for this property, and nor are ')
    + `${evidence.coverageLimits.join('; ')}. A short list is therefore not a finding that nothing is planned `
    + 'nearby, and it is not a basis for rating infrastructure risk as low: much of an area\u2019s '
    + 'infrastructure is recorded in those other sources, and they are worth reading before exchange.',
  );
  lines.push('');
  lines.push(
    '**What a status means.** Each status above is the publisher\'s own word. An approval is not funding, funding is '
    + 'not a start on site, and a date recorded above is the date something was decided or declared — not a '
    + 'completion date. No delivery date is stated here unless a publisher stated one.',
  );

  /*
   * What each KIND of finding means, what it does not tell a reader, and what
   * to do about it (S5/S6 §4, the Lot 20427 treatment).
   *
   * The two paragraphs above explain the VOCABULARY and the COVERAGE, which
   * are both true and neither of which is what to DO. A reader handed a row
   * reading "Development application · Determined · $93,180,778" has a
   * retrieval and no way to act on it.
   *
   * Only the kinds the table actually drew, because a guide to an entry the
   * reader is not looking at is noise and the page budget is real. Nothing in
   * it is about this property — see the head of `infrastructureGuide`.
   */
  const guides = guidesForKinds(evidence.items.map((i) => i.kind));
  if (guides.length) {
    lines.push('');
    lines.push(`**${INFRASTRUCTURE_GUIDE_LEAD_IN}**`);
    lines.push('');
    for (const [kind, g] of guides) {
      lines.push(`*${kind}.* ${g.what} **What it does not tell you:** ${g.limits} `
        + `**Next step:** ${g.next}`);
      lines.push('');
    }
  }
  // An absence is a finding too, and it is the one a reader is most often
  // given with nothing to do about it.
  if (evidence.readings.some((r) => r.reading === 'not_searched')) {
    if (!guides.length) lines.push('', `**${INFRASTRUCTURE_GUIDE_LEAD_IN}**`, '');
    lines.push(`*A source this report does not cover.* ${ABSENCE_GUIDE.what} `
      + `**What it does not tell you:** ${ABSENCE_GUIDE.limits} **Next step:** ${ABSENCE_GUIDE.next}`);
  }


  return lines.join('\n');
}

/**
 * The rating prohibition, in the words the model is handed.
 *
 * Rules 7 and 8 of this module's header. It is one string because the two
 * branches below need the identical prohibition — a short list and an empty
 * one are the same mistake waiting to be made — and two copies of a rule is
 * how one screen comes to warn about something the other does not.
 */
/**
 * The two rules, composed from the coverage list rather than restating it.
 *
 * Both halves of this were wrong, and each in a way the other hid.
 *
 * It was a module-level constant carrying a HAND-WRITTEN paraphrase of
 * `INFRASTRUCTURE_COVERAGE_LIMITS` — "council capital works, budget
 * programmes and agency announcements" — so extending the authoritative list
 * left the prose rule quietly describing the old one. That is
 * `riskRegisterInstruction`'s defect exactly: one declaration, two verbatim
 * copies, four paragraphs of drift before anybody looked.
 *
 * And it named "the coverage sentence above" in the branch where **nothing
 * was retrieved**, which draws no table and no coverage paragraph — a rule
 * pointing at a sentence that is not on the page, which is a rule a model
 * reasons its way around. So where the paragraph is drawn the rule points at
 * it, and where it is not the rule states the limits itself.
 *
 * Joined with semicolons, not commas: three of the five entries contain a
 * comma of their own, and a five-item comma list reading "council capital
 * works programmes and their budgets, state and federal budget infrastructure
 * programmes, transport, water, energy and health agency project
 * announcements, …" has no recoverable structure.
 */
function noRatingFromAnAbsence(
  coverageLimits: readonly string[],
  coverageParagraphDrawn: boolean,
): [string, string] {
  const named = coverageLimits.join('; ');
  const where = coverageParagraphDrawn
    ? `and the coverage paragraph under the table names what these searches do not include (${named})`
    : `and these searches do not include ${named}`;
  return [
    'An absence may NOT be rated. Where a risk register, a scorecard, a SWOT table, a heat map or any other '
    + 'rating gives infrastructure a row, the rating cell reads "Not assessed" and the row says in a few words '
    + `that nothing was identified and points to the ${DISCLOSURE_HOMES.infrastructure.sectionName} section. `
    + 'Never rate it Low, Minimal, Limited, Negligible, Favourable or any '
    + 'other reassuring value, and never file it as a strength or an opportunity. A search that found '
    + 'nothing has '
    + `measured the SEARCH, not the area — ${where}, which is where much of an area’s `
    + 'infrastructure is actually recorded.',
    'An evidence, confidence or verification note describes the SEARCH and never the conclusion beside it. '
    + '"Verified" may be written of a source that was checked and records nothing at the property, and may NOT '
    + 'be written of a rating, an outlook, a recommendation or any inference drawn from it. Where the '
    + 'conclusion is yours rather than the source’s, say so in those words.',
  ];
}

/**
 * How each source that returned nothing must be described (rule 9).
 *
 * A source checked for this property and a source this report never consulted
 * are two different statements, and a report that calls the second one "a
 * register searched" has misdescribed its own evidence. The sentences are
 * generated per reading rather than written once, so a jurisdiction where both
 * kinds occur gets both.
 */
function registerSentences(readings: readonly RegisterReading[]): string[] {
  return readings.map((r, i) => r.reading === 'searched_empty'
    ? `1${String.fromCharCode(97 + i)}. The ${r.register} source WAS checked for this property and records nothing `
      + `here: "${r.note}" You may say it was checked and records nothing. That is true of that source at this `
      + 'property and of nothing else.'
    : `1${String.fromCharCode(97 + i)}. The ${r.register} source is NOT covered by this report: "${r.note}" Do NOT `
      + 'write that it was checked, that it returned nothing, or that nothing was found in it. Nothing about '
      + 'the area follows from it; where it matters, say where the client can check it.');
}

/** The rules the prose beside the table must obey. */
export function infrastructureRules(evidence: InfrastructureEvidence): string {
  const limits = evidence.coverageLimits.join('; ');
  if (evidence.enrichmentMissing || !evidence.anyEvidenced) {
    return [
      'INFRASTRUCTURE — nothing was identified for this property. The prohibitions below bind every section, '
      + 'including risk registers, scorecards, SWOT tables, checklists, summaries and verdicts, and they '
      + 'override anything a live web search returns.',
      `1. ${inHomeSection('infrastructure')} say, in a sentence or two, that our searches of the state\u2019s `
      + 'published planning and development registers identified no major project or development '
      + `designation affecting the property; that those searches do not include ${limits}; and where the client `
      + 'can read them (the council\u2019s capital works programme and development-application tracker, and the '
      + `state budget papers). ${elsewhereOnly('infrastructure')}`,
      ...registerSentences(evidence.readings),
      '2. Do NOT name a project, a rail line, a station, a hospital, a road upgrade, a town-centre renewal or a '
      + 'delivery horizon — not from a budget page, a news article or an agency media release found by search. '
      + 'Do NOT draw a `{{timeline: …}}` pipeline. There is nothing to put in it.',
      '3. Do NOT say that infrastructure supports, drives or underwrites capital growth for this property. That is '
      + 'a causal claim, and there is no project here to hang it on.',
      // No table was drawn here, so the rule states the limits rather than
      // pointing at a paragraph the page does not carry.
      `4. ${noRatingFromAnAbsence(evidence.coverageLimits, false)[0]}`,
      `5. ${noRatingFromAnAbsence(evidence.coverageLimits, false)[1]}`,
    ].join('\n');
  }
  return [
    'INFRASTRUCTURE — the prohibitions below bind every section and override any example elsewhere in this '
    + 'prompt AND anything a live web search returns:',
    '1. The evidenced table above is supplied complete. Name only the projects in it. Do NOT add a rail line, a '
    + 'station, a hospital, a road upgrade or a town-centre renewal that is not in it — including one found by '
    + 'live web search — and do not invent a bracketed placeholder for one.',
    '2. Use each item\'s status as the table states it. An approval is not funding, funding is not a start on site, '
    + 'and none of them is a completion. Do NOT state or imply a completion date; the dates above are dates a '
    + 'decision or declaration was recorded.',
    '3. Do NOT quantify an uplift, a percentage or a dollar effect on value from any project, and do not assert '
    + 'that a project will raise prices or rents. Describe what is proposed or approved and let the reader weigh it.',
    '4. Dwellings in the pipeline are competing supply as well as a sign of confidence. Say both.',
    '5. Draw a `{{timeline: …}}` only from items in the table, and label each stop with what the table\u2019s '
    + 'date IS — "Determined Jul 2026", "Lodged Sep 2026", "Gazetted 2023". A timeline BUCKET is a delivery '
    + 'horizon and this table carries none, so never place an item in "0-2y", "3-5y", "5y+" or any other future '
    + 'bucket: that states a completion the register did not publish. Where every date in the table is a decision '
    + 'date, draw no horizon timeline at all, and if the table carries no dates, draw no timeline.',
    '4a. Where the paragraph under the table says the totals were summed from part of the register, say so '
    + 'whenever you use either figure, and call it a floor rather than a total. Do NOT present a partial sum as '
    + 'the area\u2019s development activity, and do not compare it with a figure read over a different share of '
    + 'the register.',
    '5a. An amendment is NOT another project. A row reading "amended 3 times in this window" is ONE development '
    + 'the register was asked about again; the applications behind it share an address, a lot and a cost, and the '
    + 'register carries the WHOLE cost on each row rather than the change. Never turn an amendment count into a '
    + 'number of projects, never multiply a stated cost by it, and never total the table by counting a '
    + 'development\u2019s cost once per amendment. The number of developments is the number of ROWS above, which '
    + 'the paragraph under the table states.',
    `6. ${inHomeSection('infrastructure')} state the coverage limitation once, in your own words, from the `
    + `paragraph under the table: these searches do not include ${limits}. ${elsewhereOnly('infrastructure')} `
    + 'A short list is a short search.',
    `7. ${noRatingFromAnAbsence(evidence.coverageLimits, true)[0]} A SHORT list is the same mistake as an empty `
    + 'one: rate what the table states, never the length of it.',
    `8. ${noRatingFromAnAbsence(evidence.coverageLimits, true)[1]}`,
  ].join('\n');
}
