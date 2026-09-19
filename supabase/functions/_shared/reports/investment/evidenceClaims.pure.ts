/**
 * A detected error is not a corrected report.
 * ------------------------------------------
 *
 * `compassQAValidator` reports and never scrubs, and that is right for most of
 * what it measures: a page band, a duplicate heading, a section over its word
 * cap are facts about a document that already exists, and a report that exists
 * and is over its band is more use to everyone than no report. The generator's
 * own comment says so, and it has been true since Phase 7.
 *
 * It is not true of two of its findings. `portal-sourced-hazard-clearance` and
 * `unpublished-delivery-horizon` are not statements about a document's shape —
 * they are **material claims about somebody's property that no source in this
 * report supports**: that a hazard or planning control does not apply here
 * because a listing portal or a neighbouring parcel says so, and that a named
 * project will be delivered inside a horizon no register publishes. Recording
 * those in `validation_flags` and printing them anyway puts the unsupported
 * claim in front of the client and the finding in front of nobody.
 *
 * So this module is the correction half, and it answers to four rules.
 *
 * **One declaration, two readers.** The patterns live here and the validator
 * imports them, because a corrector with its own copy of the detector's regex
 * is two ends that drift — the failure this repository has recorded under
 * `AML_COMMAND_REFRESH_EVENT`, under `DEFAULT_REVIEW_INTERVALS` and under the
 * two copies of "what is still owed". The finders return the same structures
 * the validator turns into findings and the corrector turns into removals, so
 * a claim that is reported is a claim that is corrected, by construction.
 *
 * **The unit of the correction is the unit of the assertion.** A sentence for
 * a prose claim; one stop for a timeline stop. Never a paragraph, never a
 * section, never a regex sweep across the document — the owner's rule is that
 * prose is never regex-scrubbed, and the point of removing a clearance
 * sentence is that the sentence IS the claim. A stop labelled by what its date
 * is ("Determined Jul 2026") survives beside one labelled "0-2y", which is
 * removed; a timeline left with no stops goes entirely, because an empty
 * directive prints as nothing anyway.
 *
 * **Nothing is concealed.** Every removal is returned with the text that went
 * and the rule that took it, so the caller logs it and stores it. A correction
 * that leaves no trace is indistinguishable from a document that never carried
 * the claim, and the whole point of this programme is that the record says what
 * happened.
 *
 * **It removes and never rewrites.** There is no repair here that invents a
 * replacement — no relabelling "0-2y" as a date the model did not have, no
 * downgrading "Confidence: High" to "Unverified". Those are judgements, and a
 * judgement written by a corrector is the fabrication this control exists to
 * remove. `risk-confidence-overstated` therefore stays a warning and stays
 * uncorrected: the honest word is one a person picks.
 *
 * Deno-compatible: the only import is the sentence machinery, which is shared
 * with `scoreClaims.pure.ts` for the same one-declaration reason.
 */

import { isProseLine, sentencesOf } from './scoreClaims.pure.ts';

/** A listing portal, by domain. */
export const PORTAL_SOURCE_RE =
  /(property\.com\.au|realestate\.com\.au|domain\.com\.au|allhomes\.com\.au|onthehouse\.com\.au)/i;

/** A claim sourced to somebody else's parcel. */
export const NEIGHBOURING_PARCEL_RE =
  /\b(nearby|neighbouring|neighboring|adjoining|adjacent|surrounding)\s+\w{0,12}\s?(address(es)?|propert(y|ies)|listing|listings|home|homes|dwelling|dwellings|lot|lots)\b/i;

/** A hazard or planning control asserted NOT to apply. */
export const HAZARD_ABSENCE_RE =
  /\b(no|not|free from|without|nil)\b[^.]{0,80}\b(overlay|overlays|heritage[- ]listed|flood|bushfire|bush fire|landslip|acid sulfate|contamination)\b/i;

/**
 * The ONE absence the prose may repeat — a register that was asked and matched
 * nothing, stated in `checkedAndNotMapped`'s own words. It reads as a negation
 * beside a hazard noun, so it is excluded by name rather than by hoping the
 * pattern misses it.
 */
export const PERMITTED_ABSENCE_RE = /checked and not mapped at this coordinate/i;

/**
 * A future delivery horizon, spelled as a duration or as a relative term.
 *
 * `y` on its own is the spelling the report actually used ("0-2y", "5y+"), so
 * the year suffix is wholly optional. A stop labelled by what a date IS
 * ("Determined Jul 2026"), by a calendar year, or by "Existing" is left alone:
 * all three are things a register can support.
 */
