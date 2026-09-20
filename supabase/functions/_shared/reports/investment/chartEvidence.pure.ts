/**
 * What a quantitative visual has to be able to point at, and what happens when
 * it cannot.
 *
 * ── Why this module exists ───────────────────────────────────────────────
 *
 * The Investment Compass for 48 Redfern Street, Cowra draws 33 directives. 20
 * of them carry figures. The number that bind to a producer the record holds
 * is **zero** — `demographics_data` is NULL, `location_intelligence` is NULL,
 * `data_sources.marketData` is null, there is no planning source at all, the
 * scoring engine issued no grade, and `market_fact_snapshot` records
 * population as `absent` with the ruling "not client safe" while page 11
 * charts it anyway. Meanwhile the one dataset the record genuinely holds —
 * crime, with real BOCSAR counts — appears in no chart at all.
 *
 * Nothing reported any of it. `_generationQuality` scored every section 100 of
 * 100 and the document passed.
 *
 * Three guards already existed for parts of this (`suppressUnrecordedScores`,
 * `suppressUnrecordedVerdictVisuals`, `suppressUnevidencedMarketSeries`) and
 * every one of them runs in `generate-investment-report` and nowhere else —
 * not the fork, not the condensation, not either render path. So a stored
 * document keeps its unsupported figures for ever, and so does every child
 * forked from it.
 *
 * ── The two halves of the contract ───────────────────────────────────────
 *
 * 1. **A visual must DECLARE a basis.** `findFiguresWithoutABasis` does that,
 *    and a declaration is cheap to write and cheap to fake.
 *
 * 2. **The declaration must be TRUE of this record.** That is this module.
 *    A nearby year, a "Source:" line or `unit=%` is not verification; what
 *    verifies is that the class of evidence the figure needs is one the record
 *    actually carries. `data_sources` says which producers answered, and a
 *    `null` there is the platform's own statement that nobody did.
 *
 * ── What it may and may not do ───────────────────────────────────────────
 *
 * It never invents a figure, never rescales one, and never deletes a finding.
 * A visual it refuses LEAVES the document and is returned on `findings` as the
 * audit record — it is not re-set as a table, because a table of unsupported
 * percentages is the same unsupported claim in a narrower column. The prose
 * around a visual is untouched, because the prose is where the finding and the
 * next action live; replacing the withheld material with supported evidence is
 * the acquisition work, not a scrub's job.
 *
 * It is deliberately NARROW. Only three classes are withheld, and each is one
 * where the record contradicts the drawing rather than merely failing to
 * confirm it:
 *
 *   - a RATING the scoring engine did not record (the existing rule, now on
 *     every path rather than one);
 *   - a SHARE of a population the record does not hold;
 *   - a SERIES of a quantity the record's own gate marked withheld.
 *
 * Everything else is reported and drawn. A warning that fires on two-thirds of
 * a corpus teaches people to ignore warnings, and this module's whole purpose
 * is to be believed.
 *
 * Deno-compatible: siblings and `_shared` only, explicit `.ts` extensions.
 */
import { parseVizDirectives, type VizDirective } from '../vizDirectives.pure.ts';
import { recordedScoreValues, suppressUnrecordedVerdictVisuals } from './scoreClaims.pure.ts';

/** What kind of claim a visual is making, which decides what can verify it. */
export type ChartClaim = 'rating' | 'share' | 'series' | 'measurement' | 'qualitative';

/** Why a visual could not be verified, or that it was. */
export type ChartVerdict =
  | 'supported' | 'unrecorded_rating' | 'population_not_held' | 'series_withheld'
  | 'market_not_held' | 'distance_not_measured' | 'self_assessment_not_measured';

export interface EvidenceInventory {
  /** Every value the scoring engine recorded, which is what a rating may assert. */
  recordedScores: number[];
  /** Did a demographics producer answer for this report? */
  demographics: boolean;
  /** Did a market producer answer? */
  marketData: boolean;
  /** Did a location producer answer? */
  location: boolean;
  /** Facts the report-time snapshot marked absent, by name. */
  withheldFacts: string[];
}

