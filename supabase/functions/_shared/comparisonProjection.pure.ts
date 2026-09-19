/**
 * Project a stored `property_comparisons` row into the binding vocabulary a
 * Property Comparison template uses.
 *
 * ## This one does not normalise anything, and that is the point
 *
 * The other three projections in this directory read a stored row directly,
 * because their formats had no normaliser to share. This format does:
 * `_shared/reports/propertyComparison/normalise.pure.ts` already turns a row —
 * of either storage shape — into a `PropertyComparison`, and
 * `docs/reports/COMPARISON.md` records what it took to get right. Writing a
 * second reader would mean a second answer to every one of those questions:
 *
 *  - **27 of the 50 stored rows have all seven jsonb columns NULL**, with the
 *    model's truncated raw response in `executive_summary`. `salvage.pure.ts`
 *    recovers them without ever repairing a cut-off array, which is what stops
 *    a half-written ranking reaching a client's page looking whole.
 *  - **`finalScore` is on two scales.** 17 comparisons score 0-100 and 6 score
 *    0-10, and the 0-10 group runs to the most recent row in the table, so it
 *    is not a legacy tail. `detectScale` decides once per comparison and
 *    reports whether it is confident.
 *  - **A winner pointer of `0` or `null` means "nobody".** Of the 253 pointers
 *    across the eleven superlatives, 210 name a property, 15 are `0` and 28 are
 *    `null` — 17% naming no one. `propertyAt` returns null rather than reading
 *    `properties[-1]`.
 *
 * So this module is a restatement, not a reader. Everything below takes the
 * normalised model and gives its fields the names a template binds. If a
 * question about the data has an answer, it is answered upstream and both
 * renderers get the same one.
 *
 * ## What it publishes, and what stays absent
 *
 * A comparison carries no deterministic figures at all — every field was
 * written by a model in a single response. The one number, `finalScore`, is
 * published with its denominator beside it (`ranked.0.outOf`) rather than as a
 * bare figure, because 8.5 means two different things on the two scales.
 *
 * `marketTiming` and `competitiveAdvantages` are published where they exist,
 * which is **only on the damaged rows**: the writer that destructures a
 * successful response into seven columns has no column for them and drops them.
 * A salvaged document carries more of the analysis than an intact one. (This
 * paragraph was aspiration for a while — the code below dropped both on the
 * floor until the binding audit compared it against the payload. They are
 * published now, with the truncation note beside them, because half the stored
 * rows are salvaged and `recommendations` is absent on all but two of those —
 * a verdict page that binds only the pick renders an empty display-size
 * heading on 25 of the 50 rows in production.)
 */
import {
  buildPropertyComparison,
  SECTION_LABELS,
  type BuildComparisonInput,
} from './reports/propertyComparison/normalise.pure.ts';
import type {
  AxisWinner,
  InvestorMatch,
  NamedProperty,
  PropertyComparison,
  PropertyRef,
  RankedProperty,
  RedFlag,
  RiskVerdict,
} from './reports/propertyComparison/payload.pure.ts';

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/** A property reference, or nothing. Never a half-filled one. */
function projectRef(ref: PropertyRef | null): Record<string, unknown> | undefined {
  if (!ref) return undefined;
  const out: Record<string, unknown> = {};
  put(out, 'number', ref.number);
  put(out, 'address', ref.address);
  put(out, 'shortAddress', ref.shortAddress);
  put(out, 'state', ref.state);
  return Object.keys(out).length ? out : undefined;
}

/**
 * How a template says "the record named nobody here".
 *
 * This is a real answer rather than a gap — the analysis considered the axis and
 * declined to pick — so it is published as words rather than left to render as
 * an empty cell that reads like a rendering fault.
 */
export const NO_WINNER = 'No clear winner';