export const DELIVERY_HORIZON_RE =
  /\b(?:\d{1,2}\s*[-–—]\s*\d{1,2}\s*y(?:(?:ea)?rs?)?\b|\d{1,2}\s*y(?:(?:ea)?rs?)?\s*\+|(?:short|medium|near|long)[\s-]*term\b|next\s+\d{1,2}\s+y(?:(?:ea)?rs?)?\b)/i;

/** A citation naming a listing portal. */
export const findPortalCitations = (markdown: string): string[] =>
  (markdown.match(/\[[^\]\n]{4,160}\]/g) ?? []).filter((b) => PORTAL_SOURCE_RE.test(b));

/** A sentence clearing this property of a hazard on somebody else's authority. */
export interface PortalSourcedClearance {
  /** The sentence, trimmed, exactly as it sits in the prose. */
  sentence: string;
  /** Whether a portal was named, a neighbouring parcel was cited, or both. */
  basis: Array<'portal' | 'neighbouring'>;
}

/** Is this one sentence a hazard clearance resting on a listing or a neighbour? */
const clearanceBasis = (sentence: string): Array<'portal' | 'neighbouring'> => {
  if (PERMITTED_ABSENCE_RE.test(sentence)) return [];
  if (!HAZARD_ABSENCE_RE.test(sentence)) return [];
  const basis: Array<'portal' | 'neighbouring'> = [];
  if (PORTAL_SOURCE_RE.test(sentence)) basis.push('portal');
  if (NEIGHBOURING_PARCEL_RE.test(sentence)) basis.push('neighbouring');
  return basis;
};

/**
 * Every sentence stating that a hazard or planning control does not apply to
 * this property, on the authority of a listing portal or of a neighbouring
 * parcel. This is the finder both the validator and the corrector read.
 */
export function findPortalSourcedClearances(markdown: string): PortalSourcedClearance[] {
  const out: PortalSourcedClearance[] = [];
  // `sentencesOf`, never a second split. The validator used
  // `markdown.split(/(?<=[.!?])\s+/)` while the corrector used `sentencesOf`,
  // and on the measured Redfern Street prose the two disagreed about where the
  // sentence ended — so the finding survived its own correction. One splitter
  // is what makes "what is reported is what is removed" a property rather than
  // a hope, and it reads the whole document line by line so a table row or a
  // directive cannot be mistaken for prose.
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (!isProseLine(t)) continue;
    for (const sentence of sentencesOf(t)) {
      const basis = clearanceBasis(sentence);
      if (basis.length) out.push({ sentence: sentence.trim(), basis });
    }
  }
  return out;
}

/** A `{{timeline:}}` placing items in a horizon no register publishes. */
export interface UnpublishedHorizon {
  /** The whole directive, as it sits in the markdown. */
  directive: string;
  /**
   * Every horizon bucket it used, in order and WITH repeats — a timeline with
   * three stops all reading "0-2y" places three items, and the finding has
   * always counted items and listed the distinct horizons separately. The
   * caller de-duplicates for the list; the length is the item count.
   */
  horizons: string[];
}

