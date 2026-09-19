/**
 * llm-json-v1 — canonical shared pure module for reading LLM extraction output.
 *
 * Every AI-backed document parser in this codebase asks a model for JSON and
 * then has to survive what actually comes back. The defects this module exists
 * to fix, all of which silently *lost extracted data* before it existed:
 *
 *   - `typeof value === 'number'` guards drop `"850000"`, `"$850,000"`,
 *     `"6.25%"`, `"1,200 sqm"` and `"$1.2m"` — the shapes a vision model
 *     actually returns when it reads a brochure — so a correctly-read price
 *     was thrown away at the parse step;
 *   - `value || undefined` lets the literal strings `"null"`, `"N/A"` and
 *     `"Not stated"` through as if they were content, which then get written
 *     to the property record as an address;
 *   - `JSON.parse(content)` throws the whole extraction away when the model
 *     wraps its answer in prose or a code fence, or leaves a trailing comma.
 *
 * Coercion here is deliberately *lossless-or-null*: a value is either
 * recovered with confidence or dropped. It never guesses a magnitude, never
 * invents a unit, and never returns a partially-parsed number.
 *
 * Pure + deterministic + JSON-safe: no DOM, network, secrets or clocks.
 */

export const LLM_JSON_VERSION = 'llm-json-v1';

// ── Robust JSON recovery ─────────────────────────────────────────────────────

/**
 * Pull the first balanced JSON object/array out of a model response.
 *
 * Handles markdown fences, leading/trailing prose ("Here is the JSON: …"), and
 * braces that appear inside string values. Returns null when there is no
 * balanced candidate rather than a half-open fragment.
 */
export function extractJsonBlock(content: string | null | undefined): string | null {
  const raw = String(content ?? '').trim();
  if (!raw) return null;

  // Prefer the contents of a fenced block when one is present.
  const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(raw);
  const candidates = fenced ? [fenced[1]!.trim(), raw] : [raw];

  for (const candidate of candidates) {
    const found = scanBalanced(candidate);
    if (found) return found;
  }
  return null;
}

function scanBalanced(text: string): string | null {
  const openIndex = (() => {
    const brace = text.indexOf('{');
    const bracket = text.indexOf('[');
    if (brace < 0) return bracket;
    if (bracket < 0) return brace;
    return Math.min(brace, bracket);
  })();
  if (openIndex < 0) return null;

  const open = text[openIndex]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return null;
}

/** Common model-emitted deviations from strict JSON, repaired conservatively. */
function repairJson(text: string): string {
  return text
    // Trailing commas before a closing brace/bracket.
    .replace(/,(\s*[}\]])/g, '$1')
    // Bare non-JSON literals models emit for "no value".
    .replace(/:\s*undefined\b/g, ': null')
    .replace(/:\s*NaN\b/g, ': null')
    .replace(/:\s*-?Infinity\b/g, ': null')
    // Smart quotes used as JSON string delimiters.
    .replace(/[“”]/g, '"')
    // Unquoted keys, e.g. {price: 1} — only when clearly a key position.
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3');
}

/**
 * Parse an LLM response into JSON, recovering from fences, prose and the small
 * syntax slips models make. Returns null instead of throwing so a caller can
 * fall back rather than losing the whole extraction.
 */
export function parseLlmJson<T = unknown>(content: string | null | undefined): T | null {
  const block = extractJsonBlock(content);
  if (!block) return null;
  try {
    return JSON.parse(block) as T;
  } catch {
    /* fall through to the repair pass */
  }
  try {
    return JSON.parse(repairJson(block)) as T;
  } catch {
    return null;
  }
}

/**
 * Reading a model's JSON answer, WITH the reason when it cannot be read.
 *
 * `parseLlmJson` answers null for two situations an operator has to tell
 * apart, and `generate-portfolio-analysis` proved why. Its two callers each
 * hand-rolled their own fence regex; both required a CLOSING fence, and on
 * 1 September 2026 every Portfolio Analysis and every AI Insight in
 * production failed, because the answers were being cut off before the model
 * could write one:
 *
 *   insights   max_tokens 1200  ->  completion_tokens 1196
 *   insights   max_tokens 1200  ->  completion_tokens 1196
 *   full       max_tokens 8000  ->  completion_tokens 7996
 *   full       max_tokens 8000  ->  completion_tokens 7996
 *
 * Four short of the ceiling, every time. The gateway still reported
 * `status: success` — a truncated answer is a successful HTTP call — and the
 * only thing that knew was `finish_reason`, which nothing read. So the
 * operator was told "Failed to parse analysis results" about a model that had
 * answered perfectly and simply run out of room, and the one number that would
 * have fixed it appeared nowhere.
 *
 * The order matters: PARSE first, and use `finishReason` only to explain a
 * failure. A truncated top-level object never balances, so `scanBalanced`
 * already refuses it; if parsing succeeded the object closed, which means it
 * is whole whatever the finish reason says.
 */
