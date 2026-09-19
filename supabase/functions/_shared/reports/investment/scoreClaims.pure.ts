/**
 * A score a document may print is a score the record holds.
 *
 * The audit of 291 Stone Mason Drive (QA-18) found the Briefing announcing an
 * "overall investment fit … rated 68/100", a "Metro-linked accessibility score
 * of 82" and a "suburb fit score of 82 for commuter families" — none of which
 * exists in `investment_score` (financial score 39, grade D) or anywhere in
 * the parent document the Briefing condenses. The condense guide already
 * forbids restating the score; a guide is an instruction to a model, and this
 * is the check that the instruction was obeyed.
 *
 * Two rules. **A claim is recognised by its shape, never by its topic**:
 * `NN/100`, "score of NN", "rated NN", "scored NN" — the forms the corpus
 * uses — so a new name for an invented number ("fit score", "accessibility
 * score") cannot slip past a list of known score names. And **a claim is
 * supported by the record or by the parent, never by itself**: the recorded
 * set is the total and every dimension the engine actually scored; a claim
 * the parent document already made with the same number (a walk score the
 * generator measured, say) is the parent's to answer for and is kept.
 *
 * Suppression removes the SENTENCE carrying the claim — the unit of the
 * assertion — and reports what went, so the hygiene log can say "the model
 * invented a score" rather than the document silently reading differently
 * from the model's draft. A composed table is never edited here, because it
 * prints only recorded figures.
 *
 * A chart directive was left alone for the same reason — "a directive is drawn
 * from its own numbers" — and that reason was wrong for the two primitives a
 * MODEL writes as a verdict. Measured on 262 Pallas Street, 17 Sep 2026, whose
 * record issues no grade at all:
 *
 *   {{gauge: 85 | Land Appeal | Large block relative to typical suburban lots}}
 *   {{gauge: 82 | Large-block lifestyle appeal | …}}
 *   {{wheel: 25,45,30,40,35 | labels=Environmental,Crime,Planning & overlays,…}}
 *
 * Eight numbers, none of them in `investment_score`, three of them drawn as
 * dials — and a gauge on a denominator of 100 prints a verdict band beside the
 * figure, so "85 · STRONG" reaches a client as a measurement of their
 * property. The prompt asked for it: "Investment Score, Affordability, Risk,
 * Suitability, Confidence, and similar 0-100 ratings MUST use {{gauge}}". That
 * line is narrowed at the source and `suppressUnrecordedVerdictVisuals` is the
 * check that it was obeyed.
 *
 * It is deliberately NARROW. `gauge` and `wheel` are rating primitives and
 * nothing else; `pictograph`, `bars`, `donut`, `heatmap` and `tiles` carry
 * proportions and measured series, and dropping those on a number-match would
 * take real data off the page. A pictograph asserting a proportion nobody
 * measured is a residual, named rather than guessed at.
 *
 * Deno-compatible: no imports.
 */

/** Where the claim sits and what it asserted. */
export interface ScoreClaim {
  /** The number asserted as a score. */
  value: number;
  /** The matched text, for the log. */
  text: string;
}

/**
 * `NN/100`, `NN out of 100`, `score of NN`, `scored NN`, `rated NN`,
 * `rating of NN`, `score is NN`, `score at NN`, `NN-point`. One alternation so
 * the forms cannot drift apart between the finder and the suppressor.
 */
const CLAIM_RE = /\b(\d{1,3})\s*(?:\/|out of)\s*100\b|\b(?:score|scores|scored|scoring|rated|rating)\s+(?:of|at|is|was)?\s*(\d{1,3})\b(?!\s*(?:%|per\s*cent|km|m\b|,\d))/gi;