export interface ChartEvidenceFinding {
  verdict: Exclude<ChartVerdict, 'supported'>;
  claim: ChartClaim;
  kind: string;
  directive: string;
  /** One sentence naming what the record holds, for the operator, not the client. */
  reason: string;
}

/**
 * Read the inventory off a stored report row.
 *
 * Three things are read and nothing is inferred. `data_sources` is the
 * platform's own record of which producers answered, written by the generator
 * at the end of a run; a `null` entry is not "we did not check", it is "this
 * producer did not answer". `investment_score` carries what the engine
 * recorded. `market_fact_snapshot` carries what the client-safe gate refused,
 * with its own ruling attached.
 */
export function readEvidenceInventory(row: Record<string, unknown> | null | undefined): EvidenceInventory {
  const sources = (row?.data_sources ?? {}) as Record<string, unknown>;
  const answered = (key: string): boolean => {
    const v = sources[key];
    return v !== null && v !== undefined && typeof v === 'object';
  };
  const snapshot = row?.market_fact_snapshot as { facts?: Array<Record<string, unknown>> } | null | undefined;
  const withheldFacts = (snapshot?.facts ?? [])
    .filter((f) => f && f.status === 'absent')
    .map((f) => String(f.name ?? ''))
    .filter(Boolean);
  return {
    recordedScores: recordedScoreValues(row?.investment_score),
    demographics: answered('demographics'),
    marketData: answered('marketData'),
    location: answered('locationIntelligence') || answered('location'),
    withheldFacts,
  };
}

/**
 * What a directive is CLAIMING, which is not the same as what it is drawn as.
 *
 * A `bars` can be a measured series (three medians), a composition (three
 * shares of a hundred) or a minted scorecard, and the three need different
 * evidence. The declaration is the tell, as `scoreClaims` already found: a
 * genuine measured series does not announce that it is out of a hundred.
 */
export function claimOf(d: VizDirective): ChartClaim {
  if (d.kind === 'gauge' || d.kind === 'wheel') return 'rating';
  if (d.kind === 'donut' || d.kind === 'pictograph') return 'share';
  if (d.kind === 'margin') return 'series';
  if (d.kind === 'glance' || d.kind === 'tiles' || d.kind === 'timeline') return 'qualitative';
  // `radar` is named in `scoreClaims`' rating list but is not a directive kind
  // the parser produces, so there is nothing here to judge it on. The Deno
  // gate caught the dead branch that tsc admitted.
  if (d.kind === 'bars' || d.kind === 'heatmap') {
    const pct = 'unit' in d && typeof d.unit === 'string' && d.unit.trim() === '%';
    const hundred = 'max' in d && d.max === 100;
    if (hundred && !pct) return 'rating';
    if (pct) return 'share';
  }
  return 'measurement';
}

/**
 * A `share` names a POPULATION, and the population is the denominator.
 *
 * "Family renters 45, Local owner-occupiers 35, Professionals & small
 * households 20" describes households in a suburb; "Detached houses 80, Small
 * units 10, Rural lifestyle lots 10" describes dwellings. Both need a census
 * table and neither names one. A share of something the report itself
 * measured — a cost breakdown, an evidence count — is a different thing, and
 * is recognised by its own vocabulary rather than assumed.
 */
const SELF_MEASURED_SHARE =
  /\b(?:cost|expense|outgoing|repayment|deposit|equity|debt|loan|rent|yield|cash|fee|rate|charge|evidence|source|coverage|section|page|check|step|item)\b/i;
const POPULATION_SHARE =
  /\b(?:household|resident|population|tenant|renter|occupier|owner|dwelling|family|famil|demograph|age|income\s+band|sale|transaction|buyer|people|person)\b/i;

function shareDescribesAPopulation(d: VizDirective): boolean {
  const text = [
    'title' in d ? d.title ?? '' : '',
    'label' in d ? d.label ?? '' : '',
    'sub' in d ? d.sub ?? '' : '',
    'segments' in d ? d.segments.map((s) => s.label).join(' ') : '',
    'items' in d && Array.isArray(d.items)
      ? d.items.map((i) => ('label' in i ? String(i.label) : '')).join(' ')
      : '',
  ].join(' ');
  if (SELF_MEASURED_SHARE.test(text) && !POPULATION_SHARE.test(text)) return false;
  return POPULATION_SHARE.test(text);
}