function projectRanked(r: RankedProperty): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ref = projectRef(r.property);
  if (ref) Object.assign(out, ref);
  put(out, 'rank', r.rank);
  if (r.score) {
    put(out, 'score', r.score.value.value);
    put(out, 'outOf', r.score.outOf);
    // Printed beside the figure on the page. `detectScale` is not confident when
    // every score sits at or below 10 with almost no spread, and a "7.9" that
    // might be out of 10 or out of 100 has to say which.
    out.scaleConfident = r.score.confident;
  }
  put(out, 'bestSuitedFor', r.bestSuitedFor);
  if (r.strengths.length) out.strengths = [...r.strengths];
  if (r.concerns.length) out.concerns = [...r.concerns];
  if (r.risk) {
    put(out, 'riskLevel', r.risk.level);
    put(out, 'riskBand', r.risk.band);
  }
  return out;
}

function projectWinner(w: AxisWinner): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'key', w.key);
  put(out, 'label', w.label);
  // The address, or the words for nobody. A template binds one leaf either way,
  // so no page has to carry a conditional for the 17% that name no one.
  out.winner = w.property ? w.property.shortAddress : NO_WINNER;
  const ref = projectRef(w.property);
  if (ref) out.property = ref;
  put(out, 'value', w.value);
  put(out, 'reason', w.reason);
  return out;
}

function projectNamed(n: NamedProperty | null): Record<string, unknown> | undefined {
  if (!n) return undefined;
  const out: Record<string, unknown> = {};
  out.winner = n.property ? n.property.address : NO_WINNER;
  const ref = projectRef(n.property);
  if (ref) out.property = ref;
  put(out, 'reason', n.reason);
  return out;
}

function projectRisk(r: RiskVerdict): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ref = projectRef(r.property);
  if (ref) Object.assign(out, ref);
  put(out, 'level', r.level);
  put(out, 'band', r.band);
  if (r.specificRisks.length) out.specificRisks = [...r.specificRisks];
  return out;
}

function projectFlag(f: RedFlag): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.winner = f.property ? f.property.shortAddress : NO_WINNER;
  const ref = projectRef(f.property);
  if (ref) Object.assign(out, ref);
  put(out, 'severity', f.severity);
  put(out, 'band', f.band);
  if (f.concerns.length) out.concerns = [...f.concerns];
  return out;
}

function projectMatch(m: InvestorMatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.winner = m.property ? m.property.shortAddress : NO_WINNER;
  const ref = projectRef(m.property);
  if (ref) Object.assign(out, ref);
  if (m.investorTypes.length) {
    out.investorTypes = [...m.investorTypes];
    // The list as a sentence, because the page has one line for it and a
    // template cannot join an array.
    out.investorTypesLine = m.investorTypes.join(' · ');
  }
  put(out, 'reasoning', m.reasoning);
  return out;
}

export interface ProjectedComparison {
  comparison: Record<string, unknown>;
  properties: Record<string, unknown>[];
  ranked: Record<string, unknown>[];
  axes: Record<string, unknown>;
  risks: Record<string, unknown>[];
  redFlags: Record<string, unknown>[];
  matches: Record<string, unknown>[];
  recommendations: Record<string, unknown>;
  basis: Record<string, unknown>;
  client: Record<string, unknown>;
  report: Record<string, unknown>;
}