export type ModelJsonRead<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'empty' | 'truncated' | 'not_json'; message: string };

export function readModelJson<T = unknown>(
  content: string | null | undefined,
  finishReason?: string | null,
): ModelJsonRead<T> {
  const text = String(content ?? '').trim();
  if (!text) {
    return {
      ok: false,
      reason: 'empty',
      message: 'The model returned nothing at all.',
    };
  }

  const parsed = parseLlmJson<T>(text);
  if (parsed !== null && parsed !== undefined) return { ok: true, value: parsed };

  if (String(finishReason ?? '').toLowerCase() === 'length') {
    return {
      ok: false,
      reason: 'truncated',
      message:
        "The model's answer was cut off before it finished — it ran out of its token budget. "
        + 'Raise the budget for this call rather than retrying, which will stop at the same place.',
    };
  }

  return {
    ok: false,
    reason: 'not_json',
    message: 'The model did not answer with JSON.',
  };
}

// ── Null-ish sentinels ───────────────────────────────────────────────────────

/**
 * Strings a model uses to mean "absent". Treating these as content is how
 * `"Not stated"` ends up saved as a property address.
 */
const NULLISH_TEXT = new Set([
  '', '-', '--', '—', '–', 'n/a', 'na', 'n.a.', 'nil', 'none', 'null', 'nan',
  'undefined', 'unknown', 'not stated', 'not specified', 'not provided',
  'not applicable', 'not available', 'not found', 'not disclosed', 'no data',
  'tbc', 'tba', 'tbd', 'to be confirmed', 'to be advised', 'n/d', 'nd',
  '?', '??', 'x', 'pending',
]);

/** True when a raw value means "the document did not say". */
export function isNullish(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value === 'string') return NULLISH_TEXT.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// ── Text ─────────────────────────────────────────────────────────────────────

export interface CoerceTextOptions {
  /** Hard cap on the returned string. Longer input is trimmed at a word boundary. */
  maxLength?: number;
  /** Collapse internal whitespace runs to a single space. Default true. */
  collapseWhitespace?: boolean;
}

/** Coerce to a meaningful string, or undefined when the document did not say. */
export function coerceText(
  value: unknown,
  options: CoerceTextOptions = {},
): string | undefined {
  if (isNullish(value)) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const joined = value.map((v) => coerceText(v, options)).filter(Boolean).join(', ');
    return joined || undefined;
  }
  if (typeof value !== 'string') return undefined;

  let text = value.trim();
  if (options.collapseWhitespace !== false) text = text.replace(/\s+/g, ' ');
  if (!text || NULLISH_TEXT.has(text.toLowerCase())) return undefined;

  const max = options.maxLength;
  if (max && text.length > max) {
    const head = text.slice(0, max);
    const space = head.lastIndexOf(' ');
    text = (space > max * 0.6 ? head.slice(0, space) : head).trim();
  }
  return text || undefined;
}

// ── Numbers ──────────────────────────────────────────────────────────────────

/**
 * Magnitude suffixes, split by whether the letter is ambiguous with a unit.
 * `m` means million after a currency symbol and metres after a measurement —
 * reading `5.5m clearance` as 5,500,000 is exactly the class of silent
 * corruption this module exists to prevent.
 */
const UNAMBIGUOUS_MAGNITUDES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(?:bn|billion)\b/i, 1_000_000_000],
  [/^(?:mil|mill|million)\b/i, 1_000_000],
  [/^(?:k|thousand)\b/i, 1_000],
];

const CURRENCY_ONLY_MAGNITUDES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^b\b/i, 1_000_000_000],
  [/^m\b/i, 1_000_000],
];

/** A currency marker anywhere before the number makes `m`/`b` monetary. */
const CURRENCY_MARKER = /(?:AUD|AU\$|A\$|US\$|USD|NZ\$|\$|£|€)\s*$/i;

/** Units that trail a number and must not be read as a magnitude suffix. */
const TRAILING_UNITS =
  /^(?:sqm|sq\.?\s?m|m2|m²|sqft|sq\.?\s?ft|ft2|ha|hectares?|acres?|pa\b|p\.a\.|per\s+annum|per\s+week|pw\b|p\.w\.|kva|kw|kpa|years?|yrs?|months?|bays?|spaces?|doors?|metres?|meters?)\b/i;

export interface CoerceNumberOptions {
  /** Reject values outside this inclusive range (returns undefined). */
  min?: number;
  max?: number;
  /** Round to this many decimal places. */
  decimals?: number;
  /** Apply `k`/`m`/`bn` multipliers. Default true. */
  allowMagnitudeSuffix?: boolean;
}