/**
 * A distance nobody measured.
 *
 * Page 10 of the Cowra Compass draws *Proximity of 48 Redfern Street to key
 * Cowra amenities* — `Core CBD & shops 1.6 km, Primary school ~0.7 km,
 * Hospital & medical hub ~2.0 km` — and page 12 sets *Indicative reach from 48
 * Redfern Street* as a five-row TABLE of the same kind of figure.
 * `location_intelligence` on that row is **NULL**, so no producer measured any
 * of them; the prose beside the chart says where they came from —
 * *"Approximately 1.6 km from Cowra's CBD **as indicated by recent sale
 * listings**"*. §2 is explicit that a search snippet is not a verified source,
 * and that an unsupported dataset must not become a table of unsupported
 * numbers.
 *
 * `readEvidenceInventory` has computed `location` since it was written and
 * nothing has ever read it. This is what reads it.
 *
 * Measured across the 89 retained reports: **88 directives declare a distance
 * or travel-time unit, and 86 sit on a record whose location producer did not
 * answer.** The two that stand are Muswellbrook's *"road distance to key
 * centres"* and *"Everyday errands – typical travel times"*, on a record where
 * it did — the same separation the market and population rules make, from the
 * same `data_sources`.
 *
 * The unit is the tell, as it is for a rating: a chart of kilometres declares
 * kilometres. A figure in prose is not touched, because prose is not scrubbed.
 */
const DISTANCE_UNIT = /^(?:km|kms|kilometres?|kilometers?|metres?|meters?|mins?|minutes?|hrs?|hours?)$/i;

function declaresADistance(d: VizDirective): boolean {
  const unit = 'unit' in d && typeof d.unit === 'string' ? d.unit.trim() : '';
  return DISTANCE_UNIT.test(unit);
}

/** A `margin` spark of a quantity the client-safe gate refused to publish. */
const SERIES_SUBJECT: Array<{ re: RegExp; fact: RegExp }> = [
  { re: /\b(?:population|ERP|resident|demograph)\b/i, fact: /demograph/i },
];

function seriesIsWithheld(d: VizDirective, inv: EvidenceInventory): string | null {
  if (d.kind !== 'margin') return null;
  const text = `${d.heading ?? ''} ${d.label ?? ''} ${d.note ?? ''}`;
  for (const s of SERIES_SUBJECT) {
    if (!s.re.test(text)) continue;
    const withheld = inv.withheldFacts.find((n) => s.fact.test(n));
    if (withheld) return withheld;
  }
  return null;
}

/**
 * A `::: stat` fence is a figure in a summary strip, and it was the one
 * quantitative structure this contract could not see.
 *
 * ── What reached a client ────────────────────────────────────────────────
 *
 * Measured 19 September 2026 by rendering the five tier documents and reading
 * the pages: page 4 of the Cowra Compass draws
 *
 *     INDICATIVE LOCAL GROWTH
 *     3.52%
 *     Annual house price growth, Cowra (latest published)
 *
 * at display size. `3.52` appears exactly once in the whole record — inside
 * the model's own prose, as the fence itself — and `data_sources.marketData`
 * is `null`. The words "(latest published)" assert a provenance nothing holds.
 * It is in **83 of the 89** stored reports measured, because it rides the
 * parent's content into every fork.
 *
 * The directive contract could not reach it: `assessChartEvidence` walks lines
 * beginning `{{`, and a fence is one of the five `:::` blocks `renderMarkdown`
 * draws. §2 of the acceptance standard asks for the contract to hold over
 * "charts, tables, prose, captions, summary strips and recommendations", and a
 * stat fence is a summary strip.
 *
 * ── Why judging it is not scrubbing prose ────────────────────────────────
 *
 * The programme's rule is that prose is never regex-scrubbed. A fence is not
 * prose: it is a STRUCTURE with a kind, a label, a unit, a subtitle and a
 * single value, and a module can read all five — the same property that makes
 * a directive judgeable. The sentence beside it is untouched.
 *
 * ── The subject decides the evidence ─────────────────────────────────────
 *
 * The same two producer questions the charts already ask. A market quantity
 * needs a market producer; a population or workforce quantity needs a
 * demographics producer. Measured on the corpus's three distinct fences, the
 * rule separates them correctly: the Cowra growth stat is refused
 * (`marketData: null`), and Moranbah's "Mining share of workforce" and
 * "10-year population change" stand, because that record's demographics and
 * employment producers both answered.
 *
 * Anything else — a figure about the asset itself, a count the report made —
 * is not judged, for the reason the module's header gives: a warning that
 * fires on two-thirds of a corpus is one nobody reads.
 */