/** Restate a normalised comparison in the vocabulary a template binds. */
export function projectComparisonModel(model: PropertyComparison): ProjectedComparison {
  const comparison: Record<string, unknown> = {};
  put(comparison, 'title', model.meta.title);
  put(comparison, 'analysedOn', model.meta.analysedOn);
  put(comparison, 'propertyCount', model.properties.length);
  put(comparison, 'narrative', model.narrative);
  put(comparison, 'summary', model.summary);
  if (model.scale) {
    put(comparison, 'scaleOutOf', model.scale.outOf);
    comparison.scaleConfident = model.scale.confident;
  }
  const states = [...new Set(model.properties.map((p) => p.state).filter(Boolean))];
  if (states.length) {
    comparison.states = states;
    comparison.statesLine = states.join(', ');
  }
  if (model.notes.length) comparison.notes = [...model.notes];
  // Which storage shape this came from. The page says so when a section is
  // missing because the response was cut off, rather than leaving the reader to
  // wonder whether the analysis simply had nothing to say.
  put(comparison, 'shape', model.provenance?.shape);

  // ── the axes, grouped as the normaliser grouped them ──────────────────────
  //
  // Bound by group id (`money`, `location`, `risk`) rather than flattened, so a
  // page can carry one group and a template never has to know how many axes a
  // group holds.
  const axes: Record<string, unknown> = {};
  for (const group of model.axes) {
    const winners = group.winners.map(projectWinner);
    if (!winners.length) continue;
    axes[group.id] = { title: group.title, winners };
  }

  const recommendations: Record<string, unknown> = {};
  if (model.recommendations) {
    const best = projectNamed(model.recommendations.bestOverall);
    if (best) recommendations.bestOverall = best;
    const runners = model.recommendations.runners.map(projectNamed).filter(Boolean);
    if (runners.length) recommendations.runners = runners;
    const avoid = model.recommendations.avoid.map(projectNamed).filter(Boolean);
    if (avoid.length) recommendations.avoid = avoid;
    const scenarios = model.recommendations.alternativeScenarios
      .map((s) => {
        const out: Record<string, unknown> = {};
        put(out, 'scenario', s.scenario);
        put(out, 'reason', s.reason);
        out.winner = s.property ? s.property.shortAddress : NO_WINNER;
        const ref = projectRef(s.property);
        if (ref) out.property = ref;
        return out;
      })
      .filter((s) => s.scenario !== undefined || s.reason !== undefined);
    if (scenarios.length) recommendations.alternativeScenarios = scenarios;
  }

  const basis: Record<string, unknown> = {};
  put(basis, 'timeHorizon', model.basis.timeHorizon);
  put(basis, 'riskTolerance', model.basis.riskTolerance);
  put(basis, 'depth', model.basis.depth);
  put(basis, 'investorProfile', model.basis.investorProfile);
  put(basis, 'model', model.basis.model);
  if (model.basis.weights.length) {
    basis.weights = model.basis.weights.map((w) => ({ ...w }));
  }

  // ── the two sections only a damaged record carries ────────────────────────
  // `marketTiming` and `competitiveAdvantages` have no column to live in: the
  // writer that destructures a successful response into seven columns drops
  // them, and only the salvage path reads them back — 23 and 10 of the 27
  // salvaged rows respectively. The projection header always claimed these
  // were published; until now it was wrong, and the richest sections of the
  // richest records reached no template.
  if (model.timing) {
    const t: Record<string, unknown> = {};
    if (model.timing.buyFirst) {
      t.buyFirstWinner = model.timing.buyFirst.property
        ? model.timing.buyFirst.property.address
        : NO_WINNER;
      put(t, 'buyFirstReason', model.timing.buyFirst.reason);
    }
    if (model.timing.holdingPeriods.length) {
      t.holds = model.timing.holdingPeriods.map((h) => {
        const out: Record<string, unknown> = {};
        out.winner = h.property ? h.property.shortAddress : 'Across the comparison';
        put(out, 'period', h.period);
        put(out, 'reason', h.reason);
        return out;
      });
    }
    if (Object.keys(t).length) comparison.timing = t;
  }
  if (model.advantages.length) {
    comparison.advantages = model.advantages.map((a) => {
      const out: Record<string, unknown> = {};
      // The legacy section's own fallback heading for an unattributed block.
      out.winner = a.property ? a.property.address : 'Across the comparison';
      if (a.advantages.length) {
        out.items = [...a.advantages];
        // The list as a sentence, because a callout has one body and a
        // template cannot join an array.
        out.line = a.advantages.join(' · ');
      }
      return out;
    });
  }

  // ── what the record does not hold, said the legacy's own way ──────────────
  // On a salvaged row `recommendations` is absent every time bar two — a
  // ranked comparison that silently omits "which should I buy" reads as a
  // finished document that forgot to answer its own question, so the note is
  // composed here, whole, in the legacy truncation callout's own sentences,
  // for the verdict page to show in the pick's place.
  if (model.provenance.shape === 'salvaged') {
    comparison.truncated = model.provenance.truncated;
    const missing = model.provenance.missing
      .map((k) => SECTION_LABELS[k] ?? k)
      .filter(Boolean);
    const recovered = model.provenance.recovered.length;
    const lost = missing.length
      ? ` ${missing.length === 1 ? 'One section was' : `${missing.length} sections were`} `
        + `never written: ${missing.join(', ')}.`
      : '';
    comparison.truncationNote =
      'The analysis was cut short while it was being written, and the sections it had '
      + `completed were stored as raw text rather than as a finished report. ${recovered} of `
      + `them ${recovered === 1 ? 'has' : 'have'} been read back and `
      + `${recovered === 1 ? 'appears' : 'appear'} in this document in full.${lost} `
      + 'Those sections are not missing from this report — they are not in the record. '
      + 'Re-running the comparison would produce them.';
  }

  // The verdict page's callout asks "why is there no recommendation here?"
  // whenever the pick is absent — not only when the record was cut short. A
  // structured, complete row can hold rankings and no best-overall (the model
  // omits the section, or names no property): on a real three-property render
  // (2026-09-04) the callout printed its heading over an empty body, because
  // this note existed only for salvaged rows. Composed exactly when the
  // master's `noPick` branch will draw, so a heading is never a promise with
  // nothing under it.
  if (!recommendations.bestOverall && !comparison.truncationNote) {
    comparison.truncationNote =
      'The saved analysis ranks every property and weighs the trade-offs, but it '
      + 'records no single "best overall" pick. This page leads with the top-ranked '
      + 'property instead; the full ranking and the reasons behind it follow.';
  }

  const client: Record<string, unknown> = {};
  put(client, 'name', model.meta.clientName);

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', model.meta.analysedOn);

  return {
    comparison,
    properties: model.properties.map((p) => projectRef(p) ?? {}),
    ranked: model.ranked.map(projectRanked),
    axes,
    risks: model.risks.map(projectRisk),
    redFlags: model.redFlags.map(projectFlag),
    matches: model.matches.map(projectMatch),
    recommendations,
    basis,
    client,
    report,
  };
}

