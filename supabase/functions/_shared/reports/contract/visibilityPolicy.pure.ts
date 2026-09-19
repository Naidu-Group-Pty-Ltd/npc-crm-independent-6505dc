/**
 * RF-7.2B — the null and visibility policy.
 *
 * **A raw null must never be client-visible, and an absence must never become
 * a zero.** Those are two different failures and this module exists because the
 * second is the dangerous one: `null` on a page looks like a bug and gets
 * reported, while `$0` looks like a figure and gets believed.
 *
 * ## Three states, never two
 *
 * The whole module turns on refusing a truthiness test:
 *
 * | state | what it means | how it renders |
 * | --- | --- | --- |
 * | `absent` | `null`, `undefined`, `''`, `NaN` | the field, its label and its row are omitted |
 * | `zero` | a real, measured `0` | `$0`, `0%`, `0` — it is a finding |
 * | `value` | anything else | normally |
 *
 * `if (value)` collapses `zero` into `absent`, which is how a property with
 * genuinely zero holding cost comes to have no cash-flow line at all.
 * `presenceOf` is an explicit type-and-value test and nothing here may use
 * truthiness on a fact.
 *
 * ## Two kinds of absence
 *
 * **Optional absence is suppressed.** A missing `yearBuilt` should take its
 * label and its table row with it. A report that lists what it does not know is
 * longer, not more honest — and RF-7.2A's §24 is explicit that the executive
 * summary must not become a catalogue of "Not available".
 *
 * **Material absence is explained.** Where the gap changes what the reader
 * should conclude — no overall grade, no growth evidence — silence is worse
 * than a sentence. The sentence comes from a *semantic rule* here, never from a
 * formatter fallback, because a formatter does not know whether the fact it is
 * blanking mattered.
 *
 * ## Charts
 *
 * An absent point is a hole, never a zero. Mapping absence to zero draws a
 * collapse that did not happen — the visual equivalent of printing `$0` — so a
 * series that cannot meet its minimum meaningful density is suppressed whole
 * rather than drawn with invented floors.
 *
 * Pure: no clock, no randomness, no IO. It decides what may be drawn; it draws
 * nothing.
 */

export const VISIBILITY_POLICY_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Presence — the three states
// ---------------------------------------------------------------------------

export type Presence = 'absent' | 'zero' | 'value';

/**
 * Which of the three states a value is in.
 *
 * Explicit by type and value. `NaN` is absent rather than a number, because a
 * `NaN` that survives to a page prints as `NaN`, `$NaN` or `NaN%` — all of
 * which RF-7.2B §11 forbids outright.
 */
export function presenceOf(value: unknown): Presence {
  if (value === null || value === undefined) return 'absent';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'absent';
    return value === 0 ? 'zero' : 'value';
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.length === 0) return 'absent';
    // A string that is ONLY a hard technical token is an absence wearing a
    // value's clothes — it reaches a page when an upstream reader stringifies
    // before checking.
    //
    // Deliberately the hard list and not the soft one: "-", "N/A", "none" and
    // "TBC" can all be somebody's real content (a dash in a name, a zoning of
    // "None"), and treating them as absent here would delete real data. The
    // soft tokens are for SCANNING rendered output, which is a different job.
    if (HARD_TECHNICAL_TOKENS.includes(t.toLowerCase())) return 'absent';
    return 'value';
  }
  if (typeof value === 'boolean') return value ? 'value' : 'zero';
  if (Array.isArray(value)) return value.length === 0 ? 'absent' : 'value';
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length === 0 ? 'absent' : 'value';
  }
  return 'value';
}

/**
 * Tokens that can NEVER be legitimate content — a value that is only one of
 * these is an absence that leaked through a `String()` somewhere upstream.
 */
export const HARD_TECHNICAL_TOKENS: readonly string[] = [
  'null', 'undefined', 'nan', '$nan', 'nan%', '[object object]',
];

/**
 * Tokens that USUALLY mean "nothing", and sometimes do not.
 *
 * Used to flag a rendered page for review, never to decide presence: a zoning
 * of "None" and a street called "Na" are real, and deleting them would be a
 * worse fault than showing a dash.
 */
export const SOFT_TECHNICAL_TOKENS: readonly string[] = [
  'none', 'n/a', 'na', '-', '—', 'tbc', 'tbd',
];

/** True where the value may be rendered at all. */
export function isRenderable(value: unknown): boolean {
  return presenceOf(value) !== 'absent';
}

/**
 * Does this rendered string leak a technical token to a client?
 *
 * Deliberately whole-token rather than substring: "Sunnybank" contains "n/a"
 * by letters and is a suburb. §23 makes the same point — do not blindly search
 * prose where legitimate words appear.
 */