/**
 * Recover a number from anything a model plausibly returns for a numeric field:
 * `850000`, `"850000"`, `"$850,000"`, `"AU$1.2m"`, `"1,200 sqm"`, `"6.25%"`,
 * `"(12,500)"` (accounting negative), `"approx. 450"`, `"$800,000 - $850,000"`
 * (first value).
 *
 * Returns undefined — never a partial parse — when no unambiguous number is
 * present, so a caller can distinguish "not found" from "found and zero".
 */
export function coerceNumber(
  value: unknown,
  options: CoerceNumberOptions = {},
): number | undefined {
  const finish = (n: number): number | undefined => {
    if (!Number.isFinite(n)) return undefined;
    let result = n;
    if (options.decimals != null) {
      const factor = 10 ** Math.max(0, Math.floor(options.decimals));
      result = Math.round((result + Number.EPSILON) * factor) / factor;
    }
    if (options.min != null && result < options.min) return undefined;
    if (options.max != null && result > options.max) return undefined;
    return result;
  };

  if (typeof value === 'number') return finish(value);
  if (typeof value === 'boolean' || value == null) return undefined;
  if (Array.isArray(value)) return value.length ? coerceNumber(value[0], options) : undefined;
  if (typeof value !== 'string') return undefined;

  const raw = value.trim();
  if (!raw || NULLISH_TEXT.has(raw.toLowerCase())) return undefined;

  // Accounting-style negatives: (12,500) means -12500.
  const parenthesised = /^\(\s*(.+?)\s*\)$/.exec(raw);
  const body = parenthesised ? parenthesised[1]! : raw;

  // First numeric token, optionally signed, with thousands separators.
  const match = /[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d*\.\d+|[-+]?\d+/.exec(body);
  if (!match) return undefined;

  const numeric = Number(match[0].replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return undefined;

  let result = numeric;

  if (options.allowMagnitudeSuffix !== false) {
    // Only text immediately after the number can be a magnitude suffix, and only
    // when it is not a unit: `1,200 sqm` must stay 1,200, `$1.2m` must become
    // 1,200,000, and `5.5m clearance` must stay 5.5.
    const tail = body.slice(match.index + match[0].length).trimStart();
    if (tail && !TRAILING_UNITS.test(tail)) {
      const head = body.slice(0, match.index);
      const monetary = CURRENCY_MARKER.test(head);
      const table = monetary
        ? [...UNAMBIGUOUS_MAGNITUDES, ...CURRENCY_ONLY_MAGNITUDES]
        : UNAMBIGUOUS_MAGNITUDES;
      for (const [pattern, factor] of table) {
        if (pattern.test(tail)) {
          result *= factor;
          break;
        }
      }
    }
  }

  if (parenthesised && result > 0) result = -result;
  return finish(result);
}

/** Coerce to an integer, dropping values that are not whole after rounding. */
export function coerceInteger(
  value: unknown,
  options: CoerceNumberOptions & { roundHalfUp?: boolean } = {},
): number | undefined {
  const num = coerceNumber(value, { ...options, decimals: undefined });
  if (num == null) return undefined;
  const rounded = Math.round(num);
  if (options.min != null && rounded < options.min) return undefined;
  if (options.max != null && rounded > options.max) return undefined;
  return rounded;
}

export interface CoercePercentOptions extends CoerceNumberOptions {
  /**
   * When the source omits the `%` sign, values at or below this are read as a
   * fraction and scaled ×100 (`0.0625` → `6.25`). Set to 0 to disable.
   * Default 1 — cap rates and yields are never legitimately ≤1%.
   */
  fractionThreshold?: number;
}

/**
 * Coerce a percentage to percent units. `"6.25%"` → `6.25`, `6.25` → `6.25`,
 * and a bare `0.0625` → `6.25` (models mix the two conventions constantly, and
 * a cap rate stored as 0.0625 renders as "0.06%" downstream).
 */
export function coercePercent(
  value: unknown,
  options: CoercePercentOptions = {},
): number | undefined {
  const { fractionThreshold = 1, ...numberOptions } = options;
  const hadPercentSign = typeof value === 'string' && value.includes('%');
  // Range and precision are applied AFTER any fraction→percent scaling: rounding
  // `0.0575` to 3dp first would have yielded 5.8 instead of 5.75.
  const num = coerceNumber(value, {
    ...numberOptions,
    min: undefined,
    max: undefined,
    decimals: undefined,
  });
  if (num == null) return undefined;

  let percent = num;
  if (!hadPercentSign && fractionThreshold > 0 && num > 0 && num <= fractionThreshold) {
    percent = num * 100;
  }
  if (options.decimals != null) {
    const factor = 10 ** Math.max(0, Math.floor(options.decimals));
    percent = Math.round((percent + Number.EPSILON) * factor) / factor;
  }
  if (options.min != null && percent < options.min) return undefined;
  if (options.max != null && percent > options.max) return undefined;
  return percent;
}

// ── Booleans, enums, arrays, dates ───────────────────────────────────────────

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'included', 'present', 'confirmed']);
const FALSY = new Set(['false', 'no', 'n', '0', 'excluded', 'absent']);