/** Normalise a stored row and project it, in one step. */
export function projectComparison(input: BuildComparisonInput): ProjectedComparison {
  return projectComparisonModel(buildPropertyComparison(input));
}

/**
 * Merge the projection into a binding-context `data` object.
 *
 * ## Everything lands under `comparison`, and that is deliberate
 *
 * The obvious arrangement — `properties`, `ranked`, `risks`, `recommendations`
 * at the top level — collides with three namespaces the catalogue already uses
 * for other things: `risks` is a list of `{risk, why, action}` to the voice
 * templates, `recommendations` is a list of strings to the Borrowing Capacity
 * masters, and `properties` is a portfolio's holdings. In production each
 * report type gets its own data object so nothing would notice; in the preview
 * sample, where every format's data shares one object, whichever loaded last
 * would win and the other format's pages would render somebody else's content.
 *
 * A comparison is one analysis of one shortlist, so nesting costs nothing and
 * removes the whole class of collision. `client` and `report` stay at the top
 * because they are ambient — every format binds them and they mean the same
 * thing to all of them.
 */
export function applyComparisonProjection(
  data: Record<string, any>,
  input: BuildComparisonInput,
): Record<string, any> {
  const p = projectComparison(input);
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    const existing = data[key];
    data[key] = { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}), ...extra };
  };

  const comparison: Record<string, unknown> = { ...p.comparison };
  if (Object.keys(p.axes).length) comparison.axes = p.axes;
  if (Object.keys(p.recommendations).length) comparison.recommendations = p.recommendations;
  if (Object.keys(p.basis).length) comparison.basis = p.basis;
  if (p.properties.length) comparison.properties = p.properties;
  if (p.ranked.length) comparison.ranked = p.ranked;
  if (p.risks.length) comparison.risks = p.risks;
  if (p.redFlags.length) comparison.redFlags = p.redFlags;
  if (p.matches.length) comparison.matches = p.matches;

  merge('comparison', comparison);
  merge('client', p.client);
  merge('report', p.report);
  return data;
}
