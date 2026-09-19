/**
 * Reading back an analysis that was cut off while it was being written.
 *
 * ## What happened, and to how much of the record
 *
 * `compare-investment-reports` asked a model for ten sections of JSON with a
 * flat 12,000-token ceiling shared with that model's own reasoning. For two
 * properties that fits. For five it does not: the response stops mid-token,
 * `JSON.parse` throws, and the `catch` stored the raw string into
 * `executive_summary` leaving all seven structured columns NULL.
 *
 * **The producer no longer does that** — `analysisRequest.pure.ts` scales the
 * budget with the property count, asks for the shape as a schema, and retries a
 * response that is not an analysis. This module is not thereby obsolete: it is
 * the read-time view of the 30 rows already in the table, and it is still what
 * the producer stores against when an answer does come back cut off, because a
 * partial answer read honestly beats a shorter document printed as though it
 * were whole.
 *
 * The damage tracks the property count exactly — 0 of 7 two-property comparisons,
 * 16 of 17 five-property ones — and comes to **27 of 50 rows**. Of those 27,
 * `executiveSummary`, `rankings`, `financialComparison`, `locationComparison`,
 * `riskComparison` and `investorMatches` are present **27/27**; `redFlags` 12/27;
 * `recommendations` **0/27**. Six complete sections per row that nothing in the
 * application has ever been able to read.
 *
 * ## The unit of recovery is a closed top-level pair
 *
 * The obvious approach — take the longest prefix that parses — is wrong, and
 * wrong in the one way that would never show up on the page. To make a truncated
 * prefix parse at all you have to *repair* it by closing whatever brackets are
 * open, and closing an array mid-element hands back a **partial last element**: a
 * ranking with an address and no score, printed on a client's document as though
 * it were whole. Nothing downstream can tell it apart from a real one.
 *
 * So this module never repairs. It scans once, left to right, and records a
 * top-level pair only when it has seen that pair's terminator — a comma or the
 * closing brace at depth 1, outside a string. An array cut mid-element never
 * reaches its terminator, so it is never recorded, so a partial element cannot
 * exist in the output. That property is what `salvage.spec.ts` fuzzes for.
 *
 * ## What this is not licensed to do
 *
 * It does not invent, interpolate or repair, it does not ask a model, and it
 * never writes back. A section is read whole or it is reported missing. The
 * alternative recovery — regenerating the analysis — is exactly the defect this
 * migration removes, since that is what makes downloading a saved comparison cost
 * tokens and return different prose each time.
 */

/**
 * Three times the largest blob in the record (20,425 characters).
 *
 * A cap rather than a guess: the scan is linear, so this bounds the work at a
 * size no legitimate input approaches. Anything longer is not a truncated
 * analysis, it is something else, and reading 64 KB of it is enough to say so.
 */
export const MAX_SALVAGE_CHARS = 65_536;

/** The schema names ten sections. Twenty over is room for a variant, not a loop. */
export const MAX_SALVAGE_KEYS = 32;

/**
 * The sections the producer is asked for, in the order it writes them.
 *
 * `missing` is reported against this list, so a reader is told which of the
 * *expected* sections are absent rather than being handed the difference between
 * two arbitrary sets. The tail of this list is what truncation eats first, which
 * is why `recommendations` — written last — survives on no row at all.
 */
export const COMPARISON_SECTIONS: readonly string[] = [
  'executiveSummary',
  'rankings',
  'financialComparison',
  'locationComparison',
  'riskComparison',
  'investorMatches',
  'marketTiming',
  'competitiveAdvantages',
  'redFlags',
  'recommendations',
];

/**
 * The producer names its last section two different ways.
 *
 * Measured: of the 27 truncated rows, `recommendations` survives on none and
 * `finalRecommendation` — the same shape, `{bestOverall, runners, avoid, …}` —
 * survives on two. The writer maps either into the `recommendations` column, so
 * treating them as one key here is what the column path already does, and
 * without it `missing` would report a section as absent while holding it.
 */
const SECTION_ALIASES: Readonly<Record<string, string>> = {
  finalRecommendation: 'recommendations',
};

/** A recovered key under the name `COMPARISON_SECTIONS` uses. */
export const canonicalSection = (key: string): string => SECTION_ALIASES[key] ?? key;

export interface SalvageResult {
  /** Only pairs that closed. Never a partial value. */
  value: Record<string, unknown>;
  /** Top-level keys read back whole, in the order they appeared. */
  recovered: readonly string[];
  /** `COMPARISON_SECTIONS` minus `recovered`, in schema order. */
  missing: readonly string[];
  /** True when the input did not parse whole — i.e. it was cut off. */
  truncated: boolean;
  /** Set when nothing could be read at all. Names why, for the ledger. */
  reason: string;
}

/** True when this text looks like a stored raw model response rather than prose. */
export function looksLikeRawJson(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false;
  const head = stripFence(raw).slice(0, 1);
  return head === '{';
}

/**
 * Remove a Markdown code fence, anchored to the ends.
 *
 * Anchored deliberately. The producer's own strip is global
 * (`replace(/```json\s*\n|\n```/g, '')`), which is part of why 8 of the 27 stored
 * blobs still carry a fence — and a global strip would happily delete a
 * fence-like sequence that appears inside a string value, corrupting a document
 * that was otherwise fine.
 */