/** Every score-shaped claim in a piece of prose. */
export function findScoreClaims(text: string): ScoreClaim[] {
  const out: ScoreClaim[] = [];
  for (const m of text.matchAll(CLAIM_RE)) {
    const raw = m[1] ?? m[2];
    const value = Number(raw);
    if (!Number.isFinite(value) || value > 100) continue;
    out.push({ value, text: m[0] });
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The numbers `investment_score` actually holds: the total and every
 * dimension the engine scored (`dimensionWasScored`'s rule, restated here
 * without the import so this module stays free of dependencies). A
 * placeholder 50 on an excluded dimension is not a recorded score.
 */
export function recordedScoreValues(score: unknown): number[] {
  if (!isRecord(score)) return [];
  const values = new Set<number>();
  const total = score.totalScore;
  if (typeof total === 'number' && Number.isFinite(total)) values.add(Math.round(total));
  if (isRecord(score.breakdown)) {
    for (const raw of Object.values(score.breakdown)) {
      if (!isRecord(raw)) continue;
      if (raw.excluded === true) continue;
      if ((raw.hasData ?? raw.available) === false) continue;
      const weight = raw.weight;
      if (typeof weight === 'number' && weight <= 0) continue;
      const s = raw.score;
      if (typeof s === 'number' && Number.isFinite(s)) values.add(Math.round(s));
    }
  }
  return [...values];
}

export interface SuppressedClaim extends ScoreClaim {
  /** The sentence that carried it, as removed. */
  sentence: string;
}

export interface ScoreSuppressionResult {
  markdown: string;
  removed: SuppressedClaim[];
}

/**
 * A line a sentence-level correction may edit: prose, not a heading, a table
 * row, a directive, a fence or a rule.
 *
 * Exported because `evidenceClaims.pure.ts` corrects a different claim by the
 * same unit, and two copies of "what counts as prose" is how one corrector
 * comes to edit a table the other leaves alone.
 */
export const isProseLine = (t: string): boolean =>
  t !== '' && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('{{')
  && !t.startsWith(':::') && !/^(-{3,}|\*{3,}|_{3,})$/.test(t);

/**
 * Split a paragraph into sentences, keeping each terminator with its sentence
 * and every character of the input in exactly one part.
 *
 * Two things this had to learn, both measured on the 48 Redfern Street prose.
 *
 * **It was not total.** `text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)` requires
 * each part to END at a terminator that is followed by whitespace, and a full
 * stop followed by anything else — a bracketed citation, most often — satisfies
 * neither alternative, so the engine walked the start position forward and the
 * text in between was DROPPED. On
 *
 *     "…at the time they were last updated.[Property.com.au, 119, 120, …]"
 *
 * it returned two parts whose second began mid-domain, at `au, 119, …`. Every
 * caller rebuilds the line with `kept.join(' ')`, so a paragraph carrying a
 * claim would have lost a sentence and a half that nothing had decided to
 * remove. Walking the terminators and slicing between them is total by
 * construction.
 *
 * **A citation belongs to the sentence it supports.** The generator's prose
 * puts `[Source, date]` immediately after the stop, with no space, so a
 * terminator may be followed by one bracket and still be a terminator. That
 * keeps the citation with the claim — which matters when the claim is the
 * thing being removed, because a source left standing over a deleted sentence
 * reads as the source of the sentence after it.
 */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  // A stop, optionally followed by one bracketed citation, then a boundary.
  const TERMINATOR = /[.!?]+(?:\s*\[[^\]\n]{0,160}\])?(?=\s|$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = TERMINATOR.exec(text)) !== null) {
    const end = m.index + m[0].length;
    out.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) out.push(text.slice(start));
  const parts = out.map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [text];
}

/**
 * Remove every sentence asserting a score the record does not hold and the
 * parent did not state. Prose lines only — a bullet is a prose line and loses
 * its sentence like any other; a bullet left with nothing goes.
 */
export function suppressUnrecordedScores(
  markdown: string,
  opts: { recorded: number[]; parentText?: string },
): ScoreSuppressionResult {
  const supported = new Set(opts.recorded.map((n) => Math.round(n)));
  if (opts.parentText) {
    for (const c of findScoreClaims(opts.parentText)) supported.add(c.value);
  }
  const removed: SuppressedClaim[] = [];
  const out: string[] = [];
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (!isProseLine(t)) { out.push(line); continue; }
    const claims = findScoreClaims(t).filter((c) => !supported.has(c.value));
    if (!claims.length) { out.push(line); continue; }

    const bullet = t.match(/^([-*+]\s+|\d+[.)]\s+)/);
    const prefix = bullet ? bullet[1] : '';
    const body = t.slice(prefix.length);
    const kept = sentencesOf(body).filter((sentence) => {
      const bad = findScoreClaims(sentence).filter((c) => !supported.has(c.value));
      if (!bad.length) return true;
      for (const c of bad) removed.push({ ...c, sentence });
      return false;
    });
    if (!kept.length) continue; // the whole line was the claim
    const indent = line.match(/^\s*/)?.[0] ?? '';
    out.push(`${indent}${prefix}${kept.join(' ')}`);
  }
  // A paragraph that lost its only line leaves two blank lines behind.
  const markdownOut = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return { markdown: markdownOut, removed };
}

/** A verdict visual that was removed, and the numbers it asserted. */
export interface SuppressedVisual {
  /** `gauge`, `wheel`, `bars`, `heatmap` or `radar`. */
  kind: string;
  /** The whole directive, as removed. */
  directive: string;
  /** The values it asserted that the record does not hold. */
  values: number[];
}

export interface VisualSuppressionResult {
  markdown: string;
  removed: SuppressedVisual[];
}