const STAT_MARKET_SUBJECT =
  /\b(?:growth|median|price|prices|rent|rents|rental|yield|vacancy|sale|sales|turnover|capital|value|values|days\s+on\s+market|clearance)\b/i;
const STAT_POPULATION_SUBJECT =
  /\b(?:population|resident|residents|household|households|demograph\w*|workforce|employment|unemployment|labour|occupier|occupiers|tenure|renter|renters|migration|age)\b/i;

/** Every `::: stat` fence, with the line that opens it. */
export interface StatFence {
  /** The fence's opening line, verbatim and trimmed. */
  open: string;
  /** `label`, `sub` and any other attribute text on the opening line. */
  attrs: string;
  /** The single value between the fences. */
  value: string;
  /** Index of the opening line in the document's lines. */
  line: number;
}

export function readStatFences(markdown: string): StatFence[] {
  const lines = markdown.split('\n');
  const out: StatFence[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    const m = /^:::\s*stat\b(.*)$/.exec(t);
    if (!m) continue;
    const parts: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      if (lines[j].trim() === ':::') break;
      if (lines[j].trim()) parts.push(lines[j].trim());
    }
    out.push({ open: t, attrs: m[1].trim(), value: parts.join(' ').trim(), line: i });
  }
  return out;
}

function assessStatFences(markdown: string, inv: EvidenceInventory): ChartEvidenceFinding[] {
  const out: ChartEvidenceFinding[] = [];
  for (const fence of readStatFences(markdown)) {
    // A fence with no figure in it is a label, not a claim.
    if (!/\d/.test(fence.value)) continue;
    const subject = `${fence.attrs} ${fence.value}`;
    const directive = fence.open.length > 190 ? `${fence.open.slice(0, 189)}\u2026` : fence.open;

    const withheld = inv.withheldFacts.find((n) => /demograph|population/i.test(n))
      && STAT_POPULATION_SUBJECT.test(subject) && !inv.demographics;
    if (STAT_MARKET_SUBJECT.test(subject) && !STAT_POPULATION_SUBJECT.test(subject) && !inv.marketData) {
      out.push({
        verdict: 'market_not_held',
        claim: 'measurement',
        kind: 'stat',
        directive,
        reason:
          'The figure is a market quantity — a growth rate, a median, a price, a rent or a yield — '
          + 'and no market producer answered for this report, so nothing in the record can be the '
          + '"latest published" figure the strip attributes to it.',
      });
      continue;
    }
    if (STAT_POPULATION_SUBJECT.test(subject) && !inv.demographics) {
      out.push({
        verdict: withheld ? 'series_withheld' : 'population_not_held',
        claim: 'share',
        kind: 'stat',
        directive,
        reason: withheld
          ? 'The report-time snapshot records this quantity as absent, which is the platform\u2019s own '
            + 'refusal to publish it. A stat card of it restores what the gate withheld.'
          : 'The figure describes a population or a workforce and no demographics producer answered '
            + 'for this report, so there is no table behind it and no period it belongs to.',
      });
    }
  }
  return out;
}

/**
 * Judge every directive in a document against what its record holds.
 *
 * Reports, and does not change anything. `enforceChartEvidence` is what acts.
 */