export function leaksTechnicalToken(rendered: unknown): string | null {
  if (typeof rendered !== 'string') return null;
  for (const token of ['null', 'undefined', 'NaN', '$NaN', 'NaN%', '[object Object]']) {
    const pattern = new RegExp(
      `(^|[\\s>(\\[,:;|])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s<)\\],:;|.])`,
      token === 'NaN' || token === '$NaN' || token === 'NaN%' ? '' : 'i',
    );
    if (pattern.test(rendered)) return token;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type FieldDecision =
  /** Draw the label and the value. */
  | { readonly render: 'value'; readonly value: unknown }
  /** Draw nothing at all — not the value, not the label, not the row. */
  | { readonly render: 'omit'; readonly why: string }
  /** Draw a deliberate sentence, because this gap changes the reading. */
  | { readonly render: 'material_absence'; readonly statement: string };

export interface FieldPolicy {
  readonly name: string;
  readonly value: unknown;
  /** Material fields explain their absence; optional ones vanish. */
  readonly material?: boolean;
  /** The sentence for a material absence. Required when `material` is true. */
  readonly absenceStatement?: string;
}

/**
 * What to do with one field.
 *
 * A genuine zero renders. An optional absence disappears completely. A material
 * absence gets the sentence its author wrote — and if no sentence was written,
 * it is treated as optional rather than getting a generated one, because a
 * fallback sentence is how "Not available" ends up beside forty fields.
 */
export function decideField(policy: FieldPolicy): FieldDecision {
  const presence = presenceOf(policy.value);
  if (presence !== 'absent') return { render: 'value', value: policy.value };

  if (policy.material === true && policy.absenceStatement) {
    return { render: 'material_absence', statement: policy.absenceStatement };
  }
  return {
    render: 'omit',
    why: policy.material === true
      ? `${policy.name} is material but no absence statement was written, so it is `
        + 'suppressed rather than given a generated one.'
      : `${policy.name} has no client-safe value.`,
  };
}

/** Keep only the rows a table should actually contain. */
export function visibleRows<T extends { readonly value: unknown }>(
  rows: readonly T[],
): T[] {
  return rows.filter((r) => presenceOf(r.value) !== 'absent');
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export interface SectionPolicy {
  readonly name: string;
  /** Every field the section would draw. */
  readonly fields: readonly FieldPolicy[];
  /** Draw the section even when empty — for a section whose absence is the point. */
  readonly alwaysRender?: boolean;
}

export interface SectionDecision {
  readonly name: string;
  readonly render: boolean;
  readonly visibleFields: number;
  readonly materialAbsences: number;
  readonly why: string;
}

/**
 * Whether a section has anything worth drawing.
 *
 * A section renders when it has at least one visible field OR at least one
 * material absence to explain. Everything else is suppressed whole — heading,
 * card, table and the page break it would have bought.
 */
export function decideSection(policy: SectionPolicy): SectionDecision {
  const decisions = policy.fields.map((f) => decideField(f));
  const visible = decisions.filter((d) => d.render === 'value').length;
  const material = decisions.filter((d) => d.render === 'material_absence').length;
  const render = policy.alwaysRender === true || visible > 0 || material > 0;
  return {
    name: policy.name,
    render,
    visibleFields: visible,
    materialAbsences: material,
    why: render
      ? `${visible} field(s) to show and ${material} absence(s) to explain.`
      : 'Nothing client-safe to show, so the heading and its frame are suppressed too.',
  };
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export interface ChartPoint {
  readonly label: string;
  readonly value: unknown;
}

export interface ChartDecision {
  readonly render: boolean;
  /** Only the points that genuinely have a value. Absence is never a zero. */
  readonly points: Array<{ label: string; value: number }>;
  readonly dropped: number;
  readonly why: string;
}

/**
 * Whether a series may be drawn, and with which points.
 *
 * An absent point is DROPPED, never floored to zero: a zero draws a collapse
 * to the axis that the data does not support, and a reader cannot tell an
 * invented trough from a measured one. Below the minimum density the chart is
 * suppressed entirely rather than drawn as a near-empty frame.
 */
export function decideChart(
  points: readonly ChartPoint[],
  minimumPoints = 3,
): ChartDecision {
  const kept: Array<{ label: string; value: number }> = [];
  for (const p of points) {
    if (presenceOf(p.value) === 'absent') continue;
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) continue;
    kept.push({ label: p.label, value: p.value });
  }
  const dropped = points.length - kept.length;
  if (kept.length < minimumPoints) {
    return {
      render: false,
      points: [],
      dropped,
      why: `Only ${kept.length} of ${points.length} points carry a value, below the `
        + `minimum of ${minimumPoints}. The chart is suppressed rather than drawn `
        + 'with invented floors.',
    };
  }
  return {
    render: true,
    points: kept,
    dropped,
    why: dropped === 0
      ? `All ${kept.length} points measured.`
      : `${kept.length} measured; ${dropped} absent point(s) omitted rather than zeroed.`,
  };
}