export function stripFence(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/^```[ \t]*(?:json)?[ \t]*\r?\n/, '');
  s = s.replace(/\r?\n[ \t]*```[ \t]*$/, '');
  return s.trim();
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Everything in `COMPARISON_SECTIONS` that is not in `recovered`, in schema order. */
function missingFrom(recovered: readonly string[]): string[] {
  const have = new Set(recovered.map(canonicalSection));
  return COMPARISON_SECTIONS.filter((k) => !have.has(k));
}

function failure(reason: string): SalvageResult {
  return { value: {}, recovered: [], missing: [...COMPARISON_SECTIONS], truncated: true, reason };
}

/**
 * Read whatever the stored text holds.
 *
 * Returns `null` when the input is not a stored JSON response at all — prose, an
 * empty string, something else — so the caller can tell "this row is not the
 * salvage case" apart from "this row is the salvage case and it is empty".
 */
export function salvageTruncatedJson(raw: string | null | undefined): SalvageResult | null {
  if (typeof raw !== 'string') return null;

  const stripped = stripFence(raw);
  if (!stripped || stripped[0] !== '{') return null;

  const s = stripped.length > MAX_SALVAGE_CHARS ? stripped.slice(0, MAX_SALVAGE_CHARS) : stripped;

  // The whole thing, first. Two of the 27 stored blobs do close their own brace,
  // and a future row written by a producer with a larger budget will too.
  if (stripped.length <= MAX_SALVAGE_CHARS) {
    try {
      const whole = JSON.parse(s);
      if (isRecord(whole)) {
        const recovered = Object.keys(whole);
        return { value: whole, recovered, missing: missingFrom(recovered), truncated: false, reason: '' };
      }
      return failure('the stored text parsed, but not as an object');
    } catch {
      // Fall through to the scan. This is the ordinary case: 25 of 27.
    }
  }

  return scanTopLevelPairs(s);
}

/**
 * One left-to-right pass, recording each top-level pair that reached its
 * terminator.
 *
 * State is explicit and flat — no regex over the body, no recursion, no retry —
 * so the cost is linear in a capped length and the loop cannot fail to end.
 */
function scanTopLevelPairs(s: string): SalvageResult {
  const value: Record<string, unknown> = {};
  const recovered: string[] = [];

  let depth = 0;
  let inString = false;
  let escaped = false;

  /** The key whose value we are inside, once `:` has been seen at depth 1. */
  let pendingKey: string | null = null;
  /** Where the current top-level value starts, once a non-space follows the colon. */
  let valueStart = -1;
  /** Where the current top-level key's quoted literal starts. */
  let keyStart = -1;
  /** The last key literal closed at depth 1, awaiting its colon. */
  let lastKey: string | null = null;

  const commit = (end: number) => {
    if (pendingKey === null || valueStart < 0) return;
    const slice = s.slice(valueStart, end).trim();
    if (slice) {
      try {
        value[pendingKey] = JSON.parse(slice);
        recovered.push(pendingKey);
      } catch {
        // A value that closed but does not parse is not recoverable, and not
        // fatal — the rest of the document is still worth reading.
      }
    }
    pendingKey = null;
    valueStart = -1;
  };

  const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t';

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];

    // ── inside a string literal ────────────────────────────────────────────
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') {
        inString = false;
        // A literal that closed at depth 1 with no value open is a key.
        if (depth === 1 && pendingKey === null && keyStart >= 0) {
          try {
            lastKey = String(JSON.parse(s.slice(keyStart, i + 1)));
          } catch {
            lastKey = null;
          }
          keyStart = -1;
        }
      }
      continue;
    }

    // ── the value opens here ───────────────────────────────────────────────
    // Recorded *before* `{`/`[` advances the depth, so a nested value's start is
    // its own opening bracket rather than something inferred afterwards.
    if (depth === 1 && pendingKey !== null && valueStart < 0 && !isSpace(c)) {
      valueStart = i;
    }

    if (c === '"') {
      inString = true;
      // At depth 1 with no value open, this literal is the next key.
      if (depth === 1 && pendingKey === null) keyStart = i;
      continue;
    }

    if (c === '{' || c === '[') {
      depth += 1;
      continue;
    }

    if (c === '}' || c === ']') {
      depth -= 1;
      // The document's own closing brace terminates the pair in flight.
      if (depth === 0) {
        commit(i);
        break;
      }
      continue;
    }

    if (depth === 1) {
      if (c === ':' && pendingKey === null && lastKey !== null) {
        pendingKey = lastKey;
        lastKey = null;
        valueStart = -1;
        continue;
      }
      if (c === ',') {
        commit(i);
        if (recovered.length >= MAX_SALVAGE_KEYS) break;
        continue;
      }
    }
  }

  if (!recovered.length) {
    return failure('no complete section survived the truncation');
  }

  return {
    value,
    recovered,
    missing: missingFrom(recovered),
    truncated: true,
    reason: '',
  };
}