/**
 * A chart whose SUBJECT is the report's own evidence, sourcing or reliability.
 *
 * Nothing in this system counts what share of a report's statements came from
 * which class of source. The acquisition ledger records which PRODUCERS
 * answered — it says nothing about the composition of the finished prose, and
 * turning producer outcomes into a percentage of "evidence" would be a second
 * invention on top of the first. So a share or a rating about the report's own
 * sourcing has no denominator anywhere, ever, on any record.
 *
 * It is worth its own verdict because of what a reader does with it. Measured
 * 19 Sep 2026 across the stored corpus — 11 distinct documents, 216 directives,
 * 102 of them titled, 64 distinct titles — five directives match, and all five
 * are this: three copies of `{{donut: Official statistics 40, Major property
 * portals 35, Local intelligence 25 | title=Evidence mix}}`, a `Primary data
 * foundations` donut and an `Evidence quality at the property level` heatmap.
 * The Cowra report drew the first on page 17 of the delivered Financial
 * Analysis, on a record holding `marketData: null`, `location_intelligence:
 * NULL` and `demographics_data: NULL`. It is the one chart a reader uses to
 * decide how much to trust every other number in the document, and it was the
 * least supported thing in it.
 *
 * Judged on the TITLE alone, which is the conservative reading: a label that
 * happens to mention confidence inside a chart about something else does not
 * make the chart a self-assessment, and on this corpus the title catches all
 * five with no other title matching.
 */
const SELF_ASSESSMENT_TITLE =
  /\b(evidence|sourc\w*|provenance|citation\w*|methodolog\w*|data\s+(?:quality|reliability|confidence|resolution|foundation\w*|coverage))\b/i;

function titleOf(d: VizDirective): string {
  const t = (d as { title?: unknown }).title;
  return typeof t === 'string' ? t : '';
}

function assessesItsOwnEvidence(d: VizDirective): boolean {
  return SELF_ASSESSMENT_TITLE.test(titleOf(d));
}