/** The bucket labels of one timeline body — what precedes each quoted label. */
const bucketsOf = (body: string): string[] =>
  [...body.matchAll(/(^|,)\s*([^,"]*?)\s*"/g)].map((b) => (b[2] ?? '').trim()).filter(Boolean);

/** Every timeline directive carrying at least one unpublished delivery horizon. */
export function findUnpublishedHorizons(markdown: string): UnpublishedHorizon[] {
  const out: UnpublishedHorizon[] = [];
  for (const m of markdown.matchAll(/\{\{timeline:([^}]*)\}\}/gi)) {
    const horizons = bucketsOf(m[1] ?? '').filter((b) => DELIVERY_HORIZON_RE.test(b));
    if (!horizons.length) continue;
    out.push({ directive: m[0], horizons });
  }
  return out;
}

/** What was taken out, and by which rule. */
export interface RemovedClaim {
  /** The QA rule this correction discharges. */
  rule: 'portal-sourced-hazard-clearance' | 'unpublished-delivery-horizon';
  /** The text removed — a sentence, a timeline stop, or a whole directive. */
  text: string;
  /** Why, in the words the log and the stored record carry. */
  reason: string;
}

export interface ClaimCorrectionResult {
  markdown: string;
  removed: RemovedClaim[];
}

/**
 * One timeline directive with its unsupported stops taken out.
 *
 * A stop is `bucket "Label"`; the bucket is what precedes the quoted label.
 * Only stops whose bucket is a delivery horizon go — the rest of the directive
 * is untouched, so a timeline mixing "Determined Jul 2026" with "0-2y" keeps
 * the determination and loses the horizon. A directive left with no stops is
 * returned as `null`, and the caller drops it.
 */
function trimTimeline(directive: string): { replacement: string | null; dropped: string[] } {
  const body = directive.replace(/^\{\{timeline:/i, '').replace(/\}\}$/, '');
  // Split into stops on the commas that separate `bucket "Label"` pairs, which
  // is every comma NOT inside a quoted label.
  const stops: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '"') depth = depth === 0 ? 1 : 0;
    if (ch === ',' && depth === 0) { stops.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) stops.push(current);

  const dropped: string[] = [];
  const kept = stops.filter((stop) => {
    const bucket = (stop.match(/^\s*([^"]*?)\s*"/) ?? [])[1] ?? '';
    if (!bucket || !DELIVERY_HORIZON_RE.test(bucket)) return true;
    dropped.push(stop.trim());
    return false;
  });
  if (!dropped.length) return { replacement: directive, dropped };
  if (!kept.length) return { replacement: null, dropped };
  return { replacement: `{{timeline:${kept.join(',')}}}`, dropped };
}

/**
 * Correct the two material claim errors, and return what went.
 *
 * Order matters only in that the timeline pass runs on the markdown the
 * sentence pass produced; neither can reach the other's text (one reads prose
 * lines, the other reads `{{…}}` directives, and `isProseLine` excludes a line
 * that opens with `{{`).
 */
export function correctUnsupportedEvidenceClaims(markdown: string): ClaimCorrectionResult {
  const removed: RemovedClaim[] = [];

  // 1 — the hazard clearance sentence.
  const lines: string[] = [];
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (!isProseLine(t)) { lines.push(line); continue; }
    if (!clearanceBasis(t).length && !HAZARD_ABSENCE_RE.test(t)) { lines.push(line); continue; }

    const bullet = t.match(/^([-*+]\s+|\d+[.)]\s+)/);
    const prefix = bullet ? bullet[1] : '';
    const body = t.slice(prefix.length);
    const kept = sentencesOf(body).filter((sentence) => {
      const basis = clearanceBasis(sentence);
      if (!basis.length) return true;
      removed.push({
        rule: 'portal-sourced-hazard-clearance',
        text: sentence,
        reason: `A hazard or planning absence asserted about this property on the authority of `
          + `${basis.join(' and ')} evidence. A listing is not a planning authority and a neighbouring `
          + 'parcel is not this one; the retrieved constraint register states what was checked here.',
      });
      return false;
    });
    if (kept.length === sentencesOf(body).length) { lines.push(line); continue; }
    if (!kept.length) continue; // the whole line was the claim
    const indent = line.match(/^\s*/)?.[0] ?? '';
    lines.push(`${indent}${prefix}${kept.join(' ')}`);
  }
  let out = lines.join('\n').replace(/\n{3,}/g, '\n\n');

  // 2 — the unpublished delivery horizon.
  for (const found of findUnpublishedHorizons(out)) {
    const { replacement, dropped } = trimTimeline(found.directive);
    if (!dropped.length) continue;
    for (const stop of dropped) {
      removed.push({
        rule: 'unpublished-delivery-horizon',
        text: stop,
        reason: 'A timeline stop placed in a future delivery horizon. The planning and development '
          + 'registers this report reads publish no delivery date for anything — every date they carry '
          + 'is a decision or a declaration — so the horizon has no source.',
      });
    }
    out = out.split(found.directive).join(replacement ?? '');
  }
  // A line that held only the dropped directive leaves a blank one behind.
  out = out.split('\n').filter((l, i, all) => !(l.trim() === '' && all[i - 1]?.trim() === '' && all[i + 1]?.trim() === '')).join('\n');

  return { markdown: out.replace(/\n{3,}/g, '\n\n'), removed };
}

// ── a figure that names no basis ──────────────────────────────────────────

/**
 * The primitives that draw NUMBERS a reader will act on.
 *
 * `glance`, `stat`, `margin` and the inline sparkline are excluded: they carry
 * a figure the prose around them has already sourced, and flagging them turns
 * a rule into noise. `timeline` is included because a project pipeline asserts
 * dates, and a date nobody published is the defect §5 names by itself.
 */
export const FIGURE_KINDS_NEEDING_A_BASIS = [
  'bars', 'donut', 'pictograph', 'heatmap', 'tiles', 'quadrant', 'wheel',
  'gauge', 'waterfall', 'timeline', 'radar',
] as const;