/**
 * The primitives that can carry a 0–100 rating.
 *
 * The first version of this guard named `gauge` and `wheel`, because those
 * were the two the prompt asked for. The model obeyed the narrowed rule and
 * put the SAME invented ratings into `{{bars}}` and `{{heatmap}}` instead —
 * pages 9, 15, 16 and 20 of the 17 Sep 2026 regeneration of 262 Pallas
 * Street. The rule had been written about a PRIMITIVE when it needed to be
 * written about a CLAIM, and a rule about a primitive is one the next
 * primitive walks around.
 */
const RATING_KINDS = ['gauge', 'wheel', 'bars', 'heatmap', 'radar'] as const;

/** Every number a rating visual asserts, rounded. */
function ratingValues(kind: string, payload: string): number[] {
  // The first field before `|` carries the value(s); everything after is
  // labels, captions and options, which may legitimately contain numbers
  // ("Around seven in ten…", "max=100").
  const head = payload.split('|')[0] ?? '';
  const out: number[] = [];
  const push = (v: string) => {
    const n = Number(v.trim());
    if (Number.isFinite(n)) out.push(Math.round(n));
  };
  if (kind === 'wheel') {
    for (const part of head.split(',')) push(part);
    return out;
  }
  if (kind === 'heatmap') {
    // `0.55,0.52 / 0.49,0.51` — rows divided by `/`, cells by `,`.
    for (const row of head.split('/')) for (const cell of row.split(',')) push(cell);
    return out;
  }
  if (kind === 'bars' || kind === 'radar') {
    // `Label 88, Label 92` — the value is the trailing number of each item,
    // and a label that itself ends in a number ("Stage 2") is why this reads
    // the LAST token rather than scanning the item for digits.
    for (const item of head.split(',')) {
      const m = item.trim().match(/(-?\d+(?:\.\d+)?)\s*%?$/);
      if (m) push(m[1]);
    }
    return out;
  }
  // gauge: `VALUE` or `VALUE/MAX` — the value is the assertion, the max is the
  // scale.
  push((head.split('/')[0] ?? ''));
  return out;
}

/**
 * Does the directive declare a 0–100 RATING scale?
 *
 * Measured over the 611 `{{bars}}` directives the generator produced in the
 * 60 days to 17 Sep 2026: **383 declare `max=100`**, and every one of the 25
 * most frequent titles among them is a minted rating rather than a sourced
 * statistic — "Market depth & cycle risk", "Risk focus areas (higher = more
 * attention needed)", "Planning certainty snapshot", "Property lifestyle fit
 * (0–100)", "Relative risk by category". One is worse than minted: "Typical
 * commuting times by car", which is minutes drawn on a rating scale.
 *
 * So the declaration is the tell. A genuine measured series — a renter share,
 * a median, a count — does not announce that it is scored out of a hundred,
 * and the 228 bars that declare no maximum are left alone.
 */
function declaresRatingScale(payload: string): boolean {
  const options = payload.split('|').slice(1).join('|');
  return /\bmax\s*=\s*100\b/.test(options);
}

/**
 * Remove every rating visual whose numbers the record does not hold.
 *
 * A directive is a whole line in this vocabulary, so the line goes — leaving no
 * hole, because the renderer draws nothing for a directive that is not there
 * and the prose around it introduces the finding in words.
 *
 * Two triggers, and the second is the one the first version was missing.
 * `gauge` and `wheel` are rating primitives by construction, so any value they
 * assert must be one the scoring engine recorded. `bars`, `heatmap` and
 * `radar` can carry a real measured series, so they are judged only where the
 * directive DECLARES a 0–100 rating scale — which is exactly how the invented
 * scorecards were spelled once the narrower rule pushed them out of the gauge.
 */
export function suppressUnrecordedVerdictVisuals(
  markdown: string,
  opts: { recorded: number[] },
): VisualSuppressionResult {
  const supported = new Set(opts.recorded.map((n) => Math.round(n)));
  const removed: SuppressedVisual[] = [];
  const out: string[] = [];
  const pattern = new RegExp(`^\\{\\{(${RATING_KINDS.join('|')})\\s*:\\s*([\\s\\S]*)\\}\\}$`);
  for (const line of markdown.split('\n')) {
    const m = line.trim().match(pattern);
    if (!m) { out.push(line); continue; }
    const kind = m[1];
    const payload = m[2];
    const alwaysRating = kind === 'gauge' || kind === 'wheel';
    if (!alwaysRating && !declaresRatingScale(payload)) { out.push(line); continue; }
    const values = ratingValues(kind, payload);
    const unsupported = values.filter((v) => !supported.has(v));
    // A directive with no readable number is left alone: it is malformed
    // rather than untrue, and that is a different control's business.
    if (!values.length || !unsupported.length) { out.push(line); continue; }
    removed.push({ kind, directive: line.trim(), values: unsupported });
  }
  return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n'), removed };
}