export function assessChartEvidence(
  markdown: string,
  inv: EvidenceInventory,
): ChartEvidenceFinding[] {
  const out: ChartEvidenceFinding[] = [];
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{{')) continue;
    const parsed = parseVizDirectives(t);
    if (!parsed.length) continue;
    const d = parsed[0];
    const claim = claimOf(d);
    const directive = t.length > 190 ? `${t.slice(0, 189)}…` : t;

    // Every claim type, because the reason does not depend on one: a share of
    // the report's sourcing, a rating of its reliability and a grid of ticks
    // against "High / Moderate / Limited" are the same assertion in three
    // primitives, and nothing measures any of them.
    if (assessesItsOwnEvidence(d)) {
      out.push({
        verdict: 'self_assessment_not_measured',
        claim,
        kind: d.kind,
        directive,
        reason:
          'The chart is titled for the report\'s own evidence, sourcing or reliability, and nothing '
          + 'in this system counts that. The acquisition ledger records which producers answered; it '
          + 'does not measure what share of the finished report each class of source contributed, so '
          + 'the figures have no denominator on any record.',
      });
      continue;
    }

    if (claim === 'share' && shareDescribesAPopulation(d) && !inv.demographics) {
      out.push({
        verdict: 'population_not_held',
        claim,
        kind: d.kind,
        directive,
        reason:
          'The shares describe a population — households, dwellings, occupiers or transactions — and '
          + 'no demographics producer answered for this report, so there is no table behind the '
          + 'denominator and no period the shares belong to.',
      });
      continue;
    }

    if (claim === 'measurement' && declaresADistance(d) && !inv.location) {
      out.push({
        verdict: 'distance_not_measured',
        claim,
        kind: d.kind,
        directive,
        reason:
          'The chart declares a distance or travel-time unit and no location producer answered for '
          + 'this report, so nothing in the record measured any of the figures it plots.',
      });
      continue;
    }

    const withheld = seriesIsWithheld(d, inv);
    if (withheld) {
      out.push({
        verdict: 'series_withheld',
        claim,
        kind: d.kind,
        directive,
        reason:
          `The report-time snapshot records "${withheld}" as absent, which is this platform's own `
          + 'refusal to publish that quantity. A chart of it restores what the gate withheld.',
      });
    }
  }

  // The summary strip's own structure, judged on the same inventory.
  out.push(...assessStatFences(markdown, inv));

  // Ratings are judged by the rule that already exists, so the two cannot
  // drift: one implementation, extended to every path rather than copied.
  const ratings = suppressUnrecordedVerdictVisuals(markdown, { recorded: inv.recordedScores });
  for (const r of ratings.removed) {
    out.push({
      verdict: 'unrecorded_rating',
      claim: 'rating',
      kind: r.kind,
      directive: r.directive.length > 190 ? `${r.directive.slice(0, 189)}…` : r.directive,
      reason:
        `The scoring engine did not record ${r.values.join(', ')}. `
        + (inv.recordedScores.length
          ? `What it recorded is ${inv.recordedScores.join(', ')}.`
          : 'It issued no grade at all for this report, so no rating on the page can be its own.'),
    });
  }
  return out;
}

/**
 * An unsupported visual leaves the client document and is kept in the audit
 * record.
 *
 * ── The correction this replaces ─────────────────────────────────────────
 *
 * The first version of this module marked an unsupported share or series
 * `basis=withheld` and let the renderer set it as a table — reasoning that
 * withholding the DRAWING while keeping the labels and figures preserved the
 * reader's material. That conflated two cases that are not alike:
 *
 *   - a **supported** dataset the chart primitive cannot render (a distance
 *     written as a range, a categorical value where a number was expected).
 *     A table is the right answer: every figure is real and the only thing
 *     lost is the drawing. `vizFigures` still does exactly this, on the
 *     parser's `refused` list.
 *
 *   - an **unsupported** dataset. "Family renters 45%, Local owner-occupiers
 *     35%, Professionals & small households 20%" is not more defensible in a
 *     table than in a donut. The reader still receives three percentages of a
 *     population nobody measured, now wearing the authority of a table. The
 *     defect is the figures, and a table does not repair figures.
 *
 * So an unsupported visual is REMOVED from what a client receives. Its
 * directive, its values and the reason are returned on `findings` for the
 * audit record, so nothing is lost to the operator — only to the reader who
 * would otherwise have taken it for evidence.
 *
 * Removal is not the end state. §2 of the standard requires the material to be
 * replaced by supported evidence or by an explanation that IS supported, and
 * that replacement is the acquisition and composition work — not something a
 * scrub can invent. What this module guarantees is the floor: an unsupported
 * figure does not reach a client because a renderer found somewhere to put it.
 */
export interface ChartEvidenceResult {
  markdown: string;
  /** The audit record: what left the document, and why. */
  findings: ChartEvidenceFinding[];
}

export function enforceChartEvidence(
  markdown: string,
  inv: EvidenceInventory,
): ChartEvidenceResult {
  const findings = assessChartEvidence(markdown, inv);
  if (!findings.length) return { markdown, findings };

  const remove = new Set(findings.map((f) => f.directive));
  const out: string[] = [];
  // A directive is one line; a `::: stat` fence is three or more, and half a
  // fence left behind prints its own delimiter as body copy. So a removed
  // opening line takes the block it opens with it.
  let insideRemovedFence = false;
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (insideRemovedFence) {
      if (t === ':::') insideRemovedFence = false;
      continue;
    }
    const key = t.length > 190 ? `${t.slice(0, 189)}\u2026` : t;
    if (remove.has(key)) {
      if (/^:::\s*\w/.test(t)) insideRemovedFence = true;
      continue;
    }
    out.push(line);
  }
  return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n'), findings };
}

// ---------------------------------------------------------------------------
// The prose half of the same contract
// ---------------------------------------------------------------------------