/** Coerce to boolean, or undefined when the value carries no yes/no signal. */
export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (TRUTHY.has(text)) return true;
  if (FALSY.has(text)) return false;
  return undefined;
}

function enumKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\-.]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/**
 * Match a model's free-form answer to an allowed enum value, tolerating case,
 * spacing and punctuation differences (`"Going Concern"` → `going_concern`,
 * `"Triple-Net"` → `triple_net`). Unknown values are dropped, never passed
 * through — an unconstrained string in an enum column is a downstream bug.
 */
export function coerceEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  aliases: Readonly<Record<string, T>> = {},
): T | undefined {
  const text = coerceText(value);
  if (!text) return undefined;
  const key = enumKey(text);
  for (const option of allowed) {
    if (enumKey(option) === key) return option;
  }
  for (const [alias, target] of Object.entries(aliases)) {
    if (enumKey(alias) === key) return target;
  }
  return undefined;
}

export interface CoerceStringArrayOptions {
  maxItems?: number;
  maxItemLength?: number;
  /** Split a delimited string into items. Default true. */
  splitDelimited?: boolean;
}

/** Coerce to a de-duplicated array of meaningful strings. */
export function coerceStringArray(
  value: unknown,
  options: CoerceStringArrayOptions = {},
): string[] | undefined {
  const { maxItems, maxItemLength, splitDelimited = true } = options;
  let items: unknown[];

  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string' && splitDelimited) items = value.split(/[;,\n]|\s\/\s|\s\|\s/);
  else if (typeof value === 'string') items = [value];
  else return undefined;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = coerceText(item, { maxLength: maxItemLength });
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (maxItems != null && out.length >= maxItems) break;
  }
  return out.length ? out : undefined;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (year < 1800 || year > 2200) return undefined;
  // Reject impossible days (31 Feb) rather than silently rolling over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return undefined;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Coerce to an ISO `yyyy-mm-dd` date. Understands the formats Australian
 * property and finance documents use — `31/12/2027` is read day-first, which
 * is the convention in every source this codebase ingests.
 */
export function coerceIsoDate(value: unknown): string | undefined {
  const text = coerceText(value);
  if (!text) return undefined;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slashed = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (slashed) {
    let year = Number(slashed[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    // Day-first (AU). If that reading is impossible (`03/25/2027`) the source
    // was month-first — read it that way rather than dropping the value.
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    return isoDate(year, second, first) ?? isoDate(year, first, second);
  }

  const named = /^(\d{1,2})?\s*(?:st|nd|rd|th)?\s*([A-Za-z]{3,9})\.?,?\s*(\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS[named[2]!.slice(0, 4).toLowerCase()] ?? MONTHS[named[2]!.slice(0, 3).toLowerCase()];
    if (month) return isoDate(Number(named[3]), month, named[1] ? Number(named[1]) : 1);
  }

  const monthFirst = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/.exec(text);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1]!.slice(0, 4).toLowerCase()] ?? MONTHS[monthFirst[1]!.slice(0, 3).toLowerCase()];
    if (month) return isoDate(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }

  return undefined;
}

// ── Australian address helpers ───────────────────────────────────────────────

const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;
export type AuState = (typeof AU_STATES)[number];

const AU_STATE_ALIASES: Readonly<Record<string, AuState>> = {
  new_south_wales: 'NSW', victoria: 'VIC', queensland: 'QLD',
  western_australia: 'WA', south_australia: 'SA', tasmania: 'TAS',
  australian_capital_territory: 'ACT', northern_territory: 'NT',
};

/** Normalise a state to its official abbreviation, or drop it. */
export function coerceAuState(value: unknown): AuState | undefined {
  return coerceEnum(value, AU_STATES, AU_STATE_ALIASES);
}

/**
 * Coerce an Australian postcode to its 4-digit form. Accepts a number (`2000`)
 * or a string, zero-pads NT/ACT codes the model returned as 3 digits (`800` →
 * `0800`), and rejects anything outside the allocated range.
 */
export function coerceAuPostcode(value: unknown): string | undefined {
  if (isNullish(value)) return undefined;
  const digits = String(value).replace(/\D/g, '');
  if (!digits || digits.length > 4) return undefined;
  const padded = digits.padStart(4, '0');
  const numeric = Number(padded);
  if (!Number.isFinite(numeric) || numeric < 200 || numeric > 9999) return undefined;
  return padded;
}