/**
 * What counts as a stated basis.
 *
 * One of three things, not all of them: a named PUBLISHER or register, a
 * PERIOD, or an explicit statement that the figure is modelled or comes from
 * the recorded calculation. Units are asked for separately — the directive
 * vocabulary has a `unit=` option and most figures carry `$`, `%` or a
 * measurement anyway, so requiring a unit alone would make the rule toothless
 * while requiring all four at once would flag every figure in every document
 * and teach people to dismiss it.
 */
const BASIS_MARKER = new RegExp([
  // A publisher or register this platform actually reads.
  '\\b(?:ABS|Census|SEIFA|RBA|BOCSAR|QPS|SAPOL|NT\\s+Police|DCJ|GTFS|Domain|',
  'Nominatim|OpenStreetMap|Overpass|Mapillary|OSRM|QTRIP|ePlanning|',
  'Statistician|Rural\\s+Fire\\s+Service|council|register|registry)\\b|',
  // A period.
  '\\b(?:19|20)\\d{2}\\b|\\bFY\\s?\\d{2}\\b|\\b(?:quarter|quarterly|annual|',
  'monthly|as\\s+at|to\\s+(?:June|September|December|March))\\b|',
  // An explicit model basis.
  '\\b(?:modelled|modeled|assumption|assumed|recorded\\s+calculation|',
  'stored\\s+calculation|the\\s+record|source\\s*[:=]|basis\\s*[:=])\\b',
].join(''), 'i');

export interface UnbasedFigure {
  kind: string;
  /** The directive's own `title=` / label, or its first value when it has none. */
  title: string;
  directive: string;
}

const FIGURE_LINE = new RegExp(
  `^\\{\\{(${FIGURE_KINDS_NEEDING_A_BASIS.join('|')})\\s*:\\s*([\\s\\S]*)\\}\\}$`,
);

/**
 * How far either side of a figure its basis may be stated, counted in lines
 * that carry text.
 *
 * Counted in NON-BLANK lines because markdown separates every block with one,
 * so three raw lines is one sentence and a gap — measured: a caption three
 * sentences above a figure was not being found at all.
 */
const BASIS_WINDOW_BEFORE = 3;
const BASIS_WINDOW_AFTER = 2;

/** `source=`/`basis=`/`unit=` on the directive ITSELF. */
const DECLARED_BASIS_OPTION = /\b(?:source|basis|unit)\s*=\s*[^|}\s]/i;

/**
 * Figures that draw numbers and name no dataset, period or model basis.
 *
 * Reported, never removed. `suppressUnrecordedVerdictVisuals` already removes
 * a rating the record does not hold, and that is the case where deletion is
 * right because the number is untrue. This is a different case: the number may
 * be perfectly sound and the reader cannot tell, and deleting a sound figure
 * to silence a warning takes real data off the page.
 *
 * The remedy is a caption. It is what §4 asks for in so many words — units,
 * period, geography and source or model basis — and it is what separates an
 * occupier mix drawn from the Census from one a model chose.
 */
export function findFiguresWithoutABasis(markdown: string): UnbasedFigure[] {
  const lines = markdown.split('\n');
  const out: UnbasedFigure[] = [];
  const isDirective = (line: string) => /^\s*\{\{/.test(line);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(FIGURE_LINE);
    if (!m) continue;
    const payload = m[2];
    // A `source=` / `basis=` / `unit=` option on the directive is a stated
    // basis. Nothing else inside a directive is: `{{donut: Register 4, Model
    // 3, Portal 2}}` names a register as a SLICE of the mix, and reading that
    // as provenance lets a figure vouch for itself.
    if (DECLARED_BASIS_OPTION.test(payload)) continue;
    const neighbours: string[] = [];
    for (let j = i - 1, seen = 0; j >= 0 && seen < BASIS_WINDOW_BEFORE; j--) {
      if (!lines[j].trim()) continue;
      if (isDirective(lines[j])) { seen += 1; continue; }
      neighbours.push(lines[j]); seen += 1;
    }
    for (let j = i + 1, seen = 0; j < lines.length && seen < BASIS_WINDOW_AFTER; j++) {
      if (!lines[j].trim()) continue;
      if (isDirective(lines[j])) { seen += 1; continue; }
      neighbours.push(lines[j]); seen += 1;
    }
    if (BASIS_MARKER.test(neighbours.join('\n'))) continue;
    const title = (/\btitle\s*=\s*([^|}]+)/i.exec(payload)?.[1]
      ?? payload.split('|')[0] ?? '').trim();
    out.push({ kind: m[1], title: title.slice(0, 80), directive: lines[i].trim().slice(0, 160) });
  }
  return out;
}