/**
 * What the PROSE may claim, judged against the same inventory the charts are.
 *
 * ── Why this is a prompt rule and not a scrub ────────────────────────────
 *
 * `enforceChartEvidence` removes an unsupported directive because a directive
 * is a structure: it has a kind, a set of values and a declared basis, and a
 * module can read all three. A sentence is not. The programme's own rule is
 * that **prose is never regex-scrubbed, on read or on write** —
 * `neverAPlaceholder.spec.ts` scans structure and source and deliberately not
 * sentences — because a regex over prose deletes the qualification along with
 * the claim, and a half-deleted sentence is worse than the claim was.
 *
 * So the prose half is a contract the model writes UNDER, composed from the
 * same `EvidenceInventory` the charts are judged against. One inventory, two
 * consumers: the page and the sentence beside it cannot then disagree about
 * what the record holds.
 *
 * ── The six classes, and why each is named ───────────────────────────────
 *
 * Every rule here exists because a specific sentence reached a client. The
 * removed occupier donut had a prose twin — *"roughly 45% of tenants are
 * families"* — and removing the drawing while leaving the sentence moves an
 * unsupported figure rather than withdrawing it. A proportion of TRANSACTIONS
 * ("7 in 10 sales") is the same claim with a different denominator. A rating
 * in words ("scores strongly for liveability") is the gauge again. And the
 * three qualitative words the standard names — **renovated**, **strong
 * demand**, **low risk** — are factual or evaluative claims that happen to
 * carry no digit, which is exactly why a numeric rule never caught them.
 *
 * The last is the source note. A `data_sources` entry says a producer
 * ANSWERED; it does not say the answer contains the figure a sentence is
 * attributing to it, and "Source: Domain" under a median Domain never supplied
 * is a citation that cannot be checked and is worse than none.
 */
export function claimSupportRules(inv: EvidenceInventory): string {
  const rules: string[] = [
    'CLAIM SUPPORT — these govern the PROSE, the captions, the summary strips, the tables you '
    + 'write, the ::: stat ::: cards, the timeline stops and every recommendation. A claim these '
    + 'rules refuse is refused in EVERY form: moving an unsupported figure out of a chart and into '
    + 'a table row, a stat card or a timeline stop does not make it supported, and a chart this '
    + 'report declined to draw may not reappear as a list of the same numbers. They override any '
    + 'example elsewhere in this prompt, and a figure a live web search returns is still a figure '
    + 'this report did not retrieve.',
  ];

  rules.push(
    inv.demographics
      ? '1. Population and household composition were retrieved for this report. A share of the '
        + 'population may be stated only with the dataset, the period and the geography it '
        + 'describes, in the same sentence.'
      : '1. NO population or household composition was retrieved for this report. Do not state, '
        + 'estimate, approximate or characterise what proportion of residents or tenants are '
        + 'families, professionals, owner-occupiers, renters, retirees or any other group — not as '
        + 'a percentage, not as "roughly", not as "around half", not as "predominantly", and not '
        + 'in a table. A suburb’s demographic composition is also not the predicted tenant mix '
        + 'of this particular property, and may never be presented as one.',
  );

  rules.push(
    inv.marketData
      ? '2. Market data was retrieved. A proportion of sales, listings or transactions may be '
        + 'stated only with the source, the period and the geography.'
      : '2. NO transaction, sales or listing data was retrieved for this report. Do not state what '
        + 'proportion of sales, listings, buyers or transactions anything represents — not as a '
        + 'percentage, not as "7 in 10", not as "the majority", not as "most". There is no '
        + 'denominator in this record for any such claim. The same applies to every OTHER market '
        + 'quantity: a capital growth rate, a median price or rent, a yield, a vacancy rate, a '
        + 'clearance rate or days on market. Nothing in this record can be the "latest published" '
        + 'figure for this suburb, so do not write one in a sentence, a caption, a table or a '
        + 'stat card.',
  );

  rules.push(
    inv.recordedScores.length
      ? `3. The scoring engine recorded ${inv.recordedScores.join(', ')}. A rating may be stated `
        + 'only where it is one of those, and only with what it rates and out of what.'
      : '3. The scoring engine issued NO grade for this property. Do not state a rating, a score, '
        + 'a rank, a percentile or a band — in figures OR in words. "Rates strongly", "scores '
        + 'well", "sits in the upper tier", "an above-average performer" and "a solid 7 out of 10" '
        + 'are all ratings, and this record supports none of them.',
  );

  rules.push(
    '4. A qualitative claim needs support exactly as a number does. **Renovated**, **recently '
    + 'updated**, **well presented**, **strong demand**, **tightly held**, **low risk** and '
    + '**verified** are factual or evaluative assertions that happen to carry no digit. State one '
    + 'only where the record names the evidence for it; where it does not, say what is not known '
    + 'rather than reaching for a softer version of the same claim. A seller’s listing is '
    + 'evidence of what was ADVERTISED and not of the asset, so a characterisation taken from one '
    + 'is written as the listing’s claim, in the sentence that uses it, and never as this '
    + 'report’s own. No property in this report has been inspected.',
  );

  rules.push(
    '5. A source note names what a figure CAME FROM, and may be written only where that provider '
    + 'actually supplied that figure to this report. A provider appearing in the record means it '
    + 'answered; it does not mean its answer contains the number beside your citation. Do not '
    + 'write "Source: …", "according to …" or "data from …" for a figure this report '
    + 'did not retrieve from that source, and do not cite a document nobody read. '
    + 'The report’s OWN evidence base is not a measured quantity either: nothing here counts what '
    + 'share of this report rests on official statistics, property portals, commercial data, local '
    + 'intelligence or advisory interpretation, so do not state one — not as an "evidence mix", a '
    + '"data resolution mix", a "primary data foundation" or a reliability rating, and not in a '
    + 'sentence, a table or a chart. Name the sources you actually used instead.',
  );

  /*
   * Rule 6 is the prose counterpart of `distance_not_measured`, and it was the
   * larger half of the same gap: `inv.location` gated a chart rule and no
   * sentence rule at all.
   *
   * Measured on the delivered Cowra Due Diligence Report, whose record holds
   * `location_intelligence: NULL` and `data_sources.locationIntelligence:
   * null`. Pages 14 to 16 — the most detailed pages in the whole set — are
   * "Mulyan Public School is approximately 0.5 km from 48 Redfern Street …
   * as confirmed by Domain's school catchment summary for this address",
   * "Cowra High School sits around 1.1 km", "roughly 2-3 km based on town
   * layout", "around 5-10 minutes by car", "a veterinary surgery at 84
   * Redfern Street", "Cowra Bus Service's town timetable lists a stop at
   * Redfern & Bourke Streets". Not one of those was retrieved, and the Domain
   * attribution names a provider that answered nothing for this report.
   *
   * The prohibition is on the MEASUREMENT and the attribution, not on the
   * place. A regional town has a hospital and the report may say so; what it
   * may not do is put a distance, a travel time or a catchment on it, or hang
   * a provider's name on a figure that provider never supplied. That is the
   * line `placesAvailability` already draws at the producer — a failed lookup
   * is null and never a measured zero — carried into the sentence.
   */
  rules.push(
    inv.location
      ? '6. Location and amenity measurements were retrieved for this report. A distance, a '
        + 'travel time or a catchment may be stated only as the record measured it, in the units '
        + 'it measured, and a facility the record does not name is not named as measured.'
      : '6. NO location, amenity, transport or school measurement was retrieved for this report. '
        + 'Do not state a distance, a travel time, a walk score, a catchment or a count of '
        + 'facilities near this property — not in kilometres, not in metres, not in minutes, not '
        + 'as a range ("2-3 km", "5-10 minutes"), and not softened ("a short drive", "within '
        + 'walking distance", "just minutes from"). Nothing in this record measured any of them, '
        + 'and estimating one from a town\'s layout or from a map you have seen is inventing it. '
        + 'You may still describe what a regional centre of this kind offers and what a buyer '
        + 'would check, and you may name a facility as a place that exists — you may not put a '
        + 'distance, a time or a catchment on it, and you may not attribute one to a provider, a '
        + 'timetable or a council map that supplied nothing to this report.',
  );

  if (inv.withheldFacts.length) {
    rules.push(
      `7. These facts were considered for this report and WITHHELD at the data gate: `
      + `${inv.withheldFacts.join(', ')}. They are withheld because they could not be stated `
      + 'safely, so they may not be stated in prose either, in any form, including a '
      + 'characterisation or a range.',
    );
  }

  rules.push(
    `${inv.withheldFacts.length ? 8 : 7}. Where a claim cannot be supported, the sentence that `
    + 'replaces it says what the report does hold and what would settle the question. It never '
    + 'says "data was unavailable", never apologises, and never prints a placeholder — an '
    + 'absence is omitted or explained, not worded.',
  );

  return rules.join('\n');
}
